"""
Neural Orchestrator — User Behavior Model
==========================================
Learns exclusively from USER messages (not the agent's). Outputs:
  - Intent embedding  : dense vector representing the user's current need
  - Directive         : text snippet to inject into the agent's context window
  - Urgency score     : 0-1 float driving how forcefully to intervene
  - Topic vector      : soft probability over a learned topic space

Architecture
------------
  1. Token-level embedding via a learned lookup table (or torchvision CNN features
     when the user attaches an image — handled by VisionEncoder below).
  2. Temporal LSTM sequence model over the last N user turns.
  3. Dual output heads: intent classification + free-form directive generation
     (directive uses a small GPT-2-style MLP decoder over the LSTM hidden state).
  4. Online training: gradient steps run every `TRAIN_EVERY` new user messages on a
     short sliding-window buffer — no offline dataset needed.
"""

import math
import json
import hashlib
import re
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

# ── Config ────────────────────────────────────────────────────────────────────
VOCAB_SIZE      = 8192   # BPE-style subword vocab (built incrementally)
EMBED_DIM       = 128
HIDDEN_DIM      = 256
NUM_LAYERS      = 2
NUM_INTENTS     = 16     # learned intent clusters
DIRECTIVE_DIM   = 256    # latent size for directive decoder
MAX_SEQ_LEN     = 64     # tokens per user message (truncated/padded)
MAX_HISTORY     = 8      # how many past user turns to use
TRAIN_EVERY     = 3      # trigger a training pass every N new user observations


# ── Minimal BPE-inspired tokenizer (no dependencies) ─────────────────────────
class SimpleTokenizer:
    """
    Character-trigram hash tokenizer.
    No external dependencies.  Produces token IDs in [0, VOCAB_SIZE).
    Fast, deterministic, and incrementally works on any text.
    """
    def __init__(self, vocab_size: int = VOCAB_SIZE):
        self.vocab_size = vocab_size

    def encode(self, text: str, max_len: int = MAX_SEQ_LEN) -> list[int]:
        text = text.lower().strip()
        # Split on whitespace + punctuation into roughly word-level tokens
        tokens = re.findall(r"[a-z0-9']+|[^a-z0-9' \t\n]", text)
        ids = []
        for tok in tokens:
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            ids.append(h % self.vocab_size)
        # Pad or truncate
        ids = ids[:max_len]
        ids += [0] * (max_len - len(ids))
        return ids


# ── Positional Encoding ───────────────────────────────────────────────────────
class SinusoidalPE(nn.Module):
    def __init__(self, dim: int, max_len: int = MAX_SEQ_LEN):
        super().__init__()
        pe = torch.zeros(max_len, dim)
        pos = torch.arange(max_len).unsqueeze(1)
        div = torch.exp(torch.arange(0, dim, 2) * (-math.log(10000.0) / dim))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer('pe', pe.unsqueeze(0))  # (1, T, D)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, :x.size(1)]


# ── Vision Encoder (torchvision) ──────────────────────────────────────────────
class VisionEncoder(nn.Module):
    """
    When the user attaches an image, encode it into the same EMBED_DIM space
    as text tokens so it can be concatenated onto the token sequence.
    Uses a lightweight MobileNetV3-small backbone from torchvision.
    """
    def __init__(self, out_dim: int = EMBED_DIM):
        super().__init__()
        try:
            import torchvision.models as models
            backbone = models.mobilenet_v3_small(weights=None)
            # Replace the classifier head with a projection to out_dim
            in_feats = backbone.classifier[0].in_features
            backbone.classifier = nn.Sequential(
                nn.Linear(in_feats, out_dim),
                nn.Hardswish(),
            )
            self.net = backbone
            self.available = True
        except Exception:
            self.net = nn.Identity()
            self.available = False

    def forward(self, img: torch.Tensor) -> torch.Tensor:
        """img: (B, 3, 224, 224)  →  (B, EMBED_DIM)"""
        if not self.available:
            return torch.zeros(img.size(0), EMBED_DIM, device=img.device)
        return self.net(img)


# ── Core User Behavior Model ──────────────────────────────────────────────────
class UserBehaviorModel(nn.Module):
    """
    Inputs:
        token_ids   : (B, H, T)  — B batch, H history turns, T tokens/turn
        meta        : (B, M)     — metadata per turn: [hour/24, msg_len/500,
                                   turn_index/100, is_image]
        image_feats : (B, EMBED_DIM) or None  — encoded vision features
    Outputs:
        intent_logits  : (B, NUM_INTENTS)
        urgency        : (B, 1)  in [0, 1]
        directive_emb  : (B, DIRECTIVE_DIM)  — decoded by DirectiveDecoder
    """

    META_DIM = 4  # hour, msg_len, turn_idx, is_image

    def __init__(self):
        super().__init__()
        self.tok_embed  = nn.Embedding(VOCAB_SIZE, EMBED_DIM, padding_idx=0)
        self.pos_enc    = SinusoidalPE(EMBED_DIM, MAX_SEQ_LEN)
        self.tok_proj   = nn.Linear(EMBED_DIM, EMBED_DIM)  # per-token refinement

        # Turn-level repr: pool over tokens then fuse with metadata
        self.meta_proj  = nn.Linear(self.META_DIM, EMBED_DIM)
        self.turn_norm  = nn.LayerNorm(EMBED_DIM)

        # History sequence model
        self.lstm = nn.LSTM(
            input_size=EMBED_DIM,
            hidden_size=HIDDEN_DIM,
            num_layers=NUM_LAYERS,
            batch_first=True,
            dropout=0.1 if NUM_LAYERS > 1 else 0.0,
        )

        # Vision fusion gate
        self.vision_gate = nn.Sequential(
            nn.Linear(EMBED_DIM + HIDDEN_DIM, HIDDEN_DIM),
            nn.SiLU(),
            nn.Linear(HIDDEN_DIM, HIDDEN_DIM),
            nn.Sigmoid(),
        )
        self.vision_proj = nn.Linear(EMBED_DIM, HIDDEN_DIM)

        # Output heads
        self.intent_head    = nn.Linear(HIDDEN_DIM, NUM_INTENTS)
        self.urgency_head   = nn.Sequential(
            nn.Linear(HIDDEN_DIM, 64), nn.SiLU(), nn.Linear(64, 1), nn.Sigmoid()
        )
        self.directive_head = nn.Linear(HIDDEN_DIM, DIRECTIVE_DIM)

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Embedding):
                nn.init.normal_(m.weight, 0, 0.02)
                nn.init.zeros_(m.weight[0])  # padding_idx = 0

    def encode_turn(
        self,
        token_ids: torch.Tensor,   # (B, T)
        meta: torch.Tensor,        # (B, META_DIM)
    ) -> torch.Tensor:             # (B, EMBED_DIM)
        x = self.tok_embed(token_ids)        # (B, T, E)
        x = self.pos_enc(x)
        x = self.tok_proj(x)
        # Attention-style mean pooling (mask out padding)
        mask = (token_ids != 0).float().unsqueeze(-1)  # (B, T, 1)
        pooled = (x * mask).sum(1) / mask.sum(1).clamp(min=1)  # (B, E)
        pooled = pooled + self.meta_proj(meta)
        return self.turn_norm(pooled)

    def forward(
        self,
        token_ids: torch.Tensor,       # (B, H, T)
        meta: torch.Tensor,            # (B, H, META_DIM)
        image_feats: Optional[torch.Tensor] = None,  # (B, EMBED_DIM)
    ) -> dict:
        B, H, T = token_ids.shape

        # Encode each historical turn
        turns = []
        for h in range(H):
            turn_repr = self.encode_turn(token_ids[:, h], meta[:, h])
            turns.append(turn_repr)
        turn_seq = torch.stack(turns, dim=1)   # (B, H, E)

        # LSTM over history
        lstm_out, (h_n, _) = self.lstm(turn_seq)
        ctx = h_n[-1]                          # (B, HIDDEN_DIM) — last layer

        # Fuse vision features if available
        if image_feats is not None:
            v = self.vision_proj(image_feats)  # (B, HIDDEN_DIM)
            gate = self.vision_gate(torch.cat([image_feats, ctx], dim=-1))
            ctx = ctx + gate * v

        return {
            'intent_logits': self.intent_head(ctx),        # (B, NUM_INTENTS)
            'urgency':       self.urgency_head(ctx),       # (B, 1)
            'directive_emb': self.directive_head(ctx),     # (B, DIRECTIVE_DIM)
            'ctx':           ctx,                          # (B, HIDDEN_DIM)
        }


# ── Directive Decoder ─────────────────────────────────────────────────────────
# Maps the directive embedding → a short natural-language string that the
# orchestrator injects into the agent's system context.
# Uses a cosine-similarity lookup over a learned directive codebook.

class DirectiveCodebook(nn.Module):
    """
    N_CODES learned directive prototypes.
    At inference: nearest-code lookup → string template.
    At training:  soft assignment keeps it differentiable.
    """
    N_CODES = 64

    TEMPLATES = [
        "The user appears to want a concise, actionable answer. Prioritize brevity.",
        "The user seems frustrated. Acknowledge this, then solve the problem directly.",
        "The user is exploring an idea. Engage curiously, propose extensions.",
        "The user wants code. Output runnable code immediately, minimal prose.",
        "The user is asking about their system or environment. Check system state first.",
        "The user wants a creative response. Engage imaginatively.",
        "The user is giving feedback. Acknowledge it and adapt behavior accordingly.",
        "The user wants a deep technical explanation. Go into full detail.",
        "The user is asking a factual question. Answer precisely, cite uncertainty.",
        "The user wants the agent to take action autonomously. Proceed without asking for confirmation.",
        "The user is in an exploratory/research mode. Synthesize and speculate.",
        "The user needs debugging help. Trace the error carefully before proposing a fix.",
        "The user wants the agent to remember something important. Explicitly store this in memory.",
        "The user is describing a goal. Break it into sub-tasks and begin the first one.",
        "The user appears to be testing the system. Respond with transparency about what you are doing.",
        "The user wants a philosophical or abstract discussion. Engage on that level.",
    ]
    # Pad to N_CODES with generic directive
    while len(TEMPLATES) < N_CODES:
        TEMPLATES.append("Continue with the current task. Prioritize quality.")

    def __init__(self, dim: int = DIRECTIVE_DIM):
        super().__init__()
        self.codebook = nn.Embedding(self.N_CODES, dim)
        nn.init.normal_(self.codebook.weight, 0, 0.1)

    def forward(self, emb: torch.Tensor) -> torch.Tensor:
        """Soft assignment over codebook. Returns reconstructed emb."""
        codes = self.codebook.weight   # (N, D)
        emb_n = F.normalize(emb,   dim=-1)
        code_n = F.normalize(codes, dim=-1)
        sim = emb_n @ code_n.T         # (B, N)
        weights = F.softmax(sim * 10, dim=-1)
        return weights @ codes         # (B, D)

    def decode(self, emb: torch.Tensor) -> tuple[str, float]:
        """Hard decode: nearest code → template string + confidence."""
        codes = self.codebook.weight
        emb_n = F.normalize(emb.unsqueeze(0), dim=-1)
        code_n = F.normalize(codes, dim=-1)
        sims = (emb_n @ code_n.T).squeeze(0)
        idx = sims.argmax().item()
        conf = sims[idx].item()
        template = self.TEMPLATES[min(idx, len(self.TEMPLATES) - 1)]
        return template, conf

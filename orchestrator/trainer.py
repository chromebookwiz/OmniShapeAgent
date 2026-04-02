"""
Neural Orchestrator — Online Trainer
=====================================
Runs a non-blocking gradient update every TRAIN_EVERY observations.
Uses a sliding-window replay buffer (no static dataset needed).

Loss signal:
  - Self-supervised: predict the NEXT user message embedding from the previous H-1 turns.
  - Intent consistency: consecutive user messages in the same session should have
    high cosine similarity in intent space (contrastive loss).
  - Urgency regularization: urgency should be low for short messages, high for long/
    emotional ones (simple proxy signal).
  - Codebook commitment loss: keeps directive embeddings close to codebook prototypes.
"""

import time
import threading
import logging
import math
from collections import deque
from typing import Optional
import json
import os

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR

from model import (
    UserBehaviorModel, DirectiveCodebook, SimpleTokenizer,
    VOCAB_SIZE, EMBED_DIM, HIDDEN_DIM, DIRECTIVE_DIM,
    MAX_SEQ_LEN, MAX_HISTORY, TRAIN_EVERY, NUM_INTENTS
)

log = logging.getLogger("orchestrator.trainer")

CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "checkpoints", "model.pt")
BUFFER_SIZE     = 256   # max observations in replay buffer
LR              = 3e-4
WEIGHT_DECAY    = 1e-4
GRAD_CLIP       = 1.0
LOSS_LAMBDA_CONTRASTIVE = 0.3
LOSS_LAMBDA_COMMITMENT  = 0.1
LOSS_LAMBDA_URGENCY     = 0.05


class Observation:
    """One recorded user message with associated metadata."""
    __slots__ = ('text', 'hour', 'msg_len', 'turn_idx', 'has_image',
                 'session_id', 'token_ids', 'ts')

    def __init__(self, text: str, hour: float, turn_idx: int,
                 session_id: str, has_image: bool = False):
        self.text       = text
        self.hour       = hour / 24.0
        self.msg_len    = min(len(text) / 500.0, 1.0)
        self.turn_idx   = min(turn_idx / 100.0, 1.0)
        self.has_image  = float(has_image)
        self.session_id = session_id
        self.token_ids  = None  # filled by trainer
        self.ts         = time.time()


class OrchestratorTrainer:
    def __init__(self, device: Optional[str] = None):
        self.device = torch.device(
            device or ('cuda' if torch.cuda.is_available() else 'cpu')
        )
        log.info(f"Orchestrator trainer on device: {self.device}")

        self.model    = UserBehaviorModel().to(self.device)
        self.codebook = DirectiveCodebook().to(self.device)
        self.tokenizer = SimpleTokenizer()

        # Prediction head: predicts next turn's intent from current ctx
        self.next_turn_pred = nn.Linear(HIDDEN_DIM, EMBED_DIM).to(self.device)

        all_params = (
            list(self.model.parameters())
          + list(self.codebook.parameters())
          + list(self.next_turn_pred.parameters())
        )
        self.optimizer = AdamW(all_params, lr=LR, weight_decay=WEIGHT_DECAY)
        self.scheduler = CosineAnnealingLR(self.optimizer, T_max=500, eta_min=1e-5)

        self.buffer: deque[Observation] = deque(maxlen=BUFFER_SIZE)
        self._obs_since_train = 0
        self._train_steps     = 0
        self._lock            = threading.Lock()
        self._training_thread: Optional[threading.Thread] = None

        self._load_checkpoint()

    # ── Public API ────────────────────────────────────────────────────────────

    def observe(self, obs: Observation) -> None:
        """Record a new user observation and trigger training if threshold met."""
        obs.token_ids = self.tokenizer.encode(obs.text)
        with self._lock:
            self.buffer.append(obs)
            self._obs_since_train += 1
            if self._obs_since_train >= TRAIN_EVERY:
                self._obs_since_train = 0
                self._async_train()

    @torch.no_grad()
    def get_directive(self, recent_obs: list[Observation]) -> dict:
        """
        Run inference on the last N observations and return:
          - directive  : string to inject into agent context
          - urgency    : float 0-1
          - confidence : float 0-1
          - intent_idx : int (learned intent cluster)
        """
        self.model.eval()
        if not recent_obs:
            return {'directive': '', 'urgency': 0.0, 'confidence': 0.0, 'intent_idx': 0}

        token_ids, meta = self._build_tensors(recent_obs, pad_to=MAX_HISTORY)
        out = self.model(token_ids.unsqueeze(0), meta.unsqueeze(0))

        urgency    = out['urgency'].item()
        intent_idx = out['intent_logits'].argmax(-1).item()
        directive, conf = self.codebook.decode(out['directive_emb'].squeeze(0))

        return {
            'directive':  directive,
            'urgency':    urgency,
            'confidence': conf,
            'intent_idx': int(intent_idx),
        }

    def stats(self) -> dict:
        return {
            'train_steps':    self._train_steps,
            'buffer_size':    len(self.buffer),
            'device':         str(self.device),
            'obs_since_train': self._obs_since_train,
        }

    # ── Private Training ─────────────────────────────────────────────────────

    def _async_train(self) -> None:
        if self._training_thread and self._training_thread.is_alive():
            return  # previous step still running — skip, don't block
        self._training_thread = threading.Thread(
            target=self._train_step, daemon=True
        )
        self._training_thread.start()

    def _train_step(self) -> None:
        with self._lock:
            buf = list(self.buffer)
        if len(buf) < 2:
            return

        self.model.train()
        self.codebook.train()

        # Build training pairs: (history of H turns) → predict next turn
        pairs = self._build_pairs(buf)
        if not pairs:
            return

        total_loss = torch.tensor(0.0, device=self.device)
        n = 0

        for (hist_ids, hist_meta), (next_ids, next_meta) in pairs:
            hist_ids  = hist_ids.to(self.device)
            hist_meta = hist_meta.to(self.device)
            next_ids  = next_ids.to(self.device)
            next_meta = next_meta.to(self.device)

            out = self.model(hist_ids.unsqueeze(0), hist_meta.unsqueeze(0))
            ctx = out['ctx'].squeeze(0)            # (HIDDEN_DIM,)
            dir_emb = out['directive_emb']         # (1, DIRECTIVE_DIM)
            urgency = out['urgency']               # (1, 1)

            # 1. Next-turn prediction loss (self-supervised)
            pred_emb = self.next_turn_pred(ctx)    # (EMBED_DIM,)
            # Target: mean token embedding of next turn
            with torch.no_grad():
                tgt_emb = self.model.tok_embed(next_ids.unsqueeze(0).squeeze(1)).mean(1)
            loss_pred = 1.0 - F.cosine_similarity(
                pred_emb.unsqueeze(0), tgt_emb, dim=-1
            ).mean()

            # 2. Codebook commitment loss (discretisation pressure)
            reconstructed = self.codebook(dir_emb)
            loss_commit = F.mse_loss(reconstructed, dir_emb.detach())

            # 3. Urgency proxy loss: long/emotional messages → high urgency
            urgency_target = self._urgency_proxy(
                hist_ids[-1] if hist_ids.dim() > 1 else hist_ids,
                hist_meta[-1] if hist_meta.dim() > 1 else hist_meta
            )
            loss_urgency = F.mse_loss(urgency.squeeze(), urgency_target.to(self.device))

            loss = (
                loss_pred
              + LOSS_LAMBDA_COMMITMENT * loss_commit
              + LOSS_LAMBDA_URGENCY   * loss_urgency
            )
            total_loss = total_loss + loss
            n += 1

        if n == 0:
            return

        avg_loss = total_loss / n
        self.optimizer.zero_grad()
        avg_loss.backward()
        nn.utils.clip_grad_norm_(self.model.parameters(), GRAD_CLIP)
        self.optimizer.step()
        self.scheduler.step()

        self._train_steps += 1
        log.debug(f"Train step {self._train_steps} | loss={avg_loss.item():.4f}")

        if self._train_steps % 20 == 0:
            self._save_checkpoint()

    def _urgency_proxy(self, token_ids: torch.Tensor, meta: torch.Tensor) -> torch.Tensor:
        """Short proxy: urgency ~ long message OR starts with emotional cue."""
        msg_len = meta[1].item() if meta.numel() > 1 else 0.0
        # Count non-padding tokens
        non_pad = (token_ids != 0).float().sum().item() / MAX_SEQ_LEN
        return torch.tensor(min(1.0, 0.5 * msg_len + 0.5 * non_pad))

    def _build_pairs(self, buf: list[Observation]):
        """
        Slide a window over the buffer, group by session, produce (history, next) pairs.
        """
        # Group consecutive same-session messages
        pairs = []
        sessions: dict[str, list[Observation]] = {}
        for obs in buf:
            sessions.setdefault(obs.session_id, []).append(obs)

        for obs_list in sessions.values():
            for i in range(len(obs_list) - 1):
                end = i + 1
                start = max(0, end - MAX_HISTORY)
                hist = obs_list[start:end]
                nxt  = obs_list[end]
                if not hist:
                    continue
                hist_t, hist_m = self._build_tensors(hist, MAX_HISTORY)
                nxt_ids = torch.tensor(nxt.token_ids or [], dtype=torch.long)
                if nxt_ids.numel() < MAX_SEQ_LEN:
                    nxt_ids = F.pad(nxt_ids, (0, MAX_SEQ_LEN - nxt_ids.numel()))
                nxt_meta = torch.tensor([nxt.hour, nxt.msg_len, nxt.turn_idx, nxt.has_image])
                pairs.append(((hist_t, hist_m), (nxt_ids.unsqueeze(0), nxt_meta.unsqueeze(0))))
        return pairs

    def _build_tensors(self, obs_list: list[Observation], pad_to: int):
        """
        Returns:
          token_ids : (pad_to, MAX_SEQ_LEN)  LongTensor
          meta      : (pad_to, 4)            FloatTensor
        Pads history with zeros if fewer than pad_to turns.
        """
        rows_ids  = []
        rows_meta = []
        for obs in obs_list[-pad_to:]:
            ids = obs.token_ids or [0] * MAX_SEQ_LEN
            ids = ids[:MAX_SEQ_LEN] + [0] * max(0, MAX_SEQ_LEN - len(ids))
            rows_ids.append(ids)
            rows_meta.append([obs.hour, obs.msg_len, obs.turn_idx, obs.has_image])
        # Pad history dimension
        while len(rows_ids) < pad_to:
            rows_ids.insert(0, [0] * MAX_SEQ_LEN)
            rows_meta.insert(0, [0.0, 0.0, 0.0, 0.0])
        return (
            torch.tensor(rows_ids,  dtype=torch.long),
            torch.tensor(rows_meta, dtype=torch.float),
        )

    def _save_checkpoint(self) -> None:
        os.makedirs(os.path.dirname(CHECKPOINT_PATH), exist_ok=True)
        torch.save({
            'model':           self.model.state_dict(),
            'codebook':        self.codebook.state_dict(),
            'next_turn_pred':  self.next_turn_pred.state_dict(),
            'optimizer':       self.optimizer.state_dict(),
            'train_steps':     self._train_steps,
        }, CHECKPOINT_PATH)
        log.info(f"Checkpoint saved at step {self._train_steps}")

    def _load_checkpoint(self) -> None:
        if not os.path.exists(CHECKPOINT_PATH):
            log.info("No checkpoint found — starting fresh.")
            return
        try:
            ckpt = torch.load(CHECKPOINT_PATH, map_location=self.device)
            self.model.load_state_dict(ckpt['model'])
            self.codebook.load_state_dict(ckpt['codebook'])
            self.next_turn_pred.load_state_dict(ckpt['next_turn_pred'])
            self.optimizer.load_state_dict(ckpt['optimizer'])
            self._train_steps = ckpt.get('train_steps', 0)
            log.info(f"Loaded checkpoint (step {self._train_steps}).")
        except Exception as e:
            log.warning(f"Could not load checkpoint: {e} — starting fresh.")

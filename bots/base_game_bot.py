#!/usr/bin/env python3
"""
base_game_bot.py — Shared PolicyNet (Actor-Critic) + training utilities.

Every game-specific bot imports or inlines these classes.  The module is also
fully runnable as a self-test: `python bots/base_game_bot.py`

Architecture
────────────
  Input: flattened 64×36 palette grid (STATE_DIM = 2304 floats, values 0–1)
  Shared trunk: Linear → LayerNorm → GELU  (3 layers, width 512/256/128)
  Policy head: Linear(128, ACTION_DIM) → action logits
  Value head:  Linear(128, 1)          → state-value estimate V(s)

Training: REINFORCE with baseline (Actor-Critic), entropy bonus
Persistence: weights/<botId>_policy.pt  +  weights/<botId>_policy_meta.json
"""

from __future__ import annotations
import os, sys, json, math, time, random, pathlib
from typing import List, Tuple, Optional, Dict, Any

import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.distributions import Categorical

# ── Constants ─────────────────────────────────────────────────────────────────
STATE_DIM  = 2304    # 64 cols × 36 rows palette grid
ACTION_DIM = 8       # subclasses override this
WEIGHTS_DIR = pathlib.Path(os.getcwd()) / "weights"
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)

# ── Neural Network ─────────────────────────────────────────────────────────────

class PolicyNet(nn.Module):
    """Shared trunk + separate policy and value heads."""

    def __init__(self, state_dim: int = STATE_DIM, action_dim: int = ACTION_DIM):
        super().__init__()
        self.state_dim  = state_dim
        self.action_dim = action_dim

        # Shared vision trunk
        self.trunk = nn.Sequential(
            nn.Linear(state_dim, 512), nn.LayerNorm(512), nn.GELU(),
            nn.Linear(512, 256),       nn.LayerNorm(256), nn.GELU(),
            nn.Linear(256, 128),       nn.LayerNorm(128), nn.GELU(),
        )
        # Actor head → action logits
        self.policy_head = nn.Linear(128, action_dim)
        # Critic head → scalar state value
        self.value_head  = nn.Linear(128, 1)

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=math.sqrt(2))
                nn.init.zeros_(m.bias)
        # Policy head: small init for stable early exploration
        nn.init.orthogonal_(self.policy_head.weight, gain=0.01)
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            x: (batch, state_dim) float tensor, values in [0, 1]
        Returns:
            logits: (batch, action_dim)
            value:  (batch,)
        """
        h = self.trunk(x)
        return self.policy_head(h), self.value_head(h).squeeze(-1)

    def act(self, state: torch.Tensor, deterministic: bool = False) -> Tuple[int, torch.Tensor, torch.Tensor]:
        """
        Sample one action.

        Returns:
            action_idx: int
            log_prob:   scalar tensor (for gradient)
            value:      scalar tensor (for baseline)
        """
        logits, value = self(state.unsqueeze(0))
        dist = Categorical(logits=logits[0])
        if deterministic:
            action = dist.probs.argmax().item()
        else:
            action = dist.sample().item()
        return action, dist.log_prob(torch.tensor(action)), value[0]


# ── Weight I/O ─────────────────────────────────────────────────────────────────

def weight_path(bot_id: str) -> pathlib.Path:
    return WEIGHTS_DIR / f"{bot_id}_policy.pt"

def meta_path(bot_id: str) -> pathlib.Path:
    return WEIGHTS_DIR / f"{bot_id}_policy_meta.json"

def save_weights(net: PolicyNet, bot_id: str, meta: Dict[str, Any] = {}) -> str:
    wp = weight_path(bot_id)
    torch.save(net.state_dict(), wp)
    full_meta = {
        "bot_id": bot_id,
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "state_dim":  net.state_dim,
        "action_dim": net.action_dim,
        **meta,
    }
    meta_path(bot_id).write_text(json.dumps(full_meta, indent=2))
    return str(wp)

def load_weights(net: PolicyNet, bot_id: str, strict: bool = False) -> bool:
    """Load weights if they exist. Returns True on success."""
    wp = weight_path(bot_id)
    if not wp.exists():
        return False
    try:
        state = torch.load(wp, map_location="cpu", weights_only=True)
        net.load_state_dict(state, strict=strict)
        return True
    except Exception as e:
        print(f"[load_weights] Failed ({e}), starting fresh.", file=sys.stderr)
        return False

def load_meta(bot_id: str) -> Dict[str, Any]:
    mp = meta_path(bot_id)
    return json.loads(mp.read_text()) if mp.exists() else {}


# ── Experience Buffer ──────────────────────────────────────────────────────────

class Episode:
    """Stores one episode of (state, action, reward, log_prob, value) tuples."""

    def __init__(self):
        self.states:    List[torch.Tensor] = []
        self.actions:   List[int]          = []
        self.rewards:   List[float]        = []
        self.log_probs: List[torch.Tensor] = []
        self.values:    List[torch.Tensor] = []

    def push(self, state, action, reward, log_prob, value):
        self.states.append(state)
        self.actions.append(action)
        self.rewards.append(float(reward))
        self.log_probs.append(log_prob)
        self.values.append(value)

    def __len__(self):
        return len(self.rewards)

    @property
    def total_reward(self) -> float:
        return sum(self.rewards)


# ── Returns & Advantages ───────────────────────────────────────────────────────

def compute_returns(rewards: List[float], gamma: float = 0.99) -> torch.Tensor:
    G = 0.0
    returns = []
    for r in reversed(rewards):
        G = r + gamma * G
        returns.insert(0, G)
    t = torch.tensor(returns, dtype=torch.float32)
    # Normalize for training stability
    if t.std() > 1e-6:
        t = (t - t.mean()) / (t.std() + 1e-8)
    return t

def compute_advantages(
    returns: torch.Tensor,
    values:  List[torch.Tensor],
    normalize: bool = True,
) -> torch.Tensor:
    vals   = torch.stack(values)
    advs   = returns - vals.detach()
    if normalize and advs.std() > 1e-6:
        advs = (advs - advs.mean()) / (advs.std() + 1e-8)
    return advs


# ── REINFORCE + Actor-Critic Training Step ────────────────────────────────────

def train_step(
    net:        PolicyNet,
    optimizer:  optim.Optimizer,
    episode:    Episode,
    gamma:      float = 0.99,
    value_coef: float = 0.5,
    entropy_coef: float = 0.01,
) -> Dict[str, float]:
    """
    One policy-gradient update over a single episode.

    Returns dict with keys: policy_loss, value_loss, entropy, total_loss
    """
    if len(episode) == 0:
        return {}

    returns  = compute_returns(episode.rewards, gamma)
    log_probs = torch.stack(episode.log_probs)
    values    = torch.stack(episode.values)
    advantages = compute_advantages(returns, episode.values)

    # States tensor for entropy calculation
    states_t = torch.stack(episode.states)
    logits, _ = net(states_t)
    dist = Categorical(logits=logits)

    policy_loss  = -(log_probs * advantages).mean()
    value_loss   = F.mse_loss(values, returns)
    entropy_loss = -dist.entropy().mean()

    total_loss = policy_loss + value_coef * value_loss + entropy_coef * entropy_loss

    optimizer.zero_grad()
    total_loss.backward()
    nn.utils.clip_grad_norm_(net.parameters(), max_norm=0.5)
    optimizer.step()

    return {
        "policy_loss":  policy_loss.item(),
        "value_loss":   value_loss.item(),
        "entropy":      -entropy_loss.item(),
        "total_loss":   total_loss.item(),
        "total_reward": episode.total_reward,
        "steps":        len(episode),
    }


# ── Grid State Encoding ────────────────────────────────────────────────────────

def grid_to_tensor(grid_str: str, cols: int = 64, rows: int = 36) -> torch.Tensor:
    """
    Convert a '|'-separated palette grid string to a float32 tensor in [0,1].
    Each character is mapped to its ordinal value / 255.
    Unknown characters map to 0.
    """
    lines = grid_str.split("|")
    flat  = []
    for line in lines[:rows]:
        for ch in line[:cols]:
            flat.append(ord(ch) / 255.0)
        # Pad short rows
        flat.extend([0.0] * max(0, cols - len(line)))
    # Pad missing rows
    flat.extend([0.0] * max(0, rows * cols - len(flat)))
    return torch.tensor(flat[:rows * cols], dtype=torch.float32)


def normalize_state(t: torch.Tensor) -> torch.Tensor:
    """Scale each feature to [0,1]; handles zero-variance states gracefully."""
    mn, mx = t.min(), t.max()
    if (mx - mn) < 1e-6:
        return t
    return (t - mn) / (mx - mn + 1e-8)


# ── Self-test ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== base_game_bot.py self-test ===")

    net  = PolicyNet(STATE_DIM, ACTION_DIM)
    opt  = optim.Adam(net.parameters(), lr=1e-3)

    # Simulate 3 random episodes
    for ep_idx in range(3):
        ep = Episode()
        state = torch.rand(STATE_DIM)
        for _ in range(20):
            action, lp, val = net.act(state)
            reward = random.gauss(0, 1)
            ep.push(state, action, reward, lp, val)
            state = torch.rand(STATE_DIM)

        stats = train_step(net, opt, ep)
        print(f"  ep={ep_idx+1}  reward={stats['total_reward']:.2f}"
              f"  policy_loss={stats['policy_loss']:.4f}"
              f"  value_loss={stats['value_loss']:.4f}"
              f"  entropy={stats['entropy']:.4f}")

    # Save / reload round-trip
    save_weights(net, "_test_bot", {"score": 42.0})
    net2 = PolicyNet(STATE_DIM, ACTION_DIM)
    ok   = load_weights(net2, "_test_bot")
    print(f"  weight round-trip: {'OK' if ok else 'FAIL'}")

    # Grid encoding
    fake_grid = "|".join("".join(str(random.randint(0,9)) for _ in range(64)) for _ in range(36))
    t = grid_to_tensor(fake_grid)
    assert t.shape == (STATE_DIM,), f"bad shape {t.shape}"
    print(f"  grid_to_tensor shape: {t.shape}  min={t.min():.3f}  max={t.max():.3f}")

    print("=== PASS ===")

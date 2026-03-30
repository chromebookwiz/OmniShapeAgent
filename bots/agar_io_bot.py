#!/usr/bin/env python3
"""
agar_io_bot.py — Autonomous Agar.io learning bot.

Modes
─────
1. Agent mode  (default when deployed via deploy_bot):
   The LLM agent calls tools (vision_tick, mouse_move, run_python, …).
   This file is the ML backbone — the agent runs snippets from it via
   run_python() and calls the mouse/keyboard tools itself.

2. Standalone mode  (python bots/agar_io_bot.py):
   Uses pyautogui + mss for direct screen capture and mouse control.
   Useful for local training without the full agent stack.

   Requirements:  pip install pyautogui mss pillow numpy
   The venv already has torch from ensureTorch().

Action Space (ACTION_DIM = 9)
─────────────────────────────
   0: idle
   1: move N    (mouse toward top)
   2: move NE
   3: move E
   4: move SE
   5: move S
   6: move SW
   7: move W
   8: move NW
   * split is handled separately: triggered when blob is large

State
─────
   64×36 palette grid → 2304-dim float tensor
   + 4-dim meta: [my_col/64, my_row/36, my_size/16, nearest_food_dist]
   Total STATE_DIM = 2308
"""

from __future__ import annotations
import os, sys, json, time, math, random, pathlib, argparse
from typing import Tuple, Optional

# ── Add project root to path so base_game_bot is importable ───────────────────
_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import torch
import torch.optim as optim

from bots.base_game_bot import (
    PolicyNet, Episode, train_step, save_weights, load_weights, load_meta,
    grid_to_tensor, normalize_state, WEIGHTS_DIR,
)

# ── Bot config ─────────────────────────────────────────────────────────────────
BOT_ID      = os.environ.get("BOT_ID", "agarBot")
COLS        = 64
ROWS        = 36
STATE_DIM   = COLS * ROWS + 4   # grid + meta features
ACTION_DIM  = 9
LR          = float(os.environ.get("LR", "3e-4"))
GAMMA       = 0.99
ENTROPY_COEF = 0.02
SAVE_EVERY  = 25   # episodes
SPLIT_SIZE_THRESHOLD = 8   # blob size (in grid cells) to trigger split

# ── Action → direction mapping ─────────────────────────────────────────────────
# Each entry is (delta_col, delta_row) fraction of grid size
DIRECTION = {
    0: (0,  0),    # idle
    1: (0, -1),    # N
    2: (1, -1),    # NE
    3: (1,  0),    # E
    4: (1,  1),    # SE
    5: (0,  1),    # S
    6: (-1, 1),    # SW
    7: (-1, 0),    # W
    8: (-1,-1),    # NW
}
ACTION_NAMES = ["idle","N","NE","E","SE","S","SW","W","NW"]

# ── Color codes for default palette ───────────────────────────────────────────
# Agar.io default: white/light = our cell, green = food, red/dark = enemy
MY_CODES    = {"5", "1", "f", "F", "w", "W"}   # our blob
FOOD_CODES  = {"3", "g", "G"}                   # food pellets
ENEMY_CODES = {"2", "r", "R", "d", "D"}         # enemies / viruses


# ══════════════════════════════════════════════════════════════════════════════
# State encoding
# ══════════════════════════════════════════════════════════════════════════════

def locate_blob(grid_rows: list[str], codes: set) -> Tuple[int, int, int]:
    """Return (col, row, size) of the largest region matching any code in `codes`."""
    best = (COLS // 2, ROWS // 2, 0)
    for r, line in enumerate(grid_rows):
        for c, ch in enumerate(line):
            if ch in codes:
                cnt = sum(
                    1
                    for dr in (-1, 0, 1)
                    for dc in (-1, 0, 1)
                    if 0 <= r+dr < len(grid_rows)
                    and 0 <= c+dc < len(line)
                    and grid_rows[r+dr][c+dc] in codes
                )
                if cnt > best[2]:
                    best = (c, r, cnt)
    return best

def nearest_of(grid_rows: list[str], codes: set, my_c: int, my_r: int) -> Optional[Tuple[int,int]]:
    """Return (col, row) of nearest cell matching any code, or None."""
    best_d, best_pos = float("inf"), None
    for r, line in enumerate(grid_rows):
        for c, ch in enumerate(line):
            if ch in codes:
                d = math.hypot(c - my_c, r - my_r)
                if d < best_d:
                    best_d, best_pos = d, (c, r)
    return best_pos

def encode_state(grid_str: str) -> Tuple[torch.Tensor, dict]:
    """
    Encode the palette grid + derived meta-features into a STATE_DIM tensor.

    Returns:
        tensor: (STATE_DIM,) float32
        info:   dict with parsed blob positions for action decoding
    """
    rows = (grid_str or "").split("|")

    grid_t   = grid_to_tensor(grid_str, COLS, ROWS)   # (2304,)
    grid_t   = normalize_state(grid_t)

    my_c, my_r, my_sz = locate_blob(rows, MY_CODES)
    food_pos = nearest_of(rows, FOOD_CODES, my_c, my_r)
    food_dist = (
        math.hypot(food_pos[0] - my_c, food_pos[1] - my_r) / math.hypot(COLS, ROWS)
        if food_pos else 1.0
    )

    meta = torch.tensor([
        my_c / COLS,
        my_r / ROWS,
        min(my_sz, 16) / 16.0,
        food_dist,
    ], dtype=torch.float32)

    state = torch.cat([grid_t, meta])   # (2308,)
    info  = {
        "my_c": my_c, "my_r": my_r, "my_sz": my_sz,
        "food_pos": food_pos,
    }
    return state, info


# ══════════════════════════════════════════════════════════════════════════════
# Reward shaping
# ══════════════════════════════════════════════════════════════════════════════

def compute_reward(prev_info: dict, curr_info: dict, alive: bool) -> float:
    """
    Reward signal combining:
      +size_gain  (grew bigger)
      -proximity_to_enemy  (stay away from red cells)
      -0.01  (per-step survival cost keeps the bot moving)
      -5.0   (death penalty)
    """
    if not alive:
        return -5.0

    size_gain = (curr_info["my_sz"] - prev_info["my_sz"]) * 0.5
    step_cost = -0.01
    return size_gain + step_cost


# ══════════════════════════════════════════════════════════════════════════════
# Standalone interaction layer (pyautogui + mss)
# ══════════════════════════════════════════════════════════════════════════════

_standalone_available = False
try:
    import pyautogui   # type: ignore
    import mss         # type: ignore
    import numpy as np
    from PIL import Image
    _standalone_available = True
except ImportError:
    pass

def _grid_from_screenshot(sct, monitor) -> str:
    """Capture screen → palette grid string (simplified grayscale → char)."""
    img = Image.frombytes("RGB", (monitor["width"], monitor["height"]),
                           sct.grab(monitor).rgb)
    img = img.resize((COLS, ROWS), Image.BILINEAR)
    pix = list(img.getdata())
    rows_out = []
    for r in range(ROWS):
        row_chars = ""
        for c in range(COLS):
            rgb = pix[r * COLS + c]
            # Heuristic palette mapping
            R, G, B = rgb
            if G > 180 and R < 100 and B < 100:
                ch = "3"  # food (green)
            elif R > 200 and R > G * 1.5 and R > B * 1.5:
                ch = "2"  # enemy (red)
            elif R > 200 and G > 200 and B > 200:
                ch = "1"  # my cell (white/bright)
            elif max(rgb) < 30:
                ch = "0"  # background (black)
            else:
                ch = chr(min(ord("0") + max(rgb) // 28, ord("9")))
            row_chars += ch
        rows_out.append(row_chars)
    return "|".join(rows_out)

def _action_to_mouse(action: int, info: dict, screen_w: int, screen_h: int) -> Tuple[int,int]:
    """Convert action index to absolute screen coordinates."""
    dc, dr = DIRECTION[action]
    STEP = 0.35   # fraction of screen to move per action
    tx = info["my_c"] / COLS + dc * STEP
    ty = info["my_r"] / ROWS + dr * STEP
    tx = max(0.05, min(0.95, tx))
    ty = max(0.05, min(0.95, ty))
    return int(tx * screen_w), int(ty * screen_h)


# ══════════════════════════════════════════════════════════════════════════════
# Agent-mode helpers (code fragments the LLM runs via run_python)
# ══════════════════════════════════════════════════════════════════════════════

AGENT_INIT_CODE = f'''
import sys, pathlib
sys.path.insert(0, str(pathlib.Path.cwd()))
from bots.agar_io_bot import BOT_ID, STATE_DIM, ACTION_DIM, LR, GAMMA, ENTROPY_COEF
from bots.agar_io_bot import encode_state, compute_reward
from bots.base_game_bot import PolicyNet, Episode, train_step, save_weights, load_weights
import torch, torch.optim as optim

net = PolicyNet(STATE_DIM, ACTION_DIM)
opt = optim.Adam(net.parameters(), lr=LR)
loaded = load_weights(net, BOT_ID)
print(f"[init] net ready  loaded_weights={{loaded}}  STATE_DIM={{STATE_DIM}}  ACTION_DIM={{ACTION_DIM}}")
'''

AGENT_ACT_CODE = '''
# Called each tick with `grid_str` set in locals
state, info = encode_state(grid_str)
action, log_prob, value = net.act(state)
print(f"action={{action}}  my_sz={{info['my_sz']}}  food={{info['food_pos']}}")
_last_state, _last_info, _last_lp, _last_val = state, info, log_prob, value
'''


# ══════════════════════════════════════════════════════════════════════════════
# Standalone training loop
# ══════════════════════════════════════════════════════════════════════════════

def run_standalone(episodes: int = 200, max_steps: int = 500):
    """Full training loop using pyautogui + mss for real Agar.io play."""
    if not _standalone_available:
        print("ERROR: pyautogui / mss / pillow not installed.", file=sys.stderr)
        print("Run: pip install pyautogui mss pillow numpy", file=sys.stderr)
        sys.exit(1)

    net = PolicyNet(STATE_DIM, ACTION_DIM)
    opt = optim.Adam(net.parameters(), lr=LR)
    loaded = load_weights(net, BOT_ID)
    meta   = load_meta(BOT_ID)
    best_score = meta.get("best_score", 0.0)

    print(f"[{BOT_ID}] loaded={loaded}  best_score={best_score:.1f}")
    print(f"[{BOT_ID}] Training {episodes} episodes × {max_steps} steps")
    print("Press Ctrl-C to stop and save.")

    screen_w, screen_h = pyautogui.size()
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE    = 0.0

    with mss.mss() as sct:
        monitor = sct.monitors[1]  # primary monitor

        for ep in range(1, episodes + 1):
            episode = Episode()
            prev_info = {"my_sz": 1}

            for step in range(max_steps):
                # Observe
                grid_str = _grid_from_screenshot(sct, monitor)
                state, info = encode_state(grid_str)
                alive = info["my_sz"] > 0

                # Act
                action, log_prob, value = net.act(state)
                tx, ty = _action_to_mouse(action, info, screen_w, screen_h)
                pyautogui.moveTo(tx, ty, duration=0.05)

                # Split when large
                if info["my_sz"] >= SPLIT_SIZE_THRESHOLD:
                    pyautogui.press("space")

                # Reward
                reward = compute_reward(prev_info, info, alive)
                episode.push(state, action, reward, log_prob, value)
                prev_info = info

                if not alive:
                    break

                time.sleep(0.05)

            # Train
            stats = train_step(net, opt, episode,
                               gamma=GAMMA, entropy_coef=ENTROPY_COEF)
            score = episode.total_reward
            best_score = max(best_score, score)
            print(f"  ep={ep:4d}  steps={len(episode):4d}  "
                  f"reward={score:7.2f}  best={best_score:7.2f}  "
                  f"loss={stats.get('total_loss', 0):.4f}  "
                  f"entropy={stats.get('entropy', 0):.3f}")

            if ep % SAVE_EVERY == 0:
                save_weights(net, BOT_ID, {
                    "best_score": best_score,
                    "episodes":   ep,
                    "game":       "agar.io",
                })
                print(f"  [saved]  weights/{BOT_ID}_policy.pt")

    # Final save
    save_weights(net, BOT_ID, {
        "best_score": best_score,
        "episodes":   episodes,
        "game":       "agar.io",
    })
    print(f"[{BOT_ID}] Done. best_score={best_score:.2f}")


# ══════════════════════════════════════════════════════════════════════════════
# Evaluation (no gradient updates)
# ══════════════════════════════════════════════════════════════════════════════

def evaluate(episodes: int = 10) -> dict:
    """Run the policy deterministically and return stats."""
    if not _standalone_available:
        return {"error": "pyautogui/mss not installed"}

    net = PolicyNet(STATE_DIM, ACTION_DIM)
    if not load_weights(net, BOT_ID):
        return {"error": f"no weights found for {BOT_ID}"}
    net.eval()

    screen_w, screen_h = pyautogui.size()
    scores = []
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        for ep in range(episodes):
            total_r = 0.0
            prev_info = {"my_sz": 1}
            for _ in range(300):
                grid_str = _grid_from_screenshot(sct, monitor)
                state, info = encode_state(grid_str)
                action, _, _ = net.act(state, deterministic=True)
                tx, ty = _action_to_mouse(action, info, screen_w, screen_h)
                pyautogui.moveTo(tx, ty, duration=0.05)
                reward = compute_reward(prev_info, info, info["my_sz"] > 0)
                total_r += reward
                prev_info = info
                if info["my_sz"] == 0:
                    break
                time.sleep(0.05)
            scores.append(total_r)

    return {
        "episodes":   episodes,
        "mean_score": sum(scores) / len(scores),
        "max_score":  max(scores),
        "min_score":  min(scores),
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agar.io autonomous learning bot")
    parser.add_argument("--mode",     choices=["train", "eval", "info"], default="train")
    parser.add_argument("--episodes", type=int, default=200)
    parser.add_argument("--steps",    type=int, default=500)
    parser.add_argument("--bot-id",   default=BOT_ID)
    args = parser.parse_args()

    BOT_ID = args.bot_id

    if args.mode == "info":
        m = load_meta(BOT_ID)
        print(json.dumps(m, indent=2) if m else f"No metadata for {BOT_ID}")
    elif args.mode == "eval":
        result = evaluate(args.episodes)
        print(json.dumps(result, indent=2))
    else:
        run_standalone(args.episodes, args.steps)

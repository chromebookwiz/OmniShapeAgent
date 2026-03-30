#!/usr/bin/env python3
"""
marathon_bot.py — Autonomous desktop game bot for Marathon / Doom-style FPS games.

Compatible with any first-person desktop game where:
  - WASD controls movement
  - Mouse controls look direction
  - Spacebar / Left-click to fire / interact
  - Score or health indicator is on-screen

Modes
─────
1. Agent mode  (deployed via deploy_bot with a desktop game goal):
   The LLM agent uses vision_tick() + run_python() to drive the PolicyNet.
   Mouse and keyboard tools are called by the LLM directly.

2. Standalone mode  (python bots/marathon_bot.py):
   pyautogui + mss handle input/output directly.
   pip install pyautogui mss pillow numpy

State  (STATE_DIM = 2308)
──────────────────────────
   64×36 palette grid (2304) + meta (4):
     [center_brightness, left_threat, right_threat, health_proxy]

Action Space (ACTION_DIM = 12)
──────────────────────────────
   0: idle
   1: forward (W)
   2: back    (S)
   3: strafe left (A)
   4: strafe right (D)
   5: turn left   (mouse left 50px)
   6: turn right  (mouse right 50px)
   7: turn left fast (100px)
   8: turn right fast (100px)
   9: fire     (left click)
  10: forward + fire
  11: jump / jump-fire (Space)
"""

from __future__ import annotations
import os, sys, json, time, math, argparse, pathlib
from typing import Tuple, Dict, Any

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import torch
import torch.optim as optim

from bots.base_game_bot import (
    PolicyNet, Episode, train_step,
    save_weights, load_weights, load_meta,
    grid_to_tensor, normalize_state, WEIGHTS_DIR,
)

# ── Bot config ─────────────────────────────────────────────────────────────────
BOT_ID      = os.environ.get("BOT_ID", "marathonBot")
COLS, ROWS  = 64, 36
STATE_DIM   = COLS * ROWS + 4
ACTION_DIM  = 12
LR          = float(os.environ.get("LR", "2e-4"))
GAMMA       = 0.99
ENTROPY_COEF = 0.015
SAVE_EVERY  = 20
MOUSE_STEP  = 50    # pixels per turn action

# ── Color heuristics for a generic dark/FPS game ──────────────────────────────
# These indices correspond to the 64×36 grid characters
# "Dark" pixels (background): ASCII 0–3 → codes "0","1","2","3"
# "Light" pixels (walls/explosions/HUD): 8–f
# "Red" channel dominant (enemy/blood): 4,5 area
# These are broad heuristics — the network learns the actual semantics.

def encode_state(grid_str: str) -> Tuple[torch.Tensor, dict]:
    """
    Encode grid + 4 meta features derived from the palette.

    Meta features:
      center_brightness: mean brightness in center 16×9 region (threat/action area)
      left_threat:       fraction of red-ish codes in left third
      right_threat:      fraction of red-ish codes in right third
      health_proxy:      fraction of green codes in bottom HUD strip (health bar)
    """
    lines = (grid_str or "").split("|")
    grid_t = normalize_state(grid_to_tensor(grid_str, COLS, ROWS))

    # Center 16×9 patch (col 24–40, row 14–22)
    center_vals = []
    for r in range(14, 23):
        line = lines[r] if r < len(lines) else ""
        for c in range(24, 41):
            ch = line[c] if c < len(line) else "0"
            center_vals.append(ord(ch) / 255.0)
    center_brightness = sum(center_vals) / max(len(center_vals), 1)

    # Threat detection: count red-ish chars (codes "2","r","R","4","5") in left/right thirds
    def _threat(col_start: int, col_end: int) -> float:
        RED = {"2", "r", "R", "4", "5"}
        total = 0
        for r in range(ROWS):
            line = lines[r] if r < len(lines) else ""
            for c in range(col_start, col_end):
                ch = line[c] if c < len(line) else "0"
                total += ch in RED
        area = (col_end - col_start) * ROWS
        return total / max(area, 1)

    left_threat  = _threat(0,  COLS // 3)
    right_threat = _threat(2 * COLS // 3, COLS)

    # Health proxy: green codes in bottom 3 rows (HUD strip)
    GREEN = {"3", "g", "G"}
    hud_green = 0
    for r in range(ROWS - 3, ROWS):
        line = lines[r] if r < len(lines) else ""
        for ch in line:
            hud_green += ch in GREEN
    health_proxy = hud_green / max((COLS * 3), 1)

    meta = torch.tensor([
        center_brightness,
        left_threat,
        right_threat,
        health_proxy,
    ], dtype=torch.float32)

    state = torch.cat([grid_t, meta])
    info  = {
        "center_brightness": center_brightness,
        "left_threat":       left_threat,
        "right_threat":      right_threat,
        "health_proxy":      health_proxy,
    }
    return state, info


def compute_reward(prev_info: dict, curr_info: dict, alive: bool) -> float:
    """
    Reward shaped from:
      -death penalty
      +survival bonus (small per step)
      -being threatened (threats on either side)
      +health maintained
    """
    if not alive:
        return -10.0

    threat_penalty  = -(curr_info["left_threat"] + curr_info["right_threat"]) * 0.5
    health_reward   = (curr_info["health_proxy"] - prev_info.get("health_proxy", 0)) * 2.0
    survival_bonus  = 0.02
    action_reward   = curr_info.get("center_brightness", 0) * 0.1  # reward facing lit areas

    return threat_penalty + health_reward + survival_bonus + action_reward


# ── Action execution (standalone) ─────────────────────────────────────────────

_standalone_available = False
try:
    import pyautogui   # type: ignore
    import mss         # type: ignore
    from PIL import Image
    _standalone_available = True
except ImportError:
    pass


def _get_mouse_center() -> Tuple[int, int]:
    w, h = pyautogui.size()
    return w // 2, h // 2

def execute_action(action: int):
    """
    Execute a discrete action via pyautogui.
    The game window must be focused before calling this.
    """
    cx, cy = _get_mouse_center()

    # Press+release mapping (WASD)
    KEY_MAP = {
        1: "w", 2: "s", 3: "a", 4: "d", 11: "space",
    }
    if action in KEY_MAP:
        pyautogui.keyDown(KEY_MAP[action])
        time.sleep(0.08)
        pyautogui.keyUp(KEY_MAP[action])
    elif action == 5:
        pyautogui.move(-MOUSE_STEP, 0, duration=0.04)
    elif action == 6:
        pyautogui.move(MOUSE_STEP, 0, duration=0.04)
    elif action == 7:
        pyautogui.move(-MOUSE_STEP * 2, 0, duration=0.04)
    elif action == 8:
        pyautogui.move(MOUSE_STEP * 2, 0, duration=0.04)
    elif action == 9:
        pyautogui.click()
    elif action == 10:
        pyautogui.keyDown("w")
        pyautogui.click()
        pyautogui.keyUp("w")
    # action == 0: idle — do nothing


def _screenshot_to_grid(sct, monitor) -> str:
    """Capture screenshot and convert to palette grid string."""
    img = Image.frombytes(
        "RGB", (monitor["width"], monitor["height"]),
        sct.grab(monitor).rgb
    )
    img = img.resize((COLS, ROWS), Image.BILINEAR)
    pix = list(img.getdata())
    rows_out = []
    for r in range(ROWS):
        row_chars = ""
        for c in range(COLS):
            R, G, B = pix[r * COLS + c]
            brightness = (R + G + B) // 3
            if R > 160 and R > G * 1.4 and R > B * 1.4:
                ch = "R"   # enemy/blood
            elif G > 160 and G > R * 1.4:
                ch = "G"   # health/safe area
            elif brightness > 200:
                ch = "f"   # bright (explosion/light)
            elif brightness > 100:
                ch = chr(ord("5") + brightness // 50)
            elif brightness > 30:
                ch = "3"
            else:
                ch = "0"   # dark/void
            row_chars += ch
        rows_out.append(row_chars)
    return "|".join(rows_out)


# ── Main training loop ─────────────────────────────────────────────────────────

def run_standalone(episodes: int = 150, max_steps: int = 400):
    if not _standalone_available:
        print("ERROR: install pyautogui mss pillow numpy", file=sys.stderr)
        sys.exit(1)

    net = PolicyNet(STATE_DIM, ACTION_DIM)
    opt = optim.Adam(net.parameters(), lr=LR)
    loaded  = load_weights(net, BOT_ID)
    meta    = load_meta(BOT_ID)
    best    = meta.get("best_score", 0.0)
    total_episodes = meta.get("episodes", 0)

    print(f"[{BOT_ID}] loaded={loaded}  episodes_so_far={total_episodes}  best={best:.1f}")
    print("Ensure the game window is focused before training starts.")
    print("Press Ctrl-C to stop and save at any time.\n")

    screen_w, screen_h = pyautogui.size()
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE    = 0.0

    with mss.mss() as sct:
        monitor = sct.monitors[1]

        for ep in range(1, episodes + 1):
            episode   = Episode()
            prev_info = {"health_proxy": 0.5}

            for step in range(max_steps):
                grid_str      = _screenshot_to_grid(sct, monitor)
                state, info   = encode_state(grid_str)
                health = info["health_proxy"]
                alive  = health > 0.05    # heuristic: if no green in HUD → dead

                action, lp, val = net.act(state)
                execute_action(action)
                time.sleep(0.04)

                reward = compute_reward(prev_info, info, alive)
                episode.push(state, action, reward, lp, val)
                prev_info = info

                if not alive:
                    break

            stats = train_step(net, opt, episode,
                               gamma=GAMMA, entropy_coef=ENTROPY_COEF)
            score = episode.total_reward
            best  = max(best, score)
            total_episodes += 1

            print(f"  ep={total_episodes:4d}  steps={len(episode):4d}  "
                  f"reward={score:8.2f}  best={best:8.2f}  "
                  f"loss={stats.get('total_loss', 0):.4f}")

            if ep % SAVE_EVERY == 0:
                save_weights(net, BOT_ID, {
                    "best_score": best,
                    "episodes":   total_episodes,
                    "game":       "marathon/fps",
                })
                print(f"  [saved]  weights/{BOT_ID}_policy.pt")

    save_weights(net, BOT_ID, {
        "best_score": best,
        "episodes":   total_episodes,
        "game":       "marathon/fps",
    })
    print(f"[{BOT_ID}] Done. best={best:.2f}")


def evaluate(episodes: int = 5) -> dict:
    if not _standalone_available:
        return {"error": "pyautogui/mss not installed"}
    net = PolicyNet(STATE_DIM, ACTION_DIM)
    if not load_weights(net, BOT_ID):
        return {"error": f"no weights for {BOT_ID}"}
    net.eval()

    scores = []
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        for ep in range(episodes):
            total_r   = 0.0
            prev_info = {"health_proxy": 0.5}
            for _ in range(300):
                grid_str = _screenshot_to_grid(sct, monitor)
                state, info = encode_state(grid_str)
                action, _, _ = net.act(state, deterministic=True)
                execute_action(action)
                reward  = compute_reward(prev_info, info, info["health_proxy"] > 0.05)
                total_r += reward
                prev_info = info
                time.sleep(0.04)
                if info["health_proxy"] <= 0.05:
                    break
            scores.append(total_r)

    return {
        "episodes":   episodes,
        "mean_score": sum(scores) / len(scores),
        "max_score":  max(scores),
        "min_score":  min(scores),
    }


# ── Agent-mode code fragments ──────────────────────────────────────────────────

AGENT_INIT_CODE = f'''
import sys, pathlib
sys.path.insert(0, str(pathlib.Path.cwd()))
from bots.marathon_bot import BOT_ID, STATE_DIM, ACTION_DIM, LR, GAMMA, encode_state
from bots.base_game_bot import PolicyNet, Episode, train_step, save_weights, load_weights
import torch, torch.optim as optim

net = PolicyNet({STATE_DIM}, {ACTION_DIM})
opt = optim.Adam(net.parameters(), lr={LR})
loaded = load_weights(net, BOT_ID)
print(f"[marathon_init] net ready  loaded={{loaded}}")
'''

AGENT_ACT_CODE = '''
# Call with grid_str set in local scope
state, info = encode_state(grid_str)
action, log_prob, value = net.act(state)
ACTION_NAMES = ["idle","forward","back","strafe_l","strafe_r",
                "turn_l","turn_r","turn_ll","turn_rr","fire","fwd_fire","jump"]
print(f"action={action} ({ACTION_NAMES[action]})  threat_L={info['left_threat']:.2f}  threat_R={info['right_threat']:.2f}")
_last = dict(state=state, info=info, lp=log_prob, val=value, action=action)
'''


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Marathon/FPS autonomous learning bot")
    parser.add_argument("--mode",     choices=["train", "eval", "info"], default="train")
    parser.add_argument("--episodes", type=int, default=150)
    parser.add_argument("--steps",    type=int, default=400)
    parser.add_argument("--bot-id",   default=BOT_ID)
    args = parser.parse_args()

    BOT_ID = args.bot_id

    if args.mode == "info":
        m = load_meta(BOT_ID)
        print(json.dumps(m, indent=2) if m else f"No metadata for {BOT_ID}")
    elif args.mode == "eval":
        print(json.dumps(evaluate(args.episodes), indent=2))
    else:
        run_standalone(args.episodes, args.steps)

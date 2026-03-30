# ML Bot Training — ARMS Architecture

## Overview

ARMS (Autonomous Robot/ML Sub-agent System) lets you create, train, store, and
evaluate PyTorch PolicyNet bots that learn to play browser or desktop games using
only pixel vision, mouse, and keyboard.

---

## Architecture

### PolicyNet (Actor-Critic)

```
Input: 64×36 palette grid (2304 floats) + 4 meta features = STATE_DIM
                       ↓
  Trunk: Linear(STATE_DIM→512)→LayerNorm→GELU
         Linear(512→256)→LayerNorm→GELU
         Linear(256→128)→LayerNorm→GELU
                       ↓
    ┌──────────────────┴────────────────────┐
    │                                       │
Policy head: Linear(128→ACTION_DIM)    Value head: Linear(128→1)
    │                                       │
  logits                              V(s) estimate
```

Training algorithm: **REINFORCE with baseline** (Actor-Critic)
- Policy loss:  `-(log_prob × advantage).mean()`
- Value loss:   `MSE(V(s), G_t)`
- Entropy bonus: `-entropy.mean()` (encourages exploration)
- Gradient clipping: `max_norm=0.5`

---

## Quick Start

### 1. Initialize and train a new bot

```tool
{ "name": "deploy_bot", "args": {
    "url": "https://agar.io",
    "goal": "maximize mass by eating food and avoiding enemies",
    "botId": "agarChampion"
  }
}
```

The bot will:
1. Open the URL in the browser
2. Initialize a PolicyNet from scratch (or load existing weights)
3. Run `vision_tick()` each step to observe the screen
4. Sample an action from the policy
5. Execute mouse/keyboard actions
6. Update the policy via REINFORCE every episode

---

### 2. Train via run_python (direct ML training)

```tool
{ "name": "run_python", "args": { "code": "
import sys; sys.path.insert(0, '.')
from bots.bot_trainer import train_simulated
result = train_simulated(bot_id='myBot', episodes=100)
print(result)
" } }
```

---

### 3. Check training status

```tool
{ "name": "leaderboard", "args": {} }
```

---

### 4. Train a specific bot against a real game

```tool
{ "name": "train_bot", "args": {
    "botId": "agarChampion",
    "episodes": 50,
    "config": { "state_dim": 2308, "action_dim": 9, "lr": 0.0003, "gamma": 0.99 }
  }
}
```

---

### 5. Test a bot's policy (no weight updates)

```tool
{ "name": "test_bot", "args": { "botId": "agarChampion", "episodes": 10 } }
```

---

### 6. Improve a bot with Actor-Critic + entropy tuning

```tool
{ "name": "improve_bot", "args": {
    "botId": "agarChampion",
    "episodes": 30,
    "config": { "lr": 0.0001, "entropy_coef": 0.02 }
  }
}
```

---

## Game-Specific Bots

### Agar.io (browser)

**File:** `bots/agar_io_bot.py`

State features:
- 64×36 palette grid (color-coded: green=food, red=enemy, white=my cell)
- meta: `[my_col/64, my_row/36, my_size/16, nearest_food_dist]`

Action space (9):
| idx | action |
|-----|--------|
| 0   | idle   |
| 1–8 | compass directions (N, NE, E, SE, S, SW, W, NW) |

Auto-split: triggered when `my_size >= 8` (spacebar press)

Reward shaping:
- `+size_gain × 0.5` — growing scores positively
- `-0.01` per step — survival cost keeps the bot active
- `-5.0` on death

Deploy command:
```tool
{ "name": "deploy_bot", "args": {
    "url": "https://agar.io",
    "goal": "maximize mass by eating green food, avoid red enemies, split when large",
    "botId": "agarBot01"
  }
}
```

---

### Marathon / Doom-style FPS (desktop)

**File:** `bots/marathon_bot.py`

State features:
- 64×36 palette grid (dark=background, red=enemy/blood, green=health/safe)
- meta: `[center_brightness, left_threat, right_threat, health_proxy]`

Action space (12):
| idx | action |
|-----|--------|
| 0   | idle |
| 1   | forward (W) |
| 2   | back (S) |
| 3   | strafe left (A) |
| 4   | strafe right (D) |
| 5   | turn left (mouse −50px) |
| 6   | turn right (mouse +50px) |
| 7   | turn left fast (−100px) |
| 8   | turn right fast (+100px) |
| 9   | fire (click) |
| 10  | forward + fire |
| 11  | jump (Space) |

Reward shaping:
- `−10.0` on death (health_proxy < 0.05)
- `−threat × 0.5` — penalty for being in danger
- `+health_delta × 2.0` — reward for healing
- `+0.02` per step — survival bonus
- `+center_brightness × 0.1` — reward for facing lit areas

Deploy command (point at your game's window):
```tool
{ "name": "deploy_bot", "args": {
    "url": "desktop://marathon",
    "goal": "survive and progress through levels, eliminate enemies, collect items",
    "botId": "marathonBot01"
  }
}
```

---

## Weight Management

Weights are stored in `weights/<botId>_policy.pt` alongside a metadata JSON.

### Register existing weights manually

```tool
{ "name": "register_weights", "args": {
    "botId":     "agarChampion",
    "filePath":  "weights/agarChampion_policy.pt",
    "score":     142.5,
    "component": "policy"
  }
}
```

### Load best available weights (transfer learning)

```tool
{ "name": "get_best_weights", "args": { "component": "policy" } }
```

Transfer learning snippet:
```python
# Load top-performing weights into a new bot's net
import torch
from bots.base_game_bot import PolicyNet, load_weights
net = PolicyNet(2308, 9)
# Try loading champion weights; fall back to random init
for donor_id in ["agarChampion", "agarBot01", "simBot"]:
    if load_weights(net, donor_id):
        print(f"Transferred weights from {donor_id}")
        break
```

---

## Hall of Fame Enrollment

When a bot achieves a milestone score, enroll it:

```tool
{ "name": "hof_enroll", "args": {
    "botId":    "agarChampion",
    "score":    284.5,
    "hallmark": "First bot to sustain mass > 100 for 60 consecutive seconds"
  }
}
```

Query strategies from champions:
```tool
{ "name": "hof_strategies", "args": { "goal": "maximize mass" } }
```

---

## Standalone Training (no agent)

```bash
# Agar.io — requires pyautogui mss pillow (game window must be focused)
python bots/agar_io_bot.py --episodes 200 --steps 500

# Marathon/FPS — same requirements
python bots/marathon_bot.py --mode train --episodes 150

# Simulated environment (no screen needed, for testing the training loop)
python bots/bot_trainer.py --bot simulated --episodes 100

# Leaderboard
python bots/bot_trainer.py --leaderboard

# Hyperparameter sweep (simulated)
python bots/bot_trainer.py --sweep

# Self-test neural network
python bots/base_game_bot.py
```

---

## Tips

- **Always call `ensure_torch` before training** — confirms torch is in the venv.
- **Use `vision_tick` with a tuned palette** — `tune_palette(imagePath, 16, "gameName_palette")` maps game-specific colors precisely.
- **Transfer learning accelerates training** — load from any existing champion before running `train_bot`.
- **Entropy bonus prevents premature convergence** — keep `entropy_coef` ≥ 0.01 early in training.
- **Parallel bots explore faster** — deploy 2–3 bots with different random seeds, then promote the best to HOF.
- **Increase `cols/rows` for richer state** — 128×72 gives 4× more detail at the cost of a larger network and slower inference.

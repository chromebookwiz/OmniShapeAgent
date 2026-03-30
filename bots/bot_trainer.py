#!/usr/bin/env python3
"""
bot_trainer.py — Standalone training orchestrator for ShapeAgent bots.

Usage
─────
  # Train agar bot for 200 episodes
  python bots/bot_trainer.py --bot agar --episodes 200

  # Train marathon bot from existing weights
  python bots/bot_trainer.py --bot marathon --episodes 100 --resume

  # Evaluate agar bot
  python bots/bot_trainer.py --bot agar --mode eval --episodes 10

  # Show leaderboard of all saved weight files
  python bots/bot_trainer.py --leaderboard

  # Run the base_game_bot self-test
  python bots/bot_trainer.py --self-test

This script is also designed to be called via the agent's run_python tool:
  run_python("import subprocess; subprocess.run(['python', 'bots/bot_trainer.py', '--leaderboard'])")
"""

from __future__ import annotations
import os, sys, json, time, argparse, pathlib
from typing import Dict, Any, List

_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

WEIGHTS_DIR = _ROOT / "weights"


# ── Leaderboard ────────────────────────────────────────────────────────────────

def load_all_meta() -> List[Dict[str, Any]]:
    """Scan weights/*.json and return sorted leaderboard."""
    entries = []
    for p in WEIGHTS_DIR.glob("*_policy_meta.json"):
        try:
            data = json.loads(p.read_text())
            data["_weight_file"] = str(p.with_suffix(".pt").name)
            data["_meta_file"]   = str(p.name)
            entries.append(data)
        except Exception:
            pass
    entries.sort(key=lambda x: x.get("best_score", 0.0), reverse=True)
    return entries


def print_leaderboard():
    entries = load_all_meta()
    if not entries:
        print("No trained bots found in weights/")
        return

    print(f"\n{'Rank':<5} {'Bot ID':<20} {'Game':<18} {'Best Score':>12} {'Episodes':>10} {'Saved At'}")
    print("─" * 80)
    for rank, e in enumerate(entries, 1):
        print(
            f"{rank:<5} "
            f"{e.get('bot_id','?'):<20} "
            f"{e.get('game','?'):<18} "
            f"{e.get('best_score', 0):>12.2f} "
            f"{e.get('episodes', 0):>10} "
            f"{e.get('saved_at','?')}"
        )
    print()


# ── Quick simulation trainer (no screen required) ─────────────────────────────

def train_simulated(
    bot_id:     str   = "simBot",
    game:       str   = "simulated",
    state_dim:  int   = 2308,
    action_dim: int   = 9,
    episodes:   int   = 50,
    max_steps:  int   = 100,
    lr:         float = 3e-4,
    gamma:      float = 0.99,
    resume:     bool  = False,
) -> Dict[str, Any]:
    """
    Train a PolicyNet against a synthetic random-walk environment.
    Useful for sanity-checking the training loop without a screen.
    """
    import torch
    import torch.optim as optim
    from bots.base_game_bot import (
        PolicyNet, Episode, train_step, save_weights, load_weights, load_meta,
    )

    net  = PolicyNet(state_dim, action_dim)
    opt  = optim.Adam(net.parameters(), lr=lr)
    meta = {}

    if resume:
        loaded = load_weights(net, bot_id)
        meta   = load_meta(bot_id)
        print(f"[{bot_id}] resume={loaded}  prior_best={meta.get('best_score', 0):.2f}")

    best_score = meta.get("best_score", float("-inf"))
    history    = []

    for ep in range(1, episodes + 1):
        episode = Episode()
        state   = torch.randn(state_dim).clamp(-1, 1) * 0.5 + 0.5   # synthetic state

        for step in range(max_steps):
            action, lp, val = net.act(state)
            # Synthetic reward: moving toward center of action space scores better
            reward = 1.0 - abs(action - action_dim // 2) / (action_dim // 2)
            reward += 0.1 * (0.5 - abs(state.mean().item() - 0.5))   # state quality bonus
            episode.push(state, action, reward, lp, val)
            # Next state: random walk
            state = (state + torch.randn(state_dim) * 0.1).clamp(0, 1)

        stats = train_step(net, opt, episode, gamma=gamma)
        score = episode.total_reward
        best_score = max(best_score, score)
        history.append({
            "ep":           ep,
            "score":        round(score, 3),
            "total_loss":   round(stats.get("total_loss", 0), 4),
            "entropy":      round(stats.get("entropy", 0), 4),
        })

        if ep % 10 == 0:
            print(f"  ep={ep:4d}  score={score:8.3f}  best={best_score:8.3f}  "
                  f"loss={stats.get('total_loss',0):.4f}")

    save_weights(net, bot_id, {
        "best_score": best_score,
        "episodes":   episodes + meta.get("episodes", 0),
        "game":       game,
    })

    return {
        "bot_id":     bot_id,
        "best_score": best_score,
        "episodes":   episodes,
        "final_loss": history[-1]["total_loss"] if history else None,
        "weight_file": f"weights/{bot_id}_policy.pt",
    }


# ── Experiment runner ──────────────────────────────────────────────────────────

def run_hyperparameter_sweep(
    bot_id_prefix: str = "sweep",
    state_dim:     int = 2308,
    action_dim:    int = 9,
    episodes:      int = 30,
):
    """Run a small grid search over learning rate and entropy coefficient."""
    import itertools

    lrs      = [1e-3, 3e-4, 1e-4]
    entropies = [0.005, 0.01, 0.02]
    results  = []

    for lr, ent in itertools.product(lrs, entropies):
        bid = f"{bot_id_prefix}_lr{lr:.0e}_ent{ent:.3f}".replace("-", "n")
        print(f"\n[sweep] bot_id={bid}  lr={lr}  entropy_coef={ent}")
        result = train_simulated(
            bot_id=bid,
            state_dim=state_dim,
            action_dim=action_dim,
            episodes=episodes,
            lr=lr,
        )
        result["lr"]           = lr
        result["entropy_coef"] = ent
        results.append(result)

    results.sort(key=lambda x: x["best_score"], reverse=True)
    print("\n=== Sweep Results ===")
    for r in results:
        print(f"  lr={r['lr']:.0e}  ent={r['entropy_coef']:.3f}  "
              f"best={r['best_score']:.3f}  bot_id={r['bot_id']}")

    return results


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ShapeAgent bot training orchestrator")
    parser.add_argument("--bot",        choices=["agar", "marathon", "simulated"], default="simulated")
    parser.add_argument("--mode",       choices=["train", "eval", "info"], default="train")
    parser.add_argument("--episodes",   type=int, default=50)
    parser.add_argument("--steps",      type=int, default=300)
    parser.add_argument("--bot-id",     default=None, help="Override default bot ID")
    parser.add_argument("--resume",     action="store_true")
    parser.add_argument("--leaderboard", action="store_true")
    parser.add_argument("--sweep",      action="store_true", help="Hyperparameter sweep (simulated)")
    parser.add_argument("--self-test",  action="store_true")
    args = parser.parse_args()

    if args.self_test:
        # Run base_game_bot self-test
        from bots import base_game_bot  # triggers __main__ block implicitly
        os.execv(sys.executable, [sys.executable, str(_ROOT / "bots" / "base_game_bot.py")])

    if args.leaderboard:
        print_leaderboard()
        sys.exit(0)

    if args.sweep:
        run_hyperparameter_sweep()
        sys.exit(0)

    # ── Route to specific bot ──────────────────────────────────────────────────
    if args.bot == "agar":
        from bots.agar_io_bot import run_standalone as _train, evaluate as _eval, BOT_ID
        bot_id = args.bot_id or BOT_ID
        if args.mode == "train":
            _train(args.episodes, args.steps)
        elif args.mode == "eval":
            print(json.dumps(_eval(args.episodes), indent=2))

    elif args.bot == "marathon":
        from bots.marathon_bot import run_standalone as _train, evaluate as _eval, BOT_ID
        bot_id = args.bot_id or BOT_ID
        if args.mode == "train":
            _train(args.episodes, args.steps)
        elif args.mode == "eval":
            print(json.dumps(_eval(args.episodes), indent=2))

    else:  # simulated
        bot_id = args.bot_id or "simBot"
        if args.mode == "train":
            result = train_simulated(
                bot_id=bot_id,
                episodes=args.episodes,
                max_steps=args.steps,
                resume=args.resume,
            )
            print(json.dumps(result, indent=2))
        elif args.mode == "info":
            from bots.base_game_bot import WEIGHTS_DIR
            import json as _json
            mp = WEIGHTS_DIR / f"{bot_id}_policy_meta.json"
            print(_json.dumps(_json.loads(mp.read_text()), indent=2) if mp.exists()
                  else f"No metadata for {bot_id}")

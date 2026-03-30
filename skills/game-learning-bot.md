# Game Learning Bot

## Purpose
Create an autonomous agent that learns to play a new game by observing the screen, reasoning about the visual state, and taking actions. The bot will use the pixel‑vision loop, memory store, and optional vision model for semantic understanding.

## Core Loop (pseudocode)
```python
while True:
    # 1️⃣ Capture current screen as a grid (64×36 default palette)
    frame = vision_tick(cols=64, rows=36, paletteName="game")
    grid = frame.grid.split("|")

    # 2️⃣ Optional high‑level description (requires VISION_MODEL)
    # description = describe_screen("Summarize the current game state")

    # 3️⃣ Retrieve similar past experiences from memory
    similar = memory_search("game state similar to current", topK=3)

    # 4️⃣ Decide action based on simple heuristics (e.g., move toward green cells)
    action = decide_action(grid, similar)
    perform_action(action)

    # 5️⃣ Wait for screen change to confirm action effect
    wait_for_change({"timeout_ms": 1500, "threshold": 0.01})

    # 6️⃣ Capture new state and compute delta
    new_frame = vision_tick(cols=64, rows=36, paletteName="game")
    diff = grid_diff(frame.grid, new_frame.grid)

    # 7️⃣ Store experience
    memory_store(
        f"action={action} diff={diff} similar={len(similar)}",
        importance=0.9,
        tags=["game", "learning"]
    )
```

## Helper Functions (to be implemented in the bot runtime)
- `decide_action(grid, similar)`: simple rule‑based policy (e.g., find nearest green `3` cell, click it). Can be replaced by a learned model later.
- `perform_action(action)`: translates high‑level action to mouse/keyboard commands using the `mouse_*` and `keyboard_*` tools.
- `wait_for_change(params)`: wrapper around the screen monitor utilities.

## Deployment
When deploying, a URL that runs the above loop inside a sandboxed environment. The bot should periodically report its status via `update_bot_metric(botId, metric)`.

## Extensibility
- Swap `vision_tick` for a full vision model (`describe_screen`) to get richer semantics.
- Add reinforcement‑learning updates to improve the policy.
- Store high‑level visual descriptions in the knowledge graph for reasoning.

---
*This skill file documents the design of an autonomous game‑learning bot.*
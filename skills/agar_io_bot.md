# Agar.io Bot (Free‑For‑All)

## Goal
Grow the player’s mass by eating green food and using **splits** (Space) or **ejects** (W) strategically to capture food or escape larger enemies (red/blue).

## Core Loop (pseudocode)
```python
while True:
    # 1️⃣ Capture low‑resolution grid (64×36) with the custom palette
    frame = vision_tick(cols=64, rows=36, paletteName="agar_io_palette")
    grid = frame.grid.split("|")

    # 2️⃣ Identify our own cell (largest orange/white blob – colour codes 5 or 1)
    my_c, my_r, my_size = locate_my_blob(grid)
    if my_size == 0:
        # not found – probably dead, wait and retry
        time.sleep(0.5)
        continue

    # 3️⃣ Find nearest food (green = "3")
    food_pos = nearest_color(grid, "3")

    # 4️⃣ Detect threatening enemies (red = "2" or blue = "4") that are larger than us
    threat = nearest_larger_enemy(grid, my_size)

    # 5️⃣ Decision logic
    if threat and distance((my_c, my_r), threat.pos) < 4:
        # Escape: split if we are big enough, otherwise move away
        if my_size >= 8:
            keyboard_press("space")   # split
        else:
            move_away((my_c, my_r), threat.pos)
    elif food_pos:
        # Move toward food; if a cluster is big, split to grab quickly
        if cluster_size(grid, food_pos) >= 3 and my_size >= 10:
            keyboard_press("space")
        else:
            move_toward((my_c, my_r), food_pos)
    else:
        # No obvious target – wander a bit
        random_wander()

    # 6️⃣ Wait for visual change to confirm the action took effect
    wait_for_change({"timeout_ms": 1200, "threshold": 0.01})

    # 7️⃣ Store experience for later analysis
    memory_store(
        f"action={last_action} mySize={my_size} threat={bool(threat)}",
        importance=0.9,
        tags=["agar.io", "learning", "gameplay"]
    )
```

## Helper Functions (to be implemented in the runtime script)
- `locate_my_blob(grid) → (col, row, size)`: flood‑fill the orange/white region (colour codes 5 or 1).
- `nearest_color(grid, code) → (col, row)`: returns the closest cell with the given colour code.
- `nearest_larger_enemy(grid, mySize) → {pos, size}`: finds the nearest enemy whose size > `mySize` (red = 2, blue = 4).
- `cluster_size(grid, pos) → int`: counts contiguous food cells around `pos`.
- `move_toward(myPos, target)`, `move_away(myPos, threat)`, `random_wander()`: translate grid coordinates to screen pixels and issue `mouse_move` / `mouse_click`.
- `last_action` is a string set by the decision block (e.g., "move_food", "split", "escape").

## Extensibility
- Swap the rule‑based policy for an LLM‑driven planner (`describe_screen`).
- Add reinforcement‑learning updates via `update_bot_metric`.
- Persist high‑level descriptions in the knowledge graph for cross‑match analysis.

---
*This skill file documents the design of the autonomous Agar.io learning bot.*
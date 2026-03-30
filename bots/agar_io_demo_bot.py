#!/usr/bin/env python3
"""Demo bot – clicks green cells (palette code "3") using pixel‑vision.
Runs a short fixed number of steps and stores each action in memory.
"""
import json, time

# ----------------------------------------------------------------------
# ShapeAgent‑provided globals (available when run via run_python):
#   vision_tick(cols, rows, paletteName, threshold) -> dict
#   vision_watch(threshold, timeout_ms, fps) -> dict
#   vision_reset()
#   mouse_move(x, y, duration=0.2)
#   mouse_click(x, y, button="left", clicks=1)
#   memory_store(content, importance, tags)
# ----------------------------------------------------------------------

COLS = 64               # grid width – must match the demo HTML
ROWS = 36               # grid height
PALETTE = "game"       # palette where "3" = green (food)
MAX_STEPS = 10          # demo length – adjust as you like
THRESH = 0.015          # screen‑change detection threshold

def screen_size():
    """Return screen width/height via a tiny Python one‑liner."""
    cmd = (
        "python - <<'PY'\n"
        "import json, tkinter as tk;root=tk.Tk();"
        "print(json.dumps({'w':root.winfo_screenwidth(),'h':root.winfo_screenheight()}))\n"
        "PY"
    )
    out = json.loads(run_terminal_command(cmd))
    return out["w"], out["h"]

def grid_to_screen(col, row, scr_w, scr_h):
    """Convert grid coordinates to absolute screen pixels."""
    x = (col + 0.5) * (scr_w / COLS)
    y = (row + 0.5) * (scr_h / ROWS)
    return x, y

def find_green(grid):
    """Return (col,row) of the first green cell ('3') or None."""
    rows = grid.split("|")
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch == "3":
                return c, r
    return None

def main():
    vision_reset()
    scr_w, scr_h = screen_size()

    for step in range(MAX_STEPS):
        # 1️⃣ Capture current grid
        frame = vision_tick(COLS, ROWS, PALETTE, THRESH)
        grid = frame.get("grid", "")
        if not grid:
            print("[demo] No grid captured – abort.")
            break

        # 2️⃣ Locate a green cell
        pos = find_green(grid)
        if not pos:
            # No food – wait a bit and retry
            vision_watch(THRESH, 1500, 10)
            continue
        col, row = pos
        x, y = grid_to_screen(col, row, scr_w, scr_h)

        # 3️⃣ Click the cell
        mouse_move(x, y, duration=0.1)
        mouse_click(x, y)

        # 4️⃣ Wait for screen to react
        changed = vision_watch(THRESH, 2000, 15)

        # 5️⃣ Store the experience in memory
        mem = f"Step {step}: clicked green at ({col},{row}) → delta {changed.get('delta',0):.4f}"
        memory_store(mem, 0.9, ["demo", "agar_demo", "step"])

        time.sleep(0.3)  # brief pause before next iteration

    print("[demo] Finished – executed steps:", step + 1)

if __name__ == "__main__":
    main()

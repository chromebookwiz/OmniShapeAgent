# Skill: Learning to Play Agar.io

## What is Agar.io?

Agar.io is a browser-based multiplayer game at https://agar.io. You control a circular cell. The rules:
- **Eat**: Move over food pellets (small colored dots) or smaller cells to grow.
- **Survive**: Avoid cells larger than you — they eat you.
- **Split**: Press Space to split your cell in two (can be used to eat faster or escape).
- **Eject mass**: Press W to eject a small mass pellet (used to feed viruses or allies).
- **Viruses**: Green spiked circles — small cells can hide behind them; large cells explode on contact.
- **Goal**: Become the largest cell on the server.

## Controls

| Action | Input |
|--------|-------|
| Move | Mouse position (cell follows cursor) |
| Split | Space bar |
| Eject mass | W key |
| Enter name | Type before clicking Play |

The cell always moves toward the mouse cursor. Speed decreases as cell size increases.

## Setup Sequence

```tool
{ "name": "open_url", "args": { "url": "https://agar.io" } }
```
Wait 3 seconds for the page to load, then:
```tool
{ "name": "screenshot", "args": {} }
```
Analyze the screenshot to find the Play button. Click it to start, or type a name first.

## Reading the Game State with Pixel Vision

Use `screen_to_grid` to read the game without a vision model. Agar.io has a distinctive color palette:

### Color Meanings in Agar.io Grid

| Grid color | Hex | Meaning |
|------------|-----|---------|
| `0` (black) | #000 | Background / empty space |
| `3` (green) | bright | Virus (spiked) — danger for large cells |
| `5` (yellow) | bright | Food pellets — eat these |
| `1` (white) | any | Your cell halo / UI elements |
| `A` (light gray) | any | Other cells / leaderboard UI |
| `2` (red) | bright | Large enemy cell — AVOID |
| `4` (blue) | bright | Smaller enemy cell — CAN EAT |
| Various | mixed | Other player cells |

Your own cell will be whatever color you chose at start. Track its position across frames.

### Finding Your Cell

After the first `screen_to_grid`, search for a cluster of same-color cells in the center region (rows 15–20, cols 28–36 in a 64×36 grid — the center of screen). That cluster is likely you.

```
grid = screen_to_grid(cols=64, rows=36)
# Look at rows 12-24, cols 20-44 — center of screen
# Your cell is the largest solid-color cluster in that region
# Food dots appear as isolated '5' (yellow) characters
# Viruses appear as clusters of '3' (green)
```

## State Vector for Learning

Store game states as vectors:
```tool
{ "name": "screen_to_color_vector", "args": { "cols": 32, "rows": 18 } }
```
Then store with memory:
```tool
{ "name": "memory_store", "args": {
  "content": "game_state: [vector], action: move_right, result: ate_food, score_delta: +5",
  "importance": 0.8,
  "tags": ["agar", "game", "state"]
}}
```

## Full Autonomous Learning Loop

```
// SETUP
open_url("https://agar.io")
wait_ms(3000)
screenshot() → analyze to find Play button
mouse_click(play_x, play_y)
wait_ms(1000)
start_screen_monitor({fps: 15, threshold: 0.01})

// GAME LOOP — repeat until dead
LOOP:
  t0 = get_current_time()
  grid = screen_to_grid()
  vec  = screen_to_color_vector()

  // Analyze current state
  past = memory_search("agar game state similar", 3)
  // → find what worked in similar states before

  // Decide action:
  // - If large food cluster visible (many '5's) → move toward it
  // - If large red cluster visible ('2') nearby → move away
  // - If smaller colored cluster → move toward it to eat
  // - If virus ('3') ahead when large → avoid
  action = decide(grid, past)

  // Execute action (mouse movement is continuous — point toward target)
  mouse_move(target_x, target_y)
  // OR for split attacks:
  keyboard_press("space")

  wait_for_change({timeout_ms: 500})
  new_grid = screen_to_grid()
  diff = grid_diff(grid, new_grid)

  // Evaluate outcome
  // - More food consumed? Grid has fewer '5' dots in center
  // - Got bigger? Center cell cluster is larger
  // - Died? Grid resets to start screen pattern
  outcome = evaluate(diff)

  t1 = get_current_time()
  memory_store(
    "t=" + t0.time + " state=" + JSON.stringify(vec.slice(0,16)) + " action=" + action + " outcome=" + outcome,
    0.85,
    ["agar", "strategy", outcome]
  )
END LOOP
```

## Detecting Death

Death is when the screen transitions from game view to the menu/death screen. Signs in pixel grid:
- The center cluster of your cell color disappears
- Large black area returns (background dominates)
- Text appears (your score / "Play again" button)

To detect: `grid_diff(last_grid, current_grid)` will show >60% change — that's a death event.

After death, extract your final score from the death screen via:
```tool
{ "name": "ocr_image", "args": { "imagePath": "<screenshot_path>" } }
```

## Strategy Learned Through Repetition

Use the knowledge graph to build a strategy model:
```tool
{ "name": "graph_add", "args": {
  "subject": "large_red_cell",
  "relation": "leads_to",
  "object": "death",
  "context": "approaching cell larger than self always results in being eaten"
}}
```
```tool
{ "name": "graph_add", "args": {
  "subject": "yellow_dot_cluster",
  "relation": "leads_to",
  "object": "mass_gain",
  "context": "moving through food fields increases size by ~0.5% per dot"
}}
```

After 5+ games, call `memory_search("agar strategy")` before each action to recall what has worked.

## Mouse Control for Movement

Agar.io uses continuous mouse movement — no click needed. The cell chases your cursor.

```tool
{ "name": "get_screen_size", "args": {} }
// → e.g. "Screen size: 1920x1080"
```

Center of screen ≈ (960, 540). To move right: `mouse_move(1400, 540)`. To move toward food at grid position (col=50, row=10) in a 64×36 grid on a 1920×1080 screen:
```
pixel_x = (50 / 64) * 1920 ≈ 1500
pixel_y = (10 / 36) * 1080 ≈ 300
mouse_move(1500, 300)
```

## Tips

- Start by eating only food (yellow dots) until you're large enough to safely eat cells
- Stay near the center of the map — edges have fewer food spawns
- When small, use viruses as shields (large cells explode on virus contact)
- When large, avoid viruses — your cell will split into many pieces
- Split attacks (Space) can catch fleeing cells but leave you vulnerable briefly
- `wait_ms(100)` between mouse moves creates smooth movement

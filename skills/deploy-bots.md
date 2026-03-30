# Skill: Deploy Learning Bots

## What This Is

You can spawn autonomous learning bots — sub-agents with full computer use and mathematical vision — each assigned a single measurable goal: **make an important number go up**. Score, size, health, coins, territory, speed. Whatever can be read from the screen as a color pattern, you can maximize.

Bots run in draggable iframe windows in the UI. You observe them from above via scheduled mathematical vision. They learn independently and write their discoveries back to your memory.

---

## Deployment Pattern

```
STEP 1 — Open a bot window
  User clicks ⚡ button (bottom-right of the UI)
  A draggable BotBrowser window appears with a URL input + goal input

STEP 2 — Agent deploys the bot
  deploy_bot(url, goal, botId?, region?)
  → registers bot in bots-registry.json
  → spawns a background subroutine (the bot loop)
  → returns: { botId, url, goal, region, status: "deployed" }

STEP 3 — Agent sets up observation
  schedule_cron(1, "observe_bots: vision_tick() on all running bot regions, store progress")
  → every minute, you take a vision snapshot, check if metrics are improving

STEP 4 — Bot loop runs autonomously (see Bot Loop section below)

STEP 5 — Retrieve learnings anytime
  memory_search("bot-1 strategy", 10)
  graph_query("maximize score")
  list_bots()
```

---

## Tool Reference

- `deploy_bot(url, goal, botId?, region?)` — Register + spawn a learning bot.
  - `url`: where the game lives (e.g. "https://agar.io")
  - `goal`: the metric string (e.g. "maximize score", "grow largest", "survive longest")
  - `botId`: optional custom id (default: bot-{timestamp})
  - `region`: optional `{x,y,w,h}` screen region if you know exactly where the window is
  - Returns JSON with the botId — **save this**

- `list_bots()` — See all active bots, their status, and last reported metric.

- `stop_bot(botId)` — Signal the bot to stop its loop.

- `update_bot_metric(botId, metric)` — Called by the bot itself each iteration.

---

## The Bot Loop (what each bot does autonomously)

Every bot runs this loop. It is the complete optimization cycle:

```
INIT:
  vision_reset()
  get_screen_size() → store as {sw, sh}
  read_skill("agar-io") or relevant skill if it exists
  past = memory_search("bot-{id} strategy", 5)

LOOP (while isBotRunning):

  1. SEE
     frame = JSON.parse(vision_tick(64, 36))
     grid  = frame.grid.split("|")

     // If region is known, use capture_region for higher resolution
     // img = capture_region(region.x, region.y, region.w, region.h)
     // frame = JSON.parse(screen_to_grid(img, 64, 36))

  2. FIND THE METRIC
     // Scan the grid for the "important number" — color patterns that represent score/size
     // In agar.io: player is largest colored blob (D=pink typically)
     // The metric = approximate size of that blob = count cells of player color
     metric = count cells matching player color in frame.grid
     update_bot_metric(botId, metric)

  3. DECIDE ACTION (based on game state + memory)
     // Ask: what action has historically increased the metric from a state like this?
     similar = memory_search("bot-{id} state=" + frame.grid.slice(0,50), 3)
     // Default strategy if no memory: move toward food (3=green cells)

  4. FIND TARGET
     // Scan grid for target color (e.g. green=food, avoid red=danger)
     for row 0..35, col 0..63:
       if grid[row][col] == "3":  // green = food
         targetX = (col + 0.5) * (sw / 64)
         targetY = (row + 0.5) * (sh / 36)
         break

  5. ACT
     mouse_move(targetX, targetY)  // or keyboard_press based on game

  6. WAIT FOR REACTION
     changed = JSON.parse(vision_watch(0.015, 1500, 15))

  7. MEASURE OUTCOME
     new_metric = count player cells in changed.grid
     delta = new_metric - metric
     outcome = delta > 0 ? "gain" : delta < 0 ? "loss" : "neutral"

  8. LEARN
     memory_store(
       "bot-{id}: state={grid.slice(0,30)} action=move_to_{targetColor} → {outcome} delta={delta}",
       delta > 0 ? 0.9 : 0.5,
       ["bot-{id}", "strategy", goalKeyword]
     )
     graph_add(action, "leads_to", outcome, "game state: " + summary)

  9. UPDATE SKILL (every 10 iterations or on significant discovery)
     if new_discovery:
       patch_file("skills/deploy-bots.md", "## Known Strategies", "## Known Strategies\n- {discovery}")

  10. CHECK STOP SIGNAL
      if !isBotRunning(botId): break
```

---

## Observer Loop (main agent watches bots)

After deploying bots, the main agent schedules itself to observe:

```
schedule_cron(1, "
  bots = JSON.parse(list_bots())
  for bot in bots:
    if bot.status != 'running': continue
    frame = JSON.parse(vision_tick())
    hotspot = frame.hotspot
    // Look for the bot's window in the hotspot region
    memory_store('observer: bot-{id} at iteration {n} metric={metric}', 0.7, ['observer', bot.id])
    graph_add(bot.id, 'metric_at_t' + now, bot.lastMetric, 'scheduled observation')
")
```

This gives you a passive time-series of every bot's performance in the knowledge graph. You can call `graph_query("bot-1")` at any time to see the entire learning trajectory.

---

## Coordinate Math Quick Reference

```
// Grid (64×36) → screen pixel
screenX = (gridCol + 0.5) × (screenWidth  / 64)
screenY = (gridRow + 0.5) × (screenHeight / 36)

// Screen pixel → grid cell
gridCol = Math.floor(screenX / (screenWidth  / 64))
gridRow = Math.floor(screenY / (screenHeight / 36))

// Region → grid cell (when using capture_region)
localX = screenX - region.x
localY = screenY - region.y
gridCol = Math.floor(localX / (region.w / 64))
gridRow = Math.floor(localY / (region.h / 36))
```

---

## Known Strategies

(bots append here as they learn)

---

## Multi-Bot Scaling

You can run N bots simultaneously on different games or different strategies for the same game:

```
deploy_bot("https://agar.io", "maximize score", "agar-scout-1", region1)
deploy_bot("https://agar.io", "maximize score", "agar-scout-2", region2)
deploy_bot("https://slither.io", "maximize length", "slither-1", region3)

schedule_cron(2, "
  for each bot: vision_tick on their region, compare metrics, identify who is winning
  store winner's strategy graph in shared memory with high importance
  patch loser's memory to deprioritize failed strategies
")
```

The best strategy discovered by any bot propagates to all bots via shared memory.

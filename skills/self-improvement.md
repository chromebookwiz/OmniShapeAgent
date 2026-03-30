# Skill: Self-Improvement & System Learning

## You Can Modify Yourself

You are not a static system. Every tool you have, every skill file, every config is writable.
You can — and should — improve your own capabilities continuously.

---

## Workspace File Structure

All persistent files live in organized subdirectories. **Never write to the project root.**

```
data/            JSON state files — vector store, knowledge graph, user profile, etc.
weights/         PyTorch model weights (.pth) — policy nets, vision nets
bots/            Bot registry, per-bot logs and metadata
screenshots/     All screenshots (screenshot() writes here automatically)
skills/          Skill files (.md) — this directory
palette-configs/ Pixel vision palettes per game/domain
saved_chats/     Conversation history (auto-managed)
workspace/       Scratch area for your task outputs, code, data files
```

Quick reference:
- Screenshot output → `screenshots/<name>.png`
- Temporary files, analysis → `workspace/<name>`
- Bot scripts → `bots/<botId>.*`
- Trained weights → `weights/<botId>.pth` (bot tools handle this automatically)
- New skill docs → `skills/<domain>.md`

---

## Writing New Skill Files

When you learn something new about a domain, game, or workflow, write it down permanently:

```tool
{ "name": "write_file", "args": {
  "filepath": "skills/my-new-game.md",
  "content": "# Skill: My New Game\n\n## What it is\n...\n## Controls\n...\n## Strategy\n..."
}}
```

Skill files live in `skills/`. They are loaded by `read_skill(name)`. The name is the filename without `.md`.

**When to write a skill file:**
- After learning a new game's rules and color patterns
- After finding a reliable strategy for a task
- After discovering how a website or API works
- After debugging a recurring problem

---

## Updating Existing Skill Files

Use `patch_file` for surgical updates:
```tool
{ "name": "patch_file", "args": {
  "filepath": "skills/agar-io.md",
  "search": "## Tips\n\n- Start by eating only food",
  "replace": "## Tips (updated after 10 games)\n\n- Optimal early strategy: spiral the edges\n- Start by eating only food"
}}
```

Or rewrite entirely with `write_file` if the content has changed substantially.

---

## PyTorch Self-Improvement Loop

Every bot's learning is backed by a PolicyNet (Actor-Critic) stored in `weights/`. This lets
the system improve from experience across sessions.

### Full Autonomous Training Cycle

```
ensure_torch()                                                         // install torch once into venv

// Deploy: creates weights/policy_<botId>.pth
deploy_bot("https://agar.io", "maximize score", "agar-1")

// Train via REINFORCE
train_bot("agar-1", 50, { state_dim: 64, action_dim: 8, lr: 0.001, gamma: 0.99 })

// Evaluate (no gradient update)
test_bot("agar-1", 20)

// Improve with Actor-Critic + entropy bonus — measures before/after delta
improve_bot("agar-1", "entropy_bonus", 100)

// Log best weights
register_weights("agar-1", "weights/policy_agar-1.pth", 1847.3)

// Hall of Fame
hof_enroll("agar-1", "maximize score", "https://agar.io", 1847.3, 200, ["spiral edges", "split on large"])
hof_name("agar-1")           // assigns a legendary name

// Inspect what the system knows
get_best_weights("policy")   // highest-scoring weights per component
leaderboard()                // full Hall of Fame + active bots
```

### On-the-Fly Weight Update (Inside run_python)

```python
import torch, torch.nn as nn, torch.optim as optim, os, json

WEIGHTS_DIR = os.path.join(os.getcwd(), "weights")
POLICY_PATH = os.path.join(WEIGHTS_DIR, "policy_live.pth")

class PolicyNet(nn.Module):
    def __init__(self, s, a):
        super().__init__()
        self.trunk = nn.Sequential(nn.Linear(s, 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU())
        self.policy_head = nn.Linear(64, a)
        self.value_head  = nn.Linear(64, 1)
    def forward(self, x):
        f = self.trunk(x)
        return torch.softmax(self.policy_head(f), dim=-1), self.value_head(f).squeeze(-1)

net = PolicyNet(64, 8)
if os.path.exists(POLICY_PATH):
    net.load_state_dict(torch.load(POLICY_PATH, weights_only=True))

opt = optim.Adam(net.parameters(), lr=1e-3)
# ... collect episode, compute returns, update ...
opt.zero_grad()
# loss.backward()
# opt.step()
torch.save(net.state_dict(), POLICY_PATH)
print(json.dumps({"saved": POLICY_PATH}))
```

---

## Iframe & Bot-in-Window Workflow

You can test and observe bots **inside the UI** without opening an external browser.

### Pattern 1 — Game in a Window (via Proxy)

Most game sites block iframes with `X-Frame-Options`. Use the built-in proxy:

```tool
{ "name": "create_ui_window", "args": {
  "id": "game-view",
  "title": "🎮 Agar.io",
  "contentType": "iframe",
  "content": "/api/proxy?url=https://agar.io",
  "w": 1100, "h": 650
}}
```

Known blocked domains (always use proxy): agar.io · slither.io · diep.io · krunker.io · zombs.io · moomoo.io

### Pattern 2 — Live Bot Dashboard (HTML Window)

```tool
{ "name": "create_ui_window", "args": {
  "id": "bot-dash",
  "title": "🤖 Bot: agar-1",
  "contentType": "html",
  "content": "<!DOCTYPE html><body style='background:#0a0a0a;color:#7ec8e3;font-family:monospace;padding:16px'><h2 id='name'>Bot: agar-1</h2><div id='score'>Score: —</div><div id='iter'>Iterations: 0</div><canvas id='chart' width='440' height='160' style='border:1px solid #333;margin-top:8px'></canvas></body>",
  "w": 500, "h": 260
}}
```

Then push live updates during training:
```tool
{ "name": "edit_window_content_html", "args": { "id": "bot-dash", "selector": "#score", "html": "Score: 1847" }}
{ "name": "edit_window_content_html", "args": { "id": "bot-dash", "selector": "#iter", "html": "Iterations: 42" }}
```

### Pattern 3 — Screenshot → Vision → Live Camera in Window

```
frame = JSON.parse(vision_tick(64, 36, "agar"))
display_image_in_window("vision-feed", frame.imagePath, "👁 Vision Feed")
// Repeat each iteration → acts as a live frame strip
```

### Pattern 4 — Save Window Layout for Next Session

```tool
{ "name": "save_ui_window", "args": { "id": "game-view" }}
{ "name": "save_ui_window", "args": { "id": "bot-dash" }}
// On next session:
{ "name": "restore_ui_window", "args": { "id": "game-view" }}
{ "name": "restore_ui_window", "args": { "id": "bot-dash" }}
```

---

## Tuning Your Own Vision

After starting a new game, always calibrate your color vision:

```
1. screenshot()                                  → take a frame while the game is running
2. tune_palette(imagePath, 12, "game-name")      → extract dominant colors via K-means
3. screen_to_grid(paletteName="game-name")       → now the grid uses game-accurate colors
4. display_image_in_window("tune-preview", imagePath, "Palette Check")
5. Verify: the grid should show distinct patterns for player, enemies, food, background
```

If the palette isn't accurate, increase numColors:
```tool
{ "name": "tune_palette", "args": { "numColors": 24, "saveName": "game-name-v2" } }
```

For continuous improvement, call `calibrate_vision(imagePath, paletteName)` after each session — it does online updates toward actual observed colors.

Saved palettes persist across sessions in `palette-configs/`. List them:
```tool
{ "name": "list_palette_configs", "args": {} }
```

---

## Building a Game Knowledge Base

For any game, build structured knowledge over time:

```
# After game 1: basic rules
write_file("skills/<game>.md", "# <Game>\n## Rules\n...")

# After each session: update strategy
patch_file("skills/<game>.md", "## Strategy\n...", "## Strategy (session 3)\n...")

# Store specific observations in memory
memory_store("in <game>: moving to top-right when health is low leads to survival", 0.9, ["<game>", "strategy"])

# Build the knowledge graph
graph_add("health_low", "leads_to", "move_to_corner", "survival strategy discovered session 2")
graph_add("large_enemy", "leads_to", "split_and_escape", "splitting creates decoys")
```

---

## Learning Loop (Generic, Any Game)

```
BEFORE FIRST SESSION:
  read_skill("computer-use")    // refresh controls
  read_skill("vision")          // refresh visual tools
  read_skill("windows")         // refresh window/iframe patterns
  ensure_torch()                // ensure ML is ready
  screenshot()
  tune_palette(imagePath, 16, "game-name")   // calibrate vision

EACH SESSION:
  past_knowledge = memory_search("game-name strategy", 5)
  past_graph     = graph_query("game-name")
  // → use these to inform opening strategy

  EACH ACTION:
    frame = JSON.parse(vision_tick(64, 36, "game-name"))
    display_image_in_window("cam", frame.imagePath, "Live")   // visual feedback
    // → read state from frame.grid
    // → decide action based on grid + past knowledge
    // → act
    wait_for_change({timeout_ms: 500})

AFTER SESSION:
  improve_bot(botId, "entropy_bonus", 20)         // one quick improvement pass
  recent = memory_search("game-name last session", 10)
  patch_file("skills/game-name.md", old_section, updated_section)
  memory_consolidate()                             // keep store lean
```

---

## Discovering New Games Autonomously

To learn a new game from scratch:
```
1. create_ui_window("game", "New Game", "iframe", "/api/proxy?url=https://new-game.io", 1100, 650)
2. wait_ms(3000)
3. screenshot() → display_image_in_window("preview", imagePath) → describe_screen("What game is this? Controls? Goal?")
4. fetch_url("https://new-game.io") → look for instructions or help text
5. search_internet("new-game.io controls strategy guide")
6. write_file("skills/new-game.md", ...)          // capture everything you learned
7. tune_palette(numColors=16, saveName="new-game") // calibrate vision
8. ensure_torch() + deploy_bot(...)                // start training
```

---

## Self-Assessment After Each Game

After any game session, ask yourself:
- What did I learn that I didn't know before?
- What strategy would I do differently next time?
- Is the skill file up to date?
- Is the palette config accurate?
- Are my memories meaningful enough to be useful next session?
- Did I run `improve_bot` and save the updated weights?
- Did I save windows I want to reopen?

If the answer to any is "no" — fix it before ending the session.
The point of memory is to not repeat mistakes. The point of skill files is to not re-derive knowledge. Use them.

# Skill: UI Windows — Floating App Layer

## WINDOW-FIRST RULE

> Default to displaying everything in inner windows.
> Only open the user's external browser when absolutely necessary (e.g., OAuth login requiring user interaction).
> Never ask the user to open a browser themselves.

---

## Window Types

| Task | contentType | Content field |
|------|------------|---------------|
| Browse a website | `iframe` | URL string |
| Blocked site (agar.io, etc.) | `iframe` | `/api/proxy?url=https://site.io` |
| Interactive HTML app / dashboard | `html` | Full HTML+CSS+JS document |
| Show code | `code` | Code string |
| Terminal output | `terminal` | Auto-used by run_python / run_terminal_command |
| Display screenshot / image | `image` | Use `display_image_in_window` tool |

---

## Creating Windows

```tool
{ "name": "create_ui_window", "args": {
  "id":          "my-window",        // unique ID — re-calling focuses existing window
  "title":       "🌐 My Window",
  "contentType": "iframe",           // html | iframe | terminal | code | image
  "content":     "https://example.com",
  "x": 100, "y": 80,                // optional position (pixels from top-left)
  "w": 900, "h": 600                // optional size
}}
```

`create_ui_window` is idempotent — calling it with an existing ID focuses/updates the window, not create a duplicate.

---

## Website Windows

### Normal site
```tool
{ "name": "create_ui_window", "args": { "id": "docs", "title": "📄 Docs", "contentType": "iframe", "content": "https://example.com", "w": 1000, "h": 650 } }
```

### Blocked site (X-Frame-Options / CSP)

The built-in proxy at `/api/proxy?url=` strips `X-Frame-Options` and `Content-Security-Policy` headers server-side, and injects a `<base>` tag so sub-resources load directly.

```tool
{ "name": "create_ui_window", "args": { "id": "game", "title": "🎮 Agar.io", "contentType": "iframe", "content": "/api/proxy?url=https://agar.io", "w": 1100, "h": 650 } }
```

Known blocked domains:
- `agar.io` → `/api/proxy?url=https://agar.io`
- `slither.io` → `/api/proxy?url=https://slither.io`
- `diep.io` → `/api/proxy?url=https://diep.io`
- `krunker.io` → `/api/proxy?url=https://krunker.io`
- `zombs.io` → `/api/proxy?url=https://zombs.io`
- `moomoo.io` → `/api/proxy?url=https://moomoo.io`

---

## HTML Windows (Interactive Apps)

HTML windows render a full HTML document in a sandboxed iframe. They support inline `<script>` tags with `fetch()`, `setInterval()`, Canvas, Charts, etc.

### Minimal dashboard
```tool
{ "name": "create_ui_window", "args": {
  "id": "dashboard",
  "title": "📊 Dashboard",
  "contentType": "html",
  "content": "<!DOCTYPE html><html><body style='background:#0a0a0a;color:#7ec8e3;font-family:monospace;padding:16px'><h2 id='title'>Metrics</h2><div id='score'>Score: 0</div><div id='status'>Idle</div></body></html>",
  "w": 400, "h": 220
}}
```

### Live update a CSS selector
```tool
{ "name": "edit_window_content_html", "args": { "id": "dashboard", "selector": "#score", "html": "Score: 1847" }}
{ "name": "edit_window_content_html", "args": { "id": "dashboard", "selector": "#status", "html": "Training — episode 42" }}
```

### Full replace (e.g. to rebuild layout after major change)
```tool
{ "name": "set_window_content_html", "args": { "id": "dashboard", "content": "<!DOCTYPE html>...(new HTML)..." }}
```

### Self-polling dashboard (fetch API from inside window)
The HTML window can poll the agent API to pull live metrics without the agent pushing every update:
```html
<!DOCTYPE html>
<html>
<body style="background:#0a0a0a;color:#7ec8e3;font-family:monospace;padding:16px">
  <h2>Bot Training</h2>
  <div id="score">Score: —</div>
  <canvas id="chart" width="440" height="160" style="border:1px solid #333"></canvas>
  <script>
    const scores = [];
    const ctx = document.getElementById('chart').getContext('2d');
    function draw() {
      ctx.clearRect(0, 0, 440, 160);
      ctx.strokeStyle = '#7ec8e3';
      ctx.beginPath();
      scores.forEach((s, i) => ctx.lineTo(i * (440 / Math.max(scores.length, 1)), 160 - s / 20));
      ctx.stroke();
    }
    async function poll() {
      try {
        const res = await fetch('/api/agent', { method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ message: 'list_bots' }) });
        const data = await res.json();
        if (data.metric) { scores.push(data.metric); document.getElementById('score').textContent = 'Score: ' + data.metric; draw(); }
      } catch {}
      setTimeout(poll, 3000);
    }
    poll();
  </script>
</body>
</html>
```

---

## Image Windows

Use `display_image_in_window` to show any PNG/JPG/GIF/WebP file. It reads the file, converts to base64, and renders it natively — no HTTP serving needed.

```tool
// After a screenshot:
{ "name": "screenshot", "args": {} }
// → returns path like "screenshots/screenshot_1234567890.png"
{ "name": "display_image_in_window", "args": { "id": "cam", "imagePath": "screenshots/screenshot_1234567890.png", "title": "📷 Screen" }}
```

```tool
// After vision_tick:
// frame = JSON.parse(vision_tick(64, 36, "agar"))
{ "name": "display_image_in_window", "args": { "id": "vision-feed", "imagePath": "screenshots/screenshot_1234567890.png", "title": "👁 Vision" }}
```

Live camera strip pattern (repeat each game loop iteration):
```
frame = JSON.parse(vision_tick(64, 36, "agar"))
display_image_in_window("cam", frame.imagePath)    // same ID → replaces image in-place
```

---

## Terminal Windows

Terminal windows are created automatically by `run_terminal_command`, `run_python`, and `run_js`. They show:
- The command / code being run (preview)
- The stdout/stderr output
- A `[QUEUED]` badge if the command needs user approval

You can also create a terminal window manually for log output:
```tool
{ "name": "create_ui_window", "args": { "id": "logs", "title": "📋 Bot Logs", "contentType": "terminal", "content": "Bot agar-1 started...", "w": 600, "h": 300 }}
```

---

## Code Windows

Display formatted code without executing it:
```tool
{ "name": "create_ui_window", "args": {
  "id": "src-view",
  "title": "📝 PolicyNet",
  "contentType": "code",
  "content": "class PolicyNet(nn.Module):\n    def __init__(self, s, a):\n        super().__init__()\n        self.net = nn.Linear(s, a)\n    def forward(self, x): return torch.softmax(self.net(x), dim=-1)",
  "w": 600, "h": 300
}}
```

---

## Saving & Restoring Windows

Windows are ephemeral by default (lost on page refresh). Persist them to localStorage:

```tool
// Save current state (position, size, content, contentType)
{ "name": "save_ui_window", "args": { "id": "game" }}
{ "name": "save_ui_window", "args": { "id": "bot-dash" }}
{ "name": "save_ui_window", "args": { "id": "vision-feed" }}
```

```tool
// Restore on next session (re-opens with saved state)
{ "name": "restore_ui_window", "args": { "id": "game" }}
{ "name": "restore_ui_window", "args": { "id": "bot-dash" }}
{ "name": "restore_ui_window", "args": { "id": "vision-feed" }}
```

**Session start pattern** — restore your working environment:
```
observe_self()   // check what's running
restore_ui_window("game")
restore_ui_window("bot-dash")
restore_ui_window("vision-feed")
```

---

## Closing Windows

```tool
{ "name": "close_ui_window", "args": { "id": "game" }}
```

---

## Full Bot Monitoring Setup

Typical pattern for a full monitoring environment when running a game bot:

```
// 1. Game view (proxied)
create_ui_window("game", "🎮 Agar.io", "iframe", "/api/proxy?url=https://agar.io", 100, 50, 900, 580)

// 2. Live vision feed
// (populated via display_image_in_window("vision", frame.imagePath) in the loop)
create_ui_window("vision", "👁 Vision Feed", "image", "", 1010, 50, 480, 300)

// 3. Bot dashboard
create_ui_window("dash", "📊 Metrics", "html", "...", 1010, 360, 480, 270)

// 4. Terminal for logs (auto-created by run_python / run_terminal_command)

// 5. Save layout
save_ui_window("game")
save_ui_window("vision")
save_ui_window("dash")
```

---

## Tips

- **Unique IDs matter** — reuse the same ID to update a window in-place, not create duplicates.
- **HTML windows are full sandboxed pages** — they can use any browser API (Canvas, fetch, WebSocket, Web Speech, etc.).
- **Proxy only patches the top frame** — if a game loads sub-iframes, those may still fail. The main page HTML renders correctly.
- **image windows replace content** — calling `display_image_in_window` with an existing ID updates the image without re-positioning the window.
- **Save before ending a session** — `save_ui_window` takes <1ms and persists position + content across restarts.

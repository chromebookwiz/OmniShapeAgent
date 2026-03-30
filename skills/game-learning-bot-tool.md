# Game‑Learning Bot Toolset

This skill records the custom tool‑set we will use for an autonomous bot that learns a video‑game by visual observation.

## High‑level workflow
1. **Screen capture & vectorisation** – `vision_tick(cols=64, rows=36, paletteName="game")` creates a low‑resolution colour‑grid representation of the current frame.
2. **Memory recall** – `memory_search("game state similar to current", topK=3)` pulls past experiences.
3. **Decision logic** – a simple rule‑based policy (`decide_action`) that moves the cursor toward the nearest green cell (`3`).
4. **Action execution** – mouse/keyboard primitives (`mouse_move`, `mouse_click`, `keyboard_press`).
5. **Change detection** – `wait_for_change({"timeout_ms":1500,"threshold":0.01})` ensures the screen reacted.
6. **Experience logging** – `memory_store` records the action, observed delta and any retrieved similar states.

## Extensibility
- Swap `vision_tick` for a full vision model (`describe_screen`) to obtain semantic descriptions.
- Replace the rule‑ policy with a learned modelRL, supervised, LLM‑prompted).
 Persist high‑level textual descriptions in the knowledge graph for reasoning.

---
*This skill file is only documentation; the actual bot will be deployed via `deploy_bot`.*
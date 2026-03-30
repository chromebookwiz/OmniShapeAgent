# Installing the ShapeAgent CLI

## Quickest method (via agent tool)

```tool
{ "name": "install_cli", "args": {} }
```

This runs `npm link` from the project root and registers `ShapeAgent` and `shapagent` globally in PATH.

## Via terminal (manual)

```tool
{ "name": "run_terminal_command", "args": { "command": "npm link" } }
```

Verify:
```tool
{ "name": "run_terminal_command", "args": { "command": "where ShapeAgent" } }
```
(Use `which ShapeAgent` on Unix/macOS.)

## CLI quick-reference

| Command | Description |
|---------|-------------|
| `/setup` | Interactive wizard: provider, model, synergy mode |
| `/status` | Current connection, model, provider info |
| `/model [name]` | Get/set primary model |
| `/companion [name]` | Companion model for synergy |
| `/provider [name]` | ollama \| vllm \| openrouter \| auto |
| `/mode [off\|parallel\|neural]` | Synergy mode |
| `/temp [0-2]` | Temperature |
| `/bots` | Deployed bots and scores |
| `/memory` | Memory stats |
| `/tools` | All 170+ tools |
| `/install` | Re-run npm link |
| `/run <task>` | One-shot execution |
| `/exit` | Save and quit |

## Non-interactive / scripting

```bash
ShapeAgent --run "refactor src/lib/agent.ts"
cat README.md | ShapeAgent
ShapeAgent --server http://192.168.1.10:3000 --run "check server health"
```

## Auto-continue

The agent signals `[AUTO_CONTINUE: task]` when work is incomplete. The CLI automatically re-sends the continuation (up to 5 times) — fully autonomous multi-step execution with no user intervention.

## Config file: ~/.shapagent/config.json

```json
{
  "serverUrl":       "http://localhost:3000",
  "provider":        "vllm",
  "model":           "vllm:meta-llama/Llama-3.1-8B@http://localhost:8000/v1/chat/completions",
  "companion":       "ollama:llama3.2",
  "temperature":     0.7,
  "synergyMode":     "neural",
  "openrouterApiKey": "sk-or-v1-..."
}
```

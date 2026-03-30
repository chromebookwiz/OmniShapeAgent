# Ollama Setup & Model Management Skill

## Quick Check
```
http_request("http://127.0.0.1:11434/api/tags", "GET")    # list models
http_request("http://127.0.0.1:11434/api/version", "GET") # server version
```

## Install & Run Ollama

```bash
# Install (Linux/macOS)
run_terminal_command("curl -fsSL https://ollama.com/install.sh | sh")

# Windows: download from https://ollama.com
# Or via winget:
run_terminal_command("winget install Ollama.Ollama")

# Start server
run_terminal_command("ollama serve")

# Pull a model
run_terminal_command("ollama pull llama3")
run_terminal_command("ollama pull nomic-embed-text")   # required for memory
run_terminal_command("ollama pull qwen2.5:7b")
run_terminal_command("ollama pull deepseek-r1:8b")
```

## Required Models

| Model | Purpose |
|-------|---------|
| `nomic-embed-text` | Memory embeddings (REQUIRED for memory to work) |
| `llama3` | General chat (good default) |
| `qwen2.5:7b` | Fast, capable, good at code |
| `deepseek-r1:8b` | Reasoning/thinking model |

## Ollama API Format

Ollama uses its own API format (NOT OpenAI-compatible by default):
```json
POST /api/chat
{
  "model": "llama3",
  "messages": [{"role": "user", "content": "hello"}],
  "stream": false
}
```

Response:
```json
{ "message": { "role": "assistant", "content": "..." } }
```

ShapeAgent handles both Ollama and OpenAI formats automatically.

## OpenAI-Compatible Mode (Ollama v0.1.24+)

Ollama also supports:
```
POST /v1/chat/completions   (OpenAI format)
GET  /v1/models
```

ShapeAgent can use either endpoint based on the model prefix:
- `ollama:llama3` → uses `/api/chat`
- Discovered via network scan → uses `/v1/chat/completions`

## Embedding Configuration

Set in `.env.local`:
```
EMBED_MODEL=nomic-embed-text
OLLAMA_URL=http://127.0.0.1:11434
```

If Ollama is offline, embeddings fall back to a hash-based pseudo-embedding.
**Memory quality degrades significantly without Ollama running.**

## Model Management
```bash
run_terminal_command("ollama list")              # installed models
run_terminal_command("ollama ps")                # running models
run_terminal_command("ollama rm model-name")     # delete model
run_terminal_command("ollama show llama3")       # model info
```

## Remote Ollama

To expose Ollama on the network:
```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

Then in ShapeAgent settings: `http://192.168.1.x:11434`

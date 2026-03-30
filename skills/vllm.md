# vLLM Setup & Troubleshooting Skill

## Quick Diagnosis

```
# 1. Check if vLLM is reachable
http_request("http://192.168.1.34:8080/v1/models", "GET")

# 2. Try a real chat request
http_request(
  "http://192.168.1.34:8080/v1/chat/completions",
  "POST",
  '{"Content-Type":"application/json","Authorization":"Bearer EMPTY"}',
  '{"model":"your-model-id","messages":[{"role":"user","content":"ping"}],"stream":false}'
)

# 3. Check environment
system_info()
```

## Common 405 "Method Not Allowed" Fix

The most common cause: **missing Authorization header**.

```bash
# On the vLLM server, if started with --api-key:
# Client must send: Authorization: Bearer <your-key>

# In ShapeAgent, set:
set_env_key("VLLM_API_KEY", "your-api-key-here")
# Or use EMPTY if no key is required but header is needed:
set_env_key("VLLM_API_KEY", "EMPTY")
```

## vLLM Server Launch Reference

```bash
# Basic (no auth)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-72B-Instruct \
  --host 0.0.0.0 --port 8080

# With API key (then set VLLM_API_KEY in ShapeAgent)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-72B-Instruct \
  --api-key sk-my-secret-key \
  --host 0.0.0.0 --port 8080

# Multi-GPU
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3-70b-chat \
  --tensor-parallel-size 4 \
  --host 0.0.0.0 --port 8080
```

## URL Configuration

ShapeAgent expects the vLLM base URL. Both formats work:
- `http://192.168.1.34:8080` (agent adds `/v1/chat/completions`)
- `http://192.168.1.34:8080/v1` (agent adds `/chat/completions`)

Set in `.env.local`:
```
VLLM_URL=http://192.168.1.34:8080/v1
VLLM_MODEL=Qwen/Qwen2.5-72B-Instruct
VLLM_API_KEY=sk-your-key   # optional
```

## Model ID Format in ShapeAgent

The dropdown uses: `vllm:MODEL_ID@chatUrl`

Example: `vllm:Qwen/Qwen2.5-72B@http://192.168.1.34:8080/v1/chat/completions`

## Streaming Note

vLLM defaults to `stream: false` per OpenAI spec. ShapeAgent explicitly sends `stream: false`.
If you see hanging requests, the server may be misconfigured for streaming.

## Network Discovery

ShapeAgent auto-scans the local /24 subnet on ports 8000, 8080, 11434, 5000.
Add known hosts to env: `VLLM_SPARK_HOSTS=192.168.1.34,192.168.1.50`

## Reasoning Models (Qwen3, DeepSeek-R1)

ShapeAgent extracts `reasoning_content` from the response and displays it as `[THINKING]` blocks.
Also handles `<think>...</think>` tags in content automatically.

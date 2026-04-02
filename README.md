# OmniShapeAgent

OmniShapeAgent is a local-first AI agent with a Next.js web UI and CLI. The base build includes chat, tool execution, persistent memory, vision, file operations, and local model support.

## What ships in this repo

- Web chat UI for running the agent locally
- CLI for interactive and one-shot agent sessions
- Persistent vector memory and knowledge graph storage
- File, terminal, git, browser, and screen-control tools
- Local model routing for Ollama, vLLM, and OpenRouter-compatible setups

Runtime state is intentionally excluded from source control. User profiles, saved chats, embeddings, queues, screenshots, and other generated artifacts are created locally under runtime directories.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the web UI.

To use the CLI:

```bash
npm run cli
```

## Build

```bash
npm run build
npm run start
```

## Lint

```bash
npm run lint
```

# Agent Design Skill

## ShapeAgent Architecture

```
User → Chat.tsx → /api/agent → runAgentLoop() → LLM → tools → LLM → ...
                                      ↓
                              Vector Memory ← Embeddings (Ollama)
                              Knowledge Graph
```

## Agent Loop Pattern

1. Embed user query → search semantic memory (top 5)
2. Optionally query companion model (neural/parallel mode)
3. Build system prompt + memory context
4. Call primary LLM
5. Parse `\`\`\`tool { ... }\`\`\`` blocks from response
6. Execute tools, push result as system message
7. Repeat until no tool call or max iterations
8. Store conversation turn in memory

## Writing Good Tool Calls

Always use this exact format:
```
\`\`\`tool
{ "name": "tool_name", "args": { "key": "value" } }
\`\`\`
```

One tool per turn. Wait for result before next tool.

## Effective Agent Patterns

### Investigation Pattern
```
1. memory_search("topic") — check what's known
2. read_file / grep_search — examine current state
3. git_log / git_diff — understand recent changes
4. form hypothesis
5. make targeted change
6. verify with tsc/tests
7. memory_store("what was learned")
```

### Parallel Work Pattern (spawn_subroutine)
```
spawn_subroutine("Research: what are the best practices for X")
# While subroutine runs, continue main task
# Subroutine auto-saves results to memory
memory_search("best practices for X")  # retrieve later
```

### Long Thinking Pattern
For complex problems, use neural mode (companion model pre-primes context)
or manually structure thinking:
```
<thought>
1. What do I know about this problem?
2. What information do I need?
3. What's the minimal viable approach?
4. What could go wrong?
</thought>
[then take action]
```

## Synergy Modes

| Mode | Behavior |
|------|----------|
| off | Single model responds |
| neural | Companion generates ideas → prepended to primary's context |
| parallel | Primary responds → companion critiques → both shown |

Primary = your selected model
Companion = the other provider (Ollama ↔ vLLM)

In the terminal CLI: `/mode neural` or `/mode parallel`

## Agent Self-Improvement

The agent can modify its own codebase:
```
read_file("src/lib/agent.ts")
patch_file("src/lib/agent.ts", "old code", "new code")
run_terminal_command("npx tsc --noEmit")   # verify
git_commit("feat: self-improvement - added X capability")
```

Use this carefully. Always verify with TypeScript check before committing.

## Scheduling Autonomous Tasks

```
# Run a task every hour
schedule_cron(60, "Search for updates on AI safety research and store findings")

# Run when a concept appears in output
schedule_resonance("deployment failure", "Alert user and check error logs")
```

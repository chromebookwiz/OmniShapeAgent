# Debugging Skill

## The Debugging Loop
1. **Reproduce** — confirm you can trigger the issue consistently
2. **Isolate** — narrow down which component/line causes it
3. **Hypothesize** — form a theory based on evidence
4. **Test hypothesis** — don't fix; verify the theory first
5. **Fix** — minimal targeted change
6. **Verify** — confirm fix works and nothing regressed

## Evidence Gathering First
```
git_log(10)                          # recent changes — recent = likely cause
git_diff("HEAD~3")                    # what changed in last 3 commits
grep_search("error")                  # find error handling code
grep_search("TODO|FIXME|HACK")        # known issues
```

## TypeScript / Next.js
```
run_terminal_command("npx tsc --noEmit 2>&1")          # type errors
run_terminal_command("npm run lint 2>&1")               # lint errors
run_terminal_command("cat .next/server/app-build-manifest.json")  # build state
```

## Node.js Runtime Errors
```
run_terminal_command("node -e \"require('./src/lib/agent')\"")  # can the module load?
run_js("console.log(JSON.stringify(process.env, null, 2))")    # env check
```

## API Debugging
```
http_request("http://localhost:3000/api/models", "GET")
http_request("http://localhost:3000/api/memory", "GET")
http_request("http://192.168.1.34:8080/v1/models", "GET")     # vLLM
http_request("http://127.0.0.1:11434/api/tags", "GET")         # Ollama
```

## vLLM / Ollama Diagnostics
```
# Test vLLM chat endpoint directly
http_request(
  "http://192.168.1.34:8080/v1/chat/completions",
  "POST",
  '{"Content-Type":"application/json"}',
  '{"model":"your-model","messages":[{"role":"user","content":"hi"}],"stream":false}'
)

# Test Ollama
http_request(
  "http://127.0.0.1:11434/api/chat",
  "POST",
  null,
  '{"model":"llama3","messages":[{"role":"user","content":"hi"}],"stream":false}'
)
```

## Memory / Performance
```
system_info()                                              # OS resources
run_terminal_command("node -e \"console.log(process.memoryUsage())\"")
run_python("import psutil; print(psutil.virtual_memory())")
```

## Common Fixes

| Problem | Fix |
|---------|-----|
| `Cannot find module` | Check import path, rebuild |
| `ECONNREFUSED` | Service not running on that port |
| `405 Method Not Allowed` | Wrong HTTP method or endpoint path |
| `401 Unauthorized` | Missing/wrong API key |
| `ENOMEM` | Node.js heap limit — increase with `--max-old-space-size=4096` |
| `ENOENT` | File path doesn't exist |
| `TypeError: x is not a function` | Wrong import (named vs default) |

## When Stuck
1. `memory_search("error description")` — have I seen this before?
2. `search_internet("exact error message site:github.com")` — others' solutions
3. `read_skill("coding")` — review coding patterns
4. Simplify to minimal reproduction case

# Advanced Coding Skill

## Approach to Complex Tasks

### 1. Understand Before Writing
```
read_file("src/lib/agent.ts")         # read target file first
grep_search("functionName")           # find all references
git_log(10)                           # understand recent changes
```

### 2. Make Surgical Edits
- Prefer `patch_file` for targeted changes over full rewrites
- Read surrounding context before editing
- One logical change per commit

### 3. Verify Changes
```
run_terminal_command("npx tsc --noEmit")   # TypeScript check
run_terminal_command("npm test")            # run tests
git_diff()                                  # review before commit
```

## TypeScript Patterns

**Null safety:**
```typescript
const value = obj?.nested?.field ?? 'default';
```

**Type narrowing:**
```typescript
if ('error' in result) { /* handle error case */ }
```

**Async error handling:**
```typescript
const result = await fetch(url).catch(e => null);
if (!result?.ok) return 'failed';
```

## Refactoring Checklist
- [ ] All tests still pass
- [ ] No new TypeScript errors (`tsc --noEmit`)
- [ ] No unused imports
- [ ] Function/variable names are self-documenting
- [ ] No magic numbers (use named constants)
- [ ] Error paths handled

## Code Review Mental Model
1. Does it do what it says?
2. Does it handle edge cases?
3. Is it readable in 6 months?
4. Could it fail under load?
5. Are there security concerns? (injection, path traversal, auth)

## Performance Patterns
- Avoid N+1 loops: batch operations where possible
- Cache expensive computations
- Use `Promise.allSettled` for parallel independent ops
- Stream large files instead of loading to memory

## Debugging Strategy
```
run_terminal_command("node --inspect src/debug.js")  # Node debugger
run_python("import pdb; pdb.set_trace()")             # Python debugger
grep_search("console.error")                           # find error logs
git_log(5)                                             # recent changes = recent bugs
```

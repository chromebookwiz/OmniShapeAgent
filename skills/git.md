# Git Skill

## Core Workflow
```
git_status()                          # always start here
git_diff()                            # review changes
git_add(".")                          # or specific files
git_commit("feat: description")       # conventional commit
git_push()
```

## Branching
```
git_branch()                          # list branches
git_checkout("feat/new-feature")      # switch (creates if -b)
git_checkout("-b feat/new-feature")   # create + switch
git_stash()                           # save work before switching
git_stash("pop")                      # restore stash
```

## Investigation
```
git_log(30)                           # recent history
git_diff("HEAD~1")                    # diff vs last commit
git_diff("main...HEAD")               # diff vs main branch
git_show("abc1234")                   # inspect a commit
git_blame("src/lib/agent.ts")         # who changed what
git_grep("TODO")                      # search across commits
```

## Conventional Commit Types
- `feat:` new feature
- `fix:` bug fix
- `refactor:` code change without new feature/fix
- `docs:` documentation only
- `chore:` build, deps, tooling
- `test:` adding tests
- `perf:` performance improvement

## Undo Patterns
```
git_reset("HEAD~1 --soft")            # undo commit, keep changes staged
git_reset("HEAD~1 --mixed")           # undo commit, unstage changes
git_stash()                           # temporarily shelve changes
```

## Common Scenarios

**Squash last 3 commits:**
Use `run_terminal_command("git rebase -i HEAD~3")`

**Check what's on remote but not local:**
`run_terminal_command("git fetch && git log HEAD..origin/main --oneline")`

**Find when a bug was introduced:**
`run_terminal_command("git bisect start && git bisect bad && git bisect good <sha>")`

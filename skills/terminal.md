# Terminal Mastery Skill

## Web Runtime Focus

Use the Next.js web environment as the primary control surface for the agent.
- Start the app with `npm run dev`
- Build with `npm run build`
- Run production locally with `npm run start`

## Essential Shell Patterns

### File Operations
```bash
# Find files
run_terminal_command("find . -name '*.ts' -not -path '*/node_modules/*'")

# Count lines of code
run_terminal_command("find src -name '*.ts' | xargs wc -l | tail -1")

# Watch for changes
run_terminal_command("ls -la --sort=time")
```

### Process Management
```bash
run_terminal_command("ps aux | grep node")
run_terminal_command("lsof -i :3000")           # what's on port 3000
run_terminal_command("kill -9 $(lsof -t -i:3000)")
```

### Network Diagnostics
```bash
run_terminal_command("curl -s http://localhost:3000/api/models")
run_terminal_command("netstat -an | grep LISTEN")
run_terminal_command("ping -c 3 192.168.1.34")
```

### Package Management
```bash
install_npm("package-name")                     # local install
install_npm("typescript", true)                  # global install
install_pip("requests")
check_installed("git")
check_installed("python3")
```

### Environment
```bash
run_terminal_command("env | grep VLLM")          # check env vars
set_env_key("VLLM_API_KEY", "sk-xxx")           # update .env.local
system_info()                                     # full system context
```

## Windows vs Unix
The agent runs on Windows but uses Unix-style commands through `run_terminal_command`.
- Windows: commands go through cmd.exe or PowerShell
- Use `run_python` for cross-platform scripts
- PowerShell: prefix with `powershell -Command "..."`

# Tailscale — Remote Access & Tailnet Tools

Access ShapeAgent from your phone, tablet, or any device on any network.  
Connect all your machines so the agent can SSH, send files, and run commands on them.

---

## 1. Install Tailscale on the ShapeAgent machine

**Windows (this PC):**
```
winget install tailscale.tailscale
```
Or download from https://tailscale.com/download/windows

**Linux / WSL:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

After install, Tailscale will open a browser to log in / create an account (free).

---

## 2. Enable SSH server (so the agent can control this machine remotely)

```powershell
# Windows — run in an elevated PowerShell after installing Tailscale:
tailscale up --ssh
```

This lets other Tailscale devices (and the agent itself) run commands on this PC via `tailscale_ssh()`.

---

## 3. Access ShapeAgent from your phone

### Option A — Dev server (fastest to start)

Start the app so it listens on all interfaces:

```powershell
# In the e8-agent directory:
$env:HOSTNAME="0.0.0.0"; npm run dev
```

Or add to `package.json`:
```json
"dev:ts": "next dev -H 0.0.0.0 -p 3000"
```

### Option B — Production build (recommended for phone use)

```powershell
npm run build
$env:HOSTNAME="0.0.0.0"; npm start
```

### Then on your phone:

1. Install **Tailscale** from App Store / Google Play
2. Log in with the **same account** as the machine
3. Open your browser and navigate to:
   ```
   http://<machine-tailscale-ip>:3000
   ```
   Find the IP with: `tailscale ip --4` (e.g. `100.64.1.5`)

4. Bookmark it. You're done — works on any network (4G/5G/WiFi) as long as Tailscale is connected.

---

## 4. Add other devices to the tailnet

Install Tailscale on any device you want the agent to reach:

| Device | Command |
|---|---|
| Windows | `winget install tailscale.tailscale` |
| macOS | `brew install tailscale` or App Store |
| Linux | `curl -fsSL https://tailscale.com/install.sh \| sh` |
| Android/iOS | Tailscale app from store |
| Raspberry Pi | `curl -fsSL https://tailscale.com/install.sh \| sh` |

All devices using the same Tailscale account are automatically on the same private tailnet.

---

## 5. What the agent can do on your tailnet

Once Tailscale is running, the agent has full tooling:

```
tailscale_check()                      — verify Tailscale is up
tailscale_status()                     — list all devices (online/offline + IPs)
tailscale_ping("my-phone")             — check latency to a device
tailscale_ip()                         — this machine's Tailscale IPs

tailscale_ssh("my-server", "ls -la")  — run a command remotely
tailscale_ssh("pi", "python3 script.py", "pi")  — run as specific user

tailscale_send_file("/path/file.txt", "my-phone")  — push file to a device
tailscale_get_files("/tmp/received")               — receive files sent to this PC

tailscale_up("--ssh --accept-routes")  — re-configure Tailscale
tailscale_set_exit_node("my-server")   — route traffic through another device
```

### Example agent prompts

> "Check which of my Tailscale devices are online."

> "SSH into my Raspberry Pi and run `sensors` to check the CPU temperature."

> "Send the file `output/report.pdf` to my phone via Tailscale."

> "Run `git pull && npm run build` on my server at `home-server`."

---

## 6. Security notes

- **Tailscale is end-to-end encrypted** (WireGuard). Traffic never touches a Tailscale server in transit.
- The ShapeAgent is only accessible to devices **on your tailnet** — not the public internet.
- You can restrict access with [ACLs](https://tailscale.com/kb/1018/acls/) in the Tailscale admin console.
- For production use, consider enabling **MagicDNS** in the admin console so you can use `http://shapagent-pc:3000` instead of an IP.

---

## 7. Quick start checklist

- [ ] Tailscale installed on the ShapeAgent machine
- [ ] Tailscale installed on your phone / remote device
- [ ] Both devices logged into the same Tailscale account
- [ ] `tailscale up --ssh` run on the ShapeAgent machine
- [ ] App started with `$env:HOSTNAME="0.0.0.0"; npm run dev` (or `npm start`)
- [ ] Phone browser → `http://<tailscale-ip>:3000` bookmarked

---

## 8. Finding your Tailscale IP

```powershell
tailscale ip --4    # IPv4 (e.g. 100.64.1.5)
tailscale ip --6    # IPv6
tailscale status    # See all devices + IPs
```

Or ask the agent: `tailscale_ip()` — it returns the IP immediately.

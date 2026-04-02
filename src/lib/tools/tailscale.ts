// src/lib/tools/tailscale.ts
// Tailscale integration — list devices, ping, run SSH commands, send/receive files,
// and check the local machine's Tailscale status.
//
// Prerequisites: Tailscale must be installed and running on the host.
// Windows:  https://tailscale.com/download/windows
// Linux:    curl -fsSL https://tailscale.com/install.sh | sh
//
// All functions shell out to the `tailscale` CLI, which is always available on
// machines where Tailscale is installed and logged in.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function run(cmd: string, timeout = 15_000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout + stderr).trim().slice(0, 8000);
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return ((err.stdout ?? '') + (err.stderr ?? '') + (err.message ?? '')).trim().slice(0, 4000);
  }
}

/**
 * Get the full status of the local Tailscale node — machine name, IP,
 * and list of peers (name, IP, OS, online status, last-seen).
 */
export async function tailscaleStatus(): Promise<string> {
  return run('tailscale status --json').then(raw => {
    try {
      const data = JSON.parse(raw) as {
        Self?: { HostName: string; TailscaleIPs: string[]; OS: string };
        Peer?: Record<string, { HostName: string; TailscaleIPs: string[]; OS: string; Online: boolean; LastSeen?: string }>;
      };
      const self = data.Self;
      const peers = Object.values(data.Peer ?? {}).map(p => ({
        hostname: p.HostName,
        ips:      p.TailscaleIPs,
        os:       p.OS,
        online:   p.Online,
        lastSeen: p.LastSeen ?? 'unknown',
      }));
      return JSON.stringify({
        self:  { hostname: self?.HostName, ips: self?.TailscaleIPs, os: self?.OS },
        peers: peers.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0)),
        peerCount: peers.length,
        onlineCount: peers.filter(p => p.online).length,
      }, null, 2);
    } catch {
      return raw; // Return raw if not JSON (e.g. not logged in)
    }
  });
}

/**
 * Ping a Tailscale device by hostname or IP.
 * Returns latency, path (direct/relay), and reachability.
 */
export async function tailscalePing(hostname: string, count = 3): Promise<string> {
  if (!hostname) return 'Error: hostname is required';
  return run(`tailscale ping --c ${count} ${hostname}`, 20_000);
}

/**
 * Run a shell command on a remote Tailscale device via Tailscale SSH.
 * The remote machine must have Tailscale SSH enabled:
 *   Linux/Mac: `tailscale up --ssh`
 *   Windows:   Tailscale SSH server must be running.
 *
 * @param hostname - Tailscale hostname or IP (e.g. "my-phone" or "100.x.x.x")
 * @param command  - Shell command to run remotely
 * @param user     - SSH user (default: current user on remote host)
 */
export async function tailscaleSsh(hostname: string, command: string, user?: string): Promise<string> {
  if (!hostname) return 'Error: hostname is required';
  if (!command)  return 'Error: command is required';
  const userAtHost = user ? `${user}@${hostname}` : hostname;
  // -o StrictHostKeyChecking=no for first-time connections inside the tailnet
  const cmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${userAtHost} ${JSON.stringify(command)}`;
  return run(cmd, 30_000);
}

/**
 * Send a file to a Tailscale device using `tailscale file cp`.
 * The receiving device must accept incoming files (enabled by default).
 *
 * @param localPath  - Absolute path to the local file
 * @param hostname   - Target device hostname or IP
 */
export async function tailscaleSendFile(localPath: string, hostname: string): Promise<string> {
  if (!localPath) return 'Error: localPath is required';
  if (!hostname)  return 'Error: hostname is required';
  return run(`tailscale file cp ${JSON.stringify(localPath)} ${hostname}:`, 60_000);
}

/**
 * List files waiting to be received on this device via `tailscale file get`.
 * Files are placed in the Tailscale download directory (usually ~/Downloads or %USERPROFILE%\Downloads).
 *
 * @param destDir - Directory to save received files (default: current working directory)
 */
export async function tailscaleGetFiles(destDir?: string): Promise<string> {
  const dir = destDir ?? process.cwd();
  return run(`tailscale file get ${JSON.stringify(dir)}`, 30_000);
}

/**
 * Return this machine's Tailscale IP addresses (IPv4 + IPv6).
 */
export async function tailscaleIp(): Promise<string> {
  return run('tailscale ip', 5_000);
}

/**
 * Check if Tailscale is installed and logged in on the host machine.
 * Returns version and account info.
 */
export async function tailscaleCheck(): Promise<string> {
  const [version, whois] = await Promise.all([
    run('tailscale version', 5_000),
    run('tailscale whois $(tailscale ip --4 2>/dev/null) 2>/dev/null || echo "not logged in"', 8_000),
  ]);
  return `Version: ${version}\n\nWhois:\n${whois}`;
}

/**
 * Bring Tailscale up (or re-authenticate) with optional flags.
 * Common flags: --ssh (enable SSH server), --accept-routes, --exit-node=<hostname>
 *
 * @param flags - Additional tailscale up flags, e.g. "--ssh --accept-routes"
 */
export async function tailscaleUp(flags?: string): Promise<string> {
  const cmd = flags ? `tailscale up ${flags}` : 'tailscale up';
  return run(cmd, 30_000);
}

/**
 * Set or clear an exit node (route all internet traffic through a Tailscale peer).
 *
 * @param hostname - Tailscale hostname/IP to use as exit node, or empty string to clear
 */
export async function tailscaleSetExitNode(hostname?: string): Promise<string> {
  if (!hostname) return run('tailscale up --exit-node=', 10_000);
  return run(`tailscale up --exit-node=${hostname} --exit-node-allow-lan-access`, 10_000);
}

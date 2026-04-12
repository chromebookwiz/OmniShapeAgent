// src/lib/tools/terminal-tools.ts
// Terminal execution with user confirmation queue.
// Safe read-only commands run immediately; destructive ones are queued for approval
// via the terminal panel API (GET/POST /api/terminal).

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

import { ensureWorkspacePaths } from '../paths-bootstrap';
import { PATHS } from '../paths-core';

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingCommand {
  id: string;
  command: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'error';
  output?: string;
  createdAt: string;
  resolvedAt?: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const QUEUE_PATH = PATHS.terminalQueue;

ensureWorkspacePaths();

function readQueue(): PendingCommand[] {
  try {
    if (!fs.existsSync(QUEUE_PATH)) return [];
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8')) as PendingCommand[];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingCommand[]): void {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

// ── Safety classification ─────────────────────────────────────────────────────

// Patterns that are unconditionally safe (read-only, informational).
const SAFE_PATTERNS: RegExp[] = [
  /^\s*ls(\s|$)/,
  /^\s*cat\s+/,
  /^\s*head\s+/,
  /^\s*tail\s+/,
  /^\s*echo\s+/,
  /^\s*pwd\s*$/,
  /^\s*whoami\s*$/,
  /^\s*date\s*$/,
  /^\s*node\s+--version\s*$/,
  /^\s*node\s+-v\s*$/,
  /^\s*npm\s+list/,
  /^\s*npm\s+ls/,
  /^\s*git\s+(status|log|diff|branch|show|remote\s+-v|tag)(\s|$)/,
  /^\s*python\s+(--version|-V)\s*$/,
  /^\s*python3\s+(--version|-V)\s*$/,
  /^\s*pip\s+(list|show|freeze)/,
];

// Patterns that are always dangerous regardless of other logic.
const UNSAFE_PATTERNS: RegExp[] = [
  /rm\s/,
  /sudo\s/,
  /curl\s.*-o\s/,
  /curl\s.*--output\s/,
  /\bwget\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bkillall\b/,
  />\s*(\/etc|\/usr|\/bin|\/sbin|\/boot|\/sys|\/dev)/,
  /\bnpm\s+install\s+-g\b/,
  /\bnpm\s+i\s+-g\b/,
  /\bpip\s+install\b/,
  /\bformat\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\bsudo\b/,
  /\bsu\s/,
  /\bpasswd\b/,
];

/**
 * Returns true when the command is read-only and safe to run without approval.
 */
export function isSafeCommand(command: string): boolean {
  // Any unsafe pattern disqualifies immediately
  for (const p of UNSAFE_PATTERNS) {
    if (p.test(command)) return false;
  }
  // Must match at least one known-safe pattern
  for (const p of SAFE_PATTERNS) {
    if (p.test(command)) return true;
  }
  return false;
}

/**
 * Assess the risk level of an arbitrary command.
 * high  → irreversible / system-altering (rm -rf, DROP, sudo, mkfs, …)
 * medium → reversible but impactful (rm, mv overwrite, git push, curl download, …)
 * low   → everything else that wasn't classified as safe
 */
export function assessRisk(command: string): 'low' | 'medium' | 'high' {
  const HIGH: RegExp[] = [
    /rm\s+-rf/i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bformat\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bdd\s+if=/i,
    /\bpasswd\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
  ];
  const MEDIUM: RegExp[] = [
    /\brm\b/,
    /\bmv\b/,
    /\bcp\b.*--no-clobber/i,   // inverse: no-clobber is safe; plain cp may overwrite
    /\bchmod\b/,
    /\bchown\b/,
    /\bkill\b/,
    /\bpkill\b/,
    /\bkillall\b/,
    /\bcurl\b/,
    /\bwget\b/,
    /\bgit\s+push\b/,
    /\bgit\s+reset\b/,
    /\bgit\s+clean\b/,
    /\bgit\s+checkout\s+--\b/,
    /\bnpm\s+install\b/,
    /\bnpm\s+ci\b/,
    /\bnpm\s+run\b/,
    /\bpip\s+install\b/,
    /\bpip\s+uninstall\b/,
  ];

  for (const p of HIGH)   if (p.test(command)) return 'high';
  for (const p of MEDIUM) if (p.test(command)) return 'medium';
  return 'low';
}

// ── Queue operations ──────────────────────────────────────────────────────────

/**
 * Add a command to the approval queue.
 * @returns JSON: { id, command, risk, status: 'pending', message }
 */
export function enqueueCommand(command: string, reason = ''): string {
  const id: string = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const risk = assessRisk(command);
  const entry: PendingCommand = {
    id,
    command,
    reason: reason || 'No reason provided.',
    risk,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  const queue = readQueue();
  queue.push(entry);
  writeQueue(queue);
  return JSON.stringify({
    id,
    command,
    risk,
    status: 'pending',
    message: 'Awaiting user approval in terminal panel',
  });
}

/**
 * Return all commands currently in the queue.
 */
export function getPendingCommands(): PendingCommand[] {
  return readQueue();
}

/**
 * Execute an approved command (30 s timeout), record output, mark as executed.
 * @returns JSON: { id, output: string (max 3000 chars), exitCode: number }
 */
export async function approveCommand(id: string): Promise<string> {
  const queue = readQueue();
  const idx   = queue.findIndex(c => c.id === id);
  if (idx === -1) return JSON.stringify({ error: `Command ${id} not found.` });

  const entry = queue[idx];
  if (entry.status !== 'pending') {
    return JSON.stringify({ error: `Command is already ${entry.status}.` });
  }

  entry.status = 'approved';
  writeQueue(queue);

  let output    = '';
  let exitCode  = 0;

  try {
    const result = await execAsync(entry.command, { timeout: 30000 });
    output   = (result.stdout + result.stderr).slice(0, 3000);
    exitCode = 0;
    entry.status = 'executed';
  } catch (e: any) {
    output   = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`.slice(0, 3000);
    exitCode = e.code ?? 1;
    entry.status = 'error';
  }

  entry.output      = output;
  entry.resolvedAt  = new Date().toISOString();

  const freshQueue  = readQueue();
  const freshIdx    = freshQueue.findIndex(c => c.id === id);
  if (freshIdx !== -1) freshQueue[freshIdx] = entry;
  writeQueue(freshQueue);

  return JSON.stringify({ id, output, exitCode });
}

/**
 * Deny a pending command.
 * @returns JSON confirmation.
 */
export function denyCommand(id: string): string {
  const queue = readQueue();
  const idx   = queue.findIndex(c => c.id === id);
  if (idx === -1) return JSON.stringify({ error: `Command ${id} not found.` });

  queue[idx].status      = 'denied';
  queue[idx].resolvedAt  = new Date().toISOString();
  writeQueue(queue);
  return JSON.stringify({ id, status: 'denied' });
}

/**
 * Run a command immediately if it is safe, otherwise enqueue it for approval.
 * @returns Execution output, or an enqueue notice.
 */
export async function runSafe(command: string, reason = ''): Promise<string> {
  if (isSafeCommand(command)) {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      return (stdout + stderr).slice(0, 3000);
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }
  return enqueueCommand(command, reason);
}

/**
 * Remove all non-pending commands from the queue.
 * @returns JSON: { cleared: number }
 */
export function clearCompleted(): string {
  const queue    = readQueue();
  const before   = queue.length;
  const filtered = queue.filter(c => c.status === 'pending');
  writeQueue(filtered);
  return JSON.stringify({ cleared: before - filtered.length });
}

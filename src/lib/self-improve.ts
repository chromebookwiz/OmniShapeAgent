/**
 * self-improve.ts — Agent self-improvement infrastructure
 *
 * Enables the agent to read its own codebase, identify improvements, track
 * evolutionary history, and optionally apply patches.  All state is persisted
 * under DATA_DIR so the agent remembers what it has already tried.
 *
 * Design principles:
 *  - Never block the main agent loop; all I/O is synchronous file ops or fast.
 *  - Patch application is strictly additive string-replacement — no eval, no
 *    shell execution from this module.  The agent uses run_terminal_command for
 *    that if it chooses to rebuild.
 *  - Every session is logged so the agent can measure its own trajectory.
 */

import fs   from 'fs';
import path from 'path';
import { DATA_DIR } from './paths';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ImprovementCategory =
  | 'bug'
  | 'performance'
  | 'architecture'
  | 'missing_feature'
  | 'dead_code'
  | 'cognition'
  | 'learning';

export type ImprovementSeverity = 'critical' | 'major' | 'minor';

export interface ImprovementRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  targetFile: string;
  category: ImprovementCategory;
  severity: ImprovementSeverity;
  description: string;
  proposed: string;
  /** Exact string to replace. Empty means "add / restructure, not a simple replace". */
  oldCode: string;
  /** Replacement string. */
  newCode: string;
  applied: boolean;
  appliedAt?: number;
  outcomeNotes?: string;
}

export interface SelfImproveSession {
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  filesAnalyzed: string[];
  improvements: ImprovementRecord[];
  summary: string;
  /** Measured before/after metrics if available */
  metrics?: { before?: Record<string, number>; after?: Record<string, number> };
}

// ── Persistence ────────────────────────────────────────────────────────────────

const LOG_PATH = path.join(DATA_DIR, 'self-improve-log.json');
const MAX_SESSIONS = 30;

function loadLog(): SelfImproveSession[] {
  try {
    if (fs.existsSync(LOG_PATH)) return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  } catch { /* fresh start */ }
  return [];
}

function saveLog(log: SelfImproveSession[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log.slice(-MAX_SESSIONS), null, 2));
  } catch { /* non-fatal */ }
}

// ── Session management ─────────────────────────────────────────────────────────

export function startSession(filesAnalyzed: string[]): SelfImproveSession {
  const session: SelfImproveSession = {
    sessionId: `si_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt: Date.now(),
    filesAnalyzed,
    improvements: [],
    summary: '',
  };
  const log = loadLog();
  log.push(session);
  saveLog(log);
  return session;
}

export function finishSession(session: SelfImproveSession, summary: string): void {
  session.completedAt = Date.now();
  session.summary     = summary;
  const log = loadLog();
  const idx = log.findIndex(s => s.sessionId === session.sessionId);
  if (idx >= 0) log[idx] = session; else log.push(session);
  saveLog(log);
}

export function recordImprovement(
  session: SelfImproveSession,
  imp: Omit<ImprovementRecord, 'id' | 'sessionId' | 'timestamp' | 'applied'>
): ImprovementRecord {
  const record: ImprovementRecord = {
    ...imp,
    id:        `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    sessionId: session.sessionId,
    timestamp: Date.now(),
    applied:   false,
  };
  session.improvements.push(record);
  // Persist immediately so partial sessions survive crashes
  const log = loadLog();
  const idx = log.findIndex(s => s.sessionId === session.sessionId);
  if (idx >= 0) log[idx] = session; else log.push(session);
  saveLog(log);
  return record;
}

export function getSessions(): SelfImproveSession[] {
  return loadLog();
}

export function getLastSession(): SelfImproveSession | null {
  const log = loadLog();
  return log.length > 0 ? log[log.length - 1] : null;
}

/** Retrieve all improvements that have NOT been applied yet, across all sessions. */
export function getPendingImprovements(): ImprovementRecord[] {
  return loadLog()
    .flatMap(s => s.improvements)
    .filter(i => !i.applied)
    .sort((a, b) => {
      const sev = { critical: 3, major: 2, minor: 1 };
      return sev[b.severity] - sev[a.severity];
    });
}

// ── Patch application ──────────────────────────────────────────────────────────

/**
 * Apply a simple string-replacement patch to a source file.
 * Returns a human-readable result string the agent can read.
 */
export function applyPatch(
  filePath: string,
  oldCode:  string,
  newCode:  string,
  impId:    string
): string {
  if (!oldCode.trim()) return `skipped:${impId} — no oldCode provided; apply manually.`;
  try {
    const abs = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return `error:${impId} — file not found: ${filePath}`;
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes(oldCode)) return `error:${impId} — pattern not found in ${filePath}`;

    const patched = src.replace(oldCode, newCode);
    fs.writeFileSync(abs, patched, 'utf8');

    // Mark as applied in log
    const log = loadLog();
    for (const session of log) {
      const rec = session.improvements.find(i => i.id === impId);
      if (rec) { rec.applied = true; rec.appliedAt = Date.now(); break; }
    }
    saveLog(log);

    const deltaLines = newCode.split('\n').length - oldCode.split('\n').length;
    return `applied:${impId} — ${filePath} patched (+${deltaLines} net lines).`;
  } catch (e: unknown) {
    return `error:${impId} — ${(e as Error).message}`;
  }
}

// ── Source reading for analysis ────────────────────────────────────────────────

/** Files the agent should examine when doing a self-improvement pass. */
export const ANALYSIS_TARGETS: string[] = [
  'src/lib/agent.ts',
  'src/lib/vector-store.ts',
  'src/lib/memory-consolidator.ts',
  'src/lib/meta-learner.ts',
  'src/lib/user-profile.ts',
  'src/lib/orchestrator-client.ts',
  'src/lib/embeddings.ts',
  'src/lib/self-improve.ts',
];

/**
 * Read source files for analysis.  Large files are trimmed to
 * head+tail to stay within context limits.
 */
export function readSourcesForAnalysis(
  files:       string[] = ANALYSIS_TARGETS,
  maxLinesPerFile = 800
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    try {
      const abs  = path.resolve(process.cwd(), f);
      if (!fs.existsSync(abs)) continue;
      const text  = fs.readFileSync(abs, 'utf8');
      const lines = text.split('\n');
      if (lines.length <= maxLinesPerFile) {
        out[f] = text;
      } else {
        const head = lines.slice(0, Math.floor(maxLinesPerFile * 0.7)).join('\n');
        const tail = lines.slice(-Math.floor(maxLinesPerFile * 0.3)).join('\n');
        out[f] = `${head}\n\n// ... [${lines.length - maxLinesPerFile} lines omitted] ...\n\n${tail}`;
      }
    } catch { /* skip unreadable files */ }
  }
  return out;
}

// ── Improvement prompt builder ─────────────────────────────────────────────────

/**
 * Build the analysis prompt the agent sends to the LLM during self-improve mode.
 * Produces a focused prompt rather than dumping raw source.
 */
export function buildAnalysisPrompt(sources: Record<string, string>): string {
  const snippets = Object.entries(sources)
    .map(([f, c]) => `### ${f}\n\`\`\`typescript\n${c}\n\`\`\``)
    .join('\n\n');

  return `\
You are performing a focused self-analysis of your own source code.
Your goal: identify high-value improvements and output structured JSON for each one.

## Source Files
${snippets}

## What to look for
1. **Bugs** — logic errors, null dereferences, off-by-ones, unhandled async races
2. **Performance** — O(n²) scans, missing caches, redundant embedding calls, blocking I/O
3. **Cognition** — ways the agent loop can better mirror human deliberation (attention, WM, metacognition)
4. **Learning integration** — missed opportunities to share signal across memory/meta-learner/profile/orchestrator
5. **Dead code** — unreachable branches, unused exports, stale comments
6. **Missing features** — capabilities that would materially improve autonomous operation

## Output format
For each issue, output EXACTLY this block (no prose outside the blocks):

\`\`\`improvement
{
  "targetFile": "src/lib/...",
  "category": "bug|performance|architecture|missing_feature|dead_code|cognition|learning",
  "severity": "critical|major|minor",
  "description": "One clear sentence.",
  "proposed": "Specific fix in one to three sentences.",
  "oldCode": "exact verbatim string to replace, or empty string",
  "newCode": "replacement string, or empty string"
}
\`\`\`

Focus on actionable, high-impact improvements. Output 5–15 blocks.`;
}

// ── Statistics ─────────────────────────────────────────────────────────────────

export interface SelfImproveStats {
  totalSessions:    number;
  totalImprovements: number;
  applied:          number;
  pending:          number;
  bySeverity:       Record<ImprovementSeverity, number>;
  byCategory:       Record<ImprovementCategory, number>;
  lastSessionAt:    number | null;
}

export function getStats(): SelfImproveStats {
  const log  = loadLog();
  const all  = log.flatMap(s => s.improvements);
  const zero = (keys: string[]) => Object.fromEntries(keys.map(k => [k, 0])) as Record<string, number>;

  const bySev: Record<string, number> = zero(['critical', 'major', 'minor']);
  const byCat: Record<string, number> = zero(['bug','performance','architecture','missing_feature','dead_code','cognition','learning']);

  for (const i of all) {
    bySev[i.severity] = (bySev[i.severity] || 0) + 1;
    byCat[i.category] = (byCat[i.category] || 0) + 1;
  }

  return {
    totalSessions:     log.length,
    totalImprovements: all.length,
    applied:           all.filter(i => i.applied).length,
    pending:           all.filter(i => !i.applied).length,
    bySeverity:        bySev as Record<ImprovementSeverity, number>,
    byCategory:        byCat as Record<ImprovementCategory, number>,
    lastSessionAt:     log.length > 0 ? log[log.length - 1].startedAt : null,
  };
}

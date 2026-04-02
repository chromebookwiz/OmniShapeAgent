/**
 * Neural Orchestrator Client
 * ===========================
 * TypeScript interface to the Python FastAPI service running on port 7861.
 *
 * The orchestrator:
 *  1. Learns exclusively from USER messages (not the agent's).
 *  2. Emits directives that are injected into the agent's system context
 *     before each turn — steering the conversation flow.
 *  3. Training happens automatically in the background; this client
 *     is fire-and-forget for observations and near-instant for directives.
 */

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://127.0.0.1:7861';
const TIMEOUT_MS = 2000; // never block the agent loop for more than 2s

export interface OrchestratorDirective {
  directive:  string;    // text to inject into the agent's system context
  urgency:    number;    // 0–1: how forcefully to intervene
  confidence: number;    // 0–1: model confidence
  intent_idx: number;    // learned intent cluster ID
  source:     'model' | 'override' | 'below_threshold' | 'none';
}

export interface OrchestratorStatus {
  status:          'ok' | 'loading' | 'unavailable';
  train_steps:     number;
  buffer_size:     number;
  device:          string;
  override_active: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safePost<T>(path: string, body: unknown): Promise<T | null> {
  return fetchWithTimeout(`${ORCHESTRATOR_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
    .then(r => r.ok ? r.json() as Promise<T> : null)
    .catch(() => null);   // orchestrator offline → silent fallback
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a user message. Called every time the user sends a message.
 * Fire-and-forget — never awaited on the hot path.
 * Learning happens entirely on the Python side.
 */
export function observeUserMessage(opts: {
  text:       string;
  sessionId:  string;
  turnIndex:  number;
  hasImage?:  boolean;
}): void {
  safePost('/observe', {
    text:       opts.text,
    session_id: opts.sessionId,
    turn_index: opts.turnIndex,
    has_image:  opts.hasImage ?? false,
  }).catch(() => {});  // orchestrator offline — no-op
}

/**
 * Fetch the orchestrator's directive for the current session.
 * Returns null if the orchestrator is offline or below the urgency threshold.
 * Designed to be awaited before each agent loop iteration.
 */
export async function fetchDirective(
  sessionId: string,
  urgencyThreshold = 0.3,
): Promise<OrchestratorDirective | null> {
  const result = await safePost<OrchestratorDirective>('/directive', {
    session_id:        sessionId,
    urgency_threshold: urgencyThreshold,
  });
  if (!result || !result.directive) return null;
  return result;
}

/**
 * Manually inject a directive override (from the UI, debugging, etc.)
 * The override lasts ttlSeconds and takes priority over the model output.
 */
export async function injectDirective(directive: string, ttlSeconds = 60): Promise<boolean> {
  const r = await safePost<{ ok: boolean }>('/inject', { directive, ttl_seconds: ttlSeconds });
  return r?.ok ?? false;
}

/** Clear any active manual override. */
export async function clearDirectiveOverride(): Promise<void> {
  await fetchWithTimeout(`${ORCHESTRATOR_URL}/inject`, { method: 'DELETE' }).catch(() => {});
}

/** Get orchestrator health and training stats. */
export async function getOrchestratorStatus(): Promise<OrchestratorStatus> {
  try {
    const r = await fetchWithTimeout(`${ORCHESTRATOR_URL}/status`, { method: 'GET' });
    if (r.ok) return await r.json() as OrchestratorStatus;
  } catch {}
  return { status: 'unavailable', train_steps: 0, buffer_size: 0, device: 'N/A', override_active: false };
}

/**
 * Format a directive for injection into the agent's system context.
 * Wraps the directive in a clearly-labeled XML block so the agent
 * can distinguish it from user content.
 */
export function formatDirectiveInjection(d: OrchestratorDirective): string {
  return (
    `<ORCHESTRATOR_DIRECTIVE urgency="${d.urgency.toFixed(2)}" confidence="${d.confidence.toFixed(2)}" intent="${d.intent_idx}">\n` +
    `${d.directive}\n` +
    `</ORCHESTRATOR_DIRECTIVE>`
  );
}

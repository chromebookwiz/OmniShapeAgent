// src/lib/subroutine-bus.ts
// In-memory architect ↔ subroutine message bus.
// All state lives in-process (Next.js server). No persistence needed — subroutines are transient.

export interface BusMessage {
  from: 'subroutine' | 'architect';
  content: string;
  timestamp: number;
}

interface SubroutineEntry {
  status: 'running' | 'done' | 'error';
  messages: BusMessage[];
  taskPrompt: string;
  windowId: string;
  createdAt: number;
}

const _bus = new Map<string, SubroutineEntry>();

export function registerSubroutine(id: string, taskPrompt: string, windowId: string): void {
  _bus.set(id, {
    status: 'running',
    messages: [],
    taskPrompt,
    windowId,
    createdAt: Date.now(),
  });
}

/** Subroutine (or client on its behalf) posts a message back to the architect. */
export function postToArchitect(subroutineId: string, content: string): void {
  const entry = _bus.get(subroutineId);
  if (!entry) return;
  entry.messages.push({ from: 'subroutine', content, timestamp: Date.now() });
}

/** Architect calls this to drain all pending messages for a subroutine. Clears the queue. */
export function drainMessages(subroutineId: string): BusMessage[] {
  const entry = _bus.get(subroutineId);
  if (!entry) return [];
  const msgs = [...entry.messages];
  entry.messages = [];
  return msgs;
}

export function markDone(subroutineId: string, result?: string): void {
  const entry = _bus.get(subroutineId);
  if (!entry) return;
  entry.status = 'done';
  if (result) {
    entry.messages.push({ from: 'subroutine', content: result, timestamp: Date.now() });
  }
}

export function markError(subroutineId: string, error: string): void {
  const entry = _bus.get(subroutineId);
  if (!entry) return;
  entry.status = 'error';
  entry.messages.push({ from: 'subroutine', content: `ERROR: ${error}`, timestamp: Date.now() });
}

export function getStatus(subroutineId: string): { status: string; taskPrompt: string; windowId: string } | null {
  const entry = _bus.get(subroutineId);
  if (!entry) return null;
  return { status: entry.status, taskPrompt: entry.taskPrompt, windowId: entry.windowId };
}

export function listSubroutines(): { id: string; status: string; taskPrompt: string; windowId: string; createdAt: number }[] {
  return Array.from(_bus.entries()).map(([id, e]) => ({
    id,
    status: e.status,
    taskPrompt: e.taskPrompt,
    windowId: e.windowId,
    createdAt: e.createdAt,
  }));
}

/** Remove done/error entries older than 1 hour to prevent unbounded growth. */
export function gc(): void {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, entry] of _bus.entries()) {
    if (entry.status !== 'running' && entry.createdAt < cutoff) {
      _bus.delete(id);
    }
  }
}

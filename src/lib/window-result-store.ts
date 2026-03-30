// src/lib/window-result-store.ts
// Server-side store for UI window creation results.
// Agent uses check_window_result(id) to see if a window loaded or errored.

interface WindowResult {
  id: string;
  status: 'created' | 'loaded' | 'error';
  error?: string;
  timestamp: number;
}

const _results = new Map<string, WindowResult>();

export function setWindowResult(id: string, status: WindowResult['status'], error?: string): void {
  _results.set(id, { id, status, error, timestamp: Date.now() });
}

export function getWindowResult(id: string): WindowResult | null {
  return _results.get(id) ?? null;
}

export function clearWindowResult(id: string): void {
  _results.delete(id);
}

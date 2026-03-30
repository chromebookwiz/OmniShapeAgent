"use client";

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskLevel = 'low' | 'medium' | 'high';

interface PendingCommand {
  id: string;
  command: string;
  risk: RiskLevel;
  reason: string;
  createdAt?: string;
}

interface LogEntry {
  id: string;
  command: string;
  exitCode: number;
  output: string;
  timestamp: string;
  expanded: boolean;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const TerminalIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

// ── Risk badge ────────────────────────────────────────────────────────────────

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-green-900/40 text-green-400 border border-green-700/40',
  medium: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
  high: 'bg-red-900/40 text-red-400 border border-red-700/40',
};

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${RISK_STYLES[level]}`}>
      {level}
    </span>
  );
}

// ── Pending command row ───────────────────────────────────────────────────────

interface PendingRowProps {
  cmd: PendingCommand;
  onAccept: (id: string) => void;
  onDeny: (id: string) => void;
  actionInProgress: string | null;
}

function PendingRow({ cmd, onAccept, onDeny, actionInProgress }: PendingRowProps) {
  const busy = actionInProgress === cmd.id;
  return (
    <div className="border border-[#1a1a1a] rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <code className="text-[11px] font-mono text-green-400 flex-1 break-all leading-relaxed">
          {cmd.command}
        </code>
        <RiskBadge level={cmd.risk} />
      </div>
      {cmd.reason && (
        <p className="text-[10px] text-[#666] leading-relaxed border-l-2 border-[#333] pl-2">{cmd.reason}</p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onAccept(cmd.id)}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700/30 hover:bg-green-700/50 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-md transition-colors active:scale-95 disabled:opacity-40"
        >
          <CheckIcon />
          Accept
        </button>
        <button
          onClick={() => onDeny(cmd.id)}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-md transition-colors active:scale-95 disabled:opacity-40"
        >
          <XIcon />
          Deny
        </button>
      </div>
    </div>
  );
}

// ── Log entry row ─────────────────────────────────────────────────────────────

interface LogRowProps {
  entry: LogEntry;
  onToggle: (id: string) => void;
}

function LogRow({ entry, onToggle }: LogRowProps) {
  const lines = entry.output.split('\n');
  const truncated = lines.length > 5 && !entry.expanded;
  const visibleOutput = truncated ? lines.slice(0, 5).join('\n') + '\n...' : entry.output;

  return (
    <div className="border-b border-[#111] pb-3 mb-3 last:border-b-0 last:mb-0">
      {/* Command line */}
      <div className="flex items-center gap-2">
        <span className="text-[#444] text-[10px] font-mono select-none">$</span>
        <code className="text-[11px] font-mono text-[#aaa] flex-1 break-all">{entry.command}</code>
        <span
          className={`text-[9px] font-black tabular-nums ${
            entry.exitCode === 0 ? 'text-green-500' : 'text-red-400'
          }`}
        >
          [{entry.exitCode}]
        </span>
        <span className="text-[9px] text-[#444] font-mono">{entry.timestamp}</span>
      </div>

      {/* Output */}
      {entry.output && (
        <div className="mt-1.5 ml-4">
          <pre className="text-[10px] font-mono text-[#888] whitespace-pre-wrap leading-relaxed break-all">
            {visibleOutput}
          </pre>
          {lines.length > 5 && (
            <button
              onClick={() => onToggle(entry.id)}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#555] hover:text-[#aaa] mt-1 transition-colors"
            >
              {entry.expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              {entry.expanded ? 'Collapse' : `Show ${lines.length - 5} more lines`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Terminal() {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<PendingCommand[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Polling ───────────────────────────────────────────────────────────────────

  // Refs to avoid stale closures inside self-scheduling poll loop
  const pendingCountRef = useRef(0);
  const prevCountRef = useRef(0);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/terminal?action=pending');
      if (!res.ok) throw new Error('poll failed');
      const data = await res.json();
      // API returns { pending: PendingCommand[], count: number }
      const list: PendingCommand[] = Array.isArray(data) ? data : (data.pending ?? []);
      setPending(list);
      pendingCountRef.current = list.length;
      // Auto-expand when new pending items arrive
      if (list.length > 0 && prevCountRef.current === 0) {
        setExpanded(true);
      }
      prevCountRef.current = list.length;
      setFetchError(false);
    } catch {
      setFetchError(true);
    }
  }, []);

  // Self-scheduling adaptive poll: fast when pending, slow when idle, paused when hidden
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled) return;
      await fetchPending();
      if (!cancelled) {
        const delay = document.hidden
          ? 20000
          : pendingCountRef.current > 0 ? 1500 : 7000;
        timer = setTimeout(poll, delay);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchPending]);

  // ── Scroll log to bottom ──────────────────────────────────────────────────────

  useEffect(() => {
    if (expanded) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log, expanded]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleAccept = async (id: string) => {
    setActionInProgress(id);
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id }),
      });
      if (res.ok) {
        const data: { command?: string; exitCode?: number; output?: string } = await res.json();
        const newEntry: LogEntry = {
          id: `log-${Date.now()}`,
          command: data.command ?? id,
          exitCode: data.exitCode ?? 0,
          output: data.output ?? '',
          timestamp: new Date().toLocaleTimeString(),
          expanded: false,
        };
        setLog((prev) => [...prev, newEntry]);
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    } catch {
      // ignore — keep in pending
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeny = async (id: string) => {
    setActionInProgress(id);
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deny', id }),
      });
      setPending((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  };

  const toggleLogEntry = (id: string) => {
    setLog((prev) =>
      prev.map((e) => (e.id === id ? { ...e, expanded: !e.expanded } : e))
    );
  };

  const clearCompleted = () => setLog([]);

  // ── Minimized state ───────────────────────────────────────────────────────────

  if (!expanded) {
    return (
      <div className="fixed bottom-20 left-4 z-50">
        <button
          onClick={() => setExpanded(true)}
          title="Open terminal"
          className="relative w-11 h-11 bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl flex items-center justify-center text-green-400 hover:border-green-700/60 hover:text-green-300 transition-all active:scale-95 shadow-lg"
        >
          <TerminalIcon />
          {/* Pending count badge */}
          {pending.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-[#0a0a0a] text-[8px] font-black rounded-full flex items-center justify-center">
              {pending.length > 9 ? '9+' : pending.length}
            </span>
          )}
          {/* Offline dot */}
          {fetchError && (
            <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#0a0a0a]" />
          )}
        </button>
      </div>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed bottom-4 left-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] h-[360px] flex flex-col bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden"
      style={{ fontFamily: 'monospace' }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a1a1a] flex-shrink-0">
        <div className="flex items-center gap-2 text-green-400">
          <TerminalIcon />
          <span className="text-[10px] font-black uppercase tracking-widest">Terminal</span>
          {fetchError && (
            <span className="text-[8px] font-black uppercase tracking-widest text-red-400">· offline</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {log.length > 0 && (
            <button
              onClick={clearCompleted}
              title="Clear log"
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-[#555] hover:text-red-400 transition-colors"
            >
              <TrashIcon />
              Clear
            </button>
          )}
          <button
            onClick={() => setExpanded(false)}
            title="Minimize"
            className="p-1.5 hover:bg-[#1a1a1a] rounded-lg transition-colors text-[#555] hover:text-[#aaa]"
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>

      {/* Body — two sections stacked */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {/* Section 1: Pending commands */}
        {pending.length > 0 && (
          <div className="flex-shrink-0 border-b border-[#1a1a1a] max-h-48 overflow-y-auto">
            <div className="px-4 pt-3 pb-1">
              <p className="text-[8px] font-black uppercase tracking-[0.3em] text-amber-500 mb-2">
                Pending Approval ({pending.length})
              </p>
              <div className="space-y-2">
                {pending.map((cmd) => (
                  <PendingRow
                    key={cmd.id}
                    cmd={cmd}
                    onAccept={handleAccept}
                    onDeny={handleDeny}
                    actionInProgress={actionInProgress}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Output log */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {log.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full opacity-20 text-center">
              <TerminalIcon />
              <p className="text-[9px] font-black uppercase tracking-[0.3em] mt-3 text-[#aaa]">
                {pending.length === 0 ? 'Awaiting commands' : 'Log empty'}
              </p>
            </div>
          ) : (
            <>
              {log.length > 0 && (
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-[#444] mb-3">
                  Output Log ({log.length})
                </p>
              )}
              {log.map((entry) => (
                <LogRow key={entry.id} entry={entry} onToggle={toggleLogEntry} />
              ))}
              <div ref={logEndRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

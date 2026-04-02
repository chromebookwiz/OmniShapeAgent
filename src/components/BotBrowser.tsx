"use client";

import { useState, useRef, useEffect, useCallback } from 'react';

// Domains known to block iframe embedding with X-Frame-Options / CSP frame-ancestors.
// These are routed through the server-side proxy to strip those headers.
const PROXY_DOMAINS = new Set([
  'agar.io', 'www.agar.io',
  'slither.io', 'www.slither.io',
  'diep.io', 'www.diep.io',
  'krunker.io', 'www.krunker.io',
  'zombs.io',
  'moomoo.io',
]);

function proxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (PROXY_DOMAINS.has(u.hostname)) {
      return `/api/proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

export interface BotWindowState {
  id: string;
  url: string;
  goal: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  status: 'idle' | 'deploying' | 'running' | 'stopped' | 'error';
  lastMetric?: string;
}

// ── Single bot window ──────────────────────────────────────────────────────────

interface BotWindowProps {
  bot: BotWindowState;
  onClose: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BotWindowState>) => void;
  onDeploy: (bot: BotWindowState) => void;
}

function BotWindow({ bot, onClose, onUpdate, onDeploy }: BotWindowProps) {
  const [urlInput, setUrlInput] = useState(bot.url);
  const [goalInput, setGoalInput] = useState(bot.goal);
  const [log, setLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: bot.x, oy: bot.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      onUpdate(bot.id, {
        x: Math.max(0, dragRef.current.ox + ev.clientX - dragRef.current.sx),
        y: Math.max(0, dragRef.current.oy + ev.clientY - dragRef.current.sy),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [bot.id, bot.x, bot.y, onUpdate]);

  const deploy = async () => {
    const updated = { ...bot, url: urlInput, goal: goalInput };
    onUpdate(bot.id, { url: urlInput, goal: goalInput, status: 'deploying' });
    setLog([`[${new Date().toLocaleTimeString()}] Deploying ${bot.id} → ${goalInput} @ ${urlInput}...`]);
    setLogOpen(true);

    // Compute approximate screen region from element position
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const region = rect ? {
      x: Math.round(rect.left),
      y: Math.round(rect.top + 86),       // below title + controls
      w: Math.round(rect.width),
      h: Math.round(rect.height - 86),
    } : undefined;

    const prompt = [
      `deploy_bot with:`,
      `  botId: "${bot.id}"`,
      `  url: "${urlInput}"`,
      `  goal: "${goalInput}"`,
      region ? `  region: {"x":${region.x},"y":${region.y},"w":${region.w},"h":${region.h}}` : '',
    ].filter(Boolean).join('\n');

    // Read the currently active model from localStorage (set by Chat.tsx settings)
    const activeModel = (() => { try { return localStorage.getItem('sa_active_model') ?? undefined; } catch { return undefined; } })();

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Please ${prompt}`,
          history: [],
          ...(activeModel ? { model: activeModel } : {}),
          stream: true,
        }),
      });

      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            if (chunk.type === 'text' || chunk.type === 'status') {
              setLog(prev => [...prev, `[${chunk.type}] ${chunk.content.slice(0, 120)}`]);
            }
            if (chunk.type === 'done') {
              onUpdate(bot.id, { status: 'running' });
              setLog(prev => [...prev, `✓ Bot deployed and running.`]);
            }
          } catch { /* partial JSON */ }
        }
      }
    } catch (err: any) {
      onUpdate(bot.id, { status: 'error' });
      setLog(prev => [...prev, `✗ Error: ${err.message}`]);
    }

    onDeploy(updated);
  };

  const statusDot: Record<string, string> = {
    idle: '#555', deploying: '#f5a623', running: '#3dc',
    stopped: '#888', error: '#e44',
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed', left: bot.x, top: bot.y, zIndex: 1000,
        width: bot.width, height: bot.minimized ? 40 : bot.height,
        display: 'flex', flexDirection: 'column',
        background: '#080808',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        boxShadow: '0 12px 48px rgba(0,0,0,0.8)',
        overflow: 'hidden',
        resize: bot.minimized ? 'none' : 'both',
        minWidth: 320, minHeight: bot.minimized ? 40 : 200,
      }}
    >
      {/* ── Title bar ────────────────────────────────────────────────── */}
      <div
        onMouseDown={handleTitleMouseDown}
        style={{
          height: 40, minHeight: 40, display: 'flex', alignItems: 'center',
          gap: 8, padding: '0 10px',
          background: '#0e0e0e',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          cursor: 'grab', userSelect: 'none', flexShrink: 0,
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusDot[bot.status] ?? '#555', flexShrink: 0,
          boxShadow: bot.status === 'running' ? `0 0 6px ${statusDot.running}` : 'none',
        }} />
        <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{bot.id}</span>
        <span style={{
          fontSize: 11, color: '#aaa', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {bot.goal || bot.url}
        </span>
        {bot.lastMetric && (
          <span style={{
            fontSize: 10, fontFamily: 'monospace',
            color: '#3dc', padding: '1px 6px',
            background: 'rgba(51,221,204,0.08)',
            border: '1px solid rgba(51,221,204,0.2)',
            borderRadius: 4,
          }}>
            {bot.lastMetric}
          </span>
        )}
        <button onClick={() => setLogOpen(o => !o)}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
          title="Toggle log">≡</button>
        <button onClick={() => onUpdate(bot.id, { minimized: !bot.minimized })}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}>
          {bot.minimized ? '□' : '─'}
        </button>
        <button onClick={() => onClose(bot.id)}
          style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, padding: '2px 4px' }}>
          ×
        </button>
      </div>

      {!bot.minimized && (
        <>
          {/* ── Controls bar ─────────────────────────────────────────── */}
          <div style={{
            display: 'flex', gap: 6, padding: '5px 8px',
            background: '#0b0b0b',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            flexShrink: 0,
          }}>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="URL"
              style={{
                flex: 1, fontSize: 11, fontFamily: 'monospace',
                background: '#141414', border: '1px solid rgba(255,255,255,0.08)',
                color: '#ccc', borderRadius: 3, padding: '3px 7px', outline: 'none',
              }}
            />
            <input
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              placeholder="Goal (e.g. maximize score)"
              style={{
                width: 170, fontSize: 11, fontFamily: 'monospace',
                background: '#141414', border: '1px solid rgba(255,255,255,0.08)',
                color: '#ccc', borderRadius: 3, padding: '3px 7px', outline: 'none',
              }}
            />
            <button
              onClick={deploy}
              disabled={bot.status === 'running' || bot.status === 'deploying'}
              style={{
                fontSize: 11, fontFamily: 'monospace',
                background: bot.status === 'running' ? '#0d2a1e' : '#071a12',
                border: `1px solid ${bot.status === 'running' ? 'rgba(51,221,204,0.5)' : 'rgba(51,221,204,0.2)'}`,
                color: '#3dc', borderRadius: 3, padding: '3px 10px',
                cursor: bot.status === 'running' || bot.status === 'deploying' ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}
            >
              {bot.status === 'deploying' ? '↻ Deploying' : bot.status === 'running' ? '⚡ Running' : '⚡ Deploy Bot'}
            </button>
            {bot.status === 'running' && (
              <button
                onClick={async () => {
                  await fetch('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', botId: bot.id }) });
                  onUpdate(bot.id, { status: 'stopped' });
                  setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] Stop requested.`]);
                }}
                style={{
                  fontSize: 11, background: '#1a0808',
                  border: '1px solid rgba(228,68,68,0.3)', color: '#e44',
                  borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace',
                }}
              >
                ■ Stop
              </button>
            )}
          </div>

          {/* ── Main area: iframe + optional log ─────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <iframe
              src={urlInput ? proxyUrl(urlInput) : 'about:blank'}
              style={{ flex: logOpen ? '1 1 60%' : '1 1 100%', border: 'none', background: '#000' }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title={bot.id}
            />

            {logOpen && (
              <div style={{
                flex: '0 0 30%', overflowY: 'auto',
                background: '#050505',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                padding: '6px 10px',
                fontFamily: 'monospace', fontSize: 10, color: '#666',
                lineHeight: 1.6,
              }}>
                {log.map((line, i) => (
                  <div key={i} style={{ color: line.startsWith('✓') ? '#3dc' : line.startsWith('✗') ? '#e44' : '#555' }}>
                    {line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Manager (renders all windows + launch button) ─────────────────────────────

export default function BotBrowserManager() {
  const [bots, setBots] = useState<BotWindowState[]>([]);
  const counterRef = useRef(1);

  // Poll registry for live metric updates
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/bots');
        if (!res.ok) return;
        const { bots: registry } = await res.json();
        if (!Array.isArray(registry)) return;
        setBots(prev => prev.map(b => {
          const r = registry.find((x: any) => x.id === b.id);
          if (!r) return b;
          return {
            ...b,
            status: r.status === 'running' ? 'running' : r.status === 'stopped' ? 'stopped' : 'error',
            lastMetric: r.lastMetric ?? b.lastMetric,
          };
        }));
      } catch {}
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const close = (id: string) => setBots(prev => prev.filter(b => b.id !== id));
  const update = (id: string, patch: Partial<BotWindowState>) =>
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));

  return (
    <>
      {/* ── Bot windows ───────────────────────────────────────────── */}
      {bots.map(bot => (
        <BotWindow
          key={bot.id}
          bot={bot}
          onClose={close}
          onUpdate={update}
          onDeploy={() => {}}
        />
      ))}
    </>
  );
}

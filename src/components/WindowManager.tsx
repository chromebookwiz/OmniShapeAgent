"use client";

/**
 * WindowManager — Floating, draggable, closable, minimizable window layer.
 *
 * Usage (in Chat.tsx):
 *   import { useWindowManager } from './WindowManager';
 *   const wm = useWindowManager();
 *   wm.dispatch({ op: 'create', id: 'myWin', title: 'Hello', contentType: 'html', content: '<b>hi</b>' });
 *
 * Usage (in page.tsx):
 *   import { WindowLayer, WindowManagerProvider } from './WindowManager';
 *   <WindowManagerProvider><App /><WindowLayer /></WindowManagerProvider>
 */

import {
  useState, useRef, useEffect, useCallback,
  createContext, useContext, useReducer,
} from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import type { PhysicsCmd } from './PhysicsSimulator';
const PhysicsSimulator = dynamic(() => import('./PhysicsSimulator'), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────────────────

export type WindowContentType = 'html' | 'iframe' | 'terminal' | 'code' | 'image' | 'physics';

export interface WindowState {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  zIndex: number;
  contentType: WindowContentType;
  content: string;            // HTML string or URL (for iframe)
  terminalLines: string[];    // append-only log (for terminal type)
  physicsCmds: PhysicsCmd[];  // queued physics commands
}

export type WindowEvent =
  | { op: 'create';               id: string; title?: string; contentType?: WindowContentType; content?: string; x?: number; y?: number; w?: number; h?: number }
  | { op: 'close';                id: string }
  | { op: 'set_html';             id: string; content: string }
  | { op: 'edit_html';            id: string; selector: string; html: string }
  | { op: 'set_iframe';           id: string; content: string; title?: string }
  | { op: 'set_image';            id: string; content: string; title?: string }
  | { op: 'append_terminal';      id: string; content: string; title?: string }
  | { op: 'ensure_terminal';      id: string; title?: string }
  | { op: 'focus';                id: string }
  | { op: 'minimize';             id: string }
  | { op: 'restore';              id: string }
  | { op: 'save_window';          id: string }
  | { op: 'restore_saved_window'; id: string }
  | { op: 'eval_js';              id: string; code: string }
  | { op: 'physics_cmd';          id: string; cmd: object };

export interface WindowManagerAPI {
  dispatch:       (event: WindowEvent) => void;
  windows:        WindowState[];
  savedWindows:   Record<string, Partial<WindowState>>;
  registerIframe: (id: string, el: HTMLIFrameElement | null) => void;
}

// ── Context ────────────────────────────────────────────────────────────────────

const WMContext = createContext<WindowManagerAPI | null>(null);

export function useWindowManager(): WindowManagerAPI {
  const ctx = useContext(WMContext);
  if (!ctx) throw new Error('useWindowManager must be used inside WindowManagerProvider');
  return ctx;
}

// ── postMessage listener injector ─────────────────────────────────────────────

/** Auto-inject a postMessage listener + error/load reporter into HTML window content. */
function injectMessageListener(html: string, windowId?: string): string {
  const idVar = windowId ? `window.__sa_id=${JSON.stringify(windowId)};` : '';
  const script = `<script>
(function(){if(window.__sa_ml)return;window.__sa_ml=1;
${idVar}
// postMessage handlers for live edit + eval
window.addEventListener('message',function(e){
  if(!e.data||typeof e.data!=='object')return;
  var d=e.data;
  if(d.op==='edit_html'&&d.selector){
    try{var el=document.querySelector(d.selector);if(el)el.innerHTML=d.html||'';}catch(x){}
  } else if(d.op==='eval_js'&&d.code){
    try{(0,eval)(d.code);}catch(x){console.error('[SA eval]',x);}
  }
});
// Report load success to agent
window.addEventListener('load',function(){
  if(!window.__sa_id)return;
  fetch('/api/window-result',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:window.__sa_id,status:'loaded'})}).catch(function(){});
});
// Report JS errors to agent
window.onerror=function(msg,src,line,col,err){
  if(!window.__sa_id)return false;
  fetch('/api/window-result',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:window.__sa_id,status:'error',error:String(msg)+' at '+src+':'+line})}).catch(function(){});
  return false;
};
})();
</script>`;
  if (html.includes('</head>')) return html.replace('</head>', script + '</head>');
  if (/<body[^>]*>/.test(html)) return html.replace(/(<body[^>]*>)/, '$1' + script);
  if (html.includes('</html>')) return html.replace('</html>', script + '</html>');
  return html + script;
}

// ── Reducer ────────────────────────────────────────────────────────────────────

let _nextZ = 100;

function editHtml(html: string, selector: string, innerHtml: string): string {
  // Simple regex-based inner HTML replacement for class/id selectors
  // Works for: '#id', '.class', 'tag'
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Try to match <TAG ... id="..." or class="..."> ... </TAG>
  const idMatch = selector.startsWith('#')
    ? new RegExp(`(<[^>]+id="${selector.slice(1)}"[^>]*>)([\s\S]*?)(<\\/[a-zA-Z]+>)`)
    : selector.startsWith('.')
    ? new RegExp(`(<[^>]+class="[^"]*${selector.slice(1)}[^"]*"[^>]*>)([\s\S]*?)(<\\/[a-zA-Z]+>)`)
    : new RegExp(`(<${esc}[^>]*>)([\s\S]*?)(<\\/${esc}>)`);
  if (idMatch.test(html)) return html.replace(idMatch, `$1${innerHtml}$3`);
  return html; // No match — return unchanged
}

type WMAction = WindowEvent | { op: '_move'; id: string; x: number; y: number } | { op: '_resize'; id: string; w: number; h: number };

function wmReducer(windows: WindowState[], action: WMAction): WindowState[] {
  switch (action.op) {
    case 'create': {
      const existing = windows.find(w => w.id === action.id);
      if (existing) {
        // Already exists — bring to front & restore
        return windows.map(w => w.id === action.id
          ? { ...w, minimized: false, zIndex: ++_nextZ }
          : w
        );
      }
      const count = windows.length;
      return [...windows, {
        id:          action.id,
        title:       action.title ?? action.id,
        x:           action.x ?? 80 + count * 30,
        y:           action.y ?? 80 + count * 24,
        w:           action.w ?? 640,
        h:           action.h ?? 420,
        minimized:   false,
        zIndex:      ++_nextZ,
        contentType: action.contentType ?? 'html',
        content:     action.content ?? '',
        terminalLines: [],
        physicsCmds: [],
      }];
    }

    case 'close':
      return windows.filter(w => w.id !== action.id);

    case 'set_html':
      return windows.map(w => w.id === action.id
        ? { ...w, content: action.content, contentType: 'html' }
        : w);

    case 'edit_html':
      return windows.map(w => w.id === action.id && w.contentType === 'html'
        ? { ...w, content: editHtml(w.content, action.selector, action.html) }
        : w);

    case 'set_iframe':
      return windows.map(w => w.id === action.id
        ? { ...w, content: action.content, contentType: 'iframe', title: action.title ?? w.title }
        : w);

    case 'set_image': {
      const existing = windows.find(w => w.id === action.id);
      if (existing) {
        return windows.map(w => w.id === action.id
          ? { ...w, content: action.content, contentType: 'image', title: action.title ?? w.title, minimized: false, zIndex: ++_nextZ }
          : w);
      }
      const count = windows.length;
      return [...windows, {
        id: action.id, title: action.title ?? action.id,
        x: 100 + count * 30, y: 100 + count * 20,
        w: 640, h: 480,
        minimized: false, zIndex: ++_nextZ,
        contentType: 'image', content: action.content,
        terminalLines: [], physicsCmds: [],
      }];
    }

    case 'ensure_terminal': {
      const existing = windows.find(w => w.id === action.id);
      if (existing) return windows.map(w => w.id === action.id ? { ...w, minimized: false, zIndex: ++_nextZ } : w);
      const count = windows.length;
      return [...windows, {
        id: action.id, title: action.title ?? '⚡ Terminal',
        x: 40, y: 40 + count * 20,
        w: 760, h: 380,
        minimized: false, zIndex: ++_nextZ,
        contentType: 'terminal', content: '',
        terminalLines: [], physicsCmds: [],
      }];
    }

    case 'append_terminal':
      return windows.map(w => {
        if (w.id !== action.id) return w;
        const lines = [...w.terminalLines, action.content];
        // Cap at 1000 lines to prevent unbounded growth
        return { ...w, terminalLines: lines.length > 1000 ? lines.slice(-800) : lines, zIndex: w.zIndex };
      });

    case 'focus':
      return windows.map(w => w.id === action.id ? { ...w, zIndex: ++_nextZ, minimized: false } : w);

    case 'minimize':
      return windows.map(w => w.id === action.id ? { ...w, minimized: true } : w);

    case 'restore':
      return windows.map(w => w.id === action.id ? { ...w, minimized: false, zIndex: ++_nextZ } : w);

    case '_move':
      return windows.map(w => w.id === action.id ? { ...w, x: action.x, y: action.y } : w);

    case '_resize':
      return windows.map(w => w.id === action.id
        ? { ...w, w: Math.max(280, action.w), h: Math.max(160, action.h) }
        : w);

    case 'eval_js':
      return windows; // Handled via postMessage in dispatch

    case 'physics_cmd':
      return windows.map(w => w.id === action.id
        ? { ...w, physicsCmds: [...w.physicsCmds, action.cmd as PhysicsCmd], minimized: false, zIndex: ++_nextZ }
        : w);

    default:
      return windows;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────────

const SAVED_KEY = 'sa_saved_windows';

export function WindowManagerProvider({ children }: { children: React.ReactNode }) {
  const [windows, dispatchRaw] = useReducer(wmReducer, []);
  const [savedWindows, setSavedWindows] = useState<Record<string, Partial<WindowState>>>({});
  const iframesRef = useRef<Map<string, HTMLIFrameElement>>(new Map());

  // Load saved windows from localStorage on mount (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage on mount to rehydrate saved windows is intentional initialization, not a cascading side effect
      if (raw) setSavedWindows(JSON.parse(raw));
    } catch {}
  }, []);

  const registerIframe = useCallback((id: string, el: HTMLIFrameElement | null) => {
    if (el) iframesRef.current.set(id, el);
    else iframesRef.current.delete(id);
  }, []);

  const dispatch = useCallback((e: WindowEvent) => {
    // postMessage-based live updates — no iframe reload
    if (e.op === 'edit_html' || e.op === 'eval_js') {
      const iframe = iframesRef.current.get(e.id);
      if (iframe?.contentWindow) {
        if (e.op === 'edit_html') {
          const html = (e as any).html ?? (e as any).content ?? '';
          iframe.contentWindow.postMessage({ op: 'edit_html', selector: (e as any).selector, html }, '*');
        } else {
          iframe.contentWindow.postMessage({ op: 'eval_js', code: e.code }, '*');
        }
        return; // live update only — no state change → no reload
      }
      // Iframe not mounted yet — fall through to state update
    }

    if (e.op === 'save_window') {
      setSavedWindows(prev => {
        const win = windows.find(w => w.id === e.id);
        if (!win) return prev;
        const next = { ...prev, [e.id]: { ...win } };
        try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
      return;
    }
    if (e.op === 'restore_saved_window') {
      setSavedWindows(prev => {
        const saved = prev[e.id];
        if (saved) {
          dispatchRaw({ op: 'create', id: e.id, ...saved } as WindowEvent);
        }
        return prev;
      });
      return;
    }
    dispatchRaw(e);
  }, [windows]);

  return (
    <WMContext.Provider value={{ dispatch, windows, savedWindows, registerIframe }}>
      {children}
    </WMContext.Provider>
  );
}

// ── Window chrome ──────────────────────────────────────────────────────────────

function DraggableWindow({
  win,
  dispatch,
  registerIframe,
}: {
  win:            WindowState;
  dispatch:       (e: WMAction) => void;
  registerIframe: (id: string, el: HTMLIFrameElement | null) => void;
}) {
  const barRef     = useRef<HTMLDivElement>(null);
  const frameRef   = useRef<HTMLDivElement>(null);
  const termEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (win.contentType === 'terminal') {
      termEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [win.terminalLines, win.contentType]);

  // ── Drag ──────────────────────────────────────────────────────────
  const onMouseDownBar = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const startX  = e.clientX - win.x;
    const startY  = e.clientY - win.y;
    dispatch({ op: 'focus', id: win.id });

    function onMove(ev: MouseEvent) {
      dispatch({ op: '_move', id: win.id, x: ev.clientX - startX, y: ev.clientY - startY });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [win.id, win.x, win.y, dispatch]);

  // ── Resize ────────────────────────────────────────────────────────
  const onMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW  = win.w;
    const startH  = win.h;
    const startX  = e.clientX;
    const startY  = e.clientY;

    function onMove(ev: MouseEvent) {
      dispatch({ op: '_resize', id: win.id, w: startW + ev.clientX - startX, h: startH + ev.clientY - startY });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, [win.id, win.w, win.h, dispatch]);

  if (win.minimized) return null;

  return (
    <div
      ref={frameRef}
      onMouseDown={() => dispatch({ op: 'focus', id: win.id })}
      style={{
        position: 'fixed',
        left:    win.x,
        top:     win.y,
        width:   win.w,
        height:  win.h,
        zIndex:  win.zIndex,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#111',
      }}
    >
      {/* Title bar */}
      <div
        ref={barRef}
        onMouseDown={onMouseDownBar}
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        6,
          padding:    '0 10px',
          height:     32,
          background: '#1a1a1a',
          cursor:     'grab',
          userSelect: 'none',
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Traffic-light buttons */}
        <button
          onClick={() => dispatch({ op: 'close', id: win.id })}
          title="Close"
          style={btnStyle('#ff5f57')}
        />
        <button
          onClick={() => dispatch({ op: 'minimize', id: win.id })}
          title="Minimize"
          style={btnStyle('#ffbd2e')}
        />
        <button
          onClick={() => dispatch({ op: 'focus', id: win.id })}
          title="Focus"
          style={btnStyle('#28c840')}
        />

        {/* Title */}
        <span style={{
          flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600,
          color: 'rgba(255,255,255,0.6)', letterSpacing: '0.04em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginLeft: -48, pointerEvents: 'none',
        }}>
          {win.title}
        </span>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {win.contentType === 'iframe' ? (
          <iframe
            src={win.content}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={win.title}
          />
        ) : win.contentType === 'terminal' ? (
          <TerminalContent win={win} termEndRef={termEndRef} dispatch={dispatch} />
        ) : win.contentType === 'code' ? (
          <pre style={{
            margin: 0, padding: '12px 16px',
            fontFamily: 'monospace', fontSize: 12,
            color: '#d4d4d4', background: '#0d0d0d',
            overflow: 'auto', height: '100%',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {win.content}
          </pre>
        ) : win.contentType === 'image' ? (
          <div style={{
            width: '100%', height: '100%', overflow: 'auto',
            background: '#0a0a0a', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {win.content ? (
              <img
                src={win.content}
                alt={win.title}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>No image loaded</span>
            )}
          </div>
        ) : win.contentType === 'physics' ? (
          <div style={{ width: '100%', height: '100%', background: '#0a0a0a' }}>
            <PhysicsSimulator commands={win.physicsCmds ?? []} width={win.w} height={win.h - 32} />
          </div>
        ) : (
          /* HTML content — sandboxed iframe with postMessage listener injected */
          <iframe
            ref={(el) => registerIframe(win.id, el)}
            srcDoc={injectMessageListener(win.content || '<html><body style="background:#0a0a0a;color:#ccc;font-family:monospace;padding:16px">Ready</body></html>', win.id)}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={win.title}
          />
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onMouseDownResize}
        style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 14, height: 14, cursor: 'nwse-resize',
          background: 'transparent',
        }}
      />
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    width: 12, height: 12, borderRadius: '50%',
    background: color, border: 'none', cursor: 'pointer',
    padding: 0, flexShrink: 0,
  };
}

// ── Terminal Content ───────────────────────────────────────────────────────────

// Slash commands that can be triggered from the terminal input
const SLASH_COMMANDS: Record<string, string> = {
  '/help':        'Available commands: /autonomous, /physics, /bg-check, /safe-mode, /spawn [id] [prompt], /clear, /help',
  '/autonomous':  '__toggle:autonomous__',
  '/physics':     '__toggle:physics__',
  '/bg-check':    '__toggle:bg-check__',
  '/safe-mode':   '__toggle:safe-mode__',
  '/clear':       '__clear__',
};

// Global callback registry — Chat.tsx registers handlers here so TerminalContent can call them
export const terminalCommandHandlers: {
  runCommand?: (cmd: string) => Promise<string>;
  toggleMode?:  (mode: string) => string;
  spawnSub?:    (id: string, prompt: string) => void;
  appendLine?:  (id: string, line: string) => void;
} = {};

function TerminalContent({
  win,
  termEndRef,
  dispatch,
}: {
  win:         WindowState;
  termEndRef:  React.RefObject<HTMLDivElement | null>;
  dispatch:    (e: WMAction) => void;
}) {
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const runInput = async () => {
    const cmd = inputVal.trim();
    if (!cmd) return;
    setInputVal('');
    setHistory(prev => [cmd, ...prev.slice(0, 99)]);
    setHistoryIdx(-1);

    // Append command echo
    dispatch({ op: 'append_terminal', id: win.id, content: `$ ${cmd}` });

    // Slash commands
    if (cmd.startsWith('/')) {
      const [slash, ...rest] = cmd.split(' ');
      const action = SLASH_COMMANDS[slash];
      if (action === '__clear__') {
        // Clear terminal lines by closing + recreating
        dispatch({ op: 'close', id: win.id });
        dispatch({ op: 'ensure_terminal', id: win.id, title: win.title });
        return;
      }
      if (action?.startsWith('__toggle:')) {
        const mode = action.slice(9, -2);
        const result = terminalCommandHandlers.toggleMode?.(mode) ?? `Unknown mode: ${mode}`;
        dispatch({ op: 'append_terminal', id: win.id, content: result });
        return;
      }
      if (slash === '/spawn') {
        const spawnId = rest[0] ?? 'sub-1';
        const prompt = rest.slice(1).join(' ') || 'Perform a helpful task.';
        terminalCommandHandlers.spawnSub?.(spawnId, prompt);
        dispatch({ op: 'append_terminal', id: win.id, content: `[spawn] Launching sub-agent "${spawnId}" with prompt: ${prompt}` });
        return;
      }
      if (action) {
        dispatch({ op: 'append_terminal', id: win.id, content: action });
        return;
      }
      dispatch({ op: 'append_terminal', id: win.id, content: `Unknown command: ${cmd}. Type /help for available commands.` });
      return;
    }

    // Shell command — run via API
    if (terminalCommandHandlers.runCommand) {
      try {
        const output = await terminalCommandHandlers.runCommand(cmd);
        dispatch({ op: 'append_terminal', id: win.id, content: output || '(no output)' });
      } catch (err) {
        dispatch({ op: 'append_terminal', id: win.id, content: `Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    } else {
      dispatch({ op: 'append_terminal', id: win.id, content: '(Terminal command API not connected)' });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { runInput(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      if (history[next]) setInputVal(history[next]);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next);
      setInputVal(next === -1 ? '' : (history[next] ?? ''));
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          fontFamily: '"Cascadia Code", "Fira Code", monospace',
          fontSize: 12,
          lineHeight: 1.6,
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {win.terminalLines.map((line, i) => (
          <TerminalLine key={i} text={line} />
        ))}
        <div ref={termEndRef as React.RefObject<HTMLDivElement>} />
      </div>
      {/* User input row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px',
        background: '#111',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <span style={{ color: '#7ec8e3', fontFamily: 'monospace', fontSize: 12, userSelect: 'none' }}>$</span>
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Enter command or /help …"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'rgba(255,255,255,0.85)',
            fontFamily: '"Cascadia Code", "Fira Code", monospace',
            fontSize: 12,
            caretColor: '#7ec8e3',
          }}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function TerminalLine({ text }: { text: string }) {
  const isCmd   = text.startsWith('$ ');
  const isError = /error|Error|ERROR|failed|FAILED/.test(text);
  const color   = isCmd ? '#7ec8e3' : isError ? '#f47c7c' : 'rgba(255,255,255,0.78)';
  return (
    <div style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {text}
    </div>
  );
}

// ── Taskbar (minimized windows) ────────────────────────────────────────────────

function Taskbar({
  windows,
  dispatch,
}: {
  windows:  WindowState[];
  dispatch: (e: WMAction) => void;
}) {
  const minimized = windows.filter(w => w.minimized);
  if (minimized.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 8, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', gap: 6, zIndex: 99999,
      background: 'rgba(20,20,20,0.92)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 8, padding: '4px 8px',
      backdropFilter: 'blur(12px)',
    }}>
      {minimized.map(w => (
        <button
          key={w.id}
          onClick={() => dispatch({ op: 'restore', id: w.id })}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 5, color: 'rgba(255,255,255,0.7)',
            fontSize: 11, fontWeight: 500, cursor: 'pointer',
            padding: '3px 10px', whiteSpace: 'nowrap',
          }}
        >
          {w.title}
        </button>
      ))}
    </div>
  );
}

// ── WindowLayer — renders all windows ─────────────────────────────────────────

export function WindowLayer() {
  const ctx = useContext(WMContext);
  if (!ctx) return null;

  const { windows, dispatch } = ctx;
  const dispatchAny = dispatch as (e: WMAction) => void;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {windows.map(win => (
        <DraggableWindow key={win.id} win={win} dispatch={dispatchAny} registerIframe={ctx.registerIframe} />
      ))}
      <Taskbar windows={windows} dispatch={dispatchAny} />
    </>,
    document.body
  );
}

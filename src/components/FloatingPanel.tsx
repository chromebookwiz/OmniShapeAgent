"use client";

/**
 * FloatingPanel — Draggable, resizable floating panel with dark window chrome.
 * Matches the visual style of WindowManager windows.
 *
 * Usage:
 *   <FloatingPanel title="My Panel" onClose={() => setShow(false)} defaultW={420} defaultH={600}>
 *     <div>content here</div>
 *   </FloatingPanel>
 */

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface FloatingPanelProps {
  title: string;
  onClose: () => void;
  defaultX?: number;
  defaultY?: number;
  defaultW?: number;
  defaultH?: number;
  minW?: number;
  minH?: number;
  children: React.ReactNode;
  className?: string;
  isMobile?: boolean;
}

let _nextZ = 200; // above WindowManager windows

export default function FloatingPanel({
  title,
  onClose,
  defaultX,
  defaultY,
  defaultW = 480,
  defaultH = 600,
  minW = 320,
  minH = 200,
  children,
  isMobile = false,
}: FloatingPanelProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: defaultX ?? Math.max(40, window?.innerWidth ? Math.floor((window.innerWidth - defaultW) / 2) : 200),
    y: defaultY ?? Math.max(40, window?.innerHeight ? Math.floor((window.innerHeight - defaultH) / 3) : 100),
  }));
  const [size, setSize] = useState({ w: defaultW, h: defaultH });
  const [zIndex, setZIndex] = useState(() => ++_nextZ);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const focus = useCallback(() => { setZIndex(++_nextZ); }, []);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const onMouseDownBar = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    focus();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;

    function onMove(ev: MouseEvent) {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, pos.x, pos.y, focus]);

  // ── Resize ────────────────────────────────────────────────────────────────
  const onMouseDownResize = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    const startW = size.w;
    const startH = size.h;
    const startX = e.clientX;
    const startY = e.clientY;

    function onMove(ev: MouseEvent) {
      setSize({
        w: Math.max(minW, startW + ev.clientX - startX),
        h: Math.max(minH, startH + ev.clientY - startY),
      });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, size.w, size.h, minW, minH]);

  if (!mounted) return null;

  const panel = (
    <div
      onMouseDown={focus}
      style={{
        position: 'fixed',
        left: isMobile ? 12 : pos.x,
        top: isMobile ? 12 : pos.y,
        width: isMobile ? 'calc(100vw - 24px)' : size.w,
        height: isMobile ? 'calc(100vh - 24px)' : size.h,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#111',
      }}
    >
      {/* Title bar */}
      <div
        onMouseDown={onMouseDownBar}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          height: 32,
          background: '#1a1a1a',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Traffic-light buttons */}
        <button onClick={onClose} title="Close" style={btn('#ff5f57')} />
        <button onClick={onClose} title="Minimize" style={btn('#ffbd2e')} />
        <button onClick={focus} title="Focus" style={btn('#28c840')} />

        {/* Title */}
        <span style={{
          flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 600,
          color: 'rgba(255,255,255,0.6)', letterSpacing: '0.04em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginLeft: -48, pointerEvents: 'none',
        }}>
          {title}
        </span>
      </div>

      {/* Content area — reset text color so children on light backgrounds get black text, not body white */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', color: '#000' }}>
        {children}
      </div>

      {/* Resize handle */}
      {!isMobile && (
        <div
          onMouseDown={onMouseDownResize}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 14, height: 14, cursor: 'nwse-resize',
            background: 'transparent',
          }}
        />
      )}
    </div>
  );

  return createPortal(panel, document.body);
}

function btn(color: string): React.CSSProperties {
  return {
    width: 12, height: 12, borderRadius: '50%',
    background: color, border: 'none', cursor: 'pointer',
    padding: 0, flexShrink: 0,
  };
}

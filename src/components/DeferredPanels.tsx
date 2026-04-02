"use client";

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const BotBrowserManager = dynamic(() => import('./BotBrowser'), {
  ssr: false,
});

const Terminal = dynamic(() => import('./Terminal'), {
  ssr: false,
});

export default function DeferredPanels() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const enable = () => setEnabled(true);

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(enable, { timeout: 1200 });
    } else {
      timeoutId = setTimeout(enable, 300);
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  if (!enabled) return null;

  return (
    <>
      <BotBrowserManager />
      <Terminal />
    </>
  );
}
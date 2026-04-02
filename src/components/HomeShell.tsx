"use client";

import dynamic from 'next/dynamic';
import DeferredPanels from './DeferredPanels';
import { WindowLayer, WindowManagerProvider } from './WindowManager';

const Chat = dynamic(() => import('./Chat'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-zinc-900/60" />,
});

export default function HomeShell() {
  return (
    <WindowManagerProvider>
      <main className="h-screen w-full bg-zinc-950 text-zinc-100 selection:bg-zinc-800 p-2 lg:p-4 safe-area-top">
        <div className="h-full w-full glass-chat rounded-3xl overflow-hidden relative z-10 border border-zinc-800/50 shadow-2xl">
          <Chat />
        </div>
        <DeferredPanels />
      </main>
      <WindowLayer />
    </WindowManagerProvider>
  );
}
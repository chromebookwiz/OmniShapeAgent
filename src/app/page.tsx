import Chat from '@/components/Chat';
import BotBrowserManager from '@/components/BotBrowser';
import Terminal from '@/components/Terminal';
import { WindowManagerProvider, WindowLayer } from '@/components/WindowManager';

export default function Home() {
  return (
    <WindowManagerProvider>
      <main className="h-screen w-full bg-zinc-950 text-zinc-100 selection:bg-zinc-800 p-2 lg:p-4 safe-area-top">
        <div className="h-full w-full glass-chat rounded-3xl overflow-hidden relative z-10 border border-zinc-800/50 shadow-2xl">
          <Chat />
        </div>
        <BotBrowserManager />
        <Terminal />
      </main>
      <WindowLayer />
    </WindowManagerProvider>
  );
}

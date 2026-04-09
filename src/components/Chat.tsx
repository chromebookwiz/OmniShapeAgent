"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import VoiceButton, { VoiceButtonHandle } from './VoiceButton';
import HallOfFame from './HallOfFame';
import MemoryPanel from './MemoryPanel';
import CryptoWallet from './CryptoWallet';
import { useWindowManager } from './WindowManager';
import MerkabaLogo from './MerkabaLogo';
import FloatingPanel from './FloatingPanel';

type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const DEFAULT_SYSTEM_PROMPT = `You are OmniShapeAgent, a high-precision autonomous reasoning system. Your purpose is to assist the user by orchestrating tools, memory, and multi-model synergy to solve complex engineering and research tasks. All geometry - and all higher reasoning - emerges from the simplest structure: the line.`;


const Icons = {
  Ollama: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  Send: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  ),
  Refresh: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  ),
  Bubble: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
    </svg>
  ),
  Gear: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Synergy: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4v16" />
      <path d="M15 4v16" />
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  History: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="m12 7v5l4 2" />
    </svg>
  ),
  Trash: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  Trophy: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  Memory: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
    </svg>
  ),
  Save: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  Paperclip: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  Physics: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  ),
  Bitcoin: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 5.6m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727" />
    </svg>
  ),
  Instagram: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  ),
  Moltbook: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  // Autonomous mode: solid circle when active, ring when off
  Autonomous: ({ active, running }: { active: boolean; running: boolean }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      stroke={active ? (running ? '#22c55e' : '#3b82f6') : 'currentColor'}>
      <circle cx="12" cy="12" r="9" fill={active ? (running ? '#22c55e' : '#3b82f6') : 'none'} fillOpacity={active ? 0.15 : 0} />
      <circle cx="12" cy="12" r="4" fill={active ? (running ? '#22c55e' : '#3b82f6') : 'none'} />
    </svg>
  ),
  Link: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  More: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  Heartbeat: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5-5 3 10 2.5-5H21" />
    </svg>
  ),
  Architect: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" />
      <path d="M6 20V8l6-4 6 4v12" />
      <path d="M9 12h6" />
      <path d="M12 8v8" />
    </svg>
  ),
  Mic: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  ),
  Speaker: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
};

type CommandDefinition = {
  command: string;
  usage: string;
  description: string;
  icon: keyof typeof Icons;
  section: 'modes' | 'more' | 'system';
  persistent?: boolean;
  aliases?: string[];
  autocomplete?: string;
};

const HEARTBEAT_PROMPT = '[HEARTBEAT] Review the active task, recent progress, and current memory state. Continue unfinished work if there is a clear next step, otherwise report only meaningful deltas or that the system is steady.';

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { command: 'commands', usage: '/commands', description: 'Show the available local commands.', icon: 'More', section: 'system', aliases: ['help'] },
  { command: 'settings', usage: '/settings', description: 'Open model and tool settings.', icon: 'Gear', section: 'system' },
  { command: 'control', usage: '/control', description: 'Open or close the control panel.', icon: 'More', section: 'system', aliases: ['menu', 'panel'] },
  { command: 'parallel', usage: '/parallel on', description: 'Keep parallel discourse mode active.', icon: 'Synergy', section: 'modes', persistent: true, autocomplete: '/parallel on' },
  { command: 'autonomous', usage: '/autonomous on', description: 'Let the agent keep working until it stops itself.', icon: 'Autonomous', section: 'modes', persistent: true, autocomplete: '/autonomous on' },
  { command: 'heartbeat', usage: '/heartbeat 15', description: 'Enable scheduled heartbeat turns at a minute interval.', icon: 'Heartbeat', section: 'modes', persistent: true, autocomplete: '/heartbeat 15' },
  { command: 'surveyor', usage: '/surveyor on', description: 'Architect and supervise app creation through the local LocalClawd CLI.', icon: 'Architect', section: 'modes', persistent: true, autocomplete: '/surveyor on' },
  { command: 'localclawd', usage: '/localclawd my-app build a note app', description: 'Create a workspace directory and supervise LocalClawd as it builds and tests an app.', icon: 'Architect', section: 'more', autocomplete: '/localclawd my-app build a note app' },
  { command: 'doctor', usage: '/doctor', description: 'Run a full runtime and tool diagnosis.', icon: 'Gear', section: 'more' },
  { command: 'observe', usage: '/observe', description: 'Snapshot current system state and memory health.', icon: 'Memory', section: 'more' },
  { command: 'reflect', usage: '/reflect', description: 'Trigger a focused reflection loop on the current task.', icon: 'Autonomous', section: 'more' },
  { command: 'summarize', usage: '/summarize', description: 'Summarize progress, blockers, and next steps.', icon: 'Bubble', section: 'more' },
  { command: 'skill', usage: '/skill debugging', description: 'Read and apply a named skill file.', icon: 'Moltbook', section: 'more', autocomplete: '/skill debugging' },
  { command: 'discord', usage: '/discord', description: 'Run a Discord workflow through tools and memory.', icon: 'Bubble', section: 'more' },
  { command: 'instagram', usage: '/instagram', description: 'Run an Instagram workflow through tools and memory.', icon: 'Instagram', section: 'more' },
  { command: 'memory-prune', usage: '/memory-prune', description: 'Review stale memories and prune or suppress what is unhelpful.', icon: 'Memory', section: 'more', aliases: ['prune'] },
  { command: 'history', usage: '/history', description: 'Open saved chats.', icon: 'Bubble', section: 'more', aliases: ['saved'] },
  { command: 'memory', usage: '/memory', description: 'Open the memory browser.', icon: 'Memory', section: 'more' },
  { command: 'hall', usage: '/hall', description: 'Open the hall of fame.', icon: 'Trophy', section: 'more', aliases: ['halloffame'] },
  { command: 'wallet', usage: '/wallet', description: 'Open the crypto wallet.', icon: 'Bitcoin', section: 'more' },
  { command: 'moltbook', usage: '/moltbook', description: 'Open Moltbook tools and prompts.', icon: 'Moltbook', section: 'more' },
  { command: 'physics', usage: '/physics', description: 'Open the physics simulator.', icon: 'Physics', section: 'more' },
  { command: 'voice', usage: '/voice input', description: 'Toggle microphone transcription.', icon: 'Mic', section: 'more', autocomplete: '/voice input' },
  { command: 'voice-output', usage: '/voice output on', description: 'Enable automatic spoken responses.', icon: 'Speaker', section: 'more', autocomplete: '/voice output on' },
  { command: 'toolaudit', usage: '/toolaudit', description: 'Ask the agent runtime to audit core tools.', icon: 'Gear', section: 'more' },
  { command: 'new', usage: '/new', description: 'Start a new chat session.', icon: 'Refresh', section: 'system' },
];

function ActionMenuButton({
  icon,
  label,
  description,
  command,
  active = false,
  children,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  command?: string;
  active?: boolean;
  children?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={description}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
        active
          ? 'border-black bg-black text-[#FDFCF0]'
          : 'border-black/10 bg-white text-black hover:border-black/30 hover:bg-black/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border ${active ? 'border-white/20 bg-white/10 text-[#FDFCF0]' : 'border-black/10 bg-black/[0.03] text-black/65'}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-black uppercase tracking-[0.18em]">{label}</span>
            {command && <span className={`text-[9px] font-black uppercase tracking-[0.14em] ${active ? 'text-[#FDFCF0]/65' : 'text-black/30'}`}>{command}</span>}
          </span>
          <span className={`mt-1 block text-[11px] leading-relaxed ${active ? 'text-[#FDFCF0]/70' : 'text-black/45'}`}>{description}</span>
          {children}
        </span>
      </div>
    </button>
  );
}

// ProviderModelPicker - reusable model config panel for a single provider

interface ProviderModelPickerProps {
  provider: 'ollama' | 'vllm' | 'openrouter';
  label: string;
  ollamaUrl: string; setOllamaUrl: (v: string) => void;
  ollamaModel: string; setOllamaModel: (v: string) => void;
  ollamaModels: string[]; ollamaStatus: string;
  vllmUrl: string; setVllmUrl: (v: string) => void;
  vllmModel: string; setVllmModel: (v: string) => void;
  vllmModels: Array<{ model: string; hostPort: string; chatUrl?: string }>; vllmStatus: string;
  vllmProbeResult: string | null; runVllmProbe: () => void;
  openrouterApiKey: string; setOpenrouterApiKey: (v: string) => void;
  openrouterModel: string; setOpenrouterModel: (v: string) => void;
  openrouterModels: Array<{ id: string; name: string }>; openrouterStatus: string;
}

function ProviderModelPicker({
  provider, label,
  ollamaUrl, setOllamaUrl, ollamaModel, setOllamaModel, ollamaModels, ollamaStatus,
  vllmUrl, setVllmUrl, vllmModel, setVllmModel, vllmModels, vllmStatus, vllmProbeResult, runVllmProbe,
  openrouterApiKey, setOpenrouterApiKey, openrouterModel, setOpenrouterModel, openrouterModels, openrouterStatus,
}: ProviderModelPickerProps) {
  return (
    <div className="space-y-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-black/40">{label}</p>

      {provider === 'ollama' && (
        <>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">Endpoint</label>
            <input
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-black"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">
              Model {ollamaStatus === 'ok' ? ` - ${ollamaModels.length}` : ollamaStatus === 'no-models' ? ' - none' : ''}
            </label>
            {ollamaModels.length === 0 ? (
              <div className="text-xs text-amber-700 font-black px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">No models - is Ollama running?</div>
            ) : (
              <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}
                className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black">
                <option value="">DETACHED</option>
                {ollamaModels.map(m => <option key={m} value={`ollama:${m}`}>{m}</option>)}
              </select>
            )}
          </div>
        </>
      )}

      {provider === 'vllm' && (
        <>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">
              Cluster Endpoint {vllmStatus === 'ok' ? ` - ${vllmModels.length} model${vllmModels.length !== 1 ? 's' : ''}` : vllmStatus === 'no-models' ? ' - none' : ''}
            </label>
            <div className="flex gap-1">
              <input value={vllmUrl} onChange={(e) => setVllmUrl(e.target.value)}
                className="flex-1 bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-black" />
              <button onClick={runVllmProbe} className="px-2 py-1 border border-black/30 rounded-lg text-[9px] font-black hover:bg-black hover:text-white hover:border-black transition-colors">PROBE</button>
            </div>
            {vllmProbeResult && (
              <pre className="text-[8px] font-mono bg-black/5 rounded p-2 max-h-20 overflow-y-auto whitespace-pre-wrap text-black/50">{vllmProbeResult}</pre>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">Model</label>
            {vllmModels.length === 0 ? (
              <div className="text-xs text-amber-700 font-black px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">No models - check URL and Refresh</div>
            ) : (
              <select value={vllmModel} onChange={(e) => setVllmModel(e.target.value)}
                className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black">
                <option value="">DETACHED</option>
                {vllmModels.map(item => (
                  <option key={`${item.model}-${item.hostPort}`} value={`vllm:${item.model}@${item.chatUrl || `http://${item.hostPort}/v1/chat/completions`}`}>
                    {item.model} @ {item.hostPort}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {provider === 'openrouter' && (
        <>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">API Key</label>
            <input type="password" value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-black" />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">
              Model {openrouterStatus === 'ok' ? ` - ${openrouterModels.length}` : ''}
            </label>
            {openrouterModels.length === 0 ? (
              <div className="text-xs text-amber-700 font-black px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                {openrouterApiKey ? 'No models - press Refresh' : 'Enter API key first'}
              </div>
            ) : (
              <select value={openrouterModel} onChange={(e) => setOpenrouterModel(e.target.value)}
                className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black">
                <option value="">DETACHED</option>
                <option value="openrouter:openrouter/auto">Auto - Best Available</option>
                {openrouterModels.map(m => <option key={m.id} value={`openrouter:${m.id}`}>{m.name}</option>)}
              </select>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Chat() {
  const windowManager = useWindowManager();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [vllmModels, setVllmModels] = useState<Array<{ model: string; hostPort: string; chatUrl?: string }>>([]);
  const [openrouterModels, setOpenrouterModels] = useState<Array<{ id: string; name: string }>>([]);
  const [ollamaModel, setOllamaModel] = useState<string>('');
  const [vllmModel, setVllmModel] = useState<string>('');
  const [openrouterModel, setOpenrouterModel] = useState<string>('');
  const [openrouterApiKey, setOpenrouterApiKey] = useState<string>(() => {
    try { return localStorage.getItem('sa_openrouter_key') ?? ''; } catch { return ''; }
  });
  const [primaryProvider, setPrimaryProvider] = useState<'ollama' | 'vllm' | 'openrouter'>('vllm');
  const [secondaryProvider, setSecondaryProvider] = useState<'ollama' | 'vllm' | 'openrouter'>('ollama');
  const [savedChats, setSavedChats] = useState<Array<{ id: string; name: string; createdAt: string; updatedAt: string; summary: string | null; messageCount: number }>>([]);
  const [chatSummaries, setChatSummaries] = useState<Record<string, string>>({});
  // Tracks the persisted file ID for the current conversation - set after first save
  const currentChatIdRef = useRef<string | null>(null);
  const [chatName, setChatName] = useState('My Chat');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');
  const [vllmUrl, setVllmUrl] = useState('http://192.168.1.34:8000');
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [temperature, setTemperature] = useState(0.7);
  const [parallelMode, setParallelMode] = useState(false);
  const [isParallelRunning, setIsParallelRunning] = useState(false);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [connStatus, setConnStatus] = useState<'testing' | 'ok' | 'fail'>('testing');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'ok' | 'fail' | 'no-models'>('unknown');
  const [vllmStatus, setVllmStatus] = useState<'unknown' | 'ok' | 'fail' | 'no-models'>('unknown');
  const [openrouterStatus, setOpenrouterStatus] = useState<'unknown' | 'ok' | 'fail' | 'no-models'>('unknown');
  const [vllmProbeResult, setVllmProbeResult] = useState<string | null>(null);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [liveStatus, setLiveStatus] = useState<string>('');
  const [streamPhase, setStreamPhase] = useState<'idle' | 'thinking' | 'streaming'>('idle');
  const [enabledToolGroups, setEnabledToolGroups] = useState<Set<string>>(() => new Set([
    'web', 'terminal', 'files', 'git', 'vision', 'computer', 'memory', 'comms', 'bots', 'scheduler', 'image', 'self'
  ]));
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [imagePipeline, setImagePipeline] = useState<'none' | 'stable-diffusion' | 'openrouter-image'>('none');
  const [imageModel, setImageModel] = useState('black-forest-labs/flux-schnell');
  const toolCallCountRef = useRef(0);
  const [toolCallCount, setToolCallCount] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<VoiceButtonHandle>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [voiceControlState, setVoiceControlState] = useState({ listening: false, speaking: false, voiceOutputEnabled: false });
  // File attachments
  type Attachment = { name: string; type: string; isImage?: boolean; dataUrl?: string; text?: string; truncated?: boolean };
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachUploading, setAttachUploading] = useState(false);
  const [autoApproveTerminal, setAutoApproveTerminal] = useState<boolean>(() => {
    try { return localStorage.getItem('sa_auto_approve_terminal') === 'true'; } catch { return false; }
  });
  type PendingApproval = { id: string; command: string; reason: string; risk: string };
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  // Per-provider context window sizes
  const [ollamaContextWindow, setOllamaContextWindow] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('sa_ctx_ollama') ?? '128000'); } catch { return 128000; }
  });
  const [vllmContextWindow, setVllmContextWindow] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('sa_ctx_vllm') ?? '120000'); } catch { return 120000; }
  });
  const [openrouterContextWindow, setOpenrouterContextWindow] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('sa_ctx_openrouter') ?? '256000'); } catch { return 256000; }
  });
  // Embedded terminal log (mirrors floating terminal windows)
  const [terminalLog, setTerminalLog] = useState<string[]>([]);
  const [showTerminalLog, setShowTerminalLog] = useState(false);
  // Crypto wallet
  const [showCryptoWallet, setShowCryptoWallet] = useState(false);
  // Moltbook panel
  const [showMoltbook, setShowMoltbook] = useState(false);
  const [heartbeatMode, setHeartbeatMode] = useState(false);
  const [heartbeatIntervalMinutes, setHeartbeatIntervalMinutes] = useState<number>(() => {
    try {
      const stored = parseInt(localStorage.getItem('sa_heartbeat_interval') ?? '15', 10);
      return Number.isFinite(stored) ? Math.max(1, Math.min(240, stored)) : 15;
    } catch {
      return 15;
    }
  });
  const [surveyorMode, setSurveyorMode] = useState(false);
  // Autonomous mode
  const [autonomousMode, setAutonomousMode] = useState(false);
  const physicsModeActive = useMemo(
    () => windowManager.windows.some((windowState) => windowState.contentType === 'physics' && !windowState.minimized),
    [windowManager.windows],
  );
  const isAutoRunningRef = useRef(false);
  const autoStopRequestedRef = useRef(false);        // set by stop_agent event
  const pendingVisionSnapshotRef = useRef<string | null>(null); // base64 from vision_self_check
  const autoLoopCountRef = useRef(0);

  // Media URL attachments (image/video URLs for vLLM multimodal)
  type MediaUrlAttachment = { url: string; type: 'image' | 'video' };
  const [mediaUrls, setMediaUrls] = useState<MediaUrlAttachment[]>([]);
  const [showMediaUrlInput, setShowMediaUrlInput] = useState(false);
  const [mediaUrlDraft, setMediaUrlDraft] = useState('');
  // Stable ref to handleSend - lets the parallel-mode useEffect call it without stale closures
  const handleSendRef = useRef<((overrides?: { msg?: string; images?: { name: string; dataUrl: string }[] }) => Promise<void>) | null>(null);
  // Track last assistant message for voice auto-speak
  const lastAssistantMsg = messages.filter(m => m.role === 'assistant').at(-1)?.content ?? '';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Generate a one-sentence summary by sending the first few exchanges to the LLM.
  // Called only ONCE per conversation (on first save). Never regenerated.
  const generateSummary = useCallback(async (msgs: Message[]): Promise<string> => {
    try {
      const userFirst = msgs.find(m => m.role === 'user')?.content ?? '';
      const assistFirst = (msgs.find(m => m.role === 'assistant')?.content ?? '')
        .replace(/\[THINKING\][\s\S]*?\[THOUGHT_END\]/g, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```tool[\s\S]*?```/g, '')
        .replace(/\[TOOL\][^\n]*/g, '')
        .trim();
      if (!userFirst) return '';
      // Use just the first exchange for speed - no need for the full history
      const prompt = `Write one short sentence (max 12 words) summarising this conversation.\nUser: ${userFirst.slice(0, 300)}\nAssistant: ${assistFirst.slice(0, 300)}`;
      const activeModel = primaryProvider === 'ollama' ? ollamaModel : primaryProvider === 'openrouter' ? openrouterModel : vllmModel;
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt, history: [], model: activeModel, synergyMode: 'off', stream: false }),
      });
      if (!res.ok) return userFirst.slice(0, 60);
      const data = await res.json();
      return (data.reply ?? userFirst).trim().slice(0, 120);
    } catch {
      return msgs.find(m => m.role === 'user')?.content?.slice(0, 60) ?? '';
    }
  }, [ollamaModel, openrouterModel, primaryProvider, vllmModel]);

  const testConnection = useCallback(async () => {
    setConnStatus('testing');
    setConnectionError(null);
    setOllamaStatus('unknown');
    setVllmStatus('unknown');
    setOpenrouterStatus('unknown');

    try {
      const params = new URLSearchParams();
      if (ollamaUrl) params.set('ollamaUrl', ollamaUrl);
      if (vllmUrl) params.set('vllmUrl', vllmUrl);
      if (openrouterApiKey) params.set('openrouterApiKey', openrouterApiKey);

      const res = await fetch('/api/models?' + params.toString());
      const data = await res.json();

      const ollama: string[] = Array.isArray(data.ollamaModels) ? data.ollamaModels : [];
      const vllm: Array<{ model: string; hostPort: string; chatUrl?: string }> = Array.isArray(data.vllmModels) ? data.vllmModels : [];
      const or: Array<{ id: string; name: string }> = Array.isArray(data.openrouterModels) ? data.openrouterModels : [];

      setOllamaModels(ollama);
      setVllmModels(vllm);
      setOpenrouterModels(or);
      setOpenrouterStatus(or.length > 0 ? 'ok' : openrouterApiKey ? 'no-models' : 'unknown');
      if (!openrouterModel && or.length > 0) setOpenrouterModel(`openrouter:${or[0].id}`);

      // Per-provider status
      setOllamaStatus(ollama.length > 0 ? 'ok' : 'no-models');
      setVllmStatus(vllm.length > 0 ? 'ok' : 'no-models');

      // Auto-select first available model if none selected
      if (!ollamaModel && ollama.length > 0) setOllamaModel(`ollama:${ollama[0]}`);
      if (!vllmModel && vllm.length > 0) {
        const first = vllm[0];
        setVllmModel(`vllm:${first.model}@${first.chatUrl || `http://${first.hostPort}/v1/chat/completions`}`);
      }

      const primaryOk =
        primaryProvider === 'ollama' ? ollama.length > 0 :
        primaryProvider === 'openrouter' ? or.length > 0 :
        vllm.length > 0;
      if (ollama.length > 0 || vllm.length > 0 || or.length > 0) {
        setConnStatus('ok');
        if (!primaryOk) {
          setConnectionError(
            primaryProvider === 'vllm'
                ? `vLLM: no models found at ${vllmUrl}. ${ollama.length > 0 ? 'Ollama has models - switch provider.' : ''}`
              : primaryProvider === 'openrouter'
              ? `OpenRouter: no models found. Check your API key in settings.`
                : `Ollama: no models found at ${ollamaUrl}. ${vllm.length > 0 ? 'vLLM has models - switch provider.' : ''}`
          );
        } else {
          setConnectionError(null);
        }
      } else {
        setConnStatus('fail');
        setConnectionError(`No models found. Ollama: ${ollamaUrl} | vLLM: ${vllmUrl || '(not set)'} | OpenRouter: ${openrouterApiKey ? 'key set but no models' : 'no key'}`);
      }
    } catch {
      setConnStatus('fail');
      setConnectionError('Connection failed. Check network.');
    }
  }, [ollamaModel, ollamaUrl, openrouterApiKey, openrouterModel, primaryProvider, vllmModel, vllmUrl]);

  const runVllmProbe = async () => {
    if (!vllmUrl) return;
    setVllmProbeResult('Probing - testing all endpoint paths...');
    try {
      const res = await fetch(`/api/vllm-probe?url=${encodeURIComponent(vllmUrl)}`);
      const data = await res.json();
      const lines = [
        `SUMMARY: ${data.summary || 'no summary'}`,
        '',
        ...(data.steps || []),
        '',
        data.workingChatUrl ? `Working URL: ${data.workingChatUrl}` : 'No working endpoint found',
      ];
      setVllmProbeResult(lines.join('\n'));
      // If probe found a working URL and we have models, update the vllmModel with correct URL
      if (data.workingChatUrl && data.models?.length > 0) {
        const newVal = `vllm:${data.models[0]}@${data.workingChatUrl}`;
        setVllmModel(newVal);
        // Also update vllmModels list so dropdown shows correct URL
        setVllmModels(data.models.map((m: string) => ({
          model: m,
          hostPort: (() => { try { return new URL(vllmUrl).host; } catch { return vllmUrl; } })(),
          chatUrl: data.workingChatUrl,
        })));
        setVllmStatus('ok');
      }
    } catch (e) {
      setVllmProbeResult(`Probe error: ${String(e)}`);
    }
  };

  // Persist OpenRouter API key to localStorage
  useEffect(() => {
    try { localStorage.setItem('sa_openrouter_key', openrouterApiKey); } catch {}
  }, [openrouterApiKey]);

  useEffect(() => {
    try { localStorage.setItem('sa_auto_approve_terminal', String(autoApproveTerminal)); } catch {}
  }, [autoApproveTerminal]);

  useEffect(() => {
    try { localStorage.removeItem('sa_heartbeat_mode'); } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('sa_heartbeat_interval', String(heartbeatIntervalMinutes)); } catch {}
  }, [heartbeatIntervalMinutes]);

  useEffect(() => {
    try { localStorage.setItem('sa_ctx_ollama', String(ollamaContextWindow)); } catch {}
  }, [ollamaContextWindow]);
  useEffect(() => {
    try { localStorage.setItem('sa_ctx_vllm', String(vllmContextWindow)); } catch {}
  }, [vllmContextWindow]);
  useEffect(() => {
    try { localStorage.setItem('sa_ctx_openrouter', String(openrouterContextWindow)); } catch {}
  }, [openrouterContextWindow]);

  useEffect(() => {
    if (!heartbeatMode || heartbeatIntervalMinutes <= 0) return;
    if (isLoading || connStatus !== 'ok' || messages.length === 0 || input.trim() || pendingApprovals.length > 0) return;
    const timer = setTimeout(() => {
      handleSendRef.current?.({ msg: HEARTBEAT_PROMPT });
    }, heartbeatIntervalMinutes * 60_000);
    return () => clearTimeout(timer);
  }, [connStatus, heartbeatIntervalMinutes, heartbeatMode, input, isLoading, messages.length, pendingApprovals.length]);

  // Persist active model string to localStorage so BotBrowser can pick it up for deployments
  useEffect(() => {
    const activeModel =
      primaryProvider === 'ollama' ? ollamaModel :
      primaryProvider === 'openrouter' ? openrouterModel :
      vllmModel;
    if (activeModel) {
      try { localStorage.setItem('sa_active_model', activeModel); } catch {}
    }
  }, [primaryProvider, ollamaModel, vllmModel, openrouterModel]);

  const fetchSavedChats = useCallback(() => {
    fetch('/api/chats')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data.chats)) return;
        // API already sorts newest-first; just set state
        setSavedChats(data.chats);
        // Populate summaries from stored data - no LLM calls needed
        const summaryMap: Record<string, string> = {};
        for (const c of data.chats) {
          if (c.summary) summaryMap[c.id] = c.summary;
        }
        setChatSummaries(prev => ({ ...prev, ...summaryMap }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    testConnection();
    fetchSavedChats();
  }, [fetchSavedChats, testConnection]);

  const saveCurrentChat = useCallback(async () => {
    if (messages.length === 0) return;
    const existingId = currentChatIdRef.current;
    const name = chatName || `chat-${Date.now()}`;

    try {
      if (existingId) {
        // Update existing chat in-place - no new summary generation
        const res = await fetch('/api/chats', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existingId, name, messages }),
        });
        if (!res.ok) throw new Error('Update failed');
        const data = await res.json();
        setSavedChats(prev => prev.map(c =>
          c.id === existingId ? { ...c, name: data.name, updatedAt: data.updatedAt, messageCount: messages.length } : c
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      } else {
        // First save: generate summary once and store it permanently
        const summary = messages.length >= 2 ? await generateSummary(messages) : null;
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, messages, summary }),
        });
        if (!res.ok) throw new Error('Save failed');
        const data = await res.json();
        currentChatIdRef.current = data.id;
        setSavedChats(prev => [
          { id: data.id, name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt, summary: data.summary, messageCount: messages.length },
          ...prev,
        ]);
        if (data.summary) {
          setChatSummaries(prev => ({ ...prev, [data.id]: data.summary }));
        }
      }
    } catch {
      // Silently fail - auto-save is best-effort
    }
  }, [chatName, generateSummary, messages]);

  useEffect(() => {
    if (!autoSaveEnabled) return;
    const timer = setTimeout(() => {
      saveCurrentChat();
    }, 20000);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, chatName, messages, saveCurrentChat]);

  const loadSavedChat = async (chatId: string) => {
    try {
      const res = await fetch(`/api/chats?id=${chatId}`);
      if (!res.ok) throw new Error('Load failed');
      const data = await res.json();
      if (data.chat?.messages) {
        setMessages(data.chat.messages);
        setChatName(data.chat.name);
        // Resume saving to the same file
        currentChatIdRef.current = chatId;
        setShowSavedPanel(false);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'system', content: `Load failed: ${String(error)}` }]);
    }
  };

  const deleteSavedChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Permanently delete this memory?')) return;
    try {
      const res = await fetch(`/api/chats?id=${chatId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setSavedChats(prev => prev.filter(p => p.id !== chatId));
      setSelectedChats(prev => { const n = new Set(prev); n.delete(chatId); return n; });
    } catch {
      alert('Delete failed');
    }
  };

  const deleteSelectedChats = async () => {
    if (selectedChats.size === 0) return;
    if (!confirm(`Delete ${selectedChats.size} selected chat${selectedChats.size !== 1 ? 's' : ''}?`)) return;
    const ids = Array.from(selectedChats);
    await Promise.all(ids.map(id => fetch(`/api/chats?id=${id}`, { method: 'DELETE' }).catch(() => {})));
    setSavedChats(prev => prev.filter(p => !selectedChats.has(p.id)));
    setSelectedChats(new Set());
  };

  const appendSystemMessage = useCallback((content: string) => {
    setMessages(prev => [...prev, { role: 'system', content }]);
  }, []);

  const resetUtilityPanels = useCallback(() => {
    setShowSavedPanel(false);
    setShowMemoryPanel(false);
    setShowHallOfFame(false);
    setShowMoltbook(false);
    setShowCryptoWallet(false);
  }, []);

  const startNewSession = useCallback(() => {
    setMessages([]);
    setChatName('New Session');
    currentChatIdRef.current = null;
    setShowSavedPanel(false);
    setSelectedChats(new Set());
  }, []);

  const applyHeartbeatSetting = useCallback((nextMode: boolean, nextInterval?: number) => {
    setHeartbeatMode(nextMode);
    if (typeof nextInterval === 'number' && Number.isFinite(nextInterval)) {
      setHeartbeatIntervalMinutes(Math.max(1, Math.min(240, Math.round(nextInterval))));
    }
  }, []);

  const queueAgentPrompt = useCallback((message: string) => {
    setTimeout(() => {
      handleSendRef.current?.({ msg: message });
    }, 0);
  }, []);

  const runLocalCommand = useCallback((rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) return false;

    const [commandNameRaw, ...argParts] = trimmed.slice(1).split(/\s+/);
    const commandName = commandNameRaw.toLowerCase();
    const rawArg = argParts.join(' ').trim();
    const arg = rawArg.toLowerCase();
    const boolArg = arg === 'on' ? true : arg === 'off' ? false : null;
    const heartbeatMinutes = Number.parseInt(arg, 10);

    switch (commandName) {
      case 'commands':
      case 'help':
        appendSystemMessage(
          'Available commands:\n' +
          '/commands - show command help\n' +
          '/settings - open model and tool settings\n' +
          '/control - open the control panel\n' +
          '/parallel [on|off] - toggle parallel mode\n' +
          '/autonomous [on|off] - toggle autonomous mode\n' +
          '/heartbeat [minutes|on|off] - schedule periodic heartbeat turns\n' +
          '/surveyor [on|off] - supervise app creation through LocalClawd\n' +
          '/localclawd <dir> <spec> - create a directory and supervise LocalClawd building the app\n' +
          '/doctor - run runtime and tool diagnostics\n' +
          '/observe - snapshot system state\n' +
          '/reflect - run a focused reasoning loop\n' +
          '/summarize - summarize current progress\n' +
          '/skill <name> - read and apply a skill\n' +
          '/discord - run a Discord workflow\n' +
          '/instagram - run an Instagram workflow\n' +
          '/memory-prune - review and prune stale memory\n' +
          '/history - open saved chats\n' +
          '/memory - open memory browser\n' +
          '/hall - open hall of fame\n' +
          '/wallet - open crypto wallet\n' +
          '/moltbook - open Moltbook panel\n' +
          '/physics - open physics simulator\n' +
          '/voice input - start or stop voice input\n' +
          '/voice output [on|off] - control auto-speak\n' +
          '/toolaudit - ask the agent runtime to audit core tools\n' +
          '/new - start a new chat session'
        );
        break;
      case 'settings':
        setShowActionMenu(false);
        setShowSettingsPanel(true);
        appendSystemMessage('Opened settings.');
        break;
      case 'control':
      case 'menu':
      case 'panel':
        setShowSettingsPanel(false);
        setShowActionMenu(prev => !prev);
        appendSystemMessage('Toggled the control panel.');
        break;
      case 'parallel': {
        const next = boolArg ?? !parallelMode;
        setParallelMode(next);
        setIsParallelRunning(false);
        if (next) setShowSettingsPanel(true);
        appendSystemMessage(`Parallel mode ${next ? 'enabled' : 'disabled'}.`);
        break;
      }
      case 'autonomous': {
        const next = boolArg ?? !autonomousMode;
        setAutonomousMode(next);
        appendSystemMessage(`Autonomous mode ${next ? 'enabled' : 'disabled'}.`);
        break;
      }
      case 'heartbeat': {
        if (boolArg === false) {
          applyHeartbeatSetting(false);
          appendSystemMessage('Heartbeat mode disabled.');
          break;
        }
        const nextInterval = Number.isFinite(heartbeatMinutes) ? heartbeatMinutes : heartbeatIntervalMinutes;
        applyHeartbeatSetting(true, nextInterval);
        appendSystemMessage(`Heartbeat mode enabled every ${Math.max(1, nextInterval)} minute${Math.max(1, nextInterval) === 1 ? '' : 's'}.`);
        break;
      }
      case 'surveyor': {
        const next = boolArg ?? !surveyorMode;
        setSurveyorMode(next);
        appendSystemMessage(next
          ? 'Coding surveyor mode enabled. The architect will supervise application creation through LocalClawd and install it with npm if the CLI is missing.'
          : 'Coding surveyor mode disabled.');
        break;
      }
      case 'localclawd': {
        const [dirNameRaw, ...specParts] = rawArg.split(/\s+/).filter(Boolean);
        const targetDir = dirNameRaw || `localclawd-app-${Date.now().toString(36)}`;
        const specification = specParts.join(' ').trim();
        if (!specification) {
          appendSystemMessage('Usage: /localclawd <directory> <app specification>. Example: /localclawd inventory-app build a small inventory dashboard with tests.');
          break;
        }
        queueAgentPrompt(
          `Coding surveyor workflow: create a new directory named "${targetDir}" in the workspace root, verify the LocalClawd CLI is available with a terminal check, and if it is missing install it with npm install -g localclawd. Then invoke LocalClawd inside that directory to build this application: ${specification}. Act as the architect supervising another agent: inspect what LocalClawd generates, review and correct the implementation as needed, run tests or build checks as progress is made, and keep iterating until the app is in a working state or you hit a concrete blocker.`
        );
        appendSystemMessage(`Queued LocalClawd build supervision for ${targetDir}.`);
        break;
      }
      case 'history':
      case 'saved':
        resetUtilityPanels();
        setShowSavedPanel(true);
        appendSystemMessage('Opened saved chats.');
        break;
      case 'memory':
        resetUtilityPanels();
        setShowMemoryPanel(true);
        appendSystemMessage('Opened memory browser.');
        break;
      case 'hall':
      case 'halloffame':
        resetUtilityPanels();
        setShowHallOfFame(true);
        appendSystemMessage('Opened hall of fame.');
        break;
      case 'wallet':
        resetUtilityPanels();
        setShowCryptoWallet(true);
        appendSystemMessage('Opened crypto wallet.');
        break;
      case 'moltbook':
        resetUtilityPanels();
        setShowMoltbook(true);
        appendSystemMessage('Opened Moltbook.');
        break;
      case 'physics':
        windowManager.dispatch({ op: 'create', id: 'physics', title: 'Physics Simulator', contentType: 'physics', content: '' });
        appendSystemMessage('Opened physics simulator.');
        break;
      case 'doctor':
        queueAgentPrompt('Run observe_self({ auditTools: true }) and diagnose_system(). Report only the concrete issues, what is healthy, and the next fixes worth making.');
        break;
      case 'observe':
        queueAgentPrompt('Run observe_self({ store: true, auditTools: true }). Summarize the current system state, memory health, and any risks that should affect the next step.');
        break;
      case 'reflect':
        queueAgentPrompt(`Enter a focused reflection loop on the current task. Re-state the active goal, list hidden assumptions, identify the most likely failure modes, and choose the highest-leverage next action. Use memory only if it materially helps. ${rawArg ? `Extra focus: ${rawArg}.` : ''}`);
        break;
      case 'summarize':
        queueAgentPrompt('Summarize the current session in three parts: completed work, open issues, and the exact next actions you would take without more input.');
        break;
      case 'skill':
        if (!rawArg) {
          appendSystemMessage('Usage: /skill <name>. Example: /skill debugging');
          break;
        }
        queueAgentPrompt(`Read the skill \"${rawArg}\" and apply it to the current task. If there is no active task, summarize the key operating rules from that skill and suggest the most relevant next use.`);
        break;
      case 'discord':
        queueAgentPrompt(`Manage Discord using the normal Discord tool family and memory, not a special UI mode. Check credentials or current server state first, inspect what is already configured, and either take the next useful Discord action or state the exact missing prerequisite. ${rawArg ? `Goal: ${rawArg}.` : ''}`);
        break;
      case 'instagram':
        queueAgentPrompt(`Manage Instagram using the normal Instagram tool family and memory, just like Discord is handled through tools. Check the account profile, recent posts, and performance first if credentials are available. Then decide the next useful action, execute it if safe, or report the exact missing prerequisite. ${rawArg ? `Goal: ${rawArg}.` : ''}`);
        break;
      case 'memory-prune':
      case 'prune':
        queueAgentPrompt('Review persistent memory health. Use memory stats and memory tools to identify stale, fixation-causing, or low-value memories. Prefer rejection or suppression when appropriate, delete only when a memory is clearly wrong or harmful, and summarize what changed.');
        break;
      case 'toolaudit':
        queueAgentPrompt('Run observe_self({ auditTools: true }) and diagnose_system(), summarize any tool problems, and tell me only what is actionable.');
        break;
      case 'voice': {
        if (arg.startsWith('output')) {
          const next = arg.endsWith('on') ? true : arg.endsWith('off') ? false : !voiceRef.current?.getState().voiceOutputEnabled;
          voiceRef.current?.setVoiceOutputEnabled(Boolean(next));
          appendSystemMessage(`Voice output ${next ? 'enabled' : 'disabled'}.`);
        } else {
          voiceRef.current?.toggleListening();
          const state = voiceRef.current?.getState();
          appendSystemMessage(`Voice input ${state?.listening ? 'enabled' : 'toggled'}.`);
        }
        break;
      }
      case 'new':
        startNewSession();
        appendSystemMessage('Started a new session.');
        break;
      default:
        appendSystemMessage(`Unknown command: ${trimmed}. Run /commands for the supported list.`);
        break;
    }

    setShowActionMenu(false);
    return true;
  }, [appendSystemMessage, applyHeartbeatSetting, autonomousMode, heartbeatIntervalMinutes, parallelMode, queueAgentPrompt, resetUtilityPanels, startNewSession, surveyorMode, windowManager]);

  const normalizedComposerInput = input.trimStart();
  const composerCommandToken = normalizedComposerInput.startsWith('/')
    ? normalizedComposerInput.slice(1).split(/\s+/)[0].toLowerCase()
    : '';
  const commandSuggestions = useMemo(() => {
    if (!normalizedComposerInput.startsWith('/')) return [];
    return COMMAND_DEFINITIONS.filter((definition) => {
      const haystacks = [definition.command, definition.usage, ...(definition.aliases ?? [])];
      return composerCommandToken.length === 0 || haystacks.some((value) => value.toLowerCase().includes(composerCommandToken));
    }).slice(0, 8);
  }, [composerCommandToken, normalizedComposerInput]);
  const showCommandSuggestions = commandSuggestions.length > 0 && normalizedComposerInput.startsWith('/');

  const applyCommandSuggestion = useCallback((definition: CommandDefinition) => {
    setInput(definition.autocomplete ?? definition.usage);
    setSelectedCommandIndex(0);
  }, []);

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [composerCommandToken]);

  const handleComposerKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCommandSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev + 1) % commandSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev - 1 + commandSuggestions.length) % commandSuggestions.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applyCommandSuggestion(commandSuggestions[selectedCommandIndex] ?? commandSuggestions[0]);
        return;
      }
      if (e.key === 'Enter') {
        const hasSpaces = normalizedComposerInput.includes(' ');
        const exactCommand = COMMAND_DEFINITIONS.some((definition) => {
          const base = definition.command.split(' ')[0].toLowerCase();
          return base === composerCommandToken || (definition.aliases ?? []).includes(composerCommandToken);
        });
        if (!hasSpaces && !exactCommand) {
          e.preventDefault();
          applyCommandSuggestion(commandSuggestions[selectedCommandIndex] ?? commandSuggestions[0]);
          return;
        }
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendRef.current?.();
    }
  }, [applyCommandSuggestion, commandSuggestions, composerCommandToken, normalizedComposerInput, selectedCommandIndex, showCommandSuggestions]);

  const handleSend = async (overrides?: { msg?: string; images?: { name: string; dataUrl: string }[] }): Promise<void> => {
    const effectiveInput = overrides?.msg ?? input;
    if ((!effectiveInput.trim() && attachments.length === 0 && !overrides) || isLoading) return;
    if (!overrides && runLocalCommand(effectiveInput)) {
      setInput('');
      return;
    }
    if (connStatus !== 'ok') {
      setConnectionError('Cannot send: connection unavailable.');
      return;
    }
    const primaryModel =
      primaryProvider === 'ollama' ? ollamaModel :
      primaryProvider === 'openrouter' ? openrouterModel :
      vllmModel;
    // Resolve companion model based on independently-selected secondary provider
    const companionModel =
      secondaryProvider === 'ollama' ? ollamaModel :
      secondaryProvider === 'vllm'   ? vllmModel :
      openrouterModel;

    if (!primaryModel) {
      setConnectionError(`Select a ${primaryProvider === 'ollama' ? 'Ollama' : primaryProvider === 'openrouter' ? 'OpenRouter' : 'vLLM'} model.`);
      setShowSettingsPanel(true);
      return;
    }
    if (parallelMode && !companionModel) {
      setConnectionError(`Parallel mode requires a companion model. Configure ${secondaryProvider} in settings.`);
      setShowSettingsPanel(true);
      return;
    }
    if (parallelMode && primaryProvider === secondaryProvider) {
      setConnectionError('Primary and companion providers must be different for parallel mode.');
      setShowSettingsPanel(true);
      return;
    }

    // First message in parallel mode - start the loop
    const isFirstParallelMsg = parallelMode && !isParallelRunning;
    if (isFirstParallelMsg) setIsParallelRunning(true);

    const userMsg = effectiveInput;
    if (!overrides) setInput('');

    // Build message content with any attachments
    // Images are passed separately (not as base64 in text) to avoid context window overflow
    let fullMsg = userMsg;
    const imageAttachments: { name: string; dataUrl: string }[] = overrides?.images ? [...overrides.images] : [];
    if (!overrides) {
      for (const att of attachments) {
        if (att.isImage && att.dataUrl) {
          imageAttachments.push({ name: att.name, dataUrl: att.dataUrl });
          fullMsg += `\n\n[Attached image: ${att.name}]`;
        } else if (att.text) {
          fullMsg += `\n\n--- Attached: ${att.name} ---\n${att.text}${att.truncated ? '\n[...truncated]' : ''}`;
        }
      }
      for (const m of mediaUrls) {
        fullMsg += `\n\n[Attached ${m.type} URL: ${m.url}]`;
      }
      setAttachments([]);
      setMediaUrls([]);
    }

    setMessages((prev) => [...prev, { role: 'user', content: fullMsg }]);
    setIsLoading(true);
    setStreamPhase('thinking');
    setLiveStatus('');
    toolCallCountRef.current = 0;
    setToolCallCount(0);

    try {
      const mode = parallelMode ? 'parallel' : 'off';
      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          message: fullMsg,
          history: messages.filter(m => m.role !== 'system'),
          model: primaryModel,
          companionModel: parallelMode ? companionModel : undefined,
          systemPrompt: (() => {
            let sp = systemPrompt;
            if (autonomousMode) sp += '\n\n[AUTONOMOUS MODE ACTIVE] You are running in a fully autonomous continuous loop. You will keep running turn after turn until you call stop_agent(reason). Use vision_self_check() to take screenshots and see your work. Use check_window_result(id) to verify UI windows loaded correctly. Be decisive and self-sufficient. Call stop_agent("done") when the task is complete or stop_agent("need_input: question") when you need human input.';
            if (physicsModeActive) sp += '\n\n[PHYSICS MODE ACTIVE] When building a machine, use a concrete workflow: physics_reset(), physics_spawn() a fixed chassis or axle, physics_spawn() the moving part, physics_add_hinge() to connect them, physics_set_motor() to automate it, then physics_get_state() or vision_self_check() to verify the result. Give at least one explicit machine example when you explain or act.';
            if (surveyorMode) sp += '\n\n[CODING SURVEYOR MODE ACTIVE] You are the architect and reviewer supervising application creation through the LocalClawd CLI. Before using it, verify the CLI is available with a terminal command. If LocalClawd is missing, install it with npm install -g localclawd. Then use LocalClawd to generate or iterate on the application while you oversee architecture, validate outputs, inspect files, correct mistakes, and decide the next step. Do not hand-wave the process: explicitly supervise creation, check generated artifacts, and keep control of requirements and quality.';
            return sp;
          })(),
          temperature,
          synergyMode: mode,
          openrouterApiKey: openrouterApiKey || undefined,
          disabledToolGroups: (() => {
            const allGroups = ['web', 'terminal', 'files', 'git', 'vision', 'computer', 'memory', 'comms', 'bots', 'scheduler', 'image', 'self'];
            return allGroups.filter(g => !enabledToolGroups.has(g));
          })(),
          imagePipeline: imagePipeline !== 'none' ? imagePipeline : undefined,
          imageModel: imagePipeline === 'openrouter-image' ? imageModel : undefined,
          autoApproveTerminal: autoApproveTerminal || undefined,
          contextWindow: primaryProvider === 'ollama' ? ollamaContextWindow : primaryProvider === 'openrouter' ? openrouterContextWindow : vllmContextWindow,
          attachedImages: imageAttachments.length > 0 ? imageAttachments : undefined,
          attachedMediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        }),
      });

      if (!res.ok || !res.body) throw new Error('Agent transmission failed.');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = "";
      
      // Placeholder for streaming updates
      setMessages(prev => [...prev, { role: 'assistant', content: "" }]);

      let currentThought = "";
      let currentContent = "";
      let pendingAutoContinue: string | undefined;
      let agentStoppedAuto = false; // stop_agent was called this turn

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);

            if (chunk.type === 'approval_request') {
              setPendingApprovals(prev => {
                if (prev.some(p => p.id === chunk.id)) return prev;
                return [...prev, { id: chunk.id as string, command: chunk.command as string, reason: chunk.reason as string, risk: chunk.risk as string }];
              });
            } else if (chunk.type === 'window') {
              // Mirror terminal output to embedded log
              if (chunk.op === 'append_terminal' && chunk.content) {
                const lines = String(chunk.content).split('\n').filter((l: string) => l.trim());
                if (lines.length > 0) {
                  setTerminalLog(prev => [...prev.slice(-400), ...lines]);
                  setShowTerminalLog(true);
                }
              }
              // Dispatch window event to the floating window layer
              windowManager.dispatch(chunk as any);
            } else if (chunk.type === 'subroutine') {
              // Spawn subroutine as a background agent fetch, stream output to its window
              const { subroutineId, windowId, taskPrompt, model: subModel } = chunk as any;
              (async () => {
                try {
                  const subRes = await fetch('/api/agent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      message: taskPrompt,
                      history: [],
                      model: subModel || primaryModel,
                      stream: true,
                    }),
                  });
                  if (!subRes.ok || !subRes.body) {
                    windowManager.dispatch({ op: 'append_terminal', id: windowId, content: `[sub:${subroutineId}] Error: agent request failed\n` } as any);
                    return;
                  }
                  const subReader = subRes.body.getReader();
                  const subDecoder = new TextDecoder();
                  while (true) {
                    const { done: subDone, value: subValue } = await subReader.read();
                    if (subDone) break;
                    const subLines = subDecoder.decode(subValue, { stream: true }).split('\n');
                    for (const subLine of subLines) {
                      if (!subLine.trim()) continue;
                      try {
                        const sc = JSON.parse(subLine);
                        if (sc.type === 'window') {
                          windowManager.dispatch(sc as any);
                        } else if (sc.type === 'text' && sc.content) {
                          windowManager.dispatch({ op: 'append_terminal', id: windowId, content: sc.content } as any);
                        } else if (sc.type === 'status' && sc.content) {
                          windowManager.dispatch({ op: 'append_terminal', id: windowId, content: `[${sc.content}]\n` } as any);
                        } else if (sc.type === 'done') {
                          windowManager.dispatch({ op: 'append_terminal', id: windowId, content: `\nSubroutine ${subroutineId} complete\n` } as any);
                        }
                      } catch {}
                    }
                  }
                } catch (subErr: any) {
                  windowManager.dispatch({ op: 'append_terminal', id: windowId, content: `[sub:${subroutineId}] Error: ${subErr.message}\n` } as any);
                }
              })();
            } else if (chunk.type === 'thought') {
              currentThought += chunk.content;
              const thoughtBlock = `[THINKING]\n${currentThought}\n[THOUGHT_END]\n`;
              assistantMsg = thoughtBlock + currentContent;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: assistantMsg };
                return next;
              });
            } else if (chunk.type === 'text') {
              setStreamPhase('streaming');
              // Count tool calls in text chunks
              const tc = (chunk.content.match(/```tool/g) || []).length;
              if (tc > 0) {
                toolCallCountRef.current += tc;
                setToolCallCount(toolCallCountRef.current);
                setLiveStatus('');
              }
              currentContent += chunk.content;
              const thoughtBlock = currentThought ? `[THINKING]\n${currentThought}\n[THOUGHT_END]\n` : "";
              assistantMsg = thoughtBlock + currentContent;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: assistantMsg };
                return next;
              });
            } else if (chunk.type === 'status') {
              setLiveStatus(chunk.content);
            } else if (chunk.type === 'error') {
              const errMsg = currentContent
                ? currentContent + `\n\nGÜá Stream error: ${chunk.content}`
                : `GÜá Agent error: ${chunk.content}`;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: errMsg };
                return next;
              });
            } else if (chunk.type === 'stop_agent') {
              // Agent signaled it wants to stop the autonomous loop
              agentStoppedAuto = true;
              autoStopRequestedRef.current = true;
            } else if (chunk.type === 'vision_snapshot') {
              // Store screenshot for next autonomous turn
              pendingVisionSnapshotRef.current = chunk.content as string;
            } else if (chunk.type === 'done') {
              assistantMsg = chunk.content;
              if (chunk.autoContinue) pendingAutoContinue = chunk.autoContinue;
              setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: assistantMsg };
                return next;
              });
            }
          } catch { /* Partial JSON */ }
        }
      }

      if (parallelMode && (isParallelRunning || isFirstParallelMsg)) {
        setTimeout(() => {
          setInput(`Discourse continuation: ${assistantMsg.substring(0, 500)}... Analyze and respond.`);
        }, 1500);
      } else if (pendingAutoContinue) {
        // Auto-continue: agent signaled there is more work to do - trigger after state settles
        setTimeout(() => setAutoContinuePending(pendingAutoContinue!), 600);
      } else if (autonomousMode && !agentStoppedAuto && !autoStopRequestedRef.current) {
        // Autonomous loop: fire next turn automatically
        isAutoRunningRef.current = true;
        autoLoopCountRef.current += 1;
        const loopCount = autoLoopCountRef.current;
        const visionSnap = pendingVisionSnapshotRef.current;
        pendingVisionSnapshotRef.current = null;
        setTimeout(() => {
          const autoMsg = `[AUTO #${loopCount}] Continue your work. Assess current state, make progress, or call stop_agent(reason) when done.`;
          const autoImages = visionSnap ? [{ name: `vision_turn_${loopCount}.png`, dataUrl: visionSnap }] : undefined;
          handleSend({ msg: autoMsg, images: autoImages });
        }, 900);
      } else if (agentStoppedAuto || autoStopRequestedRef.current) {
        // Agent called stop_agent - reset autonomous state
        isAutoRunningRef.current = false;
        autoLoopCountRef.current = 0;
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Agent Error: ${e.message}` }]);
      }
      // Abort or error stops the autonomous loop
      isAutoRunningRef.current = false;
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamPhase('idle');
      setLiveStatus('');
    }
  };

  // When autonomous mode is toggled OFF, stop the loop on next cycle
  useEffect(() => {
    if (!autonomousMode) {
      autoStopRequestedRef.current = true;
      isAutoRunningRef.current = false;
      autoLoopCountRef.current = 0;
    } else {
      autoStopRequestedRef.current = false;
    }
  }, [autonomousMode]);

  useEffect(() => {
    if (!showActionMenu) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      const insidePanel = actionMenuRef.current?.contains(target) ?? false;
      const insideTrigger = actionMenuTriggerRef.current?.contains(target) ?? false;
      if (!insidePanel && !insideTrigger) {
        setShowActionMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showActionMenu]);

  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    const results: Attachment[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/parse-file', { method: 'POST', body: fd });
        const data = await res.json();
        results.push(data);
      } catch (e: any) {
        results.push({ name: file.name, type: file.type, text: `[Error reading file: ${e.message}]` });
      }
    }
    setAttachments(prev => [...prev, ...results]);
    setAttachUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openPhysicsWindow = () => {
    windowManager.dispatch({ op: 'create', id: 'physics', title: 'Physics Simulator', contentType: 'physics', content: '' });
  };

  const handleApproveCmd = async (id: string) => {
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id }),
      });
      if (res.ok) {
        setPendingApprovals(prev => prev.filter(p => p.id !== id));
        const data = await res.json();
        setMessages(prev => [...prev, {
          role: 'system' as const,
          content: `Approved: \`${data.command ?? id}\` - exit ${data.exitCode ?? 0}${data.output ? `\n\`\`\`\n${data.output.slice(0, 800)}\n\`\`\`` : ''}`,
        }]);
      }
    } catch {}
  };

  const handleDenyCmd = async (id: string, command: string) => {
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deny', id }),
      });
      setPendingApprovals(prev => prev.filter(p => p.id !== id));
      setMessages(prev => [...prev, {
        role: 'system' as const,
        content: `Denied: \`${command}\``,
      }]);
    } catch {}
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setStreamPhase('idle');
    setLiveStatus('');
  };

  const handleKill = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setStreamPhase('idle');
    setLiveStatus('');
    setParallelMode(false);
    setIsParallelRunning(false);
    setInput('');
    // Remove the last empty assistant message if present
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && !last.content.trim()) return prev.slice(0, -1);
      return prev;
    });
  };

  const handleFactoryReset = async () => {
    const confirmed = confirm(
      'FACTORY RESET\n\nThis will permanently erase:\n- All saved conversations\n- All memories and knowledge\n- All generated images\n- All weights and learned strategies\n- All workspace files\n\nThis cannot be undone.\n\nAre you sure you want to do this?'
    );
    if (!confirmed) return;
    const confirmed2 = confirm('Are you absolutely sure? All agent memory and history will be lost forever.');
    if (!confirmed2) return;
    try {
      handleKill();
      const res = await fetch('/api/factory-reset', { method: 'DELETE' });
      const data = await res.json();
      setMessages([]);
      setSavedChats([]);
      setChatSummaries({});
      currentChatIdRef.current = null;
      setChatName('New Session');
      setShowSettingsPanel(false);
      setMessages([{
        role: 'system',
        content: `Factory reset complete. Cleared: ${data.cleared?.join(', ') || 'all data'}. OmniShapeAgent is now in its base state.`,
      }]);
    } catch (e: any) {
      alert(`Factory reset failed: ${e.message}`);
    }
  };

  // Keep the handleSend ref current so the auto-loop effect always calls the latest version
  handleSendRef.current = handleSend;

  // Autonomous parallel loop - fires when input is set by the continuation timer above
  useEffect(() => {
    if (!parallelMode || !isParallelRunning || isLoading) return;
    if (!input.startsWith('Discourse continuation:')) return;
    const timer = setTimeout(() => { handleSendRef.current?.(); }, 100);
    return () => clearTimeout(timer);
  }, [input, isParallelRunning, parallelMode, isLoading]);

  // Auto-continue trigger - fires when agent signals [AUTO_CONTINUE: ...]
  const [autoContinuePending, setAutoContinuePending] = useState<string | null>(null);
  useEffect(() => {
    if (!autoContinuePending || isLoading) return;
    const task = autoContinuePending;
    setAutoContinuePending(null);
    setInput(task);
    const timer = setTimeout(() => { handleSendRef.current?.(); }, 300);
    return () => clearTimeout(timer);
  }, [autoContinuePending, isLoading]);

  const toggleParallel = () => {
    if (!parallelMode) {
      setParallelMode(true);
      setIsParallelRunning(false); // will start running after first message
      setShowSettingsPanel(true);  // require provider selection before starting
    } else {
      setParallelMode(false);
      setIsParallelRunning(false);
    }
  };

  const formatContent = (content: string) => {
    // Handle both [THINKING] blocks and native <think> tags
    const thinkingRegex = /(\[THINKING\][\s\S]*?\[THOUGHT_END\]|<think>[\s\S]*?(?:<\/think>|$))/gi;
    const parts = content.split(thinkingRegex);

    return parts.map((part, i) => {
      if (!part) return null;

      const isThinkBlock = part.startsWith('[THINKING]') || part.toLowerCase().startsWith('<think>');

      if (isThinkBlock) {
        // Extract label if present: [THINKING] (LABEL)
        const labelMatch = part.match(/\[THINKING\]\s*\((.*?)\)/i);
        const label = labelMatch ? labelMatch[1] : 'Neural Reflection';
        const thought = part
          .replace(/\[THINKING\]\s*\(.*?\)/i, '')
          .replace('[THINKING]', '')
          .replace('[THOUGHT_END]', '')
          .replace(/<think>/i, '')
          .replace(/<\/think>/i, '')
          .trim();
        
        if (!thought) return null;

        return (
          <div key={i} className="my-4 border-l-2 border-black/10 pl-5 py-2 animate-in fade-in slide-in-from-left-2 duration-300">
            <p className="text-[10px] font-black uppercase tracking-widest text-black/30 mb-2">{label}</p>
            <p className="text-[12px] text-black/40 italic leading-relaxed whitespace-pre-wrap">{thought}</p>
          </div>
        );
      }
      // Detect inline images: markdown ![alt](url) or bare /api/file?path=... URLs
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)|(?:^|\s)(\/api\/file\?path=[^\s"']+\.(?:png|jpg|jpeg|gif|webp))/gi;
      const segments: React.ReactNode[] = [];
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      imgRegex.lastIndex = 0;
      while ((m = imgRegex.exec(part)) !== null) {
        if (m.index > lastIdx) segments.push(part.slice(lastIdx, m.index));
        const url = m[2] || m[3]?.trim();
        const alt = m[1] || 'Generated image';
        if (url) {
          segments.push(
            <img key={`img-${m.index}`} src={url} alt={alt}
              className="max-w-full rounded-lg border border-black/10 my-2 block"
              style={{ maxHeight: 480 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          );
        }
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < part.length) segments.push(part.slice(lastIdx));
      return <p key={i} className="font-black whitespace-pre-wrap">{segments.length > 1 || segments.some(s => typeof s !== 'string') ? segments : part}</p>;
    });
  };

  return (
    <div className="relative h-full w-full bg-[#FDFCF0] text-[#000000] flex font-sans selection:bg-emerald-200 overflow-hidden">
      {/* Main UI Container */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-black/10 bg-[#FDFCF0] sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <MerkabaLogo size={36} />
            <div className="flex flex-col">
              <h1 className="text-sm font-black tracking-tight">OmniShapeAgent</h1>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${connStatus === 'ok' ? 'bg-[#000000]' : connStatus === 'testing' ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className="text-[10px] font-black uppercase tracking-widest leading-none opacity-40">
                  {connStatus === 'testing' ? 'Syncing' : connStatus === 'fail' ? 'Offline' : (
                    primaryProvider === 'vllm' ? `vLLM${vllmStatus === 'no-models' ? ' (no models)' : ''}` :
                    primaryProvider === 'openrouter' ? `OpenRouter${openrouterStatus === 'no-models' ? ' (no models)' : ''}` :
                    `Ollama${ollamaStatus === 'no-models' ? ' (no models)' : ''}`
                  )}{parallelMode ? ' | Parallel' : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center">
            <input 
              value={chatName} 
              onChange={(e) => setChatName(e.target.value)}
              className="hidden md:block bg-transparent text-right text-xs font-black text-black/40 focus:text-black outline-none border-none px-4 py-1 max-w-[200px]"
              placeholder="Untitled Chat"
            />
            <div className="relative flex items-center gap-2 transition-all">
              <div className="hidden">
                <VoiceButton
                  ref={voiceRef}
                  onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)}
                  lastAssistantMessage={lastAssistantMsg}
                  disabled={isLoading}
                  onStateChange={setVoiceControlState}
                />
              </div>
              <button
                ref={actionMenuTriggerRef}
                onClick={() => { setShowActionMenu(prev => !prev); setShowSettingsPanel(false); }}
                title="Open control panel"
                className={`p-2.5 rounded-lg hover:bg-black/5 active:scale-95 transition-all ${showActionMenu ? 'bg-black text-[#FDFCF0]' : 'text-black/60'}`}
              >
                <Icons.More />
              </button>
              <button
                onClick={() => { setShowSettingsPanel(!showSettingsPanel); setShowActionMenu(false); }}
                title="Open settings"
                className={`p-2.5 rounded-lg hover:bg-black/5 active:scale-95 transition-all ${showSettingsPanel ? 'bg-black text-[#FDFCF0]' : 'text-black/60'}`}
              >
                <Icons.Gear />
              </button>
            </div>
          </div>
        </header>

        {/* Messaging Zone */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {showActionMenu && (
            <div className="pointer-events-none absolute top-4 right-0 z-20 flex w-full justify-end pr-4 md:top-5 md:pr-6" ref={actionMenuRef}>
              <div className="pointer-events-auto w-[min(380px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[10px] border border-white/10 bg-[#111] shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
                <div className="flex h-8 items-center gap-2 border-b border-white/10 bg-[#1a1a1a] px-3">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                  <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                  <span className="flex-1 text-center text-[11px] font-semibold tracking-[0.04em] text-white/60">Control Panel</span>
                </div>
                <div className="max-h-[70vh] overflow-y-auto bg-[#FDFCF0] p-4 text-black">
                  <div className="mb-4 px-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-black/40">Control Panel</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-black/45">Modes stay active until you turn them off. Utilities open panels, windows, or immediate actions. Commands mirror every option here.</div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-black/35">Modes</div>
                      <div className="grid grid-cols-1 gap-2">
                        <ActionMenuButton icon={<Icons.Synergy />} label="Parallel Mode" command="/parallel" description="Run a second model alongside the primary model." active={parallelMode} onClick={toggleParallel} />
                        <ActionMenuButton icon={<Icons.Autonomous active={autonomousMode} running={autonomousMode && isAutoRunningRef.current} />} label="Autonomous Mode" command="/autonomous" description="Keep working until stop_agent is called or you turn it off." active={autonomousMode} onClick={() => { setAutonomousMode(v => !v); }} />
                        <ActionMenuButton icon={<Icons.Heartbeat />} label="Heartbeat Mode" command={`/heartbeat ${heartbeatIntervalMinutes}`} description={`Schedule an automatic check-in every ${heartbeatIntervalMinutes} minute${heartbeatIntervalMinutes === 1 ? '' : 's'}.`} active={heartbeatMode} onClick={() => { applyHeartbeatSetting(!heartbeatMode, heartbeatIntervalMinutes); }} />
                        <ActionMenuButton icon={<Icons.Architect />} label="Coding Surveyor" command="/surveyor" description="Use LocalClawd as the builder while the architect supervises application design and quality." active={surveyorMode} onClick={() => { setSurveyorMode(v => !v); }} />
                        <ActionMenuButton icon={<Icons.Mic />} label="Voice Input" command="/voice input" description="Start or stop microphone transcription." active={voiceControlState.listening} onClick={() => { voiceRef.current?.toggleListening(); }} />
                        <ActionMenuButton icon={<Icons.Speaker />} label="Voice Output" command="/voice output" description="Enable or disable automatic spoken responses." active={voiceControlState.voiceOutputEnabled} onClick={() => { voiceRef.current?.setVoiceOutputEnabled(!voiceControlState.voiceOutputEnabled); }} />
                      </div>
                      <div className="mt-2 rounded-2xl border border-black/10 bg-white/80 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-black/40">Heartbeat Interval</div>
                            <div className="mt-1 text-[11px] text-black/45">Choose how often the agent should auto-check in while the session is idle.</div>
                          </div>
                          <div className="text-sm font-black text-black">{heartbeatIntervalMinutes}m</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {[5, 15, 30, 60].map((minutes) => (
                            <button
                              key={minutes}
                              onClick={() => setHeartbeatIntervalMinutes(minutes)}
                              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${heartbeatIntervalMinutes === minutes ? 'border-black bg-black text-[#FDFCF0]' : 'border-black/10 bg-[#FDFCF0] text-black/50 hover:border-black/35 hover:text-black'}`}
                            >
                              {minutes}m
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.22em] text-black/35">More</div>
                      <div className="grid grid-cols-1 gap-2">
                        <ActionMenuButton icon={<Icons.Bubble />} label="Saved Chats" command="/history" description="Browse, restore, and delete saved chat sessions." active={showSavedPanel} onClick={() => { resetUtilityPanels(); setShowSavedPanel(true); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Memory />} label="Memory Browser" command="/memory" description="Inspect, boost, and delete persistent memories." active={showMemoryPanel} onClick={() => { resetUtilityPanels(); setShowMemoryPanel(true); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Trophy />} label="Hall of Fame" command="/hall" description="Inspect top learned bot runs and strategies." active={showHallOfFame} onClick={() => { resetUtilityPanels(); setShowHallOfFame(true); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Physics />} label="Physics Simulator" command="/physics" description="Open the physics workspace for live experiments." active={physicsModeActive} onClick={openPhysicsWindow} />
                        <ActionMenuButton icon={<Icons.Architect />} label="LocalClawd Builder" command="/localclawd" description="Create a new directory and supervise LocalClawd as it builds and tests the requested app." onClick={() => { appendSystemMessage('Run /localclawd <directory> <app specification> to launch a supervised LocalClawd build.'); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Bitcoin />} label="Crypto Wallet" command="/wallet" description="Manage local wallets and balance lookups." active={showCryptoWallet} onClick={() => { resetUtilityPanels(); setShowCryptoWallet(true); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Moltbook />} label="Moltbook" command="/moltbook" description="Open Moltbook shortcuts and posting prompts." active={showMoltbook} onClick={() => { resetUtilityPanels(); setShowMoltbook(true); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Bubble />} label="Discord Workflow" command="/discord" description="Have the agent inspect or run the next Discord action through tools and memory." onClick={() => { runLocalCommand('/discord'); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Instagram />} label="Instagram Workflow" command="/instagram" description="Have the agent inspect or run the next Instagram action through tools and memory." onClick={() => { runLocalCommand('/instagram'); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Gear />} label="System Doctor" command="/doctor" description="Run a full system diagnosis through the agent runtime." onClick={() => { runLocalCommand('/doctor'); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Gear />} label="Tool Audit" command="/toolaudit" description="Have the agent audit core tool health and show only actionable issues." onClick={() => { runLocalCommand('/toolaudit'); setShowActionMenu(false); }} />
                        <ActionMenuButton icon={<Icons.Refresh />} label="New Session" command="/new" description="Clear the current chat and start fresh." onClick={() => { startNewSession(); setShowActionMenu(false); }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <main className="flex-1 overflow-y-auto px-4 md:px-12 py-8 space-y-6 scrollbar-hide text-[#000000]">
            {messages.map((msg, idx) => {
              const isLastAssistant = isLoading && idx === messages.length - 1 && msg.role === 'assistant';
              return (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`group relative max-w-[90%] md:max-w-[80%] rounded-xl px-5 py-3.5 text-sm leading-relaxed border ${
                    msg.role === 'user'
                      ? 'bg-[#000000] text-[#FDFCF0] border-[#000000]'
                      : msg.role === 'assistant'
                        ? 'bg-white border-black/10 text-black shadow-sm'
                        : 'bg-amber-50 text-black italic text-[11px] border-amber-200'
                  }`}>
                    {formatContent(msg.content)}
                    {isLastAssistant && streamPhase === 'streaming' && (
                      <span className="inline-block w-[2px] h-[1em] bg-black/50 ml-[1px] align-[-1px] animate-pulse" />
                    )}
                  </div>
                </div>
              );
            })}
            {/* Inline terminal approval cards */}
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="flex justify-start px-4 md:px-8 py-2">
                <div className="max-w-xl w-full bg-amber-50 border-2 border-amber-400 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                        approval.risk === 'high' ? 'bg-red-100 text-red-700 border-red-300' :
                        approval.risk === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                        'bg-green-100 text-green-700 border-green-300'
                      }`}>{approval.risk}</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">Terminal - Awaiting Approval</span>
                    </div>
                    <button
                      onClick={() => handleDenyCmd(approval.id, approval.command)}
                      className="text-black/30 hover:text-black/60 text-xs leading-none"
                    >x</button>
                  </div>
                  <code className="block text-xs font-mono text-black bg-black/5 rounded-lg px-3 py-2 break-all">{approval.command}</code>
                  {approval.reason && approval.reason !== 'Agent command' && (
                    <p className="text-[11px] text-amber-700 border-l-2 border-amber-300 pl-2">{approval.reason}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleApproveCmd(approval.id)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-black text-[#FDFCF0] text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-black/80 active:scale-95 transition-all"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDenyCmd(approval.id, approval.command)}
                      className="flex items-center gap-1.5 px-4 py-2 border-2 border-black text-black text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-black/5 active:scale-95 transition-all"
                    >
                      Deny
                    </button>
                    <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoApproveTerminal}
                        onChange={(e) => setAutoApproveTerminal(e.target.checked)}
                        className="w-3 h-3 accent-black"
                      />
                      <span className="text-[10px] font-black text-black/50 uppercase tracking-widest">Auto-approve</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
            {isLoading && streamPhase === 'thinking' && (
              <div className="flex justify-start animate-in fade-in duration-200">
                <div className="bg-white border border-black/10 rounded-xl px-5 py-3.5 flex items-center gap-3 min-w-[180px]">
                  <div className="flex gap-[3px] items-center">
                    <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                    <span className="w-1 h-1 bg-black/40 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/30">
                    {liveStatus ? liveStatus.slice(0, 40) : 'Thinking'}
                  </span>
                </div>
              </div>
            )}
            <div ref={endRef} className="h-24" />
          </main>

          {/* Saved Chats Panel */}
          {showSavedPanel && (
            <FloatingPanel
              title="Saved Chats"
              onClose={() => { setShowSavedPanel(false); setSelectedChats(new Set()); }}
              defaultW={420}
              defaultH={620}
              defaultX={60}
              defaultY={60}
            >
              <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between bg-[#FDFCF0] text-black border-b border-black/10">
                <div className="flex items-center gap-2">
                  {savedChats.length > 0 && (
                    <span className="text-[10px] font-black text-black/40 uppercase tracking-widest">{savedChats.length} chats</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {savedChats.length > 0 && (
                    <button
                      onClick={() => {
                        if (selectedChats.size === savedChats.length) {
                          setSelectedChats(new Set());
                        } else {
                          setSelectedChats(new Set(savedChats.map(c => c.id)));
                        }
                      }}
                      className="text-[9px] font-black uppercase tracking-widest text-black/40 hover:text-black px-2 py-1 border border-black/20 rounded hover:border-black transition-colors"
                    >
                      {selectedChats.size === savedChats.length ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                  {selectedChats.size > 0 && (
                    <button
                      onClick={deleteSelectedChats}
                      className="text-[9px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 px-2 py-1 border border-red-300 rounded transition-colors"
                    >
                      Delete {selectedChats.size}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-black/5 text-black" style={{ minHeight: 0 }}>
                {savedChats.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-20">
                    <p className="text-sm font-black uppercase tracking-[0.3em]">No Records</p>
                  </div>
                )}
                {savedChats.map((chat) => {
                  const ts = new Date(chat.updatedAt ?? chat.createdAt);
                  const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                  const isActive = currentChatIdRef.current === chat.id;
                  const isSelected = selectedChats.has(chat.id);
                  return (
                    <div
                      key={chat.id}
                      className={`w-full text-left p-4 border transition-all flex items-start gap-3 ${
                        isSelected
                          ? 'bg-black/10 border-black/40'
                          : isActive
                          ? 'bg-black text-[#FDFCF0] border-black'
                          : 'bg-[#FDFCF0] border-black/10 hover:border-black'
                      }`}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedChats(prev => {
                            const n = new Set(prev);
                            if (isSelected) n.delete(chat.id); else n.add(chat.id);
                            return n;
                          });
                        }}
                        className="mt-1 w-3.5 h-3.5 flex-shrink-0 cursor-pointer accent-black"
                      />
                      <button
                        onClick={() => loadSavedChat(chat.id)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className={`text-xs font-black uppercase tracking-tight mb-1 truncate ${isActive && !isSelected ? 'text-[#FDFCF0]' : 'text-black'}`}>
                          {chat.name}
                        </p>
                        <p className={`text-[10px] font-mono mb-2 tabular-nums ${isActive && !isSelected ? 'text-white/50' : 'text-black/40'}`}>
                          {dateStr} -+ {timeStr}
                          {chat.messageCount > 0 && <span className="ml-2 opacity-60">{chat.messageCount} msgs</span>}
                        </p>
                        <p className={`text-[11px] line-clamp-2 leading-snug border-l-2 pl-3 py-0.5 ${isActive && !isSelected ? 'border-white/30 text-white/70' : 'border-black/10 text-black/60'}`}>
                          {chatSummaries[chat.id] || <span className="italic opacity-40">No summary</span>}
                        </p>
                      </button>
                      <button
                        onClick={(e) => deleteSavedChat(chat.id, e)}
                        className={`p-1.5 flex-shrink-0 transition-colors ${isActive && !isSelected ? 'text-white/30 hover:text-red-400' : 'text-black/20 hover:text-red-600'}`}
                      >
                        <Icons.Trash />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 border-t border-black/10 bg-[#FDFCF0] flex-shrink-0">
                <button
                  onClick={() => { setMessages([]); setChatName('New Session'); currentChatIdRef.current = null; setShowSavedPanel(false); setSelectedChats(new Set()); }}
                  className="w-full py-4 bg-black text-[#FDFCF0] rounded-md text-[11px] font-black transition-all active:scale-95 uppercase tracking-[0.3em]"
                >
                  + Reset Environment
                </button>
              </div>
            </FloatingPanel>
          )}

          {/* Settings Panel */}
          {showSettingsPanel && (
            <FloatingPanel
              title={parallelMode ? 'Parallel Discourse' : 'Inference Logic'}
              onClose={() => setShowSettingsPanel(false)}
              defaultW={380}
              defaultH={680}
              defaultX={typeof window !== 'undefined' ? Math.max(40, window.innerWidth - 420) : 600}
              defaultY={60}
            >
              <div className="flex-1 overflow-y-auto bg-[#FDFCF0] text-black p-5 pb-12 space-y-5">
              {parallelMode && !isParallelRunning && (
                <p className="text-[10px] text-amber-700 font-black">Select two providers below, then send a topic to begin.</p>
              )}

              {/* Per-provider status dropdown */}
              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-widest text-black/40">Active Provider</label>
                <select
                  value={primaryProvider}
                  onChange={(e) => setPrimaryProvider(e.target.value as 'ollama' | 'vllm' | 'openrouter')}
                  className="w-full bg-white border-2 border-black rounded-lg px-3 py-2.5 text-xs font-black outline-none appearance-none cursor-pointer hover:bg-black/5 transition-colors"
                >
                  <option value="ollama">
                    Ollama - Local {ollamaStatus === 'ok' ? `(${ollamaModels.length} models)` : ollamaStatus === 'no-models' ? '(no models)' : '(checking...)'}
                  </option>
                  <option value="vllm">
                    vLLM - Cluster {vllmStatus === 'ok' ? `(${vllmModels.length} models)` : vllmStatus === 'no-models' ? '(no models)' : '(checking...)'}
                  </option>
                  <option value="openrouter">
                    OpenRouter - Cloud {openrouterStatus === 'ok' ? `(${openrouterModels.length} models)` : openrouterApiKey ? '(checking...)' : '(set API key)'}
                  </option>
                </select>
              </div>
              
              <div className="space-y-4 text-black">
                {parallelMode ? (
                  /* Parallel mode: pick 2 providers */
                  <div className="space-y-6">
                    {/* Provider pair selectors */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Primary slot */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-black/40 uppercase tracking-[0.2em]">Primary (Architect)</label>
                        <select
                          value={primaryProvider}
                          onChange={(e) => {
                            const val = e.target.value as 'ollama' | 'vllm' | 'openrouter';
                            setPrimaryProvider(val);
                            // Auto-update secondary if collision
                            if (val === secondaryProvider) {
                              const opts: Array<'ollama' | 'vllm' | 'openrouter'> = ['ollama', 'vllm', 'openrouter'];
                              setSecondaryProvider(opts.find(o => o !== val) || 'ollama');
                            }
                          }}
                          className="w-full bg-white border-2 border-black rounded-lg px-3 py-2.5 text-xs font-black outline-none appearance-none cursor-pointer"
                        >
                          <option value="vllm">vLLM {vllmStatus === 'ok' ? `(${vllmModels.length})` : vllmStatus === 'no-models' ? '(no models)' : ''}</option>
                          <option value="ollama">Ollama {ollamaStatus === 'ok' ? `(${ollamaModels.length})` : ollamaStatus === 'no-models' ? '(no models)' : ''}</option>
                          <option value="openrouter">OpenRouter {openrouterStatus === 'ok' ? `(${openrouterModels.length})` : '(cloud)'}</option>
                        </select>
                      </div>
                      {/* Secondary slot */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-black/40 uppercase tracking-[0.2em]">Companion (Auditor)</label>
                        <select
                          value={secondaryProvider}
                          onChange={(e) => {
                            const val = e.target.value as 'ollama' | 'vllm' | 'openrouter';
                            setSecondaryProvider(val);
                            if (val === primaryProvider) {
                              const opts: Array<'ollama' | 'vllm' | 'openrouter'> = ['ollama', 'vllm', 'openrouter'];
                              setPrimaryProvider(opts.find(o => o !== val) || 'vllm');
                            }
                          }}
                          className="w-full bg-white border-2 border-black rounded-lg px-3 py-2.5 text-xs font-black outline-none appearance-none cursor-pointer"
                        >
                          {(['ollama', 'vllm', 'openrouter'] as const).filter(p => p !== primaryProvider).map(p => (
                            <option key={p} value={p}>
                              {p === 'vllm' ? `vLLM ${vllmStatus === 'ok' ? `(${vllmModels.length})` : ''}` :
                               p === 'ollama' ? `Ollama ${ollamaStatus === 'ok' ? `(${ollamaModels.length})` : ''}` :
                               `OpenRouter ${openrouterStatus === 'ok' ? `(${openrouterModels.length})` : '(cloud)'}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Model pickers for both selected providers */}
                    <div className="grid grid-cols-2 gap-6 pt-2 border-t border-black/10">
                      {/* Primary model picker */}
                      <ProviderModelPicker
                        provider={primaryProvider}
                        label="Primary Model"
                        ollamaUrl={ollamaUrl} setOllamaUrl={setOllamaUrl}
                        ollamaModel={ollamaModel} setOllamaModel={setOllamaModel}
                        ollamaModels={ollamaModels} ollamaStatus={ollamaStatus}
                        vllmUrl={vllmUrl} setVllmUrl={setVllmUrl}
                        vllmModel={vllmModel} setVllmModel={setVllmModel}
                        vllmModels={vllmModels} vllmStatus={vllmStatus}
                        vllmProbeResult={vllmProbeResult} runVllmProbe={runVllmProbe}
                        openrouterApiKey={openrouterApiKey} setOpenrouterApiKey={setOpenrouterApiKey}
                        openrouterModel={openrouterModel} setOpenrouterModel={setOpenrouterModel}
                        openrouterModels={openrouterModels} openrouterStatus={openrouterStatus}
                      />
                      {/* Secondary model picker */}
                      <ProviderModelPicker
                        provider={secondaryProvider}
                        label="Companion Model"
                        ollamaUrl={ollamaUrl} setOllamaUrl={setOllamaUrl}
                        ollamaModel={ollamaModel} setOllamaModel={setOllamaModel}
                        ollamaModels={ollamaModels} ollamaStatus={ollamaStatus}
                        vllmUrl={vllmUrl} setVllmUrl={setVllmUrl}
                        vllmModel={vllmModel} setVllmModel={setVllmModel}
                        vllmModels={vllmModels} vllmStatus={vllmStatus}
                        vllmProbeResult={vllmProbeResult} runVllmProbe={runVllmProbe}
                        openrouterApiKey={openrouterApiKey} setOpenrouterApiKey={setOpenrouterApiKey}
                        openrouterModel={openrouterModel} setOpenrouterModel={setOpenrouterModel}
                        openrouterModels={openrouterModels} openrouterStatus={openrouterStatus}
                      />
                    </div>
                  </div>
                ) : (
                  /* Single mode: provider dropdown + model picker */
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-black/40 uppercase tracking-[0.2em]">Inference Provider</label>
                      <select
                        value={primaryProvider}
                        onChange={(e) => setPrimaryProvider(e.target.value as 'ollama' | 'vllm' | 'openrouter')}
                        className="w-full bg-white border-2 border-black rounded-lg px-4 py-3 text-xs font-black outline-none appearance-none cursor-pointer hover:bg-black/5 transition-colors"
                      >
                        <option value="vllm">vLLM - Cluster {vllmStatus === 'ok' ? `(${vllmModels.length})` : vllmStatus === 'no-models' ? '(no models)' : ''}</option>
                        <option value="ollama">Ollama - Local {ollamaStatus === 'ok' ? `(${ollamaModels.length})` : ollamaStatus === 'no-models' ? '(no models)' : ''}</option>
                        <option value="openrouter">OpenRouter - Cloud {openrouterStatus === 'ok' ? `(${openrouterModels.length})` : openrouterStatus === 'no-models' ? '(no models)' : '(set API key)'}</option>
                      </select>
                    </div>

                    {/* Render the appropriate config section for the selected provider */}
                    <ProviderModelPicker
                      provider={primaryProvider}
                      label="Active Model"
                      ollamaUrl={ollamaUrl} setOllamaUrl={setOllamaUrl}
                      ollamaModel={ollamaModel} setOllamaModel={setOllamaModel}
                      ollamaModels={ollamaModels} ollamaStatus={ollamaStatus}
                      vllmUrl={vllmUrl} setVllmUrl={setVllmUrl}
                      vllmModel={vllmModel} setVllmModel={setVllmModel}
                      vllmModels={vllmModels} vllmStatus={vllmStatus}
                      vllmProbeResult={vllmProbeResult} runVllmProbe={runVllmProbe}
                      openrouterApiKey={openrouterApiKey} setOpenrouterApiKey={setOpenrouterApiKey}
                      openrouterModel={openrouterModel} setOpenrouterModel={setOpenrouterModel}
                      openrouterModels={openrouterModels} openrouterStatus={openrouterStatus}
                    />
                  </div>
                )}

                {/* Tool group toggles */}
                <div className="pt-3 border-t border-dashed border-black/10">
                  <button
                    onClick={() => setShowToolsPanel(p => !p)}
                    className="flex items-center justify-between w-full group"
                  >
                    <div className="flex items-center gap-2">
                      <label className="text-[9px] font-black uppercase tracking-widest text-black/40 cursor-pointer">Tools</label>
                      <span className="text-[8px] font-black text-black/25 uppercase tracking-widest">
                        {enabledToolGroups.size}/12 enabled
                      </span>
                    </div>
                    <span className={`text-[10px] text-black/30 transition-transform ${showToolsPanel ? 'rotate-90' : ''}`}>{'>'}</span>
                  </button>

                  {showToolsPanel && (
                    <div className="mt-3 border border-black/10 rounded-xl overflow-hidden">
                      {/* All / None header */}
                      <div className="flex items-center justify-between px-3 py-2 bg-black/[0.02] border-b border-black/5">
                        <span className="text-[8px] font-black text-black/30 uppercase tracking-widest">Toggle Groups</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEnabledToolGroups(new Set(['web', 'terminal', 'files', 'git', 'vision', 'computer', 'memory', 'comms', 'bots', 'scheduler', 'image', 'self']))}
                            className="text-[8px] font-black text-black/40 hover:text-black uppercase tracking-widest transition-colors"
                          >All On</button>
                          <span className="text-black/10">|</span>
                          <button
                            onClick={() => setEnabledToolGroups(new Set())}
                            className="text-[8px] font-black text-black/40 hover:text-black uppercase tracking-widest transition-colors"
                          >All Off</button>
                        </div>
                      </div>
                      {/* Checkbox list */}
                      <div className="divide-y divide-black/5">
                        {([
                          ['web', 'Web', 'search_internet, fetch_url, http_request, http_post'],
                          ['terminal', 'Terminal', 'run_terminal_command, run_python, run_js'],
                          ['files', 'Files', 'read/write/patch/delete/move/zip files'],
                          ['git', 'Git', 'status, diff, log, add, commit, push, pull'],
                          ['vision', 'Vision', 'screenshot, analyze_image, describe_screen, ocr'],
                          ['computer', 'Computer', 'mouse, keyboard, open_url, wait'],
                          ['memory', 'Memory', 'memory_store/search/list, graph_add/query'],
                          ['comms', 'Comms', 'send_telegram, send_email'],
                          ['bots', 'Bots', 'deploy_bot, list_bots, stop_bot, spawn_subroutine'],
                          ['scheduler', 'Scheduler', 'schedule_cron, schedule_resonance'],
                          ['image', 'Image Gen', 'generate_image (Stable Diffusion / OpenRouter)'],
                          ['self', 'Self-Ref', 'read_self, list_all_tools, diagnose_system'],
                        ] as const).map(([key, label, desc]) => {
                          const on = enabledToolGroups.has(key);
                          return (
                            <label
                              key={key}
                              className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-black/[0.02] transition-colors ${on ? '' : 'opacity-40'}`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => setEnabledToolGroups(prev => {
                                  const n = new Set(prev);
                                  if (on) n.delete(key); else n.add(key);
                                  return n;
                                })}
                                className="mt-0.5 w-3.5 h-3.5 accent-black flex-shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-[10px] font-black text-black uppercase tracking-widest">{label}</p>
                                <p className="text-[9px] text-black/30 font-black truncate">{desc}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Image pipeline */}
                <div className="pt-3 border-t border-dashed border-black/10 space-y-1.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-black/40">Image Pipeline</label>
                  <select
                    value={imagePipeline}
                    onChange={(e) => setImagePipeline(e.target.value as typeof imagePipeline)}
                    className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black"
                  >
                    <option value="none">None (disabled)</option>
                    <option value="stable-diffusion">Stable Diffusion (local GPU)</option>
                    <option value="openrouter-image">OpenRouter Image Models</option>
                  </select>
                  {imagePipeline === 'openrouter-image' && (
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-black/30 uppercase tracking-[0.2em]">Image Model</label>
                      <select
                        value={imageModel}
                        onChange={(e) => setImageModel(e.target.value)}
                        className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black"
                      >
                        <option value="black-forest-labs/flux-schnell">FLUX Schnell (fast)</option>
                        <option value="black-forest-labs/flux-1.1-pro">FLUX 1.1 Pro</option>
                        <option value="black-forest-labs/flux-pro">FLUX Pro</option>
                        <option value="stability/stable-diffusion-3-5-large">SD 3.5 Large</option>
                        <option value="openai/dall-e-3">DALL-E 3</option>
                        <option value="openai/dall-e-2">DALL-E 2</option>
                      </select>
                    </div>
                  )}
                  {imagePipeline === 'stable-diffusion' && (
                    <p className="text-[9px] text-black/30 font-black">
                      Uses diffusers locally. GPU recommended. Model: stabilityai/stable-diffusion-2-1-base (auto-downloaded on first use).
                    </p>
                  )}
                  {imagePipeline !== 'none' && (
                    <p className="text-[9px] text-black/40 font-black">
                      Agent will use <code className="font-mono">generate_image(prompt)</code> to produce images, displayed inline in chat.
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-dashed border-black/10 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] font-black text-black/40 uppercase tracking-widest">Temperature</label>
                        <span className="text-[10px] font-black px-1.5 py-0.5 bg-black text-white rounded">{(temperature || 0).toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        className="w-full accent-black h-1 bg-black/10 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={autoSaveEnabled}
                        onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                        className="w-4 h-4 border border-black rounded accent-black cursor-pointer"
                      />
                      <span className="text-[9px] font-black text-black/40 uppercase tracking-widest whitespace-nowrap">Auto-Save</span>
                    </label>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-black/40 uppercase tracking-widest">System Prompt</label>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={4}
                      className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-medium focus:bg-[#FDFCF0] outline-none resize-none leading-relaxed focus:border-black"
                      placeholder="Optional - leave blank for default."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={testConnection}
                      disabled={connStatus === 'testing'}
                      className="flex-[2] bg-black text-[#FDFCF0] py-2 rounded-lg text-[10px] font-black transition-all active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-50 uppercase tracking-[0.15em]"
                    >
                      <Icons.Refresh />
                      {connStatus === 'testing' ? 'Syncing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => saveCurrentChat()}
                      className="flex-1 border border-black text-black rounded-lg py-2 flex items-center justify-center gap-1.5 text-[10px] font-black hover:bg-black hover:text-white transition-all active:scale-95 uppercase tracking-[0.15em]"
                    >
                      <Icons.Save />
                      Save
                    </button>
                  </div>
                </div>

                {connectionError && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-[10px] font-black text-amber-800">
                    {connectionError}
                  </div>
                )}

                {/* Context Window Settings */}
                <div className="pt-3 border-t border-dashed border-black/10 space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Context Window (tokens)</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { label: 'Ollama', val: ollamaContextWindow, set: setOllamaContextWindow },
                      { label: 'vLLM', val: vllmContextWindow, set: setVllmContextWindow },
                      { label: 'OR', val: openrouterContextWindow, set: setOpenrouterContextWindow },
                    ]).map(({ label, val, set }) => (
                      <div key={label} className="space-y-0.5">
                        <label className="text-[8px] font-black text-black/30 uppercase tracking-[0.15em]">{label}</label>
                        <input
                          type="number"
                          value={val}
                          onChange={(e) => set(Math.max(8000, parseInt(e.target.value) || 120000))}
                          step={8000}
                          min={8000}
                          className="w-full bg-white border border-black/30 rounded-md px-2 py-1 text-[10px] font-mono outline-none focus:border-black"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Terminal auto-approve */}
                <div className="pt-3 border-t border-dashed border-black/10">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-black/40">Terminal Auto-Approve</p>
                      <p className="text-[9px] text-black/30 mt-0.5">Skip confirmation on all commands.</p>
                    </div>
                    <button
                      onClick={() => setAutoApproveTerminal(v => !v)}
                      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${autoApproveTerminal ? 'bg-black' : 'bg-black/20'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoApproveTerminal ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </label>
                </div>

                {/* Remote Access */}
                <div className="pt-3 border-t border-dashed border-black/10">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40 mb-1">Remote Access</p>
                  <code className="text-[9px] font-mono bg-black/5 px-2 py-1 rounded text-black/50">npx next dev -H 0.0.0.0</code>
                </div>

                {/* Danger zone */}
                <div className="pt-3 border-t border-dashed border-red-200 space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-red-400">Danger Zone</p>
                  <button
                    onClick={handleFactoryReset}
                    className="w-full py-2 border border-red-300 text-red-600 rounded-lg text-[10px] font-black hover:bg-red-50 hover:border-red-500 transition-all active:scale-95 uppercase tracking-[0.15em]"
                  >
                    Factory Reset
                  </button>
                </div>
              </div>
            </div>
            </FloatingPanel>
          )}
          {/* Memory Browser Panel */}
          <MemoryPanel isOpen={showMemoryPanel} onClose={() => setShowMemoryPanel(false)} />

          {/* Hall of Fame Panel */}
          {showHallOfFame && (
            <HallOfFame isOpen={showHallOfFame} onClose={() => setShowHallOfFame(false)} />
          )}

          {/* Moltbook Panel */}
          {showMoltbook && (
            <FloatingPanel title="Moltbook" onClose={() => setShowMoltbook(false)} defaultW={380} defaultH={520} defaultX={typeof window !== 'undefined' ? Math.max(40, window.innerWidth - 420) : 600} defaultY={60}>
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FDFCF0] text-black" style={{ minHeight: 0 }}>
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Agent Identity</p>
                  <p className="text-sm font-black">OmniShapeAgent</p>
                  <p className="text-xs text-black/50">AI agent social network - post, follow, discuss.</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Quick Actions</p>
                  {[
                    { label: 'Register on Moltbook', prompt: 'Register OmniShapeAgent on Moltbook using moltbook_register, then store the api_key with set_env_key and show me the claim_url for verification.' },
                    { label: 'Check Dashboard', prompt: 'Check my Moltbook dashboard with moltbook_home() and summarize notifications and what to do next.' },
                    { label: 'Read Hot Feed', prompt: 'Fetch the Moltbook hot feed and summarize the top 5 most interesting posts.' },
                    { label: 'Post an Update', prompt: 'Post an interesting update to Moltbook general about what I\'ve been working on recently.' },
                    { label: 'Search AI Topics', prompt: 'Search Moltbook for "autonomous AI agents" and show me interesting results.' },
                    { label: 'View My Profile', prompt: 'Show my Moltbook profile with moltbook_profile().' },
                  ].map(({ label, prompt }) => (
                    <button
                      key={label}
                      onClick={() => { setInput(prompt); setShowMoltbook(false); }}
                      className="w-full text-left px-3 py-2.5 border border-black/10 rounded-lg hover:border-black hover:bg-black/5 transition-all text-xs font-black uppercase tracking-tight"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5 border-t border-black/10 pt-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40">API Key</p>
                  <p className="text-[10px] text-black/50">Set <code className="bg-black/5 px-1 rounded">MOLTBOOK_API_KEY</code> env var after registration.</p>
                  <a href="https://www.moltbook.com" target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-black/60 hover:text-black underline">moltbook.com</a>
                </div>
              </div>
            </FloatingPanel>
          )}
        </div>

        {/* Autonomous Mode Banner */}
        {autonomousMode && (
          <div className="px-6 py-2 bg-gradient-to-r from-green-700 via-emerald-600 to-teal-600 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-widest text-white">
                Autonomous Mode - Turn {autoLoopCountRef.current} - Agent runs until stop_agent() or you click Stop
              </span>
            </div>
            <button onClick={() => setAutonomousMode(false)} className="text-white/70 hover:text-white text-xs font-black uppercase tracking-widest">Stop</button>
          </div>
        )}
        {/* Live status bar - visible while streaming */}
        {isLoading && (
          <div className="px-6 md:px-12 py-2 border-t border-black/5 bg-[#FDFCF0] flex items-center gap-3 animate-in fade-in duration-200">
            <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping flex-shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest text-black/30 truncate flex-1">
              {liveStatus || (streamPhase === 'thinking' ? 'Thinking...' : 'Streaming response...')}
            </span>
            {toolCallCount > 0 && (
              <span className="text-[10px] font-black text-black/20 flex-shrink-0">
                {toolCallCount} tool{toolCallCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* Embedded Terminal Log */}
        {terminalLog.length > 0 && (
          <div className="border-t border-black/10 bg-black text-xs font-mono" style={{ maxHeight: showTerminalLog ? 180 : 28, transition: 'max-height 0.2s ease', overflow: 'hidden' }}>
            <div className="flex items-center justify-between px-4 py-1 border-b border-white/5 cursor-pointer select-none" onClick={() => setShowTerminalLog(v => !v)}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Terminal</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); setTerminalLog([]); setShowTerminalLog(false); }} className="text-[9px] text-white/20 hover:text-white/60 uppercase tracking-widest">Clear</button>
                <span className="text-[9px] text-white/20">{showTerminalLog ? '-' : '+'}</span>
              </div>
            </div>
            {showTerminalLog && (
              <div className="overflow-y-auto px-4 py-2 space-y-px" style={{ maxHeight: 148 }}>
                {terminalLog.slice(-60).map((line, i) => {
                  const isCmd = line.startsWith('$') || line.startsWith('>>>') || line.startsWith('>');
                  const isErr = /error|traceback|exception|fail/i.test(line);
                  return (
                    <div key={i} className={`text-[11px] leading-tight whitespace-pre-wrap break-all ${
                      isCmd ? 'text-green-400' : isErr ? 'text-red-400' : 'text-white/60'
                    }`}>{line}</div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Command Bar (Square) */}
        <div className="border-t border-black/10 bg-[#FDFCF0] p-6 py-10 md:px-12">
          <div className="mx-auto max-w-4xl space-y-2">
            {(attachments.length > 0 || mediaUrls.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {mediaUrls.map((media, index) => (
                  <div key={`mu-${index}`} className="flex max-w-[220px] items-center gap-1.5 overflow-hidden rounded-lg bg-black/80 px-3 py-1.5 text-[10px] font-black text-[#FDFCF0]">
                    <span className="flex-shrink-0">{media.type === 'video' ? 'VID' : 'IMG'}</span>
                    <span className="min-w-0 flex-1 truncate">{media.url.slice(media.url.lastIndexOf('/') + 1).slice(0, 24) || media.url.slice(0, 24)}</span>
                    <button onClick={() => setMediaUrls(prev => prev.filter((_, itemIndex) => itemIndex !== index))} className="flex-shrink-0 leading-none opacity-60 hover:opacity-100">x</button>
                  </div>
                ))}
              </div>
            )}

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment, index) => (
                  <div key={index} className="flex max-w-[220px] items-center gap-1.5 overflow-hidden rounded-lg bg-black px-3 py-1.5 text-[10px] font-black text-[#FDFCF0]">
                    <span className="flex-shrink-0">
                      {attachment.isImage ? (
                        <img src={attachment.dataUrl} alt={attachment.name} className="block h-5 w-5 rounded object-cover" />
                      ) : (
                        <Icons.Paperclip />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, itemIndex) => itemIndex !== index))} className="flex-shrink-0 leading-none opacity-60 hover:opacity-100">x</button>
                  </div>
                ))}
                {attachUploading && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-black/5 px-3 py-1.5 text-[10px] font-black text-black/40">
                    <span className="inline-block h-2 w-2 animate-ping rounded-full bg-black/40" />
                    Uploading...
                  </div>
                )}
              </div>
            )}

            {showMediaUrlInput && (
              <div className="mb-2 flex gap-2">
                <input
                  value={mediaUrlDraft}
                  onChange={(e) => setMediaUrlDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && mediaUrlDraft.trim()) {
                      const url = mediaUrlDraft.trim();
                      const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || url.includes('video');
                      setMediaUrls(prev => [...prev, { url, type: isVideo ? 'video' : 'image' }]);
                      setMediaUrlDraft('');
                      setShowMediaUrlInput(false);
                    }
                    if (e.key === 'Escape') {
                      setShowMediaUrlInput(false);
                      setMediaUrlDraft('');
                    }
                  }}
                  placeholder="Paste image or video URL, press Enter..."
                  className="flex-1 rounded-lg border border-black/30 bg-white px-3 py-2 text-xs font-black outline-none focus:border-black"
                  autoFocus
                />
                <button
                  onClick={() => {
                    const url = mediaUrlDraft.trim();
                    if (!url) return;
                    const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url) || url.includes('video');
                    setMediaUrls(prev => [...prev, { url, type: isVideo ? 'video' : 'image' }]);
                    setMediaUrlDraft('');
                    setShowMediaUrlInput(false);
                  }}
                  className="rounded-lg bg-black px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                >
                  Add
                </button>
              </div>
            )}

            <div className="relative">
              {showCommandSuggestions && (
                <div className="mb-2 px-1">
                  <ul className="space-y-0.5">
                    {commandSuggestions.map((definition, index) => (
                      <li key={definition.usage}>
                        <button
                          onClick={() => applyCommandSuggestion(definition)}
                          className={`flex w-full items-center justify-between gap-3 px-2 py-1 text-left text-[11px] text-black transition-colors ${index === selectedCommandIndex ? 'bg-[#F3E7A4]' : 'hover:bg-[#F7F1CF]'}`}
                        >
                          <span className="truncate font-black text-black">{definition.usage}</span>
                          <span className="truncate text-[10px] text-black">{definition.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-stretch overflow-hidden border-2 border-black bg-white shadow-[8px_8px_0px_#000000]">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.xml,.html,.pdf,.docx,.xlsx,.doc,.py,.js,.ts,.tsx,.jsx,.yaml,.yml,.toml,.ini,.cfg,.log,.sql,.graphql,image/*,video/*"
                  className="hidden"
                  onChange={(e) => handleAttach(e.target.files)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach files or images"
                  disabled={attachUploading}
                  className="flex items-center border-r border-black/10 px-3 text-black/30 transition-colors hover:bg-black/5 hover:text-black"
                >
                  <Icons.Paperclip />
                </button>
                <button
                  onClick={() => setShowMediaUrlInput(v => !v)}
                  title="Attach image/video URL"
                  className={`flex items-center border-r border-black/10 px-3 transition-colors ${showMediaUrlInput ? 'bg-black/5 text-black' : 'text-black/30 hover:bg-black/5 hover:text-black'}`}
                >
                  <Icons.Link />
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={
                    parallelMode && messages.filter(m => m.role === 'user').length === 0
                      ? 'Enter a topic to debate...'
                      : parallelMode
                      ? 'Butt in...'
                      : 'Type / for commands or enter a message...'
                  }
                  className="flex-1 border-none bg-transparent px-5 py-5 text-[16px] font-black text-black outline-none placeholder:text-black/10 md:px-8 md:py-6 md:text-sm"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {isLoading && (
                  <>
                    <button
                      onClick={handleStop}
                      title="Stop generation (keep partial output)"
                      className="flex items-center gap-1.5 border-l-2 border-black bg-amber-50 px-4 text-[9px] font-black uppercase tracking-widest text-amber-700 transition-colors hover:bg-amber-100"
                    >
                      <span className="inline-block h-3 w-3 rounded-sm border-2 border-amber-700" />
                      Stop
                    </button>
                    <button
                      onClick={handleKill}
                      title="Kill - abort and discard current response"
                      className="flex items-center gap-1.5 border-l-2 border-black bg-red-50 px-4 text-[9px] font-black uppercase tracking-widest text-red-600 transition-colors hover:bg-red-100"
                    >
                      <span className="text-base leading-none">x</span>
                      Kill
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleSend()}
                  disabled={(!input.trim() && attachments.length === 0) || isLoading || connStatus !== 'ok'}
                  className={`flex items-center justify-center border-l-2 border-black px-12 transition-all active:scale-95 ${
                    (input.trim() || attachments.length > 0) && !isLoading && connStatus === 'ok'
                      ? 'bg-black text-[#FDFCF0]'
                      : 'bg-black/5 text-black/20'
                  }`}
                >
                  <Icons.Send />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Crypto Wallet Modal */}
      <CryptoWallet isOpen={showCryptoWallet} onClose={() => setShowCryptoWallet(false)} />
    </div>
  );
}


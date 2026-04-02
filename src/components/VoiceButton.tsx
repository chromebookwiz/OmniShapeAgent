"use client";

import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

// GöÇGöÇ Web Speech API type augmentations GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

// GöÇGöÇ Props & ref handle GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

export interface VoiceButtonHandle {
  speakText: (text: string) => void;
}

export interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  lastAssistantMessage?: string;
  disabled?: boolean;
}

// GöÇGöÇ Icons GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

const MicIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill={active ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="8" y1="22" x2="16" y2="22" />
  </svg>
);

const SpeakerIcon = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={active ? 'currentColor' : 'none'} />
    {active ? (
      <>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </>
    ) : (
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    )}
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

// GöÇGöÇ Component GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

const VoiceButton = forwardRef<VoiceButtonHandle, VoiceButtonProps>(function VoiceButton(
  { onTranscript, lastAssistantMessage, disabled = false },
  ref
) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastPhrase, setLastPhrase] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [notSupported, setNotSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevMessageRef = useRef<string | undefined>(undefined);
  const settingsRef = useRef<HTMLDivElement>(null);

  // GöÇGöÇ Voice list GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const loadVoices = useCallback(() => {
    const voices = window.speechSynthesis.getVoices();
    setAvailableVoices(voices);
    if (!selectedVoiceURI && voices.length > 0) {
      const eng = voices.find((v) => v.lang.startsWith('en'));
      setSelectedVoiceURI(eng?.voiceURI ?? voices[0].voiceURI);
    }
  }, [selectedVoiceURI]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, [loadVoices]);

  // GöÇGöÇ SpeechRecognition init GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SRConstructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SRConstructor) {
      setNotSupported(true);
      return;
    }
    const sr = new SRConstructor();
    sr.continuous = false;
    sr.interimResults = false;
    sr.lang = 'en-US';

    sr.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (transcript) {
        setLastPhrase(transcript);
        setShowTooltip(true);
        setTimeout(() => setShowTooltip(false), 3000);
        onTranscript(transcript);
        // Log voice interaction
        fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `store_voice_interaction: "${transcript}"`,
            history: [],
            stream: false,
          }),
        }).catch(() => {});
      }
    };

    sr.onerror = () => {
      setListening(false);
      stopLevelSimulation();
    };

    sr.onend = () => {
      setListening(false);
      stopLevelSimulation();
    };

    recognitionRef.current = sr;
    return () => {
      sr.abort();
    };
  }, [onTranscript]);

  // GöÇGöÇ Audio level simulation GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const startLevelSimulation = () => {
    let prev = 0;
    levelIntervalRef.current = setInterval(() => {
      const target = Math.random() * 10;
      prev = prev * 0.6 + target * 0.4;
      setAudioLevel(Math.round(prev));
    }, 80);
  };

  const stopLevelSimulation = () => {
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    setAudioLevel(0);
  };

  // GöÇGöÇ TTS GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const speakText = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      const voice = availableVoices.find((v) => v.voiceURI === selectedVoiceURI);
      if (voice) utterance.voice = voice;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [availableVoices, selectedVoiceURI, rate, pitch]
  );

  useImperativeHandle(ref, () => ({ speakText }), [speakText]);

  // GöÇGöÇ Auto-speak when assistant message changes GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  useEffect(() => {
    if (!voiceOutputEnabled) return;
    if (!lastAssistantMessage) return;
    if (lastAssistantMessage === prevMessageRef.current) return;
    prevMessageRef.current = lastAssistantMessage;
    speakText(lastAssistantMessage);
  }, [lastAssistantMessage, voiceOutputEnabled, speakText]);

  // GöÇGöÇ Listen toggle GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const toggleListening = () => {
    if (notSupported) {
      setShowTooltip(true);
      setTimeout(() => setShowTooltip(false), 3000);
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      stopLevelSimulation();
    } else {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      try {
        recognitionRef.current?.start();
        setListening(true);
        startLevelSimulation();
      } catch {
        setListening(false);
      }
    }
  };

  // GöÇGöÇ Speaker toggle GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const toggleSpeaker = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    } else {
      setVoiceOutputEnabled((v) => !v);
    }
  };

  // GöÇGöÇ Click-outside to close settings GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  // GöÇGöÇ Audio level meter bars GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ

  const BAR_COUNT = 5;
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const threshold = ((i + 1) / BAR_COUNT) * 10;
    const active = audioLevel >= threshold;
    return active;
  });

  return (
    <div className="relative flex items-center gap-1">
      {/* Mic button */}
      <div className="relative">
        <button
          onClick={toggleListening}
          disabled={disabled}
          title={notSupported ? 'Use Chrome for voice mode' : listening ? 'Stop listening' : 'Start voice input'}
          className={`p-2.5 rounded-lg transition-all active:scale-95 ${
            listening
              ? 'bg-[#000000] text-[#FDFCF0]'
              : 'hover:bg-black/5 text-black/60'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <MicIcon active={listening} />
        </button>

        {/* Tooltip */}
        {showTooltip && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="bg-[#000000] text-[#FDFCF0] text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg whitespace-nowrap max-w-[200px] truncate">
              {notSupported ? 'Use Chrome for voice mode' : lastPhrase || 'Listening...'}
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#000000]" />
          </div>
        )}
      </div>

      {/* Audio level meter GÇö only visible while listening */}
      {listening && (
        <div className="flex items-end gap-[2px] h-5 animate-in fade-in duration-200">
          {bars.map((active, i) => (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-all duration-75 ${
                active ? 'bg-[#000000]' : 'bg-black/15'
              }`}
              style={{ height: `${((i + 1) / BAR_COUNT) * 100}%` }}
            />
          ))}
        </div>
      )}

      {/* Speaker button */}
      <button
        onClick={toggleSpeaker}
        disabled={disabled}
        title={speaking ? 'Stop speaking' : voiceOutputEnabled ? 'Auto-speak ON GÇö click to disable' : 'Enable auto-speak'}
        className={`p-2.5 rounded-lg transition-all active:scale-95 ${
          voiceOutputEnabled || speaking
            ? 'bg-[#000000] text-[#FDFCF0]'
            : 'hover:bg-black/5 text-black/60'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <SpeakerIcon active={voiceOutputEnabled || speaking} />
      </button>

      {/* Settings dots GÇö only visible when voice mode is active */}
      {(listening || voiceOutputEnabled || speaking) && (
        <button
          onClick={() => setShowSettings((s) => !s)}
          disabled={disabled}
          title="Voice settings"
          className={`p-2 rounded-lg transition-all active:scale-95 ${
            showSettings ? 'bg-black/10 text-black' : 'hover:bg-black/5 text-black/40'
          } disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <DotsIcon />
        </button>
      )}

      {/* Settings popover */}
      {showSettings && (
        <div
          ref={settingsRef}
          className="absolute top-full right-0 mt-2 z-50 w-72 bg-[#FDFCF0] border border-black shadow-[0_8px_40px_rgba(0,0,0,0.15)] rounded-xl p-5 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-black">Voice Settings</p>
            <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-black/5 rounded-lg transition-colors text-black/60">
              <CloseIcon />
            </button>
          </div>

          <div className="space-y-4">
            {/* Auto-speak toggle */}
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-wider text-black/60">Auto-Speak</label>
              <button
                onClick={() => setVoiceOutputEnabled((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${voiceOutputEnabled ? 'bg-[#000000]' : 'bg-black/20'}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-[#FDFCF0] shadow transition-transform ${voiceOutputEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>

            {/* Voice selection */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40">Voice</label>
              <select
                value={selectedVoiceURI}
                onChange={(e) => setSelectedVoiceURI(e.target.value)}
                className="w-full bg-white border border-black/20 rounded-lg px-3 py-2 text-xs font-black outline-none appearance-none cursor-pointer hover:border-black transition-colors text-black"
              >
                {availableVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
                {availableVoices.length === 0 && (
                  <option value="">No voices available</option>
                )}
              </select>
            </div>

            {/* Speed */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40">Speed</label>
                <span className="text-[10px] font-black text-black/60">{rate.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(parseFloat(e.target.value))}
                className="w-full accent-black cursor-pointer"
              />
            </div>

            {/* Pitch */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black/40">Pitch</label>
                <span className="text-[10px] font-black text-black/60">{pitch.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={pitch}
                onChange={(e) => setPitch(parseFloat(e.target.value))}
                className="w-full accent-black cursor-pointer"
              />
            </div>

            {/* Test button */}
            <button
              onClick={() => speakText('ShapeAgent voice system online.')}
              className="w-full py-2.5 text-[10px] font-black uppercase tracking-[0.25em] border border-black rounded-lg hover:bg-black hover:text-[#FDFCF0] transition-all active:scale-95 text-black"
            >
              Test Voice
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default VoiceButton;


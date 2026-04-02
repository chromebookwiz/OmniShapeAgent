"use client";

import { useState, useRef, useEffect, useCallback, startTransition } from 'react';

// Web Speech API type augmentations
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

export interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  lastAssistantMessage?: string;
}

export function useVoice({ onTranscript, lastAssistantMessage }: UseVoiceOptions) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastPhrase, setLastPhrase] = useState('');
  const [notSupported, setNotSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevMessageRef = useRef<string | undefined>(undefined);

  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    setAvailableVoices(voices);
    if (!selectedVoiceURI && voices.length > 0) {
      const eng = voices.find((v) => v.lang.startsWith('en'));
      setSelectedVoiceURI(eng?.voiceURI ?? voices[0].voiceURI);
    }
  }, [selectedVoiceURI]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Defer state updates so the effect doesn't trigger cascading renders
    startTransition(() => loadVoices());
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, [loadVoices]);

  const startLevelSimulation = useCallback(() => {
    let prev = 0;
    levelIntervalRef.current = setInterval(() => {
      const target = Math.random() * 10;
      prev = prev * 0.6 + target * 0.4;
      setAudioLevel(Math.round(prev));
    }, 80);
  }, []);

  const stopLevelSimulation = useCallback(() => {
    if (levelIntervalRef.current) {
      clearInterval(levelIntervalRef.current);
      levelIntervalRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SRConstructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SRConstructor) {
      startTransition(() => setNotSupported(true));
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
  }, [onTranscript, stopLevelSimulation]);

  const speakText = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !text.trim() || !window.speechSynthesis) return;
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

  useEffect(() => {
    if (!voiceOutputEnabled) return;
    if (!lastAssistantMessage) return;
    if (lastAssistantMessage === prevMessageRef.current) return;
    prevMessageRef.current = lastAssistantMessage;
    speakText(lastAssistantMessage);
  }, [lastAssistantMessage, voiceOutputEnabled, speakText]);

  const toggleListening = () => {
    if (notSupported) {
      alert("Voice not supported on this browser (use Chrome)");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      stopLevelSimulation();
    } else {
      window.speechSynthesis?.cancel();
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

  const toggleSpeaker = () => {
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    } else {
      setVoiceOutputEnabled((v) => !v);
    }
  };

  return {
    listening,
    speaking,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    availableVoices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    rate,
    setRate,
    pitch,
    setPitch,
    audioLevel,
    lastPhrase,
    notSupported,
    toggleListening,
    toggleSpeaker,
    speakText
  };
}

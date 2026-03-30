"use client";

import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Champion {
  id: string;
  name?: string;
  goal: string;
  peakMetric: string | number;
  iterationCount: number;
  retired: boolean;
  strategies?: string[];
  hallmarks?: string[];
  weightStatus?: string;
}

interface HallOfFameProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const TrophyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="M12 5v14" />
  </svg>
);

// ── Rank helpers ──────────────────────────────────────────────────────────────

const RANK_MEDALS: Record<number, string> = { 0: '🥇', 1: '🥈', 2: '🥉' };

const rankBorderColor = (rank: number): string => {
  if (rank === 0) return 'border-l-[3px] border-l-yellow-400';
  if (rank === 1) return 'border-l-[3px] border-l-gray-400';
  if (rank === 2) return 'border-l-[3px] border-l-amber-600';
  return 'border-l-[3px] border-l-black/10';
};

// ── Enroll form ───────────────────────────────────────────────────────────────

interface EnrollFormProps {
  onEnroll: (champion: Partial<Champion>) => void;
}

function EnrollForm({ onEnroll }: EnrollFormProps) {
  const [botId, setBotId] = useState('');
  const [peakMetric, setPeakMetric] = useState('');
  const [nameOverride, setNameOverride] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botId.trim()) { setError('Bot ID is required.'); return; }
    if (!peakMetric.trim()) { setError('Peak metric is required.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/hall-of-fame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: botId.trim(), peakMetric, name: nameOverride.trim() || undefined }),
      });
      if (!res.ok) throw new Error('Enrollment failed');
      const data: Champion = await res.json();
      onEnroll(data);
      setBotId('');
      setPeakMetric('');
      setNameOverride('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-black/40 mb-3">Enroll Bot</p>
      {error && (
        <p className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="space-y-2">
        <input
          value={botId}
          onChange={(e) => setBotId(e.target.value)}
          placeholder="Bot ID *"
          className="w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-xs font-black outline-none focus:border-black transition-colors placeholder:text-black/30 text-black"
        />
        <input
          value={peakMetric}
          onChange={(e) => setPeakMetric(e.target.value)}
          placeholder="Peak metric *  (e.g. 0.94 accuracy)"
          className="w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-xs font-black outline-none focus:border-black transition-colors placeholder:text-black/30 text-black"
        />
        <input
          value={nameOverride}
          onChange={(e) => setNameOverride(e.target.value)}
          placeholder="Name override (optional)"
          className="w-full bg-white border border-black/20 rounded-lg px-3 py-2.5 text-xs font-black outline-none focus:border-black transition-colors placeholder:text-black/30 text-black"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="flex items-center gap-2 px-4 py-2.5 bg-black text-[#FDFCF0] text-[10px] font-black uppercase tracking-[0.25em] rounded-lg hover:bg-black/80 active:scale-95 transition-all disabled:opacity-40"
      >
        <PlusIcon />
        {submitting ? 'Enrolling...' : 'Enroll Champion'}
      </button>
    </form>
  );
}

// ── Champion card ─────────────────────────────────────────────────────────────

interface ChampionCardProps {
  champion: Champion;
  rank: number;
}

function ChampionCard({ champion, rank }: ChampionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isPodium = rank < 3;

  return (
    <div
      className={`bg-[#FDFCF0] border border-black/10 rounded-xl overflow-hidden transition-all ${
        rank === 0 ? 'animate-pulse-subtle' : ''
      }`}
    >
      {/* Card header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`w-full text-left px-5 py-4 flex items-start gap-4 ${rankBorderColor(rank)} hover:bg-black/[0.02] transition-colors`}
      >
        {/* Rank */}
        <div className="flex-shrink-0 w-8 text-center">
          {isPodium ? (
            <span className="text-lg">{RANK_MEDALS[rank]}</span>
          ) : (
            <span className="text-[10px] font-black text-black/30">#{rank + 1}</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-black uppercase tracking-tight text-black truncate">
              {champion.name ?? champion.id}
            </p>
            {champion.retired && (
              <span className="text-[8px] font-black uppercase tracking-widest bg-black/10 text-black/40 px-2 py-0.5 rounded-full">
                Retired
              </span>
            )}
          </div>
          <p className="text-[10px] text-black/50 mt-0.5 line-clamp-1">{champion.goal}</p>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-[10px] font-black text-black">
              {String(champion.peakMetric)}
            </span>
            <span className="text-[10px] text-black/30">
              {champion.iterationCount.toLocaleString()} iters
            </span>
          </div>
        </div>

        {/* Expand toggle */}
        <div className="flex-shrink-0 text-black/30 mt-1">
          <ChevronIcon open={expanded} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 pt-3 border-t border-black/5 space-y-4 animate-in slide-in-from-top-2 duration-200">
          {champion.strategies && champion.strategies.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-black/30 mb-2">Strategies</p>
              <ul className="space-y-1">
                {champion.strategies.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-black/60">
                    <span className="w-1 h-1 rounded-full bg-black/30 mt-[5px] flex-shrink-0" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {champion.hallmarks && champion.hallmarks.length > 0 && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-black/30 mb-2">Hallmarks</p>
              <div className="flex flex-wrap gap-1.5">
                {champion.hallmarks.map((h, i) => (
                  <span key={i} className="text-[9px] font-black uppercase tracking-wider bg-black/5 text-black/60 px-2.5 py-1 rounded-full">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
          {champion.weightStatus && (
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-black/30 mb-1">Weights</p>
              <p className="text-[11px] font-mono text-black/60">{champion.weightStatus}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HallOfFame({ isOpen, onClose }: HallOfFameProps) {
  const [champions, setChampions] = useState<Champion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/hall-of-fame');
      if (!res.ok) throw new Error('Failed to load');
      const data: Champion[] = await res.json();
      setChampions(Array.isArray(data) ? data : []);
      setError('');
    } catch {
      setError('Failed to load leaderboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + live polling every 10 s
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, [isOpen, fetchLeaderboard]);

  const handleEnroll = (champion: Partial<Champion>) => {
    fetchLeaderboard();
    void champion;
  };

  const exportMarkdown = () => {
    const lines = [
      '# Hall of Fame — ShapeAgent Bot Leaderboard',
      '',
      ...champions.map((c, i) => {
        const medal = RANK_MEDALS[i] ?? `#${i + 1}`;
        return `${medal} **${c.name ?? c.id}** — ${c.goal} | Peak: ${c.peakMetric} | Iters: ${c.iterationCount}${c.retired ? ' | *Retired*' : ''}`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute right-0 top-0 bottom-0 z-40 w-full md:w-2/3 bg-[#FDFCF0] border-l border-black shadow-[-20px_0_50px_rgba(0,0,0,0.1)] flex flex-col animate-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="px-8 py-6 border-b border-black/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <TrophyIcon />
          <div>
            <h3 className="text-lg font-black uppercase tracking-tighter text-black">Hall of Fame</h3>
            <p className="text-[10px] font-black uppercase tracking-widest text-black/30">
              {champions.length} Champion{champions.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportMarkdown}
            title="Export leaderboard as markdown"
            className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest border border-black/20 rounded-lg hover:border-black text-black/60 hover:text-black transition-all active:scale-95"
          >
            <CopyIcon />
            {copied ? 'Copied!' : 'Export'}
          </button>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-lg transition-colors text-black">
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Body — split: leaderboard / enroll form */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* Leaderboard */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading && champions.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <div className="flex gap-1">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 bg-black rounded-full animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && champions.length === 0 && !error && (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-20">
              <TrophyIcon />
              <p className="text-sm font-black uppercase tracking-[0.3em] mt-4">No Champions Yet</p>
              <p className="text-[10px] mt-2">Enroll a bot to begin the leaderboard.</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-[11px] font-black text-red-600">{error}</p>
            </div>
          )}

          {champions.map((champion, rank) => (
            <ChampionCard key={champion.id} champion={champion} rank={rank} />
          ))}
        </div>

        {/* Enroll sidebar */}
        <div className="md:w-72 flex-shrink-0 border-t md:border-t-0 md:border-l border-black/10 p-6 bg-black/[0.02]">
          <EnrollForm onEnroll={handleEnroll} />
        </div>
      </div>
    </aside>
  );
}

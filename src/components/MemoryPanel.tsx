"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import FloatingPanel from './FloatingPanel';

interface MemoryRecord {
  id: string;
  content: string;
  importance: number;
  accessCount: number;
  tags: string[];
  source: string;
  topic?: string;
  createdAt: number;
  lastAccessedAt: number;
  score?: number;
  similarity?: number;
  searchType?: 'semantic' | 'text';
}

interface MemoryStats {
  total: number;
  avgImportance: number;
  avgAccessCount: number;
  oldestDate: string | null;
  newestDate: string | null;
  topTags: Array<{ tag: string; count: number }>;
  sourceBreakdown: Record<string, number>;
}

interface GraphEntity {
  label: string;
  type: string;
  mentions: number;
  importance: number;
}

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type SortMode = 'recent' | 'important' | 'accessed' | 'search';

function ImportanceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.round((value / 2.0) * 100));
  return (
    <div className="w-full h-0.5 bg-black/5 rounded-full mt-1 mb-2">
      <div
        className="h-0.5 rounded-full transition-all"
        style={{ width: `${pct}%`, background: value >= 1.5 ? '#000' : value >= 0.8 ? '#666' : '#ccc' }}
      />
    </div>
  );
}

function MemoryCard({
  record,
  onDelete,
  onBoost,
}: {
  record: MemoryRecord;
  onDelete: (id: string) => void;
  onBoost: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // eslint-disable-next-line react-hooks/purity -- Date.now() is needed here to compute display age relative to record creation; this component intentionally shows a snapshot age on render
  const age = Date.now() - record.createdAt;
  const ageStr = age < 3600000
    ? `${Math.floor(age / 60000)}m ago`
    : age < 86400000
    ? `${Math.floor(age / 3600000)}h ago`
    : `${Math.floor(age / 86400000)}d ago`;

  return (
    <div className="group border border-black/10 bg-white hover:border-black/30 transition-all p-3 rounded-lg">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[8px] font-black uppercase tracking-widest text-black/40 border border-black/20 px-1.5 py-0.5 rounded">
            {record.source}
          </span>
          {record.searchType === 'semantic' && record.similarity !== undefined && (
            <span className="text-[8px] font-black text-black/40">{(record.similarity * 100).toFixed(0)}% sim</span>
          )}
          {record.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[8px] bg-black/5 text-black/40 px-1.5 py-0.5 rounded font-black">
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[8px] text-black/30 font-black flex-shrink-0">{ageStr}</span>
      </div>

      <ImportanceBar value={record.importance} />

      <p
        onClick={() => setExpanded(e => !e)}
        className="text-xs text-black/70 leading-relaxed cursor-pointer"
        style={{
          overflow: expanded ? 'visible' : 'hidden',
          display: expanded ? 'block' : '-webkit-box',
          WebkitLineClamp: expanded ? undefined : 3,
          WebkitBoxOrient: 'vertical' as any,
          whiteSpace: 'pre-wrap',
        }}
      >
        {record.content}
      </p>

      <div className="flex items-center justify-between mt-2">
        <span className="text-[8px] text-black/25 font-black">
          imp {record.importance.toFixed(2)} · {record.accessCount}× accessed
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onBoost(record.id)}
            className="text-[8px] font-black text-black/50 border border-black/20 rounded px-1.5 py-0.5 hover:bg-black hover:text-white hover:border-black transition-colors"
          >
            ↑ boost
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className="text-[8px] font-black text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors"
          >
            × del
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MemoryPanel({ isOpen, onClose }: MemoryPanelProps) {
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [graphStats, setGraphStats] = useState<{ entities: number; relations: number; topEntities: GraphEntity[] } | null>(null);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [loading, setLoading] = useState(false);
  const [addContent, setAddContent] = useState('');
  const [addTags, setAddTags] = useState('');
  const [addImportance, setAddImportance] = useState(1.0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/memory?action=stats');
      if (!res.ok) return;
      const data = await res.json();
      if (data.memory) setStats(data.memory);
      if (data.graph) setGraphStats(data.graph);
    } catch {}
  }, []);

  const loadRecords = useCallback(async (mode: SortMode, q?: string) => {
    setLoading(true);
    try {
      if (mode === 'search' && q) {
        const res = await fetch(`/api/memory?q=${encodeURIComponent(q)}&limit=40`);
        const data = await res.json();
        setRecords(data.results ?? []);
      } else {
        const action = mode === 'important' ? 'important' : mode === 'accessed' ? 'accessed' : 'recent';
        const res = await fetch(`/api/memory?action=${action}&limit=60`);
        const data = await res.json();
        setRecords(data.records ?? []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadStats();
    loadRecords('recent');
  }, [isOpen, loadStats, loadRecords]);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) {
      setSortMode('recent');
      loadRecords('recent');
      return;
    }
    setSortMode('search');
    searchTimeout.current = setTimeout(() => loadRecords('search', q), 400);
  };

  const handleSort = (mode: SortMode) => {
    setSortMode(mode);
    setQuery('');
    loadRecords(mode);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/memory?id=${id}`, { method: 'DELETE' });
    setRecords(prev => prev.filter(r => r.id !== id));
    loadStats();
  };

  const handleBoost = async (id: string) => {
    await fetch(`/api/memory?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boost: 0.5 }),
    });
    setRecords(prev => prev.map(r => r.id === id ? { ...r, importance: Math.min(2.0, r.importance + 0.5) } : r));
  };

  const handleAddMemory = async () => {
    if (!addContent.trim()) return;
    setAddStatus('Embedding...');
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: addContent.trim(),
          importance: addImportance,
          tags: addTags.split(',').map(t => t.trim()).filter(Boolean),
          source: 'user',
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setAddStatus('Stored ✓');
      setAddContent('');
      setAddTags('');
      setAddImportance(1.0);
      setTimeout(() => { setShowAddForm(false); setAddStatus(''); }, 1200);
      loadRecords(sortMode, query || undefined);
      loadStats();
    } catch {
      setAddStatus('Error — check server');
    }
  };

  if (!isOpen) return null;

  return (
    <FloatingPanel
      title={`Memory${stats ? ` · ${stats.total}` : ''}`}
      onClose={onClose}
      defaultW={500}
      defaultH={660}
      defaultX={typeof window !== 'undefined' ? Math.max(40, window.innerWidth - 540) : 500}
      defaultY={50}
    >
    <div className="flex flex-col h-full bg-[#FDFCF0] text-black">

      {/* Header controls */}
      <div className="px-4 py-2.5 border-b border-black/10 flex items-center gap-2 flex-shrink-0 bg-[#FDFCF0]">
        <div className="flex-1">
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-white border border-black/30 rounded-lg px-3 py-1.5 text-xs font-black outline-none focus:border-black placeholder:text-black/20"
          />
        </div>
        <button
          onClick={() => setShowAddForm(f => !f)}
          className={`text-[10px] font-black uppercase tracking-widest border rounded-lg px-2.5 py-1.5 transition-colors ${showAddForm ? 'bg-black text-white border-black' : 'border-black/30 text-black/50 hover:border-black hover:text-black'}`}
        >
          + Add
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="px-6 py-3 border-b border-black/5 flex flex-wrap gap-6 flex-shrink-0 bg-black/[0.02]">
          {[
            { label: 'Total', value: stats.total.toLocaleString() },
            { label: 'Avg Imp.', value: stats.avgImportance.toFixed(2) },
            { label: 'Avg Hits', value: stats.avgAccessCount.toFixed(1) },
            { label: 'Entities', value: graphStats?.entities?.toLocaleString() ?? '–' },
            { label: 'Relations', value: graphStats?.relations?.toLocaleString() ?? '–' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col">
              <span className="text-[8px] font-black uppercase tracking-widest text-black/30">{label}</span>
              <span className="text-sm font-black text-black">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Top tags */}
      {stats?.topTags && stats.topTags.length > 0 && (
        <div className="px-6 py-2 border-b border-black/5 flex flex-wrap gap-1.5 flex-shrink-0">
          {stats.topTags.slice(0, 14).map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => handleSearch(tag)}
              className="text-[8px] font-black uppercase tracking-wider border border-black/10 rounded px-1.5 py-0.5 hover:border-black transition-colors text-black/40 hover:text-black"
            >
              {tag} <span className="text-black/20">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sort + refresh */}
      <div className="px-6 py-2.5 border-b border-black/5 flex items-center gap-2 flex-shrink-0">
        {(['recent', 'important', 'accessed'] as SortMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => handleSort(mode)}
            className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md transition-colors ${
              sortMode === mode ? 'bg-black text-white' : 'text-black/40 hover:text-black border border-black/10 hover:border-black'
            }`}
          >
            {mode}
          </button>
        ))}
        {query && (
          <span className="text-[9px] font-black text-black/40 uppercase tracking-widest">→ searching</span>
        )}
        <button
          onClick={() => { loadStats(); loadRecords(sortMode, query || undefined); }}
          className="ml-auto text-[9px] font-black text-black/30 hover:text-black border border-black/10 hover:border-black rounded px-2 py-1 transition-colors"
        >
          ↻
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="px-6 py-4 border-b border-black/10 bg-black/[0.02] flex-shrink-0 space-y-2">
          <textarea
            value={addContent}
            onChange={e => setAddContent(e.target.value)}
            placeholder="Memory content..."
            rows={3}
            className="w-full bg-white border border-black/30 rounded-lg px-3 py-2 text-xs font-black outline-none focus:border-black resize-none placeholder:text-black/20"
          />
          <div className="flex gap-2 items-center">
            <input
              value={addTags}
              onChange={e => setAddTags(e.target.value)}
              placeholder="tags, comma, separated"
              className="flex-1 bg-white border border-black/30 rounded-lg px-3 py-1.5 text-xs font-black outline-none focus:border-black placeholder:text-black/20"
            />
            <div className="flex flex-col items-center gap-0.5 min-w-[70px]">
              <span className="text-[8px] font-black text-black/30 uppercase tracking-widest">imp {addImportance.toFixed(1)}</span>
              <input
                type="range" min="0.1" max="2.0" step="0.1"
                value={addImportance}
                onChange={e => setAddImportance(parseFloat(e.target.value))}
                className="w-16 accent-black"
              />
            </div>
            <button
              onClick={handleAddMemory}
              className="bg-black text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg hover:bg-black/80 transition-colors active:scale-95"
            >
              Store
            </button>
          </div>
          {addStatus && (
            <p className={`text-[9px] font-black ${addStatus.includes('Error') ? 'text-red-600' : 'text-black/50'}`}>{addStatus}</p>
          )}
        </div>
      )}

      {/* Records list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide" style={{ minHeight: 0 }}>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex gap-1">
              {[0, 120, 240].map(d => (
                <span key={d} className="w-1.5 h-1.5 bg-black/30 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
        {!loading && records.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 opacity-20">
            <p className="text-xs font-black uppercase tracking-[0.3em]">{query ? 'No matches' : 'Empty'}</p>
          </div>
        )}
        {!loading && records.map(record => (
          <MemoryCard
            key={record.id}
            record={record}
            onDelete={handleDelete}
            onBoost={handleBoost}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-black/10 flex items-center justify-between flex-shrink-0">
        <span className="text-[9px] font-black text-black/30 uppercase tracking-widest">
          {records.length} shown{stats ? ` / ${stats.total} total` : ''}
        </span>
        <button
          onClick={async () => {
            if (!confirm('Prune low-importance memories? Irreversible.')) return;
            await fetch('/api/memory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'prune', threshold: 0.05 }),
            });
            loadStats();
            loadRecords(sortMode);
          }}
          className="text-[9px] font-black text-black/30 uppercase tracking-widest border border-black/10 rounded px-2 py-1 hover:border-black hover:text-black transition-colors"
        >
          Prune Decayed
        </button>
      </div>
    </div>
    </FloatingPanel>
  );
}

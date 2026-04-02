"use client";

import { useState } from 'react';

type AnalysisResponse = {
  analysis?: {
    language: string;
    script: string;
    audit: { label: string; summary: string };
    metrics: Record<string, number>;
    rendered?: { dataUrl?: string; note?: string; engine?: string };
  };
  comparison?: {
    similarity: number;
    spectralSimilarity: number;
    metricSimilarity: number;
    topologicalSynonym: boolean;
    summary: string;
  };
  error?: string;
};

export default function OLRWorkbench() {
  const [text, setText] = useState('Light reveals structure.');
  const [compareText, setCompareText] = useState('Or.');
  const [languageHint, setLanguageHint] = useState('english');
  const [compareLanguageHint, setCompareLanguageHint] = useState('hebrew');
  const [learn, setLearn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse['analysis'] | null>(null);
  const [comparison, setComparison] = useState<AnalysisResponse['comparison'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAnalyze() {
    setLoading(true);
    setError(null);
    setComparison(null);
    try {
      const res = await fetch('/api/olr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze',
          text,
          languageHint,
          learn,
          render: true,
        }),
      });
      const data = await res.json() as AnalysisResponse;
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data.analysis ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function runCompare() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/olr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compare',
          textA: text,
          textB: compareText,
          languageHintA: languageHint,
          languageHintB: compareLanguageHint,
          learn,
        }),
      });
      const data = await res.json() as AnalysisResponse;
      if (!res.ok) throw new Error(data.error || 'Comparison failed');
      setComparison(data.comparison ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const imageUrl = analysis?.rendered?.dataUrl;
  const metricEntries = analysis ? Object.entries(analysis.metrics) : [];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#10203a_0%,#07111f_42%,#030712_100%)] text-slate-100 px-6 py-10 md:px-10">
      <div className="max-w-7xl mx-auto grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl shadow-black/30">
          <p className="text-[11px] uppercase tracking-[0.35em] text-cyan-200/70 mb-3">OmniShape Linguistic Resonator</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Circle of Glyphs</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Map any symbolic sequence onto the unit circle, score its geometric coherence, and render its resonance mandala.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.28em] text-slate-400 mb-2">Primary Text</label>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.28em] text-slate-400 mb-2">Language Hint</label>
              <input
                value={languageHint}
                onChange={(event) => setLanguageHint(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.28em] text-slate-400 mb-2">Cross-Linguistic Comparison</label>
              <textarea
                value={compareText}
                onChange={(event) => setCompareText(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.28em] text-slate-400 mb-2">Comparison Language Hint</label>
              <input
                value={compareLanguageHint}
                onChange={(event) => setCompareLanguageHint(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60"
              />
            </div>

            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input type="checkbox" checked={learn} onChange={() => setLearn((value) => !value)} className="accent-cyan-400" />
              Learn from this sequence using Hebbian updates
            </label>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={runAnalyze}
                disabled={loading}
                className="rounded-full bg-cyan-300 text-slate-950 px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Working…' : 'Analyze + Render'}
              </button>
              <button
                onClick={runCompare}
                disabled={loading}
                className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Compare Shapes
              </button>
            </div>

            {error && <p className="text-sm text-rose-300">{error}</p>}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-2xl shadow-black/30 min-h-[720px]">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4 min-h-[520px] flex items-center justify-center">
              {imageUrl ? (
                <img src={imageUrl} alt="OLR mandala" className="w-full max-w-[720px] rounded-2xl border border-white/10" />
              ) : (
                <p className="text-sm text-slate-400">Run an analysis to render the glyph mandala.</p>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Audit</p>
                <p className="mt-2 text-xl font-semibold text-white">{analysis?.audit.label ?? 'Pending'}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{analysis?.audit.summary ?? 'No audit yet.'}</p>
                {analysis?.rendered?.note && <p className="mt-3 text-xs text-amber-300">{analysis.rendered.note}</p>}
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Metrics</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {metricEntries.map(([key, value]) => (
                    <div key={key} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">{key}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{value.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Cross-Linguistic Resonance</p>
                {comparison ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <p>Similarity: <span className="text-white font-semibold">{comparison.similarity.toFixed(2)}</span></p>
                    <p>Spectral: <span className="text-white font-semibold">{comparison.spectralSimilarity.toFixed(2)}</span></p>
                    <p>Metric: <span className="text-white font-semibold">{comparison.metricSimilarity.toFixed(2)}</span></p>
                    <p className="text-white font-semibold">{comparison.topologicalSynonym ? 'Topological synonym detected.' : 'No topological synonym yet.'}</p>
                    <p>{comparison.summary}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Compare two texts to inspect cross-language resonance.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
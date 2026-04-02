import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { PATHS, ROOT } from './paths-core';

const STORE_PATH = PATHS.olrResonator;
const DEFAULT_THEME = 'resonance';
const RADIAL_BINS = 64;
const HARMONICS = 10;

export interface GlyphPoint {
  symbol: string;
  index: number;
  angle: number;
  x: number;
  y: number;
  frequency: number;
}

export interface GateWeight {
  virtue: number;
  entropy: number;
  resonance: number;
  traversals: number;
  lastUpdated: number;
}

export interface ResonatorLanguageState {
  id: string;
  script: string;
  alphabet: string[];
  symbolCounts: Record<string, number>;
  symbolBias: Record<string, number>;
  gates: Record<string, GateWeight>;
  observations: number;
  totalTokens: number;
  updatedAt: number;
}

interface UniversalState {
  observations: number;
  harmonics: number[];
  virtueMean: number;
  entropyMean: number;
  coherenceMean: number;
  languageLinks: Record<string, number>;
  updatedAt: number;
}

interface OLRStoreState {
  languages: Record<string, ResonatorLanguageState>;
  universal: UniversalState;
  learning: {
    hebbianRate: number;
    decay: number;
    lastUpdated: number;
  };
}

export interface OLRMetrics {
  smoothness: number;
  symmetry: number;
  regularPolygon: number;
  spiral: number;
  coherence: number;
  entropy: number;
  virtue: number;
  collisions: number;
  collisionRatio: number;
  brownian: number;
  closure: number;
  radialVariance: number;
}

export interface OLRTopGate {
  pair: [string, string];
  traversals: number;
  virtue: number;
  entropy: number;
  resonance: number;
}

export interface OLRAnalysis {
  language: string;
  script: string;
  text: string;
  glyphCount: number;
  uniqueGlyphs: number;
  totalPossibleGates: number;
  glyphs: GlyphPoint[];
  path: Array<{ symbol: string; x: number; y: number; angle: number }>;
  metrics: OLRMetrics;
  vibration: number[];
  harmonics: number[];
  fingerprint: number[];
  gateUsage: Record<string, number>;
  topGates: OLRTopGate[];
  audit: {
    label: 'stable' | 'resonant' | 'noisy' | 'chaotic';
    summary: string;
  };
  universal: {
    observations: number;
    virtueMean: number;
    entropyMean: number;
    coherenceMean: number;
  };
  learned: boolean;
  rendered?: {
    engine: 'python-matplotlib' | 'svg-fallback';
    mimeType: string;
    dataUrl: string;
    note?: string;
  };
}

export interface OLRComparison {
  a: Pick<OLRAnalysis, 'language' | 'script' | 'metrics' | 'harmonics' | 'audit'>;
  b: Pick<OLRAnalysis, 'language' | 'script' | 'metrics' | 'harmonics' | 'audit'>;
  similarity: number;
  spectralSimilarity: number;
  metricSimilarity: number;
  topologicalSynonym: boolean;
  summary: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function std(values: number[]): number {
  return Math.sqrt(variance(values));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA <= 0 || normB <= 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function normalizeVector(values: number[]): number[] {
  const maxAbs = Math.max(1e-9, ...values.map((value) => Math.abs(value)));
  return values.map((value) => value / maxAbs);
}

function angleDiff(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function segmentText(text: string): string[] {
  const SegmenterCtor = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: { granularity?: 'grapheme' }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (item) => item.segment);
  }
  return Array.from(text);
}

function isTrackedGlyph(symbol: string): boolean {
  return symbol.trim().length > 0;
}

function detectScript(symbol: string): string {
  if (/\p{Script=Hebrew}/u.test(symbol)) return 'Hebrew';
  if (/\p{Script=Arabic}/u.test(symbol)) return 'Arabic';
  if (/\p{Script=Cyrillic}/u.test(symbol)) return 'Cyrillic';
  if (/\p{Script=Greek}/u.test(symbol)) return 'Greek';
  if (/\p{Script=Devanagari}/u.test(symbol)) return 'Devanagari';
  if (/\p{Script=Han}/u.test(symbol)) return 'Han';
  if (/\p{Script=Hiragana}/u.test(symbol)) return 'Hiragana';
  if (/\p{Script=Katakana}/u.test(symbol)) return 'Katakana';
  if (/\p{Script=Latin}/u.test(symbol)) return 'Latin';
  return 'Common';
}

function dominantScript(symbols: string[]): string {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    const script = detectScript(symbol);
    if (script === 'Common') continue;
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Common';
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

function gateKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function parseGateKey(key: string): [string, string] {
  const [left, right] = key.split('::');
  return [left, right];
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ccw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function intersects(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): boolean {
  const d1 = ccw(a1, a2, b1);
  const d2 = ccw(a1, a2, b2);
  const d3 = ccw(b1, b2, a1);
  const d4 = ccw(b1, b2, a2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function spectralDescriptor(signal: number[], harmonics = HARMONICS): number[] {
  const bins = signal.length;
  const output: number[] = [];
  for (let k = 1; k <= harmonics; k++) {
    let real = 0;
    let imag = 0;
    for (let index = 0; index < bins; index++) {
      const phase = (2 * Math.PI * k * index) / bins;
      real += signal[index] * Math.cos(phase);
      imag -= signal[index] * Math.sin(phase);
    }
    output.push(Math.hypot(real, imag) / bins);
  }
  return normalizeVector(output);
}

function buildFallbackSvg(analysis: OLRAnalysis, theme = DEFAULT_THEME): string {
  const size = 720;
  const center = size / 2;
  const radius = 250;
  const glow = theme === 'ethics' ? '#f59e0b' : '#38bdf8';
  const pathColor = analysis.metrics.virtue >= analysis.metrics.entropy ? '#22c55e' : '#ef4444';
  const bins = analysis.vibration.length;
  const sectorMarkup = analysis.vibration.map((value, index) => {
    const inner = radius * 0.55;
    const outer = inner + radius * 0.35 * clamp01((value + 1) / 2);
    const start = (index / bins) * Math.PI * 2 - Math.PI / 2;
    const end = ((index + 1) / bins) * Math.PI * 2 - Math.PI / 2;
    const x1 = center + Math.cos(start) * inner;
    const y1 = center + Math.sin(start) * inner;
    const x2 = center + Math.cos(end) * inner;
    const y2 = center + Math.sin(end) * inner;
    const x3 = center + Math.cos(end) * outer;
    const y3 = center + Math.sin(end) * outer;
    const x4 = center + Math.cos(start) * outer;
    const y4 = center + Math.sin(start) * outer;
    const largeArc = end - start > Math.PI ? 1 : 0;
    const fill = value >= 0 ? '#34d399' : '#fb7185';
    const opacity = (0.08 + Math.abs(value) * 0.45).toFixed(3);
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${outer.toFixed(2)} ${outer.toFixed(2)} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z" fill="${fill}" fill-opacity="${opacity}" />`;
  }).join('');

  const pathPoints = analysis.path.map((point) => `${(center + point.x * radius * 0.84).toFixed(2)},${(center + point.y * radius * 0.84).toFixed(2)}`).join(' ');
  const nodeMarkup = analysis.path.map((point, index) => {
    const x = center + point.x * radius * 0.84;
    const y = center + point.y * radius * 0.84;
    return `<g><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${index === 0 ? 5 : 3.2}" fill="#0f172a" fill-opacity="0.9" /><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${index === 0 ? 10 : 6}" fill="${glow}" fill-opacity="0.12" /></g>`;
  }).join('');

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="bg" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#111827"/>
        <stop offset="100%" stop-color="#020617"/>
      </radialGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="10" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#334155" stroke-width="1.2"/>
    <circle cx="${center}" cy="${center}" r="${(radius * 0.55).toFixed(2)}" fill="none" stroke="#1e293b" stroke-width="1"/>
    <g filter="url(#glow)">${sectorMarkup}</g>
    <polyline points="${pathPoints}" fill="none" stroke="${pathColor}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"/>
    ${nodeMarkup}
    <text x="${center}" y="56" fill="#e2e8f0" font-family="Georgia, serif" font-size="24" text-anchor="middle">OmniShape Resonance</text>
    <text x="${center}" y="84" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="12" text-anchor="middle">${analysis.audit.label.toUpperCase()} · virtue ${analysis.metrics.virtue.toFixed(2)} · entropy ${analysis.metrics.entropy.toFixed(2)}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg.trim(), 'utf8').toString('base64')}`;
}

function defaultLanguageState(id: string, script: string): ResonatorLanguageState {
  return {
    id,
    script,
    alphabet: [],
    symbolCounts: {},
    symbolBias: {},
    gates: {},
    observations: 0,
    totalTokens: 0,
    updatedAt: Date.now(),
  };
}

class OmniShapeLinguisticResonator {
  private state: OLRStoreState = {
    languages: {},
    universal: {
      observations: 0,
      harmonics: Array.from({ length: HARMONICS }, () => 0),
      virtueMean: 0,
      entropyMean: 0,
      coherenceMean: 0,
      languageLinks: {},
      updatedAt: Date.now(),
    },
    learning: {
      hebbianRate: 0.085,
      decay: 0.002,
      lastUpdated: Date.now(),
    },
  };

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Partial<OLRStoreState>;
      if (raw.languages) this.state.languages = raw.languages;
      if (raw.universal) {
        this.state.universal = {
          ...this.state.universal,
          ...raw.universal,
          harmonics: Array.isArray(raw.universal.harmonics)
            ? raw.universal.harmonics.slice(0, HARMONICS).concat(Array.from({ length: Math.max(0, HARMONICS - raw.universal.harmonics.length) }, () => 0))
            : this.state.universal.harmonics,
        };
      }
      if (raw.learning) this.state.learning = { ...this.state.learning, ...raw.learning };
    } catch (error) {
      console.error('[OLR] Failed to load store:', error);
    }
  }

  private save() {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('[OLR] Failed to save store:', error);
    }
  }

  private languageId(languageHint: string | undefined, script: string): string {
    const normalizedHint = (languageHint ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return normalizedHint || script.toLowerCase();
  }

  private ensureLanguage(languageHint: string | undefined, script: string): ResonatorLanguageState {
    const id = this.languageId(languageHint, script);
    if (!this.state.languages[id]) {
      this.state.languages[id] = defaultLanguageState(id, script);
    }
    return this.state.languages[id];
  }

  private ensureAlphabet(state: ResonatorLanguageState, symbols: string[]) {
    const seen = new Set(state.alphabet);
    const additions = Array.from(new Set(symbols.filter((symbol) => !seen.has(symbol)))).sort((a, b) => a.localeCompare(b));
    if (additions.length > 0) {
      state.alphabet.push(...additions);
    }
  }

  private mapGlyphs(state: ResonatorLanguageState, textSymbols: string[]): GlyphPoint[] {
    const frequencies = textSymbols.reduce<Record<string, number>>((acc, symbol) => {
      acc[symbol] = (acc[symbol] ?? 0) + 1;
      return acc;
    }, {});
    const n = Math.max(1, state.alphabet.length);
    return state.alphabet.map((symbol, index) => {
      const angle = (2 * Math.PI * index) / n - Math.PI / 2;
      return {
        symbol,
        index,
        angle,
        x: Math.cos(angle),
        y: Math.sin(angle),
        frequency: frequencies[symbol] ?? 0,
      };
    });
  }

  private pathForSymbols(glyphs: GlyphPoint[], textSymbols: string[]) {
    const lookup = new Map(glyphs.map((glyph) => [glyph.symbol, glyph]));
    return textSymbols.map((symbol) => {
      const glyph = lookup.get(symbol)!;
      return { symbol, x: glyph.x, y: glyph.y, angle: glyph.angle };
    });
  }

  private computeMetrics(path: Array<{ symbol: string; x: number; y: number; angle: number }>, vibration: number[]): OLRMetrics {
    if (path.length < 2) {
      return {
        smoothness: 0,
        symmetry: 0,
        regularPolygon: 0,
        spiral: 0,
        coherence: 0,
        entropy: 0,
        virtue: 0,
        collisions: 0,
        collisionRatio: 0,
        brownian: 0,
        closure: 0,
        radialVariance: 0,
      };
    }

    const edgeLengths: number[] = [];
    const headings: number[] = [];
    for (let index = 1; index < path.length; index++) {
      const from = path[index - 1];
      const to = path[index];
      edgeLengths.push(dist(from, to));
      headings.push(Math.atan2(to.y - from.y, to.x - from.x));
    }

    const turns: number[] = [];
    const turnSigns: number[] = [];
    for (let index = 1; index < headings.length; index++) {
      const diff = angleDiff(headings[index], headings[index - 1]);
      turns.push(diff);
      if (diff !== 0) turnSigns.push(Math.sign(diff));
    }

    let collisions = 0;
    for (let left = 0; left < path.length - 1; left++) {
      for (let right = left + 2; right < path.length - 1; right++) {
        if (left === 0 && right === path.length - 2) continue;
        if (intersects(path[left], path[left + 1], path[right], path[right + 1])) collisions++;
      }
    }

    const collisionRatio = clamp01(collisions / Math.max(1, path.length - 2));
    const lengthMean = mean(edgeLengths);
    const lengthCv = lengthMean > 0 ? std(edgeLengths) / lengthMean : 1;
    const turnStd = turns.length > 0 ? std(turns) : Math.PI;
    const smoothness = clamp01(1 - turnStd / (Math.PI / 1.5));
    const regularPolygon = clamp01((1 - Math.min(1, lengthCv)) * 0.55 + (1 - Math.min(1, turnStd / Math.PI)) * 0.45);
    const closure = clamp01(1 - dist(path[0], path[path.length - 1]) / 2);

    const angleBins = Array.from({ length: 12 }, () => 0);
    for (const point of path) {
      const normalized = (point.angle + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.floor((normalized / (Math.PI * 2)) * angleBins.length) % angleBins.length;
      angleBins[bin]++;
    }
    const mirroredError = mean(angleBins.map((value, index) => Math.abs(value - angleBins[(angleBins.length - index) % angleBins.length]))) / Math.max(1, mean(angleBins));
    const symmetry = clamp01(1 - mirroredError / 3);

    const monotonicity = turns.length > 0 ? Math.abs(mean(turnSigns)) : 0;
    const unwrapped: number[] = [path[0].angle];
    for (let index = 1; index < path.length; index++) {
      const prev = unwrapped[index - 1];
      let current = path[index].angle;
      while (current - prev > Math.PI) current -= Math.PI * 2;
      while (current - prev < -Math.PI) current += Math.PI * 2;
      unwrapped.push(current);
    }
    const idxs = Array.from({ length: unwrapped.length }, (_, index) => index / Math.max(1, unwrapped.length - 1));
    const spiral = clamp01((cosineSimilarity(normalizeVector(unwrapped), normalizeVector(idxs)) + 1) * 0.5 * monotonicity);

    const signFlips = turnSigns.reduce((count, value, index) => {
      if (index === 0) return 0;
      return count + (value !== 0 && value !== turnSigns[index - 1] ? 1 : 0);
    }, 0);
    const brownian = clamp01((turnStd / Math.PI) * 0.5 + collisionRatio * 0.25 + (signFlips / Math.max(1, turnSigns.length)) * 0.25);

    const radialVariance = clamp01(Math.sqrt(variance(vibration)) / 0.6);
    const coherence = clamp01(smoothness * 0.28 + symmetry * 0.18 + regularPolygon * 0.24 + spiral * 0.18 + closure * 0.12);
    const entropy = clamp01(brownian * 0.55 + collisionRatio * 0.25 + (1 - smoothness) * 0.2);
    const virtue = clamp01(coherence * 0.52 + regularPolygon * 0.18 + spiral * 0.18 + symmetry * 0.12 - entropy * 0.18);

    return {
      smoothness,
      symmetry,
      regularPolygon,
      spiral,
      coherence,
      entropy,
      virtue,
      collisions,
      collisionRatio,
      brownian,
      closure,
      radialVariance,
    };
  }

  private buildVibration(path: Array<{ symbol: string; x: number; y: number; angle: number }>, state: ResonatorLanguageState, gateUsage: Record<string, number>): number[] {
    const bins = Array.from({ length: RADIAL_BINS }, () => 0);
    for (const point of path) {
      const normalized = (point.angle + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.floor((normalized / (Math.PI * 2)) * RADIAL_BINS) % RADIAL_BINS;
      bins[bin] += 0.25 + (state.symbolBias[point.symbol] ?? 0) * 0.15;
    }
    for (const [key, traversals] of Object.entries(gateUsage)) {
      const [left, right] = parseGateKey(key);
      const leftIndex = state.alphabet.indexOf(left);
      const rightIndex = state.alphabet.indexOf(right);
      if (leftIndex < 0 || rightIndex < 0 || state.alphabet.length === 0) continue;
      const midAngle = ((leftIndex + rightIndex) / 2 / state.alphabet.length) * Math.PI * 2 - Math.PI / 2;
      const bin = Math.floor((((midAngle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * RADIAL_BINS) % RADIAL_BINS;
      const weight = state.gates[key]?.resonance ?? 0;
      bins[bin] += traversals * (0.08 + weight * 0.15);
    }
    return normalizeVector(bins);
  }

  private fingerprint(metrics: OLRMetrics, harmonics: number[]): number[] {
    return normalizeVector([
      metrics.smoothness,
      metrics.symmetry,
      metrics.regularPolygon,
      metrics.spiral,
      metrics.coherence,
      1 - metrics.entropy,
      1 - metrics.collisionRatio,
      metrics.closure,
      ...harmonics,
    ]);
  }

  private audit(metrics: OLRMetrics): OLRAnalysis['audit'] {
    if (metrics.virtue >= 0.72 && metrics.entropy <= 0.3) {
      return { label: 'stable', summary: 'The path stays smooth and structurally coherent; the sentence reads as stable under the current geometric model.' };
    }
    if (metrics.coherence >= 0.58 && metrics.entropy <= 0.45) {
      return { label: 'resonant', summary: 'The path shows meaningful recurrence and cross-gate harmony; it carries useful geometric resonance.' };
    }
    if (metrics.entropy <= 0.7) {
      return { label: 'noisy', summary: 'The path is workable but irregular; there is signal mixed with local incoherence and unstable turns.' };
    }
    return { label: 'chaotic', summary: 'The path is dominated by collisions, reversals, and jagged transitions; the current phrasing is geometrically unstable.' };
  }

  private decayState(language: ResonatorLanguageState) {
    const decay = this.state.learning.decay;
    if (decay <= 0) return;
    for (const gate of Object.values(language.gates)) {
      gate.virtue *= 1 - decay;
      gate.entropy *= 1 - decay;
      gate.resonance = gate.virtue - gate.entropy;
    }
  }

  private learn(language: ResonatorLanguageState, symbols: string[], gateUsage: Record<string, number>, metrics: OLRMetrics, harmonics: number[]) {
    const now = Date.now();
    const rate = this.state.learning.hebbianRate;
    language.observations += 1;
    language.totalTokens += symbols.length;
    language.updatedAt = now;
    this.decayState(language);

    const frequencies = symbols.reduce<Record<string, number>>((acc, symbol) => {
      acc[symbol] = (acc[symbol] ?? 0) + 1;
      return acc;
    }, {});

    for (const [symbol, count] of Object.entries(frequencies)) {
      language.symbolCounts[symbol] = (language.symbolCounts[symbol] ?? 0) + count;
      const contribution = count / Math.max(1, symbols.length);
      language.symbolBias[symbol] = (language.symbolBias[symbol] ?? 0) + rate * contribution * (metrics.virtue - metrics.entropy * 0.65);
    }

    for (const [key, traversals] of Object.entries(gateUsage)) {
      const current = language.gates[key] ?? {
        virtue: 0,
        entropy: 0,
        resonance: 0,
        traversals: 0,
        lastUpdated: now,
      };
      const localScale = traversals / Math.max(1, symbols.length - 1);
      current.virtue += rate * metrics.virtue * localScale;
      current.entropy += rate * metrics.entropy * localScale;
      current.resonance = current.virtue - current.entropy;
      current.traversals += traversals;
      current.lastUpdated = now;
      language.gates[key] = current;
    }

    this.state.universal.observations += 1;
    this.state.universal.updatedAt = now;
    const universal = this.state.universal;
    const obs = universal.observations;
    universal.virtueMean += (metrics.virtue - universal.virtueMean) / obs;
    universal.entropyMean += (metrics.entropy - universal.entropyMean) / obs;
    universal.coherenceMean += (metrics.coherence - universal.coherenceMean) / obs;
    for (let index = 0; index < HARMONICS; index++) {
      universal.harmonics[index] += ((harmonics[index] ?? 0) - universal.harmonics[index]) / obs;
    }
    this.save();
  }

  analyzeText(text: string, options?: { languageHint?: string; learn?: boolean; theme?: string; render?: boolean; preferPython?: boolean }): OLRAnalysis {
    const symbols = segmentText(text).filter(isTrackedGlyph);
    const script = dominantScript(symbols);
    const language = this.ensureLanguage(options?.languageHint, script);
    this.ensureAlphabet(language, symbols);
    const glyphs = this.mapGlyphs(language, symbols);
    const path = this.pathForSymbols(glyphs, symbols);

    const gateUsage: Record<string, number> = {};
    for (let index = 1; index < symbols.length; index++) {
      const key = gateKey(symbols[index - 1], symbols[index]);
      gateUsage[key] = (gateUsage[key] ?? 0) + 1;
    }

    const vibration = this.buildVibration(path, language, gateUsage);
    const harmonics = spectralDescriptor(vibration);
    const metrics = this.computeMetrics(path, vibration);
    const fingerprint = this.fingerprint(metrics, harmonics);
    const topGates = Object.entries(gateUsage)
      .map(([key, traversals]) => {
        const [left, right] = parseGateKey(key);
        const gate = language.gates[key] ?? { virtue: 0, entropy: 0, resonance: 0, traversals: 0, lastUpdated: 0 };
        return { pair: [left, right] as [string, string], traversals, virtue: gate.virtue, entropy: gate.entropy, resonance: gate.resonance };
      })
      .sort((a, b) => b.traversals - a.traversals || b.resonance - a.resonance)
      .slice(0, 12);

    if (options?.learn) {
      this.learn(language, symbols, gateUsage, metrics, harmonics);
    }

    const analysis: OLRAnalysis = {
      language: language.id,
      script,
      text,
      glyphCount: symbols.length,
      uniqueGlyphs: new Set(symbols).size,
      totalPossibleGates: Math.max(0, (language.alphabet.length * (language.alphabet.length - 1)) / 2),
      glyphs,
      path,
      metrics,
      vibration,
      harmonics,
      fingerprint,
      gateUsage,
      topGates,
      audit: this.audit(metrics),
      universal: {
        observations: this.state.universal.observations,
        virtueMean: this.state.universal.virtueMean,
        entropyMean: this.state.universal.entropyMean,
        coherenceMean: this.state.universal.coherenceMean,
      },
      learned: options?.learn === true,
    };

    if (options?.render) {
      analysis.rendered = this.renderAnalysis(analysis, { theme: options.theme, preferPython: options.preferPython !== false });
    }

    return analysis;
  }

  compareTexts(textA: string, textB: string, options?: { languageHintA?: string; languageHintB?: string; learn?: boolean }): OLRComparison {
    const analysisA = this.analyzeText(textA, { languageHint: options?.languageHintA, learn: options?.learn });
    const analysisB = this.analyzeText(textB, { languageHint: options?.languageHintB, learn: options?.learn });
    const spectralSimilarity = clamp01((cosineSimilarity(analysisA.harmonics, analysisB.harmonics) + 1) * 0.5);
    const metricSimilarity = clamp01((cosineSimilarity(analysisA.fingerprint.slice(0, 8), analysisB.fingerprint.slice(0, 8)) + 1) * 0.5);
    const similarity = clamp01(spectralSimilarity * 0.58 + metricSimilarity * 0.42);
    const topologicalSynonym = similarity >= 0.84;

    const key = `${analysisA.language}::${analysisB.language}`;
    this.state.universal.languageLinks[key] = similarity;
    this.save();

    return {
      a: {
        language: analysisA.language,
        script: analysisA.script,
        metrics: analysisA.metrics,
        harmonics: analysisA.harmonics,
        audit: analysisA.audit,
      },
      b: {
        language: analysisB.language,
        script: analysisB.script,
        metrics: analysisB.metrics,
        harmonics: analysisB.harmonics,
        audit: analysisB.audit,
      },
      similarity,
      spectralSimilarity,
      metricSimilarity,
      topologicalSynonym,
      summary: topologicalSynonym
        ? 'The two texts converge to a strongly similar spectral/metric signature and can be treated as topological synonyms under the current model.'
        : 'The two texts share partial geometric structure, but their spectral and path metrics do not yet collapse into the same topological neighborhood.',
    };
  }

  renderAnalysis(analysis: OLRAnalysis, options?: { theme?: string; preferPython?: boolean }) {
    if (options?.preferPython !== false) {
      const python = this.tryRenderWithPython(analysis, options?.theme ?? DEFAULT_THEME);
      if (python) return python;
    }
    return {
      engine: 'svg-fallback' as const,
      mimeType: 'image/svg+xml',
      dataUrl: buildFallbackSvg(analysis, options?.theme ?? DEFAULT_THEME),
      note: 'Rendered with the built-in SVG fallback. Install matplotlib in .agent_venv for the full mandala renderer.',
    };
  }

  private tryRenderWithPython(analysis: OLRAnalysis, theme: string) {
    const pythonBin = process.platform === 'win32'
      ? path.join(ROOT, '.agent_venv', 'Scripts', 'python.exe')
      : path.join(ROOT, '.agent_venv', 'bin', 'python');
    const rendererPath = path.join(ROOT, 'scripts', 'olr_render.py');
    if (!fs.existsSync(pythonBin) || !fs.existsSync(rendererPath)) return null;
    try {
      const stdout = execFileSync(pythonBin, [rendererPath], {
        cwd: ROOT,
        input: JSON.stringify({ analysis, theme }),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      }).trim();
      const parsed = JSON.parse(stdout) as { ok: boolean; dataUrl?: string; mimeType?: string; error?: string };
      if (!parsed.ok || !parsed.dataUrl || !parsed.mimeType) return null;
      return {
        engine: 'python-matplotlib' as const,
        mimeType: parsed.mimeType,
        dataUrl: parsed.dataUrl,
      };
    } catch {
      return null;
    }
  }

  stats(languageId?: string) {
    if (languageId) {
      const language = this.state.languages[languageId];
      if (!language) return null;
      return {
        id: language.id,
        script: language.script,
        alphabetSize: language.alphabet.length,
        observations: language.observations,
        totalTokens: language.totalTokens,
        topSymbols: Object.entries(language.symbolCounts).sort((a, b) => b[1] - a[1]).slice(0, 16),
        topGates: Object.entries(language.gates)
          .sort((a, b) => b[1].resonance - a[1].resonance || b[1].traversals - a[1].traversals)
          .slice(0, 16)
          .map(([key, value]) => ({ pair: parseGateKey(key), ...value })),
      };
    }
    return {
      languages: Object.values(this.state.languages).map((language) => ({
        id: language.id,
        script: language.script,
        alphabetSize: language.alphabet.length,
        observations: language.observations,
        totalTokens: language.totalTokens,
      })),
      universal: this.state.universal,
      learning: this.state.learning,
    };
  }

  setGateWeights(languageId: string, from: string, to: string, virtue: number, entropy: number) {
    const language = this.state.languages[languageId];
    if (!language) return null;
    const key = gateKey(from, to);
    const current = language.gates[key] ?? { virtue: 0, entropy: 0, resonance: 0, traversals: 0, lastUpdated: 0 };
    current.virtue = virtue;
    current.entropy = entropy;
    current.resonance = virtue - entropy;
    current.lastUpdated = Date.now();
    language.gates[key] = current;
    this.save();
    return { pair: parseGateKey(key), ...current };
  }

  reset(languageId?: string) {
    if (languageId) {
      delete this.state.languages[languageId];
    } else {
      this.state.languages = {};
      this.state.universal = {
        observations: 0,
        harmonics: Array.from({ length: HARMONICS }, () => 0),
        virtueMean: 0,
        entropyMean: 0,
        coherenceMean: 0,
        languageLinks: {},
        updatedAt: Date.now(),
      };
    }
    this.save();
  }
}

export const omniShapeResonator = new OmniShapeLinguisticResonator();
// src/lib/vector-store.ts
// File-backed persistent vector store.
// Zero external dependencies — stores vectors in a JSON file.
// Uses cosine similarity for retrieval with importance-weighted decay.

import fs from 'fs';
import { cosineSimilarity } from './embeddings';
import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
import {
  buildMemoryGeometry,
  compareMemoryGeometry,
  type MemoryGeometrySignature,
} from './memory-geometry';

const DB_PATH = PATHS.vectorStore;
const DAY_MS = 86_400_000;
const LATTICE_REBUILD_DEBOUNCE_MS = 1500;
const LATTICE_MIN_SIMILARITY = 0.42;
const LATTICE_NEIGHBOR_LIMIT = 6;
const TOPOLOGICAL_SIMILARITY_THRESHOLD = 0.84;
const REPETITION_SIMILARITY_THRESHOLD = 0.93;
const GEOMETRY_PRIMARY_WEIGHT = 0.68;
const EMBEDDING_FALLBACK_WEIGHT = 0.22;
const TEXTUAL_CONTEXT_WEIGHT = 0.1;

ensureWorkspacePaths();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export interface MemoryLink {
  id: string;
  similarity: number;
  sharedTags: number;
  weight: number;
  updatedAt: number;
}

export interface MemoryLifecycle {
  injectionCount: number;
  acknowledgedCount: number;
  rejectedCount: number;
  unacknowledgedStreak: number;
  lastInjectedAt: number;
  lastAcknowledgedAt: number;
  lastRejectedAt: number;
}

export interface MemoryLatticeState {
  neighbors: MemoryLink[];
  degree: number;
  clusterStrength: number;
  centrality: number;
  updatedAt: number;
}

export interface MemoryConsolidationState {
  level: number;
  support: number;
  volatility: number;
  abstraction: 'episodic' | 'gist' | 'semantic' | 'procedural';
  timesConsolidated: number;
  lastConsolidatedAt: number;
  sourceMemoryIds: string[];
}

export type CognitiveLayer = 'working' | 'episodic' | 'semantic' | 'procedural';
export type MemoryEmotion = 'neutral' | 'focused' | 'curious' | 'urgent' | 'cautious' | 'confident' | 'frustrated' | 'satisfied';

export interface MemoryRecord {
  id: string;
  content: string;        // Original text stored
  embedding: number[];   // Normalized embedding vector
  dim: number;           // Embedding dimension
  geometry?: MemoryGeometrySignature;
  consolidation?: MemoryConsolidationState;
  metadata: {
    source: 'user' | 'agent' | 'tool' | 'system' | 'vision';
    topic?: string;
    entities?: string[];  // Extracted key entities
    tags?: string[];
    cognitiveLayer?: CognitiveLayer;
    taskScope?: string;
    taskSalience?: number;
    emotion?: MemoryEmotion;
    triggerKeywords?: string[];
    suppressedUntil?: number;
    spatial?: { x: number; y: number; z?: number; w?: number; h?: number };
    contextSummary?: string;  // Short summary of the conversation that produced this memory
    polarity?: 'positive' | 'neutral' | 'negative';  // Whether memory records a success or failure
  };
  importance: number;    // 0.0 → 2.0 — user can boost, decay reduces
  correctness?: number;  // 0.0 → 1.0 — factual/outcome quality. Negative memories get low correctness.
  accessCount: number;   // How many times retrieved
  createdAt: number;     // ms timestamp
  lastAccessedAt: number;
  lifecycle: MemoryLifecycle;
  lattice: MemoryLatticeState;
}

export interface SearchResult {
  record: MemoryRecord;
  score: number;  // Final weighted score (higher = more relevant)
  similarity: number;  // Raw cosine similarity
}

export interface MemoryInjectionCandidate {
  record: MemoryRecord;
  source: 'geometric' | 'semantic' | 'text' | 'hybrid';
  score: number;
  similarity: number;
  activationScore: number;
  cognitiveLayer: CognitiveLayer;
  taskSalience: number;
  emotion: MemoryEmotion;
  goalResonance: number;
  novelty: number;
  consolidationLevel: number;
  stabilityScore: number;
  triggerHits: number;
  emotionWeight: number;
  geometrySimilarity: number;
  textHits: number;
  keywordOverlap: string[];
  ageDays: number;
  recentInjectionPenalty: number;
  acknowledgementRatio: number;
  rejectionRatio: number;
  latticeSupport: number;
  centrality: number;
  repetitionScore: number;
  repetitionCount: number;
  geometryVirtue: number;
}

// ---------------------------------------------------------------------------
// Locality-Sensitive Hashing — random-projection hash tables for approximate
// nearest-neighbor search.  O(1) candidate retrieval; cosine re-rank after.
// Implements the "E2LSH" scheme: L independent hash tables, each with K
// random Gaussian projections.  Similar vectors collide in ≥1 table with
// high probability, forming a lattice of proximity buckets.
// ---------------------------------------------------------------------------
class LSHIndex {
  readonly dim: number;
  private readonly L: number;   // number of hash tables
  private readonly K: number;   // projections per table
  private projections: Float32Array[]; // L * K * dim packed
  private tables: Map<string, Set<string>>[];

  constructor(dim: number, L = 6, K = 12) {
    this.dim = dim; this.L = L; this.K = K;
    this.projections = [];
    this.tables = Array.from({ length: L }, () => new Map());
    
    // Seeded Gaussian projections (Box-Muller, LCG seed 0x2a) — reproducible
    let s = 0x2a;
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000 * 2 - 1; };
    const gauss = () => {
      const u1 = Math.abs(rand()) || 1e-10;
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand());
    };
    for (let t = 0; t < L; t++) {
      const proj = new Float32Array(K * dim);
      for (let i = 0; i < proj.length; i++) proj[i] = gauss();
      this.projections.push(proj);
    }

  }

  private hash(vec: number[], t: number): string {
    const proj = this.projections[t];
    let bits = '';
    for (let k = 0; k < this.K; k++) {
      let dot = 0;
      const base = k * this.dim;
      for (let d = 0; d < this.dim; d++) dot += proj[base + d] * vec[d];
      bits += dot >= 0 ? '1' : '0';
    }
    return bits;
  }

  add(id: string, vec: number[]) {
    if (vec.length !== this.dim) return;
    for (let t = 0; t < this.L; t++) {
      const h = this.hash(vec, t);
      let bucket = this.tables[t].get(h);
      if (!bucket) { bucket = new Set(); this.tables[t].set(h, bucket); }
      bucket.add(id);
    }
  }

  remove(id: string, vec: number[]) {
    if (vec.length !== this.dim) return;
    for (let t = 0; t < this.L; t++) {
      this.tables[t].get(this.hash(vec, t))?.delete(id);
    }
  }

  query(vec: number[], maxCandidates = 300): Set<string> {
    const out = new Set<string>();
    for (let t = 0; t < this.L; t++) {
      const bucket = this.tables[t].get(this.hash(vec, t));
      if (bucket) for (const id of bucket) { out.add(id); if (out.size >= maxCandidates) return out; }
    }
    return out;
  }

  clear() { this.tables = Array.from({ length: this.L }, () => new Map()); }
}

// ---------------------------------------------------------------------------
// Singleton store
// ---------------------------------------------------------------------------
class VectorStore {
  private records: Map<string, MemoryRecord> = new Map();
  private dirty = false;
  private readonly DECAY_LAMBDA = 0.02; // per day — gentler than CGA's 0.05
  private lshIndex: LSHIndex | null = null;
  private feedbackSinceMaintenance = 0;
  private lastMaintenanceAt = 0;

  private saveTimeout: NodeJS.Timeout | null = null;
  private latticeTimeout: NodeJS.Timeout | null = null;
  private latticeDirty = false;
  private readonly STOPWORDS = new Set([
    'the','and','for','are','but','not','you','all','can','had','her','was','one',
    'our','out','day','get','has','him','his','how','its','may','new','now','old',
    'see','two','who','boy','did','let','put','say','she','too','use','way','will',
    'with','that','this','have','from','they','know','want','been','good','much',
    'some','time','very','when','come','here','just','like','long','make','many',
    'more','only','over','such','take','than','them','then','well','were','into',
    'what','your','about','there','their','would','could','should','after','before',
  ]);

  constructor() {
    this.load();
    // Periodic auto-save every 30s
    if (typeof setInterval !== 'undefined') {
      setInterval(() => {
        if (this.dirty) this.save();
      }, 30_000);
      setInterval(() => {
        if (this.latticeDirty) this.rebuildLattice();
      }, 60_000);
    }
  }

  private defaultLifecycle(raw?: Partial<MemoryLifecycle>): MemoryLifecycle {
    return {
      injectionCount: raw?.injectionCount ?? 0,
      acknowledgedCount: raw?.acknowledgedCount ?? 0,
      rejectedCount: raw?.rejectedCount ?? 0,
      unacknowledgedStreak: raw?.unacknowledgedStreak ?? 0,
      lastInjectedAt: raw?.lastInjectedAt ?? 0,
      lastAcknowledgedAt: raw?.lastAcknowledgedAt ?? 0,
      lastRejectedAt: raw?.lastRejectedAt ?? 0,
    };
  }

  private defaultLattice(raw?: Partial<MemoryLatticeState>): MemoryLatticeState {
    return {
      neighbors: Array.isArray(raw?.neighbors) ? raw!.neighbors!.slice(0, LATTICE_NEIGHBOR_LIMIT) : [],
      degree: raw?.degree ?? 0,
      clusterStrength: raw?.clusterStrength ?? 0,
      centrality: raw?.centrality ?? 0,
      updatedAt: raw?.updatedAt ?? 0,
    };
  }

  private defaultConsolidation(
    raw?: Partial<MemoryConsolidationState>,
    metadata?: MemoryRecord['metadata'],
    content?: string,
    layer?: CognitiveLayer,
  ): MemoryConsolidationState {
    const inferredLayer = layer ?? this.inferCognitiveLayer(metadata ?? ({ source: 'agent' } as MemoryRecord['metadata']), content ?? '');
    const tags = new Set((metadata?.tags ?? []).map((tag) => tag.toLowerCase()));
    let abstraction: MemoryConsolidationState['abstraction'] = raw?.abstraction ?? 'episodic';
    if (!raw?.abstraction) {
      if (inferredLayer === 'procedural' || tags.has('strategy') || tags.has('workflow') || tags.has('playbook')) abstraction = 'procedural';
      else if (inferredLayer === 'semantic') abstraction = 'semantic';
      else if (inferredLayer === 'working') abstraction = 'gist';
    }
    return {
      level: clamp01(raw?.level ?? (abstraction === 'episodic' ? 0.12 : abstraction === 'gist' ? 0.34 : abstraction === 'semantic' ? 0.56 : 0.72)),
      support: clamp01(raw?.support ?? 0.28),
      volatility: clamp01(raw?.volatility ?? (metadata?.polarity === 'negative' ? 0.5 : 0.22)),
      abstraction,
      timesConsolidated: Math.max(0, Math.round(raw?.timesConsolidated ?? 0)),
      lastConsolidatedAt: Math.max(0, raw?.lastConsolidatedAt ?? 0),
      sourceMemoryIds: Array.isArray(raw?.sourceMemoryIds) ? raw!.sourceMemoryIds!.map(String).slice(0, 24) : [],
    };
  }

  private normalizeGeometry(raw: Partial<MemoryGeometrySignature> | undefined, content: string): MemoryGeometrySignature | undefined {
    const fallback = buildMemoryGeometry(content, false);
    const base = raw && Array.isArray(raw.fingerprint)
      ? raw
      : fallback;
    if (!base || !Array.isArray(base.fingerprint) || !Array.isArray(base.harmonics) || !Array.isArray(base.vibration)) {
      return undefined;
    }
    return {
      language: String(base.language ?? fallback?.language ?? 'common'),
      script: String(base.script ?? fallback?.script ?? 'Common'),
      glyphCount: Number(base.glyphCount ?? fallback?.glyphCount ?? 0),
      uniqueGlyphs: Number(base.uniqueGlyphs ?? fallback?.uniqueGlyphs ?? 0),
      fingerprint: base.fingerprint.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      harmonics: base.harmonics.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      vibration: base.vibration.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      auditLabel: (base.auditLabel ?? fallback?.auditLabel ?? 'noisy') as MemoryGeometrySignature['auditLabel'],
      coherence: Number(base.coherence ?? fallback?.coherence ?? 0),
      virtue: Number(base.virtue ?? fallback?.virtue ?? 0),
      entropy: Number(base.entropy ?? fallback?.entropy ?? 0),
      closure: Number(base.closure ?? fallback?.closure ?? 0),
      shapeKey: String(base.shapeKey ?? fallback?.shapeKey ?? 'unknown'),
      repetitionScore: Number(base.repetitionScore ?? 0),
      repetitionCount: Number(base.repetitionCount ?? 0),
      topologicalNeighbors: Array.isArray(base.topologicalNeighbors) ? base.topologicalNeighbors.map(String).slice(0, 6) : [],
    };
  }

  private enrichGeometry(geometry: MemoryGeometrySignature | undefined, excludeId?: string): MemoryGeometrySignature | undefined {
    if (!geometry) return undefined;
    let repetitionScore = 0;
    let repetitionCount = 0;
    const topologicalNeighbors: Array<{ id: string; score: number }> = [];

    for (const record of this.records.values()) {
      if (excludeId && record.id === excludeId) continue;
      if (!record.geometry) continue;
      const comparison = compareMemoryGeometry(geometry, record.geometry);
      repetitionScore = Math.max(repetitionScore, comparison.score);
      if (comparison.repeatedShape) repetitionCount++;
      if (comparison.topologicalSynonym) {
        topologicalNeighbors.push({ id: record.id, score: comparison.score });
      }
    }

    return {
      ...geometry,
      repetitionScore,
      repetitionCount,
      topologicalNeighbors: topologicalNeighbors
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((item) => item.id),
    };
  }

  private recordSimilarity(left: MemoryRecord, right: MemoryRecord): number {
    const geometryScore = compareMemoryGeometry(left.geometry, right.geometry).score;
    if (geometryScore > 0) return geometryScore;
    if (left.embedding.length === 0 || left.embedding.length !== right.embedding.length) return 0;
    return cosineSimilarity(left.embedding, right.embedding);
  }

  private queryGeometrySimilarity(queryGeometry: MemoryGeometrySignature | undefined, record: MemoryRecord) {
    const comparison = compareMemoryGeometry(queryGeometry, record.geometry);
    return {
      geometrySimilarity: comparison.score,
      topologicalSynonym: comparison.topologicalSynonym,
      repeatedShape: comparison.repeatedShape,
    };
  }

  private normalizeRecord(raw: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord {
    const embedding = Array.isArray(raw.embedding)
      ? raw.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    const metadata = raw.metadata ?? { source: 'agent' as const };
    const cognitiveLayer = this.inferCognitiveLayer(metadata as MemoryRecord['metadata'], raw.content);
    const emotion = this.inferEmotion(metadata as MemoryRecord['metadata'], raw.content, cognitiveLayer);
    return {
      id: raw.id,
      content: raw.content,
      embedding,
      dim: raw.dim ?? embedding.length,
      geometry: this.normalizeGeometry(raw.geometry, raw.content),
      consolidation: this.defaultConsolidation(raw.consolidation, metadata as MemoryRecord['metadata'], raw.content, cognitiveLayer),
      metadata: {
        source: metadata.source ?? 'agent',
        topic: metadata.topic,
        entities: Array.isArray(metadata.entities) ? metadata.entities : [],
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        cognitiveLayer,
        taskScope: metadata.taskScope,
        taskSalience: this.normalizeTaskSalience(metadata as MemoryRecord['metadata'], cognitiveLayer),
        emotion,
        triggerKeywords: this.normalizeTriggerKeywords(metadata as MemoryRecord['metadata'], raw.content),
        suppressedUntil: metadata.suppressedUntil,
        spatial: metadata.spatial,
        contextSummary: metadata.contextSummary,
        polarity: metadata.polarity,
      },
      importance: Number.isFinite(raw.importance) ? Math.max(0.01, Math.min(2.0, raw.importance!)) : 1,
      correctness: Number.isFinite(raw.correctness) ? Math.max(0, Math.min(1, raw.correctness!)) : 0.75,
      accessCount: raw.accessCount ?? 0,
      createdAt: raw.createdAt ?? Date.now(),
      lastAccessedAt: raw.lastAccessedAt ?? raw.createdAt ?? Date.now(),
      lifecycle: this.defaultLifecycle(raw.lifecycle),
      lattice: this.defaultLattice(raw.lattice),
    };
  }

  private debounceSave() {
    this.dirty = true;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(), 5000);
  }

  private scheduleLatticeRebuild(delayMs = LATTICE_REBUILD_DEBOUNCE_MS) {
    this.latticeDirty = true;
    if (this.latticeTimeout) clearTimeout(this.latticeTimeout);
    this.latticeTimeout = setTimeout(() => this.rebuildLattice(), delayMs);
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9]/g, ''))
      .filter((word) => word.length > 3 && !this.STOPWORDS.has(word));
  }

  private normalizeTriggerKeywords(metadata: MemoryRecord['metadata'], content: string): string[] {
    const explicit = Array.isArray(metadata.triggerKeywords)
      ? metadata.triggerKeywords.map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean)
      : [];
    const inferred = this.extractKeywords(`${content} ${metadata.contextSummary ?? ''} ${(metadata.tags ?? []).join(' ')}`)
      .slice(0, 12);
    return Array.from(new Set([...explicit, ...inferred])).slice(0, 12);
  }

  private inferEmotion(metadata: MemoryRecord['metadata'], content: string, layer: CognitiveLayer): MemoryEmotion {
    if (metadata.emotion) return metadata.emotion;
    const tags = new Set((metadata.tags ?? []).map((tag) => tag.toLowerCase()));
    const normalizedContent = content.toLowerCase();
    if (tags.has('urgent') || normalizedContent.includes('asap') || normalizedContent.includes('immediately')) return 'urgent';
    if (tags.has('focused') || layer === 'working') return 'focused';
    if (tags.has('curious') || normalizedContent.includes('?') || normalizedContent.includes('explore')) return 'curious';
    if (tags.has('cautious') || normalizedContent.includes('warning') || normalizedContent.includes('careful')) return 'cautious';
    if (tags.has('confident') || normalizedContent.includes('confirmed') || normalizedContent.includes('works')) return 'confident';
    if (metadata.polarity === 'negative' || tags.has('frustrated') || normalizedContent.includes('failed') || normalizedContent.includes('broken')) return 'frustrated';
    if (metadata.polarity === 'positive' || tags.has('satisfied') || normalizedContent.includes('success') || normalizedContent.includes('fixed')) return 'satisfied';
    return 'neutral';
  }

  private keywordOverlap(query: string, content: string, triggerKeywords: string[] = []): string[] {
    const queryTerms = new Set(this.extractKeywords(query));
    if (queryTerms.size === 0) return [];
    const contentTerms = new Set(this.extractKeywords(`${content} ${triggerKeywords.join(' ')}`));
    return Array.from(queryTerms).filter((term) => contentTerms.has(term));
  }

  private getTriggerHits(record: MemoryRecord, overlap: string[]): number {
    const triggers = new Set((record.metadata.triggerKeywords ?? []).map((keyword) => keyword.toLowerCase()));
    return overlap.filter((term) => triggers.has(term)).length;
  }

  private getEmotionWeight(emotion: MemoryEmotion): number {
    switch (emotion) {
      case 'focused':
        return 0.12;
      case 'urgent':
        return 0.14;
      case 'cautious':
        return 0.09;
      case 'curious':
        return 0.07;
      case 'confident':
      case 'satisfied':
        return 0.05;
      case 'frustrated':
        return 0.03;
      default:
        return 0;
    }
  }

  private inferCognitiveLayer(metadata: MemoryRecord['metadata'], content: string): CognitiveLayer {
    if (metadata.cognitiveLayer) return metadata.cognitiveLayer;
    const tags = new Set((metadata.tags ?? []).map((tag) => tag.toLowerCase()));
    const normalizedContent = content.toLowerCase();
    if (
      tags.has('working') ||
      tags.has('current-task') ||
      tags.has('active-task') ||
      tags.has('todo') ||
      tags.has('scratchpad') ||
      tags.has('focus') ||
      normalizedContent.includes('current task')
    ) {
      return 'working';
    }
    if (
      tags.has('strategy') ||
      tags.has('procedure') ||
      tags.has('playbook') ||
      tags.has('workflow') ||
      tags.has('howto')
    ) {
      return 'procedural';
    }
    if (metadata.source === 'user' || metadata.source === 'tool' || metadata.source === 'vision') {
      return 'episodic';
    }
    return 'semantic';
  }

  private normalizeTaskSalience(metadata: MemoryRecord['metadata'], layer: CognitiveLayer): number {
    const explicit = Number(metadata.taskSalience ?? Number.NaN);
    if (Number.isFinite(explicit)) return clamp01(explicit);
    if (layer === 'working') return 1;
    if (layer === 'procedural') return 0.78;
    if (layer === 'episodic') return 0.62;
    return 0.46;
  }

  private isSuppressed(record: MemoryRecord): boolean {
    const until = record.metadata.suppressedUntil;
    return typeof until === 'number' && until > Date.now();
  }

  private maybeSuppressFixation(record: MemoryRecord, hours: number = 12) {
    const rejectionRatio = this.getRejectionRatio(record);
    const fixationRisk =
      record.lifecycle.unacknowledgedStreak >= 4 ||
      (record.lifecycle.injectionCount >= 3 && rejectionRatio >= 0.6 && record.accessCount <= 3);
    if (!fixationRisk) return false;
    record.metadata.suppressedUntil = Date.now() + hours * 3_600_000;
    record.importance = Math.max(0.05, record.importance - 0.12);
    return true;
  }

  private inferTaskSalience(record: MemoryRecord, query: string, overlap: string[]): number {
    const layer = record.metadata.cognitiveLayer ?? this.inferCognitiveLayer(record.metadata, record.content);
    const queryTerms = this.extractKeywords(query);
    const overlapRatio = queryTerms.length > 0 ? overlap.length / queryTerms.length : 0;
    const triggerHits = this.getTriggerHits(record, overlap);
    const ageDays = Math.max(0, (Date.now() - record.createdAt) / DAY_MS);
    const freshness = 1 / (1 + ageDays / (layer === 'working' ? 1.5 : 10));
    const explicit = this.normalizeTaskSalience(record.metadata, layer);
    const layerBoost = layer === 'working' ? 0.25 : layer === 'procedural' ? 0.12 : 0.04;
    return clamp01(explicit * 0.62 + overlapRatio * 0.17 + Math.min(0.16, triggerHits * 0.08) + freshness * 0.08 + layerBoost + this.getEmotionWeight(record.metadata.emotion ?? 'neutral'));
  }

  private getGoalResonance(record: MemoryRecord, query: string, overlap: string[]): number {
    const queryTerms = this.extractKeywords(query);
    const overlapRatio = queryTerms.length > 0 ? overlap.length / queryTerms.length : 0;
    const triggerHits = this.getTriggerHits(record, overlap);
    const taskScope = (record.metadata.taskScope ?? '').toLowerCase();
    const queryText = query.toLowerCase();
    const scopeMatch = taskScope && queryText.includes(taskScope) ? 1 : 0;
    const contextMatch = (record.metadata.contextSummary ?? '').toLowerCase().includes(queryText.slice(0, 48)) ? 1 : 0;
    return clamp01(overlapRatio * 0.45 + Math.min(0.24, triggerHits * 0.12) + this.inferTaskSalience(record, query, overlap) * 0.2 + scopeMatch * 0.08 + contextMatch * 0.03);
  }

  private getNoveltyScore(record: MemoryRecord): number {
    const ageHours = Math.max(0, (Date.now() - record.createdAt) / 3_600_000);
    const freshness = ageHours <= 24 ? 1 - ageHours / 24 : Math.max(0, 0.4 - (ageHours - 24) / (24 * 14));
    const sparsity = 1 - clamp01(record.lattice.degree / 8);
    const lowExposure = 1 - clamp01(record.accessCount / 6);
    const consolidation = record.consolidation ?? this.defaultConsolidation(undefined, record.metadata, record.content, record.metadata.cognitiveLayer);
    return clamp01(freshness * 0.45 + sparsity * 0.3 + lowExposure * 0.15 + (1 - consolidation.level) * 0.1);
  }

  private getStabilityScore(record: MemoryRecord): number {
    const consolidation = record.consolidation ?? this.defaultConsolidation(undefined, record.metadata, record.content, record.metadata.cognitiveLayer);
    const acknowledgement = this.getAcknowledgementRatio(record);
    const rejection = this.getRejectionRatio(record);
    return clamp01(consolidation.level * 0.36 + consolidation.support * 0.26 + acknowledgement * 0.22 + Math.min(0.16, record.lattice.clusterStrength * 0.2) - consolidation.volatility * 0.18 - rejection * 0.14);
  }

  private computeActivationScore(candidate: Omit<MemoryInjectionCandidate, 'activationScore'>): number {
    return clamp01(
      candidate.goalResonance * 0.34 +
      candidate.taskSalience * 0.18 +
      candidate.stabilityScore * 0.18 +
      candidate.consolidationLevel * 0.12 +
      Math.min(1, candidate.score) * 0.08 +
      candidate.geometrySimilarity * 0.05 +
      Math.min(1, candidate.novelty * 0.4) +
      candidate.emotionWeight * 0.15 -
      candidate.recentInjectionPenalty * 0.2 -
      candidate.rejectionRatio * 0.12
    );
  }

  private reinforceConsolidation(record: MemoryRecord, outcome: 'acknowledged' | 'ignored' | 'rejected') {
    const consolidation = record.consolidation ?? this.defaultConsolidation(undefined, record.metadata, record.content, record.metadata.cognitiveLayer);
    if (outcome === 'acknowledged') {
      consolidation.support = clamp01(consolidation.support + 0.08);
      consolidation.volatility = clamp01(consolidation.volatility - 0.06);
      consolidation.level = clamp01(consolidation.level + 0.035);
    } else if (outcome === 'rejected') {
      consolidation.support = clamp01(consolidation.support - 0.06);
      consolidation.volatility = clamp01(consolidation.volatility + 0.12);
      consolidation.level = clamp01(consolidation.level - 0.03);
    } else {
      consolidation.volatility = clamp01(consolidation.volatility + 0.035);
      consolidation.level = clamp01(consolidation.level - 0.01);
    }
    record.consolidation = consolidation;
  }

  private promoteStableMemories(): number {
    let promoted = 0;
    for (const record of this.records.values()) {
      const consolidation = record.consolidation ?? this.defaultConsolidation(undefined, record.metadata, record.content, record.metadata.cognitiveLayer);
      const ackRatio = this.getAcknowledgementRatio(record);
      const rehearsal = record.lifecycle.acknowledgedCount + record.accessCount;
      const tags = new Set((record.metadata.tags ?? []).map((tag) => tag.toLowerCase()));
      let nextLayer = record.metadata.cognitiveLayer ?? 'semantic';
      let nextAbstraction = consolidation.abstraction;

      if (
        nextLayer === 'episodic' &&
        rehearsal >= 3 &&
        ackRatio >= 0.55 &&
        consolidation.support >= 0.52 &&
        consolidation.volatility <= 0.45
      ) {
        nextLayer = tags.has('strategy') || tags.has('workflow') || tags.has('playbook') ? 'procedural' : 'semantic';
        nextAbstraction = nextLayer === 'procedural' ? 'procedural' : 'semantic';
      } else if (
        nextLayer !== 'procedural' &&
        (tags.has('strategy') || tags.has('procedure') || tags.has('workflow') || tags.has('playbook') || tags.has('howto')) &&
        rehearsal >= 4 &&
        ackRatio >= 0.62 &&
        consolidation.support >= 0.64 &&
        consolidation.volatility <= 0.4
      ) {
        nextLayer = 'procedural';
        nextAbstraction = 'procedural';
      }

      const maturedLevel = clamp01(Math.max(consolidation.level, consolidation.support * 0.78 + ackRatio * 0.22));
      const changed = nextLayer !== (record.metadata.cognitiveLayer ?? 'semantic') || nextAbstraction !== consolidation.abstraction || maturedLevel > consolidation.level + 0.01;
      if (!changed) continue;

      record.metadata.cognitiveLayer = nextLayer;
      record.consolidation = {
        ...consolidation,
        abstraction: nextAbstraction,
        level: maturedLevel,
        timesConsolidated: consolidation.timesConsolidated + 1,
        lastConsolidatedAt: Date.now(),
      };
      record.importance = Math.min(2.0, record.importance + 0.03);
      promoted++;
    }
    if (promoted > 0) this.debounceSave();
    return promoted;
  }

  private getRecentInjectionPenalty(record: MemoryRecord): number {
    const lastInjectedAt = record.lifecycle.lastInjectedAt;
    if (!lastInjectedAt) return 0;
    const hoursSince = (Date.now() - lastInjectedAt) / 3_600_000;
    if (hoursSince >= 24) return 0;
    if (hoursSince < 0.1) return 1;
    if (hoursSince < 1) return 0.85;
    if (hoursSince < 6) return 0.5;
    return 0.2;
  }

  private getAcknowledgementRatio(record: MemoryRecord): number {
    if (record.lifecycle.injectionCount <= 0) return 0.5;
    return record.lifecycle.acknowledgedCount / record.lifecycle.injectionCount;
  }

  private getRejectionRatio(record: MemoryRecord): number {
    if (record.lifecycle.injectionCount <= 0) return 0;
    return record.lifecycle.rejectedCount / record.lifecycle.injectionCount;
  }

  private removeLinksTo(id: string) {
    for (const record of this.records.values()) {
      if (record.id === id) continue;
      const nextNeighbors = record.lattice.neighbors.filter((link) => link.id !== id);
      if (nextNeighbors.length === record.lattice.neighbors.length) continue;
      record.lattice.neighbors = nextNeighbors;
      record.lattice.degree = nextNeighbors.length;
      record.lattice.clusterStrength = nextNeighbors.length > 0
        ? nextNeighbors.reduce((sum, link) => sum + link.weight, 0) / nextNeighbors.length
        : 0;
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const r of raw) {
            if (!r?.id || !r?.content) continue;
            const record = this.normalizeRecord(r);
            this.records.set(record.id, record);
          }
          console.log(`[MemoryStore] Loaded ${this.records.size} memory records.`);
          if (this.records.size > 1) this.scheduleLatticeRebuild(200);
        } else {
          console.warn('[MemoryStore] Invalid vector DB format (not an array).');
        }
      }
    } catch (e) {
      console.error('[MemoryStore] Failed to load:', e);
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(Array.from(this.records.values()), null, 2));
      this.dirty = false;
    } catch (e) {
      console.error('[MemoryStore] Failed to save:', e);
    }
  }

  // ── LSH helpers ───────────────────────────────────────────────────────────

  private ensureLsh(dim: number) {
    if (!this.lshIndex || this.lshIndex.dim !== dim) {
      this.lshIndex = new LSHIndex(dim);
      for (const r of this.records.values()) {
        if (r.embedding.length === dim) this.lshIndex.add(r.id, r.embedding);
      }
    }
  }

  // ── Core Operations ───────────────────────────────────────────────────────

  upsert(record: Omit<MemoryRecord, 'id' | 'accessCount' | 'createdAt' | 'lastAccessedAt' | 'lifecycle' | 'lattice'>): MemoryRecord {
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const full = this.normalizeRecord({
      ...record,
      id,
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      lifecycle: this.defaultLifecycle(),
      lattice: this.defaultLattice(),
    });
    full.geometry = this.enrichGeometry(buildMemoryGeometry(full.content, true) ?? full.geometry, id);
    if (full.geometry?.repetitionCount) {
      full.importance = Math.min(2.0, full.importance + Math.min(0.25, full.geometry.repetitionCount * 0.03));
    }
    this.records.set(id, full);
    if (full.embedding.length > 0) {
      this.ensureLsh(full.embedding.length);
      this.lshIndex!.add(id, full.embedding);
    }
    this.dirty = true;
    this.save(); // Immediate save for new memories
    this.scheduleLatticeRebuild();
    return full;
  }

  get(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  delete(id: string) {
    const rec = this.records.get(id);
    if (rec) this.lshIndex?.remove(id, rec.embedding);
    this.records.delete(id);
    this.removeLinksTo(id);
    this.dirty = true;
    this.save();
    this.scheduleLatticeRebuild();
  }

  all(): MemoryRecord[] {
    return Array.from(this.records.values());
  }

  // ── Semantic Search ───────────────────────────────────────────────────────

  private searchInternal(queryEmbedding: number[], topK: number, reinforceAccess: boolean): SearchResult[] {
    const now = Date.now();
    const results: SearchResult[] = [];

    // For large stores, use LSH to narrow candidates first (O(1) bucket lookup),
    // then re-rank with exact cosine over the candidate set.
    // This implements the lattice-proximity principle: nearby vectors share hash
    // buckets with high probability under the random projection metric.
    let candidates: Iterable<MemoryRecord>;
    if (this.records.size > 500 && queryEmbedding.length > 0) {
      this.ensureLsh(queryEmbedding.length);
      const ids = this.lshIndex!.query(queryEmbedding, Math.min(400, this.records.size));
      // If LSH returns a degenerate candidate set, fall back to full scan
      candidates = ids.size >= topK * 3
        ? (Array.from(ids).map(id => this.records.get(id)).filter(Boolean) as MemoryRecord[])
        : this.records.values();
    } else {
      candidates = this.records.values();
    }

    for (const record of candidates) {
      if (this.isSuppressed(record)) continue;
      const similarity = cosineSimilarity(queryEmbedding, record.embedding);
      if (similarity < 0.1) continue; // Hard threshold — ignore irrelevant noise

      const daysOld = Math.max(0, (now - record.createdAt) / DAY_MS);
      const memoryStrength = 1.0 * Math.pow(1.6, record.accessCount);
      const decayFactor = Math.exp(-(this.DECAY_LAMBDA * daysOld) / memoryStrength);
      const correctness = record.correctness ?? 0.75;
      const ackRatio = this.getAcknowledgementRatio(record);
      const rejectionRatio = this.getRejectionRatio(record);
      const qualityWeight = record.importance * 0.65 + correctness * 0.35;
      const latticeWeight = 1 + Math.min(0.25, record.lattice.clusterStrength * 0.18 + record.lattice.centrality * 0.08);
      const lifecycleWeight = 1 + ackRatio * 0.25 - rejectionRatio * 0.2 - Math.min(0.25, record.lifecycle.unacknowledgedStreak * 0.05);
      const score = similarity * decayFactor * qualityWeight * latticeWeight * lifecycleWeight + Math.log1p(record.accessCount) * 0.05;

      results.push({ record, score, similarity });
    }

    // Sort descending by initial relevance
    results.sort((a, b) => b.score - a.score);

    // Maximum Marginal Relevance (MMR) for Top-K Selection (Proxy for Determinantal Point Process)
    // MMR = lambda * Sim(Q, D) - (1 - lambda) * max_{S in Selected} Sim(D, S)
    const LAMBDA_MMR = 0.7; // 70% relevance, 30% diversity
    const top: SearchResult[] = [];
    
    if (results.length > 0) {
      // First item is always the most relevant greedy choice
      top.push(results[0]);
      
      const pool = results.slice(1);
      
      while (top.length < topK && pool.length > 0) {
        let bestIdx = -1;
        let maxMmrScore = -Infinity;

        for (let i = 0; i < pool.length; i++) {
          const candidate = pool[i];
          
          // Find max similarity between candidate and already selected items (redundancy penalty)
          let maxSimToSelected = 0.0;
          for (const selected of top) {
            const sim = this.recordSimilarity(candidate.record, selected.record);
            if (sim > maxSimToSelected) maxSimToSelected = sim;
          }

          // MMR greedy calculation
          const mmrScore = (LAMBDA_MMR * candidate.score) - ((1 - LAMBDA_MMR) * maxSimToSelected);

          if (mmrScore > maxMmrScore) {
            maxMmrScore = mmrScore;
            bestIdx = i;
          }
        }

        top.push(pool.splice(bestIdx, 1)[0]);
      }
    }

    if (reinforceAccess && top.length > 0) {
      const now2 = Date.now();
      for (const r of top) {
        r.record.accessCount++;
        r.record.lastAccessedAt = now2;
        r.record.importance = Math.min(2.0, r.record.importance + 0.05); // access boost
      }
      this.save();
    }

    return top;
  }

  private searchByGeometryInternal(queryEmbedding: number[], queryText: string, topK: number, reinforceAccess: boolean): SearchResult[] {
    const queryGeometry = buildMemoryGeometry(queryText, false);
    if (!queryGeometry) return this.searchInternal(queryEmbedding, topK, reinforceAccess);

    const now = Date.now();
    const queryKeywords = new Set(this.extractKeywords(queryText));
    const results: SearchResult[] = [];

    for (const record of this.records.values()) {
      if (this.isSuppressed(record)) continue;
      const embeddingSimilarity = queryEmbedding.length > 0 && record.embedding.length === queryEmbedding.length
        ? cosineSimilarity(queryEmbedding, record.embedding)
        : 0;
      const { geometrySimilarity, topologicalSynonym, repeatedShape } = this.queryGeometrySimilarity(queryGeometry, record);
      const keywordOverlap = this.keywordOverlap(queryText, record.content, record.metadata.triggerKeywords ?? []);
      const overlapRatio = queryKeywords.size > 0 ? keywordOverlap.length / queryKeywords.size : 0;

      if (geometrySimilarity < 0.18 && embeddingSimilarity < 0.1 && overlapRatio <= 0) continue;

      const daysOld = Math.max(0, (now - record.createdAt) / DAY_MS);
      const memoryStrength = 1.0 * Math.pow(1.6, record.accessCount);
      const decayFactor = Math.exp(-(this.DECAY_LAMBDA * daysOld) / memoryStrength);
      const correctness = record.correctness ?? 0.75;
      const ackRatio = this.getAcknowledgementRatio(record);
      const rejectionRatio = this.getRejectionRatio(record);
      const qualityWeight = record.importance * 0.65 + correctness * 0.35;
      const latticeWeight = 1 + Math.min(0.25, record.lattice.clusterStrength * 0.18 + record.lattice.centrality * 0.08);
      const lifecycleWeight = 1 + ackRatio * 0.25 - rejectionRatio * 0.2 - Math.min(0.25, record.lifecycle.unacknowledgedStreak * 0.05);
      const repetitionWeight = repeatedShape
        ? 1.14
        : 1 + Math.min(0.1, (record.geometry?.repetitionScore ?? 0) * 0.08 + (record.geometry?.repetitionCount ?? 0) * 0.015);
      const geometryWeight = 1 + Math.min(0.12, (record.geometry?.virtue ?? 0) * 0.08 + (record.geometry?.coherence ?? 0) * 0.04);
      const blendedSimilarity = clamp01(
        geometrySimilarity * GEOMETRY_PRIMARY_WEIGHT +
        embeddingSimilarity * EMBEDDING_FALLBACK_WEIGHT +
        overlapRatio * TEXTUAL_CONTEXT_WEIGHT
      );
      const score = blendedSimilarity * decayFactor * qualityWeight * latticeWeight * lifecycleWeight * repetitionWeight * geometryWeight
        + (topologicalSynonym ? 0.05 : 0)
        + Math.log1p(record.accessCount) * 0.05;

      results.push({ record, score, similarity: Math.max(geometrySimilarity, embeddingSimilarity) });
    }

    results.sort((a, b) => b.score - a.score);

    const selected: SearchResult[] = [];
    const pool = [...results];
    while (selected.length < topK && pool.length > 0) {
      if (selected.length === 0) {
        selected.push(pool.shift()!);
        continue;
      }

      let bestIndex = -1;
      let bestScore = -Infinity;
      for (let index = 0; index < pool.length; index++) {
        const candidate = pool[index];
        let maxSimilarityToSelected = 0;
        for (const existing of selected) {
          maxSimilarityToSelected = Math.max(maxSimilarityToSelected, this.recordSimilarity(candidate.record, existing.record));
        }
        const mmr = candidate.score * 0.72 - maxSimilarityToSelected * 0.28;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIndex = index;
        }
      }
      selected.push(pool.splice(bestIndex, 1)[0]);
    }

    if (reinforceAccess && selected.length > 0) {
      const accessedAt = Date.now();
      for (const result of selected) {
        result.record.accessCount++;
        result.record.lastAccessedAt = accessedAt;
        result.record.importance = Math.min(2.0, result.record.importance + 0.05);
      }
      this.save();
    }

    return selected;
  }

  search(queryEmbedding: number[], topK: number = 5, queryText?: string): SearchResult[] {
    return queryText?.trim()
      ? this.searchByGeometryInternal(queryEmbedding, queryText, topK, true)
      : this.searchInternal(queryEmbedding, topK, true);
  }

  getInjectionCandidates(queryEmbedding: number[], query: string, limit: number = 12): MemoryInjectionCandidate[] {
    const queryGeometry = buildMemoryGeometry(query, false);
    const semantic = this.searchInternal(queryEmbedding, Math.max(limit, 8), false);
    const geometric = this.searchByGeometryInternal(queryEmbedding, query, Math.max(limit * 2, 16), false);
    const textMatches = this.searchByText(query, Math.max(limit, 8), 2);
    const candidates = new Map<string, MemoryInjectionCandidate>();
    const semanticMap = new Map(semantic.map((result) => [result.record.id, result]));

    for (const result of geometric) {
      const overlap = this.keywordOverlap(query, result.record.content, result.record.metadata.triggerKeywords ?? []);
      const taskSalience = this.inferTaskSalience(result.record, query, overlap);
      const triggerHits = this.getTriggerHits(result.record, overlap);
      const geometrySimilarity = this.queryGeometrySimilarity(queryGeometry, result.record).geometrySimilarity;
      candidates.set(result.record.id, {
        record: result.record,
        source: result.record.geometry ? 'geometric' : 'semantic',
        score: result.score,
        similarity: result.similarity,
        activationScore: 0,
        cognitiveLayer: result.record.metadata.cognitiveLayer ?? 'semantic',
        taskSalience,
        emotion: result.record.metadata.emotion ?? 'neutral',
        goalResonance: this.getGoalResonance(result.record, query, overlap),
        novelty: this.getNoveltyScore(result.record),
        consolidationLevel: result.record.consolidation?.level ?? 0,
        stabilityScore: this.getStabilityScore(result.record),
        triggerHits,
        emotionWeight: this.getEmotionWeight(result.record.metadata.emotion ?? 'neutral'),
        geometrySimilarity,
        textHits: overlap.length,
        keywordOverlap: overlap,
        ageDays: Math.max(0, (Date.now() - result.record.createdAt) / DAY_MS),
        recentInjectionPenalty: this.getRecentInjectionPenalty(result.record),
        acknowledgementRatio: this.getAcknowledgementRatio(result.record),
        rejectionRatio: this.getRejectionRatio(result.record),
        latticeSupport: result.record.lattice.clusterStrength,
        centrality: result.record.lattice.centrality,
        repetitionScore: result.record.geometry?.repetitionScore ?? 0,
        repetitionCount: result.record.geometry?.repetitionCount ?? 0,
        geometryVirtue: result.record.geometry?.virtue ?? 0,
      });
    }

    for (const result of semantic) {
      const existing = candidates.get(result.record.id);
      if (existing) {
        existing.score = Math.max(existing.score, result.score);
        existing.similarity = Math.max(existing.similarity, result.similarity);
        continue;
      }
      const overlap = this.keywordOverlap(query, result.record.content, result.record.metadata.triggerKeywords ?? []);
      const taskSalience = this.inferTaskSalience(result.record, query, overlap);
      const triggerHits = this.getTriggerHits(result.record, overlap);
      candidates.set(result.record.id, {
        record: result.record,
        source: 'semantic',
        score: result.score,
        similarity: result.similarity,
        activationScore: 0,
        cognitiveLayer: result.record.metadata.cognitiveLayer ?? 'semantic',
        taskSalience,
        emotion: result.record.metadata.emotion ?? 'neutral',
        goalResonance: this.getGoalResonance(result.record, query, overlap),
        novelty: this.getNoveltyScore(result.record),
        consolidationLevel: result.record.consolidation?.level ?? 0,
        stabilityScore: this.getStabilityScore(result.record),
        triggerHits,
        emotionWeight: this.getEmotionWeight(result.record.metadata.emotion ?? 'neutral'),
        geometrySimilarity: this.queryGeometrySimilarity(queryGeometry, result.record).geometrySimilarity,
        textHits: overlap.length,
        keywordOverlap: overlap,
        ageDays: Math.max(0, (Date.now() - result.record.createdAt) / DAY_MS),
        recentInjectionPenalty: this.getRecentInjectionPenalty(result.record),
        acknowledgementRatio: this.getAcknowledgementRatio(result.record),
        rejectionRatio: this.getRejectionRatio(result.record),
        latticeSupport: result.record.lattice.clusterStrength,
        centrality: result.record.lattice.centrality,
        repetitionScore: result.record.geometry?.repetitionScore ?? 0,
        repetitionCount: result.record.geometry?.repetitionCount ?? 0,
        geometryVirtue: result.record.geometry?.virtue ?? 0,
      });
    }

    for (const record of textMatches) {
      const overlap = this.keywordOverlap(query, record.content, record.metadata.triggerKeywords ?? []);
      const taskSalience = this.inferTaskSalience(record, query, overlap);
      const triggerHits = this.getTriggerHits(record, overlap);
      const existing = candidates.get(record.id);
      if (existing) {
        existing.source = 'hybrid';
        existing.textHits = Math.max(existing.textHits, overlap.length);
        existing.keywordOverlap = Array.from(new Set([...existing.keywordOverlap, ...overlap]));
        existing.score = Math.max(existing.score, existing.score + overlap.length * 0.08 + existing.geometrySimilarity * 0.06 + triggerHits * 0.07);
        existing.taskSalience = Math.max(existing.taskSalience, taskSalience);
        existing.triggerHits = Math.max(existing.triggerHits, triggerHits);
        existing.emotionWeight = Math.max(existing.emotionWeight, this.getEmotionWeight(record.metadata.emotion ?? 'neutral'));
        existing.recentInjectionPenalty = Math.max(existing.recentInjectionPenalty, this.getRecentInjectionPenalty(record));
        existing.goalResonance = Math.max(existing.goalResonance, this.getGoalResonance(record, query, overlap));
        existing.novelty = Math.max(existing.novelty, this.getNoveltyScore(record));
        existing.consolidationLevel = Math.max(existing.consolidationLevel, record.consolidation?.level ?? 0);
        existing.stabilityScore = Math.max(existing.stabilityScore, this.getStabilityScore(record));
        continue;
      }

      const semanticResult = semanticMap.get(record.id);
      candidates.set(record.id, {
        record,
        source: semanticResult ? 'hybrid' : 'text',
        score: semanticResult?.score ?? (record.importance * 0.4 + overlap.length * 0.12),
        similarity: semanticResult?.similarity ?? 0,
        activationScore: 0,
        cognitiveLayer: record.metadata.cognitiveLayer ?? 'semantic',
        taskSalience,
        emotion: record.metadata.emotion ?? 'neutral',
        goalResonance: this.getGoalResonance(record, query, overlap),
        novelty: this.getNoveltyScore(record),
        consolidationLevel: record.consolidation?.level ?? 0,
        stabilityScore: this.getStabilityScore(record),
        triggerHits,
        emotionWeight: this.getEmotionWeight(record.metadata.emotion ?? 'neutral'),
        geometrySimilarity: this.queryGeometrySimilarity(queryGeometry, record).geometrySimilarity,
        textHits: overlap.length,
        keywordOverlap: overlap,
        ageDays: Math.max(0, (Date.now() - record.createdAt) / DAY_MS),
        recentInjectionPenalty: this.getRecentInjectionPenalty(record),
        acknowledgementRatio: this.getAcknowledgementRatio(record),
        rejectionRatio: this.getRejectionRatio(record),
        latticeSupport: record.lattice.clusterStrength,
        centrality: record.lattice.centrality,
        repetitionScore: record.geometry?.repetitionScore ?? 0,
        repetitionCount: record.geometry?.repetitionCount ?? 0,
        geometryVirtue: record.geometry?.virtue ?? 0,
      });
    }

    return Array.from(candidates.values())
      .map((candidate) => ({
        ...candidate,
        activationScore: this.computeActivationScore(candidate),
      }))
      .filter((candidate) => {
        const relevant = candidate.geometrySimilarity >= 0.45 || candidate.similarity >= 0.22 || candidate.textHits >= 2 || candidate.source === 'hybrid';
        if (!relevant) return false;
        if (candidate.recentInjectionPenalty >= 0.85 && candidate.triggerHits === 0 && candidate.taskSalience < 0.88) return false;
        if (candidate.goalResonance < 0.2 && candidate.stabilityScore < 0.4 && candidate.novelty < 0.45) return false;
        if (candidate.activationScore < 0.33) return false;
        return true;
      })
      .sort((a, b) => b.activationScore - a.activationScore || b.score - a.score)
      .slice(0, limit);
  }

  inferAcknowledgements(memoryIds: string[], text: string, minOverlap: number = 1): string[] {
    const acknowledged: string[] = [];
    const responseGeometry = buildMemoryGeometry(text, false);
    for (const id of memoryIds) {
      const record = this.records.get(id);
      if (!record) continue;
      const overlap = this.keywordOverlap(text, record.content);
      const geometrySimilarity = compareMemoryGeometry(responseGeometry, record.geometry).score;
      if (overlap.length >= minOverlap || geometrySimilarity >= 0.74) acknowledged.push(id);
    }
    return acknowledged;
  }

  recordInjectionFeedback(injectedIds: string[], acknowledgedIds: string[], rejectedIds: string[] = []) {
    const now = Date.now();
    const acknowledged = new Set(acknowledgedIds);
    const rejected = new Set(rejectedIds.filter((id) => !acknowledged.has(id)));
    let touched = false;

    for (const id of injectedIds) {
      const record = this.records.get(id);
      if (!record) continue;
      touched = true;
      record.lifecycle.injectionCount++;
      record.lifecycle.lastInjectedAt = now;

      if (acknowledged.has(id)) {
        record.lifecycle.acknowledgedCount++;
        record.lifecycle.unacknowledgedStreak = 0;
        record.lifecycle.lastAcknowledgedAt = now;
        record.importance = Math.min(2.0, record.importance + 0.04);
        this.reinforceConsolidation(record, 'acknowledged');
      } else {
        record.lifecycle.unacknowledgedStreak++;
        this.reinforceConsolidation(record, 'ignored');
      }

      if (rejected.has(id)) {
        record.lifecycle.rejectedCount++;
        record.lifecycle.lastRejectedAt = now;
        record.importance = Math.max(0.05, record.importance - 0.08);
        this.reinforceConsolidation(record, 'rejected');
      }

      this.maybeSuppressFixation(record);
    }

    if (touched) {
      this.feedbackSinceMaintenance += injectedIds.length;
      this.debounceSave();
      this.scheduleLatticeRebuild();
      this.maybeRunMaintenance();
    }
  }

  private maybeRunMaintenance() {
    const now = Date.now();
    if (this.feedbackSinceMaintenance < 24 && now - this.lastMaintenanceAt < DAY_MS) return;
    this.feedbackSinceMaintenance = 0;
    this.lastMaintenanceAt = now;
    this.maintenancePass({ rebuildLattice: true });
  }

  acknowledge(id: string, strength: number = 1) {
    const record = this.records.get(id);
    if (!record) return false;
    record.lifecycle.acknowledgedCount += Math.max(1, Math.round(strength));
    record.lifecycle.unacknowledgedStreak = 0;
    record.lifecycle.lastAcknowledgedAt = Date.now();
    record.importance = Math.min(2.0, record.importance + 0.05 * Math.max(1, strength));
    this.reinforceConsolidation(record, 'acknowledged');
    this.debounceSave();
    return true;
  }

  reject(id: string, strength: number = 1) {
    const record = this.records.get(id);
    if (!record) return false;
    record.lifecycle.rejectedCount += Math.max(1, Math.round(strength));
    record.lifecycle.unacknowledgedStreak += Math.max(1, Math.round(strength));
    record.lifecycle.lastRejectedAt = Date.now();
    record.importance = Math.max(0.05, record.importance - 0.08 * Math.max(1, strength));
    this.maybeSuppressFixation(record, Math.max(6, Math.round(strength) * 6));
    this.reinforceConsolidation(record, 'rejected');
    this.debounceSave();
    return true;
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  /**
   * Remove records whose decayed importance * similarity is below threshold.
   * Preserves records with high access counts (frequently useful memories).
   */
  prune(importanceThreshold: number = 0.05): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, record] of this.records.entries()) {
      if (record.accessCount > 5) continue; // Never prune frequently accessed
      
      const daysOld = Math.max(0, (now - record.createdAt) / DAY_MS);
      const memoryStrength = 1.0 * Math.pow(1.6, record.accessCount);
      const retention = Math.exp(-(this.DECAY_LAMBDA * daysOld) / memoryStrength);
      const lifecyclePenalty = Math.max(0.4, 1 - this.getRejectionRatio(record) * 0.6 - record.lifecycle.unacknowledgedStreak * 0.06);
      const effective = record.importance * retention * lifecyclePenalty;
      
      if (effective < importanceThreshold) {
        this.lshIndex?.remove(id, record.embedding);
        this.records.delete(id);
        this.removeLinksTo(id);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.save();
      this.scheduleLatticeRebuild();
    }
    console.log(`[MemoryStore] Pruned ${pruned} decayed memories. ${this.records.size} remain.`);
    return pruned;
  }

  forgetUnacknowledged(maxStreak: number = 4, minInjectionCount: number = 4, maxImportance: number = 0.9): number {
    let removed = 0;
    for (const [id, record] of this.records.entries()) {
      const ackRatio = this.getAcknowledgementRatio(record);
      if (
        record.lifecycle.injectionCount >= minInjectionCount &&
        record.lifecycle.unacknowledgedStreak >= maxStreak &&
        ackRatio < 0.15 &&
        record.importance <= maxImportance &&
        record.accessCount <= 2
      ) {
        this.lshIndex?.remove(id, record.embedding);
        this.records.delete(id);
        this.removeLinksTo(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.save();
      this.scheduleLatticeRebuild();
    }
    return removed;
  }

  /**
   * Boost importance of a memory by ID (manual pinning).
   */
  boost(id: string, boost: number = 0.5) {
    const r = this.records.get(id);
    if (r) {
      r.importance = Math.min(2.0, r.importance + boost);
      this.dirty = true;
      this.save();
    }
  }

  /**
   * Reduce importance of a memory (used by consolidator after merging).
   */
  reduceImportance(id: string, reduction: number = 0.3) {
    const r = this.records.get(id);
    if (r) {
      r.importance = Math.max(0.05, r.importance - reduction);
      this.dirty = true;
      this.debounceSave();
    }
  }

  /**
   * Search by tag — returns records that have any of the given tags.
   */
  searchByTags(tags: string[], topK: number = 20): MemoryRecord[] {
    const results: MemoryRecord[] = [];
    for (const record of this.records.values()) {
      const recordTags: string[] = record.metadata.tags ?? [];
      if (tags.some(t => recordTags.includes(t))) {
        results.push(record);
      }
    }
    results.sort((a, b) => b.importance - a.importance);
    return results.slice(0, topK);
  }

  /**
   * Full-text substring search. Only returns records with meaningful keyword overlap.
   * Uses a stopword filter and requires multiple significant word matches to avoid
   * injecting irrelevant memories based on common words like "the", "how", "can".
   */
  searchByText(query: string, topK: number = 10, minHits: number = 2): MemoryRecord[] {
    const words = this.extractKeywords(query);

    // If query has very few meaningful words, require only 1 hit to avoid over-filtering
    const effectiveMinHits = words.length <= 2 ? 1 : minHits;
    if (words.length === 0) return [];

    const results: Array<{ record: MemoryRecord; hits: number; score: number }> = [];
    for (const record of this.records.values()) {
      if (this.isSuppressed(record)) continue;
      const content = `${record.content.toLowerCase()} ${(record.metadata.triggerKeywords ?? []).join(' ').toLowerCase()}`;
      const hits = words.filter(w => content.includes(w)).length;
      if (hits >= effectiveMinHits) {
        const triggerHits = words.filter((word) => (record.metadata.triggerKeywords ?? []).includes(word)).length;
        const score = (hits / words.length) * record.importance * (1 + this.getAcknowledgementRatio(record) * 0.2 - this.getRejectionRatio(record) * 0.15 + triggerHits * 0.08 + this.getEmotionWeight(record.metadata.emotion ?? 'neutral'));
        results.push({ record, hits, score });
      }
    }
    results.sort((a, b) => b.score - a.score || b.hits - a.hits);
    return results.slice(0, topK).map(r => r.record);
  }

  /**
   * Returns summary statistics about the memory store.
   */
  getStats(): {
    total: number;
    avgImportance: number;
    avgAccessCount: number;
    oldestMs: number;
    newestMs: number;
    topTags: Array<{ tag: string; count: number }>;
    sourceBreakdown: Record<string, number>;
    avgAcknowledgementRatio: number;
    avgConsolidationLevel: number;
    avgLatticeDegree: number;
    staleUnacknowledged: number;
    suppressedCount: number;
    geometryCoverage: number;
    avgGeometryVirtue: number;
    repeatedShapeMemories: number;
    matureKnowledgeCount: number;
    proceduralMemoryCount: number;
  } {
    const all = this.all();
    if (all.length === 0) {
      return { total: 0, avgImportance: 0, avgAccessCount: 0, oldestMs: 0, newestMs: 0, topTags: [], sourceBreakdown: {}, avgAcknowledgementRatio: 0, avgConsolidationLevel: 0, avgLatticeDegree: 0, staleUnacknowledged: 0, suppressedCount: 0, geometryCoverage: 0, avgGeometryVirtue: 0, repeatedShapeMemories: 0, matureKnowledgeCount: 0, proceduralMemoryCount: 0 };
    }

    const tagCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let sumImportance = 0, sumAccess = 0, sumAckRatio = 0, sumConsolidation = 0, sumDegree = 0, sumGeometryVirtue = 0, geometryCount = 0, repeatedShapeMemories = 0, oldest = Infinity, newest = 0, staleUnacknowledged = 0, suppressedCount = 0, matureKnowledgeCount = 0, proceduralMemoryCount = 0;

    for (const r of all) {
      sumImportance += r.importance;
      sumAccess += r.accessCount;
      sumAckRatio += this.getAcknowledgementRatio(r);
      sumConsolidation += r.consolidation?.level ?? 0;
      sumDegree += r.lattice.degree;
      if ((r.consolidation?.level ?? 0) >= 0.6) matureKnowledgeCount++;
      if ((r.metadata.cognitiveLayer ?? 'semantic') === 'procedural') proceduralMemoryCount++;
      if (r.geometry) {
        geometryCount++;
        sumGeometryVirtue += r.geometry.virtue;
        if (r.geometry.repetitionCount > 0) repeatedShapeMemories++;
      }
      if (r.createdAt < oldest) oldest = r.createdAt;
      if (r.createdAt > newest) newest = r.createdAt;
      if (r.lifecycle.unacknowledgedStreak >= 3) staleUnacknowledged++;
      if (this.isSuppressed(r)) suppressedCount++;
      for (const tag of r.metadata.tags ?? []) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
      const src = r.metadata.source ?? 'unknown';
      sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return {
      total: all.length,
      avgImportance: parseFloat((sumImportance / all.length).toFixed(3)),
      avgAccessCount: parseFloat((sumAccess / all.length).toFixed(1)),
      oldestMs: oldest === Infinity ? 0 : oldest,
      newestMs: newest,
      topTags,
      sourceBreakdown: sourceCounts,
      avgAcknowledgementRatio: parseFloat((sumAckRatio / all.length).toFixed(3)),
      avgConsolidationLevel: parseFloat((sumConsolidation / all.length).toFixed(3)),
      avgLatticeDegree: parseFloat((sumDegree / all.length).toFixed(2)),
      staleUnacknowledged,
      suppressedCount,
      geometryCoverage: parseFloat((geometryCount / all.length).toFixed(3)),
      avgGeometryVirtue: parseFloat((geometryCount > 0 ? sumGeometryVirtue / geometryCount : 0).toFixed(3)),
      repeatedShapeMemories,
      matureKnowledgeCount,
      proceduralMemoryCount,
    };
  }

  /**
   * Get recent memories sorted by creation time.
   */
  getRecent(limit: number = 20): MemoryRecord[] {
    return this.all()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Get highest-importance memories.
   */
  getImportant(limit: number = 20): MemoryRecord[] {
    return this.all()
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  /**
   * Get most-accessed memories.
   */
  getMostAccessed(limit: number = 20): MemoryRecord[] {
    return this.all()
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * Tag-Lattice search — retrieve memories sharing a lattice-join of the query
   * tags.  The lattice here is the power-set of tags ordered by inclusion:
   * a memory is relevant if it sits at or above the meet (intersection) of the
   * query tags.  At least ⌈50%⌉ of query tags must match.
   */
  searchByTagLattice(tags: string[], topK: number = 20): MemoryRecord[] {
    if (tags.length === 0) return [];
    const tagSet = new Set(tags);
    const minMatch = Math.max(1, Math.ceil(tags.length * 0.5));
    const results: Array<{ record: MemoryRecord; overlap: number }> = [];
    for (const record of this.records.values()) {
      const rt = record.metadata.tags ?? [];
      const overlap = rt.filter(t => tagSet.has(t)).length;
      if (overlap >= minMatch) results.push({ record, overlap });
    }
    results.sort((a, b) =>
      b.overlap !== a.overlap ? b.overlap - a.overlap : b.record.importance - a.record.importance
    );
    return results.slice(0, topK).map(r => r.record);
  }

  /**
   * Formal Concept Analysis — compute concept clusters as (tags, memories) pairs
   * representing closed sets in the Galois connection between memories and tags.
   * Returns up to 20 most specific concepts with ≥minSupport memories.
   */
  getConceptClusters(minSupport: number = 3): Array<{ tags: string[]; memoryIds: string[]; specificity: number }> {
    // Collect all non-empty-tag memories
    const tagged: Array<{ id: string; tags: Set<string> }> = [];
    for (const r of this.records.values()) {
      const tags = r.metadata.tags ?? [];
      if (tags.length > 0) tagged.push({ id: r.id, tags: new Set(tags) });
    }
    if (tagged.length < minSupport) return [];

    // Find all frequent tag combos (1-itemsets and 2-itemsets only for performance)
    const concepts = new Map<string, { tags: Set<string>; ids: Set<string> }>();

    // 1-itemsets
    for (const { id, tags } of tagged) {
      for (const tag of tags) {
        if (!concepts.has(tag)) concepts.set(tag, { tags: new Set([tag]), ids: new Set() });
        concepts.get(tag)!.ids.add(id);
      }
    }

    // 2-itemsets via intersection
    const tagList = Array.from(concepts.keys());
    for (let i = 0; i < tagList.length; i++) {
      for (let j = i + 1; j < tagList.length; j++) {
        const key = `${tagList[i]}|${tagList[j]}`;
        const ids = new Set<string>();
        for (const { id, tags } of tagged) {
          if (tags.has(tagList[i]) && tags.has(tagList[j])) ids.add(id);
        }
        if (ids.size >= minSupport) {
          concepts.set(key, { tags: new Set([tagList[i], tagList[j]]), ids });
        }
      }
    }

    return Array.from(concepts.values())
      .filter(c => c.ids.size >= minSupport)
      .map(c => ({ tags: Array.from(c.tags), memoryIds: Array.from(c.ids), specificity: c.tags.size }))
      .sort((a, b) => b.specificity - a.specificity || b.memoryIds.length - a.memoryIds.length)
      .slice(0, 20);
  }

  rebuildLattice(limitNeighbors: number = LATTICE_NEIGHBOR_LIMIT, minSimilarity: number = LATTICE_MIN_SIMILARITY): number {
    const records = this.all();
    for (const record of records) {
      record.lattice = this.defaultLattice({ updatedAt: Date.now() });
    }

    if (records.length <= 1) {
      this.latticeDirty = false;
      this.debounceSave();
      return records.length;
    }

    const adjacency = new Map<string, Array<{ id: string; weight: number; similarity: number; sharedTags: number }>>();
    for (const record of records) adjacency.set(record.id, []);

    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i];
        const b = records[j];
        const embeddingSimilarity = a.embedding.length > 0 && a.embedding.length === b.embedding.length
          ? cosineSimilarity(a.embedding, b.embedding)
          : 0;
        const geometrySimilarity = compareMemoryGeometry(a.geometry, b.geometry).score;
        const similarity = Math.max(geometrySimilarity, embeddingSimilarity);
        const tagsA = new Set(a.metadata.tags ?? []);
        const sharedTags = (b.metadata.tags ?? []).filter((tag) => tagsA.has(tag)).length;
        if (similarity < minSimilarity && sharedTags === 0) continue;
        const weight = parseFloat((geometrySimilarity * 0.72 + embeddingSimilarity * 0.28 + sharedTags * 0.08).toFixed(4));
        adjacency.get(a.id)!.push({ id: b.id, weight, similarity, sharedTags });
        adjacency.get(b.id)!.push({ id: a.id, weight, similarity, sharedTags });
      }
    }

    const centrality = new Map<string, number>();
    for (const record of records) centrality.set(record.id, 1 / records.length);
    for (let iteration = 0; iteration < 8; iteration++) {
      const next = new Map<string, number>();
      let total = 0;
      for (const record of records) {
        const neighbors = adjacency.get(record.id)!;
        let value = 0.15 / records.length;
        for (const neighbor of neighbors) {
          const neighborWeightSum = adjacency.get(neighbor.id)!.reduce((sum, item) => sum + item.weight, 0) || 1;
          value += 0.85 * (centrality.get(neighbor.id) ?? 0) * (neighbor.weight / neighborWeightSum);
        }
        next.set(record.id, value);
        total += value;
      }
      for (const [id, value] of next) centrality.set(id, total > 0 ? value / total : value);
    }

    const updatedAt = Date.now();
    for (const record of records) {
      const neighbors = adjacency.get(record.id)!
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limitNeighbors)
        .map((link) => ({
          id: link.id,
          similarity: parseFloat(link.similarity.toFixed(4)),
          sharedTags: link.sharedTags,
          weight: parseFloat(link.weight.toFixed(4)),
          updatedAt,
        }));
      record.lattice = {
        neighbors,
        degree: neighbors.length,
        clusterStrength: neighbors.length > 0
          ? parseFloat((neighbors.reduce((sum, link) => sum + link.weight, 0) / neighbors.length).toFixed(4))
          : 0,
        centrality: parseFloat((centrality.get(record.id) ?? 0).toFixed(4)),
        updatedAt,
      };
    }

    this.latticeDirty = false;
    this.debounceSave();
    return records.length;
  }

  getLattice(id?: string, limit: number = 20) {
    if (id) {
      const record = this.records.get(id);
      if (!record) return null;
      return {
        id: record.id,
        content: record.content,
        centrality: record.lattice.centrality,
        clusterStrength: record.lattice.clusterStrength,
        neighbors: record.lattice.neighbors.slice(0, limit).map((link) => ({
          ...link,
          content: this.records.get(link.id)?.content ?? '',
        })),
      };
    }

    return this.all()
      .sort((a, b) => b.lattice.centrality - a.lattice.centrality || b.lattice.clusterStrength - a.lattice.clusterStrength)
      .slice(0, limit)
      .map((record) => ({
        id: record.id,
        content: record.content,
        centrality: record.lattice.centrality,
        clusterStrength: record.lattice.clusterStrength,
        degree: record.lattice.degree,
        neighbors: record.lattice.neighbors.slice(0, 3),
      }));
  }

  maintenancePass(opts?: {
    pruneThreshold?: number;
    maxUnacknowledgedStreak?: number;
    minInjectionCount?: number;
    maxImportance?: number;
    rebuildLattice?: boolean;
  }) {
    this.lastMaintenanceAt = Date.now();
    this.feedbackSinceMaintenance = 0;
    const prunedDecay = this.prune(opts?.pruneThreshold ?? 0.05);
    const forgottenUnacknowledged = this.forgetUnacknowledged(
      opts?.maxUnacknowledgedStreak ?? 4,
      opts?.minInjectionCount ?? 4,
      opts?.maxImportance ?? 0.9,
    );
    const promotedConsolidations = this.promoteStableMemories();
    const latticeNodes = opts?.rebuildLattice === false ? 0 : this.rebuildLattice();
    return {
      prunedDecay,
      forgottenUnacknowledged,
      promotedConsolidations,
      latticeNodes,
      remaining: this.records.size,
    };
  }

  /** Wipe all records and the LSH index — used by factory reset. */
  clear() {
    this.records.clear();
    this.lshIndex?.clear();
    this.lshIndex = null;
    this.latticeDirty = false;
    this.feedbackSinceMaintenance = 0;
    this.lastMaintenanceAt = 0;
    this.save();
  }

  get size() { return this.records.size; }
}

export const vectorStore = new VectorStore();

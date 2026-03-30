// src/lib/vector-store.ts
// File-backed persistent vector store.
// Zero external dependencies — stores vectors in a JSON file.
// Uses cosine similarity for retrieval with importance-weighted decay.

import fs from 'fs';
import path from 'path';
import { cosineSimilarity } from './embeddings';
import { PATHS } from './paths';

const DB_PATH = PATHS.vectorStore;

export interface MemoryRecord {
  id: string;
  content: string;        // Original text stored
  embedding: number[];   // Normalized embedding vector
  dim: number;           // Embedding dimension
  metadata: {
    source: 'user' | 'agent' | 'tool' | 'system' | 'vision';
    topic?: string;
    entities?: string[];  // Extracted key entities
    tags?: string[];
    spatial?: { x: number; y: number; z?: number; w?: number; h?: number };
    contextSummary?: string;  // Short summary of the conversation that produced this memory
    polarity?: 'positive' | 'neutral' | 'negative';  // Whether memory records a success or failure
  };
  importance: number;    // 0.0 → 2.0 — user can boost, decay reduces
  correctness?: number;  // 0.0 → 1.0 — factual/outcome quality. Negative memories get low correctness.
  accessCount: number;   // How many times retrieved
  createdAt: number;     // ms timestamp
  lastAccessedAt: number;
}

export interface SearchResult {
  record: MemoryRecord;
  score: number;  // Final weighted score (higher = more relevant)
  similarity: number;  // Raw cosine similarity
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

  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
    // Periodic auto-save every 30s
    if (typeof setInterval !== 'undefined') {
      setInterval(() => { if (this.dirty) this.save(); }, 30_000);
    }
  }

  private debounceSave() {
    this.dirty = true;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.save(), 5000);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const r of raw) this.records.set(r.id, r);
          console.log(`[MemoryStore] Loaded ${this.records.size} memory records.`);
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

  upsert(record: Omit<MemoryRecord, 'id' | 'accessCount' | 'createdAt' | 'lastAccessedAt'>): MemoryRecord {
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const full: MemoryRecord = {
      correctness: 0.75, // default neutral-positive prior
      ...record,
      id,
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    this.records.set(id, full);
    if (full.embedding.length > 0) {
      this.ensureLsh(full.embedding.length);
      this.lshIndex!.add(id, full.embedding);
    }
    this.dirty = true;
    this.save(); // Immediate save for new memories
    return full;
  }

  get(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  delete(id: string) {
    const rec = this.records.get(id);
    if (rec) this.lshIndex?.remove(id, rec.embedding);
    this.records.delete(id);
    this.dirty = true;
    this.save();
  }

  all(): MemoryRecord[] {
    return Array.from(this.records.values());
  }

  // ── Semantic Search ───────────────────────────────────────────────────────

  search(queryEmbedding: number[], topK: number = 5): SearchResult[] {
    const now = Date.now();
    const DAY_MS = 86_400_000;
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
      const similarity = cosineSimilarity(queryEmbedding, record.embedding);
      if (similarity < 0.1) continue; // Hard threshold — ignore irrelevant noise

      const daysOld = (now - record.createdAt) / DAY_MS;
      // Power-law temporal discount (heavier tail than exponential — old memories
      // with high importance survive longer)
      const decayFactor = Math.pow(1 + this.DECAY_LAMBDA * daysOld, -1.5);
      const accessBonus = Math.log1p(record.accessCount) * 0.05;

      // Final score: semantic similarity * time decay * importance + access bonus
      // Combine importance (what was relevant) and correctness (what was right).
      // Negative-polarity memories (correctness < 0.4) still surface — the agent
      // needs to know what NOT to do — but they score lower than positive ones.
      const correctness = record.correctness ?? 0.75;
      const qualityWeight = record.importance * 0.65 + correctness * 0.35;
      const score = similarity * decayFactor * qualityWeight + accessBonus;
      results.push({ record, score, similarity });
    }

    // Sort descending, return top K
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, topK);

    // Reinforce accessed memories
    const now2 = Date.now();
    for (const r of top) {
      r.record.accessCount++;
      r.record.lastAccessedAt = now2;
      r.record.importance = Math.min(2.0, r.record.importance + 0.05); // access boost
    }
    if (top.length > 0) this.save();

    return top;
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  /**
   * Remove records whose decayed importance * similarity is below threshold.
   * Preserves records with high access counts (frequently useful memories).
   */
  prune(importanceThreshold: number = 0.05): number {
    const now = Date.now();
    const DAY_MS = 86_400_000;
    let pruned = 0;

    for (const [id, record] of this.records.entries()) {
      if (record.accessCount > 5) continue; // Never prune frequently accessed
      const daysOld = (now - record.createdAt) / DAY_MS;
      const effective = record.importance * Math.exp(-this.DECAY_LAMBDA * daysOld);
      if (effective < importanceThreshold) {
        this.records.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) this.save();
    console.log(`[MemoryStore] Pruned ${pruned} decayed memories. ${this.records.size} remain.`);
    return pruned;
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
   * Full-text substring search (last-resort when embeddings are degraded).
   */
  searchByText(query: string, topK: number = 10): MemoryRecord[] {
    const q = query.toLowerCase();
    const results: Array<{ record: MemoryRecord; hits: number }> = [];
    const words = q.split(/\s+/).filter(w => w.length > 2);

    for (const record of this.records.values()) {
      const content = record.content.toLowerCase();
      const hits = words.filter(w => content.includes(w)).length;
      if (hits > 0) results.push({ record, hits });
    }
    results.sort((a, b) => b.hits - a.hits || b.record.importance - a.record.importance);
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
  } {
    const all = this.all();
    if (all.length === 0) {
      return { total: 0, avgImportance: 0, avgAccessCount: 0, oldestMs: 0, newestMs: 0, topTags: [], sourceBreakdown: {} };
    }

    const tagCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let sumImportance = 0, sumAccess = 0, oldest = Infinity, newest = 0;

    for (const r of all) {
      sumImportance += r.importance;
      sumAccess += r.accessCount;
      if (r.createdAt < oldest) oldest = r.createdAt;
      if (r.createdAt > newest) newest = r.createdAt;
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

  /** Wipe all records and the LSH index — used by factory reset. */
  clear() {
    this.records.clear();
    this.lshIndex?.clear();
    this.lshIndex = null;
    this.save();
  }

  get size() { return this.records.size; }
}

export const vectorStore = new VectorStore();

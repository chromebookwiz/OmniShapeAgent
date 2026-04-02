// src/lib/memory-consolidator.ts
// Periodically synthesizes clusters of similar memories into consolidated summaries.
// Reduces redundancy, raises importance of recurring themes, keeps the store lean.

import fs from 'fs';
import { vectorStore, MemoryRecord } from './vector-store';
import { cosineSimilarity, generateEmbedding } from './embeddings';

import { PATHS } from './paths';
const LOG_PATH = PATHS.consolidationLog;
const SIMILARITY_THRESHOLD = 0.82;  // Memories this similar are candidates for merging
const MIN_CLUSTER_SIZE = 3;         // Only consolidate clusters of at least 3 memories
const CONSOLIDATION_INTERVAL_MS = 30 * 60 * 1000; // Every 30 minutes

interface ConsolidationLog {
  runs: Array<{
    timestamp: number;
    clustersFound: number;
    memoriesMerged: number;
    summariesCreated: number;
  }>;
  totalConsolidations: number;
}

class MemoryConsolidator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private log: ConsolidationLog;

  constructor() {
    this.log = this.loadLog();
  }

  private loadLog(): ConsolidationLog {
    try {
      if (fs.existsSync(LOG_PATH)) {
        return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
      }
    } catch {}
    return { runs: [], totalConsolidations: 0 };
  }

  private saveLog() {
    try {
      fs.writeFileSync(LOG_PATH, JSON.stringify(this.log, null, 2));
    } catch {}
  }

  /**
   * Start automatic periodic consolidation.
   */
  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.consolidate().catch(e => console.error('[Consolidator] Error:', e));
    }, CONSOLIDATION_INTERVAL_MS);
    console.log('[Consolidator] Started. Will consolidate every 30 minutes.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Run a full consolidation pass. Returns a summary string.
   */
  async consolidate(): Promise<string> {
    if (this.isRunning) return 'Consolidation already in progress.';
    this.isRunning = true;

    try {
      const all = vectorStore.all();
      if (all.length < MIN_CLUSTER_SIZE) {
        return `Too few memories to consolidate (${all.length}).`;
      }

      console.log(`[Consolidator] Starting pass over ${all.length} memories...`);

      // Build similarity clusters
      const visited = new Set<string>();
      const clusters: MemoryRecord[][] = [];

      for (const record of all) {
        if (visited.has(record.id)) continue;
        if (record.metadata.source === 'system' && record.metadata.topic === 'consolidated') continue;

        const cluster: MemoryRecord[] = [record];
        visited.add(record.id);

        for (const other of all) {
          if (visited.has(other.id)) continue;
          if (other.metadata.source === 'system' && other.metadata.topic === 'consolidated') continue;

          // Check embedding similarity
          if (record.embedding.length > 0 && other.embedding.length > 0) {
            const sim = cosineSimilarity(record.embedding, other.embedding);
            if (sim >= SIMILARITY_THRESHOLD) {
              cluster.push(other);
              visited.add(other.id);
            }
          }
        }

        if (cluster.length >= MIN_CLUSTER_SIZE) {
          clusters.push(cluster);
        }
      }

      if (clusters.length === 0) {
        return `No clusters found above threshold ${SIMILARITY_THRESHOLD}. Memory is already diverse.`;
      }

      let mergedCount = 0;
      let summaryCount = 0;

      for (const cluster of clusters) {
        // Sort by importance × accessCount
        cluster.sort((a, b) =>
          b.importance * Math.log1p(b.accessCount) - a.importance * Math.log1p(a.accessCount)
        );

        // Build a synthesis prompt from the cluster (we'll do a simple concatenation + LLM summarization)
        const contents = cluster.map(r => r.content.substring(0, 200));
        const synthesized = await this.synthesizeCluster(contents);
        if (!synthesized) continue;

        // Store the synthesis as a high-importance memory
        const synthEmb = await generateEmbedding(synthesized);
        const avgImportance = cluster.reduce((s, r) => s + r.importance, 0) / cluster.length;

        vectorStore.upsert({
          content: synthesized,
          embedding: synthEmb,
          dim: synthEmb.length,
          importance: Math.min(2.0, avgImportance * 1.3 + 0.2),
          metadata: {
            source: 'system',
            topic: 'consolidated',
            tags: ['synthesis', 'consolidated'],
          },
        });
        summaryCount++;

        // Reduce importance of originals (they're captured in the synthesis)
        for (const r of cluster) {
          vectorStore.reduceImportance(r.id, 0.3);
        }
        mergedCount += cluster.length;
      }

      const runLog = {
        timestamp: Date.now(),
        clustersFound: clusters.length,
        memoriesMerged: mergedCount,
        summariesCreated: summaryCount,
      };
      this.log.runs.unshift(runLog);
      this.log.runs = this.log.runs.slice(0, 50); // keep last 50
      this.log.totalConsolidations++;
      this.saveLog();

      const msg = `Consolidation complete: ${clusters.length} clusters, ${mergedCount} memories merged into ${summaryCount} summaries.`;
      console.log(`[Consolidator] ${msg}`);
      return msg;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Synthesize a cluster of memory contents into a single coherent summary.
   * Uses simple extractive summarization — picks key sentences.
   */
  private async synthesizeCluster(contents: string[]): Promise<string | null> {
    try {
      // Score sentences by unique information content
      const sentences = contents
        .flatMap(c => c.split(/[.!?]+/).map(s => s.trim()))
        .filter(s => s.length > 20);

      if (sentences.length === 0) return null;

      // Deduplicate near-identical sentences
      const unique: string[] = [];
      for (const s of sentences) {
        const isDup = unique.some(u => {
          const overlap = this.jaccardSimilarity(s, u);
          return overlap > 0.6;
        });
        if (!isDup) unique.push(s);
        if (unique.length >= 5) break;
      }

      const summary = `[Consolidated memory] ${unique.join('. ')}.`;
      return summary.substring(0, 500);
    } catch {
      return null;
    }
  }

  /**
   * Simple Jaccard similarity between two strings (word-level).
   */
  private jaccardSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  getStats(): string {
    const { totalConsolidations, runs } = this.log;
    if (runs.length === 0) return 'No consolidations run yet.';
    const last = runs[0];
    return JSON.stringify({
      totalConsolidations,
      lastRun: new Date(last.timestamp).toISOString(),
      lastClusters: last.clustersFound,
      lastMerged: last.memoriesMerged,
      lastSummaries: last.summariesCreated,
    }, null, 2);
  }
}

export const memoryConsolidator = new MemoryConsolidator();

// Auto-start on import (server-side only)
if (typeof setInterval !== 'undefined') {
  memoryConsolidator.start();
}

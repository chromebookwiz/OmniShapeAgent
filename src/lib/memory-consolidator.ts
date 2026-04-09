// src/lib/memory-consolidator.ts
// Periodically synthesizes clusters of similar memories into consolidated summaries.
// Reduces redundancy, raises importance of recurring themes, keeps the store lean.

import fs from 'fs';
import { vectorStore, MemoryRecord } from './vector-store';
import { cosineSimilarity, generateEmbedding } from './embeddings';
import { compareMemoryGeometry } from './memory-geometry';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
const LOG_PATH = PATHS.consolidationLog;
const SIMILARITY_THRESHOLD = 0.82;  // Memories this similar are candidates for merging
const GEOMETRY_THRESHOLD = 0.84;
const MIN_CLUSTER_SIZE = 3;         // Only consolidate clusters of at least 3 memories
const CONSOLIDATION_INTERVAL_MS = 30 * 60 * 1000; // Every 30 minutes

ensureWorkspacePaths();

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

  private memorySimilarity(left: MemoryRecord, right: MemoryRecord) {
    const geometry = compareMemoryGeometry(left.geometry, right.geometry);
    const embedding = left.embedding.length > 0 && left.embedding.length === right.embedding.length
      ? cosineSimilarity(left.embedding, right.embedding)
      : 0;
    const rightTags = new Set(right.metadata.tags ?? []);
    const sharedTags = (left.metadata.tags ?? []).filter((tag) => rightTags.has(tag)).length;
    return {
      geometry: geometry.score,
      embedding,
      score: Math.max(geometry.score, embedding),
      repeatedShape: geometry.repeatedShape,
      topologicalSynonym: geometry.topologicalSynonym,
      sharedTags,
    };
  }

  private shouldCluster(left: MemoryRecord, right: MemoryRecord): boolean {
    const similarity = this.memorySimilarity(left, right);
    return similarity.repeatedShape
      || similarity.topologicalSynonym
      || similarity.geometry >= GEOMETRY_THRESHOLD
      || similarity.embedding >= SIMILARITY_THRESHOLD
      || (similarity.score >= 0.74 && similarity.sharedTags >= 2);
  }

  private clusterTags(cluster: MemoryRecord[]): string[] {
    const counts = new Map<string, number>();
    for (const record of cluster) {
      for (const tag of record.metadata.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag);
  }

  private clusterGeometrySummary(cluster: MemoryRecord[]) {
    const shapeKeys = Array.from(new Set(cluster.map((record) => record.geometry?.shapeKey).filter((value): value is string => Boolean(value)))).slice(0, 3);
    const scripts = Array.from(new Set(cluster.map((record) => record.geometry?.script).filter((value): value is string => Boolean(value)))).slice(0, 3);
    const audits = Array.from(new Set(cluster.map((record) => record.geometry?.auditLabel).filter((value): value is NonNullable<MemoryRecord['geometry']>['auditLabel'] => value !== undefined))).slice(0, 3);
    return { shapeKeys, scripts, audits };
  }

  private clusterLayer(cluster: MemoryRecord[]): 'semantic' | 'procedural' {
    const tagCounts = new Map<string, number>();
    let proceduralVotes = 0;
    for (const record of cluster) {
      for (const tag of record.metadata.tags ?? []) {
        const normalized = tag.toLowerCase();
        tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
      }
      if ((record.metadata.cognitiveLayer ?? 'semantic') === 'procedural') proceduralVotes++;
    }
    const proceduralSignals = ['strategy', 'procedure', 'workflow', 'playbook', 'howto']
      .reduce((sum, tag) => sum + (tagCounts.get(tag) ?? 0), 0);
    return proceduralVotes >= Math.ceil(cluster.length / 2) || proceduralSignals >= 2 ? 'procedural' : 'semantic';
  }

  private clusterSupport(cluster: MemoryRecord[]): number {
    const aggregate = cluster.reduce((sum, record) => {
      const ackRatio = record.lifecycle.injectionCount > 0
        ? record.lifecycle.acknowledgedCount / record.lifecycle.injectionCount
        : 0.5;
      return sum + ackRatio + (record.consolidation?.support ?? 0.28);
    }, 0);
    return Math.min(1, aggregate / (cluster.length * 2));
  }

  private clusterVolatility(cluster: MemoryRecord[]): number {
    const aggregate = cluster.reduce((sum, record) => {
      const rejectionRatio = record.lifecycle.injectionCount > 0
        ? record.lifecycle.rejectedCount / record.lifecycle.injectionCount
        : 0;
      return sum + Math.max(record.consolidation?.volatility ?? 0.22, rejectionRatio);
    }, 0);
    return Math.min(1, aggregate / cluster.length);
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
      const maintenance = vectorStore.maintenancePass({ rebuildLattice: true });
      const all = vectorStore.all();
      if (all.length < MIN_CLUSTER_SIZE) {
        return `Too few memories to consolidate (${all.length}). Maintenance: pruned=${maintenance.prunedDecay}, forgotten=${maintenance.forgottenUnacknowledged}.`;
      }

      console.log(`[Consolidator] Starting pass over ${all.length} memories...`);

      // Build connected components using geometry-first similarity.
      const visited = new Set<string>();
      const clusters: MemoryRecord[][] = [];
      const candidates = all.filter((record) => !(record.metadata.source === 'system' && record.metadata.topic === 'consolidated-olr'));

      for (const record of candidates) {
        if (visited.has(record.id)) continue;

        const cluster: MemoryRecord[] = [];
        const queue: MemoryRecord[] = [record];
        visited.add(record.id);

        while (queue.length > 0) {
          const current = queue.shift()!;
          cluster.push(current);
          for (const other of candidates) {
            if (visited.has(other.id)) continue;
            if (this.shouldCluster(current, other)) {
              visited.add(other.id);
              queue.push(other);
            }
          }
        }

        if (cluster.length >= MIN_CLUSTER_SIZE) {
          clusters.push(cluster);
        }
      }

      if (clusters.length === 0) {
        return `No OLR clusters found above thresholds geometry=${GEOMETRY_THRESHOLD} embedding=${SIMILARITY_THRESHOLD}. Memory is already diverse.`;
      }

      let mergedCount = 0;
      let summaryCount = 0;

      for (const cluster of clusters) {
        // Sort by importance × accessCount
        cluster.sort((a, b) =>
          b.importance * Math.log1p(b.accessCount) - a.importance * Math.log1p(a.accessCount)
        );

        const synthesized = await this.synthesizeCluster(cluster);
        if (!synthesized) continue;

        const synthEmb = await generateEmbedding(synthesized);
        const avgImportance = cluster.reduce((sum, record) => sum + record.importance, 0) / cluster.length;
        const commonTags = this.clusterTags(cluster);

        vectorStore.upsert({
          content: synthesized,
          embedding: synthEmb,
          dim: synthEmb.length,
          importance: Math.min(2.0, avgImportance * 1.3 + 0.2),
          metadata: {
            source: 'system',
            topic: 'consolidated-olr',
            tags: Array.from(new Set(['synthesis', 'consolidated', 'olr', ...commonTags])).slice(0, 10),
            cognitiveLayer: this.clusterLayer(cluster),
            taskSalience: Math.min(1, 0.48 + this.clusterSupport(cluster) * 0.42),
          },
          consolidation: {
            level: Math.min(1, 0.58 + this.clusterSupport(cluster) * 0.3),
            support: this.clusterSupport(cluster),
            volatility: Math.max(0.05, this.clusterVolatility(cluster) * 0.6),
            abstraction: this.clusterLayer(cluster),
            timesConsolidated: 1,
            lastConsolidatedAt: Date.now(),
            sourceMemoryIds: cluster.map((record) => record.id).slice(0, 24),
          },
        });
        summaryCount++;

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

      const msg = `Consolidation complete: ${clusters.length} OLR clusters, ${mergedCount} memories merged into ${summaryCount} summaries. Maintenance pruned=${maintenance.prunedDecay}, forgotten=${maintenance.forgottenUnacknowledged}.`;
      console.log(`[Consolidator] ${msg}`);
      return msg;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Synthesize a cluster of memory contents into a single coherent summary.
   * Uses simple extractive summarization and preserves the OLR cluster identity.
   */
  private async synthesizeCluster(cluster: MemoryRecord[]): Promise<string | null> {
    try {
      const contents = cluster.map((record) => record.content.substring(0, 240));
      const geometry = this.clusterGeometrySummary(cluster);
      const tags = this.clusterTags(cluster);
      const sentences = contents
        .flatMap(c => c.split(/[.!?]+/).map(s => s.trim()))
        .filter(s => s.length > 20);

      if (sentences.length === 0) return null;

      const unique: string[] = [];
      for (const s of sentences) {
        const isDup = unique.some(u => {
          const overlap = this.jaccardSimilarity(s, u);
          return overlap > 0.6;
        });
        if (!isDup) unique.push(s);
        if (unique.length >= 5) break;
      }

      const headerParts = [
        '[Consolidated memory]',
        geometry.scripts.length > 0 ? `scripts=${geometry.scripts.join('/')}` : '',
        geometry.audits.length > 0 ? `audit=${geometry.audits.join('/')}` : '',
        geometry.shapeKeys.length > 0 ? `shape=${geometry.shapeKeys.join(',')}` : '',
        tags.length > 0 ? `tags=${tags.join(',')}` : '',
      ].filter(Boolean);

      const summary = `${headerParts.join(' ')} ${unique.join('. ')}.`;
      return summary.substring(0, 700);
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

declare global {
  // eslint-disable-next-line no-var
  var __shapeMemoryConsolidatorStarted: boolean | undefined;
}

// Auto-start on import (server-side only), but avoid repeated startup in the
// same process and skip during the production build pipeline.
if (typeof setInterval !== 'undefined' && process.env.npm_lifecycle_event !== 'build') {
  if (!globalThis.__shapeMemoryConsolidatorStarted) {
    memoryConsolidator.start();
    globalThis.__shapeMemoryConsolidatorStarted = true;
  }
}

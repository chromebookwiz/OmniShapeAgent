// src/lib/weight-store.ts
// Universal weight registry for all ML components in the ShapeAgent system.
// Tracks weights across bot PolicyNets, vision calibrations, voice models,
// meta-learner, and embedding models. Actual weight files live in weights/.

import fs from 'fs';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS, WEIGHTS_DIR } from './paths-core';

const REGISTRY_PATH = PATHS.weightsRegistry;

ensureWorkspacePaths();

export type WeightComponent = 'voice' | 'vision' | 'policy' | 'physics' | 'meta' | 'memory' | 'embedding';

export interface WeightEntry {
  id: string;
  component: WeightComponent;
  name: string;
  filepath: string;           // Relative to weights/ dir
  sizeBytes: number;
  performanceScore: number;   // 0–1, higher is better
  created: number;            // ms timestamp
  updated: number;            // ms timestamp
  iterations: number;         // Training iterations completed
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------

class WeightStore {
  private entries: Map<string, WeightEntry> = new Map();

  constructor() {
    this.ensureWeightsDir();
    this.load();
  }

  // ── Filesystem bootstrap ─────────────────────────────────────────────────

  private ensureWeightsDir() {
    if (!fs.existsSync(WEIGHTS_DIR)) {
      fs.mkdirSync(WEIGHTS_DIR, { recursive: true });
      console.log('[WeightStore] Created weights/ directory.');
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load() {
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        const raw: WeightEntry[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const e of raw) this.entries.set(e.id, e);
          console.log(`[WeightStore] Loaded ${this.entries.size} weight entries.`);
        }
      }
    } catch (err) {
      console.error('[WeightStore] Failed to load registry:', err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(
        REGISTRY_PATH,
        JSON.stringify(Array.from(this.entries.values()), null, 2)
      );
    } catch (err) {
      console.error('[WeightStore] Failed to save registry:', err);
    }
  }

  // ── Core API ─────────────────────────────────────────────────────────────

  /**
   * Register a new weight file in the registry.
   * Returns the generated entry id.
   */
  register(
    component: WeightComponent,
    name: string,
    filepath: string,
    sizeBytes: number,
    performanceScore: number,
    iterations: number = 0,
    metadata: Record<string, unknown> = {}
  ): WeightEntry {
    const id = `wt_${component}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const entry: WeightEntry = {
      id,
      component,
      name,
      filepath,
      sizeBytes,
      performanceScore: Math.max(0, Math.min(1, performanceScore)),
      created: now,
      updated: now,
      iterations,
      metadata,
    };
    this.entries.set(id, entry);
    this.save();
    console.log(`[WeightStore] Registered ${component}/${name} (id=${id})`);
    return entry;
  }

  /**
   * Update performance score and iteration count for an existing entry.
   */
  update(
    id: string,
    performanceScore: number,
    iterations?: number,
    metadata?: Record<string, unknown>
  ): WeightEntry | null {
    const entry = this.entries.get(id);
    if (!entry) {
      console.warn(`[WeightStore] update() — entry not found: ${id}`);
      return null;
    }
    entry.performanceScore = Math.max(0, Math.min(1, performanceScore));
    entry.updated = Date.now();
    if (iterations !== undefined) entry.iterations = iterations;
    if (metadata) entry.metadata = { ...entry.metadata, ...metadata };
    this.save();
    return entry;
  }

  get(id: string): WeightEntry | undefined {
    return this.entries.get(id);
  }

  list(): WeightEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.updated - a.updated);
  }

  listByComponent(component: WeightComponent): WeightEntry[] {
    return this.list().filter(e => e.component === component);
  }

  /**
   * Returns the highest-scoring weight entry for a given component.
   */
  getBest(component: WeightComponent): WeightEntry | undefined {
    const entries = this.listByComponent(component);
    if (entries.length === 0) return undefined;
    return entries.reduce((best, e) => e.performanceScore > best.performanceScore ? e : best, entries[0]);
  }

  delete(id: string): boolean {
    if (!this.entries.has(id)) return false;
    this.entries.delete(id);
    this.save();
    console.log(`[WeightStore] Deleted entry ${id}`);
    return true;
  }

  // ── Manifest ─────────────────────────────────────────────────────────────

  exportManifest(): string {
    const byComponent: Record<string, WeightEntry[]> = {};
    for (const entry of this.entries.values()) {
      if (!byComponent[entry.component]) byComponent[entry.component] = [];
      byComponent[entry.component].push(entry);
    }

    // Sort each component's entries by score descending
    for (const comp of Object.keys(byComponent)) {
      byComponent[comp].sort((a, b) => b.performanceScore - a.performanceScore);
    }

    const manifest = {
      generated: new Date().toISOString(),
      totalEntries: this.entries.size,
      totalSizeBytes: this.totalSize(),
      weightsDir: WEIGHTS_DIR,
      byComponent,
    };
    return JSON.stringify(manifest, null, 2);
  }

  importManifest(manifestJson: string): number {
    let imported = 0;
    try {
      const manifest = JSON.parse(manifestJson);
      const allEntries: WeightEntry[] = [];
      if (manifest.byComponent) {
        for (const entries of Object.values(manifest.byComponent) as WeightEntry[][]) {
          allEntries.push(...entries);
        }
      } else if (Array.isArray(manifest)) {
        allEntries.push(...manifest);
      }
      for (const e of allEntries) {
        if (e.id && e.component && e.name) {
          this.entries.set(e.id, e);
          imported++;
        }
      }
      if (imported > 0) this.save();
      console.log(`[WeightStore] Imported ${imported} entries from manifest.`);
    } catch (err) {
      console.error('[WeightStore] importManifest() failed:', err);
    }
    return imported;
  }

  totalSize(): number {
    let total = 0;
    for (const e of this.entries.values()) total += e.sizeBytes;
    return total;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Remove lowest-scoring weight entries beyond keepTop per component.
   * Only deletes registry entries; physical files are left to the caller.
   * Returns number of entries removed.
   */
  cleanup(keepTop: number = 5): number {
    const components = new Set<WeightComponent>(
      Array.from(this.entries.values()).map(e => e.component)
    );
    let removed = 0;

    for (const component of components) {
      const sorted = this.listByComponent(component)
        .sort((a, b) => b.performanceScore - a.performanceScore);

      if (sorted.length <= keepTop) continue;

      const toRemove = sorted.slice(keepTop);
      for (const entry of toRemove) {
        this.entries.delete(entry.id);
        removed++;
        console.log(`[WeightStore] Cleanup removed ${entry.component}/${entry.name} (score=${entry.performanceScore.toFixed(3)})`);
      }
    }

    if (removed > 0) this.save();
    console.log(`[WeightStore] Cleanup complete — removed ${removed} entries.`);
    return removed;
  }
}

// ---------------------------------------------------------------------------

export const weightStore = new WeightStore();

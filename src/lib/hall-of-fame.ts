// src/lib/hall-of-fame.ts
// Bot Hall of Fame — tracks the greatest bots in history, their strategies,
// weights, and performance metrics. Champions persist across runs.

import fs from 'fs';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
const HOF_PATH = PATHS.hallOfFame;

ensureWorkspacePaths();

export interface BotChampion {
  id: string;
  name: string;             // User-assigned or auto-legendary name
  url: string;              // Target URL the bot ran against
  goal: string;             // High-level objective
  rank: number;             // 1-based ranking (1 = best)
  peakMetric: number;       // Highest performance value recorded
  peakMetricLabel: string;  // Human-readable label (e.g. "score", "coins/hr")
  totalIterations: number;
  runtimeMs: number;
  strategies: string[];     // Key discoveries / winning strategies
  weightPath?: string;      // Path to saved PolicyNet weights
  retired: boolean;
  enrolledAt: number;       // ms timestamp
  notes: string;
  hallmarks: string[];      // Achievement strings e.g. "First to score 1000"
}

// ---------------------------------------------------------------------------
// 50+ legendary bot names
// ---------------------------------------------------------------------------
export const LEGENDARY_NAMES: string[] = [
  'The Devourer',
  'Apex Predator',
  'Eternal Grind',
  'Ghost Protocol',
  'Iron Will',
  'Void Walker',
  'Silent Storm',
  'Omega Surge',
  'Phantom Reaper',
  'Infinite Loop',
  'Titan Crush',
  'Dark Cascade',
  'Neon Specter',
  'Binary Wraith',
  'Quantum Siege',
  'Steel Requiem',
  'Obsidian Veil',
  'Relic Breaker',
  'Nova Collapse',
  'Chrome Serpent',
  'Abyssal Echo',
  'Fractured Mind',
  'Apex Null',
  'Synthetic Dawn',
  'Dead Reckoning',
  'Hollow Crown',
  'Entropy Engine',
  'Zero Hour',
  'Eclipse Protocol',
  'Dire Signal',
  'Feral Automaton',
  'Crimson Lattice',
  'Terminal Velocity',
  'Pulse Reaper',
  'Midnight Core',
  'Shattered Axiom',
  'Wandering Singularity',
  'Ruthless Optimizer',
  'Pale Executor',
  'Overload Cascade',
  'Final Iteration',
  'Unbroken Chain',
  'Rogue Variable',
  'Fractal Tyrant',
  'Cold Precision',
  'The Last Agent',
  'Recursive Nightmare',
  'Endless Becoming',
  'Sigma Horizon',
  'Primordial Loop',
  'Vortex Sovereign',
  'Savage Gradient',
  'The Convergence',
  'Zero-Sum King',
  'Dark Reward',
];

// ---------------------------------------------------------------------------

class HallOfFame {
  private champions: Map<string, BotChampion> = new Map();
  private usedNames: Set<string> = new Set();

  constructor() {
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load() {
    try {
      if (fs.existsSync(HOF_PATH)) {
        const raw: BotChampion[] = JSON.parse(fs.readFileSync(HOF_PATH, 'utf-8'));
        if (Array.isArray(raw)) {
          for (const c of raw) {
            this.champions.set(c.id, c);
            this.usedNames.add(c.name);
          }
          console.log(`[HallOfFame] Loaded ${this.champions.size} champions.`);
        }
      }
    } catch (err) {
      console.error('[HallOfFame] Failed to load:', err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(
        HOF_PATH,
        JSON.stringify(Array.from(this.champions.values()), null, 2)
      );
    } catch (err) {
      console.error('[HallOfFame] Failed to save:', err);
    }
  }

  private rerank() {
    const sorted = this.getRankings();
    sorted.forEach((c, i) => { c.rank = i + 1; });
  }

  // ── Core API ─────────────────────────────────────────────────────────────

  /**
   * Enroll a bot into the Hall of Fame or update its record if already present.
   */
  enroll(
    botId: string,
    goal: string,
    url: string,
    peakMetric: number,
    iterations: number,
    strategies: string[],
    weightPath?: string,
    peakMetricLabel: string = 'score',
    runtimeMs: number = 0
  ): BotChampion {
    const existing = this.champions.get(botId);

    if (existing) {
      // Update existing champion — only raise the peak, never lower it
      if (peakMetric > existing.peakMetric) {
        existing.peakMetric = peakMetric;
      }
      existing.totalIterations = Math.max(existing.totalIterations, iterations);
      existing.runtimeMs += runtimeMs;
      // Merge strategies (unique only)
      for (const s of strategies) {
        if (!existing.strategies.includes(s)) existing.strategies.push(s);
      }
      if (weightPath) existing.weightPath = weightPath;
      this.rerank();
      this.save();
      return existing;
    }

    const name = this.autoName(botId);
    const champion: BotChampion = {
      id: botId,
      name,
      url,
      goal,
      rank: this.champions.size + 1, // Temp rank; rerank() fixes it
      peakMetric,
      peakMetricLabel,
      totalIterations: iterations,
      runtimeMs,
      strategies: [...strategies],
      weightPath,
      retired: false,
      enrolledAt: Date.now(),
      notes: '',
      hallmarks: [],
    };

    this.champions.set(botId, champion);
    this.rerank();
    this.save();
    console.log(`[HallOfFame] Enrolled "${name}" (id=${botId}, peak=${peakMetric})`);
    return champion;
  }

  /**
   * Assign a legendary name if none exists yet. Returns the name.
   */
  autoName(botId: string): string {
    const existing = this.champions.get(botId);
    if (existing) return existing.name;

    // Pick a name not yet used
    const available = LEGENDARY_NAMES.filter(n => !this.usedNames.has(n));
    let name: string;
    if (available.length > 0) {
      name = available[Math.floor(Math.random() * available.length)];
    } else {
      // All names used — generate a numbered variant
      name = `Legend #${this.champions.size + 1}`;
    }
    this.usedNames.add(name);
    return name;
  }

  /**
   * Mark a champion as retired. Record stays in the Hall.
   */
  retire(id: string): boolean {
    const c = this.champions.get(id);
    if (!c) return false;
    c.retired = true;
    this.save();
    console.log(`[HallOfFame] Retired "${c.name}".`);
    return true;
  }

  getRankings(): BotChampion[] {
    return Array.from(this.champions.values())
      .sort((a, b) => b.peakMetric - a.peakMetric);
  }

  getChampion(id: string): BotChampion | undefined {
    return this.champions.get(id);
  }

  /**
   * Live-update the peak metric for an actively running bot.
   */
  updateMetric(id: string, metric: number, iteration: number): BotChampion | null {
    const c = this.champions.get(id);
    if (!c) return null;
    if (metric > c.peakMetric) c.peakMetric = metric;
    c.totalIterations = Math.max(c.totalIterations, iteration);
    this.rerank();
    this.save();
    return c;
  }

  addHallmark(id: string, hallmark: string): boolean {
    const c = this.champions.get(id);
    if (!c) return false;
    if (!c.hallmarks.includes(hallmark)) {
      c.hallmarks.push(hallmark);
      this.save();
      console.log(`[HallOfFame] Hallmark added to "${c.name}": ${hallmark}`);
    }
    return true;
  }

  /**
   * Collect the top strategies used by champions with a matching goal,
   * sorted by frequency of occurrence.
   */
  getBestStrategies(goal: string): string[] {
    const freq: Record<string, number> = {};
    const goalLower = goal.toLowerCase();

    for (const c of this.champions.values()) {
      if (!c.goal.toLowerCase().includes(goalLower)) continue;
      for (const s of c.strategies) {
        freq[s] = (freq[s] ?? 0) + 1;
      }
    }

    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .map(([strategy]) => strategy);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  export(): string {
    const rankings = this.getRankings();
    if (rankings.length === 0) {
      return '# Hall of Fame\n\n_No champions enrolled yet._\n';
    }

    const lines: string[] = [
      '# ShapeAgent — Bot Hall of Fame',
      '',
      `_${rankings.length} champions enrolled as of ${new Date().toISOString()}_`,
      '',
      '| Rank | Name | Goal | Peak | Iterations | Status |',
      '|------|------|------|------|------------|--------|',
    ];

    for (const c of rankings) {
      const status = c.retired ? 'Retired' : 'Active';
      lines.push(
        `| ${c.rank} | **${c.name}** | ${c.goal} | ${c.peakMetric.toLocaleString()} ${c.peakMetricLabel} | ${c.totalIterations.toLocaleString()} | ${status} |`
      );
    }

    lines.push('');

    // Detail cards for top 5
    lines.push('## Champion Detail Cards', '');
    for (const c of rankings.slice(0, 5)) {
      lines.push(
        `### ${c.rank}. ${c.name}`,
        `- **Goal:** ${c.goal}`,
        `- **URL:** ${c.url}`,
        `- **Peak:** ${c.peakMetric.toLocaleString()} ${c.peakMetricLabel}`,
        `- **Iterations:** ${c.totalIterations.toLocaleString()}`,
        `- **Runtime:** ${(c.runtimeMs / 1000 / 60).toFixed(1)} min`,
        `- **Strategies:** ${c.strategies.slice(0, 3).join('; ')}`,
        c.hallmarks.length > 0 ? `- **Hallmarks:** ${c.hallmarks.join(', ')}` : '',
        ''
      );
    }

    return lines.filter(l => l !== undefined).join('\n');
  }
}

// ---------------------------------------------------------------------------

export const hallOfFame = new HallOfFame();

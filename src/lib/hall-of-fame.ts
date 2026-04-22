// src/lib/hall-of-fame.ts
// Arena Hall of Fame — tracks the strongest arena bots, their embedded designs,
// weights, and combat performance. Champions persist across runs.

import fs from 'fs';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';

const HOF_PATH = PATHS.hallOfFame;

ensureWorkspacePaths();

export interface ArenaBotDesignSnapshot {
  blueprintId?: string;
  blueprintName?: string;
  templates?: Array<Record<string, unknown>>;
  parts?: Array<Record<string, unknown>>;
  hinges?: Array<Record<string, unknown>>;
  bodyPlan?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
  notes?: string;
  partCount: number;
  hingeCount: number;
}

export interface BotChampion {
  id: string;
  kind: 'arena' | 'legacy-web';
  name: string;
  url: string;
  goal: string;
  rank: number;
  peakMetric: number;
  peakMetricLabel: string;
  totalIterations: number;
  runtimeMs: number;
  strategies: string[];
  weightPath?: string;
  retired: boolean;
  enrolledAt: number;
  notes: string;
  hallmarks: string[];
  design?: ArenaBotDesignSnapshot;
}

function normalizeDesign(input?: Partial<ArenaBotDesignSnapshot>): ArenaBotDesignSnapshot | undefined {
  if (!input) return undefined;
  const partCount = Number(
    input.partCount
      ?? (Array.isArray(input.parts) ? input.parts.length : Array.isArray(input.bodyPlan) ? input.bodyPlan.length : 0),
  );
  const hingeCount = Number(input.hingeCount ?? (Array.isArray(input.hinges) ? input.hinges.length : 0));
  return {
    blueprintId: input.blueprintId,
    blueprintName: input.blueprintName,
    templates: Array.isArray(input.templates) ? input.templates : undefined,
    parts: Array.isArray(input.parts) ? input.parts : undefined,
    hinges: Array.isArray(input.hinges) ? input.hinges : undefined,
    bodyPlan: Array.isArray(input.bodyPlan) ? input.bodyPlan : undefined,
    settings: input.settings && typeof input.settings === 'object' ? input.settings : undefined,
    notes: typeof input.notes === 'string' ? input.notes : undefined,
    partCount,
    hingeCount,
  };
}

function normalizeChampion(input: Partial<BotChampion> & Pick<BotChampion, 'id'>): BotChampion {
  const design = normalizeDesign(input.design);
  return {
    id: input.id,
    kind: input.kind ?? (design ? 'arena' : 'legacy-web'),
    name: input.name ?? input.id,
    url: input.url ?? (design ? 'arena://physics-studio' : ''),
    goal: input.goal ?? 'Arena combat champion',
    rank: Number(input.rank ?? 0),
    peakMetric: Number(input.peakMetric ?? 0),
    peakMetricLabel: input.peakMetricLabel ?? 'score',
    totalIterations: Number(input.totalIterations ?? 0),
    runtimeMs: Number(input.runtimeMs ?? 0),
    strategies: Array.isArray(input.strategies) ? input.strategies.map(String) : [],
    weightPath: typeof input.weightPath === 'string' ? input.weightPath : undefined,
    retired: Boolean(input.retired),
    enrolledAt: Number(input.enrolledAt ?? Date.now()),
    notes: typeof input.notes === 'string' ? input.notes : '',
    hallmarks: Array.isArray(input.hallmarks) ? input.hallmarks.map(String) : [],
    design,
  };
}

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

class HallOfFame {
  private champions: Map<string, BotChampion> = new Map();
  private usedNames: Set<string> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(HOF_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(HOF_PATH, 'utf-8')) as Array<Partial<BotChampion> & Pick<BotChampion, 'id'>>;
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        const champion = normalizeChampion(entry);
        this.champions.set(champion.id, champion);
        this.usedNames.add(champion.name);
      }
      console.log(`[HallOfFame] Loaded ${this.champions.size} champions.`);
    } catch (err) {
      console.error('[HallOfFame] Failed to load:', err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(HOF_PATH, JSON.stringify(Array.from(this.champions.values()), null, 2));
    } catch (err) {
      console.error('[HallOfFame] Failed to save:', err);
    }
  }

  private rerank() {
    const sorted = this.getRankings();
    sorted.forEach((champion, index) => {
      champion.rank = index + 1;
    });
  }

  enroll(
    botId: string,
    goal: string,
    url: string,
    peakMetric: number,
    iterations: number,
    strategies: string[],
    weightPath?: string,
    peakMetricLabel: string = 'score',
    runtimeMs: number = 0,
    options?: {
      kind?: 'arena' | 'legacy-web';
      design?: Partial<ArenaBotDesignSnapshot>;
      notes?: string;
    },
  ): BotChampion {
    const existing = this.champions.get(botId);
    if (existing) {
      if (peakMetric > existing.peakMetric) existing.peakMetric = peakMetric;
      existing.totalIterations = Math.max(existing.totalIterations, iterations);
      existing.runtimeMs += runtimeMs;
      existing.goal = goal;
      existing.url = url;
      existing.peakMetricLabel = peakMetricLabel;
      existing.kind = options?.kind ?? existing.kind;
      existing.design = normalizeDesign(options?.design) ?? existing.design;
      if (typeof options?.notes === 'string') existing.notes = options.notes;
      for (const strategy of strategies) {
        if (!existing.strategies.includes(strategy)) existing.strategies.push(strategy);
      }
      if (weightPath) existing.weightPath = weightPath;
      this.rerank();
      this.save();
      return existing;
    }

    const name = this.autoName(botId);
    const champion: BotChampion = {
      id: botId,
      kind: options?.kind ?? ((options?.design || url === 'arena://physics-studio') ? 'arena' : 'legacy-web'),
      name,
      url,
      goal,
      rank: this.champions.size + 1,
      peakMetric,
      peakMetricLabel,
      totalIterations: iterations,
      runtimeMs,
      strategies: [...strategies],
      weightPath,
      retired: false,
      enrolledAt: Date.now(),
      notes: options?.notes ?? '',
      hallmarks: [],
      design: normalizeDesign(options?.design),
    };

    this.champions.set(botId, champion);
    this.rerank();
    this.save();
    console.log(`[HallOfFame] Enrolled "${name}" (id=${botId}, peak=${peakMetric})`);
    return champion;
  }

  autoName(botId: string): string {
    const existing = this.champions.get(botId);
    if (existing) return existing.name;
    const available = LEGENDARY_NAMES.filter((name) => !this.usedNames.has(name));
    const name = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : `Legend #${this.champions.size + 1}`;
    this.usedNames.add(name);
    return name;
  }

  retire(id: string): boolean {
    const champion = this.champions.get(id);
    if (!champion) return false;
    champion.retired = true;
    this.save();
    console.log(`[HallOfFame] Retired "${champion.name}".`);
    return true;
  }

  getRankings(): BotChampion[] {
    return Array.from(this.champions.values())
      .filter((champion) => champion.kind === 'arena')
      .sort((left, right) => right.peakMetric - left.peakMetric);
  }

  getChampion(id: string): BotChampion | undefined {
    return this.champions.get(id);
  }

  updateMetric(id: string, metric: number, iteration: number): BotChampion | null {
    const champion = this.champions.get(id);
    if (!champion) return null;
    if (metric > champion.peakMetric) champion.peakMetric = metric;
    champion.totalIterations = Math.max(champion.totalIterations, iteration);
    this.rerank();
    this.save();
    return champion;
  }

  addHallmark(id: string, hallmark: string): boolean {
    const champion = this.champions.get(id);
    if (!champion) return false;
    if (!champion.hallmarks.includes(hallmark)) {
      champion.hallmarks.push(hallmark);
      this.save();
      console.log(`[HallOfFame] Hallmark added to "${champion.name}": ${hallmark}`);
    }
    return true;
  }

  getBestStrategies(goal: string): string[] {
    const frequency: Record<string, number> = {};
    const goalLower = goal.toLowerCase();
    for (const champion of this.getRankings()) {
      if (!champion.goal.toLowerCase().includes(goalLower)) continue;
      for (const strategy of champion.strategies) {
        frequency[strategy] = (frequency[strategy] ?? 0) + 1;
      }
    }
    return Object.entries(frequency)
      .sort(([, left], [, right]) => right - left)
      .map(([strategy]) => strategy);
  }

  export(): string {
    const rankings = this.getRankings();
    if (rankings.length === 0) {
      return '# Arena Hall of Fame\n\n_No arena champions enrolled yet._\n';
    }

    const lines: string[] = [
      '# ShapeAgent — Arena Bot Hall of Fame',
      '',
      `_${rankings.length} champions enrolled as of ${new Date().toISOString()}_`,
      '',
      '| Rank | Name | Goal | Peak | Iterations | Design | Status |',
      '|------|------|------|------|------------|--------|--------|',
    ];

    for (const champion of rankings) {
      const designSummary = champion.design ? `${champion.design.partCount} parts / ${champion.design.hingeCount} hinges` : 'No design';
      const status = champion.retired ? 'Retired' : 'Active';
      lines.push(`| ${champion.rank} | **${champion.name}** | ${champion.goal} | ${champion.peakMetric.toLocaleString()} ${champion.peakMetricLabel} | ${champion.totalIterations.toLocaleString()} | ${designSummary} | ${status} |`);
    }

    lines.push('', '## Champion Detail Cards', '');
    for (const champion of rankings.slice(0, 5)) {
      lines.push(
        `### ${champion.rank}. ${champion.name}`,
        `- **Goal:** ${champion.goal}`,
        `- **Arena:** ${champion.url}`,
        `- **Peak:** ${champion.peakMetric.toLocaleString()} ${champion.peakMetricLabel}`,
        `- **Iterations:** ${champion.totalIterations.toLocaleString()}`,
        `- **Runtime:** ${(champion.runtimeMs / 1000 / 60).toFixed(1)} min`,
        champion.design ? `- **Design:** ${champion.design.blueprintName ?? champion.design.blueprintId ?? champion.id} (${champion.design.partCount} parts, ${champion.design.hingeCount} hinges)` : '',
        `- **Strategies:** ${champion.strategies.slice(0, 3).join('; ')}`,
        champion.hallmarks.length > 0 ? `- **Hallmarks:** ${champion.hallmarks.join(', ')}` : '',
        '',
      );
    }

    return lines.filter(Boolean).join('\n');
  }
}

export const hallOfFame = new HallOfFame();

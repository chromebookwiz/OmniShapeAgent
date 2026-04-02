// src/lib/meta-learner.ts
// System-wide learning aggregator. Observes all tool calls and outcomes,
// builds effectiveness models, and produces prompt adjustments.

import fs from 'fs';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
const META_PATH = PATHS.metaLearner;

ensureWorkspacePaths();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  toolName: string;
  args: Partial<Record<string, unknown>>;
  success: boolean;
  durationMs: number;
  outputQuality: number;    // 0–1, inferred from retry/continuation pattern
  context: string;          // From conversation topic
  timestamp: number;
}

export interface StrategyRecord {
  sequence: string[];       // Ordered list of tool names
  outcome: 'positive' | 'neutral' | 'negative';
  goal: string;
  frequency: number;
  avgQuality: number;
  wins: number;             // Cumulative quality score (for Beta posterior)
  isSubsequence?: boolean;  // True if inferred from a longer sequence (lattice propagation)
}

interface SessionRecord {
  topic: string;
  toolsUsed: string[];
  outcome: string;
  timestamp: number;
}

interface ToolStats {
  calls: number;
  successes: number;
  totalQuality: number;
  totalDurationMs: number;
  contexts: string[];
}

interface MetaData {
  toolCalls: ToolCallRecord[];
  strategies: StrategyRecord[];
  sessions: SessionRecord[];
}

// ---------------------------------------------------------------------------

class MetaLearner {
  private toolCalls: ToolCallRecord[] = [];
  private strategies: StrategyRecord[] = [];
  private sessions: SessionRecord[] = [];
  private dirty = false;

  // Rolling window to build sequences
  private recentTools: { name: string; context: string; timestamp: number }[] = [];
  private readonly SEQUENCE_WINDOW_MS = 60_000; // 1 minute
  private readonly MAX_TOOL_CALLS = 5000;
  private readonly MAX_SESSIONS = 500;

  constructor() {
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load() {
    try {
      if (fs.existsSync(META_PATH)) {
        const raw: MetaData = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
        this.toolCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls : [];
        this.strategies = Array.isArray(raw.strategies) ? raw.strategies : [];
        this.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
        console.log(
          `[MetaLearner] Loaded ${this.toolCalls.length} tool calls, ` +
          `${this.strategies.length} strategies, ${this.sessions.length} sessions.`
        );
      }
    } catch (err) {
      console.error('[MetaLearner] Failed to load:', err);
    }
  }

  private save() {
    try {
      const data: MetaData = {
        toolCalls: this.toolCalls,
        strategies: this.strategies,
        sessions: this.sessions,
      };
      fs.writeFileSync(META_PATH, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.error('[MetaLearner] Failed to save:', err);
    }
  }

  private debouncedSave() {
    this.dirty = true;
    // Lazy save — call explicitly or let periodic flush handle it
  }

  flush() {
    if (this.dirty) this.save();
  }

  // ── Tool Call Recording ───────────────────────────────────────────────────

  recordToolCall(record: ToolCallRecord): void {
    this.toolCalls.push(record);

    // Trim rolling window of recent tools for sequence detection
    const cutoff = Date.now() - this.SEQUENCE_WINDOW_MS;
    this.recentTools = this.recentTools.filter(t => t.timestamp >= cutoff);
    this.recentTools.push({
      name: record.toolName,
      context: record.context,
      timestamp: record.timestamp,
    });

    // If we've accumulated 3+ tools in the window, record the sequence
    if (this.recentTools.length >= 3) {
      const seq = this.recentTools.map(t => t.name);
      const outcome: StrategyRecord['outcome'] =
        record.outputQuality >= 0.7 ? 'positive'
        : record.outputQuality >= 0.4 ? 'neutral'
        : 'negative';
      this.recordStrategy(seq, outcome, record.context, record.outputQuality);
    }

    // Cap array sizes to avoid unbounded growth
    if (this.toolCalls.length > this.MAX_TOOL_CALLS) {
      this.toolCalls = this.toolCalls.slice(-this.MAX_TOOL_CALLS);
    }

    this.debouncedSave();

    // Save every 50 new records
    if (this.toolCalls.length % 50 === 0) this.save();
  }

  private recordStrategy(
    sequence: string[],
    outcome: StrategyRecord['outcome'],
    goal: string,
    quality: number,
    isSubsequence = false
  ): void {
    const key = sequence.join('→');
    const existing = this.strategies.find(s => s.sequence.join('→') === key && s.goal === goal);
    if (existing) {
      existing.frequency++;
      existing.wins = (existing.wins ?? 0) + quality;
      // Bayesian (Laplace-smoothed) posterior mean: (wins + 1) / (N + 2)
      existing.avgQuality = (existing.wins + 1) / (existing.frequency + 2);
      if (outcome === 'positive') existing.outcome = 'positive';
      else if (outcome === 'negative' && existing.outcome !== 'positive') existing.outcome = 'negative';
    } else {
      this.strategies.push({
        sequence, outcome, goal, frequency: 1,
        wins: quality, avgQuality: (quality + 1) / 3, // Bayesian prior: Beta(1,1)
        isSubsequence,
      });
    }

    // ── Subsequence lattice propagation ────────────────────────────────────
    // If this full sequence is high quality, propagate evidence to all
    // non-adjacent 2-hop subsequences (partial order: subsequences are
    // lower elements in the sequence lattice).
    if (!isSubsequence && quality >= 0.65 && sequence.length >= 3) {
      for (let i = 0; i < sequence.length - 2; i++) {
        for (let j = i + 2; j < Math.min(i + 4, sequence.length); j++) {
          const subSeq = [sequence[i], sequence[j]];
          this.recordStrategy(subSeq, outcome, goal, quality * 0.8, true);
        }
      }
    }
  }

  // ── Bayesian quality estimation ───────────────────────────────────────────

  /**
   * Thompson sample from Beta(wins+1, total−wins+1) posterior.
   * Used for exploration-exploitation balanced strategy ranking.
   */
  private sampleBeta(wins: number, total: number): number {
    const a = wins + 1, b = total - wins + 1;
    const mu = a / (a + b);
    const sigma = Math.sqrt(mu * (1 - mu) / (a + b + 1));
    // Box-Muller normal approximation (valid when a,b > 1)
    const u1 = Math.random() + 1e-10;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
    return Math.max(0, Math.min(1, mu + sigma * z));
  }

  /** 95% credible interval for a Beta(wins+1, N-wins+1) posterior. */
  getCredibleInterval(wins: number, total: number): [number, number] {
    const a = wins + 1, b = total - wins + 1;
    const mu = a / (a + b);
    const sigma = Math.sqrt(mu * (1 - mu) / (a + b + 1));
    return [Math.max(0, mu - 1.96 * sigma), Math.min(1, mu + 1.96 * sigma)];
  }

  // ── Outcome Inference ─────────────────────────────────────────────────────

  /**
   * Compare two state snapshots (text descriptions) to infer quality 0–1.
   * Uses simple heuristics: presence of error/retry keywords lowers score.
   */
  inferOutcome(before: string, after: string): number {
    const afterLower = after.toLowerCase();
    const negativeKeywords = ['error', 'failed', 'retry', 'timeout', 'exception', 'null', 'undefined', '404', '500'];
    const positiveKeywords = ['success', 'done', 'completed', 'found', 'saved', 'ok', 'created'];

    let score = 0.5;
    for (const kw of negativeKeywords) {
      if (afterLower.includes(kw)) score -= 0.1;
    }
    for (const kw of positiveKeywords) {
      if (afterLower.includes(kw)) score += 0.1;
    }

    // If the after state is significantly longer, assume progress was made
    if (after.length > before.length * 1.2) score += 0.05;

    return Math.max(0, Math.min(1, score));
  }

  // ── Effective Sequences ───────────────────────────────────────────────────

  /**
   * Return top 5 tool sequences for a given goal, sorted by quality × frequency.
   */
  getEffectiveSequences(goal: string): StrategyRecord[] {
    const goalLower = goal.toLowerCase();
    // Thompson sampling: rank by sample from each strategy's Beta posterior.
    // This balances exploitation (known good) with exploration (rarely tried).
    return this.strategies
      .filter(s => s.outcome !== 'negative' && s.goal.toLowerCase().includes(goalLower))
      .map(s => ({
        strategy: s,
        score: this.sampleBeta(s.wins ?? s.avgQuality * s.frequency, s.frequency),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.strategy);
  }

  // ── Weak Tool Detection ───────────────────────────────────────────────────

  /**
   * Returns tools with below-average success rate (< 50%) across all recorded calls.
   */
  getWeakTools(): { toolName: string; successRate: number; avgQuality: number; calls: number }[] {
    const stats: Record<string, ToolStats> = {};

    for (const r of this.toolCalls) {
      if (!stats[r.toolName]) {
        stats[r.toolName] = { calls: 0, successes: 0, totalQuality: 0, totalDurationMs: 0, contexts: [] };
      }
      const s = stats[r.toolName];
      s.calls++;
      if (r.success) s.successes++;
      s.totalQuality += r.outputQuality;
      s.totalDurationMs += r.durationMs;
      s.contexts.push(r.context);
    }

    return Object.entries(stats)
      .map(([toolName, s]) => ({
        toolName,
        successRate: s.calls > 0 ? s.successes / s.calls : 0,
        avgQuality: s.calls > 0 ? s.totalQuality / s.calls : 0,
        calls: s.calls,
      }))
      .filter(t => t.successRate < 0.5 && t.calls >= 3)
      .sort((a, b) => a.successRate - b.successRate);
  }

  // ── Prompt Adjustment ─────────────────────────────────────────────────────

  /**
   * Synthesize a paragraph of learned preferences to inject into system prompt.
   */
  synthesizePromptAdjustment(): string {
    if (this.toolCalls.length < 5 && this.sessions.length < 2) {
      return ''; // Not enough data yet
    }

    const lines: string[] = [];
    const totalSessions = this.sessions.length;
    const totalCalls = this.toolCalls.length;

    lines.push(`Based on ${totalSessions} sessions and ${totalCalls} tool calls:`);

    // Top effective sequences
    const allSequences = this.strategies
      .filter(s => s.outcome === 'positive' && s.frequency >= 2)
      .sort((a, b) => b.avgQuality - a.avgQuality)
      .slice(0, 3);

    for (const seq of allSequences) {
      const pct = Math.round(seq.avgQuality * 100);
      lines.push(`${seq.sequence.join(' → ')} yields ${pct}% quality outcomes for "${seq.goal}" tasks.`);
    }

    // Weak tools to avoid
    const weakTools = this.getWeakTools().slice(0, 3);
    for (const wt of weakTools) {
      const pct = Math.round(wt.successRate * 100);
      lines.push(`Avoid ${wt.toolName} (${pct}% success rate across ${wt.calls} calls).`);
    }

    // Fastest tools by context
    const contextStats = this.getTopToolsByContext('file', 3);
    if (contextStats.length > 0) {
      const names = contextStats.join(', ');
      lines.push(`For file operations, prefer: ${names}.`);
    }

    // Session outcome patterns
    const positiveSessionTools = this.extractSuccessfulSessionTools();
    if (positiveSessionTools.length > 0) {
      lines.push(`Sessions with positive outcomes commonly used: ${positiveSessionTools.slice(0, 5).join(', ')}.`);
    }

    return lines.join(' ');
  }

  private extractSuccessfulSessionTools(): string[] {
    const freq: Record<string, number> = {};
    for (const s of this.sessions) {
      const outLower = s.outcome.toLowerCase();
      if (outLower.includes('success') || outLower.includes('done') || outLower.includes('complete')) {
        for (const tool of s.toolsUsed) {
          freq[tool] = (freq[tool] ?? 0) + 1;
        }
      }
    }
    return Object.entries(freq).sort(([, a], [, b]) => b - a).map(([t]) => t);
  }

  // ── Session Learning ──────────────────────────────────────────────────────

  recordSession(topic: string, toolsUsed: string[], outcome: string): void {
    this.sessions.push({ topic, toolsUsed, outcome, timestamp: Date.now() });
    if (this.sessions.length > this.MAX_SESSIONS) {
      this.sessions = this.sessions.slice(-this.MAX_SESSIONS);
    }
    this.save();
  }

  // ── Context-Based Tool Ranking ────────────────────────────────────────────

  /**
   * Returns up to n best-performing tool names for a given task context string.
   */
  getTopToolsByContext(context: string, n: number = 5): string[] {
    const contextLower = context.toLowerCase();
    const freq: Record<string, { quality: number; count: number }> = {};

    for (const r of this.toolCalls) {
      if (!r.context.toLowerCase().includes(contextLower)) continue;
      if (!freq[r.toolName]) freq[r.toolName] = { quality: 0, count: 0 };
      freq[r.toolName].quality += r.outputQuality;
      freq[r.toolName].count++;
    }

    return Object.entries(freq)
      .filter(([, v]) => v.count >= 1)
      .map(([toolName, v]) => ({ toolName, avgQuality: v.quality / v.count }))
      .sort((a, b) => b.avgQuality - a.avgQuality)
      .slice(0, n)
      .map(t => t.toolName);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  exportInsights(): string {
    const weakTools = this.getWeakTools();
    const topStrategies = this.strategies
      .filter(s => s.outcome === 'positive')
      .sort((a, b) => b.avgQuality - a.avgQuality)
      .slice(0, 20);

    const insights = {
      generated: new Date().toISOString(),
      summary: {
        totalToolCalls: this.toolCalls.length,
        totalSessions: this.sessions.length,
        totalStrategies: this.strategies.length,
        uniqueTools: new Set(this.toolCalls.map(r => r.toolName)).size,
      },
      promptAdjustment: this.synthesizePromptAdjustment(),
      topStrategies,
      weakTools,
      recentSessions: this.sessions.slice(-10),
    };

    return JSON.stringify(insights, null, 2);
  }

  /** Wipe all learned state — used by factory reset. */
  clear() {
    this.toolCalls = [];
    this.strategies = [];
    this.sessions = [];
    this.recentTools = [];
    this.dirty = false;
    this.save();
  }
}

// ---------------------------------------------------------------------------

export const metaLearner = new MetaLearner();

// Auto-flush every 30 seconds
if (typeof setInterval !== 'undefined') {
  setInterval(() => metaLearner.flush(), 30_000);
}

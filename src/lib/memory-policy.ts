import fs from 'fs';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
import type { MemoryInjectionCandidate } from './vector-store';

const POLICY_PATH = PATHS.memoryPolicy;
const MAX_HISTORY = 500;
const DEFAULT_MIN_SCORE = 0.58;
const DIVERSITY_PENALTY = 0.08;

ensureWorkspacePaths();

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 3);
}

export interface MemoryInjectionDecision extends MemoryInjectionCandidate {
  decisionScore: number;
}

interface PolicySnapshot {
  timestamp: number;
  query: string;
  injectedIds: string[];
  acknowledgedIds: string[];
  responseQuality: number;
  averageDecisionScore: number;
}

interface PolicyState {
  bias: number;
  learningRate: number;
  featureWeights: Record<string, number>;
  minScore: number;
  history: PolicySnapshot[];
}

class MemoryPolicy {
  private state: PolicyState = {
    bias: -0.45,
    learningRate: 0.08,
    minScore: DEFAULT_MIN_SCORE,
    featureWeights: {
      similarity: 1.25,
      geometrySimilarity: 1.55,
      baseScore: 0.95,
      importance: 0.85,
      textHits: 0.7,
      overlapCoverage: 0.95,
      querySpecificity: 0.35,
      acknowledgementRatio: 0.65,
      latticeSupport: 0.45,
      centrality: 0.2,
      geometryVirtue: 0.4,
      repetitionScore: 0.3,
      repetitionCount: 0.15,
      freshness: 0.25,
      rejectionRatio: -0.9,
      unacknowledgedStreak: -0.7,
    },
    history: [],
  };

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (!fs.existsSync(POLICY_PATH)) return;
      const raw = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf-8')) as Partial<PolicyState>;
      this.state = {
        ...this.state,
        ...raw,
        featureWeights: { ...this.state.featureWeights, ...(raw.featureWeights ?? {}) },
        history: Array.isArray(raw.history) ? raw.history.slice(-MAX_HISTORY) : [],
      };
    } catch (error) {
      console.error('[MemoryPolicy] Failed to load:', error);
    }
  }

  private save() {
    try {
      fs.writeFileSync(POLICY_PATH, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('[MemoryPolicy] Failed to save:', error);
    }
  }

  private sigmoid(value: number): number {
    return 1 / (1 + Math.exp(-value));
  }

  private features(query: string, candidate: MemoryInjectionCandidate) {
    const queryKeywords = extractKeywords(query);
    const overlapCoverage = queryKeywords.length > 0
      ? Math.min(1, candidate.keywordOverlap.length / queryKeywords.length)
      : 0;
    const specificity = queryKeywords.length > 0
      ? Math.min(1, queryKeywords.length / 8)
      : 0;
    return {
      similarity: Math.max(0, candidate.similarity),
      geometrySimilarity: Math.max(0, candidate.geometrySimilarity),
      baseScore: Math.max(0, Math.min(1.5, candidate.score)),
      importance: candidate.record.importance / 2,
      textHits: Math.min(1, candidate.textHits / 4),
      overlapCoverage,
      querySpecificity: specificity,
      acknowledgementRatio: candidate.acknowledgementRatio,
      latticeSupport: Math.min(1, candidate.latticeSupport),
      centrality: Math.min(1, candidate.centrality * 4),
      geometryVirtue: Math.min(1, candidate.geometryVirtue),
      repetitionScore: Math.min(1, candidate.repetitionScore),
      repetitionCount: Math.min(1, candidate.repetitionCount / 6),
      freshness: 1 / (1 + candidate.ageDays / 7),
      rejectionRatio: candidate.rejectionRatio,
      unacknowledgedStreak: Math.min(1, candidate.record.lifecycle.unacknowledgedStreak / 5),
    };
  }

  scoreCandidate(query: string, candidate: MemoryInjectionCandidate): number {
    const features = this.features(query, candidate);
    let score = this.state.bias;
    for (const [key, value] of Object.entries(features)) {
      score += (this.state.featureWeights[key] ?? 0) * value;
    }
    if (candidate.keywordOverlap.length === 0 && candidate.similarity < 0.35 && candidate.geometrySimilarity < 0.5) {
      score -= 0.45;
    }
    if (candidate.source === 'geometric') {
      score += 0.08;
    }
    if (candidate.rejectionRatio > 0.5 && candidate.acknowledgementRatio < 0.2) {
      score -= 0.35;
    }
    if (candidate.record.lifecycle.unacknowledgedStreak >= 3) {
      score -= 0.15 * Math.min(3, candidate.record.lifecycle.unacknowledgedStreak);
    }
    return this.sigmoid(score);
  }

  select(query: string, candidates: MemoryInjectionCandidate[], maxCount = 6): MemoryInjectionDecision[] {
    const ranked = candidates
      .map((candidate) => ({ ...candidate, decisionScore: this.scoreCandidate(query, candidate) }))
      .sort((a, b) => b.decisionScore - a.decisionScore);

    const selected: MemoryInjectionDecision[] = [];
    const seenTags = new Set<string>();

    for (const candidate of ranked) {
      if (candidate.decisionScore < this.state.minScore) continue;
      if (candidate.keywordOverlap.length === 0 && candidate.similarity < 0.45 && candidate.geometrySimilarity < 0.55 && candidate.source !== 'hybrid' && candidate.source !== 'geometric') continue;
      const tags = candidate.record.metadata.tags ?? [];
      const overlapPenalty = tags.filter((tag) => seenTags.has(tag)).length * DIVERSITY_PENALTY;
      const adjustedScore = candidate.decisionScore - overlapPenalty;
      if (adjustedScore < this.state.minScore) continue;
      selected.push({ ...candidate, decisionScore: adjustedScore });
      tags.forEach((tag) => seenTags.add(tag));
      if (selected.length >= maxCount) break;
    }

    return selected;
  }

  recordOutcome(
    query: string,
    injected: MemoryInjectionDecision[],
    acknowledgedIds: string[],
    responseQuality: number,
  ) {
    if (injected.length === 0) return;
    const ackSet = new Set(acknowledgedIds);
    const learningRate = this.state.learningRate;

    for (const candidate of injected) {
      const features = this.features(query, candidate);
      const prediction = this.scoreCandidate(query, candidate);
      const target = ackSet.has(candidate.record.id)
        ? Math.max(0.6, responseQuality)
        : Math.min(0.35, 1 - responseQuality * 0.5);
      const error = target - prediction;
      this.state.bias += learningRate * error;
      for (const [key, value] of Object.entries(features)) {
        this.state.featureWeights[key] = (this.state.featureWeights[key] ?? 0) + learningRate * error * value;
      }
    }

    this.state.history.push({
      timestamp: Date.now(),
      query,
      injectedIds: injected.map((candidate) => candidate.record.id),
      acknowledgedIds,
      responseQuality,
      averageDecisionScore: injected.reduce((sum, candidate) => sum + candidate.decisionScore, 0) / injected.length,
    });
    this.state.history = this.state.history.slice(-MAX_HISTORY);

    const ackRate = acknowledgedIds.length / injected.length;
    if (ackRate < 0.2) this.state.minScore = Math.min(0.72, this.state.minScore + 0.01);
    else if (ackRate > 0.6) this.state.minScore = Math.max(0.5, this.state.minScore - 0.005);

    this.save();
  }

  summary() {
    const recent = this.state.history.slice(-20);
    const totalInjected = recent.reduce((sum, entry) => sum + entry.injectedIds.length, 0);
    const totalAcknowledged = recent.reduce((sum, entry) => sum + entry.acknowledgedIds.length, 0);
    return {
      minScore: this.state.minScore,
      learningRate: this.state.learningRate,
      recentAcknowledgementRate: totalInjected > 0 ? totalAcknowledged / totalInjected : 0,
      observations: this.state.history.length,
      featureWeights: this.state.featureWeights,
    };
  }

  clear() {
    this.state.history = [];
    this.state.minScore = DEFAULT_MIN_SCORE;
    this.state.bias = -0.45;
    this.state.featureWeights = {
      similarity: 1.25,
      geometrySimilarity: 1.55,
      baseScore: 0.95,
      importance: 0.85,
      textHits: 0.7,
      overlapCoverage: 0.95,
      querySpecificity: 0.35,
      acknowledgementRatio: 0.65,
      latticeSupport: 0.45,
      centrality: 0.2,
      geometryVirtue: 0.4,
      repetitionScore: 0.3,
      repetitionCount: 0.15,
      freshness: 0.25,
      rejectionRatio: -0.9,
      unacknowledgedStreak: -0.7,
    };
    this.save();
  }
}

export const memoryPolicy = new MemoryPolicy();

import { omniShapeResonator, type OLRAnalysis } from './olr';

export interface MemoryGeometrySignature {
  language: string;
  script: string;
  glyphCount: number;
  uniqueGlyphs: number;
  fingerprint: number[];
  harmonics: number[];
  vibration: number[];
  auditLabel: OLRAnalysis['audit']['label'];
  coherence: number;
  virtue: number;
  entropy: number;
  closure: number;
  shapeKey: string;
  repetitionScore: number;
  repetitionCount: number;
  topologicalNeighbors: string[];
}

export interface MemoryGeometryComparison {
  score: number;
  fingerprintSimilarity: number;
  harmonicSimilarity: number;
  vibrationSimilarity: number;
  topologicalSynonym: boolean;
  repeatedShape: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeCosineSimilarity(a: number[], b: number[]): number {
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

function quantizeFingerprint(values: number[]): string {
  return values
    .slice(0, 8)
    .map((value) => Math.round(clamp01((value + 1) * 0.5) * 24))
    .join('.');
}

export function buildShapeKey(analysis: OLRAnalysis): string {
  return `${analysis.script}:${analysis.audit.label}:${quantizeFingerprint(analysis.fingerprint)}`;
}

export function buildMemoryGeometry(content: string, learn = false): MemoryGeometrySignature | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  const analysis = omniShapeResonator.analyzeText(trimmed, { learn, render: false });
  return {
    language: analysis.language,
    script: analysis.script,
    glyphCount: analysis.glyphCount,
    uniqueGlyphs: analysis.uniqueGlyphs,
    fingerprint: analysis.fingerprint,
    harmonics: analysis.harmonics,
    vibration: analysis.vibration,
    auditLabel: analysis.audit.label,
    coherence: analysis.metrics.coherence,
    virtue: analysis.metrics.virtue,
    entropy: analysis.metrics.entropy,
    closure: analysis.metrics.closure,
    shapeKey: buildShapeKey(analysis),
    repetitionScore: 0,
    repetitionCount: 0,
    topologicalNeighbors: [],
  };
}

export function compareMemoryGeometry(
  left?: MemoryGeometrySignature,
  right?: MemoryGeometrySignature,
): MemoryGeometryComparison {
  if (!left || !right) {
    return {
      score: 0,
      fingerprintSimilarity: 0,
      harmonicSimilarity: 0,
      vibrationSimilarity: 0,
      topologicalSynonym: false,
      repeatedShape: false,
    };
  }

  const fingerprintSimilarity = clamp01((safeCosineSimilarity(left.fingerprint, right.fingerprint) + 1) * 0.5);
  const harmonicSimilarity = clamp01((safeCosineSimilarity(left.harmonics, right.harmonics) + 1) * 0.5);
  const vibrationSimilarity = clamp01((safeCosineSimilarity(left.vibration, right.vibration) + 1) * 0.5);
  const score = clamp01(
    fingerprintSimilarity * 0.56 +
    harmonicSimilarity * 0.24 +
    vibrationSimilarity * 0.14 +
    (left.auditLabel === right.auditLabel ? 0.03 : 0) +
    (left.script === right.script ? 0.03 : 0)
  );

  return {
    score,
    fingerprintSimilarity,
    harmonicSimilarity,
    vibrationSimilarity,
    topologicalSynonym: score >= 0.84,
    repeatedShape: left.shapeKey === right.shapeKey || score >= 0.93,
  };
}
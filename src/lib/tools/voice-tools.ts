// src/lib/tools/voice-tools.ts
// Server-side voice learning tools.
// Actual STT/TTS happens browser-side via Web Speech API;
// this module handles persistence, semantic search, and prosody hints.

import fs from 'fs';
import { weightStore } from '../weight-store';
import { vectorStore } from '../vector-store';
import { generateEmbedding } from '../embeddings';

import { PATHS } from '../paths';
const VOICE_HISTORY_PATH = PATHS.voiceHistory;
const VOICE_PROFILE_PATH = PATHS.voiceProfile;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface VoiceInteraction {
  id: string;
  timestamp: number;
  transcript: string;       // User speech (from STT)
  response: string;         // Agent text response
  quality: number;          // 0–1
  tags: string[];
  durationMs: number;
}

export interface VoiceProfile {
  preferredPace: 'slow' | 'medium' | 'fast';
  commonKeywords: string[];
  avgInputLength: number;
  successPatterns: string[];
  weightPath?: string;
}

export interface TTSHints {
  text: string;
  rate: number;             // Web Speech: 0.1–10, 1.0 = normal
  pitch: number;            // Web Speech: 0–2, 1.0 = normal
  emphasis: string[];       // Words to stress
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadHistory(): VoiceInteraction[] {
  try {
    if (fs.existsSync(VOICE_HISTORY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(VOICE_HISTORY_PATH, 'utf-8'));
      if (Array.isArray(raw)) return raw;
    }
  } catch (err) {
    console.error('[VoiceTools] Failed to load history:', err);
  }
  return [];
}

function saveHistory(history: VoiceInteraction[]): void {
  try {
    fs.writeFileSync(VOICE_HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('[VoiceTools] Failed to save history:', err);
  }
}

function loadProfile(): VoiceProfile {
  try {
    if (fs.existsSync(VOICE_PROFILE_PATH)) {
      return JSON.parse(fs.readFileSync(VOICE_PROFILE_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error('[VoiceTools] Failed to load profile:', err);
  }
  return {
    preferredPace: 'medium',
    commonKeywords: [],
    avgInputLength: 0,
    successPatterns: [],
  };
}

function saveProfile(profile: VoiceProfile): void {
  try {
    fs.writeFileSync(VOICE_PROFILE_PATH, JSON.stringify(profile, null, 2));
  } catch (err) {
    console.error('[VoiceTools] Failed to save profile:', err);
  }
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Embed and store a voice interaction in the vector store with voice metadata,
 * and also append to the flat voice-history.json log.
 */
export async function storeVoiceInteraction(
  transcript: string,
  response: string,
  quality: number = 0.5,
  tags: string[] = [],
  durationMs: number = 0
): Promise<VoiceInteraction> {
  const id = `vi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const interaction: VoiceInteraction = {
    id,
    timestamp: Date.now(),
    transcript,
    response,
    quality: Math.max(0, Math.min(1, quality)),
    tags,
    durationMs,
  };

  // Embed the transcript + response together for semantic search
  const embeddingText = `User: ${transcript}\nAgent: ${response}`;
  const embedding = await generateEmbedding(embeddingText);

  vectorStore.upsert({
    content: embeddingText,
    embedding,
    dim: embedding.length,
    metadata: {
      source: 'user',
      topic: 'voice',
      tags: ['voice', ...tags],
      entities: extractKeywords(transcript),
    },
    importance: 0.5 + quality * 0.5, // Higher-quality interactions are more important
  });

  // Append to flat history file
  const history = loadHistory();
  history.push(interaction);
  saveHistory(history);

  // Incrementally update the voice profile
  await _updateProfileFromInteraction(interaction);

  console.log(`[VoiceTools] Stored voice interaction ${id} (quality=${quality.toFixed(2)})`);
  return interaction;
}

/**
 * Semantic search of past voice interactions.
 * Returns up to topK most relevant past exchanges.
 */
export async function searchVoiceHistory(
  query: string,
  topK: number = 5
): Promise<{ interaction: VoiceInteraction; score: number }[]> {
  const queryEmbedding = await generateEmbedding(query);
  const results = vectorStore.search(queryEmbedding, topK * 3, query); // Over-fetch then filter

  // Filter to only voice records
  const voiceResults = results.filter(r => r.record.metadata.topic === 'voice');

  // Load full history for cross-referencing
  const history = loadHistory();
  const historyMap = new Map(history.map(h => [h.transcript + h.response, h]));

  const matched: { interaction: VoiceInteraction; score: number }[] = [];
  for (const r of voiceResults.slice(0, topK)) {
    void historyMap.get(r.record.content.replace(/^User: /, '').replace(/\nAgent: /, ''));
    // Fallback: try to find by reconstructing the content
    const found = history.find(h => r.record.content.includes(h.transcript.substring(0, 30)));
    if (found) {
      matched.push({ interaction: found, score: r.score });
    }
  }

  return matched.slice(0, topK);
}

/**
 * Analyze stored voice interactions to extract patterns:
 * most common topics, average quality by topic, most effective phrasings.
 */
export async function analyzeVoicePatterns(): Promise<string> {
  const history = loadHistory();

  if (history.length === 0) {
    return JSON.stringify({ message: 'No voice interactions recorded yet.' });
  }

  // Count keywords across all transcripts
  const keywordFreq: Record<string, number> = {};
  let totalQuality = 0;
  const qualityByTag: Record<string, { total: number; count: number }> = {};

  for (const vi of history) {
    totalQuality += vi.quality;
    const words = extractKeywords(vi.transcript);
    for (const w of words) {
      keywordFreq[w] = (keywordFreq[w] ?? 0) + 1;
    }
    for (const tag of vi.tags) {
      if (!qualityByTag[tag]) qualityByTag[tag] = { total: 0, count: 0 };
      qualityByTag[tag].total += vi.quality;
      qualityByTag[tag].count++;
    }
  }

  const topKeywords = Object.entries(keywordFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([kw, freq]) => ({ keyword: kw, frequency: freq }));

  const avgQualityByTag = Object.entries(qualityByTag).map(([tag, { total, count }]) => ({
    tag,
    avgQuality: total / count,
    count,
  })).sort((a, b) => b.avgQuality - a.avgQuality);

  // Best phrasings = high-quality transcripts
  const bestPhrasings = history
    .filter(vi => vi.quality >= 0.8)
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 5)
    .map(vi => ({ transcript: vi.transcript, quality: vi.quality }));

  const analysis = {
    totalInteractions: history.length,
    avgQuality: history.length > 0 ? totalQuality / history.length : 0,
    topKeywords,
    avgQualityByTag,
    bestPhrasings,
    dateRange: {
      earliest: new Date(Math.min(...history.map(h => h.timestamp))).toISOString(),
      latest: new Date(Math.max(...history.map(h => h.timestamp))).toISOString(),
    },
  };

  return JSON.stringify(analysis, null, 2);
}

/**
 * Read or create the voice profile.
 */
export function getVoiceProfile(): VoiceProfile {
  return loadProfile();
}

/**
 * Merge updates into the voice profile.
 */
export function updateVoiceProfile(updates: Partial<VoiceProfile>): VoiceProfile {
  const profile = loadProfile();
  const merged: VoiceProfile = { ...profile, ...updates };

  // Merge arrays without duplicates
  if (updates.commonKeywords) {
    merged.commonKeywords = Array.from(new Set([...profile.commonKeywords, ...updates.commonKeywords]));
  }
  if (updates.successPatterns) {
    merged.successPatterns = Array.from(new Set([...profile.successPatterns, ...updates.successPatterns]));
  }

  saveProfile(merged);

  // If a new weight path is set, register with weightStore
  if (updates.weightPath && updates.weightPath !== profile.weightPath) {
    const stats = safeStatSync(updates.weightPath);
    weightStore.register(
      'voice',
      'voice-profile-weights',
      updates.weightPath,
      stats?.size ?? 0,
      0.5,
      0,
      { source: 'voice-profile' }
    );
  }

  return merged;
}

/**
 * Search voice history for similar past inputs and return successful responses.
 */
export async function suggestResponse(transcript: string): Promise<string[]> {
  const results = await searchVoiceHistory(transcript, 5);
  return results
    .filter(r => r.interaction.quality >= 0.6)
    .sort((a, b) => b.interaction.quality - a.interaction.quality)
    .map(r => r.interaction.response);
}

/**
 * Analyze text to produce TTS prosody hints for the Web Speech Synthesis API.
 * Returns rate, pitch, and emphasis words.
 */
export function generateTTSHints(text: string): TTSHints {
  const profile = loadProfile();

  // Adjust rate based on profile preference
  const rateMap: Record<VoiceProfile['preferredPace'], number> = {
    slow: 0.85,
    medium: 1.0,
    fast: 1.2,
  };
  const rate = rateMap[profile.preferredPace] ?? 1.0;

  // Pitch: slightly higher for questions
  const pitch = text.trim().endsWith('?') ? 1.1 : 1.0;

  // Emphasis: find capitalized words (acronyms), words in quotes, and key action verbs
  const emphasisWords: string[] = [];
  const acronymRegex = /\b[A-Z]{2,}\b/g;
  const quotedRegex = /"([^"]+)"/g;
  const actionVerbs = ['warning', 'error', 'critical', 'important', 'note', 'stop', 'go', 'now', 'urgent'];

  let m: RegExpExecArray | null;
  while ((m = acronymRegex.exec(text)) !== null) emphasisWords.push(m[0]);
  while ((m = quotedRegex.exec(text)) !== null) emphasisWords.push(m[1]);

  const textLower = text.toLowerCase();
  for (const verb of actionVerbs) {
    if (textLower.includes(verb)) emphasisWords.push(verb);
  }

  return {
    text,
    rate,
    pitch,
    emphasis: Array.from(new Set(emphasisWords)),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your',
    'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or',
    'but', 'so', 'if', 'this', 'that', 'what', 'how', 'can', 'do',
    'did', 'have', 'has', 'had', 'not', 'no', 'yes', 'please',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

async function _updateProfileFromInteraction(vi: VoiceInteraction): Promise<void> {
  const profile = loadProfile();
  const history = loadHistory();

  // Update avgInputLength (rolling average)
  const totalLength = history.reduce((sum, h) => sum + h.transcript.length, 0);
  profile.avgInputLength = history.length > 0 ? totalLength / history.length : 0;

  // Merge new keywords
  const newKws = extractKeywords(vi.transcript);
  const kwSet = new Set(profile.commonKeywords);
  // Only add keywords that appear 3+ times across all history
  const allKwFreq: Record<string, number> = {};
  for (const h of history) {
    for (const kw of extractKeywords(h.transcript)) {
      allKwFreq[kw] = (allKwFreq[kw] ?? 0) + 1;
    }
  }
  for (const kw of newKws) {
    if ((allKwFreq[kw] ?? 0) >= 3) kwSet.add(kw);
  }
  profile.commonKeywords = Array.from(kwSet).slice(0, 50); // Cap at 50

  // Record successful patterns
  if (vi.quality >= 0.8) {
    const pattern = vi.transcript.substring(0, 60);
    if (!profile.successPatterns.includes(pattern)) {
      profile.successPatterns.push(pattern);
      if (profile.successPatterns.length > 20) profile.successPatterns.shift();
    }
  }

  saveProfile(profile);
}

function safeStatSync(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

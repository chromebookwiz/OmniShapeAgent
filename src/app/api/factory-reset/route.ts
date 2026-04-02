import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { GENERATED_SCREENSHOTS_DIR, PATHS, SAVED_CHATS_DIR, WORKSPACE_DIR, WEIGHTS_DIR } from '@/lib/paths-core';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/factory-reset
 * Wipes all persistent data: memories, knowledge graph, chats, weights,
 * meta-learner history, generated images, and workspace files.
 * Returns a summary of what was cleared.
 */
export async function DELETE() {
  const cleared: string[] = [];

  // ── Data JSON files ────────────────────────────────────────────────────────
  const dataFiles: string[] = [
    PATHS.vectorStore,
    PATHS.knowledgeGraph,
    PATHS.metaLearner,
    PATHS.hallOfFame,
    PATHS.weightsRegistry,
    PATHS.botsRegistry,
    PATHS.scheduler,
    PATHS.userProfile,
    PATHS.consolidationLog,
    PATHS.voiceHistory,
    PATHS.voiceProfile,
    PATHS.visionBaseline,
    PATHS.terminalQueue,
    PATHS.memoryPolicy,
    PATHS.olrResonator,
  ];
  for (const f of dataFiles) {
    try {
      if (fs.existsSync(f)) { fs.unlinkSync(f); cleared.push(path.basename(f)); }
    } catch {}
  }

  // ── Saved chats ────────────────────────────────────────────────────────────
  try {
    if (fs.existsSync(SAVED_CHATS_DIR)) {
      const chats = fs.readdirSync(SAVED_CHATS_DIR).filter(f => f.endsWith('.json'));
      for (const c of chats) { try { fs.unlinkSync(path.join(SAVED_CHATS_DIR, c)); } catch {} }
      if (chats.length > 0) cleared.push(`${chats.length} saved chats`);
    }
  } catch {}

  // ── Generated images ───────────────────────────────────────────────────────
  try {
    if (fs.existsSync(GENERATED_SCREENSHOTS_DIR)) {
      const imgs = fs.readdirSync(GENERATED_SCREENSHOTS_DIR);
      for (const img of imgs) { try { fs.unlinkSync(path.join(GENERATED_SCREENSHOTS_DIR, img)); } catch {} }
      if (imgs.length > 0) cleared.push(`${imgs.length} generated images`);
    }
  } catch {}

  // ── Weights ────────────────────────────────────────────────────────────────
  try {
    if (fs.existsSync(WEIGHTS_DIR)) {
      const wfiles = fs.readdirSync(WEIGHTS_DIR).filter(f => !fs.statSync(path.join(WEIGHTS_DIR, f)).isDirectory());
      for (const wf of wfiles) { try { fs.unlinkSync(path.join(WEIGHTS_DIR, wf)); } catch {} }
      if (wfiles.length > 0) cleared.push(`${wfiles.length} weight files`);
    }
  } catch {}

  // ── Workspace ──────────────────────────────────────────────────────────────
  try {
    if (fs.existsSync(WORKSPACE_DIR)) {
      const wentries = fs.readdirSync(WORKSPACE_DIR).filter(f => !f.startsWith('.'));
      for (const f of wentries) {
        try {
          const full = path.join(WORKSPACE_DIR, f);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
          else fs.unlinkSync(full);
        } catch {}
      }
      if (wentries.length > 0) cleared.push(`${wentries.length} workspace entries`);
    }
  } catch {}

  return NextResponse.json({ ok: true, cleared, resetAt: new Date().toISOString() });
}

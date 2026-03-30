// src/lib/paths.ts
// Central workspace path constants for the ShapeAgent data layer.
//
// All persistent data lives under subdirectories of ROOT.
// On first use, any legacy file still sitting in ROOT is automatically
// migrated to its canonical location — no data is lost.

import fs from 'fs';
import path from 'path';

export const ROOT = process.cwd();

// ── Named workspace directories ────────────────────────────────────────────

/** Persistent runtime data (JSON stores, logs, queue). */
export const DATA_DIR       = path.join(ROOT, 'data');
/** Trained PyTorch weights and ARMS policy nets. */
export const WEIGHTS_DIR    = path.join(ROOT, 'weights');
/** Bot Python implementations. */
export const BOTS_DIR       = path.join(ROOT, 'bots');
/** Skill markdown files — the agent's persistent knowledge base. */
export const SKILLS_DIR     = path.join(ROOT, 'skills');
/** Named colour-palette configs for pixel-vision. */
export const PALETTES_DIR   = path.join(ROOT, 'palette-configs');
/** Saved screenshots and vision captures. */
export const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
/** Saved chat history JSON. */
export const SAVED_CHATS_DIR = path.join(ROOT, 'saved_chats');
/** Prototype/scratch workspace for agent-generated code, HTML, etc. */
export const WORKSPACE_DIR  = path.join(ROOT, 'workspace');

/** Every directory that must exist. */
const ALL_DIRS = [
  DATA_DIR, WEIGHTS_DIR, BOTS_DIR, SKILLS_DIR,
  PALETTES_DIR, SCREENSHOTS_DIR, SAVED_CHATS_DIR, WORKSPACE_DIR,
];

// ── Persistent data file paths (all under DATA_DIR) ───────────────────────

export const PATHS = {
  vectorStore:     path.join(DATA_DIR, 'memory_vectors.json'),
  knowledgeGraph:  path.join(DATA_DIR, 'knowledge_graph.json'),
  metaLearner:     path.join(DATA_DIR, 'meta-learner.json'),
  hallOfFame:      path.join(DATA_DIR, 'hall-of-fame.json'),
  weightsRegistry: path.join(DATA_DIR, 'weights-registry.json'),
  botsRegistry:    path.join(DATA_DIR, 'bots-registry.json'),
  scheduler:       path.join(DATA_DIR, 'scheduler-tasks.json'),
  userProfile:     path.join(DATA_DIR, 'user-profile.json'),
  consolidationLog:path.join(DATA_DIR, 'consolidation-log.json'),
  voiceHistory:    path.join(DATA_DIR, 'voice-history.json'),
  voiceProfile:    path.join(DATA_DIR, 'voice-profile.json'),
  visionBaseline:  path.join(DATA_DIR, 'vision-baseline.json'),
  terminalQueue:   path.join(DATA_DIR, 'terminal-queue.json'),
} as const;

// ── Bootstrap ─────────────────────────────────────────────────────────────

/**
 * Create all workspace directories and migrate any legacy root-level data
 * files to their canonical locations under data/.
 * Called once at module load — idempotent.
 */
function bootstrap(): void {
  for (const dir of ALL_DIRS) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }

  // Legacy file names that previously lived in ROOT
  const MIGRATIONS: Array<[string, string]> = [
    ['memory_vectors.json',   PATHS.vectorStore],
    ['knowledge_graph.json',  PATHS.knowledgeGraph],
    ['meta-learner.json',     PATHS.metaLearner],
    ['hall-of-fame.json',     PATHS.hallOfFame],
    ['weights-registry.json', PATHS.weightsRegistry],
    ['bots-registry.json',    PATHS.botsRegistry],
    ['scheduler-tasks.json',  PATHS.scheduler],
    ['user-profile.json',     PATHS.userProfile],
    ['consolidation-log.json',PATHS.consolidationLog],
    ['voice-history.json',    PATHS.voiceHistory],
    ['voice-profile.json',    PATHS.voiceProfile],
    ['vision-baseline.json',  PATHS.visionBaseline],
    ['terminal-queue.json',   PATHS.terminalQueue],
    // Legacy alternate names
    ['e8_memories.json',      path.join(DATA_DIR, 'e8_memories_legacy.json')],
    ['sms_inbox.json',        path.join(DATA_DIR, 'sms_inbox.json')],
  ];

  for (const [legacyName, newPath] of MIGRATIONS) {
    const legacyPath = path.join(ROOT, legacyName);
    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      try { fs.renameSync(legacyPath, newPath); } catch {}
    }
  }

  // Move stray root-level image/temp files into screenshots/
  const rootFiles = fs.readdirSync(ROOT);
  for (const f of rootFiles) {
    if (/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(f)) {
      const src = path.join(ROOT, f);
      const dst = path.join(SCREENSHOTS_DIR, f);
      try {
        if (!fs.existsSync(dst)) fs.renameSync(src, dst);
      } catch {}
    }
  }
}

bootstrap();

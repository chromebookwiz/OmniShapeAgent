import fs from 'fs';
import path from 'path';
import { DATA_DIR, PATHS, ROOT } from './paths-core';

let migrated = false;

export function migrateLegacyWorkspaceData(): void {
  if (migrated) return;
  migrated = true;

  const migrations: Array<[string, string]> = [
    ['memory_vectors.json', PATHS.vectorStore],
    ['knowledge_graph.json', PATHS.knowledgeGraph],
    ['meta-learner.json', PATHS.metaLearner],
    ['hall-of-fame.json', PATHS.hallOfFame],
    ['weights-registry.json', PATHS.weightsRegistry],
    ['bots-registry.json', PATHS.botsRegistry],
    ['scheduler-tasks.json', PATHS.scheduler],
    ['user-profile.json', PATHS.userProfile],
    ['consolidation-log.json', PATHS.consolidationLog],
    ['voice-history.json', PATHS.voiceHistory],
    ['voice-profile.json', PATHS.voiceProfile],
    ['vision-baseline.json', PATHS.visionBaseline],
    ['terminal-queue.json', PATHS.terminalQueue],
    ['memory-policy.json', PATHS.memoryPolicy],
    ['olr-resonator.json', PATHS.olrResonator],
    ['e8_memories.json', path.join(DATA_DIR, 'e8_memories_legacy.json')],
    ['sms_inbox.json', path.join(DATA_DIR, 'sms_inbox.json')],
  ];

  for (const [legacyName, newPath] of migrations) {
    const legacyPath = path.join(/*turbopackIgnore: true*/ ROOT, legacyName);
    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      try { fs.renameSync(legacyPath, newPath); } catch {}
    }
  }
}
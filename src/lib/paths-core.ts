import path from 'path';

export const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd());

export const DATA_DIR = path.join(ROOT, 'data');
export const WEIGHTS_DIR = path.join(ROOT, 'weights');
export const BOTS_DIR = path.join(ROOT, 'bots');
export const SKILLS_DIR = path.join(ROOT, 'skills');
export const PALETTES_DIR = path.join(ROOT, 'palette-configs');
export const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
export const GENERATED_SCREENSHOTS_DIR = path.join(SCREENSHOTS_DIR, 'generated');
export const SAVED_CHATS_DIR = path.join(ROOT, 'saved_chats');
export const WORKSPACE_DIR = path.join(ROOT, 'workspace');

export const REQUIRED_DIRS = [
  DATA_DIR,
  WEIGHTS_DIR,
  BOTS_DIR,
  SKILLS_DIR,
  PALETTES_DIR,
  SCREENSHOTS_DIR,
  GENERATED_SCREENSHOTS_DIR,
  SAVED_CHATS_DIR,
  WORKSPACE_DIR,
];

export const PATHS = {
  vectorStore: path.join(DATA_DIR, 'memory_vectors.json'),
  knowledgeGraph: path.join(DATA_DIR, 'knowledge_graph.json'),
  metaLearner: path.join(DATA_DIR, 'meta-learner.json'),
  hallOfFame: path.join(DATA_DIR, 'hall-of-fame.json'),
  weightsRegistry: path.join(DATA_DIR, 'weights-registry.json'),
  botsRegistry: path.join(DATA_DIR, 'bots-registry.json'),
  scheduler: path.join(DATA_DIR, 'scheduler-tasks.json'),
  userProfile: path.join(DATA_DIR, 'user-profile.json'),
  consolidationLog: path.join(DATA_DIR, 'consolidation-log.json'),
  selfImproveLog: path.join(DATA_DIR, 'self-improve-log.json'),
  voiceHistory: path.join(DATA_DIR, 'voice-history.json'),
  voiceProfile: path.join(DATA_DIR, 'voice-profile.json'),
  visionBaseline: path.join(DATA_DIR, 'vision-baseline.json'),
  terminalQueue: path.join(DATA_DIR, 'terminal-queue.json'),
  memoryPolicy: path.join(DATA_DIR, 'memory-policy.json'),
  olrResonator: path.join(DATA_DIR, 'olr-resonator.json'),
} as const;
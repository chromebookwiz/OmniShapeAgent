// src/lib/tools/bot-manager.ts
// Registry for deployed learning bots. Intentionally has NO import from agent.ts
// (spawn logic lives in agent.ts switch to avoid circular deps).
import fs from 'fs';

import { ensureWorkspacePaths } from '../paths-bootstrap';
import { PATHS } from '../paths-core';
const REGISTRY_PATH = PATHS.botsRegistry;

ensureWorkspacePaths();

export interface BotRecord {
  id: string;
  url: string;
  goal: string;
  region?: { x: number; y: number; w: number; h: number };
  startTime: string;
  status: 'running' | 'stopped' | 'error';
  lastMetric?: string;
  iterations?: number;
}

function readRegistry(): BotRecord[] {
  try {
    if (!fs.existsSync(REGISTRY_PATH)) return [];
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch { return []; }
}

function writeRegistry(bots: BotRecord[]): void {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(bots, null, 2));
}

/** Register a new bot entry in the registry. Returns the full record as JSON. */
export function registerBot(
  url: string,
  goal: string,
  botId?: string,
  region?: { x: number; y: number; w: number; h: number }
): string {
  const id = botId || `bot-${Date.now()}`;
  const bots = readRegistry();
  if (bots.find(b => b.id === id)) {
    return JSON.stringify({ error: `Bot ${id} already exists. Use a different id.` });
  }
  const record: BotRecord = {
    id, url, goal, region,
    startTime: new Date().toISOString(),
    status: 'running',
    iterations: 0,
  };
  bots.push(record);
  writeRegistry(bots);
  return JSON.stringify(record);
}

export function listBots(): string {
  const bots = readRegistry();
  if (!bots.length) return 'No bots deployed.';
  return JSON.stringify(bots, null, 2);
}

export function stopBot(botId: string): string {
  const bots = readRegistry();
  const bot = bots.find(b => b.id === botId);
  if (!bot) return `Bot ${botId} not found.`;
  bot.status = 'stopped';
  writeRegistry(bots);
  return `Bot ${botId} stopped.`;
}

/** Called by a running bot each iteration to update its metric + increment counter. */
export function updateBotMetric(botId: string, metric: string): string {
  const bots = readRegistry();
  const bot = bots.find(b => b.id === botId);
  if (!bot) return `Bot ${botId} not found.`;
  bot.lastMetric = String(metric);
  bot.iterations = (bot.iterations ?? 0) + 1;
  writeRegistry(bots);
  return `ok`;
}

/** Check whether a bot has been told to stop (status !== 'running'). */
export function isBotRunning(botId: string): boolean {
  const bots = readRegistry();
  const bot = bots.find(b => b.id === botId);
  return bot?.status === 'running';
}

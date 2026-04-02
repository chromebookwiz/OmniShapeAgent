import fs from 'fs';
import { runAgentLoopText } from './agent';
import { generateEmbedding, cosineSimilarity } from './embeddings';
import { sendTelegramMessage } from './tools/telegram';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { PATHS } from './paths-core';
const SCHEDULER_PATH = PATHS.scheduler;

ensureWorkspacePaths();

export interface ResonanceTask {
  id: string;
  targetConcept: string;
  targetEmbedding: number[];
  taskPrompt: string;
  threshold: number;
}

export interface CronTask {
  id: string;
  intervalMs: number;
  taskPrompt: string;
  lastRun: number;
  label?: string;
  createdAt: number;
  runCount: number;
}

interface PersistedSchedulerState {
  cronTasks: Array<Omit<CronTask, never>>;
  // Resonance tasks require re-embedding on load (embeddings are large)
  resonanceConcepts: Array<{ id: string; targetConcept: string; taskPrompt: string; threshold: number; createdAt: number }>;
}

class AdvancedScheduler {
  private resonanceTasks: ResonanceTask[] = [];
  private cronTasks: CronTask[] = [];
  private cronIntervalId: ReturnType<typeof setInterval> | null = null;
  private telegramIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastUpdateId: number = 0;

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      if (fs.existsSync(SCHEDULER_PATH)) {
        const state: PersistedSchedulerState = JSON.parse(fs.readFileSync(SCHEDULER_PATH, 'utf-8'));
        this.cronTasks = state.cronTasks ?? [];
        // Reset lastRun so tasks fire at correct intervals after restart
        for (const t of this.cronTasks) {
          t.lastRun = Date.now(); // grace period after restart
        }
        console.log(`[Scheduler] Loaded ${this.cronTasks.length} cron tasks.`);

        // Re-embed resonance tasks asynchronously
        const concepts = state.resonanceConcepts ?? [];
        if (concepts.length > 0) {
          console.log(`[Scheduler] Re-embedding ${concepts.length} resonance tasks...`);
          for (const c of concepts) {
            generateEmbedding(c.targetConcept).then(emb => {
              this.resonanceTasks.push({
                id: c.id,
                targetConcept: c.targetConcept,
                targetEmbedding: emb,
                taskPrompt: c.taskPrompt,
                threshold: c.threshold,
              });
            }).catch(() => {});
          }
        }

        if (this.cronTasks.length > 0) this.startCron();
      }
    } catch (e) {
      console.error('[Scheduler] Load failed:', e);
    }
  }

  private saveState() {
    try {
      const state: PersistedSchedulerState = {
        cronTasks: this.cronTasks,
        resonanceConcepts: this.resonanceTasks.map(r => ({
          id: r.id,
          targetConcept: r.targetConcept,
          taskPrompt: r.taskPrompt,
          threshold: r.threshold,
          createdAt: Date.now(),
        })),
      };
      fs.writeFileSync(SCHEDULER_PATH, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('[Scheduler] Save failed:', e);
    }
  }

  listTasks(): string {
    const cron = this.cronTasks.map(t => ({
      id: t.id,
      label: t.label || t.taskPrompt.substring(0, 40),
      intervalMin: Math.round(t.intervalMs / 60000),
      runCount: t.runCount ?? 0,
      nextRunIn: Math.max(0, Math.round((t.intervalMs - (Date.now() - t.lastRun)) / 1000)) + 's',
    }));
    const resonance = this.resonanceTasks.map(r => ({
      id: r.id,
      concept: r.targetConcept,
      threshold: r.threshold,
      type: 'resonance',
    }));
    return JSON.stringify({ cron, resonance, total: cron.length + resonance.length }, null, 2);
  }

  public async scheduleCron(intervalMinutes: number, taskPrompt: string, label?: string): Promise<string> {
    const id = Math.random().toString(36).substring(7);
    this.cronTasks.push({
      id,
      intervalMs: intervalMinutes * 60 * 1000,
      taskPrompt,
      label,
      lastRun: Date.now(),
      createdAt: Date.now(),
      runCount: 0,
    });
    this.startCron();
    this.saveState();
    return `Scheduled Cron Task [${id}]${label ? ` (${label})` : ''}: every ${intervalMinutes} minutes. Persisted across restarts.`;
  }

  public async scheduleResonance(targetConcept: string, taskPrompt: string): Promise<string> {
    const id = Math.random().toString(36).substring(7);
    const embedding = await generateEmbedding(targetConcept);
    this.resonanceTasks.push({
      id,
      targetConcept,
      targetEmbedding: embedding,
      taskPrompt,
      threshold: 0.85
    });
    this.saveState();
    return `Scheduled Resonance Task [${id}] semantically bound to concept: "${targetConcept}". Wait for activation.`;
  }

  public async cancelTask(id: string): Promise<string> {
    const cronBefore = this.cronTasks.length;
    const resBefore = this.resonanceTasks.length;
    this.cronTasks = this.cronTasks.filter(t => t.id !== id);
    this.resonanceTasks = this.resonanceTasks.filter(t => t.id !== id);
    const removed = (cronBefore - this.cronTasks.length) + (resBefore - this.resonanceTasks.length);
    if (removed === 0) return `Task ${id} not found.`;
    if (this.cronTasks.length === 0 && this.cronIntervalId) {
      clearInterval(this.cronIntervalId);
      this.cronIntervalId = null;
    }
    this.saveState();
    return `Task ${id} cancelled and removed from persistence.`;
  }

  // Called by agent loop — fire-and-forget, does NOT block the loop
  public checkResonance(currentThought: string): void {
    if (this.resonanceTasks.length === 0) return;
    generateEmbedding(currentThought).then(thoughtEmbedding => {
      for (const task of [...this.resonanceTasks]) {
        const similarity = cosineSimilarity(thoughtEmbedding, task.targetEmbedding);
        if (similarity >= task.threshold) {
          console.log(`[RES-TRIGGER] Resonance for "${task.targetConcept}" (Sim: ${similarity.toFixed(3)})`);
          // One-shot: remove before executing
          this.resonanceTasks = this.resonanceTasks.filter(t => t.id !== task.id);
          runAgentLoopText(
            `[BACKGROUND RESONANCE TRIGGER] Concept matched: "${task.targetConcept}". Execute: ${task.taskPrompt}`,
            [{ role: 'system', content: 'Asynchronous resonance trigger.' }]
          ).then(res => console.log("[Resonance Task]", res.substring(0, 50)))
           .catch((e: any) => console.error("Resonance task failed", e));
        }
      }
    }).catch(() => {}); // swallow embedding errors in background
  }

  private startCron() {
    if (this.cronIntervalId) return;
    this.cronIntervalId = setInterval(() => {
      const now = Date.now();
      let anyFired = false;
      for (const t of this.cronTasks) {
        if (now - t.lastRun >= t.intervalMs) {
          console.log(`[CRON-TRIGGER] Executing cron task: ${t.id} (run #${(t.runCount ?? 0) + 1})`);
          t.lastRun = now;
          t.runCount = (t.runCount ?? 0) + 1;
          anyFired = true;
          runAgentLoopText(
            `[BACKGROUND CRON TRIGGER] Execute scheduled task: ${t.taskPrompt}`,
            [{ role: 'system', content: 'Cron trigger.' }]
          ).then(res => console.log("[Cron Task]", res.substring(0, 80)))
           .catch((e: any) => console.error("Cron failed", e));
        }
      }
      if (anyFired) this.saveState();
    }, 30000);
  }

  public startTelegramPolling() {
    if (this.telegramIntervalId) return;
    this.telegramIntervalId = setInterval(async () => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return;

      // Require explicit TELEGRAM_CHAT_ID — never auto-capture from untrusted senders
      const authId = process.env.TELEGRAM_CHAT_ID;
      if (!authId) {
        console.warn('[POLL] TELEGRAM_CHAT_ID not set. Polling disabled until configured. Use set_env_key("TELEGRAM_CHAT_ID", "<your-chat-id>").');
        return;
      }

      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=10`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            const msg = update.message || update.edited_message;
            if (!msg || !msg.text) continue;

            const chatId = String(msg.chat.id);
            if (chatId !== authId) {
              console.warn(`[POLL] Unauthorized Telegram msg from ${chatId} — ignored.`);
              continue;
            }

            console.log(`[POLL] Processing message from ${chatId}: "${msg.text}"`);
            const model = process.env.VLLM_MODEL || process.env.OLLAMA_MODEL || 'llama3';
            const response = await runAgentLoopText(msg.text, [], { model });
            await sendTelegramMessage(response, chatId);
          }
        }
      } catch {
        // silent — polling errors are transient
      }
    }, 5000);
  }

  public stopTelegramPolling() {
    if (this.telegramIntervalId) {
      clearInterval(this.telegramIntervalId);
      this.telegramIntervalId = null;
    }
  }
}

export const scheduler = new AdvancedScheduler();

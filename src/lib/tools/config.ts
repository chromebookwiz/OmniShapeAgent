// src/lib/tools/config.ts
import fs from 'fs';
import path from 'path';
import {
  deleteTelegramWebhook,
  discoverTelegramChatId,
  getTelegramWebhookInfo,
  verifyTelegramToken,
  setTelegramWebhook,
} from './telegram';

const ENV_PATH = path.join(process.cwd(), '.env.local');

/**
 * Surgically updates or adds a key-value pair in .env.local
 */
export function setEnvKey(key: string, value: string): string {
  try {
    let content = '';
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    }

    const regex = new RegExp(`^${key}=.*`, 'm');
    const newLine = `${key}=${value}`;

    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content += `\n${newLine}`;
    }

    fs.writeFileSync(ENV_PATH, content.trim() + '\n', 'utf8');
    // Also update process.env for the current session
    process.env[key] = value;
    
    return `Successfully updated ${key} in .env.local`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error setting environment key: ${message}`;
  }
}

async function refreshTelegramRuntime(mode: 'polling' | 'webhook') {
  const { scheduler } = await import('../scheduler');
  if (mode === 'polling') scheduler.startTelegramPolling();
  else scheduler.stopTelegramPolling();
}

export async function telegramSetup(options: {
  token: string;
  domain?: string;
  chatId?: string;
  mode?: 'polling' | 'webhook';
  dropPendingUpdates?: boolean;
}): Promise<string> {
  const token = options.token?.trim();
  if (!token) return 'Error: Telegram bot token is required.';

  const requestedMode = options.mode ?? (options.domain ? 'webhook' : 'polling');
  const verification = await verifyTelegramToken(token);
  if (!verification.ok) {
    return `Telegram setup failed: ${verification.error}`;
  }

  setEnvKey('TELEGRAM_BOT_TOKEN', token);
  setEnvKey('TELEGRAM_TRANSPORT', requestedMode);

  let webhookLine = 'Webhook disabled.';
  let pendingCapture = false;
  let resolvedChatId = options.chatId?.trim() || '';

  if (requestedMode === 'webhook') {
    if (!options.domain?.trim()) return 'Error: A public domain is required for webhook mode.';
    const webhookUrl = `${options.domain.trim().replace(/\/$/, '')}/api/telegram`;
    webhookLine = await setTelegramWebhook(webhookUrl, token, options.dropPendingUpdates === true);
    setEnvKey('TELEGRAM_WEBHOOK_URL', webhookUrl);
  } else {
    webhookLine = await deleteTelegramWebhook(token, options.dropPendingUpdates === true);
    setEnvKey('TELEGRAM_WEBHOOK_URL', '');
  }

  if (!resolvedChatId) {
    const discovery = await discoverTelegramChatId(token);
    resolvedChatId = discovery.chatId ?? '';
  }

  if (resolvedChatId) {
    setEnvKey('TELEGRAM_CHAT_ID', resolvedChatId);
    setEnvKey('TELEGRAM_SETUP_PENDING', 'false');
  } else {
    pendingCapture = true;
    setEnvKey('TELEGRAM_SETUP_PENDING', 'true');
  }

  await refreshTelegramRuntime(requestedMode);
  const webhookInfo = await getTelegramWebhookInfo(token);

  return [
    'Telegram setup complete.',
    `Bot: ${verification.botName ?? 'Unknown Bot'}${verification.username ? ` (@${verification.username})` : ''}`,
    `Mode: ${requestedMode}`,
    resolvedChatId ? `Authorized chat: ${resolvedChatId}` : 'Authorized chat: pending first private message capture.',
    pendingCapture ? 'Next step: send /start to the bot from the chat you want OmniShapeAgent to own. The runtime will capture that chat ID automatically.' : 'Chat authorization is configured.',
    webhookLine,
    webhookInfo?.url ? `Telegram reports webhook: ${webhookInfo.url}` : 'Telegram reports no active webhook.',
    'Configuration saved to .env.local for the shared OmniShapeAgent instance.',
  ].join('\n');
}

/**
 * Registers the Telegram Webhook and verifies the token.
 */
export async function telegramProvision(token: string, domain: string): Promise<string> {
  return telegramSetup({ token, domain, mode: 'webhook' });
}

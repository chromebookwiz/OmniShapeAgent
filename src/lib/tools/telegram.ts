// src/lib/tools/telegram.ts
// Telegram Bot API helpers for the shared OmniShapeAgent runtime.

export interface TelegramConfig {
  token?: string;
  chatId?: string;
  mode: 'polling' | 'webhook';
  webhookUrl?: string;
  setupPending: boolean;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
}

interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramWebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
}

const TELEGRAM_MESSAGE_LIMIT = 4000;

function getTelegramConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || undefined,
    chatId: process.env.TELEGRAM_CHAT_ID || undefined,
    mode: process.env.TELEGRAM_TRANSPORT === 'webhook' ? 'webhook' : 'polling',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || undefined,
    setupPending: process.env.TELEGRAM_SETUP_PENDING === 'true',
  };
}

function getTelegramApiBase(token?: string): string | null {
  const effectiveToken = token || getTelegramConfig().token;
  return effectiveToken ? `https://api.telegram.org/bot${effectiveToken}` : null;
}

async function telegramRequest<T>(
  method: string,
  payload?: Record<string, unknown>,
  token?: string,
): Promise<TelegramApiResponse<T>> {
  const base = getTelegramApiBase(token);
  if (!base) {
    return { ok: false, description: 'TELEGRAM_BOT_TOKEN not configured in .env.local' };
  }

  const response = await fetch(`${base}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: 'no-store',
  });

  return response.json() as Promise<TelegramApiResponse<T>>;
}

function describeChat(chat: TelegramChat): string {
  return chat.title || chat.username || chat.first_name || String(chat.id);
}

function splitTelegramMessage(message: string): string[] {
  const normalized = message.replace(/\r\n/g, '\n').trim();
  if (!normalized) return ['(empty response)'];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let splitAt = remaining.lastIndexOf('\n', TELEGRAM_MESSAGE_LIMIT);
    if (splitAt < TELEGRAM_MESSAGE_LIMIT * 0.5) {
      splitAt = remaining.lastIndexOf(' ', TELEGRAM_MESSAGE_LIMIT);
    }
    if (splitAt < TELEGRAM_MESSAGE_LIMIT * 0.5) {
      splitAt = TELEGRAM_MESSAGE_LIMIT;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

export async function verifyTelegramToken(token?: string): Promise<{ ok: boolean; botName?: string; username?: string; error?: string }> {
  try {
    const data = await telegramRequest<{ first_name?: string; username?: string }>('getMe', undefined, token);
    if (!data.ok) return { ok: false, error: data.description || 'Telegram getMe failed.' };
    return {
      ok: true,
      botName: data.result?.first_name || 'Unknown Bot',
      username: data.result?.username,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'Telegram getMe failed.' };
  }
}

export async function getTelegramWebhookInfo(token?: string): Promise<TelegramWebhookInfo | null> {
  try {
    const data = await telegramRequest<TelegramWebhookInfo>('getWebhookInfo', undefined, token);
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export async function setTelegramWebhook(webhookUrl: string, token?: string, dropPendingUpdates = false): Promise<string> {
  const data = await telegramRequest<boolean>('setWebhook', { url: webhookUrl, drop_pending_updates: dropPendingUpdates }, token);
  return data.ok ? `Telegram webhook set to ${webhookUrl}.` : `Telegram API Error: ${data.description}`;
}

export async function deleteTelegramWebhook(token?: string, dropPendingUpdates = false): Promise<string> {
  const data = await telegramRequest<boolean>('deleteWebhook', { drop_pending_updates: dropPendingUpdates }, token);
  return data.ok ? 'Telegram webhook cleared.' : `Telegram API Error: ${data.description}`;
}

export async function fetchTelegramUpdates(options?: {
  token?: string;
  limit?: number;
  offset?: number;
  timeout?: number;
}): Promise<TelegramUpdate[]> {
  const payload: Record<string, unknown> = {};
  if (typeof options?.limit === 'number') payload.limit = options.limit;
  if (typeof options?.offset === 'number') payload.offset = options.offset;
  if (typeof options?.timeout === 'number') payload.timeout = options.timeout;
  const data = await telegramRequest<TelegramUpdate[]>('getUpdates', Object.keys(payload).length > 0 ? payload : undefined, options?.token);
  if (!data.ok || !Array.isArray(data.result)) return [];
  return data.result;
}

export async function discoverTelegramChatId(token?: string): Promise<{
  chatId?: string;
  description?: string;
  suggestions: string[];
}> {
  const updates = await fetchTelegramUpdates({ token, limit: 20, timeout: 0 });
  const messages = updates
    .map((update) => update.message || update.edited_message)
    .filter((message): message is TelegramMessage => Boolean(message?.chat?.id));

  if (messages.length === 0) {
    return {
      suggestions: [
        'Send a direct message such as /start to your bot in Telegram.',
        'Run setup again or call the setup endpoint after the message arrives.',
      ],
      description: 'No Telegram messages found yet.',
    };
  }

  const privateMessages = messages.filter((message) => message.chat.type === 'private');
  const candidate = (privateMessages[privateMessages.length - 1] ?? messages[messages.length - 1]);
  return {
    chatId: String(candidate.chat.id),
    description: `Detected Telegram chat ${describeChat(candidate.chat)} (${candidate.chat.id}).`,
    suggestions: [],
  };
}

export function getTelegramRuntimeStatus() {
  const config = getTelegramConfig();
  return {
    configured: Boolean(config.token),
    mode: config.mode,
    chatIdConfigured: Boolean(config.chatId),
    setupPending: config.setupPending,
    webhookUrl: config.webhookUrl ?? null,
    tokenPreview: config.token ? `${config.token.slice(0, 6)}...${config.token.slice(-4)}` : null,
    chatId: config.chatId ?? null,
  };
}

export async function sendTelegramMessage(message: string, chatId?: string): Promise<string> {
  const config = getTelegramConfig();
  if (!config.token) return 'Error: TELEGRAM_BOT_TOKEN not configured in .env.local';

  const targetChatId = chatId || config.chatId;
  if (!targetChatId) return 'Error: No target Chat ID provided or configured.';

  try {
    const chunks = splitTelegramMessage(message);
    for (const chunk of chunks) {
      const data = await telegramRequest<boolean>('sendMessage', {
        chat_id: targetChatId,
        text: chunk,
      }, config.token);

      if (!data.ok) {
        return `Telegram error: ${data.description}`;
      }
    }

    return `Telegram message sent successfully to ${targetChatId}${chunks.length > 1 ? ` in ${chunks.length} parts` : ''}.`;
  } catch (error: unknown) {
    return `Failed to send Telegram: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function getTelegramUpdates(): Promise<string> {
  const config = getTelegramConfig();
  if (!config.token) return 'Error: TELEGRAM_BOT_TOKEN not configured.';

  try {
    const updates = await fetchTelegramUpdates({ token: config.token, limit: 5, timeout: 0 });
    if (updates.length === 0) return 'No new Telegram messages found.';

    const messages = updates
      .map((update) => update.message || update.edited_message)
      .filter((message): message is TelegramMessage => Boolean(message?.chat?.id))
      .map((message) => `[${message.from?.first_name || 'User'}] (${message.chat.id}): ${message.text ?? '<non-text>'}`);

    return messages.length > 0
      ? `Latest Telegram Messages:\n${messages.join('\n')}`
      : 'No new Telegram messages found.';
  } catch (error: unknown) {
    return `Failed to get Telegram updates: ${error instanceof Error ? error.message : String(error)}`;
  }
}

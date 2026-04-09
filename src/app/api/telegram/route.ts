// src/app/api/telegram/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runAgentLoopText } from '@/lib/agent';
import { sendTelegramMessage } from '@/lib/tools/telegram';
import { setEnvKey } from '@/lib/tools/config';

interface TelegramWebhookMessage {
  text?: string;
  chat?: {
    id?: number | string;
    type?: string;
  };
}

interface TelegramWebhookBody {
  message?: TelegramWebhookMessage;
  edited_message?: TelegramWebhookMessage;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TelegramWebhookBody;
    console.log('[Telegram Webhook] Received update:', JSON.stringify(body, null, 2));

    const configuredChatId = process.env.TELEGRAM_CHAT_ID;
    const setupPending = process.env.TELEGRAM_SETUP_PENDING === 'true';

    const message = body.message || body.edited_message;
    if (!message?.text || message.chat?.id === undefined) {
      return NextResponse.json({ ok: true }); // Ignore non-text updates
    }

    const chatId = String(message.chat.id);
    const text = message.text;

    if (!configuredChatId && setupPending && message.chat.type === 'private') {
      setEnvKey('TELEGRAM_CHAT_ID', chatId);
      setEnvKey('TELEGRAM_SETUP_PENDING', 'false');
      await sendTelegramMessage('OmniShapeAgent captured this chat as the authorized Telegram control channel. You can now drive the shared runtime from here.', chatId);
      return NextResponse.json({ ok: true, configuredChatId: chatId });
    }

    // ── Authorization ────────────────────────────────────────────────────────
    if (configuredChatId && chatId !== configuredChatId) {
      console.warn(`[Telegram Webhook] Unauthorized access attempt from Chat ID: ${chatId}`);
      // Optional: sendTelegramMessage("Unauthorized access. Access restricted to configured Chat ID.", chatId);
      return NextResponse.json({ ok: true });
    }

    // ── Cognitive Loop ───────────────────────────────────────────────────────
    // History is empty for now (stateless per-message), but agent uses Semantic Memory
    // which effectively acts as a long-term state.
    console.log(`[Telegram Webhook] Processing message from ${chatId}: "${text}"`);
    
    // Default model if not specified in env
    const model = process.env.VLLM_MODEL || process.env.OLLAMA_MODEL || 'llama3';
    let response: string;
    try {
      response = await runAgentLoopText(text, [], { model });
    } catch (error: unknown) {
      response = `OmniShapeAgent hit an error while processing that message: ${error instanceof Error ? error.message : String(error)}`;
    }

    // ── Reply ───────────────────────────────────────────────────────────────
    console.log(`[Telegram Webhook] Sending reply to ${chatId}: "${response.substring(0, 50)}..."`);
    await sendTelegramMessage(response, chatId);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Telegram Webhook] Error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

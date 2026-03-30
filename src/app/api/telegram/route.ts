// src/app/api/telegram/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runAgentLoopText } from '@/lib/agent';
import { sendTelegramMessage } from '@/lib/tools/telegram';

const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[Telegram Webhook] Received update:', JSON.stringify(body, null, 2));

    const message = body.message || body.edited_message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true }); // Ignore non-text updates
    }

    const chatId = String(message.chat.id);
    const text = message.text;

    // ── Authorization ────────────────────────────────────────────────────────
    if (TELEGRAM_CHAT_ID && chatId !== TELEGRAM_CHAT_ID) {
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
    const response = await runAgentLoopText(text, [], { model });

    // ── Reply ───────────────────────────────────────────────────────────────
    console.log(`[Telegram Webhook] Sending reply to ${chatId}: "${response.substring(0, 50)}..."`);
    await sendTelegramMessage(response, chatId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Telegram Webhook] Error:', err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

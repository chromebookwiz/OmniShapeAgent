import { NextResponse } from 'next/server';
import { telegramSetup } from '@/lib/tools/config';
import { getTelegramRuntimeStatus } from '@/lib/tools/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getTelegramRuntimeStatus());
}

export async function POST(req: Request) {
  try {
    const { token, domain, chatId, mode, dropPendingUpdates } = await req.json() as {
      token?: string;
      domain?: string;
      chatId?: string;
      mode?: 'polling' | 'webhook';
      dropPendingUpdates?: boolean;
    };
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Telegram bot token is required.' }, { status: 400 });
    }

    const summary = await telegramSetup({
      token,
      domain: typeof domain === 'string' ? domain : undefined,
      chatId: typeof chatId === 'string' ? chatId : undefined,
      mode: mode === 'webhook' ? 'webhook' : 'polling',
      dropPendingUpdates: dropPendingUpdates === true,
    });

    return NextResponse.json({ ok: !summary.startsWith('Error:'), summary, status: getTelegramRuntimeStatus() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Telegram setup failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
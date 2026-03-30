import { NextResponse } from 'next/server';
import { listBots, updateBotMetric, stopBot } from '@/lib/tools/bot-manager';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const raw = listBots();
    const bots = raw === 'No bots deployed.' ? [] : JSON.parse(raw);
    return NextResponse.json({ bots });
  } catch (e: any) {
    return NextResponse.json({ bots: [], error: e.message });
  }
}

export async function POST(req: Request) {
  try {
    const { action, botId, metric } = await req.json();
    if (action === 'update_metric') {
      return NextResponse.json({ ok: true, result: updateBotMetric(botId, metric) });
    }
    if (action === 'stop') {
      return NextResponse.json({ ok: true, result: stopBot(botId) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

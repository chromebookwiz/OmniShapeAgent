// /api/subroutine — message bus HTTP bridge for architect ↔ subroutine communication.
// GET  ?id=xxx  — drain pending messages (architect polls for results)
// GET  (no id)  — list all subroutines
// POST           — client reports subroutine done/error/message (called by Chat.tsx subroutine runner)

import { NextResponse } from 'next/server';
import * as bus from '@/lib/subroutine-bus';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    bus.gc();
    return NextResponse.json({ subroutines: bus.listSubroutines() });
  }

  const status = bus.getStatus(id);
  if (!status) {
    return NextResponse.json({ error: 'Subroutine not found', id }, { status: 404 });
  }

  const messages = bus.drainMessages(id);
  return NextResponse.json({ id, ...status, messages, messageCount: messages.length });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { subroutineId, type, content } = body as { subroutineId?: string; type?: string; content?: string };

  if (!subroutineId) {
    return NextResponse.json({ error: 'subroutineId required' }, { status: 400 });
  }

  switch (type) {
    case 'done':
      bus.markDone(subroutineId, content);
      break;
    case 'error':
      bus.markError(subroutineId, content ?? 'Unknown error');
      break;
    case 'message':
      bus.postToArchitect(subroutineId, content ?? '');
      break;
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, subroutineId, type });
}

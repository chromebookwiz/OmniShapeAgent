// src/app/api/terminal/route.ts
// Terminal command approval queue API.
//
// GET  ?action=pending   — returns all pending commands
// GET  (no action)       — returns full queue (all statuses)
// POST { action: 'approve', id }   — execute an approved command
// POST { action: 'deny',    id }   — deny a pending command
// POST { action: 'clear' }         — remove all non-pending commands

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getPendingCommands,
  approveCommand,
  denyCommand,
  clearCompleted,
} from '@/lib/tools/terminal-tools';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action');

    const allCommands = getPendingCommands();

    if (action === 'pending') {
      const pending = allCommands.filter(c => c.status === 'pending');
      return NextResponse.json({ pending, count: pending.length });
    }

    // Default: return full queue with summary stats
    return NextResponse.json({
      commands: allCommands,
      stats: {
        total:    allCommands.length,
        pending:  allCommands.filter(c => c.status === 'pending').length,
        executed: allCommands.filter(c => c.status === 'executed').length,
        denied:   allCommands.filter(c => c.status === 'denied').length,
        error:    allCommands.filter(c => c.status === 'error').length,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, any>;
    const { action, id } = body;

    switch (action) {
      case 'approve': {
        if (!id) {
          return NextResponse.json({ error: 'approve requires: id' }, { status: 400 });
        }
        const result = await approveCommand(String(id));
        const parsed = JSON.parse(result);
        if (parsed.error) {
          return NextResponse.json(parsed, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...parsed });
      }

      case 'deny': {
        if (!id) {
          return NextResponse.json({ error: 'deny requires: id' }, { status: 400 });
        }
        const result = denyCommand(String(id));
        const parsed = JSON.parse(result);
        if (parsed.error) {
          return NextResponse.json(parsed, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...parsed });
      }

      case 'clear': {
        const result = clearCompleted();
        const parsed = JSON.parse(result);
        return NextResponse.json({ ok: true, ...parsed });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Valid: approve, deny, clear` },
          { status: 400 },
        );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

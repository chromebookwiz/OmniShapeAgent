// src/app/api/weights/route.ts
// GET  — returns weightStore.exportManifest() as JSON.
// POST — mutates via { action, ...args }:
//   cleanup { keepTop? }   — prune low-scoring entries (default keepTop=5 per component)
//   delete  { id }         — remove a specific weight entry by id
//   update  { id, performanceScore?, iterations?, metadata? }
//   import  { manifestJson }

import { NextResponse } from 'next/server';
import { weightStore } from '@/lib/weight-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // exportManifest() returns a JSON string — parse it so it embeds cleanly
    const manifestJson = weightStore.exportManifest();
    const manifest = JSON.parse(manifestJson);
    return NextResponse.json(manifest);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, any>;
    const { action } = body;

    switch (action) {
      case 'cleanup': {
        const keepTop = body.keepTop !== undefined ? Number(body.keepTop) : 5;
        if (!Number.isFinite(keepTop) || keepTop < 1) {
          return NextResponse.json({ error: 'keepTop must be a positive integer.' }, { status: 400 });
        }
        const removed = weightStore.cleanup(keepTop);
        return NextResponse.json({ ok: true, removed, keepTop });
      }

      case 'delete': {
        const { id } = body;
        if (!id) {
          return NextResponse.json({ error: 'delete requires: id' }, { status: 400 });
        }
        const ok = weightStore.delete(String(id));
        if (!ok) {
          return NextResponse.json({ error: `Weight entry ${id} not found.` }, { status: 404 });
        }
        return NextResponse.json({ ok: true, deleted: id });
      }

      case 'update': {
        const { id, performanceScore, iterations, metadata } = body;
        if (!id) {
          return NextResponse.json({ error: 'update requires: id' }, { status: 400 });
        }
        const score = performanceScore !== undefined ? Number(performanceScore) : 0;
        if (!Number.isFinite(score)) {
          return NextResponse.json({ error: 'performanceScore must be numeric.' }, { status: 400 });
        }
        const entry = weightStore.update(String(id), score, iterations !== undefined ? Number(iterations) : undefined, metadata ?? {});
        if (!entry) {
          return NextResponse.json({ error: `Weight entry ${id} not found.` }, { status: 404 });
        }
        return NextResponse.json({ ok: true, entry });
      }

      case 'import': {
        if (!body.manifestJson) {
          return NextResponse.json({ error: 'import requires: manifestJson' }, { status: 400 });
        }
        const imported = weightStore.importManifest(String(body.manifestJson));
        return NextResponse.json({ ok: true, imported });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Valid: cleanup, delete, update, import` },
          { status: 400 },
        );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

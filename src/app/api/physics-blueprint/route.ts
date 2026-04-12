import { NextResponse } from 'next/server';

import { deletePhysicsBlueprint, getPhysicsBlueprint, listPhysicsBlueprints, savePhysicsBlueprint } from '@/lib/physics-blueprint-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const blueprintId = url.searchParams.get('id');
    if (!blueprintId) {
      return NextResponse.json({ blueprints: listPhysicsBlueprints() });
    }
    const blueprint = getPhysicsBlueprint(blueprintId);
    if (!blueprint) {
      return NextResponse.json({ error: `Blueprint ${blueprintId} not found.` }, { status: 404 });
    }
    return NextResponse.json({ blueprint });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, any>;
    const action = String(body.action ?? 'save');
    if (action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'delete requires: id' }, { status: 400 });
      const deleted = deletePhysicsBlueprint(String(body.id));
      return NextResponse.json({ ok: deleted, deleted: String(body.id) });
    }

    const blueprint = savePhysicsBlueprint({
      id: typeof body.id === 'string' ? body.id : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      templates: Array.isArray(body.templates) ? body.templates : undefined,
      parts: Array.isArray(body.parts) ? body.parts : undefined,
      hinges: Array.isArray(body.hinges) ? body.hinges : undefined,
      bodyPlan: Array.isArray(body.bodyPlan) ? body.bodyPlan : undefined,
      settings: body.settings && typeof body.settings === 'object' ? body.settings : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json({ ok: true, blueprint });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Internal error' }, { status: 500 });
  }
}

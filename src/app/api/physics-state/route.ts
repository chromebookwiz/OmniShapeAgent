import { NextResponse } from 'next/server';
import { setPhysicsState, getPhysicsState } from '@/lib/physics-state-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Browser (PhysicsSimulator) POSTs state here after get_state / run_training_loop
export async function POST(req: Request) {
  const data = await req.json();
  setPhysicsState(data);
  return NextResponse.json({ ok: true });
}

// Agent tool physics_get_state GETs from here (or imports store directly)
export async function GET() {
  const s = getPhysicsState();
  if (!s) {
    return NextResponse.json({ state: null, message: 'No physics state yet. Send a get_state command to the physics window first.' });
  }
  return NextResponse.json(s);
}

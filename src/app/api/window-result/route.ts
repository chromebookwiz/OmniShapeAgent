import { NextResponse } from 'next/server';
import { setWindowResult, getWindowResult } from '@/lib/window-result-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Iframe/WindowManager POSTs here when a window loads or errors
export async function POST(req: Request) {
  const { id, status, error } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  setWindowResult(id, status, error);
  return NextResponse.json({ ok: true });
}

// Agent tool check_window_result GETs here
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const result = getWindowResult(id);
  if (!result) {
    return NextResponse.json({ status: 'pending', message: 'Window result not yet received. The window may still be loading.' });
  }
  return NextResponse.json(result);
}

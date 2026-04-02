import { NextResponse } from 'next/server';

import { omniShapeResonator } from '@/lib/olr';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? 'stats';
    if (action === 'stats') {
      const language = url.searchParams.get('language') ?? undefined;
      return NextResponse.json({ ok: true, stats: omniShapeResonator.stats(language) });
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'OLR route failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action ?? 'analyze';

    if (action === 'analyze') {
      if (!body.text || typeof body.text !== 'string') {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
      }
      const analysis = omniShapeResonator.analyzeText(body.text, {
        languageHint: body.languageHint,
        learn: body.learn === true,
        theme: body.theme,
        render: body.render !== false,
        preferPython: body.preferPython !== false,
      });
      return NextResponse.json({ ok: true, analysis });
    }

    if (action === 'compare') {
      if (!body.textA || !body.textB) {
        return NextResponse.json({ error: 'textA and textB are required' }, { status: 400 });
      }
      const comparison = omniShapeResonator.compareTexts(body.textA, body.textB, {
        languageHintA: body.languageHintA,
        languageHintB: body.languageHintB,
        learn: body.learn === true,
      });
      return NextResponse.json({ ok: true, comparison });
    }

    if (action === 'set_gate') {
      if (!body.language || !body.from || !body.to) {
        return NextResponse.json({ error: 'language, from, and to are required' }, { status: 400 });
      }
      const updated = omniShapeResonator.setGateWeights(String(body.language), String(body.from), String(body.to), Number(body.virtue ?? 0), Number(body.entropy ?? 0));
      if (!updated) return NextResponse.json({ error: 'language not found' }, { status: 404 });
      return NextResponse.json({ ok: true, gate: updated });
    }

    if (action === 'reset') {
      omniShapeResonator.reset(body.language);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'OLR route failed' }, { status: 500 });
  }
}
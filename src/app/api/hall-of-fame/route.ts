// src/app/api/hall-of-fame/route.ts
// GET  — returns the full Hall of Fame as JSON.
// POST — mutates via { action, ...args }:
//   enroll       { botId, goal, url, peakMetric, iterations?, strategies?, weightPath?, peakMetricLabel?, runtimeMs? }
//   retire       { id }
//   name         { id, name }
//   hallmark     { id, hallmark }
//   update_metric{ id, metric, iteration }

import { NextResponse } from 'next/server';
import { hallOfFame } from '@/lib/hall-of-fame';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rankings = hallOfFame.getRankings();
    return NextResponse.json({
      total:    rankings.length,
      active:   rankings.filter(c => !c.retired).length,
      retired:  rankings.filter(c =>  c.retired).length,
      champions: rankings,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, any>;
    const { action } = body;

    switch (action) {
      case 'enroll': {
        const {
          botId,
          goal,
          url,
          peakMetric,
          iterations      = 0,
          strategies      = [],
          weightPath,
          peakMetricLabel = 'score',
          runtimeMs       = 0,
        } = body;

        if (!botId || !goal || !url || peakMetric === undefined) {
          return NextResponse.json(
            { error: 'enroll requires: botId, goal, url, peakMetric' },
            { status: 400 },
          );
        }

        const champion = hallOfFame.enroll(
          String(botId),
          String(goal),
          String(url),
          Number(peakMetric),
          Number(iterations),
          Array.isArray(strategies) ? strategies.map(String) : [],
          weightPath ? String(weightPath) : undefined,
          String(peakMetricLabel),
          Number(runtimeMs),
        );
        return NextResponse.json({ ok: true, champion });
      }

      case 'retire': {
        const { id } = body;
        if (!id) return NextResponse.json({ error: 'retire requires: id' }, { status: 400 });
        const ok = hallOfFame.retire(String(id));
        if (!ok) return NextResponse.json({ error: `Champion ${id} not found.` }, { status: 404 });
        return NextResponse.json({ ok: true, id });
      }

      case 'name': {
        const { id, name } = body;
        if (!id || !name) {
          return NextResponse.json({ error: 'name requires: id, name' }, { status: 400 });
        }
        const champion = hallOfFame.getChampion(String(id));
        if (!champion) {
          return NextResponse.json({ error: `Champion ${id} not found.` }, { status: 404 });
        }
        // HallOfFame doesn't expose a rename method; mutate via autoName / stored state
        champion.name = String(name);
        // Re-enroll to persist (enroll is idempotent for existing ids)
        hallOfFame.enroll(
          champion.id,
          champion.goal,
          champion.url,
          champion.peakMetric,
          champion.totalIterations,
          champion.strategies,
          champion.weightPath,
          champion.peakMetricLabel,
          0,
        );
        return NextResponse.json({ ok: true, id, name });
      }

      case 'hallmark': {
        const { id, hallmark } = body;
        if (!id || !hallmark) {
          return NextResponse.json({ error: 'hallmark requires: id, hallmark' }, { status: 400 });
        }
        const ok = hallOfFame.addHallmark(String(id), String(hallmark));
        if (!ok) return NextResponse.json({ error: `Champion ${id} not found.` }, { status: 404 });
        return NextResponse.json({ ok: true, id, hallmark });
      }

      case 'update_metric': {
        const { id, metric, iteration = 0 } = body;
        if (!id || metric === undefined) {
          return NextResponse.json(
            { error: 'update_metric requires: id, metric' },
            { status: 400 },
          );
        }
        const champion = hallOfFame.updateMetric(String(id), Number(metric), Number(iteration));
        if (!champion) {
          return NextResponse.json({ error: `Champion ${id} not found.` }, { status: 404 });
        }
        return NextResponse.json({ ok: true, champion });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action "${action}". Valid: enroll, retire, name, hallmark, update_metric` },
          { status: 400 },
        );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

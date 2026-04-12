import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { ensureWorkspacePaths } from '@/lib/paths-bootstrap';
import { WEIGHTS_DIR } from '@/lib/paths-core';
import { weightStore } from '@/lib/weight-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PHYSICS_CONTROLLER_DIR = path.join(WEIGHTS_DIR, 'physics');

function sanitizeControllerId(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `physics-controller-${Date.now()}`;
}

function ensureControllerDir() {
  ensureWorkspacePaths();
  fs.mkdirSync(PHYSICS_CONTROLLER_DIR, { recursive: true });
}

function getControllerPath(controllerId: string): string {
  return path.join(PHYSICS_CONTROLLER_DIR, `${sanitizeControllerId(controllerId)}.json`);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export async function GET(req: Request) {
  try {
    ensureControllerDir();
    const url = new URL(req.url);
    const controllerId = url.searchParams.get('id');

    if (!controllerId) {
      const entries = weightStore.listByComponent('physics').map((entry) => ({
        id: entry.id,
        name: entry.name,
        filepath: entry.filepath,
        performanceScore: entry.performanceScore,
        iterations: entry.iterations,
        metadata: entry.metadata,
        updated: entry.updated,
      }));
      return NextResponse.json({ controllers: entries });
    }

    const safeId = sanitizeControllerId(controllerId);
    const filePath = getControllerPath(safeId);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: `Controller ${safeId} not found.` }, { status: 404 });
    }

    const controller = readJsonFile(filePath);
    return NextResponse.json({ controllerId: safeId, controller });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    ensureControllerDir();
    const body = await req.json() as Record<string, any>;
    const action = String(body.action ?? 'save');

    if (action === 'delete') {
      if (!body.controllerId) {
        return NextResponse.json({ error: 'delete requires: controllerId' }, { status: 400 });
      }
      const safeId = sanitizeControllerId(String(body.controllerId));
      const filePath = getControllerPath(safeId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const existing = weightStore.listByComponent('physics').find((entry) => entry.metadata?.controllerId === safeId || entry.name === safeId);
      if (existing) weightStore.delete(existing.id);
      return NextResponse.json({ ok: true, deleted: safeId });
    }

    const safeId = sanitizeControllerId(String(body.controllerId ?? body.name ?? `physics-controller-${Date.now()}`));
    const controller = body.controller;
    if (!controller || typeof controller !== 'object') {
      return NextResponse.json({ error: 'controller payload is required.' }, { status: 400 });
    }

    const filePath = getControllerPath(safeId);
    fs.writeFileSync(filePath, JSON.stringify(controller, null, 2));
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(WEIGHTS_DIR, filePath).replace(/\\/g, '/');
    const performanceScore = Number(body.performanceScore ?? controller.bestReward ?? 0);
    const iterations = Math.max(0, Number(body.iterations ?? controller.training?.generations ?? 0));
    const metadata = {
      ...(body.metadata ?? {}),
      controllerId: safeId,
      rootId: controller.rootId ?? null,
      hingeCount: Array.isArray(controller.hingeIds) ? controller.hingeIds.length : 0,
      bestReward: controller.bestReward ?? null,
    };

    const existing = weightStore.listByComponent('physics').find((entry) => entry.metadata?.controllerId === safeId || entry.name === safeId);
    const entry = existing
      ? weightStore.update(existing.id, performanceScore, iterations, { ...existing.metadata, ...metadata })
      : weightStore.register('physics', safeId, relativePath, stat.size, performanceScore, iterations, metadata);

    return NextResponse.json({ ok: true, controllerId: safeId, filepath: filePath, entry });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Internal error' }, { status: 500 });
  }
}
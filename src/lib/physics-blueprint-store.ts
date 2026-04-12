import fs from 'fs';
import path from 'path';

import { ensureWorkspacePaths } from './paths-bootstrap';
import { DATA_DIR } from './paths-core';

export type PhysicsBlueprint = {
  id: string;
  name: string;
  templates?: Array<Record<string, unknown>>;
  parts?: Array<Record<string, unknown>>;
  hinges?: Array<Record<string, unknown>>;
  bodyPlan?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};

const BLUEPRINT_DIR = path.join(DATA_DIR, 'physics-blueprints');

function ensureBlueprintDir() {
  ensureWorkspacePaths();
  fs.mkdirSync(BLUEPRINT_DIR, { recursive: true });
}

export function sanitizeBlueprintId(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `physics-blueprint-${Date.now()}`;
}

function getBlueprintPath(id: string) {
  return path.join(BLUEPRINT_DIR, `${sanitizeBlueprintId(id)}.json`);
}

export function listPhysicsBlueprints() {
  ensureBlueprintDir();
  return fs.readdirSync(BLUEPRINT_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const filePath = path.join(BLUEPRINT_DIR, entry);
      const blueprint = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PhysicsBlueprint;
      return {
        id: blueprint.id,
        name: blueprint.name,
        updatedAt: blueprint.updatedAt,
        createdAt: blueprint.createdAt,
        partCount: Array.isArray(blueprint.parts) ? blueprint.parts.length : Array.isArray(blueprint.bodyPlan) ? blueprint.bodyPlan.length : 0,
        hasBodyPlan: Array.isArray(blueprint.bodyPlan) && blueprint.bodyPlan.length > 0,
        hasLayout: Array.isArray(blueprint.parts) && blueprint.parts.length > 0,
        settings: blueprint.settings ?? {},
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPhysicsBlueprint(id: string): PhysicsBlueprint | null {
  ensureBlueprintDir();
  const filePath = getBlueprintPath(id);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PhysicsBlueprint;
}

export function savePhysicsBlueprint(input: {
  id?: string;
  name?: string;
  templates?: Array<Record<string, unknown>>;
  parts?: Array<Record<string, unknown>>;
  hinges?: Array<Record<string, unknown>>;
  bodyPlan?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
  notes?: string;
}) {
  ensureBlueprintDir();
  const id = sanitizeBlueprintId(input.id || input.name || `physics-blueprint-${Date.now()}`);
  const filePath = getBlueprintPath(id);
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as PhysicsBlueprint : null;
  const now = Date.now();
  const blueprint: PhysicsBlueprint = {
    id,
    name: input.name?.trim() || existing?.name || id,
    templates: input.templates ?? existing?.templates ?? [],
    parts: input.parts ?? existing?.parts ?? [],
    hinges: input.hinges ?? existing?.hinges ?? [],
    bodyPlan: input.bodyPlan ?? existing?.bodyPlan ?? [],
    settings: input.settings ?? existing?.settings ?? {},
    notes: input.notes ?? existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  fs.writeFileSync(filePath, JSON.stringify(blueprint, null, 2));
  return blueprint;
}

export function deletePhysicsBlueprint(id: string) {
  ensureBlueprintDir();
  const filePath = getBlueprintPath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

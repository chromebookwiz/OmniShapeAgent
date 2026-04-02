import fs from 'fs';
import { REQUIRED_DIRS } from './paths-core';

let initialized = false;

export function ensureWorkspacePaths(): void {
  if (initialized) return;
  initialized = true;

  for (const dir of REQUIRED_DIRS) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
}
// src/lib/paths.ts
// Central workspace path constants for the ShapeAgent data layer.
//
// All persistent data lives under subdirectories of ROOT.
// On first use, any legacy file still sitting in ROOT is automatically
// migrated to its canonical location — no data is lost.

export * from './paths-core';

import { ensureWorkspacePaths as ensureRequiredWorkspacePaths } from './paths-bootstrap';
import { migrateLegacyWorkspaceData } from './paths-migrations';

export function ensureWorkspacePaths(): void {
	ensureRequiredWorkspacePaths();
	migrateLegacyWorkspaceData();
}

export { migrateLegacyWorkspaceData };

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ALLOWED_DIRS = [
  path.join(process.cwd(), 'screenshots'),
  path.join(process.cwd(), 'public'),
  path.join(process.cwd(), 'output'),
  path.join(process.cwd(), 'data'),
  '/tmp',
  os.tmpdir(), // handles Windows %TEMP% as well
];

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  txt: 'text/plain',
  json: 'application/json',
};

function isAllowedPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return ALLOWED_DIRS.some(dir => resolved.startsWith(dir + path.sep) || resolved.startsWith(dir));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get('path');
    if (!filePath) {
      return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
    }

    const decodedPath = decodeURIComponent(filePath);
    if (!isAllowedPath(decodedPath)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const resolvedPath = path.resolve(decodedPath);
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const ext = resolvedPath.split('.').pop()?.toLowerCase() ?? '';
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const fileBuffer = fs.readFileSync(resolvedPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(stat.size),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

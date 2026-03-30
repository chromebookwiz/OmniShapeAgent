export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { parseFile } from '../../../lib/file-parser';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mime = file.type || '';
    const name = file.name || 'upload';

    // Images — return as base64 data URL for inline display
    if (mime.startsWith('image/')) {
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
      return NextResponse.json({ name, type: mime, isImage: true, dataUrl });
    }

    const parsed = await parseFile(name, mime, buffer);
    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

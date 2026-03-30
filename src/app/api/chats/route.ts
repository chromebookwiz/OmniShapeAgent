import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const SAVED_CHATS_DIR = path.join(process.cwd(), 'saved_chats');

async function ensureDir() {
  await fs.mkdir(SAVED_CHATS_DIR, { recursive: true });
}

// GET ?id=<chatId>  → full chat
// GET               → list (id, name, createdAt, updatedAt, summary, messageCount)
export async function GET(req: Request) {
  await ensureDir();
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get('id');

    if (chatId) {
      const filePath = path.join(SAVED_CHATS_DIR, `${chatId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return NextResponse.json({ chat: JSON.parse(content) });
    }

    const files = await fs.readdir(SAVED_CHATS_DIR);
    const chats = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async file => {
          const content = await fs.readFile(path.join(SAVED_CHATS_DIR, file), 'utf-8');
          const parsed = JSON.parse(content);
          return {
            id:           parsed.id,
            name:         parsed.name,
            createdAt:    parsed.createdAt,
            updatedAt:    parsed.updatedAt ?? parsed.createdAt,
            summary:      parsed.summary ?? null,
            messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
          };
        })
    );

    // Sort newest first by updatedAt
    chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return NextResponse.json({ chats });
  } catch (err) {
    console.error('[API Chats] GET error', err);
    return NextResponse.json({ chats: [], error: String(err) }, { status: 500 });
  }
}

// POST { name, messages, summary? } → create new chat, return { id, name, createdAt }
export async function POST(req: Request) {
  await ensureDir();
  try {
    const body = await req.json();
    const { name = 'chat', messages, summary } = body;

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const saved = { id, name, createdAt: now, updatedAt: now, summary: summary ?? null, messages };

    await fs.writeFile(path.join(SAVED_CHATS_DIR, `${id}.json`), JSON.stringify(saved, null, 2), 'utf-8');

    return NextResponse.json({ success: true, id, name, createdAt: now, updatedAt: now, summary: saved.summary });
  } catch (err) {
    console.error('[API Chats] POST error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT { id, name, messages, summary? } → update existing chat in-place
export async function PUT(req: Request) {
  await ensureDir();
  try {
    const body = await req.json();
    const { id, name, messages, summary } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (!Array.isArray(messages)) return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });

    const filePath = path.join(SAVED_CHATS_DIR, `${id}.json`);

    // Read existing to preserve createdAt and original summary
    let existing: any = {};
    try {
      existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch { /* new file */ }

    const now = new Date().toISOString();
    const saved = {
      id,
      name:       name ?? existing.name ?? 'chat',
      createdAt:  existing.createdAt ?? now,
      updatedAt:  now,
      // Only update summary if explicitly provided; preserve existing summary otherwise
      summary:    summary !== undefined ? summary : (existing.summary ?? null),
      messages,
    };

    await fs.writeFile(filePath, JSON.stringify(saved, null, 2), 'utf-8');

    return NextResponse.json({ success: true, id, name: saved.name, updatedAt: now });
  } catch (err) {
    console.error('[API Chats] PUT error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE ?id=<chatId>
export async function DELETE(req: Request) {
  await ensureDir();
  try {
    const url = new URL(req.url);
    const chatId = url.searchParams.get('id');
    if (!chatId) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await fs.unlink(path.join(SAVED_CHATS_DIR, `${chatId}.json`));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Chats] DELETE error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { generateEmbedding } from '@/lib/embeddings';
import { vectorStore } from '@/lib/vector-store';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const { from, to, subject, text, html, provider } = payload;

    const body = text || (html ? 'HTML content omitted in store' : '');
    const content = `EMAIL inbound\nfrom: ${from}\nto: ${to}\nsubject: ${subject}\nprovider: ${provider || 'unknown'}\n\n${body}`;

    const emb = await generateEmbedding(content);
    vectorStore.upsert({
      content,
      embedding: emb,
      dim: emb.length,
      importance: 1.0,
      metadata: { source: 'system', topic: 'email_inbound', tags: ['email', 'webhook'] }
    });

    return NextResponse.json({ status: 'ok', saved: true });
  } catch (error: any) {
    console.error('Email webhook error:', error);
    return NextResponse.json({ error: error.message || 'Invalid email webhook payload' }, { status: 400 });
  }
}

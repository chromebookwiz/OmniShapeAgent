import { NextResponse } from 'next/server';
import { vectorStore } from '@/lib/vector-store';
import { generateEmbedding } from '@/lib/embeddings';
import { knowledgeGraph } from '@/lib/knowledge-graph';
import { userProfile } from '@/lib/user-profile';
import { memoryPolicy } from '@/lib/memory-policy';

export const dynamic = 'force-dynamic';

// ── GET /api/memory ──────────────────────────────────────────────────────────
// ?action=stats           → memory + graph stats
// ?action=recent&limit=N  → N most recent memories
// ?action=important&limit=N → N highest-importance memories
// ?action=accessed&limit=N  → N most-accessed memories
// ?action=tags&tags=a,b   → filter by tags
// ?action=profile         → user profile
// ?action=graph&entity=X  → knowledge graph
// ?q=query&limit=N        → semantic search

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const q = url.searchParams.get('q');
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 200);

    // Semantic search
    if (q) {
      const embedding = await generateEmbedding(q);
      const results = vectorStore.search(embedding, limit, q);
      const textResults = vectorStore.searchByText(q, limit);

      const seenIds = new Set(results.map(r => r.record.id));
      const merged = [
        ...results.map(r => ({
          id: r.record.id,
          content: r.record.content,
          score: r.score,
          similarity: r.similarity,
          geometry: r.record.geometry
            ? {
                shapeKey: r.record.geometry.shapeKey,
                repetitionCount: r.record.geometry.repetitionCount,
                repetitionScore: r.record.geometry.repetitionScore,
                virtue: r.record.geometry.virtue,
              }
            : null,
          importance: r.record.importance,
          accessCount: r.record.accessCount,
          tags: r.record.metadata.tags ?? [],
          cognitiveLayer: r.record.metadata.cognitiveLayer,
          taskSalience: r.record.metadata.taskSalience,
          emotion: r.record.metadata.emotion,
          triggerKeywords: r.record.metadata.triggerKeywords ?? [],
          suppressedUntil: r.record.metadata.suppressedUntil ?? null,
          source: r.record.metadata.source,
          topic: r.record.metadata.topic,
          createdAt: r.record.createdAt,
          lastAccessedAt: r.record.lastAccessedAt,
          searchType: 'semantic' as const,
        })),
        ...textResults
          .filter(r => !seenIds.has(r.id))
          .map(r => ({
            id: r.id,
            content: r.content,
            score: r.importance * 0.5,
            similarity: 0,
            importance: r.importance,
            accessCount: r.accessCount,
            tags: r.metadata.tags ?? [],
            cognitiveLayer: r.metadata.cognitiveLayer,
            taskSalience: r.metadata.taskSalience,
            emotion: r.metadata.emotion,
            triggerKeywords: r.metadata.triggerKeywords ?? [],
            suppressedUntil: r.metadata.suppressedUntil ?? null,
            source: r.metadata.source,
            topic: r.metadata.topic,
            createdAt: r.createdAt,
            lastAccessedAt: r.lastAccessedAt,
            searchType: 'text' as const,
          })),
      ].slice(0, limit);

      return NextResponse.json({ results: merged, query: q, total: merged.length });
    }

    if (action === 'stats') {
      const memStats = vectorStore.getStats();
      const graphEntities = knowledgeGraph.getAllEntities();
      const topEntities = graphEntities
        .sort((a, b) => b.mentionCount - a.mentionCount)
        .slice(0, 10)
        .map(e => ({ label: e.label, type: e.type, mentions: e.mentionCount, importance: e.importance }));

      return NextResponse.json({
        memory: {
          ...memStats,
          oldestDate: memStats.oldestMs ? new Date(memStats.oldestMs).toISOString() : null,
          newestDate: memStats.newestMs ? new Date(memStats.newestMs).toISOString() : null,
        },
        graph: {
          entities: graphEntities.length,
          relations: knowledgeGraph.getAllRelations().length,
          topEntities,
        },
        policy: memoryPolicy.summary(),
        profile: userProfile.get(),
      });
    }

    if (action === 'recent') {
      const records = vectorStore.getRecent(limit);
      return NextResponse.json({ records: serializeRecords(records), total: records.length });
    }

    if (action === 'important') {
      const records = vectorStore.getImportant(limit);
      return NextResponse.json({ records: serializeRecords(records), total: records.length });
    }

    if (action === 'accessed') {
      const records = vectorStore.getMostAccessed(limit);
      return NextResponse.json({ records: serializeRecords(records), total: records.length });
    }

    if (action === 'tags') {
      const tags = (url.searchParams.get('tags') ?? '').split(',').map(t => t.trim()).filter(Boolean);
      if (tags.length === 0) return NextResponse.json({ error: 'Provide ?tags=tag1,tag2' }, { status: 400 });
      const records = vectorStore.searchByTagLattice(tags, limit);
      return NextResponse.json({ records: serializeRecords(records), total: records.length, tags });
    }

    if (action === 'lattice') {
      const id = url.searchParams.get('id') ?? undefined;
      return NextResponse.json({ lattice: vectorStore.getLattice(id, limit) });
    }

    if (action === 'profile') {
      return NextResponse.json(userProfile.toJSON());
    }

    if (action === 'graph') {
      const entity = url.searchParams.get('entity');
      if (entity) return NextResponse.json({ description: knowledgeGraph.describeEntity(entity) });
      const entities = knowledgeGraph.getAllEntities()
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 50);
      return NextResponse.json({ entities, total: knowledgeGraph.entityCount });
    }

    const stats = vectorStore.getStats();
    return NextResponse.json({ stats, total: vectorStore.size });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── POST /api/memory ─────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { content, importance, tags, source, cognitiveLayer, taskScope, taskSalience, emotion, triggerKeywords } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });
    const embedding = await generateEmbedding(content);
    const record = vectorStore.upsert({
      content: content.trim(),
      embedding,
      dim: embedding.length,
      importance: Math.max(0.1, Math.min(2.0, importance ?? 1.0)),
      metadata: {
        source: source ?? 'user',
        tags: Array.isArray(tags) ? tags : [],
        cognitiveLayer,
        taskScope,
        taskSalience,
        emotion,
        triggerKeywords: Array.isArray(triggerKeywords) ? triggerKeywords : [],
      },
    });
    return NextResponse.json({ ok: true, id: record.id, content: record.content });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── DELETE /api/memory?id=xxx ────────────────────────────────────────────────

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const action = url.searchParams.get('action');
    if (action === 'clear') {
      vectorStore.clear();
      memoryPolicy.clear();
      return NextResponse.json({ ok: true, cleared: 'all' });
    }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    vectorStore.delete(id);
    return NextResponse.json({ ok: true, deleted: id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── PATCH /api/memory?id=xxx ─────────────────────────────────────────────────

export async function PATCH(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    const body = await req.json();
    const { boost, action } = body;
    if (action === 'maintain') {
      return NextResponse.json({ ok: true, result: vectorStore.maintenancePass({
        pruneThreshold: body.threshold ?? 0.05,
        maxUnacknowledgedStreak: body.maxStreak ?? 4,
        minInjectionCount: body.minInjectionCount ?? 4,
        maxImportance: body.maxImportance ?? 0.9,
        rebuildLattice: body.rebuildLattice !== false,
      }) });
    }
    if (action === 'rebuild_lattice') {
      return NextResponse.json({ ok: true, rebuilt: vectorStore.rebuildLattice(body.limitNeighbors ?? 6) });
    }
    if (action === 'reset_policy') {
      memoryPolicy.clear();
      return NextResponse.json({ ok: true, policy: memoryPolicy.summary() });
    }
    if (action === 'clear') {
      vectorStore.clear();
      return NextResponse.json({ ok: true, cleared: 'memory' });
    }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (action === 'ack') {
      return NextResponse.json({ ok: vectorStore.acknowledge(id, body.strength ?? 1), id });
    }
    if (action === 'reject') {
      return NextResponse.json({ ok: vectorStore.reject(id, body.strength ?? 1), id });
    }
    vectorStore.boost(id, boost ?? 0.5);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function serializeRecords(records: import('@/lib/vector-store').MemoryRecord[]) {
  return records.map(r => ({
    id: r.id,
    content: r.content,
    importance: r.importance,
    accessCount: r.accessCount,
    tags: r.metadata.tags ?? [],
    cognitiveLayer: r.metadata.cognitiveLayer,
    taskSalience: r.metadata.taskSalience,
    emotion: r.metadata.emotion,
    triggerKeywords: r.metadata.triggerKeywords ?? [],
    suppressedUntil: r.metadata.suppressedUntil ?? null,
    source: r.metadata.source,
    topic: r.metadata.topic,
    geometry: r.geometry
      ? {
          shapeKey: r.geometry.shapeKey,
          repetitionCount: r.geometry.repetitionCount,
          repetitionScore: r.geometry.repetitionScore,
          virtue: r.geometry.virtue,
        }
      : null,
    createdAt: r.createdAt,
    lastAccessedAt: r.lastAccessedAt,
  }));
}

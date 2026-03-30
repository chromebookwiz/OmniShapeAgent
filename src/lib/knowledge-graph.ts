// src/lib/knowledge-graph.ts
// Explicit typed entity-relationship graph.
// Stores named entities and the semantic relationships between them.
// Persisted to knowledge_graph.json.

import fs from 'fs';
import path from 'path';

import { PATHS } from './paths';
const GRAPH_PATH = PATHS.knowledgeGraph;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType = 
  | 'person' | 'place' | 'concept' | 'fact' | 'preference'
  | 'goal' | 'tool' | 'event' | 'organization' | 'other';

export type RelationType =
  | 'knows' | 'has' | 'is' | 'wants' | 'created' | 'uses'
  | 'related_to' | 'opposite_of' | 'part_of' | 'leads_to' | 'fears'
  | 'prefers' | 'owns' | 'works_at' | 'lives_in' | 'mentioned_with';

export interface Entity {
  id: string;           // Normalized entity name (lowercase, stripped)
  label: string;        // Display name
  type: EntityType;
  description?: string;
  importance: number;   // 1.0 default, increases with connections
  createdAt: number;
  updatedAt: number;
  mentionCount: number;
}

export interface Relation {
  id: string;
  from: string;         // Entity id
  to: string;           // Entity id
  relation: RelationType;
  weight: number;       // 0.0–1.0
  context?: string;     // The sentence/message that created this relation
  createdAt: number;
}

interface GraphData {
  entities: Record<string, Entity>;
  relations: Relation[];
}

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

class KnowledgeGraph {
  private entities: Map<string, Entity> = new Map();
  private relations: Relation[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(GRAPH_PATH)) {
        const data: GraphData = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf-8'));
        for (const [k, v] of Object.entries(data.entities || {})) {
          this.entities.set(k, v);
        }
        this.relations = data.relations || [];
        console.log(`[Graph] Loaded ${this.entities.size} entities, ${this.relations.length} relations.`);
      }
    } catch (e) {
      console.error('[Graph] Load failed:', e);
    }
  }

  private save() {
    try {
      const data: GraphData = {
        entities: Object.fromEntries(this.entities),
        relations: this.relations,
      };
      fs.writeFileSync(GRAPH_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[Graph] Save failed:', e);
    }
  }

  private normalizeId(name: string): string {
    if (!name || typeof name !== 'string') return 'unknown_entity';
    return name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_').substring(0, 64);
  }

  // ── Entity Operations ─────────────────────────────────────────────────────

  addEntity(label: string, type: EntityType = 'other', description?: string): Entity {
    const id = this.normalizeId(label);
    const existing = this.entities.get(id);

    if (existing) {
      existing.mentionCount++;
      existing.updatedAt = Date.now();
      if (description) existing.description = description;
      this.save();
      return existing;
    }

    const entity: Entity = {
      id,
      label,
      type,
      description,
      importance: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mentionCount: 1,
    };
    this.entities.set(id, entity);
    this.save();
    return entity;
  }

  getEntity(name: string): Entity | undefined {
    return this.entities.get(this.normalizeId(name));
  }

  // ── Relation Operations ────────────────────────────────────────────────────

  addRelation(
    fromLabel: string,
    relation: RelationType,
    toLabel: string,
    context?: string,
    weight: number = 0.8,
  ): Relation {
    const fromId = this.normalizeId(fromLabel);
    const toId = this.normalizeId(toLabel);

    // Ensure both entities exist
    if (!this.entities.has(fromId)) this.addEntity(fromLabel);
    if (!this.entities.has(toId)) this.addEntity(toLabel);

    // Avoid duplicate relations — bump weight instead
    const existing = this.relations.find(
      r => r.from === fromId && r.to === toId && r.relation === relation
    );
    if (existing) {
      existing.weight = Math.min(1.0, existing.weight + 0.1);
      existing.context = context;
      this.save();
      return existing;
    }

    const rel: Relation = {
      id: `rel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      from: fromId,
      to: toId,
      relation,
      weight,
      context,
      createdAt: Date.now(),
    };
    this.relations.push(rel);

    // Increase importance of connected entities
    const f = this.entities.get(fromId);
    const t = this.entities.get(toId);
    if (f) f.importance = Math.min(2.0, f.importance + 0.1);
    if (t) t.importance = Math.min(2.0, t.importance + 0.1);

    this.save();
    return rel;
  }

  // ── Graph Queries ──────────────────────────────────────────────────────────

  getNeighbors(entityName: string): { entity: Entity; relation: Relation }[] {
    const id = this.normalizeId(entityName);
    const results: { entity: Entity; relation: Relation }[] = [];

    for (const rel of this.relations) {
      if (rel.from === id) {
        const entity = this.entities.get(rel.to);
        if (entity) results.push({ entity, relation: rel });
      } else if (rel.to === id) {
        const entity = this.entities.get(rel.from);
        if (entity) results.push({ entity, relation: rel });
      }
    }
    return results;
  }

  getSubgraph(entityName: string, depth: number = 2): { entities: Entity[]; relations: Relation[] } {
    const visited = new Set<string>();
    const resultEntities: Entity[] = [];
    const resultRelations: Relation[] = [];

    const traverse = (name: string, d: number) => {
      const id = this.normalizeId(name);
      if (visited.has(id) || d < 0) return;
      visited.add(id);
      const entity = this.entities.get(id);
      if (entity) resultEntities.push(entity);

      if (d === 0) return;
      for (const rel of this.relations) {
        if (rel.from === id) {
          resultRelations.push(rel);
          traverse(rel.to, d - 1);
        } else if (rel.to === id) {
          resultRelations.push(rel);
          traverse(rel.from, d - 1);
        }
      }
    };

    traverse(entityName, depth);
    return { entities: resultEntities, relations: resultRelations };
  }

  /** Format subgraph as a human-readable string for the agent context */
  describeEntity(entityName: string): string {
    const entity = this.getEntity(entityName);
    if (!entity) return `No knowledge about "${entityName}" in graph.`;

    const neighbors = this.getNeighbors(entityName);
    const lines: string[] = [
      `Entity: ${entity.label} [${entity.type}]${entity.description ? ` — ${entity.description}` : ''}`,
      `Mentioned ${entity.mentionCount} times. Importance: ${entity.importance.toFixed(2)}`,
    ];
    if (neighbors.length > 0) {
      lines.push('Relationships:');
      for (const { entity: n, relation: r } of neighbors.slice(0, 10)) {
        const direction = r.from === entity.id ? '→' : '←';
        lines.push(`  ${direction} [${r.relation}] ${n.label} (weight: ${r.weight.toFixed(2)})`);
        if (r.context) lines.push(`    Context: "${r.context.substring(0, 80)}"`);
      }
    }
    return lines.join('\n');
  }

  getAllEntities(): Entity[] { return Array.from(this.entities.values()); }
  getAllRelations(): Relation[] { return this.relations; }
  get entityCount() { return this.entities.size; }
  get relationCount() { return this.relations.length; }

  /** Wipe all entities and relations — used by factory reset. */
  clear() {
    this.entities.clear();
    this.relations = [];
    this.save();
  }
}

export const knowledgeGraph = new KnowledgeGraph();

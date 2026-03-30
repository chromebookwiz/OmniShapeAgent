# Memory Management Skill

## Memory Architecture

ShapeAgent has dual-layer memory:

### Layer 1: Semantic Vector Store
- File: `memory_vectors.json`
- 768D embeddings from `nomic-embed-text` (Ollama) or OpenAI
- Cosine similarity search with time decay (λ=0.02/day)
- Importance range: 0.0 → 2.0

### Layer 2: Knowledge Graph
- File: `knowledge_graph.json`
- Entity types: person, place, concept, fact, preference, goal, tool, event, organization
- Relation types: knows, has, is, wants, created, uses, related_to, opposite_of, etc.

## Storing Information

```
# Store a fact (importance 1.0 = normal, 2.0 = critical)
memory_store("User prefers TypeScript over JavaScript", 1.5, ["preferences", "coding"])

# Store a relationship
graph_add("User", "prefers", "TypeScript", "preference")
graph_add("ShapeAgent", "uses", "E8 Lattice Memory", "tool")
```

## Retrieving Information

```
# Semantic search
memory_search("user coding preferences", 5)

# Graph traversal
graph_query("User")                    # all facts about User
graph_query("ShapeAgent")              # what the agent knows about itself
```

## Maintenance

```
# Remove stale memories (below 0.05 effective importance)
memory_prune(0.05)

# Boost a critical memory so it persists longer
memory_boost("mem_1234567_abc", 1.0)

# Stats
list_files("memory_vectors.json")       # file size check
```

## Best Practices

1. **Store after every significant interaction** — don't wait until asked
2. **Tag memories** — makes filtering easier (`["user", "preference", "api"]`)
3. **Use graph for relationships, vector for content** — complementary systems
4. **Prune periodically** — prevents context bloat on irrelevant old memories
5. **High importance (1.5-2.0) for** — user preferences, critical facts, system config
6. **Normal importance (0.8-1.2) for** — conversation turns, general knowledge
7. **Low importance (0.3-0.7) for** — transient details, one-time facts

## Memory Lifecycle

```
New Memory → importance=1.0
Each access → importance += 0.05 (capped at 2.0)
Each day    → importance *= exp(-0.02) ≈ 98% of previous
Prune runs  → remove if importance * decay < threshold
```

## What to Always Remember

- User's name, role, and working context
- Project goals and constraints
- Preferences (editor, language, style)
- Known bugs and their fixes
- Deployed services and their URLs
- API keys and configurations (by reference, not value)

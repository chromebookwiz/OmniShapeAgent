// src/lib/e8-memory.ts
import { Vec8, nearestE8Root, hashStringToVec8 } from './math-e8';

export interface MemoryNode {
  id: string;
  content: string;
  timestamp: number;
  position: Vec8; // 8D position in the continuous space
  latticePoint: Vec8; // Projected onto the nearest E8 root
}

class E8MemoryStore {
  private memories: MemoryNode[] = [];

  // Add a new memory to the 8D lattice space
  public addMemory(content: string): MemoryNode {
    // Generate an 8D embedding (mocked by hash for prototype, easily replaceable by text-embedding-ada or local model)
    const position = hashStringToVec8(content);
    
    // Project onto the E8 lattice to align with geometric structure
    const latticePoint = nearestE8Root(position);

    const node: MemoryNode = {
      id: Math.random().toString(36).substring(7),
      content,
      timestamp: Date.now(),
      position,
      latticePoint
    };

    this.memories.push(node);
    return node;
  }

  // Retrieve memories close to the query in the 8D mathematical space
  public retrieveMemories(query: string, maxResults: number = 3): MemoryNode[] {
    const queryPos = hashStringToVec8(query);
    
    // Compute distance based on geometric product similarity (cosine similarity in 8D)
    // and lattice alignment.
    
    return this.memories
      .map(node => {
        // Find cosine similarity in the continuous space
        const sim = queryPos.dot(node.position);
        return { node, sim };
      })
      .sort((a, b) => b.sim - a.sim)
      .slice(0, maxResults)
      .map(res => res.node);
  }

  public getAllMemories() {
    return this.memories;
  }
}

export const memoryStore = new E8MemoryStore();

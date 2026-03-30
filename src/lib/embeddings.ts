// src/lib/embeddings.ts
// Real semantic embedding engine.
// Primary: Ollama /api/embed (local, free, private)
// Upgrade: OpenAI text-embedding-3-small (1536D) if OPENAI_API_KEY is set

const OLLAMA_EMBED_URL = process.env.OLLAMA_URL
  ? `${process.env.OLLAMA_URL}/api/embed`
  : 'http://127.0.0.1:11434/api/embed';

const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

// ---------------------------------------------------------------------------
// Normalize a vector to unit length (required for cosine similarity via dot)
// ---------------------------------------------------------------------------
export function normalizeVector(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (magnitude === 0) return v;
  return v.map(x => x / magnitude);
}

// ---------------------------------------------------------------------------
// Cosine similarity between two pre-normalized vectors
// ---------------------------------------------------------------------------
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Zero-pad the shorter one
    const len = Math.max(a.length, b.length);
    a = [...a, ...Array(len - a.length).fill(0)];
    b = [...b, ...Array(len - b.length).fill(0)];
  }
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

// ---------------------------------------------------------------------------
// Generate an embedding for a piece of text
// ---------------------------------------------------------------------------
export async function generateEmbedding(text: string): Promise<number[]> {
  // Trim and truncate to prevent context-length issues
  const input = text.trim().substring(0, 8000);

  // Try OpenAI first if API key is configured
  if (process.env.OPENAI_API_KEY) {
    return generateOpenAIEmbedding(input);
  }

  return generateOllamaEmbedding(input);
}

async function generateOllamaEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embed error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();

    // Ollama returns { embeddings: [[...]] } or { embedding: [...] }
    const raw: number[] = data.embeddings?.[0] ?? data.embedding;
    if (!raw || raw.length === 0) {
      throw new Error('Ollama returned empty embedding');
    }

    console.log(`[Embed] Ollama (${EMBED_MODEL}) → ${raw.length}D`);
    return normalizeVector(raw);
  } catch (err: any) {
    console.error(`[Embed] Ollama failed: ${err.message}`);
    // Fall back to a deterministic hash-based pseudo-embedding so the
    // system still functions even if the embedding model isn't pulled yet.
    return hashFallbackEmbedding(text, 768);
  }
}

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI embed error: ${res.status}`);
    const data = await res.json();
    
    const raw: number[] | undefined = data.data?.[0]?.embedding;
    if (!raw) throw new Error('OpenAI returned invalid or empty embedding data');
    
    console.log(`[Embed] OpenAI → ${raw.length}D`);
    return normalizeVector(raw);
  } catch (err: any) {
    console.error(`[Embed] OpenAI failed: ${err.message} — falling back to Ollama`);
    return generateOllamaEmbedding(text);
  }
}

// ---------------------------------------------------------------------------
// Deterministic hash-based fallback (used when Ollama is offline)
// Produces a reproducible pseudo-embedding of the given dimension.
// ---------------------------------------------------------------------------
export function hashFallbackEmbedding(text: string, dim: number = 768): number[] {
  console.warn(`[Embed] Using hash fallback for "${text.substring(0, 40)}..." — pull ${EMBED_MODEL} for real embeddings`);
  const v = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    v[i % dim] += Math.sin(c * 1.618 + i);
    v[(i * 7 + c) % dim] += Math.cos(c * 3.14159);
  }
  return normalizeVector(v);
}

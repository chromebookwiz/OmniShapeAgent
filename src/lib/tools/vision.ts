// src/lib/tools/vision.ts
// Vision: analyze images with multimodal LLMs (Ollama + vLLM/OpenAI format)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { takeScreenshot } from './computer';
import { vectorStore } from '../vector-store';
import { generateEmbedding } from '../embeddings';

const _OLLAMA_BASE = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434')
  .replace(/\/$/, '')
  .replace(/\/api\/chat$/, '');
const OLLAMA_CHAT_URL = `${_OLLAMA_BASE}/api/chat`;

function readImageAsBase64(imagePath: string): string {
  const absPath = path.resolve(process.cwd(), imagePath);
  if (!fs.existsSync(absPath)) {
    // Try as absolute path directly
    if (fs.existsSync(imagePath)) return fs.readFileSync(imagePath).toString('base64');
    throw new Error(`Image not found: ${imagePath}`);
  }
  return fs.readFileSync(absPath).toString('base64');
}

/**
 * Analyze an image file with a multimodal LLM.
 * Auto-selects Ollama (images[] format) or vLLM (OpenAI image_url format).
 */
export async function analyzeImage(
  imagePath: string,
  prompt = 'Describe this image in detail.',
  model?: string
): Promise<string> {
  const visionModel = model || process.env.VISION_MODEL || 'llava';
  const useVllm = visionModel.startsWith('vllm:') || (!visionModel.startsWith('ollama:') && !!process.env.VLLM_URL);

  try {
    const base64 = readImageAsBase64(imagePath);
    const ext = imagePath.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    };
    const mimeType = mimeMap[ext] ?? 'image/jpeg';

    if (useVllm) {
      // OpenAI image_url format
      let endpoint: string;
      let targetModel: string;

      if (visionModel.startsWith('vllm:')) {
        const inner = visionModel.slice(5);
        const lastAt = inner.lastIndexOf('@');
        if (lastAt > 0) {
          targetModel = inner.slice(0, lastAt);
          const afterAt = inner.slice(lastAt + 1);
          endpoint = (afterAt.startsWith('http://') || afterAt.startsWith('https://'))
            ? afterAt
            : `http://${afterAt}/v1/chat/completions`;
        } else {
          targetModel = inner;
          const base = (process.env.VLLM_URL || '').replace(/\/$/, '');
          endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
        }
      } else {
        targetModel = visionModel;
        const base = (process.env.VLLM_URL || '').replace(/\/$/, '');
        endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.VLLM_API_KEY) headers['Authorization'] = `Bearer ${process.env.VLLM_API_KEY}`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: targetModel,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: prompt }
            ]
          }],
          stream: false,
        }),
        cache: 'no-store',
      });

      if (!resp.ok) {
        const err = await resp.text();
        return `Vision API error (HTTP ${resp.status}): ${err}`;
      }

      const json = await resp.json();
      return json.choices?.[0]?.message?.content || 'No vision response.';

    } else {
      // Ollama format: images[] as base64 list
      const ollamaModel = visionModel.startsWith('ollama:') ? visionModel.slice(7) : (process.env.VISION_MODEL || 'llava');

      const resp = await fetch(OLLAMA_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [{
            role: 'user',
            content: prompt,
            images: [base64]
          }]
        }),
        cache: 'no-store',
      });

      if (!resp.ok) {
        const err = await resp.text();
        return `Ollama vision error (HTTP ${resp.status}): ${err}`;
      }

      const json = await resp.json();
      return json.message?.content || 'No vision response.';
    }

  } catch (e: any) {
    return `Vision error: ${e.message}`;
  }
}

/**
 * Take a screenshot and analyze it with a vision model.
 */
export async function describeScreen(prompt = 'Describe everything you see on screen in detail.', model?: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `screen_${Date.now()}.png`);
  try {
    const screenshotResult = await takeScreenshot(tmpPath);
    if (screenshotResult.startsWith('Error') || screenshotResult.startsWith('Screenshot error')) {
      return `Could not take screenshot: ${screenshotResult}`;
    }
    const analysis = await analyzeImage(tmpPath, prompt, model);
    return `[Screenshot taken]\n${analysis}`;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

/**
 * Take a screenshot and find a specific element or text.
 */
export async function findOnScreen(description: string, model?: string): Promise<string> {
  return describeScreen(
    `Look for "${description}" on screen. If you find it, describe its exact location (coordinates or region). If not found, say "NOT FOUND".`,
    model
  );
}

/**
 * Extract text from an image using vision model (OCR-like).
 */
export async function ocrImage(imagePath: string, model?: string): Promise<string> {
  return analyzeImage(
    imagePath,
    'Extract all text visible in this image. Output only the raw text, preserving layout as much as possible.',
    model
  );
}

/**
 * Map the screen: detects objects, text, and interactive elements with coordinates.
 * Returns a JSON array of entities: { label: string, x: number, y: number, w: number, h: number, description: string }
 */
export async function mapScreen(model?: string): Promise<string> {
  const prompt = `
    Analyze this screen and provide a JSON list of all significant visual entities (buttons, text fields, icons, characters, enemies, players).
    For each entity, provide:
    - label: Short name (e.g., "Start Button", "Enemy", "Health Bar")
    - x, y: Top-left coordinates normalized to 0-1000
    - w, h: Width and height normalized to 0-1000
    - description: Brief details (color, state, text content)
    
    OUTPUT ONLY THE RAW JSON ARRAY.
  `;

  const tmpPath = path.join(os.tmpdir(), `map_${Date.now()}.png`);
  try {
    await takeScreenshot(tmpPath);
    const result = await analyzeImage(tmpPath, prompt, model);
    // Attempt to extract JSON from the response
    const jsonMatch = result.match(/\[\s*\{[\s\S]*\}\s*\]/);
    return jsonMatch ? jsonMatch[0] : JSON.stringify({ error: "Failed to parse spatial map", raw: result });
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

/**
 * Synchronize the current visual state into the persistent vector memory.
 * This effectively "teaches" the agent the spatial context of the screen.
 */
export async function visionSync(model?: string): Promise<string> {
  try {
    const mapStr = await mapScreen(model);
    const entities = JSON.parse(mapStr);
    
    if (!Array.isArray(entities)) return `Vision Sync failed: ${mapStr}`;

    let syncedCount = 0;
    for (const entity of entities) {
      const content = `${entity.label}: ${entity.description} at [${entity.x}, ${entity.y}]`;
      const embedding = await generateEmbedding(content);
      
      vectorStore.upsert({
        content,
        embedding,
        dim: embedding.length,
        metadata: {
          source: 'vision',
          topic: 'spatial_map',
          entities: [entity.label],
          spatial: { x: entity.x, y: entity.y, w: entity.w, h: entity.h }
        },
        importance: 1.0
      });
      syncedCount++;
    }

    return `Successfully synchronized ${syncedCount} visual entities to temporal memory.`;
  } catch (e: any) {
    return `Vision Sync Error: ${e.message}`;
  }
}

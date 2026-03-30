import os from 'os';
import { NextResponse } from 'next/server';

// ── Constants ────────────────────────────────────────────────────────────────

// Ports that are specifically Ollama or common OpenWebUI/proxy ports — never vLLM
const OLLAMA_PORTS = new Set(['11434', '3000']);
// Common vLLM ports to scan on known hosts
const VLLM_PORTS = ['8000', '8001', '5000', '5001', '9000'];
// Hosts always included in the vLLM scan (in addition to local subnet)
const KNOWN_VLLM_HOSTS = [
  '192.168.1.34',
  'nvidia-spark',
  'nvidia-spark.local',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const ft = (url: string, init: RequestInit = {}, ms = 1200): Promise<Response> => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...init, signal: c.signal, cache: 'no-store' }).finally(() => clearTimeout(t));
};

function v1Base(raw: string): string {
  const b = raw.replace(/\/+$/, '');
  // Strip anything after /v1 so we always get the clean base
  const idx = b.indexOf('/v1');
  return idx !== -1 ? b.slice(0, idx) + '/v1' : b + '/v1';
}

function parseModels(data: any): string[] {
  if (!data) return [];
  if (Array.isArray(data.data)) return data.data.map((m: any) => m.id || m.model).filter(Boolean);
  if (Array.isArray(data.models)) return data.models.map((m: any) => (typeof m === 'string' ? m : m.name || m.id)).filter(Boolean);
  return [];
}

/**
 * Quick Ollama fingerprint — checks ONLY /api/tags (vLLM never has this).
 * Uses a short 400ms timeout so it doesn't slow down the scan.
 */
async function looksLikeOllama(base: string): Promise<boolean> {
  try {
    const r = await ft(`${base}/api/tags`, { method: 'GET' }, 400);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Try to fetch /v1/models from a base URL.
 * Returns the parsed model names, or [] on any failure.
 */
async function fetchVllmModels(base: string, timeoutMs = 1200): Promise<string[]> {
  try {
    const r = await ft(`${base}/v1/models`, { method: 'GET' }, timeoutMs);
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    return parseModels(data);
  } catch {
    return [];
  }
}

function subnetHosts(): string[] {
  const out = new Set<string>();
  Object.values(os.networkInterfaces()).forEach(ifaces => {
    ifaces?.forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        const [a, b, c] = iface.address.split('.');
        for (let i = 1; i <= 254; i++) out.add(`${a}.${b}.${c}.${i}`);
      }
    });
  });
  return Array.from(out);
}

// ── GET /api/models ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const ollamaUrlParam = searchParams.get('ollamaUrl') || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const vllmUrlParam   = searchParams.get('vllmUrl')   || process.env.VLLM_URL   || '';
  const extraHosts     = (searchParams.get('vllmSparkHosts') || process.env.VLLM_HOSTS || '')
    .split(',').map(h => h.trim()).filter(Boolean);

  // ── 1. Ollama ─────────────────────────────────────────────────────────────
  const ollamaModels: string[] = [];
  try {
    const ollamaBase = ollamaUrlParam.replace(/\/api\/tags$/, '').replace(/\/+$/, '');
    const r = await ft(`${ollamaBase}/api/tags`, { method: 'GET' }, 1500);
    if (r.ok) {
      const data = await r.json().catch(() => null);
      parseModels(data).forEach(m => ollamaModels.push(m));
    }
  } catch { /* Ollama offline */ }

  // ── 2. vLLM — explicit URL ────────────────────────────────────────────────
  const vllmFound = new Map<string, string>(); // "model@host:port" → chatUrl

  const addVllmEntry = (model: string, hostPort: string, chatUrl: string) => {
    vllmFound.set(`${model}@${hostPort}`, chatUrl);
  };

  if (vllmUrlParam) {
    // Strip known Ollama/OpenWebUI ports immediately — no need to probe
    const urlPort = (() => { try { return new URL(vllmUrlParam).port; } catch { return ''; } })();
    if (OLLAMA_PORTS.has(urlPort)) {
      console.log(`[Models] vllmUrl port ${urlPort} is an Ollama port — skipping`);
    } else {
      const base = vllmUrlParam.replace(/\/+$/, '').replace(/\/v1(\/.*)?$/, '');
      const v1 = v1Base(base);
      const hostLabel = (() => { try { return new URL(vllmUrlParam).host; } catch { return vllmUrlParam; } })();

      // Fetch models and run Ollama fingerprint in parallel
      const [names, isOllama] = await Promise.all([
        fetchVllmModels(base, 3000),
        looksLikeOllama(base),
      ]);

      if (isOllama) {
        console.log(`[Models] explicit vllmUrl ${vllmUrlParam} is Ollama/OpenWebUI — ignored`);
      } else if (names.length > 0) {
        const chatUrl = `${v1}/chat/completions`;
        names.forEach(m => addVllmEntry(m, hostLabel, chatUrl));
        console.log(`[Models] explicit vLLM ${vllmUrlParam} → ${names.length} model(s): ${names.join(', ')}`);
      } else {
        console.log(`[Models] explicit vllmUrl ${vllmUrlParam} returned no models`);
      }
    }
  }

  // ── 3. vLLM — network scan ────────────────────────────────────────────────
  // Only scan if explicit URL didn't already yield results (avoid duplication)
  if (vllmFound.size === 0) {
    const allHosts = Array.from(new Set([
      ...KNOWN_VLLM_HOSTS,
      ...extraHosts,
      ...subnetHosts(),
    ]));

    // Fan out all host:port combinations concurrently
    const scanTasks = allHosts.flatMap(host =>
      VLLM_PORTS.map(port => async () => {
        const base = `http://${host}:${port}`;
        const names = await fetchVllmModels(base, 700);
        if (names.length === 0) return;

        // Quick Ollama check — prevents listing OpenWebUI/Ollama models as vLLM
        if (await looksLikeOllama(base)) {
          console.log(`[Models] scan: ${base} is Ollama/proxy — skipping`);
          return;
        }

        const chatUrl = `${base}/v1/chat/completions`;
        names.forEach(m => {
          addVllmEntry(m, `${host}:${port}`, chatUrl);
          console.log(`[Models] scan found vLLM: ${m} @ ${base}`);
        });
      })
    );

    await Promise.allSettled(scanTasks.map(fn => fn()));
  }

  // ── 4. Build response ─────────────────────────────────────────────────────
  const vllmList = Array.from(vllmFound.entries()).map(([key, chatUrl]) => {
    const lastAt = key.lastIndexOf('@');
    return {
      model:    lastAt > 0 ? key.slice(0, lastAt) : key,
      hostPort: lastAt > 0 ? key.slice(lastAt + 1) : '',
      chatUrl,
    };
  });

  // ── 5. OpenRouter ─────────────────────────────────────────────────────────
  const openrouterKey = searchParams.get('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '';
  let openrouterModels: Array<{ id: string; name: string }> = [];
  if (openrouterKey) {
    try {
      const r = await ft('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${openrouterKey}` }
      }, 4000);
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (Array.isArray(data?.data)) {
          openrouterModels = data.data
            .map((m: any) => ({ id: m.id as string, name: (m.name || m.id) as string }))
            .slice(0, 150);
        }
      }
    } catch { /* OpenRouter offline or invalid key */ }
  }

  return NextResponse.json({
    ollamaModels,
    vllmModels: vllmList,
    openrouterModels,
    ...(ollamaModels.length === 0 && vllmList.length === 0 && openrouterModels.length === 0
      ? { warning: 'No models found. Check your Ollama URL, vLLM endpoint, or OpenRouter API key.' }
      : {}),
  });
}

import os from 'os';
import { NextResponse } from 'next/server';
import http from 'http';
import https from 'https';

// ── Constants ────────────────────────────────────────────────────────────────

// Ports that are specifically Ollama or common OpenWebUI/proxy ports — never local OpenAI-compatible endpoints
const OLLAMA_PORTS = new Set(['11434', '3000']);
// Common local OpenAI-compatible ports to scan on local hosts/subnets
const VLLM_PORTS = ['8000', '8001', '5000', '5001', '9000'];
const MAX_SUBNET_HOSTS = 1024;
const SCAN_BATCH_SIZE = 24;
const SCAN_CACHE_TTL_MS = 15_000;

type VllmModelResult = { models: string[]; modelsUrl: string | null; reachable: boolean; authRequired: boolean };

let recentModelScanCache:
  | {
      key: string;
      expiresAt: number;
      value: Array<{ model: string; hostPort: string; chatUrl?: string }>;
    }
  | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

const ft = async (url: string, init: RequestInit = {}, ms = 1200): Promise<Response> => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal, cache: 'no-store' });
  } catch {
    return await new Promise<Response>((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: init.method || 'GET',
        headers: init.headers as Record<string, string> | undefined,
        rejectUnauthorized: false,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers as Record<string, string | string[] | undefined>)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve(new Response(body, { status: res.statusCode ?? 500, headers }));
        });
        res.on('error', reject);
      });
      req.setTimeout(ms, () => req.destroy(new Error(`timeout after ${ms}ms`)));
      req.on('error', reject);
      if (typeof init.body === 'string' || init.body instanceof Buffer) req.write(init.body);
      req.end();
    });
  } finally {
    clearTimeout(t);
  }
};

function v1Base(raw: string): string {
  const b = raw.replace(/\/+$/, '');
  // Strip anything after /v1 so we always get the clean base
  const idx = b.indexOf('/v1');
  return idx !== -1 ? b.slice(0, idx) + '/v1' : b + '/v1';
}

function normalizeEndpointBase(raw: string): string {
  return raw
    .replace(/\/+$/, '')
    .replace(/\/v1\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/v1$/i, '');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function enumerateSubnetHosts(address: string, netmask?: string | null, limit = MAX_SUBNET_HOSTS): string[] {
  const ipValue = ipv4ToInt(address);
  if (ipValue === null) return [];
  const maskValue = ipv4ToInt(netmask || '255.255.255.0');
  if (maskValue === null) return [];
  const network = ipValue & maskValue;
  const broadcast = network | (~maskValue >>> 0);
  const firstHost = network + 1;
  const lastHost = broadcast - 1;
  if (lastHost < firstHost) return [address];
  const totalHosts = lastHost - firstHost + 1;
  if (totalHosts > limit) {
    const [a, b, c] = address.split('.');
    const fallback: string[] = [];
    for (let host = 1; host <= 254; host += 1) fallback.push(`${a}.${b}.${c}.${host}`);
    return fallback;
  }
  const hosts: string[] = [];
  for (let current = firstHost; current <= lastHost; current += 1) hosts.push(intToIpv4(current >>> 0));
  return hosts;
}

function extractHost(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
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
async function fetchVllmModels(base: string, timeoutMs = 1200, apiKey = ''): Promise<VllmModelResult> {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  for (const modelsUrl of [`${base}/v1/models`, `${base}/models`]) {
    try {
      const r = await ft(modelsUrl, { method: 'GET', headers }, timeoutMs);
      if (r.status === 401 || r.status === 403) return { models: [], modelsUrl, reachable: true, authRequired: true };
      if (!r.ok) continue;
      const data = await r.json().catch(() => null);
      const models = parseModels(data);
      if (models.length > 0) return { models, modelsUrl, reachable: true, authRequired: false };
      return { models: [], modelsUrl, reachable: true, authRequired: false };
    } catch {
      continue;
    }
  }
  return { models: [], modelsUrl: null, reachable: false, authRequired: false };
}

function localEndpointHosts(seedHosts: string[] = []): string[] {
  const out = new Set<string>();
  out.add('127.0.0.1');
  out.add('localhost');
  seedHosts.forEach((host) => {
    if (host) out.add(host);
  });
  Object.values(os.networkInterfaces()).forEach(ifaces => {
    ifaces?.forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.add(iface.address);
        enumerateSubnetHosts(iface.address, iface.netmask).forEach((host) => out.add(host));
      }
    });
  });
  return Array.from(out);
}

async function runScanTasks(tasks: Array<() => Promise<void>>, shouldStop?: () => boolean) {
  for (let index = 0; index < tasks.length; index += SCAN_BATCH_SIZE) {
    if (shouldStop?.()) break;
    await Promise.allSettled(tasks.slice(index, index + SCAN_BATCH_SIZE).map((task) => task()));
  }
}

// ── GET /api/models ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const ollamaUrlParam = searchParams.get('ollamaUrl') || process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const vllmUrlParam   = searchParams.get('vllmUrl')   || process.env.VLLM_URL   || '';
  const vllmApiKey     = searchParams.get('vllmApiKey') || process.env.VLLM_API_KEY || '';
  const extraHosts     = (searchParams.get('vllmSparkHosts') || process.env.VLLM_HOSTS || '')
    .split(',').map(h => h.trim()).filter(Boolean);
  const explicitHost = extractHost(vllmUrlParam);
  const scanCacheKey = JSON.stringify({ vllmUrlParam, vllmApiKey: Boolean(vllmApiKey), extraHosts: [...extraHosts].sort() });

  if (recentModelScanCache && recentModelScanCache.key === scanCacheKey && recentModelScanCache.expiresAt > Date.now()) {
    return NextResponse.json({
      ollamaModels: [],
      vllmModels: recentModelScanCache.value,
      openrouterModels: [],
      cached: true,
    });
  }

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
      const base = normalizeEndpointBase(vllmUrlParam);
      const v1 = v1Base(base);
      const hostLabel = (() => { try { return new URL(vllmUrlParam).host; } catch { return vllmUrlParam; } })();

      // Fetch models and run Ollama fingerprint in parallel
      const [{ models: names, authRequired }, isOllama] = await Promise.all([
        fetchVllmModels(base, 3000, vllmApiKey),
        looksLikeOllama(base),
      ]);

      if (isOllama) {
        console.log(`[Models] explicit vllmUrl ${vllmUrlParam} is Ollama/OpenWebUI — ignored`);
      } else if (authRequired) {
        console.log(`[Models] explicit local endpoint ${vllmUrlParam} is reachable but requires auth`);
      } else if (names.length > 0) {
        const chatUrl = `${v1}/chat/completions`;
        names.forEach(m => addVllmEntry(m, hostLabel, chatUrl));
        console.log(`[Models] explicit local endpoint ${vllmUrlParam} → ${names.length} model(s): ${names.join(', ')}`);
      } else {
        console.log(`[Models] explicit local endpoint ${vllmUrlParam} returned no models`);
      }
    }
  }

  // ── 3. vLLM — network scan ────────────────────────────────────────────────
  // Only scan if explicit URL didn't already yield results (avoid duplication)
  if (vllmFound.size === 0) {
    const allHosts = Array.from(new Set([
      ...extraHosts,
      ...(explicitHost ? [explicitHost] : []),
      ...localEndpointHosts([...extraHosts, ...(explicitHost ? [explicitHost] : [])]),
    ]));

    // Fan out all host:port combinations concurrently
    let foundAny = false;
    const scanTasks = allHosts.flatMap(host =>
      VLLM_PORTS.map(port => async () => {
        if (foundAny) return;
        const base = `http://${host}:${port}`;
        const { models: names, authRequired, reachable } = await fetchVllmModels(base, 700, vllmApiKey);
        if (!reachable || authRequired || names.length === 0) return;

        // Quick Ollama check — prevents listing OpenWebUI/Ollama models as vLLM
        if (await looksLikeOllama(base)) {
          console.log(`[Models] scan: ${base} is Ollama/proxy — skipping`);
          return;
        }

        const chatUrl = `${base}/v1/chat/completions`;
        names.forEach(m => {
          addVllmEntry(m, `${host}:${port}`, chatUrl);
          console.log(`[Models] scan found local OpenAI endpoint: ${m} @ ${base}`);
        });
        foundAny = true;
      })
    );

    await runScanTasks(scanTasks, () => foundAny);
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

  recentModelScanCache = {
    key: scanCacheKey,
    expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
    value: vllmList,
  };

  // ── 5. OpenRouter ─────────────────────────────────────────────────────────
  const openrouterKey = searchParams.get('openrouterApiKey') || process.env.OPENROUTER_API_KEY || '';
  let openrouterModels: Array<{ id: string; name: string }> = [];
  let openrouterError: string | null = null;
  if (openrouterKey) {
    try {
      const r = await ft('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'HTTP-Referer': 'https://shapeagent.local',
          'X-Title': 'OmniShapeAgent',
        }
      }, 4000);
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (Array.isArray(data?.data)) {
          openrouterModels = data.data
            .map((m: any) => ({ id: m.id as string, name: (m.name || m.id) as string }))
            .slice(0, 150);
        }
      } else {
        const errText = await r.text().catch(() => '');
        openrouterError = r.status === 401 || r.status === 403
          ? 'OpenRouter rejected the API key.'
          : `OpenRouter model fetch failed (HTTP ${r.status}). ${errText.slice(0, 120)}`.trim();
      }
    } catch {
      openrouterError = 'OpenRouter model fetch failed. Check network access and API key.';
    }
  }

  return NextResponse.json({
    ollamaModels,
    vllmModels: vllmList,
    openrouterModels,
    ...(openrouterError ? { openrouterError } : {}),
    ...(ollamaModels.length === 0 && vllmList.length === 0 && openrouterModels.length === 0
      ? { warning: 'No models found. Check your Ollama URL, vLLM endpoint, or OpenRouter API key.' }
      : {}),
  });
}

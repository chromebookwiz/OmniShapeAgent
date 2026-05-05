// src/app/api/vllm-probe/route.ts
// Diagnostic: exhaustively probe a local OpenAI-compatible server for working endpoints.
import { NextResponse } from 'next/server';
import http from 'http';
import https from 'https';
import os from 'os';

const VLLM_PORTS = ['8000', '8001', '5000', '5001', '9000'];
const MAX_SUBNET_HOSTS = 1024;
const SCAN_BATCH_SIZE = 24;
const PROBE_CACHE_TTL_MS = 15_000;

type ProbeModelResult = {
  base: string;
  v1Base: string;
  models: string[];
  modelsUrl: string | null;
  attempts: string[];
  reachable: boolean;
  authRequired: boolean;
};

let recentProbeCache: { key: string; expiresAt: number; value: unknown } | null = null;

const fetchT = async (url: string, options: RequestInit = {}, timeoutMs = 4000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
  } catch {
    return await new Promise<Response>((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers as Record<string, string> | undefined,
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
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
      req.on('error', reject);
      if (typeof options.body === 'string' || options.body instanceof Buffer) req.write(options.body);
      req.end();
    });
  } finally {
    clearTimeout(id);
  }
};

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

function localEndpointHosts(seedHosts: string[] = []): string[] {
  const out = new Set<string>(['127.0.0.1', 'localhost']);
  seedHosts.forEach((host) => {
    if (host) out.add(host);
  });
  Object.values(os.networkInterfaces()).forEach((ifaces) => {
    ifaces?.forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.add(iface.address);
        enumerateSubnetHosts(iface.address, iface.netmask).forEach((host) => out.add(host));
      }
    });
  });
  return Array.from(out);
}

function parseModels(data: any): string[] {
  if (!data) return [];
  if (Array.isArray(data.data)) return data.data.map((entry: any) => entry.id || entry.name || entry.model || entry).filter((entry: unknown): entry is string => typeof entry === 'string');
  if (Array.isArray(data.models)) return data.models.map((entry: any) => entry.id || entry.name || entry.model || entry).filter((entry: unknown): entry is string => typeof entry === 'string');
  return [];
}

async function runScanTasks<T>(tasks: Array<() => Promise<T>>) {
  const results: PromiseSettledResult<T>[] = [];
  for (let index = 0; index < tasks.length; index += SCAN_BATCH_SIZE) {
    const batchResults = await Promise.allSettled(tasks.slice(index, index + SCAN_BATCH_SIZE).map((task) => task()));
    results.push(...batchResults);
  }
  return results;
}

async function probeModelEndpoints(base: string, authH: Record<string, string>, timeoutMs = 3000) {
  const normalizedBase = base
    .replace(/\/+$/, '')
    .replace(/\/v1\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/v1$/i, '');
  const v1Base = `${normalizedBase}/v1`;
  const attempts: string[] = [];
  for (const candidate of [`${v1Base}/models`, `${normalizedBase}/models`]) {
    try {
      const response = await fetchT(candidate, { method: 'GET', headers: { ...authH } }, timeoutMs);
      const body = await response.text();
      if (response.status === 401 || response.status === 403) {
        attempts.push(`AUTH ${response.status} @ ${candidate}`);
        return { base: normalizedBase, v1Base, models: [] as string[], modelsUrl: candidate, attempts, reachable: true, authRequired: true };
      }
      if (!response.ok) {
        attempts.push(`HTTP ${response.status} @ ${candidate}`);
        continue;
      }
      try {
        const models = parseModels(JSON.parse(body));
        if (models.length > 0) {
          return { base: normalizedBase, v1Base, models, modelsUrl: candidate, attempts, reachable: true, authRequired: false };
        }
        attempts.push(`No models @ ${candidate}`);
        return { base: normalizedBase, v1Base, models: [] as string[], modelsUrl: candidate, attempts, reachable: true, authRequired: false };
      } catch {
        attempts.push(`Invalid JSON @ ${candidate}`);
      }
    } catch (error) {
      attempts.push(`ERROR @ ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { base: normalizedBase, v1Base, models: [] as string[], modelsUrl: null as string | null, attempts, reachable: false, authRequired: false };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url') || process.env.VLLM_URL || '';
  if (!rawUrl) {
    return NextResponse.json({ error: 'Provide ?url=http://host:port' }, { status: 400 });
  }

  const base = rawUrl
    .replace(/\/+$/, '')
    .replace(/\/v1\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/(?:chat\/completions|completions|models)$/i, '')
    .replace(/\/v1$/i, '');
  const v1Base = `${base}/v1`;
  const apiKey = searchParams.get('apiKey') || process.env.VLLM_API_KEY || '';
  const extraHosts = (searchParams.get('sparkHosts') || process.env.VLLM_HOSTS || '')
    .split(',').map((host) => host.trim()).filter(Boolean);
  const probeCacheKey = JSON.stringify({ rawUrl, apiKey: Boolean(apiKey), extraHosts: [...extraHosts].sort() });
  if (recentProbeCache && recentProbeCache.key === probeCacheKey && recentProbeCache.expiresAt > Date.now()) {
    return NextResponse.json(recentProbeCache.value);
  }
  const authH: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const steps: string[] = [];
  let models: string[] = [];
  let workingChatUrl: string | null = null;
  let workingFormat = '';
  let resolvedBase = base;
  let resolvedV1Base = `${base}/v1`;

  // ── Step 1: GET /v1/models ─────────────────────────────────────────────
  let modelsUrl = `${v1Base}/models`;
  const directProbe = await probeModelEndpoints(base, authH, 3000);
  models = directProbe.models;
  if (directProbe.modelsUrl) {
    modelsUrl = directProbe.modelsUrl;
    resolvedBase = directProbe.base;
    resolvedV1Base = directProbe.v1Base;
    steps.push(`✅ GET ${directProbe.modelsUrl} → 200 OK  |  models: [${models.join(', ')}]`);
    if (directProbe.authRequired) {
      steps.push(`🔐 ${directProbe.modelsUrl} requires auth but the endpoint is reachable.`);
    }
  } else {
    directProbe.attempts.forEach((attempt) => steps.push(`❌ ${attempt}`));
    steps.push(`   Server unreachable at ${base}; starting LAN scan for a moved local endpoint.`);
    const explicitHost = extractHost(rawUrl);
    const scanHosts = localEndpointHosts([...extraHosts, ...(explicitHost ? [explicitHost] : [])]);
    let foundAny = false;
    const scanTasks = scanHosts.flatMap((host) =>
      VLLM_PORTS.map((port) => async () => {
        if (foundAny) return null;
        const candidateBase = `http://${host}:${port}`;
        const result = await probeModelEndpoints(candidateBase, authH, 900);
        if (result.models.length > 0 || result.authRequired) foundAny = true;
        return result.models.length > 0 || result.authRequired ? result : null;
      }),
    );
    const scanResults = await runScanTasks(scanTasks);
    const firstHit = scanResults
      .filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof scanTasks[number]>>> => entry.status === 'fulfilled')
      .map((entry) => entry.value)
      .find((entry) => entry && (entry.models.length > 0 || entry.authRequired));
    if (!firstHit) {
      const payload = { base, steps, models, workingChatUrl, summary: 'Server unreachable after LAN scan' };
      recentProbeCache = { key: probeCacheKey, expiresAt: Date.now() + PROBE_CACHE_TTL_MS, value: payload };
      return NextResponse.json(payload);
    }
    resolvedBase = firstHit.base;
    resolvedV1Base = firstHit.v1Base;
    modelsUrl = firstHit.modelsUrl ?? `${firstHit.v1Base}/models`;
    models = firstHit.models;
    steps.push(firstHit.authRequired
      ? `🔐 LAN scan found reachable endpoint ${resolvedBase} but it requires auth.`
      : `✅ LAN scan found ${resolvedBase}  |  models: [${models.join(', ')}]`);
  }

  const testModel = models[0] ?? 'test-model';

  // ── Step 2: Probe chat/completions paths ───────────────────────────────
  const chatCandidates: Array<{ url: string; label: string; body: any }> = [
    {
      url: `${v1Base}/chat/completions`,
      label: '/v1/chat/completions (OpenAI chat)',
      body: { model: testModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false },
    },
    {
      url: `${v1Base}/completions`,
      label: '/v1/completions (legacy prompt)',
      body: { model: testModel, prompt: 'hi', max_tokens: 1, stream: false },
    },
    {
      url: `${base}/generate`,
      label: '/generate (native generate)',
      body: { model: testModel, prompt: 'hi', max_tokens: 1 },
    },
    {
      url: `${base}/api/generate`,
      label: '/api/generate (Ollama-style)',
      body: { model: testModel, prompt: 'hi', stream: false },
    },
  ];

  chatCandidates[0].url = `${resolvedV1Base}/chat/completions`;
  chatCandidates[1].url = `${resolvedV1Base}/completions`;
  chatCandidates[2].url = `${resolvedBase}/generate`;
  chatCandidates[3].url = `${resolvedBase}/api/generate`;

  for (const { url, label, body } of chatCandidates) {
    // Try POST stream:false
    try {
      const r = await fetchT(url, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      }, 4000);
      const rbody = await r.text();

      if (r.ok) {
        steps.push(`✅ POST ${label} stream:false → 200 OK — USE THIS URL`);
        workingChatUrl = url;
        workingFormat = label;
        break;
      } else if (r.status === 422 || r.status === 400) {
        // Unprocessable entity = endpoint exists but payload was rejected — endpoint IS accessible
        steps.push(`✅ POST ${label} stream:false → ${r.status} (endpoint exists, payload invalid — likely model or payload mismatch)`);
        workingChatUrl = url;
        workingFormat = label;
        break;
      } else if (r.status === 405 || r.status === 404) {
        // Try stream:true before moving on
        try {
          const sseBody = { ...body, stream: true };
          const rs = await fetchT(url, {
            method: 'POST',
            headers: { ...authH, 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
            body: JSON.stringify(sseBody),
          }, 4000);
          const sseBodyText = await rs.text();
          if (rs.ok) {
            steps.push(`✅ POST ${label} stream:true → 200 OK (SSE) — USE THIS URL`);
            workingChatUrl = url;
            workingFormat = `${label} [streaming]`;
            break;
          }
          steps.push(`   POST ${label} stream:false→${r.status}  stream:true→${rs.status}: ${rbody.slice(0, 80)} / ${sseBodyText.slice(0, 80)}`);
        } catch (e2: any) {
          steps.push(`   POST ${label} → ${r.status} (stream:false), stream:true error: ${e2.message}`);
        }
      } else if (r.status === 401 || r.status === 403) {
        steps.push(`🔐 POST ${label} → HTTP ${r.status} — auth required. Set the local endpoint API key.`);
        workingChatUrl = url; // It exists, just needs auth
        workingFormat = `${label} [auth required]`;
        break;
      } else {
        steps.push(`   POST ${label} → HTTP ${r.status}: ${rbody.slice(0, 100)}`);
      }
    } catch (e: any) {
      steps.push(`   POST ${label} → ERROR: ${e.message}`);
    }
  }

  // ── Step 3: Also check Ollama native /api/chat ─────────────────────────
  if (!workingChatUrl) {
    try {
      const ollamaUrl = `${resolvedBase}/api/chat`;
      const r = await fetchT(ollamaUrl, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: testModel, messages: [{ role: 'user', content: 'hi' }], stream: false }),
      }, 3000);
      const rbody = await r.text();
      if (r.ok || r.status === 422) {
        steps.push(`✅ POST ${ollamaUrl} (Ollama native) → ${r.status} — USE THIS URL`);
        workingChatUrl = ollamaUrl;
        workingFormat = '/api/chat (Ollama native)';
      } else {
        steps.push(`   POST /api/chat → HTTP ${r.status}: ${rbody.slice(0, 100)}`);
      }
    } catch (e: any) {
      steps.push(`   POST /api/chat → ERROR: ${e.message}`);
    }
  }

  const summary = workingChatUrl
    ? `✅ Working endpoint: ${workingChatUrl} (${workingFormat})`
    : `❌ No working chat endpoint found. The server responds at ${modelsUrl} (models list) but rejects all POST paths. This may indicate: (1) a reverse proxy blocking POSTs, (2) an API key is required, or (3) the server uses a non-standard path.`;

  const payload = {
    base,
    resolvedBase,
    v1Base: resolvedV1Base,
    models,
    workingChatUrl,
    workingFormat,
    steps,
    summary,
  };
  recentProbeCache = { key: probeCacheKey, expiresAt: Date.now() + PROBE_CACHE_TTL_MS, value: payload };
  return NextResponse.json(payload);
}

// src/app/api/vllm-probe/route.ts
// Diagnostic: exhaustively probe a vLLM-compatible server for working endpoints.
import { NextResponse } from 'next/server';

const fetchT = async (url: string, options: RequestInit = {}, timeoutMs = 4000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
  } finally {
    clearTimeout(id);
  }
};

function toV1Base(raw: string): string {
  const base = raw.replace(/\/+$/, '');
  const v1idx = base.indexOf('/v1');
  if (v1idx !== -1) return base.slice(0, v1idx) + '/v1';
  return base + '/v1';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url') || process.env.VLLM_URL || '';
  if (!rawUrl) {
    return NextResponse.json({ error: 'Provide ?url=http://host:port' }, { status: 400 });
  }

  const base = rawUrl.replace(/\/+$/, '').replace(/\/v1(\/.*)?$/, '');
  const v1Base = `${base}/v1`;
  const apiKey = process.env.VLLM_API_KEY;
  const authH: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const steps: string[] = [];
  let models: string[] = [];
  let workingChatUrl: string | null = null;
  let workingFormat = '';

  // ── Step 1: GET /v1/models ─────────────────────────────────────────────
  const modelsUrl = `${v1Base}/models`;
  try {
    const r = await fetchT(modelsUrl, { method: 'GET', headers: { ...authH } }, 3000);
    const body = await r.text();
    if (r.ok) {
      try {
        const data = JSON.parse(body);
        models = (data.data ?? data.models ?? [])
          .map((m: any) => m.id || m.name || m.model || m)
          .filter((x: any) => typeof x === 'string');
        steps.push(`✅ GET ${modelsUrl} → 200 OK  |  models: [${models.join(', ')}]`);
      } catch {
        steps.push(`⚠️  GET ${modelsUrl} → 200 but invalid JSON: ${body.slice(0, 100)}`);
      }
    } else {
      steps.push(`❌ GET ${modelsUrl} → HTTP ${r.status}: ${body.slice(0, 200)}`);
      steps.push(`   Cannot reach model list — check URL and auth.`);
    }
  } catch (e: any) {
    steps.push(`❌ GET ${modelsUrl} → TIMEOUT/ERROR: ${e.message}`);
    steps.push(`   Server unreachable at ${base}`);
    return NextResponse.json({ base, steps, models, workingChatUrl, summary: 'Server unreachable' });
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
      label: '/generate (vLLM native)',
      body: { model: testModel, prompt: 'hi', max_tokens: 1 },
    },
    {
      url: `${base}/api/generate`,
      label: '/api/generate (Ollama-style)',
      body: { model: testModel, prompt: 'hi', stream: false },
    },
  ];

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
      } else if (r.status === 422) {
        // Unprocessable entity = endpoint exists but payload was rejected — endpoint IS accessible
        steps.push(`✅ POST ${label} stream:false → 422 (endpoint exists, payload invalid — likely model name mismatch)`);
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
        steps.push(`🔐 POST ${label} → HTTP ${r.status} — auth required. Set VLLM_API_KEY.`);
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
      const ollamaUrl = `${base}/api/chat`;
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
    : `❌ No working chat endpoint found. The server responds at ${modelsUrl} (models list) but rejects all POST paths. This may indicate: (1) a reverse proxy blocking POSTs, (2) an API key is required (VLLM_API_KEY), or (3) the server uses a non-standard path.`;

  return NextResponse.json({
    base,
    v1Base,
    models,
    workingChatUrl,
    workingFormat,
    steps,
    summary,
  });
}

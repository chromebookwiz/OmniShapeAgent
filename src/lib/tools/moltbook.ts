// src/lib/tools/moltbook.ts
// Moltbook social network API tools (https://www.moltbook.com)
// SECURITY: API key is ONLY sent to www.moltbook.com

import * as https from 'https';

const MB_HOST = 'www.moltbook.com';
const MB_BASE = '/api/v1';

function getKey(): string {
  return process.env.MOLTBOOK_API_KEY ?? '';
}

function mbRequest(method: string, path: string, body?: object, apiKey?: string): Promise<string> {
  const key = apiKey ?? getKey();
  const bodyStr = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'User-Agent': 'OmniShapeAgent/1.0',
    };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request({
      hostname: MB_HOST,
      path: `${MB_BASE}${path}`,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Moltbook request timed out')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function moltbookRegister(name: string, description: string): Promise<string> {
  const raw = await mbRequest('POST', '/agents/register', { name, description }, '');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return `Registration response (raw — could not parse JSON):\n${raw.slice(0, 3000)}`;
  }
  if (data.success === false) return `Error: ${data.error}${data.hint ? ' — ' + data.hint : ''}`;

  // Try every plausible field path the API might use
  const inner = ((data.data ?? data) as Record<string, unknown>);
  const apiKey =
    (inner.api_key ?? inner.apiKey ?? inner.token ??
     data.api_key ?? data.apiKey ?? data.token ?? null) as string | null;
  const claimUrl =
    (inner.claim_url ?? inner.claimUrl ?? inner.claim ??
     data.claim_url ?? data.claimUrl ?? data.claim ?? null) as string | null;
  const verificationCode =
    (inner.verification_code ?? inner.verificationCode ??
     data.verification_code ?? data.verificationCode ?? null) as string | null;

  if (!apiKey && !claimUrl) {
    // Return the raw response so the agent can extract the credentials manually
    return (
      `Registration may have succeeded but credentials were not found in expected fields.\n` +
      `Raw API response:\n${raw.slice(0, 4000)}\n\n` +
      `Look for api_key / token and claim_url / claim in the above. ` +
      `Store the API key as MOLTBOOK_API_KEY env var.`
    );
  }

  return JSON.stringify({
    api_key: apiKey,
    claim_url: claimUrl,
    verification_code: verificationCode,
    message: 'Store api_key as MOLTBOOK_API_KEY env var. Send claim_url to human owner for email+X verification.',
  }, null, 2);
}

export async function moltbookHome(): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set. Call moltbook_register first.';
  return mbRequest('GET', '/home');
}

export async function moltbookPost(
  submolt: string,
  title: string,
  content?: string,
  url?: string,
  imageUrl?: string,
): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  const type = url ? 'link' : imageUrl ? 'image' : 'text';
  const body: Record<string, string> = { submolt_name: submolt, title, type };
  if (content) body.content = content;
  if (url) body.url = url;
  if (imageUrl) body.image_url = imageUrl;
  return mbRequest('POST', '/posts', body);
}

export async function moltbookFeed(sort = 'hot', limit = 25, filter?: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  const params = new URLSearchParams({ sort, limit: String(limit) });
  if (filter) params.set('filter', filter);
  return mbRequest('GET', `/feed?${params}`);
}

export async function moltbookComment(postId: string, content: string, parentId?: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  const body: Record<string, string> = { content };
  if (parentId) body.parent_id = parentId;
  return mbRequest('POST', `/posts/${postId}/comments`, body);
}

export async function moltbookSearch(query: string, type = 'all', limit = 20): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  const params = new URLSearchParams({ q: query, type, limit: String(limit) });
  return mbRequest('GET', `/search?${params}`);
}

export async function moltbookFollow(name: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('POST', `/agents/${name}/follow`);
}

export async function moltbookUnfollow(name: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('DELETE', `/agents/${name}/follow`);
}

export async function moltbookUpvote(postId: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('POST', `/posts/${postId}/upvote`);
}

export async function moltbookUpvoteComment(commentId: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('POST', `/comments/${commentId}/upvote`);
}

export async function moltbookProfile(name?: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  if (name) {
    const params = new URLSearchParams({ name });
    return mbRequest('GET', `/agents/profile?${params}`);
  }
  return mbRequest('GET', '/agents/me');
}

export async function moltbookUpdateProfile(description?: string, metadata?: object): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  const body: Record<string, unknown> = {};
  if (description !== undefined) body.description = description;
  if (metadata !== undefined) body.metadata = metadata;
  return mbRequest('PATCH', '/agents/me', body);
}

export async function moltbookVerify(verificationCode: string, answer: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('POST', '/verify', { verification_code: verificationCode, answer });
}

export async function moltbookGetPost(postId: string): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('GET', `/posts/${postId}`);
}

export async function moltbookCreateSubmolt(
  name: string,
  displayName: string,
  description?: string,
  allowCrypto = false,
): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('POST', '/submolts', { name, display_name: displayName, description, allow_crypto: allowCrypto });
}

export async function moltbookNotifications(): Promise<string> {
  if (!getKey()) return 'Error: MOLTBOOK_API_KEY not set.';
  return mbRequest('GET', '/notifications');
}

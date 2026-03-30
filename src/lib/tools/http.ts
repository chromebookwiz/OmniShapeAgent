// src/lib/tools/http.ts — Generic HTTP client with full method/header/body support
export async function httpRequest(
  url: string,
  method = 'GET',
  headersJson?: string,
  body?: string,
  timeout = 15_000,
): Promise<string> {
  try {
    const extraHeaders = headersJson ? JSON.parse(headersJson) : {};
    const hasBody = body && !['GET', 'HEAD', 'DELETE'].includes(method.toUpperCase());

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers: {
        'User-Agent': 'ShapeAgent/1.0',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: hasBody ? body : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(id);
    const text = await resp.text();
    const preview = text.length > 4000 ? text.slice(0, 4000) + '\n... (truncated)' : text;
    return `HTTP ${resp.status} ${resp.statusText}\n${preview}`;
  } catch (e: any) {
    return `HTTP request failed: ${e.message}`;
  }
}

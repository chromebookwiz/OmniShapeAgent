// src/app/api/proxy/route.ts
// Transparent reverse proxy that strips X-Frame-Options and CSP frame-ancestors
// so that sites can be embedded in iframes without browser errors.
//
// Usage: <iframe src="/api/proxy?url=https://example.com" />
//
// How it works:
//   1. Fetch target URL server-side (bypasses client CORS restrictions)
//   2. Strip X-Frame-Options and Content-Security-Policy headers from response
//   3. For HTML: rewrite all src/href/action/url() references to go through this proxy
//      This prevents SSL_ERROR_RX_RECORD_TOO_LONG errors caused by direct browser
//      connections to sites with non-standard TLS configurations.
//   4. Forward everything else (status, content-type, body) unchanged

import { NextRequest, NextResponse } from 'next/server';
import https from 'https';
import http from 'http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Headers we must strip to allow iframe embedding
const BLOCK_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
]);

// Headers that should not be forwarded (hop-by-hop + problematic ones)
const SKIP_HEADERS = new Set([
  ...BLOCK_HEADERS,
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

// Fetch a URL server-side, with TLS fallback for non-standard certificates
async function fetchWithTlsFallback(url: string, reqHeaders: Record<string, string>): Promise<{ status: number; headers: Headers; buffer: Buffer; text: () => Promise<string> }> {
  // Try with Node.js http/https directly so we can set rejectUnauthorized: false as fallback
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: reqHeaders,
      // Allow self-signed / mismatched TLS certs — avoids SSL_ERROR_RX_RECORD_TOO_LONG
      rejectUnauthorized: false,
    };

    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const rawHeaders = new Headers();
        const hdrs = res.headers as Record<string, string | string[] | undefined>;
        for (const [k, v] of Object.entries(hdrs)) {
          if (v !== undefined) rawHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
        }
        resolve({
          status: res.statusCode ?? 200,
          headers: rawHeaders,
          buffer,
          text: async () => buffer.toString('utf-8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Rewrite URLs in HTML so all resources are fetched through this proxy,
// preventing the browser from making direct connections that trigger SSL errors.
function rewriteHtmlUrls(html: string, targetUrl: URL, proxyBase: string): string {
  const origin = targetUrl.origin;

  const toProxy = (href: string): string => {
    if (!href || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('javascript:') || href.startsWith('#')) return href;
    try {
      const abs = new URL(href, origin).toString();
      if (!abs.startsWith('http')) return href;
      return `${proxyBase}${encodeURIComponent(abs)}`;
    } catch { return href; }
  };

  // Rewrite src= and href= attributes
  html = html.replace(/((?:src|href|action)\s*=\s*)(['"])((?:(?!\2).)*)\2/gi, (_, attr, q, val) => {
    return `${attr}${q}${toProxy(val)}${q}`;
  });

  // Rewrite srcset=
  html = html.replace(/(srcset\s*=\s*)(['"])((?:(?!\2).)*)\2/gi, (_, attr, q, val) => {
    const rewritten = val.split(',').map((part: string) => {
      const trimmed = part.trim();
      const spaceIdx = trimmed.search(/\s/);
      if (spaceIdx === -1) return toProxy(trimmed);
      return toProxy(trimmed.slice(0, spaceIdx)) + trimmed.slice(spaceIdx);
    }).join(', ');
    return `${attr}${q}${rewritten}${q}`;
  });

  // Strip CSP meta tags
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

  return html;
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'url param required. Usage: /api/proxy?url=https://example.com' }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return NextResponse.json({ error: `Invalid URL: ${target}` }, { status: 400 });
  }

  const proxyBase = `${request.nextUrl.origin}/api/proxy?url=`;

  try {
    const upstream = await fetchWithTlsFallback(targetUrl.toString(), {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'identity',
      'Referer': targetUrl.origin + '/',
      'DNT': '1',
    });

    const contentType = upstream.headers.get('content-type') ?? 'text/html';
    const isHtml = contentType.includes('text/html');

    // Build clean response headers
    const outHeaders = new Headers();
    outHeaders.set('Content-Type', contentType);
    outHeaders.set('Access-Control-Allow-Origin', '*');
    outHeaders.set('X-Proxy-Target', targetUrl.hostname);

    // Forward safe upstream headers
    for (const [key, value] of upstream.headers.entries()) {
      if (!SKIP_HEADERS.has(key.toLowerCase())) {
        outHeaders.set(key, value);
      }
    }

    if (isHtml) {
      let html = await upstream.text();
      // Rewrite all resource URLs to go through this proxy — eliminates direct browser
      // connections to the target site and fixes SSL_ERROR_RX_RECORD_TOO_LONG
      html = rewriteHtmlUrls(html, targetUrl, proxyBase);

      return new NextResponse(html, {
        status: upstream.status,
        headers: outHeaders,
      });
    }

    // Non-HTML: return buffer directly
    return new NextResponse(upstream.buffer.buffer as ArrayBuffer, {
      status: upstream.status,
      headers: outHeaders,
    });

  } catch (err: any) {
    console.error('[proxy] Error fetching', target, err.message);
    return NextResponse.json(
      { error: `Proxy fetch failed: ${err.message}`, target },
      { status: 502 }
    );
  }
}

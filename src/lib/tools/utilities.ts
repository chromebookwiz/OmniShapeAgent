// src/lib/tools/utilities.ts — Pure utility tools: hashing, encoding, regex, diff, etc.
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// ── Crypto / Encoding ────────────────────────────────────────────────────────

export function hashText(text: string, algorithm = 'sha256'): string {
  try {
    return crypto.createHash(algorithm).update(text, 'utf8').digest('hex');
  } catch (e: any) {
    return `Hash error: ${e.message}`;
  }
}

export function base64Encode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

export function base64Decode(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch (e: any) {
    return `Decode error: ${e.message}`;
  }
}

/** Encode a binary file (image, PDF, etc.) to base64 — uses raw binary read, not UTF-8. */
export function base64EncodeFile(filepath: string): string {
  try {
    const abs = path.resolve(filepath);
    if (!fs.existsSync(abs)) return `File not found: ${filepath}`;
    const buf = fs.readFileSync(abs);
    const b64 = buf.toString('base64');
    const size = buf.length;
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
      pdf: 'application/pdf',
    };
    const mime = mimeMap[ext] ?? 'application/octet-stream';
    return JSON.stringify({ base64: b64, mime, size, filepath: abs });
  } catch (e: any) {
    return `base64EncodeFile error: ${e.message}`;
  }
}

/** Decode a base64 string and write it to a file. Returns the output path on success. */
export function base64DecodeToFile(base64data: string, outputPath: string): string {
  try {
    const abs = path.resolve(outputPath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.from(base64data, 'base64');
    fs.writeFileSync(abs, buf);
    return `Written ${buf.length} bytes to ${abs}`;
  } catch (e: any) {
    return `base64DecodeToFile error: ${e.message}`;
  }
}

// ── Text / Data Processing ───────────────────────────────────────────────────

export function jsonFormat(jsonStr: string): string {
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2);
  } catch (e: any) {
    return `JSON parse error: ${e.message}`;
  }
}

export function regexMatch(text: string, pattern: string, flags = 'gm'): string {
  try {
    const re = new RegExp(pattern, flags);
    const matches = [...text.matchAll(re)];
    if (!matches.length) return 'No matches.';
    return matches.slice(0, 50).map((m, i) => {
      const groups = m.slice(1).filter(Boolean);
      return `[${i + 1}] "${m[0]}" at index ${m.index}${groups.length ? `\n    groups: ${groups.join(', ')}` : ''}`;
    }).join('\n');
  } catch (e: any) {
    return `Regex error: ${e.message}`;
  }
}

export function diffText(a: string, b: string, labelA = 'A', labelB = 'B'): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const maxLen = Math.max(aLines.length, bLines.length);
  const out: string[] = [`--- ${labelA}`, `+++ ${labelB}`];
  let changed = 0;
  for (let i = 0; i < maxLen; i++) {
    const al = aLines[i] ?? '';
    const bl = bLines[i] ?? '';
    if (al !== bl) {
      if (al) out.push(`- ${al}`);
      if (bl) out.push(`+ ${bl}`);
      changed++;
    }
  }
  return changed === 0 ? 'Identical.' : out.join('\n');
}

export function countTokens(text: string): string {
  const chars  = text.length;
  const words  = text.split(/\s+/).filter(Boolean).length;
  const approx = Math.ceil(chars / 4);
  const lines  = text.split('\n').length;
  return `chars=${chars}  words=${words}  lines=${lines}  approx_tokens≈${approx}`;
}

export function truncateText(text: string, maxChars: number, ellipsis = '...'): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - ellipsis.length) + ellipsis;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return 'No JSON found.';
  try {
    return JSON.stringify(JSON.parse(match[1]), null, 2);
  } catch {
    return match[1];
  }
}

// ── Time & Date ──────────────────────────────────────────────────────────────

export function getCurrentTime(): string {
  const now = new Date();
  return JSON.stringify({
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    utc: now.toUTCString(),
    local: now.toLocaleString(),
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

export function formatDate(timestamp: number | string, format = 'iso'): string {
  try {
    const d = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
    if (isNaN(d.getTime())) return `Invalid date: ${timestamp}`;
    switch (format) {
      case 'iso':   return d.toISOString();
      case 'utc':   return d.toUTCString();
      case 'local': return d.toLocaleString();
      case 'date':  return d.toLocaleDateString();
      case 'time':  return d.toLocaleTimeString();
      case 'unix':  return String(Math.floor(d.getTime() / 1000));
      default:      return d.toISOString();
    }
  } catch (e: any) {
    return `Date error: ${e.message}`;
  }
}

export function timeSince(timestamp: number | string): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
  const diffMs = Date.now() - d.getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60)   return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h} hours ago`;
  const days = Math.floor(h / 24);
  return `${days} days ago`;
}

export function timeUntil(timestamp: number | string): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return 'That time has passed.';
  const s = Math.floor(diffMs / 1000);
  if (s < 60)   return `in ${s} seconds`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `in ${m} minutes`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `in ${h} hours`;
  const days = Math.floor(h / 24);
  return `in ${days} days`;
}

// ── JavaScript sandbox ───────────────────────────────────────────────────────

export async function runJs(code: string): Promise<string> {
  // Safe eval: wrap in async function, timeout via worker or process
  try {
    const { stdout, stderr } = await execAsync(
      `node -e ${JSON.stringify(`(async()=>{${code}})().catch(e=>process.stderr.write(String(e)))`)}`,
      { timeout: 15_000 }
    );
    return `STDOUT:\n${stdout.substring(0, 3000)}\n${stderr ? `STDERR:\n${stderr.substring(0, 1000)}` : ''}`.trim();
  } catch (e: any) {
    return `JS error: ${e.stderr || e.message}`;
  }
}

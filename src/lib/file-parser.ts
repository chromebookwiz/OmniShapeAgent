// src/lib/file-parser.ts
// Parse uploaded files into plain text for the agent context.
// Supports: txt, md, csv, json, xml, html, pdf, docx, xlsx.
// No external dependencies — uses Node.js Buffer operations.

import zlib from 'zlib';

export interface ParsedFile {
  name: string;
  type: string;          // mime or extension
  text: string;          // extracted plain text
  truncated: boolean;    // true if content was truncated to MAX_CHARS
  charCount: number;
}

const MAX_CHARS = 40_000; // ~10k tokens — generous context budget

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function parseFile(
  name: string,
  mimeType: string,
  buffer: Buffer
): Promise<ParsedFile> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  let text = '';

  try {
    if (isTextType(mimeType, ext)) {
      text = buffer.toString('utf-8');
    } else if (ext === 'pdf' || mimeType === 'application/pdf') {
      text = extractPdfText(buffer);
    } else if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = extractDocxText(buffer);
    } else if (ext === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      text = extractXlsxText(buffer);
    } else if (ext === 'doc') {
      text = `[Binary Word document — .doc format not fully supported. Re-save as .docx for better extraction.]\n` + extractPrintableAscii(buffer);
    } else {
      text = extractPrintableAscii(buffer);
    }
  } catch (e: any) {
    text = `[Parse error: ${e.message}]`;
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS) + '\n\n[...truncated at 40,000 characters]';

  return { name, type: mimeType || ext, text, truncated, charCount: text.length };
}

// ── Text detection ─────────────────────────────────────────────────────────────

function isTextType(mime: string, ext: string): boolean {
  if (mime.startsWith('text/')) return true;
  return ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml',
          'html', 'htm', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log',
          'py', 'js', 'ts', 'tsx', 'jsx', 'rs', 'go', 'java', 'c', 'cpp',
          'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'sh', 'bash',
          'sql', 'graphql', 'gql', 'env', 'gitignore'].includes(ext);
}

// ── PDF extraction ─────────────────────────────────────────────────────────────
// Extracts text from PDF binary.
// Pass 1: decompress FlateDecode streams, then scan each for BT/ET text blocks.
// Pass 2: scan raw buffer for uncompressed BT/ET blocks.
// Pass 3: metadata fallback (Title/Author from Info dict).

function extractPdfText(buf: Buffer): string {
  const parts: string[] = [];

  // ── Pass 1: decompress FlateDecode / zlib content streams ───────────────
  // Scan for stream dictionaries by finding 'stream' keyword preceded by '>>'.
  // We work on the Buffer directly to get accurate byte offsets.
  let offset = 0;
  while (offset < buf.length - 8) {
    // Find 'stream' keyword
    const kw = buf.indexOf('stream', offset);
    if (kw === -1) break;

    // The byte after 'stream' must be \r\n or \n (PDF spec)
    const afterKw = kw + 6;
    let dataStart = -1;
    if (buf[afterKw] === 0x0d && buf[afterKw + 1] === 0x0a) dataStart = afterKw + 2;
    else if (buf[afterKw] === 0x0a) dataStart = afterKw + 1;

    if (dataStart === -1) { offset = kw + 6; continue; }

    // Look back in the preceding 512 bytes for the dict to find /Filter
    const lookback = buf.slice(Math.max(0, kw - 512), kw).toString('latin1');
    const isFlate = /\/Filter\s*(?:\/FlateDecode|\[\/FlateDecode\])/.test(lookback);

    // Get /Length from the dict to find dataEnd precisely
    let dataEnd: number;
    const lenMatch = /\/Length\s+(\d+)/.exec(lookback);
    if (lenMatch) {
      dataEnd = dataStart + parseInt(lenMatch[1], 10);
    } else {
      // Fallback: find next 'endstream'
      const es = buf.indexOf('endstream', dataStart);
      dataEnd = es === -1 ? buf.length : es;
    }

    if (dataEnd <= dataStart || dataEnd > buf.length) { offset = dataStart; continue; }

    const streamBuf = buf.slice(dataStart, dataEnd);

    let decoded: string | null = null;
    if (isFlate) {
      // Try zlib inflate (with header), then raw inflate
      for (const fn of [zlib.inflateSync, zlib.inflateRawSync] as Array<(b: Buffer) => Buffer>) {
        try { decoded = fn(streamBuf).toString('latin1'); break; } catch { /* next */ }
      }
    } else {
      // Uncompressed content stream — read directly
      decoded = streamBuf.toString('latin1');
    }

    if (decoded) {
      const extracted = extractBTBlocks(decoded);
      parts.push(...extracted);
    }

    offset = dataEnd;
  }

  // ── Pass 2: raw BT/ET scan on the entire file as latin1 ─────────────────
  if (parts.length === 0) {
    const raw = buf.toString('latin1');
    parts.push(...extractBTBlocks(raw));
  }

  // ── Pass 3: metadata fallback ────────────────────────────────────────────
  if (parts.length === 0) {
    const raw = buf.toString('latin1');
    const meta: string[] = [];
    const tm = /\/Title\s*\(([^)]+)\)/i.exec(raw);
    const am = /\/Author\s*\(([^)]+)\)/i.exec(raw);
    if (tm) meta.push(`Title: ${decodePdfString(tm[1])}`);
    if (am) meta.push(`Author: ${decodePdfString(am[1])}`);
    if (meta.length > 0)
      return `[PDF: metadata only — text in compressed/encrypted streams]\n${meta.join('\n')}`;
    return '[PDF: could not extract text — file may be scanned, encrypted, or use unsupported encoding]';
  }

  return parts.join(' ').replace(/\s{2,}/g, ' ');
}

// Extract text strings from BT...ET blocks within a decoded content stream.
function extractBTBlocks(content: string): string[] {
  const parts: string[] = [];
  const blockRe = /BT\s*([\s\S]*?)\s*ET/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(content)) !== null) {
    const block = bm[1];
    // (text) Tj
    const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
    let tm: RegExpExecArray | null;
    while ((tm = tjRe.exec(block)) !== null) {
      const s = decodePdfString(tm[1]);
      if (s.trim()) parts.push(s);
    }
    // [(text) ...] TJ
    const tjArrRe = /\[([^\]]*)\]\s*TJ/g;
    let tam: RegExpExecArray | null;
    while ((tam = tjArrRe.exec(block)) !== null) {
      const strRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRe.exec(tam[1])) !== null) {
        const s = decodePdfString(sm[1]);
        if (s.trim()) parts.push(s);
      }
    }
  }
  return parts;
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\f/g, '\f').replace(/\\b/g, '\b')
    .replace(/\\\\/g, '\\').replace(/\\\(/g, '(').replace(/\\\)/g, ')')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

// ── DOCX extraction ────────────────────────────────────────────────────────────
// A DOCX file is a ZIP archive. We find word/document.xml by scanning ZIP local
// file headers (signature: PK 0x0304) and extract text by stripping XML tags.

function extractDocxText(buf: Buffer): string {
  const target = 'word/document.xml';
  const xmlContent = extractZipEntry(buf, target);
  if (!xmlContent) return '[DOCX: word/document.xml not found — file may be corrupted]';

  // Strip all XML tags, decode entities, preserve paragraph breaks
  const text = xmlContent
    .replace(/<w:br[^/]*/gi, '\n')          // line breaks
    .replace(/<\/w:p>/gi, '\n')             // paragraph ends
    .replace(/<[^>]+>/g, '')               // all other tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractXlsxText(buf: Buffer): string {
  // XLSX: find xl/sharedStrings.xml for string content
  const ss = extractZipEntry(buf, 'xl/sharedStrings.xml');
  if (!ss) return '[XLSX: no shared strings found]';

  const strings: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/gi;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(ss)) !== null) {
    const val = m[1].replace(/<[^>]+>/g, '').trim();
    if (val) strings.push(val);
  }
  return strings.join('\t').replace(/\t{3,}/g, '\t\t');
}

// ── ZIP entry extraction ───────────────────────────────────────────────────────
// Minimal ZIP parser — reads local file headers to find a specific entry.

function extractZipEntry(buf: Buffer, entryPath: string): string | null {
  const SIG = 0x04034b50;
  let offset = 0;
  while (offset < buf.length - 30) {
    if (buf.readUInt32LE(offset) !== SIG) { offset++; continue; }
    const fnLen  = buf.readUInt16LE(offset + 26);
    const extLen = buf.readUInt16LE(offset + 28);
    const compSize   = buf.readUInt32LE(offset + 18);
    const method     = buf.readUInt16LE(offset + 8);
    const fnStart = offset + 30;
    const fnEnd   = fnStart + fnLen;
    if (fnEnd > buf.length) break;
    const name = buf.slice(fnStart, fnEnd).toString('utf-8');
    const dataStart = fnEnd + extLen;
    const dataEnd   = dataStart + compSize;
    if (name === entryPath) {
      if (method === 0) {
        // Stored (uncompressed)
        return buf.slice(dataStart, dataEnd).toString('utf-8');
      } else if (method === 8) {
        // Deflate — use zlib
        try {
          return zlib.inflateRawSync(buf.slice(dataStart, dataEnd)).toString('utf-8');
        } catch {
          return null;
        }
      }
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

// ── Fallback: printable ASCII ─────────────────────────────────────────────────

function extractPrintableAscii(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < Math.min(buf.length, 50_000); i++) {
    const c = buf[i];
    if ((c >= 32 && c < 127) || c === 9 || c === 10 || c === 13) {
      out += String.fromCharCode(c);
    } else if (c === 0 && out.length > 0 && out[out.length - 1] !== ' ') {
      out += ' ';
    }
  }
  return out.replace(/\s{3,}/g, '  ').trim();
}

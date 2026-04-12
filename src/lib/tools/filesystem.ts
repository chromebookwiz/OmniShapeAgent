// src/lib/tools/filesystem.ts
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { ROOT, SKILLS_DIR as SKILLS_ROOT } from '../paths-core';

const execAsync = promisify(exec);

function resolveWorkspacePath(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(ROOT, targetPath);
}

function isWithinWorkspace(targetPath: string): boolean {
  return targetPath === ROOT || targetPath.startsWith(ROOT + path.sep);
}

function requireWorkspacePath(targetPath: string): string | null {
  const resolved = resolveWorkspacePath(targetPath);
  return isWithinWorkspace(resolved) ? resolved : null;
}

export function listSkills(): string {
  try {
    if (!fs.existsSync(SKILLS_ROOT)) return 'No skills directory found.';
    const files = fs.readdirSync(SKILLS_ROOT).filter(f => f.endsWith('.md'));
    if (files.length === 0) return 'No skill files found.';
    return files.map(f => f.replace('.md', '')).join(', ');
  } catch (err) {
    return `Error listing skills: ${String(err)}`;
  }
}

export function readSkill(skillName: string): string {
  try {
    const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
    const filepath = path.join(SKILLS_ROOT, `${safeName}.md`);
    if (!fs.existsSync(filepath)) {
      return `Skill '${skillName}' not found.`;
    }
    return fs.readFileSync(filepath, 'utf8');
  } catch (err) {
    return `Error reading skill: ${String(err)}`;
  }
}

export function readFile(filepath: string): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const content = fs.readFileSync(absPath, 'utf8');
    if (content.length > 20000) {
      return content.substring(0, 20000) + `\n\n[File truncated — ${content.length} total chars. Use read_file_range(filepath, startLine, endLine) to read specific sections.]`;
    }
    return content;
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
}

export function writeFile(filepath: string, content: string): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    return `✓ Wrote ${content.length} chars to ${filepath} (${fs.statSync(absPath).size} bytes on disk)`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
}

export function patchFile(filepath: string, search: string, replace: string): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const content = fs.readFileSync(absPath, 'utf8');
    if (!content.includes(search)) {
      return `Error: Search string not found in ${filepath}. Use read_file or search_in_files to confirm the exact text.`;
    }
    const occurrences = content.split(search).length - 1;
    const newContent = content.split(search).join(replace);
    fs.writeFileSync(absPath, newContent, 'utf8');
    return `✓ Patched ${filepath} — replaced ${occurrences} occurrence${occurrences !== 1 ? 's' : ''}.`;
  } catch (err) {
    return `Error patching file: ${String(err)}`;
  }
}

export function appendFile(filepath: string, content: string): string {
  try {
    const absPath = requireWorkspacePath(filepath);
    if (!absPath) return "Access denied.";
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.appendFileSync(absPath, content, 'utf8');
    return `Appended ${content.length} chars to ${filepath}`;
  } catch (err) {
    return `Error appending: ${String(err)}`;
  }
}

export function deleteFile(filepath: string): string {
  try {
    const absPath = requireWorkspacePath(filepath);
    if (!absPath) return "Access denied.";
    if (!fs.existsSync(absPath)) return "File not found.";
    fs.unlinkSync(absPath);
    return `Deleted ${filepath}`;
  } catch (err) {
    return `Error deleting: ${String(err)}`;
  }
}

export function moveFile(src: string, dest: string): string {
  try {
    const absSrc  = requireWorkspacePath(src);
    const absDest = requireWorkspacePath(dest);
    if (!absSrc || !absDest)
      return "Access denied.";
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.renameSync(absSrc, absDest);
    return `Moved ${src} → ${dest}`;
  } catch (err) {
    return `Error moving: ${String(err)}`;
  }
}

export function copyFile(src: string, dest: string): string {
  try {
    const absSrc  = requireWorkspacePath(src);
    const absDest = requireWorkspacePath(dest);
    if (!absSrc || !absDest)
      return "Access denied.";
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.copyFileSync(absSrc, absDest);
    return `Copied ${src} → ${dest}`;
  } catch (err) {
    return `Error copying: ${String(err)}`;
  }
}

export function createDir(dirPath: string): string {
  try {
    const absPath = requireWorkspacePath(dirPath);
    if (!absPath) return "Access denied.";
    fs.mkdirSync(absPath, { recursive: true });
    return `Directory created: ${dirPath}`;
  } catch (err) {
    return `Error creating directory: ${String(err)}`;
  }
}

export function listDir(dirPath = '.'): string {
  try {
    const absPath = requireWorkspacePath(dirPath);
    if (!absPath) return "Access denied.";
    if (!fs.existsSync(absPath)) return "Directory not found.";
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    const lines = entries.map(e => {
      const name = e.isDirectory() ? `${e.name}/` : e.name;
      const stat = fs.statSync(path.join(absPath, e.name));
      const size = e.isDirectory() ? '' : ` (${stat.size}b)`;
      return `${name}${size}`;
    });
    return lines.join('\n') || '(empty)';
  } catch (err) {
    return `Error listing directory: ${String(err)}`;
  }
}

export function fileExists(filepath: string): string {
  try {
    const absPath = requireWorkspacePath(filepath);
    if (!absPath) return "Access denied.";
    const exists = fs.existsSync(absPath);
    if (!exists) return `Not found: ${filepath}`;
    const stat = fs.statSync(absPath);
    return `${filepath}: ${stat.isDirectory() ? 'directory' : 'file'}, ${stat.size} bytes, modified ${stat.mtime.toISOString()}`;
  } catch (err) {
    return `Error: ${String(err)}`;
  }
}

export async function zipFiles(files: string, outPath: string): Promise<string> {
  try {
    const absOut = requireWorkspacePath(outPath);
    if (!absOut) return "Access denied.";
    const cmd = process.platform === 'win32'
      ? `powershell -Command "Compress-Archive -Path '${files.replace(/'/g, "''")}' -DestinationPath '${absOut.replace(/'/g, "''")}' -Force"`
      : `zip -r "${absOut}" ${files}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd: ROOT, timeout: 30_000 });
    return `Zipped to ${outPath}\n${stdout || stderr}`.trim();
  } catch (e: any) {
    return `Zip error: ${e.message}`;
  }
}

export async function unzipFile(zipPath: string, destDir = '.'): Promise<string> {
  try {
    const absZip  = requireWorkspacePath(zipPath);
    const absDest = requireWorkspacePath(destDir);
    if (!absZip || !absDest)
      return "Access denied.";
    const cmd = process.platform === 'win32'
      ? `powershell -Command "Expand-Archive -Path '${absZip.replace(/'/g, "''")}' -DestinationPath '${absDest.replace(/'/g, "''")}' -Force"`
      : `unzip -o "${absZip}" -d "${absDest}"`;
    const { stdout } = await execAsync(cmd, { cwd: ROOT, timeout: 30_000 });
    return `Extracted to ${destDir}\n${stdout}`.trim();
  } catch (e: any) {
    return `Unzip error: ${e.message}`;
  }
}

// ── Advanced Search & Edit Tools ─────────────────────────────────────────────

/**
 * Read a specific line range from a file.
 * Lines are 1-indexed. Ideal for large files where read_file would truncate.
 */
export function readFileRange(filepath: string, startLine: number, endLine: number): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const lines = fs.readFileSync(absPath, 'utf8').split('\n');
    const total = lines.length;
    const from = Math.max(1, startLine) - 1;
    const to   = Math.min(total, endLine);
    if (from >= total) return `Start line ${startLine} exceeds file length (${total} lines).`;
    const slice = lines.slice(from, to);
    const numbered = slice.map((l, i) => `${from + i + 1}\t${l}`).join('\n');
    return `${filepath} lines ${from + 1}–${to} of ${total}:\n${numbered}`;
  } catch (err) {
    return `Error reading range: ${String(err)}`;
  }
}

/**
 * Find files matching a name pattern (substring or *.ext) in a directory tree.
 * Skips node_modules, .next, .git, dist. Returns up to 200 matches.
 */
export function findFiles(pattern: string, dirPath = '.'): string {
  try {
    const absDir = resolveWorkspacePath(dirPath);
    if (!fs.existsSync(absDir)) return `Directory not found: ${dirPath}`;
    const SKIP = new Set(['node_modules', '.next', '.git', 'dist', '__pycache__', '.cache']);
    const results: string[] = [];

    // Convert glob-like pattern to a matcher
    const ext = pattern.startsWith('*.') ? pattern.slice(2) : null;
    const contains = ext ? null : pattern.toLowerCase().replace(/\*/g, '');

    function walk(dir: string) {
      if (results.length >= 200) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          const nameL = e.name.toLowerCase();
          const match = ext ? nameL.endsWith('.' + ext) : (contains ? nameL.includes(contains) : true);
          if (match) results.push(path.relative(ROOT, full));
        }
      }
    }
    walk(absDir);
    if (!results.length) return `No files matching '${pattern}' found in ${dirPath}.`;
    return `${results.length} file(s) matching '${pattern}':\n${results.join('\n')}`;
  } catch (err) {
    return `Error finding files: ${String(err)}`;
  }
}

/**
 * Search for a text query across files with context lines.
 * Returns file:linenum: content format, max maxResults matches.
 * Optionally filter by file extension (e.g. "ts", "py").
 */
export function searchInFiles(
  query: string, fileExt?: string, dirPath = '.', maxResults = 30
): string {
  try {
    const absDir = resolveWorkspacePath(dirPath);
    if (!fs.existsSync(absDir)) return `Directory not found: ${dirPath}`;
    const SKIP = new Set(['node_modules', '.next', '.git', 'dist', '__pycache__', '.cache']);
    const results: string[] = [];
    const queryL = query.toLowerCase();
    let filesScanned = 0;

    function walk(dir: string) {
      if (results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (results.length >= maxResults) return;
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          if (fileExt && !e.name.endsWith('.' + fileExt)) continue;
          // Skip binary-looking files
          if (/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|zip|bin|exe|dll|so|dylib|pdf)$/i.test(e.name)) continue;
          try {
            const content = fs.readFileSync(full, 'utf8');
            filesScanned++;
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
              if (lines[i].toLowerCase().includes(queryL)) {
                const rel = path.relative(ROOT, full);
                // Show 1 line of context before and after
                const ctx = [
                  i > 0 ? `    ${i}: ${lines[i - 1]}` : null,
                  `>>> ${i + 1}: ${lines[i].trimEnd()}`,
                  i < lines.length - 1 ? `    ${i + 2}: ${lines[i + 1]}` : null,
                ].filter(Boolean).join('\n');
                results.push(`${rel}:\n${ctx}`);
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }
    walk(absDir);
    if (!results.length) return `No matches for '${query}' in ${dirPath}${fileExt ? ` (*.${fileExt})` : ''} (${filesScanned} files scanned).`;
    return `${results.length} match(es) for '${query}'${fileExt ? ` in *.${fileExt}` : ''} (${filesScanned} files scanned):\n\n${results.join('\n\n')}`;
  } catch (err) {
    return `Error searching: ${String(err)}`;
  }
}

/**
 * Extract content between two marker strings (inclusive of markers).
 * Useful for extracting a function, class, section, or block from a large file.
 */
export function extractSection(filepath: string, startMarker: string, endMarker: string): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const content = fs.readFileSync(absPath, 'utf8');
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) return `Start marker not found: "${startMarker}"`;
    const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) return `End marker not found after start: "${endMarker}"`;
    const section = content.slice(startIdx, endIdx + endMarker.length);
    // Report line numbers
    const startLine = content.slice(0, startIdx).split('\n').length;
    const endLine   = content.slice(0, endIdx + endMarker.length).split('\n').length;
    return `${filepath} lines ${startLine}–${endLine}:\n${section}`;
  } catch (err) {
    return `Error extracting section: ${String(err)}`;
  }
}

/**
 * Insert content at a specific line number (1-indexed).
 * Existing content at and after that line is shifted down.
 */
export function insertAtLine(filepath: string, lineNumber: number, content: string): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const lines = fs.readFileSync(absPath, 'utf8').split('\n');
    const idx = Math.max(0, Math.min(lines.length, lineNumber - 1));
    lines.splice(idx, 0, ...content.split('\n'));
    fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
    return `✓ Inserted ${content.split('\n').length} line(s) at line ${lineNumber} in ${filepath}.`;
  } catch (err) {
    return `Error inserting at line: ${String(err)}`;
  }
}

/**
 * Delete a range of lines from a file (1-indexed, inclusive).
 */
export function deleteLines(filepath: string, startLine: number, endLine: number): string {
  try {
    const absPath = resolveWorkspacePath(filepath);
    if (!fs.existsSync(absPath)) return `File not found: ${filepath}`;
    const lines = fs.readFileSync(absPath, 'utf8').split('\n');
    const from  = Math.max(1, startLine) - 1;
    const count = Math.min(lines.length, endLine) - from;
    if (count <= 0) return `No lines to delete in range ${startLine}–${endLine}.`;
    lines.splice(from, count);
    fs.writeFileSync(absPath, lines.join('\n'), 'utf8');
    return `✓ Deleted lines ${startLine}–${endLine} (${count} line${count !== 1 ? 's' : ''}) from ${filepath}.`;
  } catch (err) {
    return `Error deleting lines: ${String(err)}`;
  }
}

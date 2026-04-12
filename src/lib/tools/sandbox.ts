// src/lib/tools/sandbox.ts
// Proxy service to provide the agent with internet access.
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { ROOT } from '../paths-core';

const execAsync = promisify(exec);

function resolveWorkspacePath(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(ROOT, targetPath);
}

function isWithinWorkspace(targetPath: string): boolean {
  return targetPath === ROOT || targetPath.startsWith(ROOT + path.sep);
}

export async function searchInternet(query: string): Promise<string> {
  // Uses a public API like DuckDuckGo HTML or just mocks it for now if we don't configure an API key. 
  // For this prototype, we'll try fetching Wikipedia search to guarantee a result, or DuckDuckGo HTML.
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed");
    const text = await res.text();
    
    // Quick regex to grab snippet lengths (highly simplified parser)
    const snippets = [...text.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/g)].map(m => m[1]
      .replace(/<b>/g, "")
      .replace(/<\/b>/g, "")
      .replace(/<\/?[^>]+(>|$)/g, ""));
      
    if (snippets.length === 0) return "No results found.";
    return snippets.slice(0, 5).join("\n- ");
  } catch (error) {
    return `Error searching: ${String(error)}`;
  }
}

export async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ShapeAgent/1.0" }});
    if (!res.ok) throw new Error("Fetch failed");
    const text = await res.text();
    
    // Strip HTML to get just text content
    const content = text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
      
    return content.substring(0, 8000); // Limit to 8000 chars for context
  } catch (error) {
    return `Error fetching URL: ${String(error)}`;
  }
}

export async function extractLinks(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ShapeAgent/1.0" }});
    if (!res.ok) throw new Error("Fetch failed");
    const text = await res.text();
    
    // Very basic regex to grab absolute and relative hrefs
    const regex = /href="(https?:\/\/[^\s"]+)"/g;
    const links = new Set<string>();
    let match;
    while ((match = regex.exec(text)) !== null) {
      links.add(match[1]);
    }
    
    if (links.size === 0) return "No links found.";
    return "Extracted Links:\n" + Array.from(links).slice(0, 15).join("\n");
  } catch (err) {
    return `Error extracting links: ${err}`;
  }
}

export async function httpPost(url: string, bodyJson: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        "Content-Type": "application/json",
        "User-Agent": "ShapeAgent/1.0" 
      },
      body: bodyJson
    });
    
    const text = await res.text();
    return `Status: ${res.status}\nResponse: ${text.substring(0, 1000)}`;
  } catch (err) {
    return `Error making POST request: ${err}`;
  }
}

export async function runTerminalCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
    return `STDOUT:\n${stdout.substring(0, 2000)}\nSTDERR:\n${stderr.substring(0, 1000)}`;
  } catch (err: any) {
    return `Execution Error: ${err.message}\n${err.stdout ? 'STDOUT: ' + err.stdout : ''}\n${err.stderr ? 'STDERR: ' + err.stderr : ''}`;
  }
}

export async function runPython(code: string, timeoutMs = 120_000): Promise<string> {
  // Use OS temp dir + unique ID to avoid race conditions and CWD pollution
  const tempFile = path.join(
    os.tmpdir(),
    `agent_py_${Date.now()}_${Math.random().toString(36).substring(2)}.py`
  );
  const venvPath = path.join(/*turbopackIgnore: true*/ process.cwd(), '.agent_venv');
  const pythonCmd = process.platform === 'win32'
    ? path.join(venvPath, 'Scripts', 'python.exe')
    : path.join(venvPath, 'bin', 'python');

  try {
    if (!fs.existsSync(venvPath)) {
      await execAsync(`python -m venv "${venvPath}"`, { timeout: 60000 });
    }

    fs.writeFileSync(tempFile, code, 'utf8');
    const { stdout, stderr } = await execAsync(`"${pythonCmd}" "${tempFile}"`, { timeout: timeoutMs });
    // Avoid truncating user output; keep full logs so debugging and large notebook-style results are preserved.
    const trimmedStdout = stdout.length > 200000 ? `${stdout.slice(0, 200000)}\n... [output truncated to 200k chars]` : stdout;
    const trimmedStderr = stderr.length > 100000 ? `${stderr.slice(0, 100000)}\n... [stderr truncated to 100k chars]` : stderr;
    return `Python STDOUT:\n${trimmedStdout}\nSTDERR:\n${trimmedStderr}`;
  } catch (err: any) {
    const errStdout = err.stdout || '';
    const errStderr = err.stderr || err.message || '';
    const trimmedErrStdout = errStdout.length > 200000 ? `${errStdout.slice(0, 200000)}\n... [output truncated to 200k chars]` : errStdout;
    const trimmedErrStderr = errStderr.length > 100000 ? `${errStderr.slice(0, 100000)}\n... [stderr truncated to 100k chars]` : errStderr;
    return `Python Error:\nSTDOUT:\n${trimmedErrStdout}\nSTDERR:\n${trimmedErrStderr}`;
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

// SMS functionality removed. Subroutines and Telegram are now primary communication/task paths.

// ── Claude Code-style Codebase Tools ────────────────────────────────────────

export async function listFiles(dirPath: string = '.'): Promise<string> {
  const absPath = resolveWorkspacePath(dirPath);
  if (!isWithinWorkspace(absPath)) return "Access denied: Cannot list outside workspace.";

  const results: string[] = [];
  async function walk(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const res = path.resolve(dir, file.name);
      const rel = path.relative(ROOT, res);
      
      // Filter out noisy directories
      if (rel.includes('node_modules') || rel.includes('.next') || rel.includes('.git')) continue;

      if (file.isDirectory()) {
         await walk(res);
      } else {
         results.push(rel);
      }
    }
  }

  try {
    await walk(absPath);
    return `Codebase Files:\n${results.slice(0, 500).join('\n')}${results.length > 500 ? '\n... (truncated to 500 files)' : ''}`;
  } catch (err: any) {
    return `Error listing files: ${err.message}`;
  }
}

export async function grepSearch(query: string, dirPath: string = '.'): Promise<string> {
  const absPath = resolveWorkspacePath(dirPath);
  const escaped = query.replace(/'/g, "'\\''").replace(/"/g, '\\"');

  // Try ripgrep first (fastest), then git grep, then platform fallback
  const rg = `rg --no-heading -n --glob "!node_modules" --glob "!.next" --glob "!.git" -i "${escaped}" "${absPath}"`;
  const winFindstr = `findstr /s /i /n /c:"${query}" "${absPath}\\*.*"`;
  const posixGrep = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.py" --include="*.md" -i "${escaped}" "${absPath}"`;

  const cmds = process.platform === 'win32'
    ? [rg, winFindstr]
    : [rg, posixGrep];

  for (const cmd of cmds) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 20000 });
      const matches = stdout.split('\n')
        .filter(m => m.trim())
        .filter(m => !m.includes('node_modules') && !m.includes('.next') && !m.includes('.git'));
      if (matches.length > 0) {
        return `Search Results for "${query}":\n${matches.slice(0, 50).join('\n')}${matches.length > 50 ? '\n... (truncated)' : ''}`;
      }
    } catch (err: any) {
      // exit code 1 = no matches for grep/rg, try next
      if (err.code === 1 || err.code === '1') continue;
      // command not found, try next
      if (err.message?.includes('not found') || err.message?.includes('not recognized')) continue;
    }
  }
  return `No matches found for "${query}".`;
}

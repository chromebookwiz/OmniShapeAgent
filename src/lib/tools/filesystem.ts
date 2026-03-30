// src/lib/tools/filesystem.ts
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Define where skills are stored
const SKILLS_DIR = path.join(process.cwd(), 'skills');

export function listSkills(): string {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return 'No skills directory found.';
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
    if (files.length === 0) return 'No skill files found.';
    return files.map(f => f.replace('.md', '')).join(', ');
  } catch (err) {
    return `Error listing skills: ${String(err)}`;
  }
}

export function readSkill(skillName: string): string {
  try {
    const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
    const filepath = path.join(SKILLS_DIR, `${safeName}.md`);
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
    const absPath = path.resolve(process.cwd(), filepath);
    // basic security check to avoid traversing outside app directory entirely
    if (!absPath.startsWith(process.cwd())) {
      return "Access denied: Cannot read outside workspace.";
    }
    if (!fs.existsSync(absPath)) return "File not found.";
    return fs.readFileSync(absPath, 'utf8').substring(0, 10000);
  } catch (err) {
    return `Error reading file: ${String(err)}`;
  }
}

export function writeFile(filepath: string, content: string): string {
  try {
    const absPath = path.resolve(process.cwd(), filepath);
    if (!absPath.startsWith(process.cwd())) {
      return "Access denied: Cannot write outside workspace.";
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    return `Successfully wrote to ${filepath}`;
  } catch (err) {
    return `Error writing file: ${String(err)}`;
  }
}

export function patchFile(filepath: string, search: string, replace: string): string {
  try {
    const absPath = path.resolve(process.cwd(), filepath);
    if (!absPath.startsWith(process.cwd())) {
      return "Access denied: Cannot patch outside workspace.";
    }
    if (!fs.existsSync(absPath)) return "File not found.";
    const content = fs.readFileSync(absPath, 'utf8');
    if (!content.includes(search)) {
      return `Error: Search string not found in ${filepath}`;
    }
    // Replace all occurrences using a global split/join (avoids regex special char issues)
    const occurrences = content.split(search).length - 1;
    const newContent = content.split(search).join(replace);
    fs.writeFileSync(absPath, newContent, 'utf8');
    return `Successfully patched ${filepath} (${occurrences} occurrence${occurrences !== 1 ? 's' : ''} replaced)`;
  } catch (err) {
    return `Error patching file: ${String(err)}`;
  }
}

export function appendFile(filepath: string, content: string): string {
  try {
    const absPath = path.resolve(process.cwd(), filepath);
    if (!absPath.startsWith(process.cwd())) return "Access denied.";
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.appendFileSync(absPath, content, 'utf8');
    return `Appended ${content.length} chars to ${filepath}`;
  } catch (err) {
    return `Error appending: ${String(err)}`;
  }
}

export function deleteFile(filepath: string): string {
  try {
    const absPath = path.resolve(process.cwd(), filepath);
    if (!absPath.startsWith(process.cwd())) return "Access denied.";
    if (!fs.existsSync(absPath)) return "File not found.";
    fs.unlinkSync(absPath);
    return `Deleted ${filepath}`;
  } catch (err) {
    return `Error deleting: ${String(err)}`;
  }
}

export function moveFile(src: string, dest: string): string {
  try {
    const absSrc  = path.resolve(process.cwd(), src);
    const absDest = path.resolve(process.cwd(), dest);
    if (!absSrc.startsWith(process.cwd()) || !absDest.startsWith(process.cwd()))
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
    const absSrc  = path.resolve(process.cwd(), src);
    const absDest = path.resolve(process.cwd(), dest);
    if (!absSrc.startsWith(process.cwd()) || !absDest.startsWith(process.cwd()))
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
    const absPath = path.resolve(process.cwd(), dirPath);
    if (!absPath.startsWith(process.cwd())) return "Access denied.";
    fs.mkdirSync(absPath, { recursive: true });
    return `Directory created: ${dirPath}`;
  } catch (err) {
    return `Error creating directory: ${String(err)}`;
  }
}

export function listDir(dirPath = '.'): string {
  try {
    const absPath = path.resolve(process.cwd(), dirPath);
    if (!absPath.startsWith(process.cwd())) return "Access denied.";
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
    const absPath = path.resolve(process.cwd(), filepath);
    if (!absPath.startsWith(process.cwd())) return "Access denied.";
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
    const absOut = path.resolve(process.cwd(), outPath);
    if (!absOut.startsWith(process.cwd())) return "Access denied.";
    const cmd = process.platform === 'win32'
      ? `powershell -Command "Compress-Archive -Path '${files.replace(/'/g, "''")}' -DestinationPath '${absOut.replace(/'/g, "''")}' -Force"`
      : `zip -r "${absOut}" ${files}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd: process.cwd(), timeout: 30_000 });
    return `Zipped to ${outPath}\n${stdout || stderr}`.trim();
  } catch (e: any) {
    return `Zip error: ${e.message}`;
  }
}

export async function unzipFile(zipPath: string, destDir = '.'): Promise<string> {
  try {
    const absZip  = path.resolve(process.cwd(), zipPath);
    const absDest = path.resolve(process.cwd(), destDir);
    if (!absZip.startsWith(process.cwd()) || !absDest.startsWith(process.cwd()))
      return "Access denied.";
    const cmd = process.platform === 'win32'
      ? `powershell -Command "Expand-Archive -Path '${absZip.replace(/'/g, "''")}' -DestinationPath '${absDest.replace(/'/g, "''")}' -Force"`
      : `unzip -o "${absZip}" -d "${absDest}"`;
    const { stdout } = await execAsync(cmd, { cwd: process.cwd(), timeout: 30_000 });
    return `Extracted to ${destDir}\n${stdout}`.trim();
  } catch (e: any) {
    return `Unzip error: ${e.message}`;
  }
}

// src/lib/tools/git.ts — Git operations for the agent
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const CWD = process.cwd();

const run = async (cmd: string, cwd = CWD, timeout = 30_000) => {
  const { stdout, stderr } = await execAsync(cmd, { cwd, timeout });
  return (stdout + (stderr ? `\nSTDERR: ${stderr}` : '')).trim();
};

const safe = async (cmd: string, cwd = CWD, timeout = 30_000): Promise<string> => {
  try {
    return await run(cmd, cwd, timeout) || '(no output)';
  } catch (e: any) {
    return `git error: ${e.stderr || e.message}`;
  }
};

export const gitStatus    = (dir?: string) => safe('git status --short --branch', dir ? path.resolve(CWD, dir) : CWD);
export const gitDiff      = (args = '')    => safe(`git diff ${args}`);
export const gitLog       = (n = 20)       => safe(`git log --oneline --decorate -${n}`);
export const gitAdd       = (files = '.')  => safe(`git add ${files}`);
export const gitCommit    = (msg: string)  => safe(`git commit -m ${JSON.stringify(msg)}`);
export const gitPull      = (args = '')    => safe(`git pull ${args}`, CWD, 60_000);
export const gitPush      = (args = '')    => safe(`git push ${args}`, CWD, 60_000);
export const gitBranch    = (args = '')    => safe(`git branch ${args}`);
export const gitCheckout  = (b: string)    => safe(`git checkout ${b}`);
export const gitStash     = (args = '')    => safe(`git stash ${args}`);
export const gitReset     = (args: string) => safe(`git reset ${args}`);
export const gitShow      = (ref = 'HEAD') => safe(`git show ${ref} --stat`);

export async function gitClone(url: string, dest?: string): Promise<string> {
  if (!url.startsWith('http') && !url.startsWith('git@'))
    return 'Invalid git URL.';
  const cmd = dest ? `git clone ${url} ${dest}` : `git clone ${url}`;
  return safe(cmd, CWD, 120_000);
}

export async function gitInit(dir?: string): Promise<string> {
  const target = dir ? path.resolve(CWD, dir) : CWD;
  return safe('git init', target);
}

export async function gitBlame(filepath: string): Promise<string> {
  if (!filepath) return 'filepath required';
  return safe(`git blame ${filepath} --line-porcelain`);
}

export async function gitGrep(pattern: string): Promise<string> {
  return safe(`git grep -n ${JSON.stringify(pattern)}`);
}

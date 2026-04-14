// src/lib/tools/installer.ts — Package and Python installation tools
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const CWD = /*turbopackIgnore: true*/ process.cwd();

// Path to the venv pip executable (used by runPython, always preferred over system pip)
const VENV_DIR = path.join(/*turbopackIgnore: true*/ CWD, '.agent_venv');
const VENV_PIP = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'pip.exe')
  : path.join(VENV_DIR, 'bin', 'pip');
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python');

async function run(cmd: string, cwd = CWD, timeout = 120_000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, timeout });
    return (stdout + (stderr ? `\n${stderr}` : '')).trim() || '(done)';
  } catch (e: any) {
    return `Error: ${e.stderr || e.message}`;
  }
}

export async function installNpm(pkg: string, global = false): Promise<string> {
  if (!pkg) return 'Package name required.';
  const cmd = global ? `npm install -g ${pkg}` : `npm install ${pkg}`;
  return run(cmd);
}

export async function installPip(pkg: string): Promise<string> {
  if (!pkg) return 'Package name required.';
  const normalizedPackages = pkg
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ');
  if (!normalizedPackages) return 'Package name required.';

  if (!fs.existsSync(VENV_PIP)) {
    return 'Python venv missing. Run npm install to create .agent_venv before using install_pip.';
  }

  const pipCmd = `"${VENV_PIP}" install --upgrade ${normalizedPackages}`;
  return run(pipCmd, CWD, 180_000);
}

/** Pre-install torch into the venv (CPU build, no GPU required).
 *  Called at startup to ensure torch is always available for bots. */
export async function ensureTorch(): Promise<string> {
  if (!fs.existsSync(VENV_PYTHON)) {
    return 'venv not found. Run npm install to create .agent_venv first.';
  }

  // Quick check: is torch already importable?
  const check = await run(
    `"${VENV_PYTHON}" -c "import torch; print('ok', torch.__version__)"`,
    CWD,
    10_000
  );
  if (check.includes('ok')) return `torch already installed: ${check.trim()}`;

  // Install CPU-only torch + torchvision (small download, no CUDA needed)
  const idx = 'https://download.pytorch.org/whl/cpu';
  const installResult = await run(
    `"${VENV_PIP}" install torch torchvision --index-url ${idx}`,
    CWD,
    600_000   // 10 min timeout — torch is a large package
  );
  return installResult;
}

/** Verify torch is importable and return version string. */
export async function checkTorch(): Promise<string> {
  if (!fs.existsSync(VENV_PYTHON)) return 'venv not found. Run npm install to create .agent_venv first.';
  return run(`"${VENV_PYTHON}" -c "import torch; print(torch.__version__)"`, CWD, 10_000);
}

export async function checkInstalled(tool: string): Promise<string> {
  const cmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;
  const result = await run(cmd, CWD, 5_000);
  return result.startsWith('Error') ? `${tool} not found in PATH.` : `${tool} found: ${result}`;
}

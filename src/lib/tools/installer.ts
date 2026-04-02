// src/lib/tools/installer.ts — Package and CLI installation tools
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

  // Ensure the venv exists — create it if missing
  if (!fs.existsSync(VENV_DIR)) {
    const createResult = await run(`python -m venv "${VENV_DIR}"`, CWD, 60_000);
    if (createResult.startsWith('Error')) {
      const createResult3 = await run(`python3 -m venv "${VENV_DIR}"`, CWD, 60_000);
      if (createResult3.startsWith('Error')) {
        return `Failed to create venv: ${createResult3}`;
      }
    }
  }

  // Use venv pip when available, fall back to system pip
  const pipCmd = fs.existsSync(VENV_PIP)
    ? `"${VENV_PIP}" install --upgrade ${pkg}`
    : `pip install ${pkg}`;

  const result = await run(pipCmd, CWD, 180_000);
  if (result.startsWith('Error') && !fs.existsSync(VENV_PIP)) {
    return await run(`pip3 install ${pkg}`, CWD, 180_000);
  }
  return result;
}

/** Pre-install torch into the venv (CPU build, no GPU required).
 *  Called at startup to ensure torch is always available for bots. */
export async function ensureTorch(): Promise<string> {
  if (!fs.existsSync(VENV_PYTHON)) {
    return 'venv not found — call install_pip first.';
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
  if (!fs.existsSync(VENV_PYTHON)) return 'venv not found.';
  return run(`"${VENV_PYTHON}" -c "import torch; print(torch.__version__)"`, CWD, 10_000);
}

export async function installCli(): Promise<string> {
  // Ensure the bin script is executable
  const binPath = path.join(CWD, 'bin', 'shapagent.js');
  if (!fs.existsSync(binPath)) {
    return `bin/shapagent.js not found. It should exist in the project root's bin/ directory.`;
  }

  // Mark executable on Unix
  if (process.platform !== 'win32') {
    try { fs.chmodSync(binPath, '755'); } catch {}
  }

  // npm link registers the bin entries in package.json globally
  const linkResult = await run('npm link', CWD, 30_000);

  // Verify
  const whereCmd = process.platform === 'win32' ? 'where shapagent' : 'which shapagent';
  const location = await run(whereCmd, CWD, 5_000);

  return [
    `CLI install result: ${linkResult}`,
    `Location: ${location}`,
    `Run 'shapagent' from any directory to start the terminal interface.`,
    `Or: shapagent --run "your task"`,
  ].join('\n');
}

export async function uninstallCli(): Promise<string> {
  return run('npm unlink -g e8-agent', CWD, 30_000);
}

export async function checkInstalled(tool: string): Promise<string> {
  const cmd = process.platform === 'win32' ? `where ${tool}` : `which ${tool}`;
  const result = await run(cmd, CWD, 5_000);
  return result.startsWith('Error') ? `${tool} not found in PATH.` : `${tool} found: ${result}`;
}

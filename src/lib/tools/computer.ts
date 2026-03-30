// src/lib/tools/computer.ts
// Computer use: screenshot, mouse, keyboard, browser automation via pyautogui
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

function venvPython(): string {
  const venv = path.join(process.cwd(), '.agent_venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

async function ensurePyautogui(): Promise<void> {
  const venv = path.join(process.cwd(), '.agent_venv');
  if (!fs.existsSync(venv)) {
    await execAsync(`python -m venv "${venv}"`, { timeout: 60000 });
  }
  const py = venvPython();
  // Install pyautogui + Pillow if not present
  try {
    await execAsync(`"${py}" -c "import pyautogui, PIL"`, { timeout: 5000 });
  } catch {
    const pip = process.platform === 'win32'
      ? path.join(venv, 'Scripts', 'pip.exe')
      : path.join(venv, 'bin', 'pip');
    await execAsync(`"${pip}" install pyautogui pillow`, { timeout: 120000 });
  }
}

async function runPyCode(code: string, timeout = 15000): Promise<string> {
  const tmp = path.join(os.tmpdir(), `agent_comp_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  try {
    fs.writeFileSync(tmp, code, 'utf8');
    const { stdout, stderr } = await execAsync(`"${venvPython()}" "${tmp}"`, { timeout });
    return (stdout + (stderr ? '\nSTDERR: ' + stderr : '')).trim();
  } catch (e: any) {
    return `Error: ${e.stderr || e.message}`;
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export async function takeScreenshot(outputPath?: string): Promise<string> {
  try {
    await ensurePyautogui();
    // Default: save to screenshots/ workspace folder (not OS temp)
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    try { if (!require('fs').existsSync(screenshotsDir)) require('fs').mkdirSync(screenshotsDir, { recursive: true }); } catch {}
    const outFile = outputPath
      ? path.resolve(process.cwd(), outputPath)
      : path.join(screenshotsDir, `screenshot_${Date.now()}.png`);
    const code = `
import pyautogui
img = pyautogui.screenshot()
img.save(r"${outFile.replace(/\\/g, '\\\\')}")
print(r"Screenshot saved: ${outFile.replace(/\\/g, '\\\\')}")
print(f"Size: {img.width}x{img.height}")
`;
    return await runPyCode(code, 10000);
  } catch (e: any) {
    return `Screenshot error: ${e.message}`;
  }
}

export async function getScreenSize(): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
w, h = pyautogui.size()
print(f"Screen size: {w}x{h}")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function getMousePos(): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
x, y = pyautogui.position()
print(f"Mouse position: ({x}, {y})")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function mouseMove(x: number, y: number, duration = 0.2): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
pyautogui.moveTo(${x}, ${y}, duration=${duration})
print(f"Moved mouse to ({${x}}, {${y}})")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function mouseClick(x: number, y: number, button = 'left', clicks = 1): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
pyautogui.click(${x}, ${y}, button='${button}', clicks=${clicks})
print(f"Clicked ({${x}}, {${y}}) button=${button} clicks=${clicks}")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function mouseDoubleClick(x: number, y: number): Promise<string> {
  return mouseClick(x, y, 'left', 2);
}

export async function mouseDrag(x1: number, y1: number, x2: number, y2: number, duration = 0.3): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
pyautogui.moveTo(${x1}, ${y1})
pyautogui.dragTo(${x2}, ${y2}, duration=${duration}, button='left')
print(f"Dragged ({${x1}},{${y1}}) -> ({${x2}},{${y2}})")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function mouseScroll(x: number, y: number, clicks: number): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
pyautogui.moveTo(${x}, ${y})
pyautogui.scroll(${clicks})
print(f"Scrolled {${clicks}} clicks at ({${x}}, {${y}})")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function keyboardType(text: string, interval = 0.02): Promise<string> {
  try {
    await ensurePyautogui();
    // Escape backslashes and quotes in text
    const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return await runPyCode(`
import pyautogui
pyautogui.typewrite(${JSON.stringify(text)}, interval=${interval})
print("Typed: ${safeText.substring(0, 50)}${text.length > 50 ? '...' : ''}")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function keyboardPress(key: string): Promise<string> {
  try {
    await ensurePyautogui();
    return await runPyCode(`
import pyautogui
pyautogui.press('${key}')
print(f"Pressed key: ${key}")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function keyboardHotkey(...keys: string[]): Promise<string> {
  try {
    await ensurePyautogui();
    const keyList = keys.map(k => `'${k}'`).join(', ');
    return await runPyCode(`
import pyautogui
pyautogui.hotkey(${keyList})
print(f"Hotkey: ${keys.join('+')} pressed")
`);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export async function openUrl(url: string): Promise<string> {
  try {
    const cmd = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
    await execAsync(cmd, { timeout: 5000 });
    return `Opened browser: ${url}`;
  } catch (e: any) {
    return `Error opening URL: ${e.message}`;
  }
}

export async function waitMs(ms: number): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, ms));
  return `Waited ${ms}ms`;
}

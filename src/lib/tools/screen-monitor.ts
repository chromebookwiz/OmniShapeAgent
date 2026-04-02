// src/lib/tools/screen-monitor.ts
// Real-time screen monitor: runs a persistent Python subprocess that captures
// frames at a configurable rate and emits JSON events only when the screen
// changes above a threshold. The model reacts to change, not every frame.
import { spawn, ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ── State ────────────────────────────────────────────────────────────────────

let monitorProcess: ChildProcess | null = null;
let stdoutBuffer = '';
const pendingWaits = new Map<string, {
  resolve: (v: FrameInfo | null) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

export interface FrameInfo {
  path: string;
  diff: number;
  ts: number;
  frame: number;
}

const MONITOR_DIR = path.join(os.tmpdir(), 'agent-screen-monitor');
const METADATA_PATH = path.join(MONITOR_DIR, 'metadata.json');

// ── Python monitor script (embedded) ────────────────────────────────────────

const MONITOR_PY = `
import sys, json, os, time, pathlib, threading, io

monitor_dir = sys.argv[1]
target_fps  = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
threshold   = float(sys.argv[3]) if len(sys.argv) > 3 else 0.02
region_json = sys.argv[4] if len(sys.argv) > 4 else 'null'
region      = json.loads(region_json)  # None or {x,y,w,h}

pathlib.Path(monitor_dir).mkdir(parents=True, exist_ok=True)
latest_path  = os.path.join(monitor_dir, 'latest.png')
metadata_path = os.path.join(monitor_dir, 'metadata.json')
frame_interval = 1.0 / target_fps

# ── Dependency check ──────────────────────────────────────────────────────────
try:
    import mss, mss.tools
    HAS_MSS = True
except ImportError:
    HAS_MSS = False

try:
    import numpy as np
    HAS_NP = True
except ImportError:
    HAS_NP = False

try:
    from PIL import Image, ImageChops
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

if not HAS_PIL and not HAS_MSS:
    try:
        import pyautogui
        HAS_PAG = True
    except ImportError:
        HAS_PAG = False
else:
    HAS_PAG = False

def capture():
    if HAS_MSS:
        with mss.mss() as sct:
            mon = region
            if mon:
                bbox = {"left": mon["x"], "top": mon["y"], "width": mon["w"], "height": mon["h"]}
            else:
                bbox = sct.monitors[0]
            raw = sct.grab(bbox)
            if HAS_PIL:
                img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
                return img
            # No PIL — save directly and return None
            buf = io.BytesIO()
            mss.tools.to_png(raw.rgb, raw.size, output=buf)
            with open(latest_path, 'wb') as f:
                f.write(buf.getvalue())
            return None
    elif HAS_PIL:
        from PIL import ImageGrab
        if region:
            return ImageGrab.grab(bbox=(region["x"], region["y"], region["x"]+region["w"], region["y"]+region["h"]))
        return ImageGrab.grab()
    elif HAS_PAG:
        import pyautogui
        return pyautogui.screenshot()
    return None

def diff(img1, img2):
    if img1 is None or img2 is None:
        return 1.0
    if HAS_NP and HAS_PIL:
        a1 = np.asarray(img1.convert('RGB'), dtype='float32')
        a2 = np.asarray(img2.convert('RGB'), dtype='float32')
        return float(np.mean(np.abs(a1 - a2))) / 255.0
    if HAS_PIL:
        d = ImageChops.difference(img1.convert('RGB'), img2.convert('RGB'))
        h = d.histogram()
        total = sum(h)
        nz = total - h[0]
        return nz / total if total > 0 else 0.0
    return 1.0

def emit(obj):
    sys.stdout.write(json.dumps(obj) + '\\n')
    sys.stdout.flush()

emit({"type": "ready", "fps": target_fps, "threshold": threshold, "dir": monitor_dir})

# ── Pending wait registry ─────────────────────────────────────────────────────
waits = {}  # id -> {threshold, deadline}
wait_lock = threading.Lock()

def stdin_thread():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            cmd = json.loads(raw)
            c = cmd.get("cmd")
            if c == "stop":
                os._exit(0)
            elif c == "get":
                emit({"type": "current", "path": latest_path})
            elif c == "wait":
                wid = cmd.get("id", "w0")
                thr = cmd.get("threshold", threshold)
                tms = cmd.get("timeout", 5000) / 1000.0
                with wait_lock:
                    waits[wid] = {"threshold": thr, "deadline": time.time() + tms}
        except Exception as e:
            emit({"type": "error", "msg": str(e)})

threading.Thread(target=stdin_thread, daemon=True).start()

# ── Main capture loop ─────────────────────────────────────────────────────────
prev_img = None
frame_count = 0

while True:
    t0 = time.time()
    try:
        img = capture()
    except Exception as e:
        emit({"type": "error", "msg": str(e)})
        time.sleep(1)
        continue

    if img is None:
        time.sleep(frame_interval)
        continue

    d = diff(prev_img, img) if prev_img is not None else 1.0

    if d >= threshold or prev_img is None:
        try:
            img.save(latest_path)
        except Exception as e:
            emit({"type": "error", "msg": f"save:{e}"})
            time.sleep(frame_interval)
            continue
        frame_count += 1
        meta = {"ts": time.time(), "diff": d, "path": latest_path, "frame": frame_count}
        with open(metadata_path, 'w') as f:
            json.dump(meta, f)
        emit({"type": "change", "diff": d, "path": latest_path, "frame": frame_count, "ts": meta["ts"]})
        # resolve waits
        with wait_lock:
            for wid, w in list(waits.items()):
                if d >= w["threshold"]:
                    emit({"type": "wait_result", "id": wid, "diff": d, "path": latest_path, "frame": frame_count, "ts": meta["ts"]})
                    del waits[wid]
        prev_img = img

    # expire timed-out waits
    now = time.time()
    with wait_lock:
        for wid, w in list(waits.items()):
            if now > w["deadline"]:
                emit({"type": "wait_timeout", "id": wid})
                del waits[wid]

    frame_count += 1
    sleep = frame_interval - (time.time() - t0)
    if sleep > 0:
        time.sleep(sleep)
`;

// ── Python helpers ───────────────────────────────────────────────────────────

function venvPython(): string {
  const venv = path.join(/*turbopackIgnore: true*/ process.cwd(), '.agent_venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

async function ensureMonitorDeps(): Promise<void> {
  const venv = path.join(/*turbopackIgnore: true*/ process.cwd(), '.agent_venv');
  const py = venvPython();
  if (!fs.existsSync(venv)) {
    execSync(`python -m venv "${venv}"`, { timeout: 60000, stdio: 'ignore' });
  }
  // Check if core deps exist
  try {
    execSync(`"${py}" -c "import PIL"`, { timeout: 5000, stdio: 'ignore' });
  } catch {
    const pip = process.platform === 'win32'
      ? path.join(venv, 'Scripts', 'pip.exe')
      : path.join(venv, 'bin', 'pip');
    execSync(`"${pip}" install pillow mss numpy --quiet`, { timeout: 120000, stdio: 'ignore' });
  }
}

// ── stdout handler ───────────────────────────────────────────────────────────

function handleMonitorLine(line: string): void {
  if (!line.trim()) return;
  try {
    const ev = JSON.parse(line);
    if (ev.type === 'wait_result' || ev.type === 'wait_timeout') {
      const pending = pendingWaits.get(ev.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingWaits.delete(ev.id);
        pending.resolve(ev.type === 'wait_result'
          ? { path: ev.path, diff: ev.diff, ts: ev.ts, frame: ev.frame }
          : null
        );
      }
    }
  } catch {
    // non-JSON monitor output — ignore
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function startScreenMonitor(options: {
  fps?: number;
  threshold?: number;
  region?: { x: number; y: number; w: number; h: number };
} = {}): Promise<string> {
  if (monitorProcess && !monitorProcess.killed) {
    return 'Screen monitor is already running.';
  }

  try {
    await ensureMonitorDeps();
  } catch (e: any) {
    return `Failed to install monitor dependencies: ${e.message}`;
  }

  const fps       = options.fps       ?? 10;
  const threshold = options.threshold ?? 0.02;
  const region    = options.region ? JSON.stringify(options.region) : 'null';

  // Write the monitor script to a temp file (avoids command-line escaping issues)
  const scriptPath = path.join(os.tmpdir(), `agent_monitor_${Date.now()}.py`);
  fs.writeFileSync(scriptPath, MONITOR_PY, 'utf8');

  monitorProcess = spawn(
    venvPython(),
    [scriptPath, MONITOR_DIR, String(fps), String(threshold), region],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  monitorProcess.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    lines.forEach(handleMonitorLine);
  });

  monitorProcess.on('exit', () => {
    monitorProcess = null;
    // Reject all pending waits
    for (const [, p] of pendingWaits) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    pendingWaits.clear();
    try { fs.unlinkSync(scriptPath); } catch {}
  });

  // Small delay to let Python start up
  await new Promise(r => setTimeout(r, 800));

  return `Screen monitor started (${fps} fps, threshold=${threshold}${options.region ? `, region=${JSON.stringify(options.region)}` : ', full screen'}).`;
}

export function stopScreenMonitor(): string {
  if (!monitorProcess || monitorProcess.killed) {
    return 'Screen monitor is not running.';
  }
  try {
    monitorProcess.stdin?.write(JSON.stringify({ cmd: 'stop' }) + '\n');
    monitorProcess.kill('SIGTERM');
    monitorProcess = null;
  } catch { monitorProcess = null; }
  return 'Screen monitor stopped.';
}

export function isMonitorRunning(): boolean {
  return !!(monitorProcess && !monitorProcess.killed);
}

export function getLatestFrame(): FrameInfo | null {
  try {
    if (!fs.existsSync(METADATA_PATH)) return null;
    const meta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
    return meta as FrameInfo;
  } catch {
    return null;
  }
}

export async function waitForScreenChange(options: {
  timeoutMs?: number;
  threshold?: number;
} = {}): Promise<string> {
  if (!monitorProcess || monitorProcess.killed) {
    return 'Error: screen monitor is not running. Call start_screen_monitor() first.';
  }

  const timeoutMs = options.timeoutMs ?? 5000;
  const threshold = options.threshold;
  const id = `w_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise<string>(resolve => {
    const timer = setTimeout(() => {
      pendingWaits.delete(id);
      resolve('Timeout: no screen change detected within ' + timeoutMs + 'ms');
    }, timeoutMs + 500); // +500ms buffer over Python-side timeout

    pendingWaits.set(id, {
      resolve: (frame) => {
        if (frame) {
          resolve(`Screen changed (diff=${frame.diff.toFixed(4)}, frame=${frame.frame}): ${frame.path}`);
        } else {
          resolve('Timeout: no screen change detected within ' + timeoutMs + 'ms');
        }
      },
      timer,
    });

    const cmd: Record<string, unknown> = { cmd: 'wait', id, timeout: timeoutMs };
    if (threshold !== undefined) cmd.threshold = threshold;
    monitorProcess!.stdin?.write(JSON.stringify(cmd) + '\n');
  });
}

export async function captureRegion(x: number, y: number, w: number, h: number): Promise<string> {
  try {
    await ensureMonitorDeps();
  } catch (e: any) {
    return `Dep error: ${e.message}`;
  }

  const outPath = path.join(os.tmpdir(), `region_${Date.now()}.png`);
  const py = venvPython();
  const scriptPath = path.join(os.tmpdir(), `agent_region_${Date.now()}.py`);
  const code = `
import sys
try:
    import mss, mss.tools, io
    from PIL import Image
    with mss.mss() as sct:
        bbox = {"left": ${x}, "top": ${y}, "width": ${w}, "height": ${h}}
        raw = sct.grab(bbox)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        img.save(r"${outPath.replace(/\\/g, '\\\\')}")
    print(r"${outPath.replace(/\\/g, '\\\\')}")
except ImportError:
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab(bbox=(${x}, ${y}, ${x + w}, ${y + h}))
        img.save(r"${outPath.replace(/\\/g, '\\\\')}")
        print(r"${outPath.replace(/\\/g, '\\\\')}")
    except Exception as e2:
        import pyautogui
        img = pyautogui.screenshot(region=(${x}, ${y}, ${w}, ${h}))
        img.save(r"${outPath.replace(/\\/g, '\\\\')}")
        print(r"${outPath.replace(/\\/g, '\\\\')}")
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;
  fs.writeFileSync(scriptPath, code, 'utf8');
  try {
    const { execSync: es } = await import('child_process');
    const result = es(`"${py}" "${scriptPath}"`, { timeout: 10000 }).toString().trim();
    return result || outPath;
  } catch (e: any) {
    return `Error capturing region: ${e.stderr || e.message}`;
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

export async function getScreenDiff(path1: string, path2: string): Promise<string> {
  try {
    await ensureMonitorDeps();
  } catch (e: any) {
    return `Dep error: ${e.message}`;
  }

  const diffPath = path.join(os.tmpdir(), `diff_${Date.now()}.png`);
  const scriptPath = path.join(os.tmpdir(), `agent_diff_${Date.now()}.py`);
  const code = `
import sys, json
try:
    import numpy as np
    from PIL import Image, ImageChops, ImageEnhance
    img1 = Image.open(r"${path1.replace(/\\/g, '\\\\')}").convert('RGB')
    img2 = Image.open(r"${path2.replace(/\\/g, '\\\\')}").convert('RGB')
    if img1.size != img2.size:
        img2 = img2.resize(img1.size)
    a1 = np.asarray(img1, dtype='float32')
    a2 = np.asarray(img2, dtype='float32')
    score = float(np.mean(np.abs(a1 - a2))) / 255.0
    # Save amplified diff image
    diff = ImageChops.difference(img1, img2)
    enhanced = ImageEnhance.Brightness(diff).enhance(5.0)
    enhanced.save(r"${diffPath.replace(/\\/g, '\\\\')}")
    print(json.dumps({"score": round(score, 6), "diffPath": r"${diffPath.replace(/\\/g, '\\\\')}", "changed": score > 0.01}))
except Exception as e:
    print(json.dumps({"error": str(e), "score": -1}))
`;
  const py = venvPython();
  fs.writeFileSync(scriptPath, code, 'utf8');
  try {
    const { execSync: es } = await import('child_process');
    const out = es(`"${py}" "${scriptPath}"`, { timeout: 15000 }).toString().trim();
    return out;
  } catch (e: any) {
    return JSON.stringify({ error: e.message, score: -1 });
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

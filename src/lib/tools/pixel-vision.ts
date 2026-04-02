// src/lib/tools/pixel-vision.ts
// Screen vectorization: compact color-grid + ASCII representations the LLM reads directly.
// Supports adaptive palette tuning (per-game), ASCII art, delta grids, and persistent
// palette configs that the model can create and refine over time.
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ── Paths ─────────────────────────────────────────────────────────────────────

const PALETTE_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'palette-configs');

// ── Default 16-color palette ──────────────────────────────────────────────────
// [label, name, R, G, B]
export type PaletteEntry = [string, string, number, number, number];

export const DEFAULT_PALETTE: PaletteEntry[] = [
  ['0', 'black',      0,   0,   0  ],
  ['1', 'white',      255, 255, 255],
  ['2', 'red',        200, 60,  60 ],
  ['3', 'green',      60,  200, 60 ],
  ['4', 'blue',       60,  60,  200],
  ['5', 'yellow',     255, 220, 0  ],
  ['6', 'cyan',       0,   220, 220],
  ['7', 'magenta',    200, 0,   200],
  ['8', 'orange',     255, 140, 0  ],
  ['9', 'dark_gray',  80,  80,  80 ],
  ['A', 'light_gray', 180, 180, 180],
  ['B', 'dark_blue',  0,   0,   120],
  ['C', 'brown',      120, 70,  30 ],
  ['D', 'pink',       255, 150, 200],
  ['E', 'dark_green', 0,   120, 0  ],
  ['F', 'sky_blue',   120, 180, 255],
];

// Keep the original export name for compatibility
export const PIXEL_PALETTE = DEFAULT_PALETTE;
export const PALETTE_KEY = DEFAULT_PALETTE.map(([l, n]) => `${l}=${n}`).join(' ');

// ── Helpers ───────────────────────────────────────────────────────────────────

function venvPython(): string {
  const venv = path.join(/*turbopackIgnore: true*/ process.cwd(), '.agent_venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function runPy(code: string, timeout = 25000): string {
  const tmp = path.join(os.tmpdir(), `pv_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    return execSync(`"${venvPython()}" "${tmp}"`, { timeout }).toString().trim();
  } catch (e: any) {
    return `Error: ${e.stderr?.toString().trim() || e.message}`;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function ensurePaletteDir() {
  if (!fs.existsSync(PALETTE_DIR)) fs.mkdirSync(PALETTE_DIR, { recursive: true });
}

function loadPalette(name?: string): PaletteEntry[] {
  if (!name) return DEFAULT_PALETTE;
  const p = path.join(PALETTE_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
  if (!fs.existsSync(p)) return DEFAULT_PALETTE;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PaletteEntry[];
  } catch {
    return DEFAULT_PALETTE;
  }
}

async function ensureScreenshot(imagePath?: string): Promise<string | null> {
  if (imagePath) return imagePath;
  const tmp = path.join(os.tmpdir(), `pv_cap_${Date.now()}.png`);
  const { takeScreenshot } = await import('./computer');
  const result = await takeScreenshot(tmp);
  return result.startsWith('Error') ? null : tmp;
}

// ── Core Python script builder ────────────────────────────────────────────────

function buildGridScript(imgPath: string, cols: number, rows: number, palette: PaletteEntry[]): string {
  const palettePy = JSON.stringify(palette.map(([label, , r, g, b]) => [label, r, g, b]));
  return `
import sys, json
try:
    from PIL import Image
    import numpy as np

    palette = ${palettePy}
    # Use perceptual (CIELAB-like) weighting: human eyes see green most, blue least
    W = np.array([0.299, 0.587, 0.114], dtype='float32')
    pal_np = np.array([[r, g, b] for _, r, g, b in palette], dtype='float32')
    labels = [e[0] for e in palette]

    img = Image.open(r"${imgPath.replace(/\\/g, '\\\\')}").convert('RGB')
    img = img.resize((${cols}, ${rows}), Image.LANCZOS)
    arr = np.array(img, dtype='float32')

    flat = arr.reshape(-1, 3)  # (N, 3)
    # Weighted Euclidean distance for perceptual accuracy
    diff = flat[:, None, :] - pal_np[None, :, :]   # (N, P, 3)
    dists = np.sum(diff ** 2 * W, axis=2)            # (N, P)
    indices = np.argmin(dists, axis=1)

    grid_labels = [labels[i] for i in indices]
    grid_ints   = indices.tolist()

    rows_text = []
    for r in range(${rows}):
        row = grid_labels[r * ${cols} : (r + 1) * ${cols}]
        rows_text.append(''.join(row))

    print(json.dumps({"grid": rows_text, "vector": grid_ints, "cols": ${cols}, "rows": ${rows}}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
}

// ── Internal delta state ──────────────────────────────────────────────────────
// Persists across calls within a server process so visionTick can diff frames.

let _lastVector: number[] | null = null;
let _lastCols = 0;
let _lastRows = 0;

function l2Delta(v1: number[], v2: number[]): number {
  // Normalized L2 distance in [0, 1]. 0 = identical, 1 = maximally different.
  const maxVal = 15; // palette has 16 colors (0-15)
  let sumSq = 0;
  for (let i = 0; i < Math.min(v1.length, v2.length); i++) sumSq += (v1[i] - v2[i]) ** 2;
  return Math.sqrt(sumSq) / Math.sqrt(v1.length * maxVal * maxVal);
}

function cellDeltaPct(v1: number[], v2: number[]): number {
  let changed = 0;
  for (let i = 0; i < Math.min(v1.length, v2.length); i++) if (v1[i] !== v2[i]) changed++;
  return v1.length ? (changed / v1.length) * 100 : 0;
}

interface Hotspot { topRow: number; bottomRow: number; leftCol: number; rightCol: number; changedCells: number }

function findHotspots(v1: number[], v2: number[], cols: number, rows: number): Hotspot {
  let minR = rows, maxR = 0, minC = cols, maxC = 0, count = 0;
  for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
    if (v1[i] !== v2[i]) {
      const r = Math.floor(i / cols), c = i % cols;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      count++;
    }
  }
  return count === 0
    ? { topRow: 0, bottomRow: 0, leftCol: 0, rightCol: 0, changedCells: 0 }
    : { topRow: minR, bottomRow: maxR, leftCol: minC, rightCol: maxC, changedCells: count };
}

export interface VisionFrame {
  changed: boolean;
  delta: number;        // normalized L2 distance from last frame [0–1]
  deltaPct: number;     // % of cells that changed color
  hotspot: Hotspot;     // bounding box of changed region
  vector: number[];     // flat palette-index array — the "math"
  grid: string;         // human-readable color grid
  imagePath: string;    // path to the PNG that was analyzed
  paletteKey: string;
  cols: number;
  rows: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a screenshot to a compact color grid the LLM reads spatially.
 * Each cell is a palette label (hex digit or custom char).
 *
 * @param imagePath   Path to image, or undefined to screenshot now.
 * @param cols        Grid width (default 64). More cols = more detail, more tokens.
 * @param rows        Grid height (default 36).
 * @param paletteName Named palette from palette-configs/<name>.json, or undefined for default.
 */
export async function screenToGrid(
  imagePath?: string,
  cols = 64,
  rows = 36,
  paletteName?: string,
): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return 'Error: could not take screenshot.';

  const palette = loadPalette(paletteName);
  const raw = runPy(buildGridScript(imgPath, cols, rows, palette));

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return `Parse error: ${raw}`; }
  if (parsed.error) return `Pixel vision error: ${parsed.error}`;

  const paletteKey = palette.map(([l, n]) => `${l}=${n}`).join(' ');
  const colHeader = Array.from({ length: cols }, (_, i) => i.toString(16).toUpperCase()).join('');
  const lines = (parsed.grid as string[]).map((row, i) =>
    `${String(i).padStart(2, '0')}|${row}`
  );

  return [
    `Grid: ${cols}×${rows}  Palette: ${paletteName ?? 'default'}  Key: ${paletteKey}`,
    `     ${colHeader}`,
    ...lines,
  ].join('\n');
}

/**
 * Return the flat numeric state vector for memory storage.
 * Smaller default (32×18) so it fits comfortably in memory_store.
 */
export async function screenToColorVector(
  imagePath?: string,
  cols = 32,
  rows = 18,
  paletteName?: string,
): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return 'Error: could not take screenshot.';

  const palette = loadPalette(paletteName);
  const raw = runPy(buildGridScript(imgPath, cols, rows, palette));

  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return `Parse error: ${raw}`; }
  if (parsed.error) return `Pixel vision error: ${parsed.error}`;

  return JSON.stringify({
    vector: parsed.vector,
    cols,
    rows,
    palette: paletteName ?? 'default',
    length: parsed.vector.length,
  });
}

/**
 * Compare two grid strings. Returns diff where '.' = unchanged, letter = new color.
 */
export function gridDiff(grid1Text: string, grid2Text: string): string {
  const parseGrid = (text: string) =>
    text.split('\n').filter(l => /^\d{2}\|/.test(l)).map(l => l.slice(3));

  const g1 = parseGrid(grid1Text);
  const g2 = parseGrid(grid2Text);
  if (!g1.length || !g2.length) return 'Error: pass output from screen_to_grid().';
  if (g1.length !== g2.length) return `Row count mismatch: ${g1.length} vs ${g2.length}`;

  let changed = 0;
  const diffRows = g1.map((row1, ri) => {
    const row2 = g2[ri] ?? '';
    const dr = Array.from({ length: Math.max(row1.length, row2.length) }, (_, ci) => {
      const c1 = row1[ci] ?? '0', c2 = row2[ci] ?? '0';
      if (c1 === c2) return '.';
      changed++;
      return c2;
    }).join('');
    return `${String(ri).padStart(2, '0')}|${dr}`;
  });

  const total = g1.length * (g1[0]?.length ?? 0);
  const pct = total > 0 ? ((changed / total) * 100).toFixed(1) : '0';
  return [`Diff: ${changed}/${total} cells changed (${pct}%)  "."=same letter=new_color`, ...diffRows].join('\n');
}

/**
 * Convert screenshot to ASCII art using brightness mapping.
 * No palette needed — pure luminance. Good for text-heavy screens and UI.
 *
 * Chars (dark→bright): ' .,:;i1tfLCG08@'
 */
export async function screenToAscii(
  imagePath?: string,
  cols = 80,
  rows = 40,
): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return 'Error: could not take screenshot.';

  const code = `
import json
try:
    from PIL import Image
    import numpy as np
    CHARS = ' .,:;i1tfLCG08@'
    N = len(CHARS) - 1
    img = Image.open(r"${imgPath.replace(/\\/g, '\\\\')}").convert('L')
    img = img.resize((${cols}, ${rows}), Image.LANCZOS)
    arr = np.array(img, dtype='float32') / 255.0
    rows_out = []
    for row in arr:
        rows_out.append(''.join(CHARS[round(float(v) * N)] for v in row))
    print(json.dumps({"ascii": rows_out, "cols": ${cols}, "rows": ${rows}}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;
  const raw = runPy(code);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return `Parse error: ${raw}`; }
  if (parsed.error) return `ASCII error: ${parsed.error}`;

  const lines = (parsed.ascii as string[]).map((row, i) => `${String(i).padStart(2, '0')}|${row}`);
  return [`ASCII ${cols}×${rows}:`, ...lines].join('\n');
}

/**
 * Analyze a screenshot and extract the N most visually dominant colors using k-means.
 * Optionally save the result as a named palette config for use in screen_to_grid.
 * The model SHOULD call this once per new game to tune its vision.
 *
 * @param imagePath   Screenshot to analyze (or undefined to take one now).
 * @param numColors   Number of dominant colors to extract (4–32, default 16).
 * @param saveName    If provided, save as palette-configs/<saveName>.json.
 */
export async function tunePalette(
  imagePath?: string,
  numColors = 16,
  saveName?: string,
): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return 'Error: could not take screenshot.';

  const n = Math.max(2, Math.min(32, numColors));
  const labels = '0123456789ABCDEFGHIJKLMNOPQRSTUVabcdefghijklmnopqrstuv'.slice(0, n);

  const code = `
import json, sys
try:
    from PIL import Image
    import numpy as np

    img = Image.open(r"${imgPath.replace(/\\/g, '\\\\')}").convert('RGB')
    # Downsample for speed — k-means on full 1080p is slow
    img = img.resize((160, 90), Image.LANCZOS)
    arr = np.array(img, dtype='float32').reshape(-1, 3)

    # Simple k-means (no sklearn dependency)
    n_clusters = ${n}
    np.random.seed(42)
    # Stratified init: pick pixels spread across brightness range
    brightness = arr.mean(axis=1)
    sorted_idx = np.argsort(brightness)
    step = max(1, len(sorted_idx) // n_clusters)
    centers = arr[sorted_idx[::step][:n_clusters]].copy()

    for iteration in range(20):
        # Assign each pixel to nearest center
        dists = np.sum((arr[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        assignments = np.argmin(dists, axis=1)
        new_centers = np.zeros_like(centers)
        counts = np.zeros(n_clusters)
        for i, a in enumerate(assignments):
            new_centers[a] += arr[i]
            counts[a] += 1
        for c in range(n_clusters):
            if counts[c] > 0:
                new_centers[c] /= counts[c]
            else:
                new_centers[c] = arr[np.random.randint(len(arr))]
        if np.allclose(centers, new_centers, atol=1.0):
            break
        centers = new_centers

    # Sort by frequency (most common first)
    counts_final = np.zeros(n_clusters)
    dists = np.sum((arr[:, None, :] - centers[None, :, :]) ** 2, axis=2)
    assignments = np.argmin(dists, axis=1)
    for a in assignments:
        counts_final[a] += 1
    order = np.argsort(-counts_final)
    sorted_centers = centers[order].astype(int).tolist()

    labels = "${labels}"
    palette = []
    for i, (r, g, b) in enumerate(sorted_centers):
        # Generate a descriptive color name from RGB
        total = r + g + b
        if total < 80:
            name = 'very_dark'
        elif total > 650:
            name = 'very_light'
        elif r > g and r > b:
            name = f'red_{i}' if r < 200 else f'bright_red_{i}'
        elif g > r and g > b:
            name = f'green_{i}' if g < 200 else f'bright_green_{i}'
        elif b > r and b > g:
            name = f'blue_{i}' if b < 200 else f'bright_blue_{i}'
        elif abs(r - g) < 30 and abs(g - b) < 30:
            name = f'gray_{i}'
        else:
            name = f'mixed_{i}'
        palette.append([labels[i], name, int(r), int(g), int(b)])

    print(json.dumps({"palette": palette, "iterations": iteration + 1}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code, 30000);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return `Parse error: ${raw}`; }
  if (parsed.error) return `Tune error: ${parsed.error}`;

  const palette: PaletteEntry[] = parsed.palette;
  const summary = palette.map(([l, name, r, g, b]) => `${l}=${name}(${r},${g},${b})`).join('\n  ');

  let saveMsg = '';
  if (saveName) {
    ensurePaletteDir();
    const safe = saveName.replace(/[^a-zA-Z0-9_-]/g, '');
    fs.writeFileSync(path.join(PALETTE_DIR, `${safe}.json`), JSON.stringify(palette, null, 2));
    saveMsg = `\nSaved as palette "${safe}". Use screen_to_grid(paletteName="${safe}") to apply it.`;
  }

  return `Tuned ${n}-color palette (k-means, ${parsed.iterations} iterations):\n  ${summary}${saveMsg}\n\nTo save: tune_palette(imagePath, ${n}, "game-name")`;
}

/**
 * Save a custom palette the model has defined.
 * palette is an array of [label, name, R, G, B] entries.
 * The model can craft these by hand to label specific game elements.
 *
 * Example: save_palette_config("agar-io", [["P","player",50,200,50],["F","food",255,255,0], ...])
 */
export function savePaletteConfig(name: string, palette: PaletteEntry[]): string {
  try {
    ensurePaletteDir();
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) return 'Error: invalid palette name.';
    if (!Array.isArray(palette) || palette.length < 2) return 'Error: palette must be an array of at least 2 entries.';
    fs.writeFileSync(path.join(PALETTE_DIR, `${safe}.json`), JSON.stringify(palette, null, 2));
    const key = palette.map(([l, n]) => `${l}=${n}`).join(' ');
    return `Saved palette "${safe}" (${palette.length} colors): ${key}`;
  } catch (e: any) {
    return `Save error: ${e.message}`;
  }
}

/**
 * Load and display a saved palette config.
 */
export function loadPaletteConfig(name: string): string {
  const palette = loadPalette(name);
  if (palette === DEFAULT_PALETTE) return `Palette "${name}" not found. Using default.`;
  const key = palette.map(([l, n, r, g, b]) => `${l}=${n}(${r},${g},${b})`).join('\n  ');
  return `Palette "${name}" (${palette.length} colors):\n  ${key}`;
}

/**
 * ONE CALL = screenshot + pixel math + change detection.
 *
 * Takes a fresh screenshot, converts every pixel to a palette index (the math),
 * computes how much the screen changed since the last call, and returns the full
 * numeric state. This is the primary vision integration tool — use it instead of
 * calling screenshot() + screen_to_grid() separately when you want change awareness.
 *
 * Returns a VisionFrame JSON with:
 *   changed    — true if delta > threshold
 *   delta      — normalized L2 distance from last frame [0–1]. 0 = identical.
 *   deltaPct   — % of cells that changed color
 *   hotspot    — {topRow,bottomRow,leftCol,rightCol,changedCells} bounding box of change
 *   vector     — flat int array (palette indices). Store with memory_store().
 *   grid       — human-readable color grid string
 *   imagePath  — path to the captured PNG
 *
 * @param cols        Grid columns (default 64)
 * @param rows        Grid rows (default 36)
 * @param paletteName Saved palette name to use (default palette if omitted)
 * @param threshold   delta value above which changed=true (default 0.02 = 2%)
 */
export async function visionTick(
  cols = 64,
  rows = 36,
  paletteName?: string,
  threshold = 0.02,
): Promise<string> {
  // 1. Capture fresh screenshot
  const { takeScreenshot } = await import('./computer');
  const imgPath = path.join(os.tmpdir(), `vtick_${Date.now()}.png`);
  const captureResult = await takeScreenshot(imgPath);
  if (captureResult.startsWith('Error')) return JSON.stringify({ error: captureResult });

  // 2. Convert to color vector (the math)
  const palette = loadPalette(paletteName);
  const raw = runPy(buildGridScript(imgPath, cols, rows, palette));
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return JSON.stringify({ error: `Parse error: ${raw}` }); }
  if (parsed.error) return JSON.stringify({ error: parsed.error });

  const vector: number[] = parsed.vector;
  const grid: string[] = parsed.grid;

  // 3. Compute delta vs last frame
  const prev = _lastVector;
  const sameDim = prev && _lastCols === cols && _lastRows === rows;
  const delta     = sameDim ? l2Delta(prev!, vector)        : 1;
  const deltaPct  = sameDim ? cellDeltaPct(prev!, vector)   : 100;
  const hotspot   = sameDim ? findHotspots(prev!, vector, cols, rows) : { topRow: 0, bottomRow: rows - 1, leftCol: 0, rightCol: cols - 1, changedCells: cols * rows };
  const changed   = delta > threshold;

  // 4. Update stored state
  _lastVector = vector;
  _lastCols = cols;
  _lastRows = rows;

  // 5. Format grid
  const paletteKey = palette.map(([l, n]) => `${l}=${n}`).join(' ');
  const colHeader  = Array.from({ length: cols }, (_, i) => i.toString(16).toUpperCase()).join('');
  const gridText   = [`${cols}×${rows} palette:${paletteName ?? 'default'}  ${paletteKey}`, `     ${colHeader}`, ...grid.map((r, i) => `${String(i).padStart(2, '0')}|${r}`)].join('\n');

  const frame: VisionFrame = { changed, delta: +delta.toFixed(4), deltaPct: +deltaPct.toFixed(2), hotspot, vector, grid: gridText, imagePath: imgPath, paletteKey, cols, rows };
  return JSON.stringify(frame);
}

/**
 * Block until the screen changes meaningfully, then return the VisionFrame.
 *
 * Polls at `fps` per second. Each poll: takes a screenshot, computes pixel math,
 * checks delta. Returns as soon as delta > threshold OR timeout is reached.
 *
 * @param threshold   Minimum delta to trigger (default 0.02)
 * @param timeoutMs   Max wait in ms (default 5000)
 * @param fps         Polls per second (default 10)
 * @param cols        Grid columns (default 64)
 * @param rows        Grid rows (default 36)
 * @param paletteName Saved palette name
 */
export async function visionWatch(
  threshold = 0.02,
  timeoutMs = 5000,
  fps = 10,
  cols = 64,
  rows = 36,
  paletteName?: string,
): Promise<string> {
  const interval = Math.max(50, Math.floor(1000 / fps));
  const deadline = Date.now() + timeoutMs;
  let ticks = 0;

  // Prime the last-vector baseline with a silent first tick
  if (!_lastVector) {
    await visionTick(cols, rows, paletteName, 999); // threshold=999 so it never triggers
  }

  while (Date.now() < deadline) {
    ticks++;
    const result = await visionTick(cols, rows, paletteName, threshold);
    try {
      const frame = JSON.parse(result) as VisionFrame & { error?: string };
      if (frame.error) return result;
      if (frame.changed) {
        return JSON.stringify({ ...frame, elapsed: timeoutMs - (deadline - Date.now()), ticks });
      }
    } catch { return result; }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(r => setTimeout(r, Math.min(interval, remaining)));
  }

  return JSON.stringify({ changed: false, delta: 0, deltaPct: 0, timeout: true, elapsed: timeoutMs, ticks, note: 'No change detected within timeout.' });
}

/**
 * Reset the stored baseline frame so the next visionTick treats the current
 * screen as "new" (delta will be 1 / 100%). Call this when entering a new
 * game screen or scene.
 */
export function visionReset(): string {
  _lastVector = null;
  _lastCols = 0;
  _lastRows = 0;
  return 'Vision baseline cleared. Next vision_tick will treat the screen as a new frame.';
}

/**
 * List all saved palette configs.
 */
export function listPaletteConfigs(): string {
  ensurePaletteDir();
  const files = fs.readdirSync(PALETTE_DIR).filter(f => f.endsWith('.json'));
  if (!files.length) return 'No palette configs saved yet. Use tune_palette() to create one.';
  return `Saved palettes: ${files.map(f => f.replace('.json', '')).join(', ')}\nUse load_palette_config(name) to inspect or screen_to_grid(paletteName=name) to apply.`;
}

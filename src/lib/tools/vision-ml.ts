// src/lib/tools/vision-ml.ts
// ML-enhanced vision pipeline. Extends pixel-vision.ts with learned calibration,
// scene classification, optical flow, and anomaly detection.
// Uses run_python pattern (runs Python via execSync with .agent_venv).

import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ── Paths ─────────────────────────────────────────────────────────────────────

import { PATHS, PALETTES_DIR as PALETTE_DIR, WEIGHTS_DIR } from '../paths';
const BASELINE_PATH = PATHS.visionBaseline;

// ── Helpers (mirrors pixel-vision.ts — intentionally copied, not imported) ────

function venvPython(): string {
  const venv = path.join(process.cwd(), '.agent_venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function runPy(code: string, timeout = 25000): string {
  const tmp = path.join(
    os.tmpdir(),
    `vml_${Date.now()}_${Math.random().toString(36).slice(2)}.py`,
  );
  fs.writeFileSync(tmp, code, 'utf8');
  try {
    return execSync(`"${venvPython()}" "${tmp}"`, { timeout }).toString().trim();
  } catch (e: any) {
    return `Error: ${e.stderr?.toString().trim() || e.message}`;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function ensureScreenshot(imagePath?: string): Promise<string | null> {
  if (imagePath) return imagePath;
  const tmp = path.join(os.tmpdir(), `vml_cap_${Date.now()}.png`);
  const { takeScreenshot } = await import('./computer');
  const result = await takeScreenshot(tmp);
  return result.startsWith('Error') ? null : tmp;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PaletteEntry = [string, string, number, number, number];

interface VisionBaseline {
  vectors: number[][];
  updatedAt: string;
}

// ── 1. calibrateVisionOnline ──────────────────────────────────────────────────

/**
 * Online calibration: extract dominant colors from an image and blend them into
 * the stored palette with a small learning rate (lr=0.05). This lets the palette
 * gradually adapt to real image content without discarding prior knowledge.
 *
 * @param imagePath   Path to image to analyze.
 * @param paletteName Name of the palette config to update.
 * @returns JSON: { updated: true, palette: PaletteEntry[], drift: number }
 */
export async function calibrateVisionOnline(
  imagePath: string,
  paletteName: string,
): Promise<string> {
  const safe = paletteName.replace(/[^a-zA-Z0-9_-]/g, '');
  const palettePath = path.join(PALETTE_DIR, `${safe}.json`);

  let palette: PaletteEntry[];
  try {
    palette = fs.existsSync(palettePath)
      ? (JSON.parse(fs.readFileSync(palettePath, 'utf8')) as PaletteEntry[])
      : [];
  } catch {
    palette = [];
  }

  if (!palette.length) {
    return JSON.stringify({ error: `Palette "${paletteName}" not found. Create it first with tune_palette().` });
  }

  const palettePy = JSON.stringify(palette);
  const imgEsc    = imagePath.replace(/\\/g, '\\\\');

  const code = `
import json, sys
try:
    from PIL import Image
    import numpy as np

    palette = ${palettePy}
    lr = 0.05

    img = Image.open(r"${imgEsc}").convert('RGB')
    img = img.resize((160, 90), Image.LANCZOS)
    arr = np.array(img, dtype='float32').reshape(-1, 3)

    pal_rgb = np.array([[e[2], e[3], e[4]] for e in palette], dtype='float32')
    n = len(pal_rgb)

    # Assign pixels to nearest palette center
    dists = np.sum((arr[:, None, :] - pal_rgb[None, :, :]) ** 2, axis=2)
    assign = np.argmin(dists, axis=1)

    # Compute per-cluster mean color from image
    new_rgb = np.zeros_like(pal_rgb)
    counts  = np.zeros(n)
    for i, a in enumerate(assign):
        new_rgb[a] += arr[i]
        counts[a] += 1

    drift_total = 0.0
    updated = []
    for ci in range(n):
        if counts[ci] > 0:
            cluster_mean = new_rgb[ci] / counts[ci]
            old = pal_rgb[ci]
            blended = old * (1.0 - lr) + cluster_mean * lr
            drift_total += float(np.linalg.norm(blended - old))
            updated.append([palette[ci][0], palette[ci][1], int(blended[0]), int(blended[1]), int(blended[2])])
        else:
            updated.append(palette[ci])

    avg_drift = drift_total / n
    print(json.dumps({"updated": True, "palette": updated, "drift": round(avg_drift, 4)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code, 30000);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return `Parse error: ${raw}`; }
  if (parsed.error) return JSON.stringify(parsed);

  // Save updated palette
  try {
    ensureDir(PALETTE_DIR);
    fs.writeFileSync(palettePath, JSON.stringify(parsed.palette, null, 2));
  } catch (e: any) {
    return JSON.stringify({ error: `Failed to save palette: ${e.message}` });
  }

  return JSON.stringify({ updated: true, palette: parsed.palette, drift: parsed.drift });
}

// ── 2. sceneHash ─────────────────────────────────────────────────────────────

/**
 * Compute a perceptual (DCT-based pHash) of the screen or a given image.
 * Uses an 8×8 grayscale DCT hash, producing a 64-bit hex string.
 *
 * @param imagePath Optional path; takes a screenshot if omitted.
 * @returns JSON: { hash: string, timestamp: string }
 */
export async function sceneHash(imagePath?: string): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return JSON.stringify({ error: 'Could not take screenshot.' });

  const imgEsc = imgPath.replace(/\\/g, '\\\\');
  const code = `
import json
try:
    from PIL import Image
    import numpy as np

    img = Image.open(r"${imgEsc}").convert('L')
    # Resize to 32x32 first, then crop 8x8 AC block after DCT
    img = img.resize((32, 32), Image.LANCZOS)
    arr = np.array(img, dtype='float32')

    # 2D DCT via row/col 1D DCT
    from scipy.fft import dct as _dct
    dct2 = _dct(_dct(arr, axis=0, norm='ortho'), axis=1, norm='ortho')
    low = dct2[:8, :8]

    # Compute median of AC components (exclude DC at [0,0])
    flat = low.flatten()
    ac   = np.concatenate([flat[1:]])
    med  = np.median(ac)

    bits = (flat > med).astype(int)
    # Convert 64-bit array to hex string
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    hash_hex = format(val, '016x')

    import datetime
    print(json.dumps({"hash": hash_hex, "timestamp": datetime.datetime.utcnow().isoformat() + "Z"}))
except ImportError:
    # Fallback without scipy: simple average hash
    from PIL import Image
    import numpy as np, datetime
    img = Image.open(r"${imgEsc}").convert('L').resize((8, 8), Image.LANCZOS)
    arr = np.array(img, dtype='float32')
    med = np.median(arr)
    bits = (arr.flatten() > med).astype(int)
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    print(json.dumps({"hash": format(val, '016x'), "timestamp": datetime.datetime.utcnow().isoformat() + "Z"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code);
  try {
    return raw.startsWith('{') ? raw : JSON.stringify({ error: raw });
  } catch {
    return JSON.stringify({ error: raw });
  }
}

// ── 3. detectSceneChange ──────────────────────────────────────────────────────

/**
 * Compute Hamming distance between two 64-bit pHash hex strings.
 *
 * @param hash1 First hex hash (from sceneHash).
 * @param hash2 Second hex hash.
 * @returns JSON: { distance: number, similar: boolean, changeType: 'major'|'minor'|'identical' }
 */
export function detectSceneChange(hash1: string, hash2: string): string {
  try {
    // Parse each 16-hex-char hash as two 32-bit words to avoid BigInt (ES2020+).
    if (hash1.length !== 16 || hash2.length !== 16) {
      return JSON.stringify({ error: 'Hashes must be 16 hex characters (64-bit).' });
    }
    function hammingWord(a: string, b: string): number {
      // XOR two 8-hex-char strings as 32-bit unsigned ints and count set bits.
      const xor = (parseInt(a, 16) >>> 0) ^ (parseInt(b, 16) >>> 0);
      // Brian Kernighan bit-count
      let n = xor >>> 0, count = 0;
      while (n !== 0) { n &= (n - 1); count++; }
      return count;
    }
    const dist = hammingWord(hash1.slice(0, 8), hash2.slice(0, 8))
               + hammingWord(hash1.slice(8, 16), hash2.slice(8, 16));
    const similar    = dist < 10;
    const changeType = dist === 0 ? 'identical' : dist < 10 ? 'minor' : 'major';
    return JSON.stringify({ distance: dist, similar, changeType });
  } catch (e: any) {
    return JSON.stringify({ error: `Hash parse error: ${e.message}` });
  }
}

// ── 4. estimateMotionField ────────────────────────────────────────────────────

/**
 * Estimate optical flow between two images by dividing the screen into an 8×8
 * grid of blocks and computing the mean displacement vector per block.
 *
 * @param imagePath1 Path to frame 1.
 * @param imagePath2 Path to frame 2.
 * @returns JSON: { field: [[dx,dy],...], dominant: {dx,dy,magnitude}, flowMagnitude: number }
 */
export async function estimateMotionField(
  imagePath1: string,
  imagePath2: string,
): Promise<string> {
  const e1 = imagePath1.replace(/\\/g, '\\\\');
  const e2 = imagePath2.replace(/\\/g, '\\\\');

  const code = `
import json
try:
    from PIL import Image
    import numpy as np

    GRID = 8  # 8x8 blocks

    def load_gray(p):
        img = Image.open(p).convert('L').resize((256, 144), Image.LANCZOS)
        return np.array(img, dtype='float32')

    f1 = load_gray(r"${e1}")
    f2 = load_gray(r"${e2}")
    H, W = f1.shape
    bh, bw = H // GRID, W // GRID

    field = []
    for gr in range(GRID):
        for gc in range(GRID):
            r0, r1 = gr * bh, (gr + 1) * bh
            c0, c1 = gc * bw, (gc + 1) * bw
            blk1 = f1[r0:r1, c0:c1]
            blk2 = f2[r0:r1, c0:c1]

            # Simple block-matching: try +-8 pixel search range
            best_dx, best_dy, best_sad = 0, 0, float('inf')
            SEARCH = 8
            for dy in range(-SEARCH, SEARCH + 1, 2):
                for dx in range(-SEARCH, SEARCH + 1, 2):
                    sr0 = max(0, r0 + dy); sr1 = min(H, r1 + dy)
                    sc0 = max(0, c0 + dx); sc1 = min(W, c1 + dx)
                    patch = f2[sr0:sr1, sc0:sc1]
                    ref   = blk1[:patch.shape[0], :patch.shape[1]]
                    if ref.size == 0:
                        continue
                    sad = np.sum(np.abs(ref - patch))
                    if sad < best_sad:
                        best_sad, best_dx, best_dy = sad, dx, dy
            field.append([best_dx, best_dy])

    field_np = np.array(field, dtype='float32')
    magnitudes = np.sqrt(field_np[:, 0] ** 2 + field_np[:, 1] ** 2)
    flow_mag   = float(np.mean(magnitudes))
    dom_idx    = int(np.argmax(magnitudes))
    dom = {"dx": float(field_np[dom_idx, 0]), "dy": float(field_np[dom_idx, 1]),
           "magnitude": float(magnitudes[dom_idx])}

    print(json.dumps({"field": field, "dominant": dom, "flowMagnitude": round(flow_mag, 3)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code, 40000);
  return raw.startsWith('{') ? raw : JSON.stringify({ error: raw });
}

// ── 5. trainSceneClassifier ───────────────────────────────────────────────────

/**
 * Train a RandomForestClassifier on labeled scene vectors (.npy files).
 * Saves the model to weights/scene-classifier.pkl.
 *
 * @param trainingData Array of { vectorPath: string, label: string }
 * @returns JSON: { accuracy: number, classes: string[], modelPath: string }
 */
export async function trainSceneClassifier(
  trainingData: Array<{ vectorPath: string; label: string }>,
): Promise<string> {
  if (!trainingData.length) {
    return JSON.stringify({ error: 'trainingData is empty.' });
  }

  ensureDir(WEIGHTS_DIR);
  const modelPath = path.join(WEIGHTS_DIR, 'scene-classifier.pkl').replace(/\\/g, '\\\\');
  const dataPy    = JSON.stringify(
    trainingData.map(d => ({ v: d.vectorPath.replace(/\\/g, '\\\\'), l: d.label })),
  );

  const code = `
import json, sys
try:
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import cross_val_score
    import pickle

    data = ${dataPy}

    X, y = [], []
    for item in data:
        vec = np.load(item['v'])
        X.append(vec.flatten())
        y.append(item['l'])

    X = np.array(X, dtype='float32')
    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)

    # Cross-val accuracy if enough samples
    if len(X) >= 5:
        scores = cross_val_score(clf, X, y, cv=min(5, len(X)), scoring='accuracy')
        accuracy = float(scores.mean())
    else:
        accuracy = 1.0  # trivial, not meaningful

    clf.fit(X, y)
    with open(r"${modelPath}", 'wb') as f:
        pickle.dump(clf, f)

    classes = sorted(set(y))
    print(json.dumps({"accuracy": round(accuracy, 4), "classes": classes, "modelPath": r"${modelPath}"}))
except ImportError as e:
    print(json.dumps({"error": f"Missing dependency: {e}. Install scikit-learn in .agent_venv."}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code, 120000);
  return raw.startsWith('{') ? raw : JSON.stringify({ error: raw });
}

// ── 6. classifyScene ─────────────────────────────────────────────────────────

/**
 * Classify the current screen scene using the trained RandomForest model.
 * Falls back to a "no model" label when weights/scene-classifier.pkl is absent.
 *
 * @param imagePath   Optional image path; takes a screenshot if omitted.
 * @param paletteName Palette to use for vectorization (default palette if omitted).
 * @returns JSON: { scene: string, confidence: number, fallback: boolean }
 */
export async function classifyScene(
  imagePath?: string,
  paletteName?: string,
): Promise<string> {
  const imgPath = await ensureScreenshot(imagePath);
  if (!imgPath) return JSON.stringify({ error: 'Could not take screenshot.' });

  // Vectorize the screen using the same grid logic as pixel-vision
  const { screenToColorVector } = await import('./pixel-vision');
  const vecJson = await screenToColorVector(imgPath, 32, 18, paletteName);
  let vecData: any;
  try { vecData = JSON.parse(vecJson); } catch { return `Parse error: ${vecJson}`; }
  if (vecData.error) return JSON.stringify(vecData);

  const vector: number[] = vecData.vector;
  const modelPath = path.join(WEIGHTS_DIR, 'scene-classifier.pkl');

  if (!fs.existsSync(modelPath)) {
    return JSON.stringify({ scene: 'unknown', confidence: 0, fallback: true });
  }

  const vecStr    = JSON.stringify(vector);
  const modelEsc  = modelPath.replace(/\\/g, '\\\\');

  const code = `
import json
try:
    import numpy as np, pickle

    vec = np.array(${vecStr}, dtype='float32').reshape(1, -1)
    with open(r"${modelEsc}", 'rb') as f:
        clf = pickle.load(f)

    proba   = clf.predict_proba(vec)[0]
    pred    = clf.classes_[int(proba.argmax())]
    conf    = float(proba.max())
    print(json.dumps({"scene": pred, "confidence": round(conf, 4), "fallback": False}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const raw = runPy(code);
  return raw.startsWith('{') ? raw : JSON.stringify({ error: raw });
}

// ── 7. computeAnomalyScore ────────────────────────────────────────────────────

/**
 * Compute a z-score-based anomaly score for a given vision vector against the
 * stored rolling baseline (last 100 vectors in vision-baseline.json).
 *
 * @param vector Flat numeric palette-index vector.
 * @returns JSON: { anomalyScore: number [0-1], isAnomaly: boolean, baseline_n: number }
 */
export async function computeAnomalyScore(vector: number[]): Promise<string> {
  let baseline: VisionBaseline = { vectors: [], updatedAt: new Date().toISOString() };
  try {
    if (fs.existsSync(BASELINE_PATH)) {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as VisionBaseline;
    }
  } catch { /* use empty baseline */ }

  const n = baseline.vectors.length;
  if (n < 5) {
    return JSON.stringify({ anomalyScore: 0, isAnomaly: false, baseline_n: n, note: 'Not enough baseline samples yet (need ≥5).' });
  }

  const vecStr  = JSON.stringify(vector);
  const basePy  = JSON.stringify(baseline.vectors);

  const code = `
import json
import numpy as np

vec      = np.array(${vecStr}, dtype='float32')
baseline = np.array(${basePy}, dtype='float32')

mean = baseline.mean(axis=0)
std  = baseline.std(axis=0) + 1e-6   # avoid div-by-zero

z_scores = np.abs((vec - mean) / std)
z_mean   = float(z_scores.mean())

# Sigmoid-like normalisation: score of 0 at z=0, approaches 1 for z>>3
score = float(1.0 - 1.0 / (1.0 + z_mean / 3.0))
score = round(min(max(score, 0.0), 1.0), 4)

print(json.dumps({"anomalyScore": score, "isAnomaly": score > 0.8, "baseline_n": ${n}}))
`;

  const raw = runPy(code);
  return raw.startsWith('{') ? raw : JSON.stringify({ error: raw });
}

// ── 8. updateVisionBaseline ───────────────────────────────────────────────────

/**
 * Append a vector to the rolling baseline (max 100 entries) and persist it.
 *
 * @param vector Flat numeric palette-index vector.
 * @returns 'updated'
 */
export function updateVisionBaseline(vector: number[]): string {
  let baseline: VisionBaseline = { vectors: [], updatedAt: new Date().toISOString() };
  try {
    if (fs.existsSync(BASELINE_PATH)) {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as VisionBaseline;
    }
  } catch { /* start fresh */ }

  baseline.vectors.push(vector);
  if (baseline.vectors.length > 100) {
    baseline.vectors = baseline.vectors.slice(-100);
  }
  baseline.updatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  } catch (e: any) {
    return `Error saving baseline: ${e.message}`;
  }
  return 'updated';
}

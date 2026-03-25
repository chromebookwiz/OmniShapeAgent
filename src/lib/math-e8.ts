// src/lib/math-e8.ts
// E8 Lattice and 8D Geometric Vectors Utilities

export class Vec8 {
  constructor(public v: number[]) {
    if (v.length !== 8) throw new Error("Vec8 requires exactly 8 dimensions");
  }

  add(other: Vec8): Vec8 {
    return new Vec8(this.v.map((val, i) => val + other.v[i]));
  }

  sub(other: Vec8): Vec8 {
    return new Vec8(this.v.map((val, i) => val - other.v[i]));
  }

  dot(other: Vec8): number {
    return this.v.reduce((sum, val, i) => sum + val * other.v[i], 0);
  }

  scale(scalar: number): Vec8 {
    return new Vec8(this.v.map(val => val * scalar));
  }

  magnitude(): number {
    return Math.sqrt(this.dot(this));
  }

  normalize(): Vec8 {
    const mag = this.magnitude();
    if (mag === 0) return this;
    return this.scale(1 / mag);
  }

  distance(other: Vec8): number {
    return this.sub(other).magnitude();
  }
}

// Generate the 240 root vectors of the E8 lattice
// The E8 roots consist of:
// 1. 112 vectors with coordinates +/-1 in exactly two positions, 0 elsewhere
// 2. 128 vectors with coordinates +/-0.5 in all 8 positions, with an even number of negative signs.
export function generateE8Roots(): Vec8[] {
  const roots: Vec8[] = [];

  // 1. Permutations of (+/-1, +/-1, 0, 0, 0, 0, 0, 0)
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 8; j++) {
      for (const signI of [1, -1]) {
        for (const signJ of [1, -1]) {
          const v = Array(8).fill(0);
          v[i] = signI;
          v[j] = signJ;
          roots.push(new Vec8(v));
        }
      }
    }
  }

  // 2. Permutations of (+/-0.5) with even number of '-' signs
  for (let i = 0; i < 256; i++) {
    const v = Array(8).fill(0);
    let negCount = 0;
    for (let j = 0; j < 8; j++) {
      if ((i & (1 << j)) !== 0) {
        v[j] = -0.5;
        negCount++;
      } else {
        v[j] = 0.5;
      }
    }
    if (negCount % 2 === 0) {
      roots.push(new Vec8(v));
    }
  }

  return roots;
}

// Find the nearest E8 root to a normalized 8D vector
export function nearestE8Root(v: Vec8): Vec8 {
  const roots = generateE8Roots();
  let nearest = roots[0];
  let maxDot = -Infinity; // equivalent to min distance for normalized vectors

  for (const root of roots) {
    const d = v.dot(root);
    if (d > maxDot) {
      maxDot = d;
      nearest = root;
    }
  }
  return nearest;
}

// Map a simple string to an interesting but deterministic vector in 8D space
export function hashStringToVec8(str: string): Vec8 {
  const v = Array(8).fill(0);
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    v[i % 8] += Math.sin((charCode * (i + 1))) * 10;
  }
  return new Vec8(v).normalize();
}

/**
 * Distinctive points ("features") in a camera frame, and descriptions of them that can be found again in the next
 * frame even if the phone turned, tilted a little, or came closer. The camera lock (featureTracker.ts) matches an
 * item's points to each new frame to see exactly how the item moved. Pure functions, unit tested.
 *
 * The method is ORB (Rublee et al., 2011), the standard fast choice on phones:
 *  1. Corners (FAST-9): a pixel with an arc of 9 of the 16 pixels around it all clearly brighter, or all clearly
 *     darker. Ranked by the Harris corner score, the best kept per region so they spread over the picture.
 *  2. Orientation: the direction from the point to the brightness centroid of the patch around it. Descriptions
 *     are taken in that direction, so turning the phone turns the patch and its direction together.
 *  3. Description (rotated BRIEF): 256 brightness comparisons between pairs of spots in the patch (each a 5 x 5
 *     average, so sensor noise doesn't flip them), packed into 256 bits. Two descriptions are compared by how many
 *     bits differ (Hamming distance).
 *  4. A pyramid of 3 sizes (each 1/√2 smaller): a point is found on the level where it looks the size it was,
 *     so the item can come about twice as close or go twice as far.
 */
import type { Rect } from './geometry';

/** Brightness of a frame for feature detection, at most `maxSide` pixels on the long side. */
export interface GrayImage {
  g: Uint8Array;
  w: number;
  h: number;
  /** Frame pixels per image pixel. */
  k: number;
}

export interface Keypoint {
  /** Position in the base level's pixels (GrayImage). */
  x: number;
  y: number;
  /** Pyramid level it was found on (0 = full size). */
  level: number;
  /** Orientation, radians. */
  angle: number;
  /** Harris corner score. */
  score: number;
  /** 256 bits. */
  d: Uint32Array;
}

/** Brightness (0..255) of an RGB frame, shrunk to at most `maxSide` on the long side. */
export function grayImage(rgb: ArrayLike<number>, width: number, height: number, maxSide = 480): GrayImage {
  const full = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < full.length; i++, p += 3) full[i] = (77 * rgb[p] + 150 * rgb[p + 1] + 29 * rgb[p + 2]) >> 8;
  const k = Math.max(1, Math.max(width, height) / maxSide);
  if (k === 1) return { g: full, w: width, h: height, k };
  const w = Math.max(1, Math.floor(width / k));
  const h = Math.max(1, Math.floor(height / k));
  return { g: resize(full, width, height, w, h), w, h, k: width / w };
}

/**
 * Resize by bilinear interpolation in integer arithmetic. Each step here shrinks by at most 2, where that is
 * smooth enough for corners. Index and weight tables per column are made once.
 */
function resize(src: Uint8Array, w: number, h: number, w2: number, h2: number): Uint8Array {
  const out = new Uint8Array(w2 * h2);
  const sx = w / w2;
  const sy = h / h2;
  const xi = new Int32Array(w2);
  const xt = new Uint16Array(w2);
  for (let x = 0; x < w2; x++) {
    const f = Math.min(w - 1.001, Math.max(0, (x + 0.5) * sx - 0.5));
    xi[x] = Math.floor(f);
    xt[x] = Math.round((f - xi[x]) * 256);
  }
  for (let y = 0; y < h2; y++) {
    const f = Math.min(h - 1.001, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(f);
    const ty = Math.round((f - y0) * 256);
    const r0 = y0 * w;
    const r1 = r0 + w;
    const o = y * w2;
    for (let x = 0; x < w2; x++) {
      const i = xi[x];
      const tx = xt[x];
      const top = src[r0 + i] * (256 - tx) + src[r0 + i + 1] * tx;
      const bottom = src[r1 + i] * (256 - tx) + src[r1 + i + 1] * tx;
      out[o + x] = (top * (256 - ty) + bottom * ty) >> 16;
    }
  }
  return out;
}

/** The 16 pixels on a circle of radius 3 (Bresenham), clockwise from the top. */
const CIRCLE: [number, number][] = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];

/** Patch radius for orientation and description. */
const R = 15;
/** Half-width of each comparison spot's box (5 x 5). */
const SPOT = 2;
/** Points this close to an edge (at their level) have no full patch. */
const BORDER = 22;

/** Seeded random numbers (mulberry32), so the comparison pattern is the same on every device and run. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** BRIEF's pairs: 256 x (x1, y1, x2, y2), Gaussian around the centre (σ = patch / 5), within ±13. */
const PAIRS = (() => {
  const rnd = random(0x0b1e5);
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()) * (31 / 5);
  };
  const out = new Float32Array(256 * 4);
  for (let i = 0; i < out.length; i++) {
    let v = gauss();
    while (Math.abs(v) > 13) v = gauss();
    out[i] = v;
  }
  return out;
})();

/** The pairs turned to each of 30 directions (12° apart), rounded to whole pixels: picked by a point's angle. */
const ANGLE_BINS = 30;
const ROTATED = Array.from({ length: ANGLE_BINS }, (_, b) => {
  const a = (b / ANGLE_BINS) * 2 * Math.PI;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out = new Int8Array(256 * 4);
  for (let i = 0; i < 256 * 2; i++) {
    const x = PAIRS[i * 2];
    const y = PAIRS[i * 2 + 1];
    out[i * 2] = Math.round(c * x - s * y);
    out[i * 2 + 1] = Math.round(s * x + c * y);
  }
  return out;
});

/** For the orientation's circular patch: half-width of each row. */
const UMAX = Array.from({ length: R + 1 }, (_, v) => Math.round(Math.sqrt(R * R - v * v)));

/** Summed-area table of a level, (w + 1) x (h + 1). */
function integral(g: Uint8Array, w: number, h: number): Uint32Array {
  const s = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
    }
  }
  return s;
}

interface Level {
  g: Uint8Array;
  w: number;
  h: number;
  /** Base pixels per pixel of this level. */
  scale: number;
  sum: Uint32Array;
}

/** Levels: full size, 1/√2, 1/2. */
const LEVEL_SCALES = [1, Math.SQRT2, 2];

function pyramid(img: GrayImage): Level[] {
  return LEVEL_SCALES.map((scale) => {
    const w = Math.max(1, Math.round(img.w / scale));
    const h = Math.max(1, Math.round(img.h / scale));
    const g = scale === 1 ? img.g : resize(img.g, img.w, img.h, w, h);
    return { g, w, h, scale, sum: integral(g, w, h) };
  });
}

/** FAST-9 with threshold `t`: 1 brighter arc, -1 darker arc, 0 not a corner. */
function fast(g: Uint8Array, w: number, x: number, y: number, t: number, offs: Int32Array): boolean {
  const i = y * w + x;
  const c = g[i];
  const hi = c + t;
  const lo = c - t;
  // An arc of 9 of 16 always includes pixel 0 or 8, and 4 or 12: a quick rejection for most pixels.
  const p0 = g[i + offs[0]];
  const p8 = g[i + offs[8]];
  const p4 = g[i + offs[4]];
  const p12 = g[i + offs[12]];
  const bright = (p0 > hi || p8 > hi) && (p4 > hi || p12 > hi);
  const dark = (p0 < lo || p8 < lo) && (p4 < lo || p12 < lo);
  if (!bright && !dark) return false;
  for (const sign of [1, -1]) {
    if ((sign === 1 && !bright) || (sign === -1 && !dark)) continue;
    let run = 0;
    for (let k = 0; k < 16 + 8; k++) {
      const p = g[i + offs[k % 16]];
      if (sign === 1 ? p > hi : p < lo) {
        if (++run >= 9) return true;
      } else run = 0;
    }
  }
  return false;
}

/** Harris corner response over a 7 x 7 window (central-difference gradients). */
function harris(g: Uint8Array, w: number, x: number, y: number): number {
  let a = 0;
  let b = 0;
  let c = 0;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const i = (y + dy) * w + x + dx;
      const ix = g[i + 1] - g[i - 1];
      const iy = g[i + w] - g[i - w];
      a += ix * ix;
      b += iy * iy;
      c += ix * iy;
    }
  return a * b - c * c - 0.04 * (a + b) * (a + b);
}

/** Direction to the brightness centroid of the circular patch. */
function orientation(l: Level, x: number, y: number): number {
  let m01 = 0;
  let m10 = 0;
  const { g, w } = l;
  for (let v = -R; v <= R; v++) {
    const u = UMAX[Math.abs(v)];
    const row = (y + v) * w + x;
    for (let du = -u; du <= u; du++) {
      const p = g[row + du];
      m10 += du * p;
      m01 += v * p;
    }
  }
  return Math.atan2(m01, m10);
}

/** 256 comparisons of 5 x 5 spot averages, along the point's orientation. */
function describe(l: Level, x: number, y: number, angle: number): Uint32Array {
  const bin = (((Math.round((angle / (2 * Math.PI)) * ANGLE_BINS) % ANGLE_BINS) + ANGLE_BINS) % ANGLE_BINS) | 0;
  const pat = ROTATED[bin];
  const W1 = l.w + 1;
  const s = l.sum;
  const spot = (u: number, v: number) => {
    const x0 = x + u - SPOT;
    const y0 = y + v - SPOT;
    const x1 = x0 + 2 * SPOT + 1;
    const y1 = y0 + 2 * SPOT + 1;
    return s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0];
  };
  const d = new Uint32Array(8);
  for (let i = 0; i < 256; i++) {
    if (spot(pat[i * 4], pat[i * 4 + 1]) < spot(pat[i * 4 + 2], pat[i * 4 + 3])) d[i >> 5] |= 1 << (i & 31);
  }
  return d;
}

export interface DetectOptions {
  /** How many points at most (over all levels). */
  max?: number;
  /** Only points inside this area (base pixels). */
  region?: Rect;
  /** FAST threshold (brightness levels). Lower finds more, fainter corners. */
  threshold?: number;
}

/**
 * The frame's distinctive points with their descriptions, best first, spread over the picture (or `region`).
 * When too few clear corners are found (a soft, low-contrast picture), the threshold is lowered once.
 */
export function detectFeatures(img: GrayImage, o: DetectOptions = {}): Keypoint[] {
  const max = o.max ?? 500;
  const first = detectAt(img, max, o.region, o.threshold ?? 20);
  return first.length >= max / 4 ? first : detectAt(img, max, o.region, (o.threshold ?? 20) / 2);
}

function detectAt(img: GrayImage, max: number, region: Rect | undefined, t: number): Keypoint[] {
  const levels = pyramid(img);
  // Points per level in proportion to its area.
  const areas = levels.map((l) => l.w * l.h);
  const total = areas.reduce((a, b) => a + b, 0);
  const out: Keypoint[] = [];
  levels.forEach((l, li) => {
    const want = Math.max(8, Math.round((max * areas[li]) / total));
    const { g, w, h, scale } = l;
    const offs = new Int32Array(CIRCLE.map(([dx, dy]) => dy * w + dx));
    const rx0 = region ? Math.max(BORDER, Math.floor(region.x / scale)) : BORDER;
    const ry0 = region ? Math.max(BORDER, Math.floor(region.y / scale)) : BORDER;
    const rx1 = region ? Math.min(w - BORDER, Math.ceil((region.x + region.width) / scale)) : w - BORDER;
    const ry1 = region ? Math.min(h - BORDER, Math.ceil((region.y + region.height) / scale)) : h - BORDER;
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const score = new Float32Array(w * h);
    const cand: number[] = [];
    for (let y = ry0; y < ry1; y++)
      for (let x = rx0; x < rx1; x++)
        if (fast(g, w, x, y, t, offs)) {
          const r = harris(g, w, x, y);
          if (r > 0) {
            score[y * w + x] = r;
            cand.push(y * w + x);
          }
        }
    // Keep local maxima only (3 x 3), then the best per cell of a grid so points spread over the picture.
    const cells = 8;
    const cw = (rx1 - rx0) / cells;
    const ch = (ry1 - ry0) / cells;
    const byCell: number[][] = Array.from({ length: cells * cells }, () => []);
    for (const i of cand) {
      const s = score[i];
      if (
        s < score[i - 1] || s < score[i + 1] || s < score[i - w] || s < score[i + w] ||
        s < score[i - w - 1] || s < score[i - w + 1] || s < score[i + w - 1] || s < score[i + w + 1]
      )
        continue;
      const x = i % w;
      const y = (i / w) | 0;
      const cx = Math.min(cells - 1, Math.floor((x - rx0) / cw));
      const cy = Math.min(cells - 1, Math.floor((y - ry0) / ch));
      byCell[cy * cells + cx].push(i);
    }
    const perCell = Math.max(1, Math.ceil(want / (cells * cells)));
    let kept: number[] = [];
    for (const list of byCell) kept.push(...list.sort((a, b) => score[b] - score[a]).slice(0, perCell));
    kept = kept.sort((a, b) => score[b] - score[a]).slice(0, want);
    for (const i of kept) {
      const x = i % w;
      const y = (i / w) | 0;
      const angle = orientation(l, x, y);
      out.push({ x: x * scale, y: y * scale, level: li, angle, score: score[i], d: describe(l, x, y, angle) });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

/** Number of differing bits. */
export function hamming(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    let x = a[i] ^ b[i];
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    n += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return n;
}

export interface Match {
  /** Index in the first list (the item's points) and the second (the frame's). */
  a: number;
  b: number;
  distance: number;
}

/**
 * Each of `a`'s points to its nearest in `b`, kept when clearly closer than the second nearest (Lowe's ratio
 * test: a point that matches two places equally well, like a gridline crossing seen on two graphs, says
 * nothing) and within `maxDistance` bits. Each point of `b` is used once (the closest claim wins).
 *
 * `near` (guided matching): where each of `a`'s points is expected in `b` and how far from there to look. Only
 * those candidates compete, so a repeated pattern elsewhere (the next graph's identical gridlines) doesn't make a
 * point ambiguous, and far fewer descriptions are compared.
 */
export function matchFeatures(
  a: Keypoint[],
  b: Keypoint[],
  ratio = 0.8,
  maxDistance = 64,
  near?: { at: (i: number) => { x: number; y: number }; radius: number },
): Match[] {
  const best = new Map<number, Match>();
  const r2 = near ? near.radius * near.radius : 0;
  for (let i = 0; i < a.length; i++) {
    let d1 = 257;
    let d2 = 257;
    let j1 = -1;
    const p = near?.at(i);
    for (let j = 0; j < b.length; j++) {
      if (p && (b[j].x - p.x) ** 2 + (b[j].y - p.y) ** 2 > r2) continue;
      const d = hamming(a[i].d, b[j].d);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        j1 = j;
      } else if (d < d2) d2 = d;
    }
    if (j1 < 0 || d1 > maxDistance || d1 >= ratio * d2) continue;
    const prev = best.get(j1);
    if (!prev || d1 < prev.distance) best.set(j1, { a: i, b: j1, distance: d1 });
  }
  return [...best.values()];
}

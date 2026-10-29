/**
 * Camera-like test pictures with a known answer: a subject drawn on paper (or a desk), then lit the way a phone
 * camera sees it (vignetting, a window, a lamp, a hand's shadow, dim warm light), softened and noisy. The true
 * subject mask is known exactly, so how well the pipeline finds it can be measured.
 */
import type { RasterImage } from '../../convert';

export const W = 640;
export const H = 480;

type C = [number, number, number];

/** Deterministic noise, roughly ±amp per channel (a camera's sensor noise after its own denoising). */
export function noise(seed: number) {
  let s = seed >>> 0;
  return (amp: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    const u1 = (s & 0xffff) / 0x10000;
    s = (s * 1664525 + 1013904223) >>> 0;
    const u2 = (s & 0xffff) / 0x10000;
    return (u1 + u2 - 1) * amp * 1.7;
  };
}

/** A subject: whether a point is on it, and its colour. */
export interface Subject {
  name: string;
  colour: C;
  inside: (x: number, y: number) => boolean;
}

const cx = W / 2;
const cy = H / 2;

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const polyEdges = (pts: [number, number][]) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const);
const insidePoly = (pts: [number, number][], x: number, y: number) => {
  let c = false;
  for (const [[ax, ay], [bx, by]] of polyEdges(pts)) if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
  return c;
};
const outline = (pts: [number, number][], width: number) => {
  const edges = polyEdges(pts);
  // Points well away from the outline's box are never on it (keeps drawing the scenes quick).
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - width, Math.max(...xs) + width, Math.min(...ys) - width, Math.max(...ys) + width];
  return (x: number, y: number) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1 && edges.some(([[ax, ay], [bx, by]]) => segDist(x, y, ax, ay, bx, by) <= width / 2);
};
const star = (r1: number, r2: number): [number, number][] =>
  Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? r2 : r1;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
const triangle: [number, number][] = [
  [cx, cy - 120],
  [cx + 130, cy + 95],
  [cx - 130, cy + 95],
];

export const SUBJECTS: Subject[] = [
  { name: 'red disc', colour: [200, 45, 40], inside: (x, y) => Math.hypot(x - cx, y - cy) <= 105 },
  { name: 'blue triangle', colour: [45, 85, 185], inside: (x, y) => insidePoly(triangle, x, y) },
  { name: 'black star outline', colour: [32, 32, 36], inside: outline(star(130, 55), 7) },
  { name: 'pencil square', colour: [125, 125, 130], inside: outline([[cx - 110, cy - 110], [cx + 110, cy - 110], [cx + 110, cy + 110], [cx - 110, cy + 110]], 4) },
  { name: 'yellow note', colour: [238, 212, 95], inside: (x, y) => Math.abs(x - cx) <= 100 && Math.abs(y - cy) <= 100 },
  {
    name: 'marker wave',
    colour: [28, 28, 30],
    inside: (x, y) => x > cx - 200 && x < cx + 200 && Math.abs(y - (cy + 80 * Math.sin(((x - cx) / 200) * Math.PI))) <= 5,
  },
];

/** Light falling on the scene: a brightness factor per point, and a colour tint. */
export interface Lighting {
  name: string;
  light: (x: number, y: number) => number;
  tint?: C;
  noise?: number;
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const rMax = Math.hypot(cx, cy);

export const LIGHTS: Lighting[] = [
  { name: 'even', light: () => 1 },
  { name: 'vignette', light: (x, y) => 1 - 0.45 * (Math.hypot(x - cx, y - cy) / rMax) ** 2 },
  // A window on the left: bright there, falling off fast, then slowly (not a straight-line gradient).
  { name: 'window', light: (x) => 0.42 + 0.58 * Math.exp(-x / 260) },
  // A desk lamp: a bright pool off to one side.
  { name: 'lamp', light: (x, y) => 0.62 + 0.5 * Math.exp(-((x - 200) ** 2 + (y - 150) ** 2) / (2 * 170 ** 2)) },
  // The phone's or a hand's soft shadow over the lower right, across part of the subject.
  { name: 'hand shadow', light: (x, y) => 1 - 0.42 * smooth(-40, 40, Math.hypot((x - 560) / 1.3, y - 470) * -1 + 260) },
  { name: 'dim warm', light: () => 0.55, tint: [1, 0.86, 0.66], noise: 6 },
  {
    name: 'everything',
    light: (x, y) => (1 - 0.35 * (Math.hypot(x - cx, y - cy) / rMax) ** 2) * (0.5 + 0.5 * Math.exp(-x / 400)),
    tint: [1, 0.93, 0.82],
    noise: 5,
  },
];

const PAPER: C = [244, 242, 236];

/** The scene: subject on paper under the light, softened (lens) and noisy. Returns the picture and the true mask. */
export function cameraScene(subject: Subject, lighting: Lighting, seed = 7): { raster: RasterImage; truth: Uint8Array } {
  const n = noise(seed);
  const amp = lighting.noise ?? 3;
  const tint = lighting.tint ?? [1, 1, 1];
  const truth = new Uint8Array(W * H);
  const lin = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // 2 x 2 supersampling for anti-aliased edges.
      let cov = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (subject.inside(x + ox, y + oy)) cov++;
      cov /= 4;
      const i = y * W + x;
      truth[i] = subject.inside(x + 0.5, y + 0.5) ? 1 : 0;
      const L = lighting.light(x + 0.5, y + 0.5);
      for (let c = 0; c < 3; c++) lin[i * 3 + c] = (PAPER[c] * (1 - cov) + subject.colour[c] * cov) * L * tint[c];
    }
  // Lens softness: one 3 x 3 box blur.
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            s += lin[(yy * W + xx) * 3 + c];
            k++;
          }
        data[o + c] = s / k + n(amp);
      }
      data[o + 3] = 255;
    }
  return { raster: { width: W, height: H, data, channels: 4 }, truth };
}

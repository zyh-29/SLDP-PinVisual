/**
 * A virtual desk for the camera-lock tests: two graphs side by side (look-alikes on purpose) and a shape card on
 * a wooden desk, and a phone camera that pans, zooms, turns and tilts over it, with sensor noise.
 */
import type { Point, Rect } from '../../geometry';

export type C = [number, number, number];
export const W = 640;
export const H = 360;

/** The desk, in world units (1 unit = 1 frame pixel at zoom 1). */
export const PLOT_A: Rect = { x: 120, y: 120, width: 220, height: 200 };
export const PLOT_B: Rect = { x: 400, y: 120, width: 220, height: 200 };
export const CARD: Rect = { x: 680, y: 160, width: 110, height: 110 };

/** The two graphs: where each is, and its curve. Built once: world() runs for every pixel of every frame. */
const PLOTS = [
  [PLOT_A, (u: number) => 70 + 0.008 * (u - 110) ** 2], // parabola
  [PLOT_B, (u: number) => 170 - 0.8 * (u - 40)], // line
] as const;

export function world(x: number, y: number): C {
  const inR = (r: Rect) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  for (let i = 0; i < PLOTS.length; i++) {
    const r = PLOTS[i][0];
    const curve = PLOTS[i][1];
    if (!inR(r)) continue;
    const u = x - r.x;
    const v = y - r.y;
    if (Math.abs(v - curve(u)) < 2.2) return r === PLOT_A ? [200, 60, 55] : [40, 105, 185];
    if (Math.abs(u - r.width / 2) < 1.2 || Math.abs(v - r.height / 2) < 1.2) return [90, 90, 90];
    if (u % 20 < 1 || v % 20 < 1) return [205, 205, 205];
    return [250, 249, 245];
  }
  if (inR(CARD)) {
    const u = x - CARD.x;
    const v = y - CARD.y;
    return v > 15 && v < 95 && Math.abs(u - 55) < ((v - 15) / 80) * 45 ? [240, 140, 30] : [235, 230, 220];
  }
  return [150 + 12 * Math.sin(x / 9 + Math.sin(y / 40) * 3), 110, 75]; // wooden desk
}

export interface Camera {
  /** World point at the middle of the frame. */
  cx: number;
  cy: number;
  zoom: number;
  /** Turned, radians (clockwise on screen). */
  angle?: number;
  /** Tilt: perspective per frame pixel across (tx) and down (ty); 0.001 is looking about 30° from straight on. */
  tx?: number;
  ty?: number;
}

/** Frame pixel to world point for this camera. */
export function frameToWorld(cam: Camera, u: number, v: number): Point {
  return toWorld(cam)(u, v);
}

/** frameToWorld with the camera's turn worked out once (shoot() maps every pixel of a frame). */
function toWorld(cam: Camera) {
  const tx = cam.tx ?? 0;
  const ty = cam.ty ?? 0;
  const c = Math.cos(-(cam.angle ?? 0));
  const s = Math.sin(-(cam.angle ?? 0));
  return (u: number, v: number): Point => {
    const a = (u - W / 2) / (1 + tx * (u - W / 2) + ty * (v - H / 2));
    const b = (v - H / 2) / (1 + tx * (u - W / 2) + ty * (v - H / 2));
    return { x: cam.cx + (c * a - s * b) / cam.zoom, y: cam.cy + (s * a + c * b) / cam.zoom };
  };
}

/** World point to frame pixel (the inverse of frameToWorld). */
export function worldToFrame(cam: Camera, p: Point): Point {
  const c = Math.cos(cam.angle ?? 0);
  const s = Math.sin(cam.angle ?? 0);
  const dx = (p.x - cam.cx) * cam.zoom;
  const dy = (p.y - cam.cy) * cam.zoom;
  const a = c * dx - s * dy;
  const b = s * dx + c * dy;
  // a = A / (1 + tx A + ty B), b = B / (same)  =>  A = a d, B = b d with d = 1 / (1 - tx a - ty b).
  const d = 1 / (1 - (cam.tx ?? 0) * a - (cam.ty ?? 0) * b);
  return { x: a * d + W / 2, y: b * d + H / 2 };
}

/** A camera frame (RGB, 3 channels), with sensor noise. */
export function shoot(cam: Camera, seed: number) {
  let s = seed >>> 0;
  const n = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s & 0xffff) / 0x10000 - 0.5) * 16;
  };
  const rgb = new Uint8ClampedArray(W * H * 3);
  const map = toWorld(cam);
  for (let v = 0; v < H; v++)
    for (let u = 0; u < W; u++) {
      const w = map(u + 0.5, v + 0.5);
      const c = world(w.x, w.y);
      for (let k = 0; k < 3; k++) rgb[(v * W + u) * 3 + k] = c[k] + n();
    }
  /** A world rectangle's bounding box in this frame. */
  const toFrame = (r: Rect): Rect => {
    const q = [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ].map((p) => worldToFrame(cam, p));
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  return { rgb, toFrame, cam };
}

/**
 * Camera shake: how far the whole picture moved between two frames (a shaking hand turns the phone a little, and
 * everything in view jumps the same way). Pure, unit tested.
 *
 * The two frames' brightness patterns are matched at every offset, coarse to fine: first on a tiny copy (about
 * 60 px across) over a wide range, then on the tracker's small copy (about 240 px) around the best offset. The
 * score is the correlation of the overlapping parts (1 = identical), so a change of exposure doesn't matter.
 *
 * The camera lock uses it to tell a shaking camera from a different item: the item's box last frame, moved by the
 * shake, is where it should be now.
 */
import type { Rect } from './geometry';
import type { SmallGray } from './tracker';

export interface FrameShift {
  /** How far the picture moved, in frame pixels (right and down). */
  dx: number;
  dy: number;
  /** How well the frames matched at that offset, -1..1. */
  score: number;
}

/** Largest jump looked for, as a share of the frame's width and height. */
const REACH = 0.35;
/** Below this match the frames don't show the same scene (a new view, or too blurred): no estimate. */
const MIN_SCORE = 0.35;
/** The frames must still overlap this much at the offset (a jump of most of the frame can't be measured). */
const MIN_OVERLAP = 0.4;

interface Plane {
  v: Float32Array;
  w: number;
  h: number;
}

/** Brightness with its mean taken out and scaled to unit spread; null for a picture with no detail at all. */
function normalised(g: Float32Array, w: number, h: number): Plane | null {
  let mean = 0;
  for (let i = 0; i < g.length; i++) mean += g[i];
  mean /= g.length;
  let ss = 0;
  for (let i = 0; i < g.length; i++) ss += (g[i] - mean) ** 2;
  const sd = Math.sqrt(ss / g.length);
  if (sd < 2) return null;
  const v = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) v[i] = (g[i] - mean) / sd;
  return { v, w, h };
}

/** A copy `f` times smaller in each direction (block means). */
function shrink(g: Float32Array, w: number, h: number, f: number): { g: Float32Array; w: number; h: number } {
  const sw = Math.max(1, Math.floor(w / f));
  const sh = Math.max(1, Math.floor(h / f));
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh * f; y++)
    for (let x = 0; x < sw * f; x++) out[((y / f) | 0) * sw + ((x / f) | 0)] += g[y * w + x];
  const n = f * f;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return { g: out, w: sw, h: sh };
}

/**
 * Correlation of `a` and `b` where b is moved by (dx, dy): the mean product over the overlap, every `step`-th
 * pixel. -Infinity when they overlap too little.
 */
function matchAt(a: Plane, b: Plane, dx: number, dy: number, step: number): number {
  const x0 = Math.max(0, dx);
  const x1 = Math.min(a.w, b.w + dx);
  const y0 = Math.max(0, dy);
  const y1 = Math.min(a.h, b.h + dy);
  if ((x1 - x0) * (y1 - y0) < MIN_OVERLAP * a.w * a.h) return -Infinity;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += step) {
    const ra = y * a.w;
    const rb = (y - dy) * b.w - dx;
    for (let x = x0; x < x1; x += step) {
      sum += a.v[ra + x] * b.v[rb + x];
      n++;
    }
  }
  return n ? sum / n : -Infinity;
}

/**
 * How far the picture moved from `before` to `now` (two frames prepared by smallGray), or null when it can't be
 * told (different scenes, a featureless view, a jump too big to measure, or frames of different sizes).
 */
export function frameShift(before: SmallGray, now: SmallGray): FrameShift | null {
  if (before.w !== now.w || before.h !== now.h || before.k !== now.k) return null;
  const { w, h, k } = now;
  // Coarse: on a copy about 60 px across, over the whole reach.
  const f = Math.max(1, Math.round(Math.max(w, h) / 60));
  const ta = shrink(now.g, w, h, f);
  const tb = shrink(before.g, w, h, f);
  const ca = normalised(ta.g, ta.w, ta.h);
  const cb = normalised(tb.g, tb.w, tb.h);
  if (!ca || !cb) return null;
  const rx = Math.round(REACH * ca.w);
  const ry = Math.round(REACH * ca.h);
  let best = { dx: 0, dy: 0, score: -Infinity };
  for (let dy = -ry; dy <= ry; dy++)
    for (let dx = -rx; dx <= rx; dx++) {
      const s = matchAt(ca, cb, dx, dy, 1);
      if (s > best.score) best = { dx, dy, score: s };
    }
  if (best.score < MIN_SCORE) return null;
  // Fine: on the small copy, around the coarse offset.
  const a = normalised(now.g, w, h);
  const b = normalised(before.g, w, h);
  if (!a || !b) return null;
  const cx = best.dx * f;
  const cy = best.dy * f;
  let fine = { dx: cx, dy: cy, score: -Infinity };
  for (let dy = cy - f; dy <= cy + f; dy++)
    for (let dx = cx - f; dx <= cx + f; dx++) {
      const s = matchAt(a, b, dx, dy, 2);
      if (s > fine.score) fine = { dx, dy, score: s };
    }
  if (fine.score < MIN_SCORE) return null;
  return { dx: fine.dx * k, dy: fine.dy * k, score: fine.score };
}

/** `r` moved by the shift (where something seen at `r` in the earlier frame is now). */
export function shifted(r: Rect, s: FrameShift | null): Rect {
  return s ? { ...r, x: r.x + s.dx, y: r.y + s.dy } : r;
}

/**
 * Live camera: stays locked onto one item (a graph, a shape, an object) while the phone moves, closer, further,
 * sideways, until the user taps another. Pure, unit tested.
 *
 * How: when an item is locked, a small picture of it (its "template", 24 px wide, brightness only, normalised so
 * lighting changes don't matter) is kept. On every new frame the tracker looks for that picture around where the
 * item was (plus how it was moving), at a few sizes (the phone came closer or went back), and takes the place
 * that matches best: normalised cross-correlation, the standard template-matching score (1 = identical). The
 * smart crop is then pointed at that place, so it picks the same item, and its exact box refines the tracker
 * and slowly refreshes the template (the item looks a little different from a new angle).
 */
import type { Point, Rect } from './geometry';

/** Brightness of a frame, shrunk so a search takes a few milliseconds. */
export interface SmallGray {
  g: Float32Array;
  w: number;
  h: number;
  /** Frame pixels per small pixel. */
  k: number;
  /** Summed-area table, (w + 1) x (h + 1): the mean of any rectangle in four lookups. */
  sum: Float64Array;
}

/** Brightness averaged into k x k blocks (about 240 px on the long side). */
export function smallGray(rgb: ArrayLike<number>, width: number, height: number): SmallGray {
  const k = Math.max(1, Math.round(Math.max(width, height) / 240));
  const w = Math.max(1, Math.floor(width / k));
  const h = Math.max(1, Math.floor(height / k));
  const g = new Float32Array(w * h);
  for (let y = 0; y < h * k; y++)
    for (let x = 0; x < w * k; x++) {
      const p = (y * width + x) * 3;
      g[Math.floor(y / k) * w + Math.floor(x / k)] += 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
    }
  for (let i = 0; i < g.length; i++) g[i] /= k * k;
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  return { g, w, h, k, sum };
}

const TW = 24;
/** The template also takes in this much around the item (each side): its edge against the background. */
const MARGIN = 0.15;

/** Mean brightness of a rectangle (small-frame pixels), clamped to the frame. */
function areaMean(f: SmallGray, x0: number, y0: number, x1: number, y1: number): number {
  const a = Math.min(f.w - 1, Math.max(0, Math.floor(x0)));
  const b = Math.min(f.h - 1, Math.max(0, Math.floor(y0)));
  const c = Math.min(f.w, Math.max(a + 1, Math.ceil(x1)));
  const d = Math.min(f.h, Math.max(b + 1, Math.ceil(y1)));
  const W1 = f.w + 1;
  return (f.sum[d * W1 + c] - f.sum[b * W1 + c] - f.sum[d * W1 + a] + f.sum[b * W1 + a]) / ((c - a) * (d - b));
}

/**
 * The item's picture on a tw x th grid: each cell is the average of the area it covers (so thin lines count,
 * whatever the size), over the box plus a margin around it.
 */
function sample(f: SmallGray, box: Rect, tw: number, th: number, out: Float32Array) {
  const mx = box.width * MARGIN;
  const my = box.height * MARGIN;
  const x0 = box.x - mx;
  const y0 = box.y - my;
  const cw = (box.width + 2 * mx) / tw;
  const ch = (box.height + 2 * my) / th;
  for (let j = 0; j < th; j++)
    for (let i = 0; i < tw; i++) out[j * tw + i] = areaMean(f, x0 + i * cw, y0 + j * ch, x0 + (i + 1) * cw, y0 + (j + 1) * ch);
}

/** Zero mean, unit length: comparing these is the normalised cross-correlation. Null for a flat patch. */
function normalise(v: Float32Array, minContrast = 2): Float32Array | null {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  let ss = 0;
  for (let i = 0; i < v.length; i++) ss += (v[i] - mean) ** 2;
  if (ss < v.length * minContrast ** 2) return null; // too little contrast (in brightness levels): nothing to recognise
  const s = 1 / Math.sqrt(ss);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - mean) * s;
  return out;
}

const iou = (a: Rect, b: Rect) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const i = w * h;
  return i / (a.width * a.height + b.width * b.height - i);
};

export interface TrackResult {
  /** Where the item is now (frame pixels). */
  box: Rect;
  /** Its outline, turned and tilted as seen (frame pixels), when followed by its points (itemTracker.ts). */
  quad?: [Point, Point, Point, Point];
  /**
   * The item's own width and height now (frame pixels): not its bounding box, which grows when it is turned. How
   * close the camera is, measured the same way by both trackers.
   */
  size: { width: number; height: number };
  /** The point to give the smart crop: the same spot of the item the user tapped (or its middle). */
  point: Point;
  /** How well it matched, 0..1. */
  score: number;
}

/** Below this score the item is not in view (covered, out of frame): the last place is kept. */
const LOST = 0.45;
/** Frames in a row without a match before the lock is released. */
const GIVE_UP = 12;
/** Sizes tried each frame, relative to the last: closer and further. */
const SCALES = [0.8, 0.9, 1, 1.12, 1.25];

export class TargetTracker {
  private template: Float32Array | null = null;
  private th = 0;
  /** In small-frame pixels. */
  private box: Rect | null = null;
  private velocity = { x: 0, y: 0 };
  /** Where in the box the user tapped (0..1), so the same spot is pointed at as the item moves. */
  private rel = { x: 0.5, y: 0.5 };
  private k = 1;
  private missed = 0;

  get locked() {
    return this.template !== null;
  }

  /** Frames in a row the item couldn't be found. */
  get missing() {
    return this.missed;
  }

  /** Locks onto the item in `box` (frame pixels); `at` is the tapped point inside it, if any. */
  lock(f: SmallGray, box: Rect, at?: Point): boolean {
    const b = { x: box.x / f.k, y: box.y / f.k, width: Math.max(2, box.width / f.k), height: Math.max(2, box.height / f.k) };
    const th = Math.max(8, Math.min(48, Math.round((TW * b.height) / b.width)));
    const raw = new Float32Array(TW * th);
    sample(f, b, TW, th, raw);
    const t = normalise(raw);
    if (!t) return false;
    this.template = t;
    this.th = th;
    this.box = b;
    this.k = f.k;
    this.velocity = { x: 0, y: 0 };
    this.missed = 0;
    this.rel = at
      ? { x: Math.min(1, Math.max(0, (at.x - box.x) / box.width)), y: Math.min(1, Math.max(0, (at.y - box.y) / box.height)) }
      : { x: 0.5, y: 0.5 };
    return true;
  }

  unlock() {
    this.template = null;
    this.box = null;
    this.missed = 0;
  }

  /** The point to aim at for the current box. */
  private pointOf(b: Rect): Point {
    return { x: (b.x + this.rel.x * b.width) * this.k, y: (b.y + this.rel.y * b.height) * this.k };
  }

  /** Finds the item in a new frame. Null when not locked or after losing it for too long (the lock is then released). */
  track(f: SmallGray): TrackResult | null {
    if (!this.template || !this.box) return null;
    if (f.k !== this.k) {
      // The frame size changed (camera flipped or rotated): the old picture no longer applies.
      this.unlock();
      return null;
    }
    const t = this.template;
    const tw = TW;
    const th = this.th;
    const prev = this.box;
    const cx = prev.x + prev.width / 2 + this.velocity.x;
    const cy = prev.y + prev.height / 2 + this.velocity.y;
    const reach = 0.35 * Math.max(prev.width, prev.height) + 0.06 * Math.max(f.w, f.h);
    const patch = new Float32Array(tw * th);
    let best = { score: -2, box: prev };
    const tryBox = (b: Rect) => {
      sample(f, b, tw, th, patch);
      let mean = 0;
      for (let i = 0; i < patch.length; i++) mean += patch[i];
      mean /= patch.length;
      let dot = 0;
      let ss = 0;
      for (let i = 0; i < patch.length; i++) {
        const v = patch[i] - mean;
        dot += v * t[i];
        ss += v * v;
      }
      if (ss < patch.length * 4) return;
      const score = dot / Math.sqrt(ss);
      if (score > best.score) best = { score, box: b };
    };
    for (const s of SCALES) {
      const bw = prev.width * s;
      const bh = prev.height * s;
      const step = Math.max(1, Math.round(Math.min(bw, bh) / 10));
      for (let dy = -reach; dy <= reach; dy += step)
        for (let dx = -reach; dx <= reach; dx += step) tryBox({ x: cx + dx - bw / 2, y: cy + dy - bh / 2, width: bw, height: bh });
    }
    // Refine around the best: one pixel at a time, and sizes in between.
    const coarse = best.box;
    for (const s of [0.95, 1, 1.05])
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const bw = coarse.width * s;
          const bh = coarse.height * s;
          tryBox({ x: coarse.x + coarse.width / 2 + dx - bw / 2, y: coarse.y + coarse.height / 2 + dy - bh / 2, width: bw, height: bh });
        }
    if (best.score < LOST) {
      if (++this.missed >= GIVE_UP) {
        this.unlock();
        return null;
      }
      return { box: this.frameBox(prev), point: this.pointOf(prev), score: Math.max(0, best.score), size: this.sizeOf(prev) };
    }
    this.missed = 0;
    const nb = best.box;
    this.velocity = {
      x: 0.5 * this.velocity.x + 0.5 * (nb.x + nb.width / 2 - (prev.x + prev.width / 2)),
      y: 0.5 * this.velocity.y + 0.5 * (nb.y + nb.height / 2 - (prev.y + prev.height / 2)),
    };
    this.box = nb;
    return { box: this.frameBox(nb), point: this.pointOf(nb), score: best.score, size: this.sizeOf(nb) };
  }

  /**
   * Another tracker found the item (see itemTracker.ts): its middle and its own size now (frame pixels). The
   * template continues from there next frame, unchanged.
   */
  place(f: SmallGray, centre: Point, size: { width: number; height: number }) {
    if (!this.template || !this.box || f.k !== this.k) return;
    const cx = centre.x / f.k;
    const cy = centre.y / f.k;
    const w = Math.max(2, size.width / f.k);
    const h = Math.max(2, size.height / f.k);
    this.velocity = {
      x: 0.5 * this.velocity.x + 0.5 * (cx - (this.box.x + this.box.width / 2)),
      y: 0.5 * this.velocity.y + 0.5 * (cy - (this.box.y + this.box.height / 2)),
    };
    this.box = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    this.missed = 0;
  }

  /**
   * The smart crop's exact box for the item (frame pixels): when it agrees with the tracker, it becomes the new
   * place, and the template takes in a little of the item's current look (a new angle, new light).
   */
  refine(f: SmallGray, box: Rect) {
    if (!this.template || !this.box || f.k !== this.k) return;
    const b = { x: box.x / f.k, y: box.y / f.k, width: Math.max(2, box.width / f.k), height: Math.max(2, box.height / f.k) };
    if (iou(b, this.box) < 0.4) return;
    this.box = b;
    const raw = new Float32Array(TW * this.th);
    sample(f, b, TW, this.th, raw);
    const fresh = normalise(raw);
    if (!fresh) return;
    const mixed = new Float32Array(fresh.length);
    for (let i = 0; i < mixed.length; i++) mixed[i] = 0.8 * this.template[i] + 0.2 * fresh[i];
    this.template = normalise(mixed, 0) ?? this.template;
  }

  private sizeOf(b: Rect) {
    return { width: b.width * this.k, height: b.height * this.k };
  }

  private frameBox(b: Rect): Rect {
    return { x: b.x * this.k, y: b.y * this.k, width: b.width * this.k, height: b.height * this.k };
  }
}

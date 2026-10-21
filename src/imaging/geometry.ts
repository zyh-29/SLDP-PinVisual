/** Rectangles and points in image pixels, and the crop box's drag handling. Pure functions, unit tested. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A rectangle in source-pixel coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Integer pixel bounds of a rect, clamped to the image. */
export function bounds(r: Rect, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(r.x + r.width)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(r.y + r.height)));
  return { x0, y0, x1, y1 };
}

export function fullRect(width: number, height: number): Rect {
  return { x: 0, y: 0, width, height };
}

/** Clamps a crop to the image and enforces a minimum size. */
export function clampRect(r: Rect, width: number, height: number, minSize = 4): Rect {
  const w = Math.min(width, Math.max(minSize, r.width));
  const h = Math.min(height, Math.max(minSize, r.height));
  return {
    x: Math.min(width - w, Math.max(0, r.x)),
    y: Math.min(height - h, Math.max(0, r.y)),
    width: w,
    height: h,
  };
}

export type CropDragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br';

/** Applies a drag (in image pixels) to the crop it started from. */
export function dragCrop(start: Rect, mode: CropDragMode, dx: number, dy: number, imgW: number, imgH: number): Rect {
  const min = Math.max(4, Math.min(imgW, imgH) * 0.06);
  if (mode === 'move') return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, imgW, imgH, min);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (mode === 'tl' || mode === 'bl') left = Math.min(right - min, Math.max(0, left + dx));
  if (mode === 'tr' || mode === 'br') right = Math.max(left + min, Math.min(imgW, right + dx));
  if (mode === 'tl' || mode === 'tr') top = Math.min(bottom - min, Math.max(0, top + dy));
  if (mode === 'bl' || mode === 'br') bottom = Math.max(top + min, Math.min(imgH, bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export const area = (r: Rect) => r.width * r.height;

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function expand(r: Rect, by: number, width: number, height: number): Rect {
  const m = Math.round(Math.max(r.width, r.height) * by);
  const x = Math.max(0, r.x - m);
  const y = Math.max(0, r.y - m);
  return { x, y, width: Math.min(width, r.x + r.width + m) - x, height: Math.min(height, r.y + r.height + m) - y };
}

export function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, width: Math.max(1, r.width - 2 * by), height: Math.max(1, r.height - 2 * by) };
}

export interface Point {
  x: number;
  y: number;
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Distance from a point to a box (0 inside). */
export function distanceTo(r: Rect, p: Point): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function clip(r: Rect, to: Rect): Rect {
  const x = Math.max(r.x, to.x);
  const y = Math.max(r.y, to.y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(r.x + r.width, to.x + to.width) - x),
    height: Math.max(1, Math.min(r.y + r.height, to.y + to.height) - y),
  };
}

/** Cross product of (a - o) and (b - o): which side of the line o -> a the point b is on. */
export const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain), counter-clockwise in screen coordinates. */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Area of a polygon (shoelace formula), whichever way round its points go. */
export function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Overlap of two rectangles: intersection over union, 0..1. */
export function iou(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const i = w * h;
  return i / (a.width * a.height + b.width * b.height - i);
}

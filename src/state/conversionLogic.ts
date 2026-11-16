/**
 * Small decisions useImageConversion makes, as plain functions (no React), so each can be unit tested on its own.
 */
import type { Rect } from '@/imaging/geometry';

export const rectInside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** `ink` with everything outside `r` cleared (a copy). */
export function onlyInside(ink: Float32Array, width: number, height: number, r: Rect): Float32Array {
  const out = new Float32Array(ink.length);
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.width));
  const y1 = Math.min(height, Math.ceil(r.y + r.height));
  for (let y = y0; y < y1; y++) out.set(ink.subarray(y * width + x0, y * width + x1), y * width + x0);
  return out;
}

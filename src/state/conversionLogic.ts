/**
 * The decisions useImageConversion makes from one frame to the next, as plain functions (no React), so each can be
 * unit tested on its own. The hook only wires them to state.
 */
import type { Pattern } from '@/domain/pattern';
import type { Point, Rect } from '@/imaging/geometry';
import type { GraphScale } from '@/imaging/graph';

/**
 * Where to search when the camera is locked on an item: the item and a margin of 40% of its size, inside the
 * picture. None (search everything) when that would cover most of the picture anyway, or would leave out the point
 * being focused on (a tap on another item).
 */
export function searchAreaAround(tracked: Rect | null, width: number, height: number, focus: Point | null): Rect | undefined {
  if (!tracked || !width || !height) return undefined;
  const m = 0.4 * Math.max(tracked.width, tracked.height);
  const x0 = Math.max(0, Math.floor(tracked.x - m));
  const y0 = Math.max(0, Math.floor(tracked.y - m));
  const x1 = Math.min(width, Math.ceil(tracked.x + tracked.width + m));
  const y1 = Math.min(height, Math.ceil(tracked.y + tracked.height + m));
  const inside = !focus || (focus.x >= x0 && focus.x <= x1 && focus.y >= y0 && focus.y <= y1);
  return inside && x1 - x0 > 16 && y1 - y0 > 16 && (x1 - x0) * (y1 - y0) < 0.7 * width * height
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : undefined;
}

/** Whether `now` is another zoom level than `before`: its grid spacing changed by more than 1%, or its step. */
export function zoomedFrom(before: GraphScale, now: GraphScale): boolean {
  return (
    Math.abs(now.majorX / before.majorX - 1) > 0.01 ||
    Math.abs(now.majorY / before.majorY - 1) > 0.01 ||
    now.unitsPerMajorX !== before.unitsPerMajorX ||
    now.unitsPerMajorY !== before.unitsPerMajorY
  );
}

/**
 * The graph scale to store after this frame, or null to keep the stored one.
 *  - The camera locked on after the scale was measured: tie the scale as it is now to the item's tracked width,
 *    so from then on it follows the camera's zoom through the tracker.
 *  - A shared screen zoomed since the scale was stored: store the followed one, so the next frame follows on from
 *    this one (each frame zooms only a little from the one before; see followZoom).
 * `current` is the scale this frame used, `stored` the one kept between frames.
 */
export function nextGraphScale(
  stored: GraphScale | null,
  current: GraphScale | null | undefined,
  trackedWidth: number | null,
  followingZoom: boolean,
): GraphScale | null {
  if (!stored || !current) return null;
  if (trackedWidth && !stored.atWidth) return { ...current, atWidth: trackedWidth };
  if (followingZoom && zoomedFrom(stored, current)) return { ...current, followed: true };
  return null;
}

/**
 * Live, the pins shown while a graph's numbers are read again after a zoom (the scale is unknown, and the whole
 * curve would fill the board for a moment): the last graph window's pins are held, so the curve keeps its size.
 * Returns what to show, and the held pins to keep (`undefined`: unchanged).
 */
export function holdGraphPins(
  held: Pattern | null,
  frame: Pattern | null,
  s: { live: boolean; graph: boolean; windowed: boolean; readingNumbers: boolean; wholeCurve: boolean },
): { shown: Pattern | null; held: Pattern | null | undefined } {
  if (s.live && s.windowed && frame) return { shown: frame, held: held !== frame ? frame : undefined };
  if (s.live && s.readingNumbers && held) return { shown: held, held: undefined };
  if (held && (!s.live || !s.graph || s.wholeCurve)) return { shown: frame, held: null };
  return { shown: frame, held: undefined };
}

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

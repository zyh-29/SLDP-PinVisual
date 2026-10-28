/**
 * The history timeline's layout, in points, and the maths for dragging its playhead. Kept apart from the component
 * so it can be unit tested.
 */
/** One step's tile: a small drawing of the pins at that step. Also its touch target. */
export const TILE_W = 52;
export const TILE_H = 42;
/** The playhead sits in the middle of the gap after the step showing. */
export const GAP = 12;
export const PITCH = TILE_W + GAP;
/** Strip padding: room above the tiles for the playhead's knob, and at the sides. */
export const PAD_X = 12; // space.md
export const PAD_TOP = 16;
export const PAD_BOTTOM = 8;
/** Between a tile and the track: the tick under each step stands in it. */
export const TICK_ZONE = 10;
export const TRACK = 2;
/** From the strip's top to the track's bottom: the playhead's line runs down to here. */
export const TRACK_BOTTOM = PAD_TOP + TILE_H + TICK_ZONE + TRACK;
/** Where the playhead stands after step `i`. */
export const headX = (i: number) => PAD_X + (i + 1) * PITCH - GAP / 2;
/** Within this far of either end of the strip, a dragged playhead scrolls it, up to EDGE_SPEED points a frame. */
export const EDGE = 48;
export const EDGE_SPEED = 14;

/** The step whose playhead spot is nearest `x` (across the strip's content). */
export const stepAt = (x: number, last: number) =>
  Math.max(0, Math.min(last, Math.round((x - PAD_X + GAP / 2) / PITCH) - 1));

/**
 * How fast to scroll while the finger, `finger` points across a strip `viewport` wide, holds the playhead: negative
 * (left) near the left end, positive near the right, 0 elsewhere. Faster nearer the edge, and full speed past it.
 */
export function edgeSpeed(finger: number, viewport: number): number {
  if (!viewport) return 0;
  const left = EDGE - finger;
  const right = finger - (viewport - EDGE);
  const ramp = (into: number) => Math.max(2, Math.round(EDGE_SPEED * Math.min(1, into / EDGE)));
  if (left > 0) return -ramp(left);
  if (right > 0) return ramp(right);
  return 0;
}


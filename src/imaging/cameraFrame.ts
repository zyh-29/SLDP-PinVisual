/**
 * Live camera support: what a camera adds over a shared screen. Pure functions, unit tested.
 *
 *  - Sensor noise. A screen's flat areas are exactly flat; a camera's wobble by a few levels on every pixel, so
 *    every frame would look like a photo, and graph (curve and plot) detection only runs on flat pictures. A
 *    3 x 3 box blur takes the noise down about three times while keeping lines (a 1 px gridline keeps a third of
 *    its contrast: still a clear dip).
 *  - Flicker. Noise and small hand movements change a few pins on every frame. steadyPins averages each pin over
 *    the last frames and only flips it once the average has clearly crossed over (hysteresis).
 */
import type { Pattern, PinValue } from '@/domain/pattern';

/** 3 x 3 box blur of RGBA pixels, in place (alpha untouched). Separable, so about 12 operations per pixel. */
export function denoiseFrame(rgba: Uint8ClampedArray, width: number, height: number): void {
  if (width < 3 || height < 3) return;
  const tmp = new Uint16Array(width * height * 3);
  // Horizontal: sum of each pixel and its left and right neighbours (edges repeat the border pixel).
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const l = row + Math.max(0, x - 1);
      const r = row + Math.min(width - 1, x + 1);
      const c = row + x;
      for (let k = 0; k < 3; k++) tmp[c * 3 + k] = rgba[l * 4 + k] + rgba[c * 4 + k] + rgba[r * 4 + k];
    }
  }
  // Vertical, then divide by 9 (rounded).
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) {
        const s = tmp[(up + x) * 3 + k] + tmp[(row + x) * 3 + k] + tmp[(down + x) * 3 + k];
        rgba[(row + x) * 4 + k] = (s + 4) / 9;
      }
    }
  }
}

export interface SteadyPins {
  /** Running average per pin, 0..1. */
  avg: Float32Array;
  /** What is shown. */
  pattern: Pattern;
}

/**
 * A pin rises once its average reaches RISE, and drops once it falls to FALL. Wide enough that a pin wobbling
 * every other frame (its average then swings between about 0.39 and 0.61) holds still.
 */
const RISE = 0.65;
const FALL = 0.35;

/**
 * Folds the next frame's pins into the running state. `weight` is how much one frame counts (0.35: a pin that
 * truly changes flips after about 2 frames, a pin that flickers on a single frame never does). A different grid
 * size starts over.
 */
export function steadyPins(prev: SteadyPins | null, next: Pattern, weight = 0.35): SteadyPins {
  if (!prev || prev.pattern.rows !== next.rows || prev.pattern.cols !== next.cols) {
    return { avg: Float32Array.from(next.cells), pattern: next };
  }
  const avg = new Float32Array(next.cells.length);
  const cells: PinValue[] = [];
  let changed = false;
  for (let i = 0; i < avg.length; i++) {
    avg[i] = prev.avg[i] * (1 - weight) + next.cells[i] * weight;
    const was = prev.pattern.cells[i];
    const now: PinValue = was ? (avg[i] > FALL ? 1 : 0) : avg[i] >= RISE ? 1 : 0;
    if (now !== was) changed = true;
    cells.push(now);
  }
  // Keep the same pattern object while nothing visible changed, so screens downstream don't redraw.
  return { avg, pattern: changed ? { rows: next.rows, cols: next.cols, cells } : prev.pattern };
}

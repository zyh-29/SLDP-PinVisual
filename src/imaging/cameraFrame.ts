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
import { luma } from './pixels';

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

/**
 * How sharp a frame is: the mean squared brightness step between neighbouring pixels, measured on a copy
 * averaged into blocks (about 120 blocks on the short side). Edges in focus are steep, so it is high; while the
 * camera hunts for focus (or the hand moves) edges smear and it drops. The blocks matter: sensor noise is just as
 * strong on a blurred frame, and pixel by pixel it would drown the difference; averaging removes the noise but
 * keeps the edges. Only meaningful compared with other frames of the same scene.
 */
export function sharpness(rgba: ArrayLike<number>, width: number, height: number): number {
  const b = Math.max(1, Math.round(Math.min(width, height) / 120));
  const w = Math.floor(width / b);
  const h = Math.floor(height / b);
  if (w < 2 || h < 2) return 0;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h * b; y++)
    for (let x = 0; x < w * b; x++) {
      const p = (y * width + x) * 4;
      lum[Math.floor(y / b) * w + Math.floor(x / b)] += luma(rgba[p], rgba[p + 1], rgba[p + 2]);
    }
  let sum = 0;
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const dx = lum[i + 1] - lum[i];
      const dy = lum[i + w] - lum[i];
      sum += dx * dx + dy * dy;
    }
  return sum / ((w - 1) * (h - 1) * b ** 4);
}

/**
 * Decides which live frames are sharp enough to use. A frame counts as blurry when its sharpness is below
 * `ratio` of the recent best (the best decays a little each frame, so a new, plainer scene is soon accepted).
 * Blurry frames are skipped, keeping the last sharp result on the pins, but never more than `maxSkip` in a row,
 * so the pins can't freeze.
 */
export class FocusGate {
  private best = 0;
  private skipped = 0;
  /** Blurry frames in a row (skipped or not). */
  blurryFor = 0;

  constructor(
    private readonly ratio = 0.5,
    private readonly maxSkip = 3,
    private readonly decay = 0.92,
  ) {}

  /** True to use this frame. */
  accept(s: number): boolean {
    this.best = Math.max(s, this.best * this.decay);
    const blurry = s < this.best * this.ratio;
    this.blurryFor = blurry ? this.blurryFor + 1 : 0;
    if (!blurry || this.skipped >= this.maxSkip) {
      this.skipped = 0;
      return true;
    }
    this.skipped++;
    return false;
  }

  /** The recent best sharpness: what "in focus" looks like for this scene right now. */
  get recentBest() {
    return this.best;
  }

  /** A new scene (another camera): forget the old best. */
  reset() {
    this.best = 0;
    this.skipped = 0;
    this.blurryFor = 0;
  }
}

/**
 * Overall brightness of a frame and how much it varies, on 8 x 8 block averages (so sensor noise, which phones
 * amplify hugely in the dark, averages out): `mean` 0..255, `spread` the standard deviation between blocks.
 */
export function frameLight(rgba: ArrayLike<number>, width: number, height: number): { mean: number; spread: number } {
  const B = 8;
  const bw = Math.floor(width / B);
  const bh = Math.floor(height / B);
  if (bw < 1 || bh < 1) return { mean: 0, spread: 0 };
  let sum = 0;
  let sq = 0;
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      // Every 2nd pixel of the block is plenty for an average.
      for (let y = by * B; y < by * B + B; y += 2)
        for (let x = bx * B; x < bx * B + B; x += 2) {
          const p = (y * width + x) * 4;
          s += luma(rgba[p], rgba[p + 1], rgba[p + 2]);
        }
      const m = s / ((B * B) / 4);
      sum += m;
      sq += m * m;
    }
  const n = bw * bh;
  const mean = sum / n;
  return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/**
 * Decides which live frames are worth analysing as far as light goes:
 *  - too dark: essentially black (a covered lens, a dark room). Nothing can be found in it, and on phones the
 *    camera's gain makes it pure noise that is still costly to analyse, so it is skipped and reported.
 *  - settling: the overall brightness just jumped (the light came back, the phone turned to a window) and the
 *    camera's auto-exposure is still catching up, so the frame is over- or under-exposed: skipped, but never more
 *    than `maxSkip` in a row.
 */
export class LightGate {
  private last = -1;
  private skipped = 0;
  dark = false;

  constructor(
    private readonly maxSkip = 3,
    private readonly darkMean = 28,
    private readonly flatSpread = 10,
  ) {}

  /** True to analyse this frame. */
  accept(light: { mean: number; spread: number }): boolean {
    this.dark = light.mean < this.darkMean && light.spread < this.flatSpread;
    const prev = this.last;
    this.last = light.mean;
    if (this.dark) return false;
    const jump = prev >= 0 && Math.abs(light.mean - prev) > 0.2 * Math.max(prev, light.mean, 40);
    if (!jump || this.skipped >= this.maxSkip) {
      this.skipped = 0;
      return true;
    }
    this.skipped++;
    return false;
  }

  reset() {
    this.last = -1;
    this.skipped = 0;
    this.dark = false;
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

/**
 * A frame's coarse brightness (32 x 24 blocks), to tell whether the camera still looks at the same view. `channels`
 * is 3 for RGB, 4 for the browser's RGBA.
 */
export function viewSketch(rgb: ArrayLike<number>, width: number, height: number, channels = 3): Float32Array {
  const cols = 32;
  const rows = 24;
  const sum = new Float32Array(cols * rows);
  const count = new Float32Array(cols * rows);
  for (let y = 0; y < height; y += 2) {
    const by = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const b = by * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
      sum[b] += luma(rgb[i], rgb[i + 1], rgb[i + 2]);
      count[b]++;
    }
  }
  for (let b = 0; b < sum.length; b++) sum[b] /= Math.max(1, count[b]);
  return sum;
}

/**
 * Nothing in view has changed since `last`: no block is brighter or darker by more than STILL_VIEW levels. Each
 * block averages about 75 pixels, so the sensor's noise (already smoothed by the phone) moves it by a level or so, while a pen stroke or a
 * hand coming into one block moves it by tens. The largest block counts, not the average: one small change in a
 * corner is still a change. The live camera skips analysing such frames (the result would be the same) to keep
 * the phone cool.
 */
export const STILL_VIEW = 6;
export function viewStill(last: Float32Array, now: Float32Array): boolean {
  if (last.length !== now.length) return false;
  for (let i = 0; i < last.length; i++) if (Math.abs(now[i] - last[i]) > STILL_VIEW) return false;
  return true;
}

/**
 * The view has changed since `kept` (the camera turned to something else): the blocks' brightness differs by more
 * than VIEW_MOVED on average, after allowing for the camera's own exposure change (the mean difference is taken
 * out first). A hand's tremble moves a few blocks a little; pointing elsewhere changes most of them.
 */
export const VIEW_MOVED = 14;
export function viewMoved(kept: Float32Array, now: Float32Array): boolean {
  if (kept.length !== now.length) return true;
  let shift = 0;
  for (let i = 0; i < kept.length; i++) shift += now[i] - kept[i];
  shift /= kept.length;
  let diff = 0;
  for (let i = 0; i < kept.length; i++) diff += Math.abs(now[i] - kept[i] - shift);
  return diff / kept.length > VIEW_MOVED;
}

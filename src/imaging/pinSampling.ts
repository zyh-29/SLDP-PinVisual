/**
 * From a mask (or darkness) to pins: thin strokes are thickened to about half a pin, the crop is placed on the grid
 * and each pin gets the share of its area that is content ("ink"). Also the "what the pins see" preview.
 * Pure functions, unit tested.
 */
import type { Pattern, PinValue } from '@/domain/pattern';
import { bounds, type Rect } from './geometry';
import { dilate } from './masks';

/** Per-pixel ink 0..1 from the mask. */
export function inkFromMask(mask: Uint8Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i];
  return out;
}

/** Per-pixel ink 0..1 from darkness (used when background removal is off). */
export function inkFromGray(gray: Float32Array): Float32Array {
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = (255 - gray[i]) / 255;
  return out;
}

export interface CellSamples {
  /** Share of each pin's area that is content, 0..1 (row-major). */
  ink: Float32Array;
  /** Share of each pin's area that the crop covers at all (the rest is padding). */
  covered: Float32Array;
}

/**
 * Places the crop on the grid and area-averages the ink under each pin, with
 * exact fractional pixel coverage. `stretch` fills the whole grid (graphs);
 * otherwise the aspect ratio is kept and the crop is centred.
 */
export function sampleCrop(
  ink: Float32Array,
  width: number,
  height: number,
  crop: Rect,
  rows: number,
  cols: number,
  pinPitchRatio = 1,
  stretch = false,
): CellSamples {
  const gridW = cols * pinPitchRatio;
  const gridH = rows;
  // Grid units per source pixel.
  const fit = Math.min(gridW / crop.width, gridH / crop.height);
  const sx = stretch ? gridW / crop.width : fit;
  const sy = stretch ? gridH / crop.height : fit;
  const offX = (gridW - crop.width * sx) / 2;
  const offY = (gridH - crop.height * sy) / 2;
  const {
    x0: cx0,
    y0: cy0,
    x1: cx1,
    y1: cy1,
  } = {
    x0: Math.max(0, crop.x),
    y0: Math.max(0, crop.y),
    x1: Math.min(width, crop.x + crop.width),
    y1: Math.min(height, crop.y + crop.height),
  };
  const cellArea = (pinPitchRatio / sx) * (1 / sy);

  const inkOut = new Float32Array(rows * cols);
  const covOut = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.max(cy0, crop.y + (r - offY) / sy);
    const y1 = Math.min(cy1, crop.y + (r + 1 - offY) / sy);
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(cx0, crop.x + (c * pinPitchRatio - offX) / sx);
      const x1 = Math.min(cx1, crop.x + ((c + 1) * pinPitchRatio - offX) / sx);
      let sum = 0;
      let covered = 0;
      if (x1 > x0 && y1 > y0) {
        for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
          const wy = Math.min(py + 1, y1) - Math.max(py, y0);
          if (wy <= 0) continue;
          for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
            const wx = Math.min(px + 1, x1) - Math.max(px, x0);
            if (wx <= 0) continue;
            sum += ink[py * width + px] * wx * wy;
            covered += wx * wy;
          }
        }
      }
      inkOut[r * cols + c] = sum / cellArea;
      covOut[r * cols + c] = covered / cellArea;
    }
  }
  return { ink: inkOut, covered: covOut };
}

/** Size of one pin's cell in source pixels for this crop (width, height). */
export function cellSizePx(crop: Rect, rows: number, cols: number, pinPitchRatio = 1, stretch = false): { w: number; h: number } {
  const gridW = cols * pinPitchRatio;
  const fit = Math.min(gridW / crop.width, rows / crop.height);
  const sx = stretch ? gridW / crop.width : fit;
  const sy = stretch ? rows / crop.height : fit;
  return { w: pinPitchRatio / sx, h: 1 / sy };
}

/**
 * Thin-line drawings (graphs, outlines, handwriting) barely cover a pin's
 * area, so they would vanish. This thickens strokes to about half a pin in
 * each direction, so a line running through a pin raises it. It also closes
 * small gaps, e.g. where gridlines were removed. Returns the mask unchanged
 * for filled shapes.
 */
export function thickenThinLines(
  mask: Uint8Array,
  width: number,
  height: number,
  stroke: number,
  cell: { w: number; h: number },
): Uint8Array {
  // Thin compared with the pin's longer side (stretched graphs have long, flat pins); each direction is grown separately.
  // Up to half a pin: a line a third of a pin wide covers too little of each pin to raise it (35% by default).
  if (stroke <= 0 || stroke >= 0.5 * Math.max(cell.w, cell.h)) return mask;
  const rx = Math.max(0, 0.25 * cell.w - stroke / 2);
  const ry = Math.max(0, 0.25 * cell.h - stroke / 2);
  if (Math.round(rx) === 0 && Math.round(ry) === 0) return mask;
  return dilate(mask, width, height, rx, ry);
}

/**
 * Raises pins whose content share reaches `pinFill`. Invert raises the
 * background instead; padding outside the crop always stays lowered.
 */
export function patternFromSamples(s: CellSamples, rows: number, cols: number, pinFill: number, invert: boolean): Pattern {
  const cells: PinValue[] = [];
  for (let i = 0; i < s.ink.length; i++) {
    const value = invert ? s.covered[i] - s.ink[i] : s.ink[i];
    cells.push(value >= pinFill && value > 0 ? 1 : 0);
  }
  return { rows, cols, cells };
}

/**
 * A curve (a graph's, a drawn line) as a line exactly one pin wide, instead of every pin it touches. On a few
 * dozen pins a thickened curve becomes a band two pins wide that is hard to follow by touch.
 *
 * The curve's pixels are placed on the grid as `sampleCrop` would. Each place where the curve crosses a pin
 * column's centre line raises the pin there: that draws the flatter parts. The same across each pin row's centre
 * line draws the steep parts, which columns alone would leave as dots. Together: a connected line following the
 * curve's centre, the pins nearest to it.
 *
 * Crossings, not "the middle of the curve in each row": a parabola's two arms meet in its vertex row, so that row
 * holds one stretch of curve, and its middle would raise a single pin on one side of the vertex (a lopsided U that
 * flips sides from frame to frame). Its arms cross the row's centre line twice: two pins, symmetric.
 *
 * Bits of curve that cross no centre line (a short end, a small wiggle inside one pin) still raise their pin when
 * nothing next to it is raised. Runs of fewer than `minPixels` pixels are specks.
 */
export function traceLinePins(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  crop: Rect,
  rows: number,
  cols: number,
  pinPitchRatio = 1,
  stretch = false,
  /** Only pixels inside this area count (a graph's plot when the window reaches past it). */
  within?: Rect,
): Pattern {
  const gridW = cols * pinPitchRatio;
  const fit = Math.min(gridW / crop.width, rows / crop.height);
  const sx = stretch ? gridW / crop.width : fit;
  const sy = stretch ? rows / crop.height : fit;
  const offX = (gridW - crop.width * sx) / 2;
  const offY = (rows - crop.height * sy) / 2;
  const a = bounds(crop, width, height);
  const b = within ? bounds(within, width, height) : a;
  const [x0, y0, x1, y1] = [Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1)];
  // A centre line's band, half-width in pin units: a few pixels, so a thin curve crossing it leaves a run of pixels.
  const pxW = sx / pinPitchRatio;
  const bandX = Math.max(0.08, 1.5 * pxW);
  const bandY = Math.max(0.08, 1.5 * sy);
  // Grid positions (pin units) of the curve pixels on each column's and row's centre line, and the count per pin.
  const onCol: number[][] = Array.from({ length: cols }, () => []);
  const onRow: number[][] = Array.from({ length: rows }, () => []);
  const touched = new Int32Array(rows * cols);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!mask[y * width + x]) continue;
      const gx = ((x + 0.5 - crop.x) * sx + offX) / pinPitchRatio;
      const gy = (y + 0.5 - crop.y) * sy + offY;
      const c = Math.floor(gx);
      const r = Math.floor(gy);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      touched[r * cols + c]++;
      if (Math.abs(gx - c - 0.5) <= bandX) onCol[c].push(gy);
      if (Math.abs(gy - r - 0.5) <= bandY) onRow[r].push(gx);
    }
  // A speck: under a fifth of a pin's width of curve pixels.
  const minPixels = Math.max(2, 0.2 / Math.max(sx, sy));
  const cells: PinValue[] = new Array(rows * cols).fill(0);
  /** The middle of each run of positions without a gap of a fifth of a pin: one per crossing. */
  const crossings = (v: number[]) => {
    v.sort((a, b) => a - b);
    const out: number[] = [];
    let start = 0;
    for (let i = 1; i <= v.length; i++)
      if (i === v.length || v[i] - v[i - 1] > 0.2) {
        if (i - start >= 2) out.push(v[(start + i) >> 1]);
        start = i;
      }
    return out;
  };
  // A crossing on the line between two pins (within a pixel) takes the one nearer the middle of the board: rounding
  // down would move a symmetric curve's two arms the same way (a shifted U instead of a mirrored one).
  const tie = Math.max(0.04, pxW, sy);
  const pinAt = (m: number, n: number) => {
    const k = Math.round(m);
    const onLine = Math.abs(m - k) <= tie && k > 0 && k < n;
    const i = onLine ? (Math.abs(k - 0.5 - n / 2) < Math.abs(k + 0.5 - n / 2) ? k - 1 : k) : Math.floor(m);
    return Math.max(0, Math.min(n - 1, i));
  };
  for (let c = 0; c < cols; c++) for (const m of crossings(onCol[c])) cells[pinAt(m, rows) * cols + c] = 1;
  for (let r = 0; r < rows; r++) for (const m of crossings(onRow[r])) cells[r * cols + pinAt(m, cols)] = 1;
  // Curve that crossed no centre line, with nothing raised next to it.
  const near = (r: number, c: number) => {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && cells[rr * cols + cc]) return true;
      }
    return false;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (touched[r * cols + c] >= minPixels && !near(r, c)) cells[r * cols + c] = 1;
  return { rows, cols, cells };
}

/**
 * RGB pixels of the crop for the "what the pins see" preview. With a mask,
 * removed background is drawn as a light checkerboard (the usual sign for
 * "transparent"). Returns 8-bit RGB, 3 channels.
 */
export function renderCrop(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  mask: Uint8Array | null,
  crop: Rect,
): { width: number; height: number; data: Uint8Array } {
  const { x0, y0, x1, y1 } = bounds(crop, width, height);
  const w = x1 - x0;
  const h = y1 - y0;
  const square = Math.max(3, Math.round(Math.max(w, h) / 32));
  const data = new Uint8Array(w * h * 3);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      const o = ((y - y0) * w + (x - x0)) * 3;
      if (mask && !mask[p]) {
        const v = (Math.floor((x - x0) / square) + Math.floor((y - y0) / square)) % 2 ? 236 : 255;
        data[o] = data[o + 1] = data[o + 2] = v;
        continue;
      }
      data[o] = rgb[p * 3];
      data[o + 1] = rgb[p * 3 + 1];
      data[o + 2] = rgb[p * 3 + 2];
    }
  }
  return { width: w, height: h, data };
}

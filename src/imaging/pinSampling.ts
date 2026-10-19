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
  if (stroke <= 0 || stroke >= 0.25 * Math.max(cell.w, cell.h)) return mask;
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

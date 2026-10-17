/**
 * Image -> pin grid conversion. Pure functions, no React Native imports, so
 * everything here is unit tested.
 *
 * Steps:
 *  1. Grayscale: Rec. 709 luma, with transparent pixels composited over white.
 *  2. Place the image on the grid preserving aspect ratio:
 *       'fit'  - whole image visible, empty space padded with white (lowered pins)
 *       'fill' - image covers the grid, overflow cropped equally from both sides
 *  3. Area-average the pixels under each pin (exact fractional coverage).
 *  4. Threshold: luminance < threshold -> raised (dark = raised). Invert flips it.
 */
import type { Pattern, PinValue } from '@/domain/pattern';

export type FitMode = 'fit' | 'fill';

export interface RasterImage {
  width: number;
  height: number;
  /** Interleaved samples, 8-bit, `channels` per pixel (1 gray, 2 gray+alpha, 3 RGB, 4 RGBA). */
  data: ArrayLike<number>;
  channels: 1 | 2 | 3 | 4;
}

export interface ConversionOptions {
  rows: number;
  cols: number;
  /** 0..255. Cells darker than this become raised (before inversion). */
  threshold: number;
  invert: boolean;
  fit: FitMode;
  /** Horizontal / vertical pin pitch. 1 for square spacing. */
  pinPitchRatio?: number;
}

export const DEFAULT_THRESHOLD = 128;
const WHITE = 255;

/** Grayscale luminance 0..255 per pixel. */
export function toGrayscale(img: RasterImage): Float32Array {
  const { width, height, data, channels } = img;
  const out = new Float32Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += channels) {
    let lum: number;
    let alpha = 255;
    if (channels === 1 || channels === 2) {
      lum = data[i];
      if (channels === 2) alpha = data[i + 1];
    } else {
      lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (channels === 4) alpha = data[i + 3];
    }
    const a = alpha / 255;
    out[p] = lum * a + WHITE * (1 - a);
  }
  return out;
}

export interface Placement {
  /** Grid units per source pixel. */
  scale: number;
  /** Image's top-left corner, in grid units. */
  offsetX: number;
  offsetY: number;
  gridWidth: number;
  gridHeight: number;
}

/** Where the image sits on the grid. One grid unit = one pin row; a column is `pinPitchRatio` units wide. */
export function computePlacement(
  imgWidth: number,
  imgHeight: number,
  rows: number,
  cols: number,
  fit: FitMode,
  pinPitchRatio = 1,
): Placement {
  const gridWidth = cols * pinPitchRatio;
  const gridHeight = rows;
  const sx = gridWidth / imgWidth;
  const sy = gridHeight / imgHeight;
  const scale = fit === 'fit' ? Math.min(sx, sy) : Math.max(sx, sy);
  return {
    scale,
    offsetX: (gridWidth - imgWidth * scale) / 2,
    offsetY: (gridHeight - imgHeight * scale) / 2,
    gridWidth,
    gridHeight,
  };
}

/** Mean luminance under each pin (row-major). Padding counts as white. */
export function sampleCells(
  gray: Float32Array,
  width: number,
  height: number,
  rows: number,
  cols: number,
  fit: FitMode,
  pinPitchRatio = 1,
): Float32Array {
  const pl = computePlacement(width, height, rows, cols, fit, pinPitchRatio);
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    // Cell bounds in source-pixel coordinates.
    const y0 = (r - pl.offsetY) / pl.scale;
    const y1 = (r + 1 - pl.offsetY) / pl.scale;
    for (let c = 0; c < cols; c++) {
      const x0 = (c * pinPitchRatio - pl.offsetX) / pl.scale;
      const x1 = ((c + 1) * pinPitchRatio - pl.offsetX) / pl.scale;
      const cellArea = (x1 - x0) * (y1 - y0);
      let sum = 0;
      let covered = 0;
      const py0 = Math.max(0, Math.floor(y0));
      const py1 = Math.min(height, Math.ceil(y1));
      const px0 = Math.max(0, Math.floor(x0));
      const px1 = Math.min(width, Math.ceil(x1));
      for (let py = py0; py < py1; py++) {
        const wy = Math.min(py + 1, y1) - Math.max(py, y0);
        if (wy <= 0) continue;
        for (let px = px0; px < px1; px++) {
          const wx = Math.min(px + 1, x1) - Math.max(px, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          sum += gray[py * width + px] * w;
          covered += w;
        }
      }
      const uncovered = Math.max(0, cellArea - covered);
      out[r * cols + c] = (sum + uncovered * WHITE) / (covered + uncovered);
    }
  }
  return out;
}

export function thresholdCells(luminance: ArrayLike<number>, threshold: number, invert: boolean): PinValue[] {
  const cells: PinValue[] = [];
  for (let i = 0; i < luminance.length; i++) {
    const dark = luminance[i] < threshold;
    cells.push((dark !== invert ? 1 : 0) as PinValue);
  }
  return cells;
}

export interface ConversionResult {
  pattern: Pattern;
  /** Mean luminance per pin, for a "brightness" preview. */
  cellLuminance: Float32Array;
}

export function imageToPattern(img: RasterImage, o: ConversionOptions): ConversionResult {
  if (img.width < 1 || img.height < 1) throw new Error('Image is empty');
  const gray = toGrayscale(img);
  const cellLuminance = sampleCells(gray, img.width, img.height, o.rows, o.cols, o.fit, o.pinPitchRatio ?? 1);
  const threshold = Math.min(255, Math.max(0, o.threshold));
  return {
    pattern: { rows: o.rows, cols: o.cols, cells: thresholdCells(cellLuminance, threshold, o.invert) },
    cellLuminance,
  };
}

/** Same as imageToPattern but reuses precomputed cell luminance (for fast slider updates). */
export function patternFromLuminance(
  cellLuminance: Float32Array,
  rows: number,
  cols: number,
  threshold: number,
  invert: boolean,
): Pattern {
  return { rows, cols, cells: thresholdCells(cellLuminance, threshold, invert) };
}

/**
 * Finds the subject of an image and prepares it for the pin grid.
 * Pure functions, no React Native imports, so everything here is unit tested.
 *
 * Steps:
 *  1. Background colour: the median colour of a thin ring of pixels around
 *     the image edge or the crop edge, whichever is more even. Works for
 *     drawings, diagrams, icons, paper and parts of screenshots.
 *  2. Foreground mask: a pixel is content when its colour is far enough from
 *     the background. Colour distance, not darkness, so a pale yellow fill on
 *     white still counts.
 *  3. Axes and grid: long, thin, isolated straight lines are found. When they
 *     cross and something else remains (a curve, bars), the image is treated
 *     as a graph and the lines are removed.
 *  4. Clutter removal: separate pieces much smaller than the biggest one
 *     (labels, titles, tick numbers, watermarks) are dropped.
 *  5. Smart crop: the box around what is left. No margin, so no pins are wasted.
 *  6. Thin lines are thickened to about half a pin, so a line passing
 *     through a pin raises it (graphs, outlines, handwriting).
 *  7. Sampling: the crop is placed on the grid (aspect ratio kept, or
 *     stretched for graphs) and each pin gets the share of its area that is
 *     content ("ink").
 */
import type { Pattern, PinValue } from '@/domain/pattern';
import type { RasterImage } from './convert';

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

export interface Component {
  /** Number of pixels. */
  area: number;
  box: Rect;
}

/** A long thin straight line (axis or gridline). */
export interface StraightLine {
  orientation: 'h' | 'v';
  /** Rows (h) or columns (v) the line occupies, inclusive. */
  from: number;
  to: number;
  /** Where the line starts and ends along its length. */
  start: number;
  end: number;
}

export interface Foreground {
  width: number;
  height: number;
  /** The area that was analysed (the crop, or the whole image). */
  region: Rect;
  background: Rgb;
  /** How uneven the background ring is (mean colour distance). High = busy photo. */
  borderNoise: number;
  /** 1 = content after line and clutter removal, 0 = background. */
  mask: Uint8Array;
  /** Box around the kept content, or null when nothing was found. */
  subject: Rect | null;
  /** Number of separate pieces that were dropped as clutter. */
  removedPieces: number;
  /** Straight lines found (whether or not they were removed). */
  lines: StraightLine[];
  /** The lines look like graph axes or a grid. */
  graphLikely: boolean;
  linesRemoved: boolean;
  /** Typical stroke thickness of the kept content, in pixels. */
  strokeWidth: number;
}

export interface ForegroundOptions {
  /** Colour distance (0..441) above which a pixel is content. */
  tolerance: number;
  /** Drop pieces smaller than this share of the biggest piece. 0 keeps everything. */
  minPieceRatio: number;
  /** Only this part of the image is analysed. Defaults to the whole image. */
  region?: Rect;
  /** Remove axes and gridlines: always, never, or when the image looks like a graph. */
  removeLines?: boolean | 'auto';
  /** Subject probability 0..1 per pixel from Smart Cut-Out. Replaces the colour test when given. */
  subjectMask?: Float32Array;
}

export const DEFAULT_TOLERANCE = 40;
export const DEFAULT_MIN_PIECE_RATIO = 0.15;
/** Pins raise when at least this share of their area is content. */
export const DEFAULT_PIN_FILL = 0.35;

/** RGB per pixel with transparency composited over white. */
export function toRgb(img: RasterImage): Uint8ClampedArray {
  const { width, height, data, channels } = img;
  const out = new Uint8ClampedArray(width * height * 3);
  for (let p = 0, i = 0; p < width * height; p++, i += channels) {
    let r: number, g: number, b: number;
    let a = 255;
    if (channels <= 2) {
      r = g = b = data[i];
      if (channels === 2) a = data[i + 1];
    } else {
      r = data[i];
      g = data[i + 1];
      b = data[i + 2];
      if (channels === 4) a = data[i + 3];
    }
    const k = a / 255;
    out[p * 3] = r * k + 255 * (1 - k);
    out[p * 3 + 1] = g * k + 255 * (1 - k);
    out[p * 3 + 2] = b * k + 255 * (1 - k);
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 255;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

const dist = (rgb: ArrayLike<number>, i: number, c: Rgb) => Math.hypot(rgb[i] - c.r, rgb[i + 1] - c.g, rgb[i + 2] - c.b);

/** Integer pixel bounds of a rect, clamped to the image. */
function bounds(r: Rect, width: number, height: number) {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(r.x + r.width)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(r.y + r.height)));
  return { x0, y0, x1, y1 };
}

/**
 * Median colour of the outer ring of pixels (about 2% of the short side) of
 * `region`, or of the whole image.
 */
export function estimateBackground(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect = fullRect(width, height),
): { color: Rgb; noise: number } {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const ring = Math.max(1, Math.round(Math.min(x1 - x0, y1 - y0) * 0.02));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const idx: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x >= x0 + ring && x < x1 - ring && y >= y0 + ring && y < y1 - ring) {
        x = x1 - ring - 1; // jump across the interior
        continue;
      }
      const i = (y * width + x) * 3;
      rs.push(rgb[i]);
      gs.push(rgb[i + 1]);
      bs.push(rgb[i + 2]);
      idx.push(i);
    }
  }
  const color = { r: median(rs), g: median(gs), b: median(bs) };
  let noise = 0;
  for (const i of idx) noise += dist(rgb, i, color);
  return { color, noise: idx.length ? noise / idx.length : 0 };
}

/** 8-connected pieces of the mask. Returns a label per pixel (0 = background, 1.. = piece) and piece stats. */
export function labelComponents(mask: Uint8Array, width: number, height: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = components.length + 1;
    let area = 0;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
    }
    components.push({ area, box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } });
  }
  return { labels, components };
}

/**
 * Long thin straight lines inside `region`: rows (or columns) where at least
 * 60% of the pixels are content, at most ~3% of the region thick, with empty
 * space on both sides (so the straight edge of a filled shape doesn't count).
 */
export function findStraightLines(mask: Uint8Array, width: number, height: number, region: Rect): StraightLine[] {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const out: StraightLine[] = [];
  for (const horizontal of [true, false]) {
    const across0 = horizontal ? y0 : x0;
    const across1 = horizontal ? y1 : x1;
    const along0 = horizontal ? x0 : y0;
    const along1 = horizontal ? x1 : y1;
    const length = along1 - along0;
    const ink = (a: number, l: number) => {
      if (a < across0 || a >= across1) return 0;
      return horizontal ? mask[a * width + l] : mask[l * width + a];
    };
    const counts = new Int32Array(across1 - across0);
    for (let a = across0; a < across1; a++) {
      let n = 0;
      for (let l = along0; l < along1; l++) n += ink(a, l);
      counts[a - across0] = n;
    }
    const long = (a: number) => counts[a - across0] >= 0.6 * length;
    const maxThickness = Math.max(3, Math.round((across1 - across0) * 0.03));
    let a = across0;
    while (a < across1) {
      if (!long(a)) {
        a++;
        continue;
      }
      let b = a;
      while (b + 1 < across1 && long(b + 1)) b++;
      if (b - a + 1 <= maxThickness) {
        const mid = (a + b) >> 1;
        let onLine = 0;
        let isolated = 0;
        let start = -1;
        let end = -1;
        for (let l = along0; l < along1; l++) {
          if (!ink(mid, l)) continue;
          onLine++;
          if (start < 0) start = l;
          end = l;
          if (!ink(a - 2, l) && !ink(b + 2, l)) isolated++;
        }
        if (onLine && isolated / onLine >= 0.6) out.push({ orientation: horizontal ? 'h' : 'v', from: a, to: b, start, end });
      }
      a = b + 1;
    }
  }
  return out;
}

/** A horizontal and a vertical line cross somewhere other than at both of their ends (T or + shape). */
export function linesCross(lines: StraightLine[]): boolean {
  const inside = (pos: number, l: StraightLine) => {
    const margin = (l.end - l.start) * 0.1;
    return pos > l.start + margin && pos < l.end - margin;
  };
  const touches = (pos: number, l: StraightLine) => pos >= l.start - 2 && pos <= l.end + 2;
  for (const h of lines) {
    if (h.orientation !== 'h') continue;
    const hy = (h.from + h.to) / 2;
    for (const v of lines) {
      if (v.orientation !== 'v') continue;
      const vx = (v.from + v.to) / 2;
      if (!touches(vx, h) || !touches(hy, v)) continue;
      if (inside(vx, h) || inside(hy, v)) return true;
    }
  }
  return false;
}

function eraseLines(mask: Uint8Array, width: number, height: number, region: Rect, lines: StraightLine[]) {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  for (const l of lines) {
    // One extra pixel each side removes anti-aliasing halos.
    for (let a = l.from - 1; a <= l.to + 1; a++) {
      if (l.orientation === 'h') {
        if (a < y0 || a >= y1) continue;
        for (let x = x0; x < x1; x++) mask[a * width + x] = 0;
      } else {
        if (a < x0 || a >= x1) continue;
        for (let y = y0; y < y1; y++) mask[y * width + a] = 0;
      }
    }
  }
}

const countOnes = (m: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
};

/** Typical stroke thickness: area / half the outline length. A line w px wide gives ~w; a filled disc gives its radius. */
export function strokeWidth(mask: Uint8Array, width: number, height: number): number {
  let area = 0;
  let edge = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      area++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width])
        edge++;
    }
  }
  return edge ? area / (edge / 2) : 0;
}

/** `rgb` comes from `toRgb` (3 bytes per pixel). */
export function findForeground(rgb: ArrayLike<number>, width: number, height: number, o: ForegroundOptions): Foreground {
  const region = o.region ?? fullRect(width, height);
  const { x0, y0, x1, y1 } = bounds(region, width, height);

  // The image edge suits a tight auto crop; the crop edge suits part of a screenshot. Use the more even one.
  const whole = estimateBackground(rgb, width, height);
  const local = o.region ? estimateBackground(rgb, width, height, region) : whole;
  const { color: background, noise: borderNoise } = local.noise < whole.noise ? local : whole;

  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      mask[p] = o.subjectMask ? (o.subjectMask[p] >= 0.5 ? 1 : 0) : dist(rgb, p * 3, background) > o.tolerance ? 1 : 0;
    }
  }

  // Axes and gridlines.
  const lines = findStraightLines(mask, width, height, region);
  let graphLikely = false;
  if (linesCross(lines)) {
    // A graph has something besides its axes and grid (a curve, bars). A letter T or E doesn't.
    const without = mask.slice();
    eraseLines(without, width, height, region, lines);
    const longest = lines.reduce((m, l) => Math.max(m, (l.end - l.start + 1) * (l.to - l.from + 1)), 0);
    graphLikely = countOnes(without) >= longest * 0.5;
  }
  const remove = o.removeLines === 'auto' || o.removeLines === undefined ? graphLikely : o.removeLines;
  const linesRemoved = remove && lines.length > 0;
  if (linesRemoved) eraseLines(mask, width, height, region, lines);

  // Clutter: tiny specks always go; otherwise drop pieces much smaller than the main one.
  const { labels, components } = labelComponents(mask, width, height);
  const largest = components.reduce((m, c) => Math.max(m, c.area), 0);
  const minArea = Math.max(2, largest * o.minPieceRatio);
  const keep = components.map((c) => c.area >= minArea);

  let sx0 = width,
    sy0 = height,
    sx1 = -1,
    sy1 = -1;
  for (let p = 0; p < mask.length; p++) {
    const l = labels[p];
    if (!l) continue;
    if (!keep[l - 1]) {
      mask[p] = 0;
      continue;
    }
    const x = p % width;
    const y = (p - x) / width;
    if (x < sx0) sx0 = x;
    if (x > sx1) sx1 = x;
    if (y < sy0) sy0 = y;
    if (y > sy1) sy1 = y;
  }
  return {
    width,
    height,
    region,
    background,
    borderNoise,
    mask,
    subject: sx1 < 0 ? null : { x: sx0, y: sy0, width: sx1 - sx0 + 1, height: sy1 - sy0 + 1 },
    removedPieces: keep.filter((k) => !k).length,
    lines,
    graphLikely,
    linesRemoved,
    strokeWidth: strokeWidth(mask, width, height),
  };
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

/** The subject box plus an optional margin (share of its larger side), kept inside the image. No margin by default: on a 40-pin grid every row counts. */
export function smartCrop(fg: Foreground, margin = 0): Rect {
  if (!fg.subject) return fg.region;
  const s = fg.subject;
  const m = Math.round(Math.max(s.width, s.height) * margin);
  const x0 = Math.max(0, s.x - m);
  const y0 = Math.max(0, s.y - m);
  const x1 = Math.min(fg.width, s.x + s.width + m);
  const y1 = Math.min(fg.height, s.y + s.height + m);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

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

/** Grows every content pixel into a (2rx+1) x (2ry+1) block. Separable, O(pixels). */
export function dilate(mask: Uint8Array, width: number, height: number, rx: number, ry: number): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean, r: number) => {
    if (r <= 0) return src;
    const out = new Uint8Array(src.length);
    const lines = horizontal ? height : width;
    const len = horizontal ? width : height;
    const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
    for (let line = 0; line < lines; line++) {
      // Running count of content pixels in the window [i - r, i + r].
      let count = 0;
      for (let i = 0; i < Math.min(r, len); i++) count += src[at(line, i)];
      for (let i = 0; i < len; i++) {
        if (i + r < len) count += src[at(line, i + r)];
        if (i - r - 1 >= 0) count -= src[at(line, i - r - 1)];
        out[at(line, i)] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, true, Math.round(rx)), false, Math.round(ry));
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
  if (stroke <= 0 || stroke >= 0.25 * Math.min(cell.w, cell.h)) return mask;
  const rx = Math.max(0, 0.25 * cell.w - stroke / 2);
  const ry = Math.max(0, 0.25 * cell.h - stroke / 2);
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

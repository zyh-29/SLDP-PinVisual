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
 * Steps 6 and 7 are in pinSampling.ts; mask helpers in masks.ts, rectangles in geometry.ts.
 */
import type { RasterImage } from './convert';
import { bounds, fullRect, type Rect, type Rgb } from './geometry';
import { evenLight } from './lighting';
import { type Component, dilate, labelComponents } from './masks';
import { refineSubject } from './refineMask';
import { median } from './stats';

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
  /** The colour tolerance that was used (chosen automatically when the option was 'auto'). */
  tolerance: number;
  /** The GrabCut-style refinement was used (see ForegroundOptions.refine). */
  refined: boolean;
}

export interface ForegroundOptions {
  /**
   * Colour distance (0..441) above which a pixel is content, or 'auto' to
   * choose it from the image (see autoTolerance).
   */
  tolerance: number | 'auto';
  /** Drop pieces smaller than this share of the biggest piece. 0 keeps everything. */
  minPieceRatio: number;
  /** Only this part of the image is analysed. Defaults to the whole image. */
  region?: Rect;
  /** Remove axes and gridlines: always, never, or when the image looks like a graph. */
  removeLines?: boolean | 'auto';
  /** Subject probability 0..1 per pixel from Smart Cut-Out. Replaces the colour test when given. */
  subjectMask?: Float32Array;
  /**
   * Other areas whose edge may show the background (e.g. the card the auto
   * crop found, when the user then drags a tighter box). Tried after
   * `region`'s own edge and before the whole image's edge.
   */
  backgroundRegions?: Rect[];
  /**
   * A camera picture: the background may have several colours (a checked cloth, a two-tone desk) and shadows.
   * Each pixel is then also compared with the main colours along the edge, allowing for shading, and anything
   * close to one of them is background too (see edgePalette).
   */
  camera?: boolean;
  /**
   * Refine a filled subject's mask GrabCut-style (refineMask.ts): colour models of the subject and of the whole
   * background instead of the edge colours alone, and neighbours decided together. Skipped for graphs and thin
   * line drawings, which keep the pixel-by-pixel mask.
   */
  refine?: boolean;
  /**
   * Where the subject is, when already known (the smart crop's pick): the refinement treats everything well
   * outside it as background, so other objects and leftovers in the picture go too.
   */
  subjectBox?: Rect;
}

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


const dist = (rgb: ArrayLike<number>, i: number, c: Rgb) => Math.hypot(rgb[i] - c.r, rgb[i + 1] - c.g, rgb[i + 2] - c.b);

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
  // An empty ring (a region too small to have one) counts as white paper.
  const color = { r: median(rs, 255), g: median(gs, 255), b: median(bs, 255) };
  let noise = 0;
  for (const i of idx) noise += dist(rgb, i, color);
  return { color, noise: idx.length ? noise / idx.length : 0 };
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

/** Colour distance below which a pixel counts as part of a removed line (same grey as the axis). */
const LINE_COLOUR_MATCH = 70;

/**
 * Removes axes and gridlines without cutting what crosses them:
 *  1. Each line is erased only where a pixel has the line's own colour, so a
 *     red curve crossing a grey axis survives.
 *  2. Gaps are then repaired: where a stroke continues on both sides of a
 *     removed line (e.g. a black pen curve crossing a black axis), the gap is
 *     filled back in.
 */
function eraseLines(mask: Uint8Array, rgb: ArrayLike<number>, width: number, height: number, region: Rect, lines: StraightLine[]) {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const at = (l: StraightLine, across: number, along: number) => (l.orientation === 'h' ? across * width + along : along * width + across);
  const acrossLimit = (l: StraightLine) => (l.orientation === 'h' ? [y0, y1] : [x0, x1]);
  const alongLimit = (l: StraightLine) => (l.orientation === 'h' ? [x0, x1] : [y0, y1]);

  // The colours of each line: the median colour of every row/column in its band. An anti-aliased line is a dark
  // core with lighter edge rows; sampling only one row (e.g. the light edge) would leave the dark core behind.
  const colours = lines.map((l) => {
    const out: Rgb[] = [];
    for (let a = l.from; a <= l.to; a++) {
      const rs: number[] = [];
      const gs: number[] = [];
      const bs: number[] = [];
      for (let i = l.start; i <= l.end; i++) {
        const p = at(l, a, i);
        if (!mask[p]) continue;
        rs.push(rgb[p * 3]);
        gs.push(rgb[p * 3 + 1]);
        bs.push(rgb[p * 3 + 2]);
      }
      if (rs.length) out.push({ r: median(rs), g: median(gs), b: median(bs) });
    }
    return out;
  });

  const erased = new Uint8Array(mask.length);
  lines.forEach((l, k) => {
    const [a0, a1] = acrossLimit(l);
    const [l0, l1] = alongLimit(l);
    // One extra pixel each side catches anti-aliasing halos.
    for (let a = Math.max(a0, l.from - 1); a <= Math.min(a1 - 1, l.to + 1); a++)
      for (let i = l0; i < l1; i++) {
        const p = at(l, a, i);
        if (mask[p] && colours[k].some((c) => dist(rgb, p * 3, c) < LINE_COLOUR_MATCH)) {
          mask[p] = 0;
          erased[p] = 1;
        }
      }
  });

  // Repair: fill an erased gap where content continues just beyond both sides of the line.
  for (const l of lines) {
    const [a0, a1] = acrossLimit(l);
    const [l0, l1] = alongLimit(l);
    const before = l.from - 2;
    const after = l.to + 2;
    if (before < a0 || after >= a1) continue;
    const near = (a: number, i: number) => {
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j >= l0 && j < l1 && mask[at(l, a, j)]) return true;
      }
      return false;
    };
    for (let i = l0; i < l1; i++) {
      if (!near(before, i) || !near(after, i)) continue;
      for (let a = l.from - 1; a <= l.to + 1; a++) {
        const p = at(l, a, i);
        if (erased[p]) mask[p] = 1;
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

/**
 * The background as a function of position: one colour, or a smooth
 * gradient (a plane per channel) when that explains the edge much better,
 * e.g. lighting falloff on paper or a gradient wallpaper.
 */
export interface BackgroundModel {
  kind: 'flat' | 'gradient';
  /** Median edge colour (the flat model). */
  color: Rgb;
  /** Mean colour distance of the edge pixels from the model. */
  noise: number;
  /** Per channel: value = c0 + cx * x + cy * y. */
  plane: { r: [number, number, number]; g: [number, number, number]; b: [number, number, number] };
}

function ringPixels(width: number, height: number, region: Rect): number[] {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const ring = Math.max(1, Math.round(Math.min(x1 - x0, y1 - y0) * 0.02));
  const out: number[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (x >= x0 + ring && x < x1 - ring && y >= y0 + ring && y < y1 - ring) {
        x = x1 - ring - 1;
        continue;
      }
      out.push(y * width + x);
    }
  return out;
}

/**
 * The background's main colours along `region`'s edge (camera pictures): up to three, by k-means on a sample of
 * the edge ring, each kept only if it covers at least 12% of the edge. A checked cloth gives two, a plain desk one.
 */
export function edgePalette(rgb: ArrayLike<number>, width: number, height: number, region: Rect): Rgb[] {
  const ring = ringPixels(width, height, region);
  if (ring.length < 30) return [];
  const step = Math.max(1, Math.floor(ring.length / 2000));
  const px: Rgb[] = [];
  for (let i = 0; i < ring.length; i += step) {
    const p = ring[i];
    px.push({ r: rgb[p * 3], g: rgb[p * 3 + 1], b: rgb[p * 3 + 2] });
  }
  // Squared distances throughout (only comparisons are needed), with plain loops: this runs on every camera frame.
  const d2 = (a: Rgb, b: Rgb) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
  // Start from the median colour, then each next centre is the sample farthest from the centres so far.
  const centres: Rgb[] = [{ r: median(px.map((c) => c.r)), g: median(px.map((c) => c.g)), b: median(px.map((c) => c.b)) }];
  while (centres.length < 3) {
    let far = px[0];
    let fd = -1;
    for (const c of px) {
      let m = Infinity;
      for (const k of centres) {
        const v = d2(c, k);
        if (v < m) m = v;
      }
      if (m > fd) {
        fd = m;
        far = c;
      }
    }
    if (fd < 30 * 30) break;
    centres.push({ ...far });
  }
  let counts: number[] = [];
  for (let it = 0; it < 8; it++) {
    const sums = centres.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const c of px) {
      let bi = 0;
      let bd = d2(c, centres[0]);
      for (let k = 1; k < centres.length; k++) {
        const v = d2(c, centres[k]);
        if (v < bd) {
          bd = v;
          bi = k;
        }
      }
      const sm = sums[bi];
      sm.r += c.r;
      sm.g += c.g;
      sm.b += c.b;
      sm.n++;
    }
    sums.forEach((sm, k) => {
      if (sm.n) centres[k] = { r: sm.r / sm.n, g: sm.g / sm.n, b: sm.b / sm.n };
    });
    counts = sums.map((sm) => sm.n);
  }
  return centres.filter((_, k) => counts[k] >= px.length * 0.12);
}

/**
 * Distance from the nearest background colour, allowing for a little unevenness of the light (SHADE_MIN..SHADE_MAX
 * of its brightness). Not on dark backgrounds, where "shaded" would also swallow a black object.
 *
 * Only a little: anything from 40% darker counted as background once, which took shadows away but also every light
 * grey object on a white table. Deeper shadows are now told from objects by their soft edge (removeShadows).
 */
const SHADE_MIN = 0.96;
const SHADE_MAX = 1.04;

export function paletteDistance(r: number, g: number, b: number, palette: Rgb[]): number {
  return Math.sqrt(paletteDistance2(palette)(r, g, b));
}

/**
 * paletteDistance, squared, as a function made once per palette: each colour's length and brightness are worked
 * out up front, and no square root is taken per colour. This runs on every pixel of every camera frame.
 */
export function paletteDistance2(palette: Rgb[]): (r: number, g: number, b: number) => number {
  const n = palette.length;
  const pr = new Float64Array(n);
  const pg = new Float64Array(n);
  const pb = new Float64Array(n);
  /** 1 / |colour|^2. */
  const inv = new Float64Array(n);
  /** Shading allowed (bright background colours only). */
  const shade = new Uint8Array(n);
  palette.forEach((c, k) => {
    pr[k] = c.r;
    pg[k] = c.g;
    pb[k] = c.b;
    inv[k] = 1 / (c.r * c.r + c.g * c.g + c.b * c.b || 1);
    shade[k] = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 100 ? 1 : 0;
  });
  return (r, g, b) => {
    let best = Infinity;
    for (let k = 0; k < n; k++) {
      let s = 1;
      if (shade[k]) {
        s = (r * pr[k] + g * pg[k] + b * pb[k]) * inv[k];
        if (s < SHADE_MIN) s = SHADE_MIN;
        else if (s > SHADE_MAX) s = SHADE_MAX;
      }
      const dr = r - s * pr[k];
      const dg = g - s * pg[k];
      const db = b - s * pb[k];
      const d = dr * dr + dg * dg + db * db;
      if (d < best) best = d;
    }
    return best;
  };
}

/** Mean distance of the edge ring's pixels from the background (the plane or the nearest palette colour). */
function paletteNoise(rgb: ArrayLike<number>, width: number, height: number, region: Rect, palette: Rgb[], model: BackgroundModel): number {
  const ring = ringPixels(width, height, region);
  if (!ring.length) return model.noise;
  let sum = 0;
  const pd2 = paletteDistance2(palette);
  for (const p of ring) sum += Math.min(residual(rgb, p, width, model.plane), Math.sqrt(pd2(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2])));
  return sum / ring.length;
}

/** Least-squares plane v = c0 + cx*x + cy*y through the given samples (3x3 normal equations). */
function fitPlane(xs: number[], ys: number[], vs: number[]): [number, number, number] {
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0,
    sv = 0,
    sxv = 0,
    syv = 0;
  for (let i = 0; i < vs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    const v = vs[i];
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sv += v;
    sxv += x * v;
    syv += y * v;
  }
  // Solve [[n,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]] * [c0,cx,cy] = [sv,sxv,syv] (Cramer's rule).
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const m = [
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ];
  const d = det(m);
  if (Math.abs(d) < 1e-9) return [n ? sv / n : 255, 0, 0];
  const rhs = [sv, sxv, syv];
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

export function backgroundModel(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect = fullRect(width, height),
): BackgroundModel {
  const idx = ringPixels(width, height, region);
  const { color, noise } = estimateBackground(rgb, width, height, region);
  const flatPlane = {
    r: [color.r, 0, 0] as [number, number, number],
    g: [color.g, 0, 0] as [number, number, number],
    b: [color.b, 0, 0] as [number, number, number],
  };
  const flat: BackgroundModel = { kind: 'flat', color, noise, plane: flatPlane };
  if (noise < 6 || idx.length < 12) return flat;
  // Robust gradient fit: fit, drop the worst-fitting edge pixels (clutter on the edge), fit again.
  let use = idx;
  let plane = flatPlane;
  for (let pass = 0; pass < 2; pass++) {
    const xs = use.map((p) => p % width);
    const ys = use.map((p) => Math.floor(p / width));
    plane = {
      r: fitPlane(
        xs,
        ys,
        use.map((p) => rgb[p * 3]),
      ),
      g: fitPlane(
        xs,
        ys,
        use.map((p) => rgb[p * 3 + 1]),
      ),
      b: fitPlane(
        xs,
        ys,
        use.map((p) => rgb[p * 3 + 2]),
      ),
    };
    const resid = use.map((p) => residual(rgb, p, width, plane));
    const cut = median(resid) * 2 + 2;
    use = use.filter((_, i) => resid[i] <= cut);
  }
  const gradNoise = idx.reduce((s, p) => s + residual(rgb, p, width, plane), 0) / idx.length;
  return gradNoise < noise * 0.6 ? { kind: 'gradient', color, noise: gradNoise, plane } : flat;
}

function residual(rgb: ArrayLike<number>, p: number, width: number, plane: BackgroundModel['plane']): number {
  const x = p % width;
  const y = (p - x) / width;
  const r = plane.r[0] + plane.r[1] * x + plane.r[2] * y;
  const g = plane.g[0] + plane.g[1] * x + plane.g[2] * y;
  const b = plane.b[0] + plane.b[1] * x + plane.b[2] * y;
  return Math.hypot(rgb[p * 3] - r, rgb[p * 3 + 1] - g, rgb[p * 3 + 2] - b);
}

/**
 * Automatic tolerance never goes below AUTO_MIN (faint gridlines, JPEG fringes and anti-aliasing stay background)
 * nor above AUTO_MAX (pale fills such as a light yellow triangle on white must survive).
 */
export const AUTO_MIN = 24;
export const AUTO_MAX = 90;

/**
 * Picks the colour tolerance from the image itself:
 *  1. Histogram of every pixel's colour distance from the background model.
 *     The background is one dominant peak near 0; the subject is a long tail.
 *  2. Triangle method (Zack et al. 1977; OpenCV THRESH_TRIANGLE, ImageJ,
 *     scikit-image): a line from the peak to the far end of the tail, cut
 *     where the histogram falls furthest below it, i.e. where the background
 *     peak ends. Unlike Otsu it is not pulled towards a small far-away
 *     cluster (black text), so pale fills next to the background survive.
 *  3. Never below the noise floor: 2.5 x the background edge's own spread
 *     plus a margin (paper grain, lighting), and kept within AUTO_MIN..AUTO_MAX.
 */
export function autoTolerance(distances: Float32Array, edgeNoise: number): number {
  const floor = Math.max(AUTO_MIN, 2.5 * edgeNoise + 8);
  const BINS = 442; // one per unit of colour distance, 0..441
  const hist = new Float64Array(BINS);
  for (let i = 0; i < distances.length; i++) {
    const t = (distances[i] + 0.5) | 0;
    hist[t < BINS ? t : BINS - 1]++;
  }
  let peak = 0;
  for (let t = 1; t < BINS; t++) if (hist[t] > hist[peak]) peak = t;
  let end = BINS - 1;
  while (end > peak && hist[end] === 0) end--;
  if (end - peak < 2) return Math.round(Math.min(AUTO_MAX, floor));
  // Distance of (t, hist[t]) below the line from (peak, hist[peak]) to (end, 0); the scale doesn't matter, only the argmax.
  const dx = end - peak;
  const dy = -hist[peak];
  let cut = peak;
  let best = -Infinity;
  for (let t = peak + 1; t < end; t++) {
    const below = dx * (hist[t] - hist[peak]) - dy * (t - peak); // < 0 when the histogram is under the line
    if (-below > best) {
      best = -below;
      cut = t;
    }
  }
  return Math.round(Math.min(AUTO_MAX, Math.max(floor, cut + 1)));
}

/** What findForeground learns about the background, and every pixel's distance from it (row by row in `region`). */
interface BackgroundDistances {
  background: Rgb;
  borderNoise: number;
  distances: Float32Array;
  /** The background as a function of position (one colour or a gradient), and its main colours (camera). */
  plane: BackgroundModel['plane'];
  palette: Rgb[];
}

/**
 * The same frame is often analysed twice with the same settings (the smart crop picks the subject on the whole
 * picture, then the pins are made from the same picture): the background and the distances are kept per picture
 * (the pixel array; a new frame is a new array, and old ones are let go) and settings.
 */
const distanceCache = new WeakMap<object, Map<string, BackgroundDistances>>();

function backgroundDistances(rgb: ArrayLike<number>, width: number, height: number, region: Rect, o: ForegroundOptions): BackgroundDistances {
  const key = JSON.stringify([width, height, region, o.region ? 1 : 0, o.backgroundRegions ?? null, !!o.camera, !!o.subjectMask]);
  const holder = typeof rgb === 'object' ? (rgb as object) : null;
  const cached = holder ? distanceCache.get(holder)?.get(key) : undefined;
  if (cached) return cached;
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  // Background. Candidates in order of preference: the region's own edge (a crop usually frames the
  // background), any hinted areas, then the whole image's edge. The first one that is not clearly messier
  // than the best wins (a tight crop whose edge runs through the subject loses).
  const tried = [...(o.region ? [region] : []), ...(o.backgroundRegions ?? []), fullRect(width, height)];
  const candidates = tried.map((r) => backgroundModel(rgb, width, height, r));
  const best = Math.min(...candidates.map((c) => c.noise));
  const chosen = candidates.findIndex((c) => c.noise <= Math.max(best * 1.5, best + 8));
  const model = candidates[chosen];
  // Camera: the main colours along the same edge, for several-coloured backgrounds and shadows.
  const palette = o.camera ? edgePalette(rgb, width, height, tried[chosen]) : [];
  const background = model.color;
  // With a palette, the edge's spread is measured against it: a two-colour cloth is not "noisy", it is two colours.
  const borderNoise = palette.length ? paletteNoise(rgb, width, height, tried[chosen], palette, model) : model.noise;
  const P = model.plane;

  // Distance of every pixel from the background model, then the cut-off (fixed, or chosen from these distances).
  // Squared distances, one square root per pixel: this loop runs over every pixel of every live frame.
  const distances = new Float32Array((x1 - x0) * (y1 - y0));
  const pd2 = palette.length ? paletteDistance2(palette) : null;
  if (!o.subjectMask)
    for (let y = y0, i = 0; y < y1; y++) {
      // The background plane along this row: value at x0, then a fixed step per pixel.
      let er = P.r[0] + P.r[1] * x0 + P.r[2] * y;
      let eg = P.g[0] + P.g[1] * x0 + P.g[2] * y;
      let eb = P.b[0] + P.b[1] * x0 + P.b[2] * y;
      for (let x = x0, q = (y * width + x0) * 3; x < x1; x++, i++, q += 3) {
        const r = rgb[q];
        const g = rgb[q + 1];
        const b = rgb[q + 2];
        const dr = r - er;
        const dg = g - eg;
        const db = b - eb;
        let d = dr * dr + dg * dg + db * db;
        if (pd2) {
          const dp = pd2(r, g, b);
          if (dp < d) d = dp;
        }
        distances[i] = Math.sqrt(d);
        er += P.r[1];
        eg += P.g[1];
        eb += P.b[1];
      }
    }
  const out = { background, borderNoise, distances, plane: P, palette };
  if (holder) {
    let m = distanceCache.get(holder);
    if (!m) distanceCache.set(holder, (m = new Map()));
    m.set(key, out);
  }
  return out;
}

/**
 * `picture` comes from `toRgb` (3 bytes per pixel). A camera picture has its light evened out first (lighting.ts):
 * vignetting, a lamp's pool of light or a window's falloff would otherwise make plain paper look like subject.
 */
export function findForeground(picture: ArrayLike<number>, width: number, height: number, o: ForegroundOptions): Foreground {
  const rgb = o.camera ? evenLight(picture, width, height) : picture;
  const region = o.region ?? fullRect(width, height);
  const { x0, y0, x1, y1 } = bounds(region, width, height);

  const { background, borderNoise, distances, plane, palette } = backgroundDistances(rgb, width, height, region, o);
  const tolerance = o.tolerance === 'auto' ? autoTolerance(distances, borderNoise) : o.tolerance;
  const mask = new Uint8Array(width * height);
  for (let y = y0, i = 0; y < y1; y++)
    for (let x = x0; x < x1; x++, i++) {
      const p = y * width + x;
      mask[p] = o.subjectMask ? (o.subjectMask[p] >= 0.5 ? 1 : 0) : distances[i] > tolerance ? 1 : 0;
    }

  // Axes and gridlines.
  const lines = findStraightLines(mask, width, height, region);
  let graphLikely = false;
  if (linesCross(lines)) {
    // A graph has something besides its axes and grid (a curve, bars). A letter T or E doesn't.
    const without = mask.slice();
    eraseLines(without, rgb, width, height, region, lines);
    const longest = lines.reduce((m, l) => Math.max(m, (l.end - l.start + 1) * (l.to - l.from + 1)), 0);
    graphLikely = countOnes(without) >= longest * 0.5;
  }
  const remove = o.removeLines === 'auto' || o.removeLines === undefined ? graphLikely : o.removeLines;
  const linesRemoved = remove && lines.length > 0;
  if (linesRemoved) eraseLines(mask, rgb, width, height, region, lines);
  // Shadows the subject casts on the background (not on graphs: a curve is never a shadow).
  const shadows = !o.subjectMask && !graphLikely && !linesRemoved ? removeShadows(mask, rgb, width, height, region, plane, palette) : null;
  // Screens and drawings: background whose colour drifts (a gradient wallpaper around a window, the window's own
  // shadow, a soft backdrop behind a product picture), which one colour or a two-colour gradient can't describe.
  const flatPicture = !o.camera && !o.subjectMask && !graphLikely && !linesRemoved;
  const drift = flatPicture ? removeDriftingBackground(mask, rgb, width, height, region) : null;
  // A photo wallpaper around the windows: textured, where windows and pages are flat. After the drifting
  // background: it also takes a window's outermost pixels (their neighbourhood is half wallpaper), and the drift
  // would spread from there into the window's flat inside.
  const wallpaper = flatPicture ? removeTexturedSurround(mask, rgb, width, height, region) : null;
  const drifting = wallpaper && drift ? orMasks(wallpaper, drift) : (wallpaper ?? drift);
  const sureBackground = drifting && shadows ? orMasks(drifting, shadows) : (drifting ?? shadows);

  // Clutter: tiny specks always go; otherwise drop pieces much smaller than the main one. On a screen, something cut
  // off by the edge isn't the main one (see keepMainPieces).
  const pieces = { minPieceRatio: o.minPieceRatio, ignoreCutOff: flatPicture };
  let { subject, removed } = keepMainPieces(mask, rgb, width, height, pieces);
  // A filled subject (not a graph, not a line drawing): the GrabCut-style second opinion, then clutter again.
  let refined = false;
  if (o.refine && !o.subjectMask && !linesRemoved && !graphLikely && subject && filled(mask, width, height)) {
    const better = refineSubject(rgb, width, height, mask, region, o.subjectBox, sureBackground ?? undefined);
    if (better) {
      mask.set(better);
      ({ subject, removed } = keepMainPieces(mask, rgb, width, height, pieces));
      refined = true;
    }
  }
  return {
    width,
    height,
    region,
    background,
    borderNoise,
    mask,
    subject,
    removedPieces: removed,
    refined,
    lines,
    graphLikely,
    linesRemoved,
    strokeWidth: strokeWidth(mask, width, height),
    tolerance,
  };
}

/**
 * Colour change between neighbouring pixels (the largest of the three channels) that background drifting across
 * the picture stays under. A gradient wallpaper changes by about 1 per pixel, a window's soft shadow by 2-3; a
 * drawn edge jumps by more, even a faint or anti-aliased one.
 */
const DRIFT_STEP = 4;
/** Fewer subject pixels than this share left: the subject itself is a soft blur, and nothing is removed. */
const DRIFT_KEEP_AT_LEAST = 0.01;

function orMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
  return out;
}

/**
 * Removes background whose colour drifts from the mask (in place), for flat pictures (screens, drawings): the
 * background is spread into the mask, pixel by pixel, wherever the colour changes only a little from one pixel to
 * the next (DRIFT_STEP). A gradient wallpaper of any number of colours is swallowed, and so are soft shadows; the
 * sharp edge of a window, a card or a drawn shape stops it. Returns the pixels removed, or null when none were.
 *
 * Not for camera pictures: their noise makes every step look big, and a real background is handled there by its
 * colours along the edge (edgePalette) and its shadows (removeShadows).
 */
function removeDriftingBackground(mask: Uint8Array, rgb: ArrayLike<number>, width: number, height: number, region: Rect): Uint8Array | null {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 || h < 3) return null;
  // Colour change between two neighbours (region-local indices): the largest of the three channels. Raw pixels: a
  // screen has no noise to average away, and averaging would blur a sharp tip or a thin line into the background.
  const step = (a: number, b: number) => {
    const ax = a % w;
    const bx = b % w;
    const p = ((y0 + (a - ax) / w) * width + x0 + ax) * 3;
    const q = ((y0 + (b - bx) / w) * width + x0 + bx) * 3;
    return Math.max(Math.abs(rgb[p] - rgb[q]), Math.abs(rgb[p + 1] - rgb[q + 1]), Math.abs(rgb[p + 2] - rgb[q + 2]));
  };

  // Spread from the background (region-local indices) into the mask.
  const taken = new Uint8Array(w * h);
  // Each pixel is queued at most once: first as outer background, or later as taken.
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  let inMask = 0;
  const inM = (x: number, y: number) => mask[(y0 + y) * width + x0 + x] === 1;
  const neighbours = (i: number, visit: (j: number, x: number, y: number) => void) => {
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) visit(i - 1, x - 1, y);
    if (x < w - 1) visit(i + 1, x + 1, y);
    if (y > 0) visit(i - w, x, y - 1);
    if (y < h - 1) visit(i + w, x, y + 1);
  };
  // Only the outer background spreads: what is reached from the region's edge without crossing the subject. A
  // patch inside the subject that happens to match the background (the blurry backdrop of a photo on a web page)
  // is not a start: spreading from it would eat the photo, whose own colours drift too.
  const outer = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inM(x, y)) inMask++;
      else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        outer[y * w + x] = 1;
        queue[tail++] = y * w + x;
      }
    }
  if (!inMask || tail === 0) return null;
  while (head < tail)
    neighbours(queue[head++], (j, x, y) => {
      if (outer[j] || inM(x, y)) return;
      outer[j] = 1;
      queue[tail++] = j;
    });
  // Then into the mask, across small steps.
  let count = 0;
  head = 0;
  while (head < tail) {
    const i = queue[head++];
    neighbours(i, (j, x, y) => {
      if (taken[j] || !inM(x, y) || step(i, j) > DRIFT_STEP) return;
      taken[j] = 1;
      queue[tail++] = j;
      count++;
    });
  }
  if (!count || inMask - count < inMask * DRIFT_KEEP_AT_LEAST) return null;
  const removed = new Uint8Array(width * height);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (taken[y * w + x]) {
        const p = (y0 + y) * width + x0 + x;
        mask[p] = 0;
        removed[p] = 1;
      }
  return removed;
}

/** Neighbouring pixels differing by more than this (any channel) are texture; a screen's flat areas repeat exactly. */
const TEXTURE_STEP = 2;
/** Share of textured pixels around a pixel (7 x 7) from which it counts as part of a photo. */
const TEXTURE_DENSITY = 0.5;
/** Texture joined to the edge over more than this share of the region: the picture itself is a photo (full screen). */
const SURROUND_MOST = 0.9;

/**
 * Removes a photo wallpaper from the mask (in place), for flat pictures (screens): textured areas joined to the
 * region's edge. Windows, pages and menus are flat (runs of identical pixels); a photo has texture almost
 * everywhere. A window's flat frame stops the spread, so a photo inside a window stays. Returns the pixels removed,
 * or null when none were (or when the texture covers nearly the whole region: then the picture is the photo).
 */
function removeTexturedSurround(mask: Uint8Array, rgb: ArrayLike<number>, width: number, height: number, region: Rect): Uint8Array | null {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 16 || h < 16) return null;
  // Textured pixels: different from the pixel to the right or below. Counted in 7 x 7 boxes (an integral image).
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const p = ((y0 + y) * width + x0 + x) * 3;
      const right = x < w - 1 ? p + 3 : p;
      const below = y < h - 1 ? p + width * 3 : p;
      let busy = 0;
      for (let c = 0; c < 3; c++)
        if (Math.abs(rgb[p + c] - rgb[right + c]) > TEXTURE_STEP || Math.abs(rgb[p + c] - rgb[below + c]) > TEXTURE_STEP) busy = 1;
      row += busy;
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
    }
  }
  const R = 3;
  const textured = (x: number, y: number) => {
    const ax = Math.max(0, x - R);
    const ay = Math.max(0, y - R);
    const bx = Math.min(w, x + R + 1);
    const by = Math.min(h, y + R + 1);
    const n = sum[by * (w + 1) + bx] - sum[ay * (w + 1) + bx] - sum[by * (w + 1) + ax] + sum[ay * (w + 1) + ax];
    return n >= (bx - ax) * (by - ay) * TEXTURE_DENSITY;
  };
  // Spread from the region's edge through textured pixels.
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (seen[i] || !textured(x, y)) return;
    seen[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  let taken = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (mask[(y0 + y) * width + x0 + x] && seen[y * w + x]) taken++;
  // Texture over nearly the whole region: the picture is a photo (shared full screen), not a desktop around one.
  if (!taken || tail > w * h * SURROUND_MOST) return null;
  const removed = new Uint8Array(width * height);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y0 + y) * width + x0 + x;
      if (mask[p] && seen[y * w + x]) {
        mask[p] = 0;
        removed[p] = 1;
      }
    }
  return removed;
}

/** A shadow is the background colour darkened to at least this share of its brightness (deeper is an object). */
const SHADOW_DEEPEST = 0.4;
/** ...and at most this share (lighter is the background itself, give or take the light). */
const SHADOW_LIGHTEST = 0.98;
/**
 * A hard shadow (a lamp, the sun: a sharp edge) is at most this share of the background's brightness. Lighter
 * grey is left alone even when sharp-edged and next to the subject: a light grey thing, not a shadow.
 */
const HARD_SHADOW_LIGHTEST = 0.8;
/** Brightness change per pixel (3 x 3 averaged) a shadow's fading edge stays under. A drawn or real edge jumps more. */
const SHADOW_STEP = 7;
/**
 * How far a shadow's colour may stray from a darker shade of the background (colour distance): a little, plus a
 * share of how much darker it is. Light bouncing off the subject tints its shadow (a red apple's is reddish), and
 * more so where the shadow is deep.
 */
const SHADOW_TINT = 18;
const SHADOW_TINT_PER_DEPTH = 0.08;
/**
 * Most a shadow's colour can be saturated ((max - min) / max of its channels). A shadow on a light surface is
 * nearly grey even when tinted (the apple's: 0.24); a coloured part of the subject is not (a muted green outline:
 * 0.42).
 */
const SHADOW_SATURATION = 0.3;

/**
 * Removes shadows from the mask (in place): what the subject casts on the background, and uneven light on it.
 * Returns the pixels removed (for the refinement to count as background for sure), or null when none were.
 *
 * A shadow is the background's own colour, only darker, and it fades into the background: its brightness changes
 * a little from pixel to pixel. An object can be the very same grey (a light grey mug on a white table) but it has
 * an edge: a jump in brightness. So the background is spread into the mask, pixel by pixel, through pixels that are
 * a darker shade of the background (SHADOW_DEEPEST..SHADOW_LIGHTEST of its brightness, about the same tint), and
 * only across small steps (SHADOW_STEP). A soft shadow is swallowed whole; an object's edge stops it.
 *
 * Hard shadows (a lamp, the sun) have a sharp edge too. They are told from objects by where they are: a shadow is
 * attached to what casts it. A clearly darker shade of the background (up to HARD_SHADOW_LIGHTEST of its
 * brightness) that touches both the background and another part of the subject (not a shade of the background)
 * is a shadow. A grey object on its own touches only the background, and stays. (A grey object right against a
 * coloured one would be taken for its shadow: rare, and the soft rule never does it.)
 *
 * Only on a light background (on a dark one there is no darker shade to speak of). If it would take nearly
 * everything, it gives up: the subject itself is a soft, grey blur, not a shadow.
 */
function removeShadows(
  mask: Uint8Array,
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect,
  plane: BackgroundModel['plane'],
  palette: Rgb[],
): Uint8Array | null {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 3 || rh < 3) return null;
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  // The background colours to compare with: the plane where the pixel is, and the edge palette (camera).
  const refAt = (x: number, y: number): Rgb => ({
    r: plane.r[0] + plane.r[1] * x + plane.r[2] * y,
    g: plane.g[0] + plane.g[1] * x + plane.g[2] * y,
    b: plane.b[0] + plane.b[1] * x + plane.b[2] * y,
  });
  const centre = refAt((x0 + x1) / 2, (y0 + y1) / 2);
  if (lum(centre.r, centre.g, centre.b) < 100) return null;

  // Brightness, averaged over 3 x 3 (camera noise would otherwise look like steps).
  const L = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const q = ((y0 + y) * width + x0 + x) * 3;
      L[y * rw + x] = lum(rgb[q], rgb[q + 1], rgb[q + 2]);
    }
  const S = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue;
          sum += L[yy * rw + xx];
          n++;
        }
      S[y * rw + x] = sum / n;
    }

  /** How dark a shade of a background colour the pixel is (its share of that colour's brightness), or 0 if none. */
  const shadeOf = (x: number, y: number) => {
    const q = (y * width + x) * 3;
    const r = rgb[q];
    const g = rgb[q + 1];
    const b = rgb[q + 2];
    const hi = Math.max(r, g, b);
    if (hi > 0 && (hi - Math.min(r, g, b)) / hi > SHADOW_SATURATION) return 0;
    let best = 0;
    for (const c of [refAt(x, y), ...palette]) {
      const len2 = c.r * c.r + c.g * c.g + c.b * c.b;
      if (lum(c.r, c.g, c.b) < 100 || !len2) continue;
      const k = (r * c.r + g * c.g + b * c.b) / len2;
      if (k < SHADOW_DEEPEST || k > SHADOW_LIGHTEST) continue;
      const depth = (1 - k) * Math.sqrt(len2);
      if (Math.hypot(r - k * c.r, g - k * c.g, b - k * c.b) <= SHADOW_TINT + SHADOW_TINT_PER_DEPTH * depth) best = Math.max(best, k);
    }
    return best;
  };
  const shade = (x: number, y: number) => shadeOf(x, y) > 0;

  // Spread from the background into the mask across small steps, through shades of the background.
  const taken = new Uint8Array(rw * rh);
  const stack: number[] = [];
  let inMask = 0;
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const p = (y0 + y) * width + x0 + x;
      if (!mask[p]) continue;
      inMask++;
      const i = y * rw + x;
      const bgNeighbour =
        (x > 0 && !mask[p - 1] && Math.abs(S[i] - S[i - 1]) <= SHADOW_STEP) ||
        (x < rw - 1 && !mask[p + 1] && Math.abs(S[i] - S[i + 1]) <= SHADOW_STEP) ||
        (y > 0 && !mask[p - width] && Math.abs(S[i] - S[i - rw]) <= SHADOW_STEP) ||
        (y < rh - 1 && !mask[p + width] && Math.abs(S[i] - S[i + rw]) <= SHADOW_STEP);
      if (bgNeighbour && shade(x0 + x, y0 + y)) {
        taken[i] = 1;
        stack.push(i);
      }
    }
  let count = stack.length;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % rw;
    const y = (i - x) / rw;
    const visit = (j: number, xx: number, yy: number) => {
      if (taken[j] || !mask[(y0 + yy) * width + x0 + xx] || Math.abs(S[i] - S[j]) > SHADOW_STEP || !shade(x0 + xx, y0 + yy)) return;
      taken[j] = 1;
      count++;
      stack.push(j);
    };
    if (x > 0) visit(i - 1, x - 1, y);
    if (x < rw - 1) visit(i + 1, x + 1, y);
    if (y > 0) visit(i - rw, x, y - 1);
    if (y < rh - 1) visit(i + rw, x, y + 1);
  }

  // Hard shadows: clearly darker shades, in pieces, each touching the background and the rest of the subject.
  const hard = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (taken[i] || !mask[(y0 + y) * width + x0 + x]) continue;
      const k = shadeOf(x0 + x, y0 + y);
      if (k > 0 && k <= HARD_SHADOW_LIGHTEST) hard[i] = 1;
    }
  const pieces = labelComponents(hard, rw, rh);
  const touchesBg = new Uint8Array(pieces.components.length);
  const touchesSubject = new Int32Array(pieces.components.length);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      const l = pieces.labels[i];
      if (!l) continue;
      const look = (j: number, xx: number, yy: number) => {
        if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) return;
        const inMaskNow = mask[(y0 + yy) * width + x0 + xx] && !taken[j];
        if (!inMaskNow) touchesBg[l - 1] = 1;
        else if (!hard[j]) touchesSubject[l - 1]++;
      };
      look(i - 1, x - 1, y);
      look(i + 1, x + 1, y);
      look(i - rw, x, y - 1);
      look(i + rw, x, y + 1);
    }
  pieces.components.forEach((c, k) => {
    if (!touchesBg[k] || touchesSubject[k] < 3) return;
    const { x: bx, y: by, width: bw, height: bh } = c.box;
    for (let y = by; y < by + bh; y++)
      for (let x = bx; x < bx + bw; x++) {
        const i = y * rw + x;
        if (pieces.labels[i] === k + 1 && !taken[i]) {
          taken[i] = 1;
          count++;
        }
      }
  });

  // Nearly everything: the subject is the soft grey thing, not a shadow of something.
  if (!count || count > 0.9 * inMask) return null;
  const removed = new Uint8Array(width * height);
  for (let i = 0; i < taken.length; i++)
    if (taken[i]) {
      const p = (y0 + ((i / rw) | 0)) * width + x0 + (i % rw);
      mask[p] = 0;
      removed[p] = 1;
    }
  return removed;
}

/** Below this typical stroke thickness (pixels, after closing small gaps) the subject is a line drawing: no refinement. */
const REFINE_MIN_STROKE = 5;

/**
 * Whether the mask is a filled subject rather than a line drawing: its stroke thickness once small gaps are
 * closed (grown by 2 pixels, then shrunk back). A speckled filled shape (camera noise on a pale subject) closes
 * into a solid area; a thin line stays thin.
 */
function filled(mask: Uint8Array, width: number, height: number): boolean {
  const grown = dilate(mask, width, height, 2, 2);
  const inverse = new Uint8Array(grown.length);
  for (let i = 0; i < grown.length; i++) inverse[i] = grown[i] ? 0 : 1;
  const shrunkInverse = dilate(inverse, width, height, 2, 2);
  const closed = new Uint8Array(grown.length);
  for (let i = 0; i < closed.length; i++) closed[i] = shrunkInverse[i] ? 0 : 1;
  return strokeWidth(closed, width, height) >= REFINE_MIN_STROKE;
}

/** The piece runs off the picture's edge: on a shared screen, part of another window (often PinVisual's own). */
export const cutOff = (b: Rect, width: number, height: number) =>
  b.x <= 1 || b.y <= 1 || b.x + b.width >= width - 1 || b.y + b.height >= height - 1;

/**
 * Drops clutter from `mask` (in place): tiny specks, pieces much smaller than the main one, and grey pieces next
 * to a coloured subject. Returns the box around what is left and how many pieces were dropped.
 *
 * `ignoreCutOff` (screens and screenshots): a piece cut off by the picture's edge isn't the main one when there
 * are whole pieces. Sharing the entire screen shows PinVisual's own big, bright preview at the side; measured
 * against it, the slide's thin outline would be dropped as clutter. Cut-off pieces themselves are still kept.
 */
function keepMainPieces(
  mask: Uint8Array,
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  o: { minPieceRatio: number; ignoreCutOff?: boolean },
) {
  const { minPieceRatio } = o;
  const { labels, components } = labelComponents(mask, width, height);
  const whole = o.ignoreCutOff ? components.map((c) => !cutOff(c.box, width, height)) : components.map(() => true);
  const judged = whole.some((w, i) => w && components[i].area >= 2) ? whole : components.map(() => true);
  const largest = components.reduce((m, c, i) => (judged[i] ? Math.max(m, c.area) : m), 0);
  const minArea = Math.max(2, largest * minPieceRatio);
  const keep = components.map((c) => c.area >= minArea);
  if (minPieceRatio > 0 && components.length > 1) dropNeutralClutter(rgb, labels, components, keep, judged);
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
  const subject: Rect | null = sx1 < 0 ? null : { x: sx0, y: sy0, width: sx1 - sx0 + 1, height: sy1 - sy0 + 1 };
  return { subject, removed: keep.filter((k) => !k).length };
}

/** max - min of the channels: 0 for grey/black/white, high for vivid colours. */
const saturation = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

/**
 * When the main subject is coloured (e.g. a red curve), smaller grey or black
 * pieces are almost always labels, tick numbers or axes leftovers: drop them.
 */
function dropNeutralClutter(rgb: ArrayLike<number>, labels: Int32Array, components: Component[], keep: boolean[], judged: boolean[]) {
  const sums = components.map(() => ({ r: 0, g: 0, b: 0 }));
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l) continue;
    const s = sums[l - 1];
    s.r += rgb[p * 3];
    s.g += rgb[p * 3 + 1];
    s.b += rgb[p * 3 + 2];
  }
  const mean = components.map((c, i) => ({ r: sums[i].r / c.area, g: sums[i].g / c.area, b: sums[i].b / c.area }));
  // The main piece: the largest of those judged by (see keepMainPieces).
  let main = judged.indexOf(true);
  components.forEach((c, i) => {
    if (judged[i] && c.area > components[main].area) main = i;
  });
  if (saturation(mean[main]) < 60) return;
  components.forEach((c, i) => {
    if (i !== main && keep[i] && saturation(mean[i]) < 30 && c.area < components[main].area * 0.5) keep[i] = false;
  });
}

/** The subject box plus an optional margin (share of its larger side), kept inside the image. No margin by default: on a grid of a few dozen pins every row counts. */
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

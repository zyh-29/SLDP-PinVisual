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
  /** The colour tolerance that was used (chosen automatically when the option was 'auto'). */
  tolerance: number;
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
  for (let i = 0; i < distances.length; i++) hist[Math.min(BINS - 1, Math.round(distances[i]))]++;
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

/** `rgb` comes from `toRgb` (3 bytes per pixel). */
export function findForeground(rgb: ArrayLike<number>, width: number, height: number, o: ForegroundOptions): Foreground {
  const region = o.region ?? fullRect(width, height);
  const { x0, y0, x1, y1 } = bounds(region, width, height);

  // Background. Candidates in order of preference: the region's own edge (a crop usually frames the
  // background), any hinted areas, then the whole image's edge. The first one that is not clearly messier
  // than the best wins (a tight crop whose edge runs through the subject loses).
  const candidates = [...(o.region ? [region] : []), ...(o.backgroundRegions ?? []), fullRect(width, height)].map((r) =>
    backgroundModel(rgb, width, height, r),
  );
  const best = Math.min(...candidates.map((c) => c.noise));
  const model = candidates.find((c) => c.noise <= Math.max(best * 1.5, best + 8))!;
  const background = model.color;
  const borderNoise = model.noise;
  const P = model.plane;

  // Distance of every pixel from the background model, then the cut-off (fixed, or chosen from these distances).
  const distances = new Float32Array((x1 - x0) * (y1 - y0));
  if (!o.subjectMask)
    for (let y = y0, i = 0; y < y1; y++)
      for (let x = x0; x < x1; x++, i++) {
        const p = y * width + x;
        const dr = rgb[p * 3] - (P.r[0] + P.r[1] * x + P.r[2] * y);
        const dg = rgb[p * 3 + 1] - (P.g[0] + P.g[1] * x + P.g[2] * y);
        const db = rgb[p * 3 + 2] - (P.b[0] + P.b[1] * x + P.b[2] * y);
        distances[i] = Math.hypot(dr, dg, db);
      }
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

  // Clutter: tiny specks always go; otherwise drop pieces much smaller than the main one.
  const { labels, components } = labelComponents(mask, width, height);
  const largest = components.reduce((m, c) => Math.max(m, c.area), 0);
  const minArea = Math.max(2, largest * o.minPieceRatio);
  const keep = components.map((c) => c.area >= minArea);
  if (o.minPieceRatio > 0 && components.length > 1) dropNeutralClutter(rgb, labels, components, keep);

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
    tolerance,
  };
}

/** max - min of the channels: 0 for grey/black/white, high for vivid colours. */
const saturation = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

/**
 * When the main subject is coloured (e.g. a red curve), smaller grey or black
 * pieces are almost always labels, tick numbers or axes leftovers: drop them.
 */
function dropNeutralClutter(rgb: ArrayLike<number>, labels: Int32Array, components: Component[], keep: boolean[]) {
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
  let main = 0;
  components.forEach((c, i) => {
    if (c.area > components[main].area) main = i;
  });
  if (saturation(mean[main]) < 60) return;
  components.forEach((c, i) => {
    if (i !== main && keep[i] && saturation(mean[i]) < 30 && c.area < components[main].area * 0.5) keep[i] = false;
  });
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

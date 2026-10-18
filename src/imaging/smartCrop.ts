/**
 * Smart crop: decides which part of an image or screen share should become
 * pins. Pure functions, unit tested.
 *
 * Criteria (in order):
 *  1. Kind of image. Screenshots, diagrams and clip art have large areas of
 *     perfectly flat colour; photos have almost none (camera noise, texture).
 *  2. Graphs (screenshots): coloured, long, thin strokes are curves, as in
 *     Desmos. Ignored: grey/black axes, gridlines and text, short icons, and
 *     filled buttons. The crop hugs the curves of the main colour(s).
 *  3. Shapes and objects: everything that differs from the (possibly
 *     gradient) background is a candidate. Each is scored by size, colour,
 *     closeness to the centre, not touching the edge, and not looking like a
 *     line of text. Nearby pieces of the same colour join the winner.
 *  4. Cards: if the winner is a filled panel (an image thumbnail, a white
 *     plot area), the search repeats inside it, so the crop lands on the
 *     shape on the card rather than the card.
 */
import { AUTO_MIN, dilate, findForeground, fullRect, labelComponents, type Rect, type Rgb } from './foreground';

export type SubjectKind = 'curves' | 'shape' | 'none';

export interface SmartCropResult {
  /** The tight box around what should become pins. */
  box: Rect;
  /**
   * For curves: exactly the pixels of the curves' colours (1 = curve), so the
   * subject is known without guessing the background.
   */
  mask?: Float32Array;
  /** The area around it whose edge shows the background (used to separate the subject from it). */
  context: Rect;
  kind: SubjectKind;
}

export interface SmartCropOptions {
  tolerance: number | 'auto';
  minPieceRatio: number;
  removeLines: boolean | 'auto';
}

const area = (r: Rect) => r.width * r.height;
const saturationOf = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function expand(r: Rect, by: number, width: number, height: number): Rect {
  const m = Math.round(Math.max(r.width, r.height) * by);
  const x = Math.max(0, r.x - m);
  const y = Math.max(0, r.y - m);
  return { x, y, width: Math.min(width, r.x + r.width + m) - x, height: Math.min(height, r.y + r.height + m) - y };
}

function inset(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, width: Math.max(1, r.width - 2 * by), height: Math.max(1, r.height - 2 * by) };
}

/**
 * Share of pixels whose right and lower neighbours have exactly (within 3)
 * the same colour. Screenshots and drawings: high (often > 0.6). Photos:
 * low (< 0.3). Sampled on every second pixel for speed.
 */
export function flatness(rgb: ArrayLike<number>, width: number, height: number, region: Rect = fullRect(width, height)): number {
  let flat = 0;
  let total = 0;
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width - 1, Math.ceil(region.x + region.width));
  const y1 = Math.min(height - 1, Math.ceil(region.y + region.height));
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      const p = (y * width + x) * 3;
      const r = p + 3;
      const d = p + width * 3;
      let max = 0;
      for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgb[p + c] - rgb[r + c]), Math.abs(rgb[p + c] - rgb[d + c]));
      if (max <= 3) flat++;
      total++;
    }
  return total ? flat / total : 0;
}

export function isPhotoLike(rgb: ArrayLike<number>, width: number, height: number, region?: Rect): boolean {
  return flatness(rgb, width, height, region) < 0.35;
}

/** Hue in degrees, 0..360. */
function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const HUE_BINS = 12;

/**
 * Coloured curves, as in a Desmos screenshot: per colour, the pieces that are
 * long (at least 12% of the region's short side) and thin (a few pixels).
 * Returns the box around the curves of the strongest colour(s), or null.
 */
export function findColouredCurves(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect = fullRect(width, height),
): Rect | null {
  return findCurves(rgb, width, height, region)?.box ?? null;
}

interface CurveResult {
  box: Rect;
  /** Exactly the pixels of the accepted curves (1 = curve). */
  mask: Float32Array;
}

/** Saturation a pixel needs to count towards a curve. Low enough for curves dimmed by screen-capture colour smearing. */
const CURVE_MIN_SATURATION = 35;

function findCurves(rgb: ArrayLike<number>, width: number, height: number, region: Rect): CurveResult | null {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  const shortSide = Math.min(x1 - x0, y1 - y0);
  const minLength = Math.max(12, shortSide * 0.12);
  const maxThickness = Math.max(4, shortSide * 0.02);

  // Coloured pixels, grouped by hue.
  const bins: Uint8Array[] = Array.from({ length: HUE_BINS }, () => new Uint8Array(width * height));
  const counts = new Array<number>(HUE_BINS).fill(0);
  let any = false;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      const r = rgb[p * 3];
      const g = rgb[p * 3 + 1];
      const b = rgb[p * 3 + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < CURVE_MIN_SATURATION || Math.max(r, g, b) < 60) continue;
      const k = Math.floor(hue(r, g, b) / (360 / HUE_BINS)) % HUE_BINS;
      bins[k][p] = 1;
      counts[k]++;
      any = true;
    }
  if (!any) return null;

  const results: { score: number; box: Rect; labels: Int32Array; bin: Uint8Array; accepted: Set<number> }[] = [];
  for (let binIndex = 0; binIndex < HUE_BINS; binIndex++) {
    // A colour with fewer pixels than one minimum-length curve can't hold a curve: skip the expensive part.
    if (counts[binIndex] < minLength) continue;
    const bin = bins[binIndex];
    // Join pieces up to ~4 px apart (thin steep curves fragment when a large screenshot is shrunk),
    // but measure size and thickness on the real pixels.
    const { labels, components } = labelComponents(dilate(bin, width, height, 2, 2), width, height);
    const real = components.map(() => ({ area: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
    for (let p = 0; p < bin.length; p++) {
      if (!bin[p]) continue;
      const k = real[labels[p] - 1];
      const x = p % width;
      const y = (p - x) / width;
      k.area++;
      if (x < k.x0) k.x0 = x;
      if (x > k.x1) k.x1 = x;
      if (y < k.y0) k.y0 = y;
      if (y > k.y1) k.y1 = y;
    }
    // Rectangle outlines (input boxes, buttons, frames) are not curves: they run along most of their own box's
    // perimeter, whatever is inside them (e.g. Desmos' solid icon square fused with the input outline).
    // A curve touches its box only at a few points (arm tips, vertex).
    const sides = real.map((k) =>
      k.area
        ? {
            top: new Uint8Array(k.x1 - k.x0 + 1),
            bottom: new Uint8Array(k.x1 - k.x0 + 1),
            left: new Uint8Array(k.y1 - k.y0 + 1),
            right: new Uint8Array(k.y1 - k.y0 + 1),
          }
        : null,
    );
    for (let p = 0; p < bin.length; p++) {
      if (!bin[p]) continue;
      const i = labels[p] - 1;
      const k = real[i];
      const sd = sides[i]!;
      const x = p % width;
      const y = (p - x) / width;
      if (y - k.y0 <= 2) sd.top[x - k.x0] = 1;
      if (k.y1 - y <= 2) sd.bottom[x - k.x0] = 1;
      if (x - k.x0 <= 2) sd.left[y - k.y0] = 1;
      if (k.x1 - x <= 2) sd.right[y - k.y0] = 1;
    }
    const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);
    const perimeterCover = sides.map((sd) =>
      sd ? (sum(sd.top) + sum(sd.bottom) + sum(sd.left) + sum(sd.right)) / (2 * sd.top.length + 2 * sd.left.length) : 0,
    );
    let score = 0;
    let box: Rect | null = null;
    const accepted = new Set<number>();
    real.forEach((k, i) => {
      if (!k.area) return;
      const kb = { x: k.x0, y: k.y0, width: k.x1 - k.x0 + 1, height: k.y1 - k.y0 + 1 };
      const length = Math.hypot(kb.width, kb.height);
      const thickness = k.area / length;
      if (length < minLength || thickness > maxThickness) return;
      const frame = kb.width >= 10 && kb.height >= 10 && perimeterCover[i] >= 0.6;
      if (frame) return;
      // Dead-straight horizontal or vertical coloured lines are UI (borders, underlines, separators), not curves.
      if (kb.width <= 3 || kb.height <= 3) return;
      // A drawn stroke is solid along its path; scattered photo noise that only joins up after growing is not.
      const density = k.area / components[i].area;
      if (density < 0.12) return;
      score += length;
      box = box ? union(box, kb) : kb;
      accepted.add(i + 1);
    });
    if (box && score >= shortSide * 0.25) results.push({ score, box, labels, bin, accepted });
  }
  if (!results.length) return null;
  const top = Math.max(...results.map((r) => r.score));
  // Several curves of different colours (y = x² in red, y = 2x in blue) all count if they are comparable.
  const chosen = results.filter((r) => r.score >= top * 0.35);
  // Only the accepted curves' own pixels: never an icon or button that happens to share the colour.
  const mask = new Float32Array(width * height);
  for (const r of chosen) for (let p = 0; p < r.bin.length; p++) if (r.bin[p] && r.accepted.has(r.labels[p])) mask[p] = 1;
  return { box: chosen.reduce((u, r) => union(u, r.box), chosen[0].box), mask };
}

interface Candidate {
  box: Rect;
  area: number;
  colour: Rgb;
  score: number;
}

function scoreCandidates(rgb: ArrayLike<number>, mask: Uint8Array, width: number, height: number, region: Rect): Candidate[] {
  const { labels, components } = labelComponents(mask, width, height);
  const sums = components.map(() => ({ r: 0, g: 0, b: 0 }));
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l) continue;
    sums[l - 1].r += rgb[p * 3];
    sums[l - 1].g += rgb[p * 3 + 1];
    sums[l - 1].b += rgb[p * 3 + 2];
  }
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const halfDiag = Math.hypot(region.width, region.height) / 2;
  return components.map((c, i) => {
    const colour = { r: sums[i].r / c.area, g: sums[i].g / c.area, b: sums[i].b / c.area };
    const mx = c.box.x + c.box.width / 2;
    const my = c.box.y + c.box.height / 2;
    const centre = 1 - 0.6 * Math.min(1, Math.hypot(mx - cx, my - cy) / halfDiag);
    const touchesEdge =
      c.box.x <= region.x + 1 ||
      c.box.y <= region.y + 1 ||
      c.box.x + c.box.width >= region.x + region.width - 1 ||
      c.box.y + c.box.height >= region.y + region.height - 1;
    const textLike = c.box.height <= region.height * 0.05 && c.box.width / Math.max(1, c.box.height) > 3;
    const score = Math.sqrt(c.area) * (0.6 + saturationOf(colour) / 255) * centre * (touchesEdge ? 0.35 : 1) * (textLike ? 0.3 : 1);
    return { box: c.box, area: c.area, colour, score };
  });
}

/** Box-averaged copy, `k` times smaller in each direction. */
function downsample(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  k: number,
): { rgb: Uint8ClampedArray; width: number; height: number } {
  const w = Math.max(1, Math.floor(width / k));
  const h = Math.max(1, Math.floor(height / k));
  const out = new Uint8ClampedArray(w * h * 3);
  const n = k * k;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) {
          const p = ((y * k + dy) * width + x * k + dx) * 3;
          r += rgb[p];
          g += rgb[p + 1];
          b += rgb[p + 2];
        }
      const o = (y * w + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  return { rgb: out, width: w, height: h };
}

function scaleRect(r: Rect, k: number, width: number, height: number): Rect {
  const x = Math.max(0, r.x * k);
  const y = Math.max(0, r.y * k);
  return { x, y, width: Math.min(width - x, r.width * k), height: Math.min(height - y, r.height * k) };
}

/** Largest side the analysis works at. Deciding *what* to crop needs far less detail than the pins' picture. */
const ANALYSIS_SIZE = 400;

/**
 * The part of the image that should become pins. See the criteria at the
 * top of this file. Curves are found at full size; shapes and objects are
 * decided on a smaller copy (fast enough for live screen sharing).
 */
export function smartSubject(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  o: SmartCropOptions,
  region: Rect = fullRect(width, height),
): SmartCropResult {
  // Curves are found at full size: shrinking would fade a thin line below the colour threshold. They count when the
  // area around them is flat (a screen or diagram), whatever else is on screen (a photo wallpaper, other windows).
  const curves = findCurves(rgb, width, height, region);
  if (curves) {
    const context = clip(expand(curves.box, 0.08, width, height), region);
    if (!isPhotoLike(rgb, width, height, context) && !enclosesFill(rgb, width, curves))
      return { box: curves.box, context, kind: 'curves', mask: curves.mask };
  }
  // Graphs whose curve has no colour (black, grey): find the plot area by its grid, then the curve inside it.
  const plot = findPlotArea(rgb, width, height, region);
  if (plot && !isPhotoLike(rgb, width, height, plot)) {
    // Inside the plot the background really is one colour; axes and gridlines are removed, labels dropped as small.
    const fg = findForeground(rgb, width, height, {
      tolerance: o.tolerance,
      minPieceRatio: o.minPieceRatio,
      removeLines: true,
      region: plot,
    });
    // UI inside the plot (Desmos' zoom buttons, framed boxes) is not part of the graph.
    const { mask, box } = dropFramedPieces(fg.mask, width, height);
    if (box) return { box, context: plot, kind: 'curves', mask };
  }
  // Shapes and objects: decided on a smaller copy (fast enough for live sharing; a few pixels don't matter on 40 pins).
  const k = Math.max(1, Math.round(Math.max(width, height) / ANALYSIS_SIZE));
  const small = k > 1 ? downsample(rgb, width, height, k) : { rgb, width, height };
  const smallRegion = k > 1 ? { x: region.x / k, y: region.y / k, width: region.width / k, height: region.height / k } : region;
  const isWhole = region.x <= 0 && region.y <= 0 && region.width >= width && region.height >= height;
  const res = analyse(small.rgb, small.width, small.height, o, isWhole ? undefined : smallRegion, 0);
  const up = (r: Rect) => clip(k > 1 ? scaleRect(r, k, width, height) : r, region);
  return { box: up(res.box), context: up(res.context), kind: res.kind };
}

/**
 * Removes pieces that run along most of their own box's perimeter (buttons, input boxes, panels): UI, not
 * drawing. Returns what is left as a 0/1 mask and its box.
 */
function dropFramedPieces(source: Uint8Array, width: number, height: number): { mask: Float32Array; box: Rect | null } {
  const { labels, components } = labelComponents(source, width, height);
  const sides = components.map((c) => ({
    top: new Uint8Array(c.box.width),
    bottom: new Uint8Array(c.box.width),
    left: new Uint8Array(c.box.height),
    right: new Uint8Array(c.box.height),
  }));
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l) continue;
    const b = components[l - 1].box;
    const sd = sides[l - 1];
    const x = p % width;
    const y = (p - x) / width;
    if (y - b.y <= 2) sd.top[x - b.x] = 1;
    if (b.y + b.height - 1 - y <= 2) sd.bottom[x - b.x] = 1;
    if (x - b.x <= 2) sd.left[y - b.y] = 1;
    if (b.x + b.width - 1 - x <= 2) sd.right[y - b.y] = 1;
  }
  const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);
  const framed = components.map((c, i) => {
    if (c.box.width < 10 || c.box.height < 10) return false;
    const sd = sides[i];
    return (sum(sd.top) + sum(sd.bottom) + sum(sd.left) + sum(sd.right)) / (2 * c.box.width + 2 * c.box.height) >= 0.6;
  });
  const mask = new Float32Array(width * height);
  let box: Rect | null = null;
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l || framed[l - 1]) continue;
    mask[p] = 1;
  }
  components.forEach((c, i) => {
    if (!framed[i]) box = box ? union(box, c.box) : c.box;
  });
  return { mask, box };
}

interface GridLine {
  /** Row (horizontal) or column (vertical). */
  at: number;
  start: number;
  end: number;
}

/**
 * The plot area of a graph in a screenshot (e.g. Desmos), found by its structure rather than colours: at least
 * two long, thin, straight horizontal lines and two vertical ones (gridlines and axes) that cross each other.
 * Toolbars and panels are not thin; separators rarely come as a crossing grid. Returns the rectangle the grid
 * spans, or null.
 */
export function findPlotArea(rgb: ArrayLike<number>, width: number, height: number, region: Rect = fullRect(width, height)): Rect | null {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  // A line pixel is a thin local dip: grey-ish (not coloured) and darker than the pixels 3 px to either side,
  // across the line. Scale-independent (a faint 1 px gridline shrunk to half a pixel is still a dip), and thin by
  // construction: a solid toolbar has no dip, a panel edge is darker on one side only.
  const lum = new Float32Array(width * height);
  const grey = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      const r = rgb[p * 3];
      const g = rgb[p * 3 + 1];
      const b = rgb[p * 3 + 2];
      lum[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      grey[p] = Math.max(r, g, b) - Math.min(r, g, b) < 40 ? 1 : 0;
    }
  const DIP = 3;
  const dip = (p: number, step: number) => grey[p] === 1 && lum[p] <= Math.min(lum[p - step], lum[p + step]) - DIP;
  /** Thin dip across a horizontal line (compared with the pixels 3 px above and below). */
  const hLine = (x: number, y: number) => x >= x0 && x < x1 && y >= y0 + 3 && y < y1 - 3 && dip(y * width + x, 3 * width);
  /** Thin dip across a vertical line (3 px left and right). */
  const vLine = (x: number, y: number) => x >= x0 + 3 && x < x1 - 3 && y >= y0 && y < y1 && dip(y * width + x, 3);

  /** Long runs of thin-line pixels along one axis, at least `minLen` long; gaps up to 6 px are bridged (crossing lines, the curve, labels). */
  const scan = (horizontal: boolean): GridLine[] => {
    const minLen = (horizontal ? x1 - x0 : y1 - y0) * 0.25;
    const out: GridLine[] = [];
    const [a0, a1, b0, b1] = horizontal ? [y0, y1, x0, x1] : [x0, x1, y0, y1];
    for (let a = a0; a < a1; a++) {
      const thin = (bb: number) => (horizontal ? hLine(bb, a) : vLine(a, bb));
      let b = b0;
      while (b < b1) {
        if (!thin(b)) {
          b++;
          continue;
        }
        let e = b;
        for (;;) {
          let next = -1;
          for (let g = 1; g <= 6 && e + g < b1; g++)
            if (thin(e + g)) {
              next = e + g;
              break;
            }
          if (next < 0) break;
          e = next;
        }
        if (e - b + 1 >= minLen) out.push({ at: a, start: b, end: e });
        b = e + 1;
      }
    }
    // Rows next to each other belong to the same (anti-aliased, 2-3 px) line.
    return out.filter((l, i) => !(i > 0 && out[i - 1].at === l.at - 1 && Math.abs(out[i - 1].start - l.start) < 6));
  };
  const hs = scan(true);
  const vs = scan(false);
  if (hs.length < 2 || vs.length < 2) return null;
  // The grid: horizontal lines that cross at least two vertical lines (and vice versa).
  const crosses = (h: GridLine, v: GridLine) => v.at >= h.start && v.at <= h.end && h.at >= v.start && h.at <= v.end;
  const gh = hs.filter((h) => vs.filter((v) => crosses(h, v)).length >= 2);
  const gv = vs.filter((v) => hs.filter((h) => crosses(h, v)).length >= 2);
  if (gh.length < 2 || gv.length < 2) return null;
  // A gridline is often found as several pieces (a steep curve running beside it, labels, buttons on top).
  // Merge pieces of the same row/column, then take the extent most lines agree on (30th/70th percentile), so a
  // few short lines (cut by an overlay or a panel) can't shrink the plot.
  const merged = (lines: GridLine[]) => {
    const byAt = new Map<number, { start: number; end: number }>();
    for (const l of lines) {
      const key = [...byAt.keys()].find((k) => Math.abs(k - l.at) <= 2) ?? l.at;
      const m = byAt.get(key);
      byAt.set(key, m ? { start: Math.min(m.start, l.start), end: Math.max(m.end, l.end) } : { start: l.start, end: l.end });
    }
    return [...byAt.values()];
  };
  const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  const mh = merged(gh);
  const mv = merged(gv);
  const left = pct(
    mh.map((h) => h.start),
    0.3,
  );
  const right = pct(
    mh.map((h) => h.end),
    0.7,
  );
  const top = pct(
    mv.map((v) => v.start),
    0.3,
  );
  const bottom = pct(
    mv.map((v) => v.end),
    0.7,
  );
  if (right - left < 40 || bottom - top < 40) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * True when the strokes are the outline of a filled shape rather than graph curves: inside their box, apart
 * from the strokes, at least 20% of the area is a *solid* region of another colour than the local background.
 * "Solid" means the pixel's whole 5 x 5 neighbourhood has that other colour, so thin things (gridlines, axes,
 * tick labels) never count, however dense the grid is. A triangle diagram's pale fill does.
 */
function enclosesFill(rgb: ArrayLike<number>, width: number, curves: CurveResult): boolean {
  const b = curves.box;
  const x0 = Math.floor(b.x);
  const y0 = Math.floor(b.y);
  const bw = Math.ceil(b.x + b.width) - x0;
  const bh = Math.ceil(b.y + b.height) - y0;
  if (bw < 5 || bh < 5) return false;
  // Local background: the most common colour (in 8 levels per channel) inside the box, then its real average.
  const key = (p: number) => ((rgb[p] >> 5) << 6) | ((rgb[p + 1] >> 5) << 3) | (rgb[p + 2] >> 5);
  const counts = new Uint32Array(512);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) counts[key(((y0 + y) * width + x0 + x) * 3)]++;
  let mode = 0;
  for (let i = 1; i < 512; i++) if (counts[i] > counts[mode]) mode = i;
  const bg = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const p = ((y0 + y) * width + x0 + x) * 3;
      if (key(p) !== mode) continue;
      bg.r += rgb[p];
      bg.g += rgb[p + 1];
      bg.b += rgb[p + 2];
    }
  bg.r /= counts[mode];
  bg.g /= counts[mode];
  bg.b /= counts[mode];

  // Pixels that are neither background nor (near) a stroke. The inverse is grown by 2 px, so what survives is solid.
  const notOther = new Uint8Array(bw * bh);
  let total = 0;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const q = (y0 + y) * width + x0 + x;
      let nearStroke = false;
      for (let d = -2; d <= 2 && !nearStroke; d++) nearStroke = !!curves.mask[q + d] || !!curves.mask[q + d * width];
      if (!nearStroke) total++;
      const other = !nearStroke && Math.hypot(rgb[q * 3] - bg.r, rgb[q * 3 + 1] - bg.g, rgb[q * 3 + 2] - bg.b) > AUTO_MIN;
      notOther[y * bw + x] = other ? 0 : 1;
    }
  const notSolid = dilate(notOther, bw, bh, 2, 2);
  let solid = 0;
  for (let i = 0; i < notSolid.length; i++) if (!notSolid[i]) solid++;
  return total > 0 && solid / total >= 0.2;
}

function clip(r: Rect, to: Rect): Rect {
  const x = Math.max(r.x, to.x);
  const y = Math.max(r.y, to.y);
  return {
    x,
    y,
    width: Math.max(1, Math.min(r.x + r.width, to.x + to.width) - x),
    height: Math.max(1, Math.min(r.y + r.height, to.y + to.height) - y),
  };
}

function analyse(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  o: SmartCropOptions,
  region: Rect | undefined,
  depth: number,
): SmartCropResult {
  const r = region ?? fullRect(width, height);

  const fg = findForeground(rgb, width, height, {
    tolerance: o.tolerance,
    minPieceRatio: o.minPieceRatio,
    removeLines: o.removeLines,
    region,
  });
  const candidates = scoreCandidates(rgb, fg.mask, width, height, r).sort((a, b) => b.score - a.score);
  if (!candidates.length) return { box: r, context: r, kind: 'none' };
  const best = candidates[0];

  // Cards: a nearly solid rectangle with something different inside it. Look inside.
  const fill = best.area / area(best.box);
  if (depth < 3 && fill >= 0.85 && best.box.width >= 12 && best.box.height >= 12 && area(best.box) < area(r) * 0.98) {
    const inner = analyse(rgb, width, height, o, inset(best.box, 2), depth + 1);
    if (inner.kind !== 'none' && area(inner.box) <= area(best.box) * 0.8) return inner;
  }

  // Nearby pieces of the same colour belong together (a broken outline, two halves of a drawing).
  const gap = Math.hypot(r.width, r.height) * 0.06;
  let box = best.box;
  for (const c of candidates.slice(1)) {
    const near =
      c.box.x <= box.x + box.width + gap &&
      box.x <= c.box.x + c.box.width + gap &&
      c.box.y <= box.y + box.height + gap &&
      box.y <= c.box.y + c.box.height + gap;
    const similar = Math.hypot(c.colour.r - best.colour.r, c.colour.g - best.colour.g, c.colour.b - best.colour.b) < 60;
    if (near && similar && c.score >= best.score * 0.15) box = union(box, c.box);
  }
  return { box, context: r, kind: 'shape' };
}

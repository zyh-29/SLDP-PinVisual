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
 *
 * Curves are found in curves.ts, plot areas in plotGrid.ts, graph windows in graph.ts.
 */
import { dropFramedPieces, enclosesFill, findCurves, hasLongStroke } from './curves';
import { findForeground } from './foreground';
import { area, clip, contains, distanceTo, expand, fullRect, inset, overlaps, type Point, type Rect, type Rgb, union } from './geometry';
import { curveKeyPoint, type GraphAxes, type GraphScale, graphWindow, type GraphWindow, type KeyPoint, readAxes, rescale, tidyKeyPoint } from './graph';
import { dilate, labelComponents } from './masks';
import { findGrids, type Grid } from './plotGrid';

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
  /** Graphs: the axes, scale and key point found, and the window shown (see graph.ts). */
  graph?: GraphInfo;
}

/** Showing a portion of a graph (e.g. x from -5 to 5 around its vertex) instead of the whole curve. */
export interface GraphView {
  /** Units each side of the curve's key point, or 'whole' for the whole curve. */
  range: number | 'whole';
  /** The measured scale (from the axis numbers, or the grid); null until known. */
  scale: GraphScale | null;
  rows: number;
  cols: number;
  pinPitchRatio: number;
}

export interface GraphInfo {
  axes: GraphAxes;
  key: KeyPoint | null;
  /** The scale used, valid for this grid; null when not known yet for it (the whole curve is shown meanwhile). */
  scale: GraphScale | null;
  /** The portion shown; null for the whole curve. */
  window: Rect | null;
  /** How the window fits the range asked for (see graphWindow); null for the whole curve. */
  fit: GraphWindow['fit'] | null;
}

export interface SmartCropOptions {
  tolerance: number | 'auto';
  minPieceRatio: number;
  removeLines: boolean | 'auto';
}

const saturationOf = (c: Rgb) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

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

interface Candidate {
  /** Its label in the component map (see labelComponents). */
  label: number;
  box: Rect;
  area: number;
  colour: Rgb;
  score: number;
}

function scoreCandidates(
  rgb: ArrayLike<number>,
  mask: Uint8Array,
  width: number,
  height: number,
  region: Rect,
): { labels: Int32Array; candidates: Candidate[] } {
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
  const candidates = components.map((c, i) => {
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
    return { label: i + 1, box: c.box, area: c.area, colour, score };
  });
  return { labels, candidates };
}

/**
 * The candidate a tap points at:
 *  1. the piece whose own pixels are under the finger (within `reach`): a box can hold the tap without the piece
 *     being there (a big arc's box around a small disc in its hollow);
 *  2. else the smallest one whose box contains the point (a tap on a card's plain background);
 *  3. else the nearest one.
 */
function pickAt(candidates: Candidate[], labels: Int32Array, width: number, height: number, p: Point, reach: number): Candidate {
  let hit = 0;
  let nearest = Infinity;
  for (let y = Math.max(0, Math.floor(p.y - reach)); y <= Math.min(height - 1, Math.ceil(p.y + reach)); y++)
    for (let x = Math.max(0, Math.floor(p.x - reach)); x <= Math.min(width - 1, Math.ceil(p.x + reach)); x++) {
      const l = labels[y * width + x];
      if (!l) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= reach && d < nearest) {
        nearest = d;
        hit = l;
      }
    }
  const under = hit ? candidates.find((c) => c.label === hit) : undefined;
  if (under) return under;
  const inside = candidates.filter((c) => contains(c.box, p));
  if (inside.length) return inside.reduce((a, b) => (area(b.box) < area(a.box) ? b : a));
  return candidates.reduce((a, b) => (distanceTo(b.box, p) < distanceTo(a.box, p) ? b : a));
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
  /** A point the user tapped (image pixels): the subject containing it wins, e.g. one picture in a grid of results. */
  focus?: Point,
  /** For graphs: show this portion instead of the whole curve. */
  view?: GraphView,
): SmartCropResult {
  // A tap inside one of several graphs (a worksheet with two plots): only that graph is searched.
  if (focus) {
    const grids = findGrids(rgb, width, height, region);
    if (grids.length > 1) {
      const tapped = grids.find((g) => contains(expand(g.plot, 0.03, width, height), focus));
      if (tapped) return subjectIn(rgb, width, height, o, clip(expand(tapped.plot, 0.03, width, height), region), focus, view);
    }
  }
  return subjectIn(rgb, width, height, o, region, focus, view);
}

function subjectIn(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  o: SmartCropOptions,
  region: Rect,
  focus: Point | undefined,
  view: GraphView | undefined,
): SmartCropResult {
  const wants = (r: Rect) => !focus || contains(expand(r, 0.05, width, height), focus);
  /** Graphs: read the axes, then (with a known scale) narrow the box to the window around the key point. */
  const windowed = (result: SmartCropResult, mask: Float32Array, known: Grid | null): SmartCropResult => {
    if (!view) return result;
    const grid = known ?? gridFor(findGrids(rgb, width, height, region), result.box);
    if (!grid || !overlaps(grid.plot, result.box)) return result;
    const axes = readAxes(grid);
    const scale = view.scale ? rescale(view.scale, axes) : null;
    const found = curveKeyPoint(mask, width, height, axes, rgb);
    const key = found && scale ? tidyKeyPoint(found, axes, scale) : found;
    const info: GraphInfo = { axes, key, scale, window: null, fit: null };
    if (view.range === 'whole' || !key || !scale) return { ...result, graph: info };
    const win = graphWindow(key, scale, view.range, axes.plot, view.rows, view.cols, view.pinPitchRatio);
    return { ...result, box: win.box, context: clip(union(result.context, win.box), region), graph: { ...info, window: win.box, fit: win.fit } };
  };
  // Curves are found at full size: shrinking would fade a thin line below the colour threshold. They count when the
  // area around them is flat (a screen or diagram), whatever else is on screen (a photo wallpaper, other windows).
  const curves = findCurves(rgb, width, height, region, focus);
  if (curves && wants(curves.box)) {
    const context = clip(expand(curves.box, 0.08, width, height), region);
    if (!isPhotoLike(rgb, width, height, context) && !enclosesFill(rgb, width, curves))
      return windowed({ box: curves.box, context, kind: 'curves', mask: curves.mask }, curves.mask, null);
  }
  // Graphs whose curve has no colour (black, grey): find the plot area by its grid, then the curve inside it.
  // Several plots on the page (and no tap): the biggest.
  const grid = gridFor(findGrids(rgb, width, height, region), region);
  const plot = grid?.plot;
  if (grid && plot && wants(plot) && !isPhotoLike(rgb, width, height, plot)) {
    // Inside the plot the background really is one colour; axes and gridlines are removed, labels dropped as small.
    const fg = findForeground(rgb, width, height, {
      tolerance: o.tolerance,
      minPieceRatio: o.minPieceRatio,
      removeLines: true,
      region: plot,
    });
    // UI inside the plot (Desmos' zoom buttons, framed boxes) is not part of the graph.
    const { mask, box } = dropFramedPieces(fg.mask, width, height);
    // A curve is long. Only short pieces left (the axis numbers and tick marks of an empty graph): no curve.
    if (box && hasLongStroke(mask, width, height, plot)) return windowed({ box, context: plot, kind: 'curves', mask }, mask, grid);
  }
  // Shapes and objects: decided on a smaller copy (fast enough for live sharing; a few pixels don't matter on 40 pins).
  const k = Math.max(1, Math.round(Math.max(width, height) / ANALYSIS_SIZE));
  const small = k > 1 ? downsample(rgb, width, height, k) : { rgb, width, height };
  const smallRegion = k > 1 ? { x: region.x / k, y: region.y / k, width: region.width / k, height: region.height / k } : region;
  const isWhole = region.x <= 0 && region.y <= 0 && region.width >= width && region.height >= height;
  const smallFocus = focus && (k > 1 ? { x: focus.x / k, y: focus.y / k } : focus);
  const res = analyse(small.rgb, small.width, small.height, o, isWhole ? undefined : smallRegion, 0, smallFocus);
  const up = (r: Rect) => clip(k > 1 ? scaleRect(r, k, width, height) : r, region);
  return { box: up(res.box), context: up(res.context), kind: res.kind };
}

/** Of several plots, the one covering most of `box` (a page can hold several graphs); null when there are none. */
function gridFor(grids: Grid[], box: Rect): Grid | null {
  const shared = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  let best: Grid | null = null;
  let most = 0;
  for (const g of grids) {
    const s = shared(g.plot, box);
    if (s > most) {
      most = s;
      best = g;
    }
  }
  return best;
}

/**
 * A subject mask (0..1, e.g. Smart Cut-Out's) cut down to the one subject at a tapped point, or the nearest one
 * when the tap is beside them all. Soft edges within 2 px of the kept subject stay. With only one subject, the
 * same mask comes back.
 */
export function keepPieceAt(mask: Float32Array, width: number, height: number, p: Point): Float32Array {
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < bin.length; i++) if (mask[i] > 0.5) bin[i] = 1;
  // Grown by 2 px: a subject split by a thin gap stays one, and its soft edge belongs to it.
  const { labels, components } = labelComponents(dilate(bin, width, height, 2, 2), width, height);
  if (components.length <= 1) return mask;
  // Specks (much smaller than the main subject) are never chosen.
  const biggest = Math.max(...components.map((c) => c.area));
  const big = new Set(components.flatMap((c, i) => (c.area >= biggest * 0.02 ? [i + 1] : [])));
  let keep = 0;
  const px = Math.min(width - 1, Math.max(0, Math.round(p.x)));
  const py = Math.min(height - 1, Math.max(0, Math.round(p.y)));
  const under = labels[py * width + px];
  if (under && big.has(under)) keep = under;
  else {
    let nearest = Infinity;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const l = labels[y * width + x];
        if (!l || !big.has(l) || !bin[y * width + x]) continue;
        const d = (x - p.x) ** 2 + (y - p.y) ** 2;
        if (d < nearest) {
          nearest = d;
          keep = l;
        }
      }
  }
  const out = new Float32Array(mask.length);
  for (let i = 0; i < out.length; i++) if (labels[i] === keep) out[i] = mask[i];
  return out;
}

function analyse(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  o: SmartCropOptions,
  region: Rect | undefined,
  depth: number,
  focus?: Point,
): SmartCropResult {
  const r = region ?? fullRect(width, height);

  const fg = findForeground(rgb, width, height, {
    tolerance: o.tolerance,
    minPieceRatio: o.minPieceRatio,
    removeLines: o.removeLines,
    region,
  });
  const scored = scoreCandidates(rgb, fg.mask, width, height, r);
  const candidates = scored.candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return { box: r, context: r, kind: 'none' };
  // With a tapped point: the piece under the finger, else the most specific one containing it (a thumbnail in a
  // grid), else the nearest. A finger's reach: 2% of the region's diagonal.
  const reach = Math.max(2, Math.hypot(r.width, r.height) * 0.02);
  const best = focus ? pickAt(candidates, scored.labels, width, height, focus, reach) : candidates[0];

  // Cards: a nearly solid rectangle with something different inside it. Look inside.
  const fill = best.area / area(best.box);
  if (depth < 3 && fill >= 0.85 && best.box.width >= 12 && best.box.height >= 12 && area(best.box) < area(r) * 0.98) {
    const inner = analyse(rgb, width, height, o, inset(best.box, 2), depth + 1, focus);
    if (inner.kind !== 'none' && area(inner.box) <= area(best.box) * 0.8) return inner;
  }

  // Nearby pieces of the same colour belong together (a broken outline, two halves of a drawing). After a tap only
  // touching pieces join, so neighbouring pictures in a grid stay out.
  const gap = Math.hypot(r.width, r.height) * (focus ? 0.015 : 0.06);
  let box = best.box;
  for (const c of candidates) {
    if (c === best) continue;
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

/**
 * Graph windows: show a portion of a graph (e.g. x from -5 to 5) at its true proportions, placed on the part
 * that describes the curve best, instead of squeezing the whole curve onto the pins.
 *
 *  1. Axes and grid (readAxes): the axes are the darkest gridlines; the major (numbered) gridlines are darker
 *     than the minor ones. Their spacing is the grid step.
 *  2. Scale (scaleFromLabels): pixels per unit, from the numbers printed along the axes (read by OCR, see
 *     axisNumbers.web.ts), checked against the grid: graphing tools put numbered lines at 1, 2 or 5 x 10^n units.
 *     Without readable numbers, one major grid square counts as one unit.
 *  3. Key point (curveKeyPoint): where the curve says the most. One turning point (a parabola): its vertex, at
 *     the bottom (or top) of the window so both arms show. Bends both ways (a cubic, a wave): the middle, where
 *     the bend changes. A closed curve (a circle): its centre. Neither (a line, a root, a log): where it starts,
 *     else where it crosses the y-axis, else the x-axis, with the window following the curve up or down;
 *     branches either side of the y-axis (1/x): the origin.
 *  4. Window (graphWindow): +/- range units around the key point, with the pins' proportions and the same
 *     scale on both axes, kept inside the visible plot.
 *
 * Pure functions on the working image (unit tested).
 */
import { type Component, dilate, labelComponents } from './masks';
import { type Rect, union } from './geometry';
import type { GraphScale } from './graphScale';
import { median } from './stats';

/** One gridline (same shape as the smart crop's), merged along its row or column. */
export interface AxisLine {
  /** Row (horizontal line) or column (vertical line). */
  at: number;
  start: number;
  end: number;
  /** How much darker than its surroundings it is. */
  depth: number;
}

export interface GraphAxes {
  plot: Rect;
  /** Column of the y-axis (x = 0), when on screen. */
  originX: number | null;
  /** Row of the x-axis (y = 0), when on screen. */
  originY: number | null;
  /** Spacing of the major (numbered) gridlines in pixels, across x and down y. */
  majorX: number | null;
  majorY: number | null;
}


/**
 * The repeat distance of evenly spaced positions (gridlines), tolerating missing and extra lines: the smallest
 * spacing that most gaps are whole multiples of. Null with fewer than 3 positions.
 */
export function gridStep(positions: number[]): number | null {
  const p = [...positions].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < p.length; i++) if (p[i] - p[i - 1] > 2) gaps.push(p[i] - p[i - 1]);
  if (gaps.length < 2) return null;
  for (const d of [...gaps].sort((a, b) => a - b)) {
    let units = 0;
    let length = 0;
    let fits = 0;
    for (const g of gaps) {
      const k = Math.round(g / d);
      if (k >= 1 && k <= 6 && Math.abs(g - k * d) <= Math.max(1.5, 0.06 * g)) {
        fits++;
        units += k;
        length += g;
      }
    }
    if (fits >= gaps.length * 0.75 && fits >= 2) return length / units;
  }
  return median(gaps);
}

/** The darkest line, if it stands out from the rest of the grid (an axis), and the others. */
function splitAxis(lines: AxisLine[], extent: number): { axis: AxisLine | null; rest: AxisLine[] } {
  if (lines.length < 3) return { axis: null, rest: lines };
  const darkest = lines.reduce((a, b) => (b.depth > a.depth ? b : a));
  const others = lines.filter((l) => l !== darkest);
  const typical = median(others.map((l) => l.depth));
  // Darker than every other line too, not just the (mostly minor) typical one: with the axis off screen the
  // darkest line is just a major gridline.
  const runnerUp = Math.max(...others.map((l) => l.depth));
  const long = darkest.end - darkest.start >= extent * 0.6;
  const standsOut = darkest.depth >= typical * 1.5 && darkest.depth - typical >= 8 && darkest.depth >= runnerUp * 1.35;
  return standsOut && long ? { axis: darkest, rest: others } : { axis: null, rest: lines };
}

/**
 * Spacing of the major (numbered) gridlines. First the basic spacing of all lines, then the rhythm: graphing
 * tools draw every 2nd, 4th, 5th or 10th line darker (Desmos: 4 or 5). The pattern (period and offset) whose
 * lines are darkest on average wins. Averaging matters: after shrinking, a line that falls between two pixel
 * rows looks half as dark, so single lines can't be sorted by shade. No clear rhythm: every line is major.
 */
function majorSpacing(lines: AxisLine[], axis: AxisLine | null): number | null {
  const all = axis ? [...lines, axis] : lines;
  const d0 = gridStep(all.map((l) => l.at));
  if (!d0) return null;
  const at0 = axis?.at ?? lines[0]?.at ?? 0;
  // Each line's place in the lattice (lines off it are strays: labels, the curve, UI).
  const place = (step: number) =>
    lines.map((l) => ({ l, i: Math.round((l.at - at0) / step) })).filter(({ l, i }) => Math.abs(l.at - at0 - i * step) <= Math.max(1.5, step * 0.25));
  /** The spacing fitted over the lines' positions (least squares on their lattice places), or `step` if it can't be. */
  const fit = (placed: { l: AxisLine; i: number }[], step: number) => {
    const pts = placed.map(({ l, i }) => ({ i, at: l.at }));
    if (axis) pts.push({ i: 0, at: axis.at });
    if (pts.length < 3) return step;
    const mi = pts.reduce((t, p) => t + p.i, 0) / pts.length;
    const ma = pts.reduce((t, p) => t + p.at, 0) / pts.length;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.i - mi) * (p.at - ma);
      den += (p.i - mi) ** 2;
    }
    return den > 0 && Math.abs(num / den / step - 1) < 0.1 ? num / den : step;
  };
  // The gaps are whole pixels (7, 7, 8, 7, 7 for a 7.2 px grid), so the first spacing is a little off and the error
  // grows with each line from the origin: far lines would get the wrong place, and the rhythm of darker lines
  // would look broken. So: place the lines near the origin, fit the exact spacing to them, then place them all.
  const d = fit(place(d0).filter(({ i }) => Math.abs(i) <= 6), d0);
  const placed = place(d);
  const mean = (xs: { l: AxisLine }[]) => xs.reduce((t, x) => t + x.l.depth, 0) / xs.length;
  let best = { k: 1, ratio: 1 };
  for (const k of [2, 4, 5, 10]) {
    // With the axis on screen, the major lines include it (offset 0).
    for (let phase = 0; phase < (axis ? 1 : k); phase++) {
      const sel = placed.filter(({ i }) => (((i - phase) % k) + k) % k === 0);
      const rest = placed.filter(({ i }) => (((i - phase) % k) + k) % k !== 0);
      if (sel.length < (axis ? 1 : 2) || rest.length < 2) continue;
      const ratio = mean(sel) / Math.max(1, mean(rest));
      // A rhythm resting on a single line (the axis plus one more on screen) must be unmistakable: darker than
      // every other line by a margin. Otherwise shrinking alone, which makes alternate lines look darker, can make
      // one line "the numbered one" and the scale 5 times too big.
      if (sel.length < 2 && sel[0].l.depth < 1.25 * Math.max(...rest.map((x) => x.l.depth))) continue;
      // And the darker lines must be darker consistently, not on average: one line that happens to look darker
      // lifts a mean over two or three (a grid whose lines are all one shade, alternate ones darkened by shrinking).
      const typical = median(rest.map((x) => x.l.depth));
      if (sel.filter((x) => x.l.depth > typical * 1.1).length < 0.75 * sel.length) continue;
      // A longer period must be clearly better (every 10th line is also every 5th).
      if (ratio > best.ratio * (best.k === 1 ? 1 : 1.12)) best = { k, ratio };
    }
  }
  // The spacing, fitted over every line's position: far more precise than one gap, and multiplying by the period
  // would multiply any error.
  const fitted = fit(placed, d);
  return best.ratio >= 1.3 ? best.k * fitted : fitted;
}

/** Axes and major grid spacing from a plot's gridlines (see findGrid in smartCrop.ts). */
export function readAxes(grid: { plot: Rect; rows: AxisLine[]; cols: AxisLine[] }): GraphAxes {
  const { plot } = grid;
  const h = splitAxis(grid.rows, plot.width);
  const v = splitAxis(grid.cols, plot.height);
  const spacing = (axis: AxisLine | null, rest: AxisLine[]) => majorSpacing(rest, axis);
  return {
    plot,
    originX: v.axis?.at ?? null,
    originY: h.axis?.at ?? null,
    majorX: spacing(v.axis, v.rest),
    majorY: spacing(h.axis, h.rest),
  };
}

// ---------- Scale (graphScale.ts) ----------

export { followZoom, rescale, scaleFromGrid, scaleFromLabels } from './graphScale';
export type { AxisReading, GraphScale } from './graphScale';

/**
 * Where the numbers along each axis are expected: a band on each side of the axis line, or, with the axis off
 * screen, along the plot's edges (where graphing tools like Desmos pin them).
 */
export function labelBands(axes: GraphAxes): { axis: 'x' | 'y'; rect: Rect }[] {
  const { plot } = axes;
  const out: { axis: 'x' | 'y'; rect: Rect }[] = [];
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;
  const bandH = Math.round(Math.min(Math.max(0.45 * (axes.majorY ?? plot.height / 8), 8), plot.height * 0.12));
  const bandW = Math.round(Math.min(Math.max(0.6 * (axes.majorX ?? plot.width / 8), 12), plot.width * 0.2));
  if (axes.originY === null) {
    out.push({ axis: 'x', rect: { x: plot.x, y: bottom - bandH, width: plot.width, height: bandH } });
    out.push({ axis: 'x', rect: { x: plot.x, y: plot.y, width: plot.width, height: bandH } });
  }
  if (axes.originX === null) {
    out.push({ axis: 'y', rect: { x: plot.x, y: plot.y, width: bandW, height: plot.height } });
    out.push({ axis: 'y', rect: { x: right - bandW, y: plot.y, width: bandW, height: plot.height } });
  }
  if (axes.originY !== null) {
    const below = { x: plot.x, y: Math.round(axes.originY) + 2, width: plot.width, height: bandH };
    const above = { x: plot.x, y: Math.round(axes.originY) - 2 - bandH, width: plot.width, height: bandH };
    if (below.y + below.height <= bottom) out.push({ axis: 'x', rect: below });
    if (above.y >= plot.y) out.push({ axis: 'x', rect: above });
  }
  if (axes.originX !== null) {
    const left = { x: Math.round(axes.originX) - 2 - bandW, y: plot.y, width: bandW, height: plot.height };
    const rightBand = { x: Math.round(axes.originX) + 2, y: plot.y, width: bandW, height: plot.height };
    if (left.x >= plot.x) out.push({ axis: 'y', rect: left });
    if (rightBand.x + rightBand.width <= right) out.push({ axis: 'y', rect: rightBand });
  }
  return out;
}

/**
 * The numbers' boxes in a label band (pixels of a full-resolution crop, RGBA): dark (or, on a dark theme,
 * light) grey ink, grouped into words. Gridlines crossing the band (ink from edge to edge) and coloured
 * curves are ignored.
 */
export function findLabelBoxes(rgba: ArrayLike<number>, width: number, height: number): Rect[] {
  const n = width * height;
  const lum = new Float32Array(n);
  const grey = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const r = rgba[p * 4];
    const g = rgba[p * 4 + 1];
    const b = rgba[p * 4 + 2];
    lum[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    grey[p] = Math.max(r, g, b) - Math.min(r, g, b) < 50 ? 1 : 0;
  }
  const sorted = Float32Array.from(lum).sort();
  const bg = sorted[Math.floor(n / 2)];
  const darkTheme = bg < 110;
  const extreme = darkTheme ? sorted[Math.floor(n * 0.995)] : sorted[Math.floor(n * 0.005)];
  if (Math.abs(bg - extreme) < 60) return [];
  const t = (bg + extreme) / 2;
  const ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = grey[p] && (darkTheme ? lum[p] > t : lum[p] < t) ? 1 : 0;

  const { components } = labelComponents(ink, width, height);
  // Lines crossing the band touch two opposite edges; text sits inside.
  const glyphs = components.filter((c) => {
    const touchesTopBottom = c.box.y <= 0 && c.box.y + c.box.height >= height;
    const touchesLeftRight = c.box.x <= 0 && c.box.x + c.box.width >= width;
    return !touchesTopBottom && !touchesLeftRight && c.area >= 2;
  });
  if (!glyphs.length) return [];
  // Digits are the tallest glyphs (a minus sign or a dot is short).
  const textH = Math.max(3, median(glyphs.map((g) => g.box.height).filter((h) => h >= 3)) || 3);
  const tall = glyphs.filter((g) => g.box.height <= textH * 1.6 && g.box.width <= textH * 3);
  // Group glyphs into words: on the same line, close together.
  const boxes = tall.map((g) => ({ ...g.box })).sort((a, b) => a.x - b.x);
  const words: Rect[] = [];
  for (const b of boxes) {
    const cy = b.y + b.height / 2;
    const w = words.find((r) => {
      const ry = r.y + r.height / 2;
      const gap = b.x - (r.x + r.width);
      return Math.abs(cy - ry) <= textH * 0.6 && gap <= textH * 0.6 && gap >= -textH;
    });
    if (w) {
      const x1 = Math.max(w.x + w.width, b.x + b.width);
      const y1 = Math.max(w.y + w.height, b.y + b.height);
      w.x = Math.min(w.x, b.x);
      w.y = Math.min(w.y, b.y);
      w.width = x1 - w.x;
      w.height = y1 - w.y;
    } else words.push({ ...b });
  }
  // A word needs at least one digit-sized glyph.
  return words.filter((w) => w.height >= textH * 0.7 && w.width <= textH * 8);
}

// ---------- Key point of the curve ----------

export type Placement = 'bottom' | 'top' | 'centre' | 'follow';

export interface KeyPoint {
  x: number;
  y: number;
  /**
   * Up and down: a lowest point goes in the bottom row (the arms go up), a highest in the top row, a middle in the
   * middle. 'follow': the window is centred on the curve across its width (a line or a rising curve stays in view).
   */
  place: Placement;
  /** Across: centred, or where the curve starts at the window's left edge ('start'), or ends at its right ('end'). */
  align?: 'centre' | 'start' | 'end';
  kind: 'vertex' | 'inflection' | 'intercept' | 'root' | 'start' | 'asymptote' | 'shape' | 'middle';
  /** The traced curve: its first column and one height per column (smoothed). */
  trace?: { x0: number; ys: number[] };
  /** Where the curve turns (picture columns, left to right), when it turns more than once (a wave, a cubic). */
  turns?: number[];
  /**
   * Where its shape changes (picture columns, left to right): every turn (a peak or a trough) and every bend (where
   * it starts curving the other way). What a reader needs to find on the pins; see featureWindow.
   */
  features?: number[];
}

/** Turning points of a sequence whose swing on both sides is at least `h` (a zig-zag filter, ignores noise). */
function extremes(v: number[], h: number): { i: number; high: boolean }[] {
  const out: { i: number; high: boolean }[] = [];
  let trend = 0;
  let ext = 0;
  for (let i = 1; i < v.length; i++) {
    if (trend === 0) {
      if (v[i] - v[0] >= h) trend = 1;
      else if (v[0] - v[i] >= h) trend = -1;
      ext = i;
    } else if (trend === 1) {
      if (v[i] >= v[ext]) ext = i;
      else if (v[ext] - v[i] >= h) {
        out.push({ i: ext, high: true });
        trend = -1;
        ext = i;
      }
    } else if (v[i] <= v[ext]) ext = i;
    else if (v[i] - v[ext] >= h) {
      out.push({ i: ext, high: false });
      trend = 1;
      ext = i;
    }
  }
  return out;
}

interface Trace {
  x0: number;
  ys: number[];
  /** Two or more crossings in most columns: a closed curve (a circle) or one lying on its side. */
  closed: boolean;
  box: Rect;
  /** Boxes of every piece of this colour (a curve's branches, e.g. both halves of 1/x). */
  pieces: Rect[];
}

/**
 * Traces the main curve left to right: one height per column, following the branch nearest the previous column
 * where several cross it. The main curve spans the most columns; among similar ones (the branches of tan x) the
 * one nearest `ref` (the origin) wins.
 */
function traceCurve(mask: Float32Array, width: number, height: number, plot: Rect, ref: { x: number; y: number }): Trace | null {
  const x0 = Math.max(0, Math.floor(plot.x));
  const y0 = Math.max(0, Math.floor(plot.y));
  const x1 = Math.min(width, Math.ceil(plot.x + plot.width));
  const y1 = Math.min(height, Math.ceil(plot.y + plot.height));
  const bin = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mask[y * width + x] > 0.5) bin[y * width + x] = 1;
  // Join small breaks (a thin curve shrunk for analysis comes in dashes).
  const { labels, components } = labelComponents(dilate(bin, width, height, 2, 2), width, height);
  const pieces = components.filter((c) => Math.hypot(c.box.width, c.box.height) >= Math.min(plot.width, plot.height) * 0.1);
  if (!pieces.length) return null;
  const widest = Math.max(...pieces.map((c) => c.box.width));
  const distTo = (r: Rect) => Math.hypot(Math.max(r.x - ref.x, 0, ref.x - (r.x + r.width)), Math.max(r.y - ref.y, 0, ref.y - (r.y + r.height)));
  const main = pieces.filter((c) => c.box.width >= widest * 0.8).reduce((a, b) => (distTo(b.box) < distTo(a.box) ? b : a));
  const ids = joinBreaks(main, pieces, components, labels, bin, width, Math.max(6, Math.min(plot.width, plot.height) * 0.03));
  const box = [...ids].map((i) => components[i - 1].box).reduce(union);
  if (box.width < 8) return null;
  const ys: number[] = [];
  let prev = NaN;
  let multi = 0;
  for (let x = box.x; x < box.x + box.width; x++) {
    // Runs of this curve's pixels in the column; pick the one closest to the previous column.
    let best = NaN;
    let runs = 0;
    let runStart = -1;
    for (let y = box.y; y <= box.y + box.height; y++) {
      const on = y < box.y + box.height && bin[y * width + x] === 1 && ids.has(labels[y * width + x]);
      if (on && runStart < 0) runStart = y;
      if (!on && runStart >= 0) {
        const c = (runStart + y - 1) / 2;
        runs++;
        if (Number.isNaN(best) || (!Number.isNaN(prev) && Math.abs(c - prev) < Math.abs(best - prev))) best = c;
        runStart = -1;
      }
    }
    if (runs >= 2) multi++;
    ys.push(best);
    if (!Number.isNaN(best)) prev = best;
  }
  // Fill columns with no pixel (gaps) by straight lines between their neighbours.
  let last = -1;
  for (let i = 0; i < ys.length; i++) {
    if (Number.isNaN(ys[i])) continue;
    if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) ys[k] = ys[last] + ((ys[i] - ys[last]) * (k - last)) / (i - last);
    if (last < 0) for (let k = 0; k < i; k++) ys[k] = ys[i];
    last = i;
  }
  if (last < 0) return null;
  for (let k = last + 1; k < ys.length; k++) ys[k] = ys[last];
  const closed = multi >= box.width * 0.6 && box.height >= box.width * 0.2;
  // The joined pieces count as one curve: the 1/x check in analyseCurve must not take two arms for two branches.
  const others = pieces.filter((c) => !ids.has(components.indexOf(c) + 1)).map((c) => c.box);
  return { x0: box.x, ys, closed, box, pieces: [box, ...others] };
}

/**
 * The main piece plus the pieces that continue it across a short break: one whose end (leftmost or rightmost
 * column) lies within `gap` px of the curve's end on that side. A curve loses a few pixels where it runs along a
 * dark axis (a parabola's vertex sits on the x-axis) or fades in a shrunk live frame; traced as separate pieces,
 * one arm of a parabola looks like a curve that stops at the vertex. Branches of 1/x or tan x end at opposite
 * edges of the plot, far apart, so they stay separate. Returns the pieces' labels.
 */
function joinBreaks(
  main: Component,
  pieces: Component[],
  components: Component[],
  labels: Int32Array,
  bin: Uint8Array,
  width: number,
  gap: number,
): Set<number> {
  /** Middle row of the piece's pixels in one column. */
  const rowAt = (id: number, x: number, b: Rect) => {
    let sum = 0;
    let n = 0;
    for (let y = b.y; y < b.y + b.height; y++)
      if (bin[y * width + x] && labels[y * width + x] === id) {
        sum += y;
        n++;
      }
    return n ? sum / n : b.y + b.height / 2;
  };
  const ends = new Map<number, { left: { x: number; y: number }; right: { x: number; y: number } }>();
  const endsOf = (id: number) => {
    let e = ends.get(id);
    if (!e) {
      const b = components[id - 1].box;
      const r = b.x + b.width - 1;
      e = { left: { x: b.x, y: rowAt(id, b.x, b) }, right: { x: r, y: rowAt(id, r, b) } };
      ends.set(id, e);
    }
    return e;
  };
  const mainId = components.indexOf(main) + 1;
  const ids = new Set([mainId]);
  let { left, right } = endsOf(mainId);
  for (let grew = true; grew; ) {
    grew = false;
    for (const piece of pieces) {
      const id = components.indexOf(piece) + 1;
      if (ids.has(id)) continue;
      const e = endsOf(id);
      // Continues the curve to the left (it lies left of it, its right end at the curve's left end), or right.
      if (e.right.x <= left.x + 2 && Math.hypot(e.right.x - left.x, e.right.y - left.y) <= gap) {
        ids.add(id);
        left = e.left;
        grew = true;
      } else if (e.left.x >= right.x - 2 && Math.hypot(e.left.x - right.x, e.left.y - right.y) <= gap) {
        ids.add(id);
        right = e.right;
        grew = true;
      }
    }
  }
  return ids;
}

function smooth(v: number[], r: number): number[] {
  if (r < 1) return v;
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(v.length - 1, i + r); k++) {
      s += v[k];
      n++;
    }
    out[i] = s / n;
  }
  return out;
}

/**
 * The point that describes the graph best (see the top of this file). Pixel coordinates; rows grow downwards,
 * so a curve's lowest point (a parabola's vertex) is its largest row.
 *
 * With several curves (`rgb` given), each colour is traced on its own (where they cross they'd otherwise join),
 * and the one with the most shape wins: a turn or bend over a straight line, then the longest.
 */
export function curveKeyPoint(mask: Float32Array, width: number, height: number, axes: GraphAxes, rgb?: ArrayLike<number>): KeyPoint | null {
  const curves = rgb ? splitByColour(mask, rgb, axes.plot, width, height) : [mask];
  let best: { key: KeyPoint; features: number; span: number } | null = null;
  for (const m of curves) {
    const a = analyseCurve(m, width, height, axes);
    if (!a) continue;
    if (!best || a.features > best.features || (a.features === best.features && a.span > best.span)) best = a;
  }
  return best?.key ?? null;
}

/** The mask split into one mask per curve colour (hue, or grey for black and grey curves); small ones dropped. */
function splitByColour(mask: Float32Array, rgb: ArrayLike<number>, plot: Rect, width: number, height: number): Float32Array[] {
  const BINS = 12;
  const bins = new Int8Array(width * height).fill(-1);
  const counts = new Array<number>(BINS + 1).fill(0);
  const x0 = Math.max(0, Math.floor(plot.x));
  const y0 = Math.max(0, Math.floor(plot.y));
  const x1 = Math.min(width, Math.ceil(plot.x + plot.width));
  const y1 = Math.min(height, Math.ceil(plot.y + plot.height));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (mask[p] <= 0.5) continue;
      const r = rgb[p * 3];
      const g = rgb[p * 3 + 1];
      const b = rgb[p * 3 + 2];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      let bin = BINS; // grey
      if (d >= 35) {
        let hh: number;
        if (max === r) hh = ((g - b) / d) % 6;
        else if (max === g) hh = (b - r) / d + 2;
        else hh = (r - g) / d + 4;
        bin = Math.floor((((hh * 60 + 360) % 360) / 360) * BINS) % BINS;
      }
      bins[p] = bin;
      counts[bin]++;
    }
  // Neighbouring hue bins hold one colour split by anti-aliasing: merge each bin into its biggest neighbour chain.
  const top = Math.max(...counts);
  if (!top) return [];
  const out: Float32Array[] = [];
  const taken = new Array<boolean>(BINS + 1).fill(false);
  const order = counts.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
  for (const bin of order) {
    if (taken[bin] || counts[bin] < top * 0.2) continue;
    const group = [bin];
    taken[bin] = true;
    if (bin < BINS)
      for (const nb of [(bin + 1) % BINS, (bin + BINS - 1) % BINS])
        if (!taken[nb] && counts[nb] > 0 && counts[nb] < counts[bin]) {
          group.push(nb);
          taken[nb] = true;
        }
    const m = new Float32Array(width * height);
    for (let p = 0; p < m.length; p++) if (bins[p] >= 0 && group.includes(bins[p])) m[p] = 1;
    out.push(m);
  }
  return out;
}

function analyseCurve(mask: Float32Array, width: number, height: number, axes: GraphAxes): { key: KeyPoint; features: number; span: number } | null {
  const { plot } = axes;
  const ref = {
    x: axes.originX ?? plot.x + plot.width / 2,
    y: axes.originY ?? plot.y + plot.height / 2,
  };
  const trace = traceCurve(mask, width, height, plot, ref);
  if (!trace) return null;
  const { x0 } = trace;
  const n = trace.ys.length;
  /** `features`: 2 for a turn or a closed shape, 1 for a bend only, 0 for neither (a line). */
  let found: number[] = [];

  // A closed curve (a circle, an ellipse): the whole shape, centred.
  if (trace.closed) {
    const b = trace.box;
    return { key: { x: b.x + b.width / 2, y: b.y + b.height / 2, place: 'centre', kind: 'shape' }, features: 2, span: n };
  }

  const ys = smooth(trace.ys, Math.max(1, Math.round(n * 0.01)));
  const wrap = (key: KeyPoint, features: number) => ({ key: { ...key, trace: { x0, ys }, features: found }, features, span: n });
  const at = (i: number) => ({ x: x0 + i, y: ys[i] });
  const dist = (i: number) => Math.hypot(x0 + i - ref.x, ys[i] - ref.y);
  // Where the curve runs off the top or bottom of the plot, its trace lies flat along the edge: a straight line
  // would seem to bend there. Turns and bends are only looked for between those clipped ends (lo..hi).
  // A steep curve leaving the plot fills several pixels of its last column, so its traced height there sits a few
  // pixels inside the edge: "at the edge" allows for that.
  const edge = Math.max(6, Math.min(plot.width, plot.height) * 0.025);
  // The left and right edges cut the stroke too (its last columns flatten), so those count as well.
  const clipped = (i: number) =>
    ys[i] <= plot.y + edge || ys[i] >= plot.y + plot.height - edge || x0 + i <= plot.x + edge || x0 + i >= plot.x + plot.width - edge;
  let lo = 0;
  while (lo < n - 1 && clipped(lo)) lo++;
  let hi = n - 1;
  while (hi > lo && clipped(hi)) hi--;
  // Ignore the very ends too: a curve leaving the plot can look like it turns.
  const margin = Math.max(2, Math.round(n * 0.03));
  const inside = (i: number) => i >= lo + margin && i <= hi - margin;
  const within = <T extends { i: number }>(found: T[]) => found.map((f) => ({ ...f, i: f.i + lo }));

  const swing = Math.max(3, plot.height * 0.03);
  // A turn is flat for a few pixels (a parabola's bottom lies in one pixel row over several columns), and the
  // zig-zag filter returns one end of that flat stretch: the turn is its middle. Otherwise every vertex sits a few
  // pixels to one side, and the window with it (the arms land unevenly on the pins).
  const flatMiddle = (i: number) => {
    let a = i;
    let b = i;
    while (a > lo && Math.abs(ys[a - 1] - ys[i]) <= 0.75) a--;
    while (b < hi && Math.abs(ys[b + 1] - ys[i]) <= 0.75) b++;
    return Math.round((a + b) / 2);
  };
  const turns = within(extremes(ys.slice(lo, hi + 1), swing))
    .map((t) => ({ ...t, i: flatMiddle(t.i) }))
    .filter((t) => inside(t.i));
  // Bends: where the direction (angle) stops turning one way and starts the other.
  const r = Math.max(2, Math.round(n * 0.02));
  const angle = ys.map((_, i) => Math.atan2(ys[Math.min(n - 1, i + r)] - ys[Math.max(0, i - r)], Math.min(n - 1, i + r) - Math.max(0, i - r)));
  // Only angles measured wholly between the clipped ends: one whose ±r window reaches past them would mix in
  // the flattened edge and fake a bend on a straight line.
  const a0 = Math.min(lo + r, hi);
  const a1 = Math.max(a0, hi - r);
  const bends = extremes(angle.slice(a0, a1 + 1), 0.25)
    .map((b) => ({ ...b, i: b.i + a0 }))
    .filter((b) => inside(b.i));
  found = [...turns, ...bends].map((t) => x0 + t.i).sort((a, b) => a - b);

  if (turns.length === 1) {
    const t = turns[0];
    // Rows grow downwards: a "high" row value is the curve's lowest point.
    return wrap({ ...at(t.i), place: t.high ? 'bottom' : 'top', kind: 'vertex' }, 2);
  }
  if (turns.length >= 2) {
    // The pair of neighbouring turns nearest the origin.
    let pick = 0;
    let bestD = Infinity;
    for (let k = 0; k + 1 < turns.length; k++) {
      const mid = Math.round((turns[k].i + turns[k + 1].i) / 2);
      if (dist(mid) < bestD) {
        bestD = dist(mid);
        pick = k;
      }
    }
    // Halfway between them: exact for a cubic (symmetric about its middle) and a wave, and steadier than locating
    // the bend itself on a steep stretch.
    const i = Math.round((turns[pick].i + turns[pick + 1].i) / 2);
    return wrap({ ...at(i), place: 'centre', kind: 'inflection', turns: turns.map((t) => x0 + t.i) }, 2);
  }
  if (bends.length) {
    const i = bends.reduce((p, q) => (dist(q.i) < dist(p.i) ? q : p)).i;
    return wrap({ ...at(i), place: 'centre', kind: 'inflection' }, 1);
  }

  // No turn or bend (a line, a square root, a logarithm, 1/x): the window follows the curve up and down.
  const tr = { x0, ys };
  const follow = (i: number, kind: KeyPoint['kind'], align: KeyPoint['align'] = 'centre') =>
    wrap({ ...at(i), place: 'follow', align, kind, trace: tr }, 0);
  // Branches on both sides of the y-axis that never cross it (1/x): the origin, between them.
  if (axes.originX !== null && axes.originY !== null) {
    const ox = axes.originX;
    // A branch hugging the axis (1/x near 0) reaches it, so a few pixels of overlap still count as one side.
    const hug = Math.max(4, plot.width * 0.01);
    const left = trace.pieces.some((b) => b.x + b.width <= ox + hug && b.x + b.width / 2 < ox);
    const right = trace.pieces.some((b) => b.x >= ox - hug && b.x + b.width / 2 > ox);
    const crosses = trace.pieces.some((b) => b.x < ox - hug && b.x + b.width > ox + hug);
    if (left && right && !crosses) return wrap({ x: ox, y: axes.originY, place: 'centre', kind: 'asymptote' }, 0);
  }
  // Starts (or ends) inside the plot, not at its border (the square root's corner): from there.
  const endInside = (i: number) =>
    ys[i] > plot.y + edge && ys[i] < plot.y + plot.height - edge && x0 + i > plot.x + edge && x0 + i < plot.x + plot.width - edge;
  if (endInside(0) && !endInside(n - 1)) return follow(0, 'start', 'start');
  if (endInside(n - 1) && !endInside(0)) return follow(n - 1, 'start', 'end');
  // Where it crosses the y-axis, else the x-axis, else the point nearest the origin.
  if (axes.originX !== null && axes.originX >= x0 && axes.originX < x0 + n) return follow(Math.round(axes.originX - x0), 'intercept');
  if (axes.originY !== null) {
    const oy = axes.originY;
    let root = -1;
    for (let i = 1; i < n; i++) if ((ys[i - 1] - oy) * (ys[i] - oy) <= 0 && (root < 0 || dist(i) < dist(root))) root = i;
    if (root >= 0) return follow(root, 'root');
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (dist(i) < dist(best)) best = i;
  return follow(best, 'middle');
}

// ---------- Whole curve ----------

/**
 * Pin columns one wave needs to read as a wave (down, up and back). With fewer, each column holds a steep stretch
 * that crosses every row, and the wave fills in: 2 waves on 6 columns raised 19 of 30 pins, 1 wave 13 in a clear
 * trough-and-peak.
 */
export const COLUMNS_PER_WAVE = 4;

/**
 * The whole curve, unless it has more waves than the pins can show: then as many whole waves as fit, the ones
 * nearest the key point (the middle of the graph). On 6 columns that is 1 wave, on 8 columns 2; a sine drawn over 3
 * waves would raise nearly every pin. Null when everything fits (show the whole curve as it is).
 *
 * `box` is the whole curve's box; the part returned keeps its height (the waves' full swing) and is cut across at
 * half a wave beyond the outer turns shown, so every wave shown is complete.
 */
export function wavesThatFit(key: KeyPoint | null, box: Rect, cols: number): { box: Rect; shown: number; total: number } | null {
  const turns = key?.turns;
  if (!key || !turns || turns.length < 3) return null;
  // Two turns to a wave (a peak and a trough); whole waves only. Three turns are a shape, not waves (the W of
  // x⁴ − 4x²), and fit on 6 columns.
  const maxTurns = 2 * Math.max(1, Math.floor(cols / COLUMNS_PER_WAVE));
  if (turns.length <= Math.max(maxTurns, SHAPE_TURNS)) return null;
  const gaps = turns.slice(1).map((t, i) => t - turns[i]);
  const half = median(gaps) / 2;
  // The run of maxTurns turns whose middle is nearest the key point.
  let start = 0;
  let best = Infinity;
  for (let a = 0; a + maxTurns <= turns.length; a++) {
    const mid = (turns[a] + turns[a + maxTurns - 1]) / 2;
    const d = Math.abs(mid - key.x);
    if (d < best) {
      best = d;
      start = a;
    }
  }
  const x0 = Math.max(box.x, turns[start] - half);
  const x1 = Math.min(box.x + box.width, turns[start + maxTurns - 1] + half);
  return {
    box: { x: x0, width: x1 - x0, ...heightAcross(key.trace, x0, x1, box) },
    shown: maxTurns / 2,
    total: Math.round(turns.length / 2),
  };
}

/**
 * The curve's height between columns x0 and x1 (its traced middle line, plus 2 px for the stroke), within `box`.
 * The whole curve's height when there's no trace. Fitting it keeps a part of the curve from being squashed by
 * the rest: the middle waves of x sin x are a quarter as tall as its outer ones.
 */
function heightAcross(trace: KeyPoint['trace'], x0: number, x1: number, box: Rect): { y: number; height: number } {
  let top = Infinity;
  let bottom = -Infinity;
  if (trace)
    for (let c = Math.max(0, Math.floor(x0 - trace.x0)); c <= Math.min(trace.ys.length - 1, Math.ceil(x1 - trace.x0)); c++) {
      top = Math.min(top, trace.ys[c]);
      bottom = Math.max(bottom, trace.ys[c]);
    }
  if (!Number.isFinite(top)) return { y: box.y, height: box.height };
  const y0 = Math.max(box.y, top - 2);
  const y1 = Math.min(box.y + box.height, bottom + 2);
  return { y: y0, height: Math.max(1, y1 - y0) };
}

/** Up to this many turns, a curve is one shape (a W, an M), shown whole; more are waves (see wavesThatFit). */
export const SHAPE_TURNS = 3;

/**
 * Margin each side of the outermost features, in feature gaps (the median distance between neighbouring features):
 * enough to show which way the curve leaves them (x³ − 3x carries on up and down), not so much that its arms,
 * shooting off far beyond the features' height, squash them flat.
 */
export const FEATURE_MARGIN = 1;
/** Neighbouring features further apart than this (in median gaps) don't belong to the same part of the curve. */
export const FEATURE_GROUP = 1.5;

/**
 * The part of the curve with the most to feel: all its features (turns and bends, see KeyPoint), with a margin,
 * at the curve's own height there. The whole curve often hides them: x³ − 3x turns at y = ±2 but its arms reach
 * y = ±10 across the plot, so on 5 rows the turns fall in one row; a bell curve is a narrow bump in a wide flat
 * line. Null when the whole curve is as good: fewer than two features (a parabola's vertex, x³'s bend, a line), or
 * the features already span most of it.
 *
 * `box` is the whole curve's box. The window keeps within it, across and up and down.
 */
export function featureWindow(key: KeyPoint | null, box: Rect, margin = FEATURE_MARGIN): Rect | null {
  const all = key?.features;
  if (!key || !all || all.length < 2) return null;
  const gap = median(all.slice(1).map((v, i) => v - all[i]));
  // The features that belong together: from the one nearest the key point, out to neighbours no further than
  // FEATURE_GROUP gaps away. A faint ripple far out (the tail of sin x / x, found on one side only) is left out.
  let a = all.reduce((best, v, i) => (Math.abs(v - key.x) < Math.abs(all[best] - key.x) ? i : best), 0);
  let b = a;
  while (a > 0 && all[a] - all[a - 1] <= gap * FEATURE_GROUP) a--;
  while (b < all.length - 1 && all[b + 1] - all[b] <= gap * FEATURE_GROUP) b++;
  if (b === a) return null;
  const x0 = Math.max(box.x, all[a] - gap * margin);
  const x1 = Math.min(box.x + box.width, all[b] + gap * margin);
  if (x1 - x0 >= box.width * 0.85) return null;
  return { x: x0, width: x1 - x0, ...heightAcross(key.trace, x0, x1, box) };
}

// ---------- Window ----------

/** Smallest window, in working-image pixels per pin column: fewer pixels than this per pin is just noise. */
export const MIN_PX_PER_PIN = 5;

export interface GraphWindow {
  box: Rect;
  /**
   * 'exact': the range asked for. 'grown': the graph is zoomed out so far that the range would be a few
   * pixels, so the window is larger. 'shrunk': the screen shows less than the range (zoomed in): the window keeps
   * its size in units and reaches past the plot, and the pins out there stay down.
   */
  fit: 'exact' | 'grown' | 'shrunk';
}

/**
 * The part of the graph to show: `range` units each side of the key point across, the same scale up and down,
 * in the pins' proportions (cols x rows). A lowest point sits in the bottom row, a highest in the top row.
 * Kept inside the visible plot where it fits, and at least MIN_PX_PER_PIN pixels per pin.
 *
 * Zoomed in so far that the plot shows less than the range, the window is NOT shrunk to the plot: that would
 * stretch the visible part over all the pins and the curve would grow on the board with every zoom. It keeps its
 * size in units, placed around the key point as usual, so the curve stays the same size on the board and the
 * part of the range that is off screen is just empty pins.
 */
export function graphWindow(
  key: KeyPoint,
  scale: GraphScale,
  range: number,
  plot: Rect,
  rows: number,
  cols: number,
  pinPitchRatio = 1,
  /** Moved by the user (graph units, right and up) from where the key point puts it. */
  pan: { x: number; y: number } = { x: 0, y: 0 },
): GraphWindow {
  const unitsWide = 2 * range;
  const unitsTall = (unitsWide * rows) / (cols * pinPitchRatio);
  let w = unitsWide * scale.pxPerUnitX;
  let h = unitsTall * scale.pxPerUnitY;
  let fit: GraphWindow['fit'] = 'exact';
  const grow = Math.max(1, (cols * MIN_PX_PER_PIN) / w, (rows * MIN_PX_PER_PIN) / h);
  if (grow > 1.02) fit = 'grown';
  w *= grow;
  h *= grow;
  const fitsX = w <= plot.width * 1.02;
  const fitsY = h <= plot.height * 1.02;
  if (!fitsX || !fitsY) fit = 'shrunk';
  // Slid to stay inside the plot, along each side it fits on.
  const keepIn = (v: number, size: number, start: number, length: number, fits: boolean) =>
    fits ? Math.min(Math.max(v, start), start + length - size) : v;
  const row = h / rows;
  const col = w / cols;
  let x = key.align === 'start' ? key.x - col / 2 : key.align === 'end' ? key.x + col / 2 - w : key.x - w / 2;
  x = keepIn(x, w, plot.x, plot.width, fitsX);
  let y: number;
  if (key.place === 'bottom') y = key.y + row / 2 - h;
  else if (key.place === 'top') y = key.y - row / 2;
  else if (key.place === 'follow' && key.trace) {
    // Centred on the curve's average height across the window, keeping the key point itself inside.
    const { x0, ys } = key.trace;
    let sum = 0;
    let count = 0;
    for (let c = Math.max(0, Math.floor(x - x0)); c < Math.min(ys.length, Math.ceil(x + w - x0)); c++) {
      sum += ys[c];
      count++;
    }
    y = (count ? sum / count : key.y) - h / 2;
    y = Math.min(Math.max(y, key.y + row / 2 - h), key.y - row / 2);
  } else y = key.y - h / 2;
  y = keepIn(y, h, plot.y, plot.height, fitsY);
  // Panned by the user: moved that many units, wherever that leads (past the plot, those pins stay down).
  x += pan.x * scale.pxPerUnitX;
  y -= pan.y * scale.pxPerUnitY;
  const rx = Math.round(x);
  const ry = Math.round(y);
  return { box: { x: rx, y: ry, width: Math.max(1, Math.round(x + w) - rx), height: Math.max(1, Math.round(y + h) - ry) }, fit };
}

/**
 * Snaps the key point to a tidy value (a tenth of the numbered step, e.g. 0.5 when lines are numbered every 5)
 * when it's within 3 pixels of one: the vertex of y = x² is at exactly 0, not 0.05.
 */
export function tidyKeyPoint(key: KeyPoint, axes: GraphAxes, scale: GraphScale): KeyPoint {
  const snap = (v: number, origin: number | null, ppu: number, unitsPerMajor: number, sign: 1 | -1) => {
    if (origin === null) return v;
    const units = (sign * (v - origin)) / ppu;
    const step = unitsPerMajor / 10;
    const tidy = Math.round(units / step) * step;
    return Math.abs(tidy - units) * ppu <= 3 ? origin + sign * tidy * ppu : v;
  };
  return {
    ...key,
    x: snap(key.x, axes.originX, scale.pxPerUnitX, scale.unitsPerMajorX, 1),
    y: snap(key.y, axes.originY, scale.pxPerUnitY, scale.unitsPerMajorY, -1),
  };
}

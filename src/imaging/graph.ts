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
import { dilate, labelComponents } from './masks';
import type { Rect } from './geometry';

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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

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
  const d = gridStep(all.map((l) => l.at));
  if (!d) return null;
  const at0 = axis?.at ?? lines[0]?.at ?? 0;
  // Each line's place in the lattice (lines off it are strays: labels, the curve, UI).
  const placed = lines
    .map((l) => ({ l, i: Math.round((l.at - at0) / d) }))
    .filter(({ l, i }) => Math.abs(l.at - at0 - i * d) <= Math.max(1.5, d * 0.25));
  const mean = (xs: { l: AxisLine }[]) => xs.reduce((t, x) => t + x.l.depth, 0) / xs.length;
  let best = { k: 1, ratio: 1 };
  for (const k of [2, 4, 5, 10]) {
    // With the axis on screen, the major lines include it (offset 0).
    for (let phase = 0; phase < (axis ? 1 : k); phase++) {
      const sel = placed.filter(({ i }) => (((i - phase) % k) + k) % k === 0);
      const rest = placed.filter(({ i }) => (((i - phase) % k) + k) % k !== 0);
      if (sel.length < (axis ? 1 : 2) || rest.length < 2) continue;
      const ratio = mean(sel) / Math.max(1, mean(rest));
      // A longer period must be clearly better (every 10th line is also every 5th).
      if (ratio > best.ratio * (best.k === 1 ? 1 : 1.12)) best = { k, ratio };
    }
  }
  // The spacing, fitted over every line's position (least squares on its lattice place): far more precise than
  // one gap, and multiplying by the period would multiply any error.
  const pts = placed.map(({ l, i }) => ({ i, at: l.at }));
  if (axis) pts.push({ i: 0, at: axis.at });
  let fitted = d;
  if (pts.length >= 3) {
    const mi = pts.reduce((t, p) => t + p.i, 0) / pts.length;
    const ma = pts.reduce((t, p) => t + p.at, 0) / pts.length;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.i - mi) * (p.at - ma);
      den += (p.i - mi) ** 2;
    }
    if (den > 0 && Math.abs(num / den / d - 1) < 0.1) fitted = num / den;
  }
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

// ---------- Scale from the axis numbers ----------

/** A number read next to an axis: its value and where it sits along that axis (x for the x-axis, y for the y-axis). */
export interface AxisReading {
  axis: 'x' | 'y';
  value: number;
  at: number;
}

export interface GraphScale {
  /** Pixels per unit across (x) and down (y). */
  pxPerUnitX: number;
  pxPerUnitY: number;
  /** Units per major grid square, measured with the grid spacing below (to reuse while the zoom is unchanged). */
  unitsPerMajorX: number;
  unitsPerMajorY: number;
  majorX: number;
  majorY: number;
  /** 'labels': from the printed numbers. 'grid': assumed one unit per major grid square. */
  from: 'labels' | 'grid';
}

/** Graphing tools number their gridlines in steps of 1, 2 or 5 (minor lines also 2.5) times a power of 10. */
function snapStep(u: number): number | null {
  if (!(u > 0) || !Number.isFinite(u)) return null;
  const p = Math.pow(10, Math.floor(Math.log10(u)));
  let best: number | null = null;
  for (const m of [1, 2, 2.5, 5, 10]) {
    const c = m * p;
    if (Math.abs(Math.log(u / c)) < 0.08 && (best === null || Math.abs(u - c) < Math.abs(u - best))) best = c;
  }
  return best;
}

/** Pixels per unit along one axis from its numbers: robust to misread or missing labels (a lost minus sign too). */
function axisScale(readings: AxisReading[], origin: number | null, major: number | null): number | null {
  const candidates: number[] = [];
  const minDistance = (major ?? 20) * 0.3;
  if (origin !== null) {
    for (const r of readings)
      if (r.value !== 0 && Math.abs(r.at - origin) >= minDistance) candidates.push(Math.abs(r.at - origin) / Math.abs(r.value));
  } else {
    // Axis off screen: the numbers are all on one side, so their magnitudes step evenly. Consensus (RANSAC): the
    // line through each pair of readings is tried, and the one most readings agree with wins, so misreads
    // (a lost first digit: "4" for 14) can't drag it. Then a least-squares fit on the agreeing readings.
    const mags = readings.map((r) => ({ v: Math.abs(r.value), at: r.at }));
    const tol = Math.max(2, (major ?? 20) * 0.15);
    let best: { v: number; at: number }[] = [];
    for (let i = 0; i < mags.length; i++)
      for (let j = i + 1; j < mags.length; j++) {
        const dv = mags[j].v - mags[i].v;
        const dp = mags[j].at - mags[i].at;
        if (dv === 0 || Math.abs(dp) < minDistance) continue;
        const slope = dp / dv;
        const o = mags[i].at - slope * mags[i].v;
        const inliers = mags.filter((m) => Math.abs(o + slope * m.v - m.at) <= tol);
        if (inliers.length > best.length) best = inliers;
      }
    if (best.length < 3) return null;
    const mv = best.reduce((t, p) => t + p.v, 0) / best.length;
    const ma = best.reduce((t, p) => t + p.at, 0) / best.length;
    let num = 0;
    let den = 0;
    for (const p of best) {
      num += (p.v - mv) * (p.at - ma);
      den += (p.v - mv) ** 2;
    }
    return den > 0 ? Math.abs(num / den) : null;
  }
  if (!candidates.length) return null;
  const m = median(candidates);
  const agree = candidates.filter((c) => Math.abs(c / m - 1) <= 0.06);
  // Two numbers must agree (one could be a misread), unless the grid confirms the only one.
  if (agree.length < 2 && !(agree.length === 1 && major && snapStep(major / m))) return null;
  return agree.reduce((a, b) => a + b, 0) / agree.length;
}

/**
 * Pixels per unit from the axis numbers, snapped to the grid (numbered lines are 1, 2 or 5 x 10^n units
 * apart), so a few pixels of label position error don't matter. One readable axis is enough: graphs use the
 * same scale on both unless the numbers say otherwise. Null if neither axis can be read.
 */
export function scaleFromLabels(axes: GraphAxes, readings: AxisReading[]): GraphScale | null {
  const rawX = axisScale(
    readings.filter((r) => r.axis === 'x'),
    axes.originX,
    axes.majorX,
  );
  const rawY = axisScale(
    readings.filter((r) => r.axis === 'y'),
    axes.originY,
    axes.majorY,
  );
  if (rawX === null && rawY === null) return null;
  const snapped = (raw: number | null, major: number | null) => {
    if (raw === null) return null;
    const u = major ? snapStep(major / raw) : null;
    return u && major ? { ppu: major / u, u } : { ppu: raw, u: major ? major / raw : 1 };
  };
  const sx = snapped(rawX, axes.majorX);
  const sy = snapped(rawY, axes.majorY);
  const x = sx ?? sy!;
  const y = sy ?? sx!;
  return {
    pxPerUnitX: x.ppu,
    pxPerUnitY: y.ppu,
    unitsPerMajorX: axes.majorX ? axes.majorX / x.ppu : x.u,
    unitsPerMajorY: axes.majorY ? axes.majorY / y.ppu : y.u,
    majorX: axes.majorX ?? x.ppu * x.u,
    majorY: axes.majorY ?? y.ppu * y.u,
    from: 'labels',
  };
}

/** No readable numbers: one major grid square counts as one unit. Null without a measurable grid. */
export function scaleFromGrid(axes: GraphAxes): GraphScale | null {
  const mx = axes.majorX ?? axes.majorY;
  const my = axes.majorY ?? axes.majorX;
  if (!mx || !my) return null;
  return { pxPerUnitX: mx, pxPerUnitY: my, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: mx, majorY: my, from: 'grid' };
}

/**
 * A scale measured earlier (numbers are read once, not every frame of a live share) applied to the current
 * grid: valid while the zoom is unchanged (grid spacing within 6%); a pan doesn't change it.
 */
export function rescale(scale: GraphScale, axes: GraphAxes): GraphScale | null {
  const close = (a: number | null, b: number) => a !== null && Math.abs(a / b - 1) <= 0.06;
  if (!close(axes.majorX, scale.majorX) && !close(axes.majorY, scale.majorY)) return null;
  const mx = close(axes.majorX, scale.majorX) ? axes.majorX! : scale.majorX;
  const my = close(axes.majorY, scale.majorY) ? axes.majorY! : scale.majorY;
  return { ...scale, majorX: mx, majorY: my, pxPerUnitX: mx / scale.unitsPerMajorX, pxPerUnitY: my / scale.unitsPerMajorY };
}

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
  /** The traced curve, for 'follow': its first column and one height per column. */
  trace?: { x0: number; ys: number[] };
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
  const id = components.indexOf(main) + 1;
  const box = main.box;
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
      const on = y < box.y + box.height && bin[y * width + x] === 1 && labels[y * width + x] === id;
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
  return { x0: box.x, ys, closed, box, pieces: pieces.map((c) => c.box) };
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
  const order = counts.map((c, i) => i).sort((a, b) => counts[b] - counts[a]);
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
  const wrap = (key: KeyPoint, features: number) => ({ key, features, span: n });

  // A closed curve (a circle, an ellipse): the whole shape, centred.
  if (trace.closed) {
    const b = trace.box;
    return wrap({ x: b.x + b.width / 2, y: b.y + b.height / 2, place: 'centre', kind: 'shape' }, 2);
  }

  const ys = smooth(trace.ys, Math.max(1, Math.round(n * 0.01)));
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
  const turns = within(extremes(ys.slice(lo, hi + 1), swing)).filter((t) => inside(t.i));
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
    return wrap({ ...at(i), place: 'centre', kind: 'inflection' }, 2);
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

// ---------- Window ----------

/** Smallest window, in working-image pixels per pin column: fewer pixels than this per pin is just noise. */
export const MIN_PX_PER_PIN = 5;

export interface GraphWindow {
  box: Rect;
  /**
   * 'exact': the range asked for. 'grown': the graph is zoomed out so far that the range would be a few
   * pixels, so the window is larger. 'shrunk': the screen shows less than the range.
   */
  fit: 'exact' | 'grown' | 'shrunk';
}

/**
 * The part of the graph to show: `range` units each side of the key point across, the same scale up and down,
 * in the pins' proportions (cols x rows). A lowest point sits in the bottom row, a highest in the top row.
 * Kept inside the visible plot (shrunk to fit if the plot shows less than the range), and at least
 * MIN_PX_PER_PIN pixels per pin.
 */
export function graphWindow(
  key: KeyPoint,
  scale: GraphScale,
  range: number,
  plot: Rect,
  rows: number,
  cols: number,
  pinPitchRatio = 1,
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
  const shrink = Math.min(1, plot.width / w, plot.height / h);
  if (shrink < 0.98) fit = 'shrunk';
  w *= shrink;
  h *= shrink;
  const row = h / rows;
  const col = w / cols;
  let x = key.align === 'start' ? key.x - col / 2 : key.align === 'end' ? key.x + col / 2 - w : key.x - w / 2;
  x = Math.min(Math.max(x, plot.x), plot.x + plot.width - w);
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
  y = Math.min(Math.max(y, plot.y), plot.y + plot.height - h);
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

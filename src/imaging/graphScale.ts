/**
 * A graph's scale: pixels per unit across and down. From the numbers printed along the axes (read by OCR, see
 * axisNumbers.web.ts), checked against the grid; from the grid alone when the numbers can't be read; carried to a
 * new grid while the zoom is unchanged (rescale) or through a live zoom (followZoom). Pure functions (unit tested).
 */
import type { GraphAxes } from './graph';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

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
  /**
   * Live camera: how wide the locked graph was (frame pixels, as tracked) when this scale was measured. Its
   * width now tells how much closer or further the phone is, far more steadily than gridlines in a noisy frame.
   */
  atWidth?: number;
  /** Carried through a zoom by followZoom (not read at this zoom yet): the numbers are read once the zoom settles. */
  followed?: boolean;
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
export function rescale(scale: GraphScale, axes: GraphAxes, anyZoom = false): GraphScale | null {
  // `anyZoom` (the camera locked onto this graph): any size from 40% to 250% is the same graph seen closer or further.
  const close = (a: number | null, b: number) => a !== null && (anyZoom ? a / b >= 0.4 && a / b <= 2.5 : Math.abs(a / b - 1) <= 0.06);
  if (!close(axes.majorX, scale.majorX) && !close(axes.majorY, scale.majorY)) return null;
  const mx = close(axes.majorX, scale.majorX) ? axes.majorX! : scale.majorX;
  const my = close(axes.majorY, scale.majorY) ? axes.majorY! : scale.majorY;
  return { ...scale, majorX: mx, majorY: my, pxPerUnitX: mx / scale.unitsPerMajorX, pxPerUnitY: my / scale.unitsPerMajorY };
}

/**
 * A live share being zoomed: the scale of the previous frame carried to this one, without reading the numbers
 * again. Graphing tools number their major gridlines every 1, 2 or 5 x 10^n units and switch to the next step as
 * you zoom, so the grid's spacing in pixels alone is ambiguous (half the spacing: zoomed out 2x, or the step went
 * from 2 to 1). Between two frames the zoom changes little, though, so the step is the one in that series that
 * keeps pixels per unit closest to the previous frame's, and the spacing measured now gives the exact scale.
 * Steps differ by at least 2x, so this is unambiguous for any zoom up to about 1.4x per frame. Null when the
 * grid can't be measured or the change is too big to tell (then the numbers are read again).
 */
export function followZoom(scale: GraphScale, axes: GraphAxes): GraphScale | null {
  const follow = (major: number | null, prevPpu: number, prevUnits: number) => {
    if (!major) return null;
    const exp = Math.floor(Math.log10(major / prevPpu));
    // The 1-2-5 series around the expected step. A scale only guessed from the grid (one square, one unit) may sit
    // anywhere in the real series (the real step 2 taken for 1: its next step, 1, looks like 0.5, then 0.25), so
    // 2.5 x 10^n counts too. Read from the numbers, the series is known and kept strict (2 and 2.5 are close).
    const mantissa = prevUnits / Math.pow(10, Math.floor(Math.log10(prevUnits)));
    const series = scale.from === 'labels' && [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-6) ? [1, 2, 5] : [1, 2, 2.5, 5, mantissa];
    let best: { u: number; d: number } | null = null;
    for (let e = exp - 1; e <= exp + 1; e++)
      for (const m of series) {
        const u = m * Math.pow(10, e);
        const d = Math.abs(Math.log(major / u / prevPpu));
        if (!best || d < best.d) best = { u, d };
      }
    return best && best.d < Math.log(1.4) ? { ppu: major / best.u, u: best.u, major } : null;
  };
  const x = follow(axes.majorX, scale.pxPerUnitX, scale.unitsPerMajorX);
  const y = follow(axes.majorY, scale.pxPerUnitY, scale.unitsPerMajorY);
  if (!x && !y) return null;
  // One axis unmeasurable this frame: it zoomed like the other (graphs zoom both together).
  const fx = x ?? { ppu: scale.pxPerUnitX * (y!.ppu / scale.pxPerUnitY), u: scale.unitsPerMajorX, major: scale.majorX * (y!.ppu / scale.pxPerUnitY) };
  const fy = y ?? { ppu: scale.pxPerUnitY * (x!.ppu / scale.pxPerUnitX), u: scale.unitsPerMajorY, major: scale.majorY * (x!.ppu / scale.pxPerUnitX) };
  return { ...scale, pxPerUnitX: fx.ppu, pxPerUnitY: fy.ppu, unitsPerMajorX: fx.u, unitsPerMajorY: fy.u, majorX: fx.major, majorY: fy.major };
}


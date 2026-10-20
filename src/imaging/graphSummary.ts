/**
 * A graph in words, for people who can't see the screen: what the curve does at its key point, and which part
 * of the graph the pins show. Built from what Graph Range already measured (axes, scale, key point, window).
 */
import type { Rect } from './geometry';
import type { GraphAxes, GraphScale, KeyPoint } from './graph';

/** A graph value for display, to a tenth of the graph's numbered step (2 -> 0.2: one decimal), with a real minus sign. */
export const graphNumber = (v: number, unitsPerMajor: number) => {
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(unitsPerMajor / 10) - 1e-9)));
  const r = Number(v.toFixed(decimals));
  return String(Object.is(r, -0) ? 0 : r).replace('-', '−');
};

export interface GraphFacts {
  axes: GraphAxes;
  key: KeyPoint | null;
  scale: GraphScale | null;
  window: Rect | null;
}

/** Picture pixels to graph units; null on an axis whose zero is off screen. */
function units(f: GraphFacts) {
  const { axes, scale } = f;
  if (!scale) return null;
  const ux = (px: number) => (axes.originX === null ? null : (px - axes.originX) / scale.pxPerUnitX);
  const uy = (py: number) => (axes.originY === null ? null : (axes.originY - py) / scale.pxPerUnitY);
  const nx = (v: number | null) => (v === null ? null : graphNumber(v, scale.unitsPerMajorX));
  const ny = (v: number | null) => (v === null ? null : graphNumber(v, scale.unitsPerMajorY));
  return { ux, uy, nx, ny };
}

/** One or two sentences, or null when nothing useful is known yet (no scale). */
export function describeGraph(f: GraphFacts): string | null {
  const u = units(f);
  if (!u) return null;
  const parts: string[] = [];
  const { key } = f;
  if (key) {
    const x = u.nx(u.ux(key.x));
    const y = u.ny(u.uy(key.y));
    const at = x !== null && y !== null ? ` at (${x}, ${y})` : '';
    const what: Record<KeyPoint['kind'], string> = {
      vertex: key.place === 'top' ? `Highest point${at}` : `Lowest point${at}`,
      inflection: `Bends the other way${at}`,
      intercept: y !== null ? `Crosses the y-axis at y = ${y}` : 'Crosses the y-axis',
      root: x !== null ? `Crosses the x-axis at x = ${x}` : 'Crosses the x-axis',
      start: `Starts${at}`,
      asymptote: 'Two branches, either side of the y-axis',
      shape: `Closed curve centred${at}`,
      middle: `Middle of the curve${at}`,
    };
    parts.push(`${what[key.kind]}.`);
  }
  if (f.window) {
    const w = f.window;
    const x0 = u.nx(u.ux(w.x));
    const x1 = u.nx(u.ux(w.x + w.width));
    const y0 = u.ny(u.uy(w.y + w.height));
    const y1 = u.ny(u.uy(w.y));
    const across = x0 !== null && x1 !== null ? `x from ${x0} to ${x1}` : null;
    const up = y0 !== null && y1 !== null ? `y from ${y0} to ${y1}` : null;
    const shown = [across, up].filter(Boolean).join(', ');
    if (shown) parts.push(`Pins show ${shown}.`);
  }
  if (f.scale?.from === 'grid') parts.push('Units are a guess: one grid square counts as one.');
  return parts.length ? parts.join(' ') : null;
}

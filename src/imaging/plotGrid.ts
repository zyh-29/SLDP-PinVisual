/**
 * The plot area of a graph in a screenshot, found by its gridlines: long, thin, straight horizontal and vertical
 * lines that cross each other. Also each separate plot on a page, and the lines themselves (graph.ts reads the
 * axes and scale from them). Pure functions, unit tested.
 */
import { expand, fullRect, overlaps, type Rect } from './geometry';

interface GridLine {
  /** Row (horizontal) or column (vertical). */
  at: number;
  start: number;
  end: number;
  /** How much darker than its surroundings the line is (mean luminance dip): axes are the darkest. */
  depth: number;
}

/** The plot area and the gridlines (merged per row/column) that define it. */
export interface Grid {
  plot: Rect;
  /** Horizontal lines (`at` is the row), sorted by row. */
  rows: GridLine[];
  /** Vertical lines (`at` is the column), sorted by column. */
  cols: GridLine[];
}

/**
 * The plot area of a graph in a screenshot (e.g. Desmos), found by its structure rather than colours: at least
 * two long, thin, straight horizontal lines and two vertical ones (gridlines and axes) that cross each other.
 * Toolbars and panels are not thin; separators rarely come as a crossing grid. Returns the rectangle the grid
 * spans, or null.
 */
export function findPlotArea(rgb: ArrayLike<number>, width: number, height: number, region: Rect = fullRect(width, height)): Rect | null {
  return findGrid(rgb, width, height, region)?.plot ?? null;
}

/** As findPlotArea, also returning the gridlines (used to read the graph's axes and scale). */
export function findGrid(rgb: ArrayLike<number>, width: number, height: number, region: Rect = fullRect(width, height)): Grid | null {
  const lines = gridLines(rgb, width, height, region);
  return lines ? assembleGrid(lines.gh, lines.gv) : null;
}

/**
 * Every separate graph in the region (a worksheet with two plots side by side): gridlines that cross each other
 * belong to the same plot, so each connected set of crossing lines is one grid.
 */
export function findGrids(rgb: ArrayLike<number>, width: number, height: number, region: Rect = fullRect(width, height)): Grid[] {
  const lines = gridLines(rgb, width, height, region);
  if (!lines) return [];
  const { gh, gv } = lines;
  // Union-find: horizontal lines are 0..gh.length-1, vertical ones follow.
  const parent = Array.from({ length: gh.length + gv.length }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  gh.forEach((h, i) =>
    gv.forEach((v, j) => {
      if (crosses(h, v)) parent[find(i)] = find(gh.length + j);
    }),
  );
  const groups = new Map<number, { h: GridLine[]; v: GridLine[] }>();
  const group = (i: number) => {
    const k = find(i);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { h: [], v: [] }));
    return g;
  };
  gh.forEach((h, i) => group(i).h.push(h));
  gv.forEach((v, j) => group(gh.length + j).v.push(v));
  // Curves cut gridlines into pieces, which can split one plot into several sets that overlap. Separate graphs
  // never overlap, so overlapping sets are joined again.
  const span = (g: { h: GridLine[]; v: GridLine[] }): Rect => {
    const xs = [...g.h.flatMap((l) => [l.start, l.end]), ...g.v.map((l) => l.at)];
    const ys = [...g.v.flatMap((l) => [l.start, l.end]), ...g.h.map((l) => l.at)];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
  };
  const sets = [...groups.values()];
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < sets.length && !merged; i++)
      for (let j = i + 1; j < sets.length && !merged; j++)
        if (overlaps(expand(span(sets[i]), 0.01, width, height), span(sets[j]))) {
          sets[i] = { h: [...sets[i].h, ...sets[j].h], v: [...sets[i].v, ...sets[j].v] };
          sets.splice(j, 1);
          merged = true;
        }
  }
  return sets
    .filter((g) => g.h.length >= 2 && g.v.length >= 2)
    .map((g) => assembleGrid(g.h, g.v))
    .filter((g): g is Grid => g !== null);
}

/** A horizontal and a vertical gridline that cross. */
export const crosses = (h: GridLine, v: GridLine) => v.at >= h.start && v.at <= h.end && h.at >= v.start && h.at <= v.end;

type GridLines = { gh: GridLine[]; gv: GridLine[] } | null;

/** The last scan: a tap asks for the grids, then the graph path asks again for the same image and region. */
let lastScan: { rgb: ArrayLike<number>; key: string; lines: GridLines } | null = null;

/** The long, thin, straight lines of a grid: horizontal and vertical ones that each cross at least two of the other kind. */
function gridLines(rgb: ArrayLike<number>, width: number, height: number, region: Rect): GridLines {
  const key = `${width}x${height}:${region.x},${region.y},${region.width},${region.height}`;
  if (lastScan && lastScan.rgb === rgb && lastScan.key === key) return lastScan.lines;
  const lines = scanGridLines(rgb, width, height, region);
  lastScan = { rgb, key, lines };
  return lines;
}

function scanGridLines(rgb: ArrayLike<number>, width: number, height: number, region: Rect): GridLines {
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
  // Dark theme (e.g. Desmos' inverted colours): lines are lighter than the paper. Flip, so they are dips too.
  const sample: number[] = [];
  for (let y = y0; y < y1; y += 7) for (let x = x0; x < x1; x += 7) sample.push(lum[y * width + x]);
  sample.sort((a, b) => a - b);
  if (sample.length && sample[Math.floor(sample.length / 2)] < 100)
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * width + x] = 255 - lum[y * width + x];
  const DIP = 3;
  const dip = (p: number, step: number) => grey[p] === 1 && lum[p] <= Math.min(lum[p - step], lum[p + step]) - DIP;
  /** Thin dip across a horizontal line (compared with the pixels 3 px above and below). */
  const hLine = (x: number, y: number) => x >= x0 && x < x1 && y >= y0 + 3 && y < y1 - 3 && dip(y * width + x, 3 * width);
  /** Thin dip across a vertical line (3 px left and right). */
  const vLine = (x: number, y: number) => x >= x0 + 3 && x < x1 - 3 && y >= y0 && y < y1 && dip(y * width + x, 3);
  /** Dip depth of a line pixel (`along` is the position along the line, `at` its row or column). */
  const depthAt = (horizontal: boolean, along: number, at: number) => {
    const p = horizontal ? at * width + along : along * width + at;
    const step = horizontal ? 3 * width : 3;
    return Math.min(lum[p - step], lum[p + step]) - lum[p];
  };

  /**
   * Long runs of thin-line pixels along one axis, at least `minLen` long. Gaps up to 6 px are bridged (crossing
   * lines, labels). A curve crossing at a shallow angle hides a longer stretch (the line is no dip next to it), so
   * pieces of the same row are then chained across gaps of up to 5% of the extent, as long as most of the chain
   * is line: otherwise a gridline crossed by a curve would fall below `minLen` in pieces (two plots side by side,
   * the x-axis under a parabola).
   */
  const scan = (horizontal: boolean): GridLine[] => {
    const extent = horizontal ? x1 - x0 : y1 - y0;
    const minLen = extent * 0.25;
    const maxGap = Math.max(16, extent * 0.05);
    const out: GridLine[] = [];
    const [a0, a1, b0, b1] = horizontal ? [y0, y1, x0, x1] : [x0, x1, y0, y1];
    for (let a = a0; a < a1; a++) {
      const thin = (bb: number) => (horizontal ? hLine(bb, a) : vLine(a, bb));
      /** Pieces in this row: [start, end, dip sum, pixel count]. */
      const pieces: [number, number, number, number][] = [];
      let b = b0;
      while (b < b1) {
        if (!thin(b)) {
          b++;
          continue;
        }
        let e = b;
        let dips = depthAt(horizontal, b, a);
        let n = 1;
        for (;;) {
          let next = -1;
          for (let g = 1; g <= 6 && e + g < b1; g++)
            if (thin(e + g)) {
              next = e + g;
              break;
            }
          if (next < 0) break;
          e = next;
          dips += depthAt(horizontal, e, a);
          n++;
        }
        if (e - b + 1 >= 4) pieces.push([b, e, dips, n]);
        b = e + 1;
      }
      // Chain the pieces; keep chains that are long enough and mostly line.
      for (let i = 0; i < pieces.length; ) {
        let j = i;
        let covered = pieces[i][1] - pieces[i][0] + 1;
        let dips = pieces[i][2];
        let n = pieces[i][3];
        while (j + 1 < pieces.length && pieces[j + 1][0] - pieces[j][1] <= maxGap) {
          j++;
          covered += pieces[j][1] - pieces[j][0] + 1;
          dips += pieces[j][2];
          n += pieces[j][3];
        }
        const start = pieces[i][0];
        const end = pieces[j][1];
        if (end - start + 1 >= minLen && covered >= (end - start + 1) * 0.6) out.push({ at: a, start, end, depth: dips / n });
        i = j + 1;
      }
    }
    // Rows next to each other belong to the same (anti-aliased, 2-3 px) line.
    return out.filter((l, i) => !(i > 0 && out[i - 1].at === l.at - 1 && Math.abs(out[i - 1].start - l.start) < 6));
  };
  const hs = scan(true);
  const vs = scan(false);
  if (hs.length < 2 || vs.length < 2) return null;
  // The grid: horizontal lines that cross at least two vertical lines (and vice versa).
  const gh = hs.filter((h) => vs.filter((v) => crosses(h, v)).length >= 2);
  const gv = vs.filter((v) => hs.filter((h) => crosses(h, v)).length >= 2);
  return gh.length < 2 || gv.length < 2 ? null : { gh, gv };
}

/** The plot a set of crossing gridlines spans, and the lines merged per row and column. */
function assembleGrid(gh: GridLine[], gv: GridLine[]): Grid | null {
  // A gridline is often found as several pieces (a steep curve running beside it, labels, buttons on top).
  // Merge pieces of the same row/column, then take the extent most lines agree on (30th/70th percentile), so a
  // few short lines (cut by an overlay or a panel) can't shrink the plot.
  const merged = (lines: GridLine[]): GridLine[] => {
    const byAt = new Map<number, GridLine & { weight: number; depthSum: number }>();
    for (const l of lines) {
      const key = [...byAt.keys()].find((k) => Math.abs(k - l.at) <= 2) ?? l.at;
      const m = byAt.get(key);
      const len = l.end - l.start + 1;
      if (!m) byAt.set(key, { ...l, weight: len, depthSum: l.depth * len });
      else {
        m.start = Math.min(m.start, l.start);
        m.end = Math.max(m.end, l.end);
        m.depthSum += l.depth * len;
        m.weight += len;
        // A thick line (an axis, 2-3 px) is found on neighbouring rows: its position is their middle.
        if (Math.abs(l.at - m.at) <= 2 && l.at !== m.at) m.at = (m.at + l.at) / 2;
      }
    }
    return [...byAt.values()]
      .map(({ weight, depthSum, ...l }) => ({ ...l, depth: depthSum / weight }))
      .sort((a, b) => a.at - b.at);
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
  return { plot: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, rows: mh, cols: mv };
}

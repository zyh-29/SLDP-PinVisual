/**
 * Zooming in on a graph keeps the curve the same size on the board: Graph Range shows a fixed number of units,
 * so once the screen shows less than that, the part off screen is empty pins rather than the visible part being
 * stretched over all of them.
 */
import { GRID } from '@/config/hardware';
import type { Pattern } from '@/domain/pattern';
import { toRgb } from '../foreground';
import { followZoom, type GraphAxes, type GraphScale } from '../graph';
import { cellSizePx, inkFromMask, sampleCrop, thickenThinLines, traceLinePins } from '../pinSampling';
import { smartSubject } from '../smartCrop';

const W = 640;
const H = 480;
const ROWS = 20;
const COLS = 32;
const f = (x: number) => 0.3 * x * x;

/** A Desmos-like plot of y = 0.3 x², `ppu` pixels per unit, the vertex at (ox, oy). Gridlines every unit. */
function plot(ppu: number, ox: number, oy: number) {
  const data = new Uint8Array(W * H * 4);
  const on = (pos: number, origin: number, every: number) => {
    const k = (pos + 0.5 - origin) / every;
    return Math.abs(k - Math.round(k)) * every < 0.5;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ux = (x + 0.5 - ox) / ppu;
      const slope = 0.6 * ux;
      const curve = Math.abs(y + 0.5 - (oy - f(ux) * ppu)) / Math.hypot(1, slope) <= 1.5;
      let c = [255, 255, 255];
      if (on(x, ox, ppu / 5) || on(y, oy, ppu / 5)) c = [232, 232, 232];
      if (on(x, ox, ppu) || on(y, oy, ppu)) c = [200, 200, 200];
      if (Math.abs(x + 0.5 - ox) <= 1 || Math.abs(y + 0.5 - oy) <= 1) c = [60, 60, 60];
      if (curve) c = [199, 68, 64];
      data.set([...c, 255], (y * W + x) * 4);
    }
  return toRgb({ width: W, height: H, data, channels: 4 });
}

const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };
const view = (ppu: number) => ({
  range: 5,
  scale: { pxPerUnitX: ppu, pxPerUnitY: ppu, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: ppu, majorY: ppu, from: 'labels' as const },
  rows: ROWS,
  cols: COLS,
  pinPitchRatio: 1,
});

/** The pins (raised = 1) for the plot at this zoom with Graph Range ±5. */
function pins(ppu: number, ox: number, oy: number) {
  const rgb = plot(ppu, ox, oy);
  const r = smartSubject(rgb, W, H, opts, undefined, undefined, view(ppu));
  expect(r.kind).toBe('curves');
  const mask = new Uint8Array(W * H);
  r.mask!.forEach((v, i) => (mask[i] = v ? 1 : 0));
  const cell = cellSizePx(r.box, ROWS, COLS, 1, true);
  const ink = inkFromMask(thickenThinLines(mask, W, H, 3, cell));
  const s = sampleCrop(ink, W, H, r.box, ROWS, COLS, 1, true);
  return { r, raised: Array.from(s.ink, (v, i) => (s.covered[i] > 0 && v / s.covered[i] > 0.1 ? 1 : 0)) };
}

describe('zooming in on a graph keeps it the same size on the board', () => {
  it('the window stays 10 units wide however far in the graph is zoomed', () => {
    const near = pins(40, 320, 440); // ±5 units = 400 px: fits on screen
    const close = pins(100, 320, 440); // ±5 units = 1000 px: the screen shows ±3.2
    expect(near.r.graph!.fit).toBe('exact');
    expect(close.r.graph!.fit).toBe('shrunk');
    expect(near.r.box.width / 40).toBeCloseTo(10, 0);
    expect(close.r.box.width / 100).toBeCloseTo(10, 0);
    // The window still reaches past the screen, centred on the vertex.
    expect(close.r.box.x).toBeLessThan(0);
    expect(Math.abs(close.r.box.x + close.r.box.width / 2 - 320)).toBeLessThan(15); // within 0.15 units
  });

  it('the pins match: same curve where it is on screen, nothing where it is off screen', () => {
    const near = pins(40, 320, 440).raised;
    const close = pins(100, 320, 440).raised;
    // Columns on screen at the closer zoom: x within ±3.2 units of 10 across 32 columns -> the middle ~20.
    let same = 0;
    let total = 0;
    for (let row = 0; row < ROWS; row++)
      for (let col = 7; col < 25; col++) {
        const i = row * COLS + col;
        if (near[i] || close[i]) {
          total++;
          if (near[i] === close[i]) same++;
        }
      }
    expect(total).toBeGreaterThan(10);
    expect(same / total).toBeGreaterThan(0.75);
    // Off screen (the outer columns): no pins.
    for (let row = 0; row < ROWS; row++) for (const col of [0, 1, 2, 29, 30, 31]) expect(close[row * COLS + col]).toBe(0);
  });
});

describe('following a live zoom frame by frame (followZoom)', () => {
  /** Desmos-like: the major step is the 1-2-5 value whose gridlines are at least 60 px apart. */
  const desmosStep = (ppu: number) => {
    for (let e = -4; e <= 6; e++) for (const m of [1, 2, 5]) if (m * 10 ** e * ppu >= 60) return m * 10 ** e;
    return 1e6;
  };
  const axesAt = (ppu: number, wobble = 0): GraphAxes => {
    const major = desmosStep(ppu) * ppu * (1 + wobble);
    return { plot: { x: 0, y: 0, width: 800, height: 600 }, originX: 400, originY: 300, majorX: major, majorY: major };
  };
  const measured = (ppu: number): GraphScale => {
    const u = desmosStep(ppu);
    return { pxPerUnitX: ppu, pxPerUnitY: ppu, unitsPerMajorX: u, unitsPerMajorY: u, majorX: u * ppu, majorY: u * ppu, from: 'labels' };
  };

  it('keeps the exact scale through a long zoom in and back out, across every step switch', () => {
    let s = measured(30);
    let ppu = 30;
    const zooms = [...Array(25).fill(1.18), ...Array(25).fill(1 / 1.18)];
    zooms.forEach((z, i) => {
      ppu *= z;
      // Gridline positions measured in a real frame are a little off.
      const next = followZoom(s, axesAt(ppu, i % 2 ? 0.004 : -0.004));
      expect(next).not.toBeNull();
      expect(next!.pxPerUnitX / ppu).toBeCloseTo(1, 1);
      expect(next!.unitsPerMajorX).toBeCloseTo(desmosStep(ppu), 6);
      s = next!;
    });
    // 25 steps of 1.18x: zoomed in about 60x and back, without drifting.
    expect(Math.abs(s.pxPerUnitX / 30 - 1)).toBeLessThan(0.01);
  });

  it('also follows a scale that was only guessed from the grid (numbers unreadable): its size stays put', () => {
    // One square = one unit at the start (actually 2 units): the guess is off by 2x, but it stays off by the same
    // 2x through the zoom, so the curve keeps its size on the pins.
    let s: GraphScale = { ...measured(30), unitsPerMajorX: 1, unitsPerMajorY: 1, pxPerUnitX: 60, pxPerUnitY: 60, from: 'grid' };
    let ppu = 30;
    for (let i = 0; i < 12; i++) {
      ppu *= 1.2;
      s = followZoom(s, axesAt(ppu))!;
      expect(s.pxPerUnitX / ppu).toBeCloseTo(2, 1);
    }
  });

  it('a jump too big to tell (another graph, a 3x zoom between frames) is not followed', () => {
    expect(followZoom(measured(30), axesAt(95))).toBeNull();
    expect(followZoom(measured(30), { ...axesAt(30), majorX: null, majorY: null })).toBeNull();
  });
});

describe('curves one pin wide', () => {
  /** Pins as text, '#' raised. */
  const show = (p: Pattern) =>
    Array.from({ length: p.rows }, (_, r) => p.cells.slice(r * p.cols, r * p.cols + p.cols).map((v) => (v ? '#' : '.')).join('')).join('\n');

  it('a parabola: one pin per column on its flat part, joined up along its steep arms, never two pins wide', () => {
    const rgb = plot(40, 320, 440);
    const r = smartSubject(rgb, W, H, opts, undefined, undefined, view(40));
    const p = traceLinePins(r.mask!, W, H, r.box, ROWS, COLS, 1, true);
    // Never a 2 x 2 block of raised pins (that is a band, not a line).
    for (let y = 0; y + 1 < ROWS; y++)
      for (let x = 0; x + 1 < COLS; x++) {
        const at = (yy: number, xx: number) => p.cells[yy * COLS + xx];
        expect(at(y, x) && at(y, x + 1) && at(y + 1, x) && at(y + 1, x + 1)).toBeFalsy();
      }
    // Connected: every raised pin has a raised neighbour (8 directions).
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (!p.cells[y * COLS + x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dy || dx) && p.cells[(y + dy) * COLS + x + dx] && y + dy >= 0 && y + dy < ROWS && x + dx >= 0 && x + dx < COLS) n++;
        expect(n).toBeGreaterThan(0);
      }
    // Symmetric about the vertex, and the vertex in the bottom row.
    const text = show(p);
    expect(text.split('\n')[ROWS - 1]).toContain('#');
    expect(p.cells.filter(Boolean).length).toBeGreaterThan(30);
  });

  it.each([
    ['unbroken', 0],
    // A live share can lose the curve's pixels where it lies on the x-axis.
    ['broken at the vertex', 4],
  ])('y = x² at ±5 on the board (%s): a symmetric U, both pins under the vertex', (_name, gap) => {
    // The window as the app shows it: x -5..5, as tall as the board's proportions make it, the vertex half a row
    // above the bottom (on the line between the two middle columns). 27.5 px per unit.
    const { rows, cols } = GRID;
    const ppu = 27.5;
    const unitsTall = (10 * rows) / cols;
    const top = unitsTall - unitsTall / rows / 2;
    const crop = { x: 0, y: 0, width: 10 * ppu, height: unitsTall * ppu };
    const w = crop.width;
    const h = Math.ceil(crop.height);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const ux = (x + 0.5) / ppu - 5;
        const py = (top - ux * ux) * ppu;
        if (Math.abs(y + 0.5 - py) / Math.hypot(1, 2 * ux) <= 1.2 && Math.abs(x + 0.5 - w / 2) > gap) mask[y * w + x] = 1;
      }
    expect(show(traceLinePins(mask, w, h, crop, rows, cols, 1, true))).toBe(['.#..#.', '.#..#.', '.#..#.', '..##..', '..##..'].join('\n'));
  });

  it('on the real board too', () => {
    const rgb = plot(40, 320, 440);
    const r = smartSubject(rgb, W, H, opts, undefined, undefined, { ...view(40), rows: GRID.rows, cols: GRID.cols });
    const p = traceLinePins(r.mask!, W, H, r.box, GRID.rows, GRID.cols, 1, true);
    expect(show(p)).toMatchSnapshot();
  });
});

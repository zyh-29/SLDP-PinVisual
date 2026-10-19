/**
 * Tap to focus, under pressure: pages with several graphs, a graph with several curves, small shapes next to big
 * ones, taps on edges and gaps, and the AI cut-out's mask.
 */
import type { RasterImage } from '../convert';
import type { Rect } from '../geometry';
import { toRgb } from '../foreground';
import { keepPieceAt, smartSubject } from '../smartCrop';

type C = [number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => C): RasterImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data, channels: 4 };
}

const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };
const inside = (a: Rect, b: Rect, slack = 2) =>
  a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.width <= b.x + b.width + slack && a.y + a.height <= b.y + b.height + slack;
const near = (a: Rect, b: Rect, slack: number) =>
  Math.abs(a.x - b.x) <= slack &&
  Math.abs(a.y - b.y) <= slack &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= slack &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= slack;

const RED: C = [199, 68, 64];
const BLUE: C = [45, 112, 179];
const GREEN: C = [56, 140, 70];

/** A plot: white, light gridlines every 30 px, darker axes through its middle. */
function plotPixel(x: number, y: number, p: Rect): C | null {
  if (x < p.x || x >= p.x + p.width || y < p.y || y >= p.y + p.height) return null;
  const cx = p.x + Math.floor(p.width / 2);
  const cy = p.y + Math.floor(p.height / 2);
  if (x === cx || y === cy) return [110, 110, 110];
  if ((x - cx) % 30 === 0 || (y - cy) % 30 === 0) return [222, 222, 222];
  return [255, 255, 255];
}

/** True when (x, y) is within 1.5 px of the curve y = f(x) (perpendicular distance, like a 3 px stroke). */
const onCurve = (f: (x: number) => number, x: number, y: number) => {
  const slope = (f(x + 0.5) - f(x - 0.5)) / 1;
  return Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, slope) <= 1.5;
};

describe('a worksheet with two graphs side by side', () => {
  const L: Rect = { x: 20, y: 30, width: 340, height: 300 };
  const R: Rect = { x: 440, y: 30, width: 340, height: 300 };
  const leftCurve = (x: number) => 180 + 0.01 * (x - 190) ** 2 - 120; // parabola, vertex near the left plot's middle
  const rightCurve = (x: number) => 180 - 0.9 * (x - 610); // a line through the right plot's middle
  const img = image(800, 360, (x, y) => {
    const inL = plotPixel(x, y, L);
    if (inL) return onCurve(leftCurve, x, y) ? RED : inL;
    const inR = plotPixel(x, y, R);
    if (inR) return onCurve(rightCurve, x, y) ? BLUE : inR;
    return [246, 246, 246];
  });
  const rgb = toRgb(img);

  it('without a tap, both graphs count', () => {
    const r = smartSubject(rgb, img.width, img.height, opts);
    expect(r.kind).toBe('curves');
    expect(r.box.x).toBeLessThan(L.x + L.width);
    expect(r.box.x + r.box.width).toBeGreaterThan(R.x);
  });

  it.each([
    ['left', { x: 60, y: 300 }, L],
    ['right', { x: 740, y: 60 }, R],
  ])('a tap on the %s graph crops to that graph only', (_name, tap, plot) => {
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, tap);
    expect(r.kind).toBe('curves');
    expect(inside(r.box, plot)).toBe(true);
  });
});

describe('Graph Range on a worksheet with two graphs (at the 800 px the browser analyses)', () => {
  // Each plot: 340 x 300 px, gridlines every 30 px, 3 px axes through the middle. Left: a parabola opening down
  // with its vertex at (195, 100); right: a straight line crossing the y-axis at the origin (609, 180).
  const W = 800;
  const H = 360;
  const L: Rect = { x: 20, y: 30, width: 340, height: 300 };
  const R: Rect = { x: 440, y: 30, width: 340, height: 300 };
  const plotAt = (x: number, y: number, p: Rect): C | null => {
    if (x < p.x || x >= p.x + p.width || y < p.y || y >= p.y + p.height) return null;
    const cx = p.x + Math.floor(p.width / 2);
    const cy = p.y + Math.floor(p.height / 2);
    if (Math.abs(x - cx) < 2 || Math.abs(y - cy) < 2) return [110, 110, 110];
    if ((((x - cx) % 30) + 30) % 30 === 0 || (((y - cy) % 30) + 30) % 30 === 0) return [222, 222, 222];
    return [255, 255, 255];
  };
  const parabola = (x: number) => 100 + 0.009 * (x - 190) ** 2;
  const line = (x: number) => 180 - 0.9 * (x - 610);
  const img = image(W, H, (x, y) => {
    const l = plotAt(x, y, L);
    if (l) return onCurve(parabola, x, y) ? RED : l;
    const r = plotAt(x, y, R);
    if (r) return onCurve(line, x, y) ? BLUE : r;
    return [246, 246, 246];
  });
  const rgb = toRgb(img);
  const view = (scale: null | { ppu: number }) => ({
    range: 5,
    scale: scale && {
      pxPerUnitX: scale.ppu,
      pxPerUnitY: scale.ppu,
      unitsPerMajorX: 1,
      unitsPerMajorY: 1,
      majorX: scale.ppu,
      majorY: scale.ppu,
      from: 'grid' as const,
    },
    rows: 5,
    cols: 8,
    pinPitchRatio: 1,
  });

  it('reads one plot’s axes and grid, not both merged (a curve crossing a gridline must not hide it)', () => {
    const r = smartSubject(rgb, W, H, opts, undefined, { x: 60, y: 300 }, view(null));
    const axes = r.graph!.axes;
    expect(inside(axes.plot, L, 3)).toBe(true);
    expect(axes.originX).toBeCloseTo(189, -0.5);
    expect(axes.originY).not.toBeNull();
    expect(axes.majorX).toBeCloseTo(30, 0);
    expect(axes.majorY).toBeCloseTo(30, 0);
  });

  it('the tapped parabola gets ±5 units around its vertex, vertex in the top row', () => {
    const r = smartSubject(rgb, W, H, opts, undefined, { x: 60, y: 300 }, view({ ppu: 30 }));
    expect(r.graph!.key!.kind).toBe('vertex');
    expect(r.graph!.fit).toBe('exact');
    expect(r.box.width).toBeCloseTo(300, -1);
    // Within a quarter unit (8 px): the parabola's top is flat for several pixels.
    expect(Math.abs(r.box.x + r.box.width / 2 - 190)).toBeLessThanOrEqual(8);
    expect(r.box.y).toBeLessThanOrEqual(100);
    expect(r.box.y).toBeGreaterThan(100 - 300 / 8);
  });

  it('a straight line (clipped by the plot’s top and bottom) is centred where it crosses the y-axis, not on a fake bend', () => {
    const r = smartSubject(rgb, W, H, opts, undefined, { x: 740, y: 60 }, view({ ppu: 30 }));
    expect(r.graph!.key!.kind).toBe('intercept');
    expect(r.box.x + r.box.width / 2).toBeCloseTo(610, -1);
  });

  it('without a tap, the window still comes from a single plot', () => {
    const r = smartSubject(rgb, W, H, opts, undefined, undefined, view({ ppu: 30 }));
    expect(r.graph!.fit).toBe('exact');
    expect(inside(r.box, L, 2) || inside(r.box, R, 2)).toBe(true);
  });
});

describe('one graph with two curves', () => {
  const P: Rect = { x: 20, y: 20, width: 560, height: 360 };
  const parabola = (x: number) => 320 - 0.006 * (x - 300) ** 2;
  const line = (x: number) => 360 - 0.55 * (x - 20);
  const img = image(600, 400, (x, y) => {
    const bg = plotPixel(x, y, P) ?? [250, 250, 250];
    if (y >= P.y && y < P.y + P.height && x >= P.x && x < P.x + P.width) {
      if (onCurve(parabola, x, y)) return RED;
      if (onCurve(line, x, y)) return BLUE;
    }
    return bg;
  });
  const rgb = toRgb(img);
  const colourCount = (mask: Float32Array | undefined, c: C) => {
    let n = 0;
    if (!mask) return 0;
    for (let p = 0; p < mask.length; p++) if (mask[p] && rgb[p * 3] === c[0] && rgb[p * 3 + 1] === c[1] && rgb[p * 3 + 2] === c[2]) n++;
    return n;
  };

  it('a tap on the blue line takes the blue line only', () => {
    const x = 100;
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x, y: line(x) + 3 });
    expect(r.kind).toBe('curves');
    expect(colourCount(r.mask, BLUE)).toBeGreaterThan(100);
    expect(colourCount(r.mask, RED)).toBe(0);
  });

  it('a tap on the red parabola takes the red parabola only', () => {
    const x = 300;
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x, y: parabola(x) - 2 });
    expect(colourCount(r.mask, RED)).toBeGreaterThan(100);
    expect(colourCount(r.mask, BLUE)).toBe(0);
  });

  it('a tap on empty graph paper keeps both curves', () => {
    // Far (100+ px) from both curves.
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x: 450, y: 330 });
    expect(colourCount(r.mask, RED)).toBeGreaterThan(100);
    expect(colourCount(r.mask, BLUE)).toBeGreaterThan(100);
  });
});

describe('a small shape inside a big shape’s box', () => {
  // A thick black arc whose box covers most of the picture, and a small orange disc in its hollow.
  const disc = { x: 180, y: 220, r: 18 };
  const img = image(420, 320, (x, y) => {
    const d = Math.hypot(x - 60, y - 330);
    if (d > 247 && d < 253 && y < 310) return [20, 20, 20];
    if (Math.hypot(x - disc.x, y - disc.y) <= disc.r) return [240, 140, 30];
    return [255, 255, 255];
  });
  const rgb = toRgb(img);
  const discBox: Rect = { x: disc.x - disc.r, y: disc.y - disc.r, width: 2 * disc.r + 1, height: 2 * disc.r + 1 };

  it('a tap just beside the disc picks the disc, not the arc whose box holds the tap', () => {
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x: disc.x - disc.r - 5, y: disc.y });
    expect(near(r.box, discBox, 3)).toBe(true);
  });

  it('a tap on the arc picks the arc', () => {
    // A point on the arc (radius 250 around (60, 330)).
    const a = (-60 * Math.PI) / 180;
    const tap = { x: 60 + 250 * Math.cos(a), y: 330 + 250 * Math.sin(a) };
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, tap);
    expect(r.box.width).toBeGreaterThan(150);
    expect(near(r.box, discBox, 10)).toBe(false);
  });
});

describe('taps that land on the very edge of the picture', () => {
  const img = image(300, 200, (x, y) => (Math.hypot(x - 150, y - 100) < 40 ? [60, 160, 90] : [255, 255, 255]));
  const rgb = toRgb(img);
  it.each([
    [0, 0],
    [299, 199],
    [299, 0],
    [0, 199],
  ])('tap at (%i, %i) still finds the shape', (x, y) => {
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x, y });
    expect(near(r.box, { x: 110, y: 60, width: 81, height: 81 }, 3)).toBe(true);
  });
});

describe('the AI cut-out mask (two subjects)', () => {
  const W = 200;
  const H = 100;
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (Math.hypot(x - 50, y - 50) < 30) mask[y * W + x] = 0.9;
      if (Math.hypot(x - 150, y - 50) < 20) mask[y * W + x] = 0.8;
    }
  const count = (m: Float32Array, cx: number) => {
    let n = 0;
    for (let y = 0; y < H; y++) for (let x = cx - 30; x < cx + 30; x++) if (m[y * W + x] > 0.5) n++;
    return n;
  };

  it('keeps only the subject the tap is on (or nearest to)', () => {
    const right = keepPieceAt(mask, W, H, { x: 185, y: 10 });
    expect(count(right, 150)).toBeGreaterThan(1000);
    expect(count(right, 50)).toBe(0);
    const left = keepPieceAt(mask, W, H, { x: 50, y: 50 });
    expect(count(left, 50)).toBeGreaterThan(2000);
    expect(count(left, 150)).toBe(0);
  });

  it('keeps the soft edge values of the kept subject', () => {
    const m = keepPieceAt(mask, W, H, { x: 150, y: 50 });
    expect(m[50 * W + 150]).toBeCloseTo(0.8);
  });

  it('a single subject comes back unchanged', () => {
    const one = new Float32Array(W * H);
    for (let p = 0; p < 500; p++) one[p + 4000] = 1;
    expect(keepPieceAt(one, W, H, { x: 0, y: 0 })).toBe(one);
  });
});

describe('a tap on a graph also places the Graph Range window on the tapped curve', () => {
  const P: Rect = { x: 0, y: 0, width: 600, height: 400 };
  // Green parabola with its vertex at the origin; red line far to the right.
  const parabola = (x: number) => 200 + 0.004 * (x - 300) ** 2 * -1 + 0; // opens downwards from (300, 200)
  const line = (x: number) => 380 - 0.8 * (x - 420);
  const img = image(600, 400, (x, y) => {
    const bg = plotPixel(x, y, P)!;
    if (onCurve(parabola, x, y)) return GREEN;
    if (x > 420 && onCurve(line, x, y)) return RED;
    return bg;
  });
  const rgb = toRgb(img);
  it('the key point is on the tapped curve', () => {
    const view = {
      range: 2,
      scale: { pxPerUnitX: 30, pxPerUnitY: 30, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: 30, majorY: 30, from: 'grid' as const },
      rows: 5,
      cols: 8,
      pinPitchRatio: 1,
    };
    const x = 470;
    const r = smartSubject(rgb, img.width, img.height, opts, undefined, { x, y: line(x) }, view);
    expect(r.graph?.key).toBeTruthy();
    // The red line's own key point (where it is), not the green parabola's vertex at (300, 200).
    expect(r.graph!.key!.x).toBeGreaterThanOrEqual(415);
    expect(r.box.x + r.box.width).toBeGreaterThan(420);
  });
});

import { imageToPattern, type RasterImage } from '../convert';
import { AUTO_MIN, autoTolerance, estimateBackground, findForeground, smartCrop, strokeWidth, toRgb } from '../foreground';
import { cellSizePx, inkFromMask, patternFromSamples, sampleCrop, thickenThinLines } from '../pinSampling';
import { dilate, labelComponents } from '../masks';
import { dragCrop } from '../geometry';

type Rgb3 = [number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => Rgb3 | [number, number, number, number]): RasterImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = px(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { width: w, height: h, data, channels: 4 };
}

const grid = (cells: readonly number[], cols: number) =>
  Array.from({ length: cells.length / cols }, (_, r) => cells.slice(r * cols, (r + 1) * cols).join(''));

const WHITE: Rgb3 = [255, 255, 255];
const PALE_YELLOW: Rgb3 = [251, 251, 214];
const GREEN: Rgb3 = [80, 140, 110];
const BLACK: Rgb3 = [0, 0, 0];

/**
 * Like a textbook diagram: a pale-yellow right triangle with a thin green
 * edge, on white, with a title, edge labels and a copyright line around it.
 */
function diagram(): RasterImage {
  const W = 240;
  const H = 150;
  // Right triangle: bottom-left (40,120), bottom-right (200,120), top-right (200,40).
  const inside = (x: number, y: number) => x >= 40 && x <= 200 && y <= 120 && y >= 120 - (x - 40) * 0.5;
  const blocks: [number, number, number, number][] = [
    [6, 6, 50, 8], // title
    [110, 70, 6, 8], // "c"
    [212, 75, 6, 8], // "a"
    [118, 130, 6, 8], // "b"
    [180, 142, 54, 4], // copyright line
  ];
  return image(W, H, (x, y) => {
    if (blocks.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) return BLACK;
    if (inside(x, y)) {
      const edge = !inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y - 2) || !inside(x, y + 2);
      return edge ? GREEN : PALE_YELLOW;
    }
    return WHITE;
  });
}

const opts = { tolerance: 40, minPieceRatio: 0.15 };

describe('background estimate', () => {
  it('takes the median colour of the border ring', () => {
    const img = image(50, 50, (x, y) => (x > 10 && x < 40 && y > 10 && y < 40 ? BLACK : [200, 210, 220]));
    const { color, noise } = estimateBackground(toRgb(img), 50, 50);
    expect(color).toEqual({ r: 200, g: 210, b: 220 });
    expect(noise).toBe(0);
  });

  it('treats transparency as white', () => {
    const img = image(20, 20, () => [0, 0, 0, 0]);
    expect(estimateBackground(toRgb(img), 20, 20).color).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe('connected pieces', () => {
  it('labels 8-connected pieces with their boxes', () => {
    // Two pieces: a diagonal (connected through corners) and a single pixel.
    const m = Uint8Array.from([
      1,
      0,
      0,
      0,
      0, //
      0,
      1,
      0,
      0,
      1, //
      0,
      0,
      1,
      0,
      0, //
    ]);
    const { components } = labelComponents(m, 5, 3);
    expect(components).toEqual([
      { area: 3, box: { x: 0, y: 0, width: 3, height: 3 } },
      { area: 1, box: { x: 4, y: 1, width: 1, height: 1 } },
    ]);
  });
});

describe('diagram: pale triangle with labels', () => {
  const img = diagram();
  const rgb = toRgb(img);
  const fg = findForeground(rgb, img.width, img.height, opts);

  it('keeps the pale fill as subject (colour distance, not darkness)', () => {
    expect(fg.mask[100 * img.width + 180]).toBe(1); // pale yellow inside the triangle
    expect(fg.mask[10 * img.width + 120]).toBe(0); // white background
  });

  it('drops the title, labels and copyright line', () => {
    expect(fg.removedPieces).toBe(5);
    expect(fg.subject).toEqual({ x: 40, y: 40, width: 161, height: 81 });
  });

  it('keeps every piece when small-detail removal is off', () => {
    const all = findForeground(rgb, img.width, img.height, { ...opts, minPieceRatio: 0 });
    expect(all.removedPieces).toBe(0);
    expect(all.subject).toEqual({ x: 6, y: 6, width: 228, height: 140 });
  });

  it('smart crop hugs the triangle', () => {
    const c = smartCrop(fg);
    expect(c).toEqual({ x: 40, y: 40, width: 161, height: 81 });
  });

  it('turns into a right triangle on the 5 x 8 grid (2:1 shape, so one row stays empty)', () => {
    const s = sampleCrop(inkFromMask(fg.mask), img.width, img.height, smartCrop(fg), 5, 8);
    const p = patternFromSamples(s, 5, 8, 0.35, false);
    expect(grid(p.cells, 8)).toEqual([
      '00000000', //
      '00000011',
      '00001111',
      '00111111',
      '01111111',
    ]);
  });

  it('the old darkness-only converter found almost nothing in the same image', () => {
    const old = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fill' });
    expect(old.pattern.cells.filter(Boolean).length).toBeLessThanOrEqual(1);
  });
});

describe('sampling a crop', () => {
  it('pads outside the crop with lowered pins, also when inverted', () => {
    // A 10 x 10 black square cropped whole onto a 5 x 8 grid: square in the middle, padding left and right.
    const img = image(10, 10, () => BLACK);
    const fg = findForeground(toRgb(img), 10, 10, { tolerance: 40, minPieceRatio: 0 });
    // Uniform image: background = black, nothing is subject.
    expect(fg.subject).toBeNull();
    const ink = new Float32Array(100).fill(1);
    const s = sampleCrop(ink, 10, 10, { x: 0, y: 0, width: 10, height: 10 }, 5, 8);
    expect(grid(patternFromSamples(s, 5, 8, 0.5, false).cells, 8)).toEqual(Array(5).fill('01111110'));
    expect(grid(patternFromSamples(s, 5, 8, 0.5, true).cells, 8)).toEqual(Array(5).fill('00000000'));
  });

  it('measures exact area coverage', () => {
    // Left half inked, cropped to an 8 x 5 region that maps 1:1 onto pins.
    const ink = new Float32Array(16 * 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 8; x++) ink[y * 16 + x] = 1;
    const s = sampleCrop(ink, 16, 10, { x: 4, y: 0, width: 8, height: 5 }, 5, 8);
    expect(Array.from(s.ink.slice(0, 8))).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(Array.from(s.covered)).toEqual(Array(40).fill(1));
  });
});

describe('dragging the crop box', () => {
  const start = { x: 10, y: 10, width: 50, height: 40 };

  it('moves and stays inside the image', () => {
    expect(dragCrop(start, 'move', 5, -3, 100, 100)).toEqual({ x: 15, y: 7, width: 50, height: 40 });
    expect(dragCrop(start, 'move', 500, 500, 100, 100)).toEqual({ x: 50, y: 60, width: 50, height: 40 });
  });

  it('resizes from a corner, keeping the opposite corner fixed', () => {
    expect(dragCrop(start, 'br', 10, 20, 100, 100)).toEqual({ x: 10, y: 10, width: 60, height: 60 });
    expect(dragCrop(start, 'tl', -20, -20, 100, 100)).toEqual({ x: 0, y: 0, width: 60, height: 50 });
  });

  it('never collapses below the minimum size or flips', () => {
    const r = dragCrop(start, 'tl', 200, 200, 100, 100);
    expect(r.width).toBeCloseTo(6);
    expect(r.height).toBeCloseTo(6);
    expect(r.x + r.width).toBe(60);
    expect(r.y + r.height).toBe(50);
  });
});

describe('graphs: axes and gridlines', () => {
  /** Like a Desmos screenshot: light grid every 20 px, grey axes crossing, a thin red parabola and tick numbers. */
  function plot(): RasterImage {
    const W = 200;
    const H = 160;
    const curve = (x: number) => 150 - 0.032 * (x - 100) ** 2; // vertex at (100, 150)
    return image(W, H, (x, y) => {
      const c = curve(x);
      if (Math.abs(y - c) <= 1 || (Math.abs(x - 100 - Math.sqrt(Math.max(0, (150 - y) / 0.032)) * Math.sign(x - 100)) <= 1 && y < 150))
        return [200, 60, 50];
      if (x === 100 || y === 150) return [90, 90, 90]; // axes
      if (
        (x >= 60 && x < 66 && y >= 152 && y < 158) ||
        (x >= 140 && x < 146 && y >= 152 && y < 158) ||
        (x >= 103 && x < 108 && y >= 152 && y < 158)
      )
        return BLACK; // tick numbers, including a 0 next to the vertex
      if (x % 20 === 0 || y % 20 === 10) return [205, 205, 205]; // gridlines
      return WHITE;
    });
  }

  const img = plot();
  const rgb = toRgb(img);
  const fg = findForeground(rgb, img.width, img.height, { tolerance: 40, minPieceRatio: 0.15, removeLines: 'auto' });

  it('finds the axes and gridlines and recognises a graph', () => {
    expect(fg.lines.filter((l) => l.orientation === 'v').length).toBeGreaterThanOrEqual(9);
    expect(fg.lines.filter((l) => l.orientation === 'h').length).toBeGreaterThanOrEqual(7);
    expect(fg.graphLikely).toBe(true);
    expect(fg.linesRemoved).toBe(true);
  });

  it('keeps only the curve: the crop hugs the parabola', () => {
    const c = smartCrop(fg);
    expect(c.y + c.height).toBeGreaterThanOrEqual(148); // reaches the vertex
    expect(c.width).toBeGreaterThan(120);
    expect(fg.mask[150 * img.width + 30]).toBe(0); // x-axis gone
    expect(fg.mask[30 * img.width + 100]).toBe(0); // y-axis gone
  });

  it('stretches to the grid and raises a U shape', () => {
    const crop = smartCrop(fg);
    const thick = thickenThinLines(fg.mask, img.width, img.height, fg.strokeWidth, cellSizePx(crop, 5, 8, 1, true));
    const s = sampleCrop(inkFromMask(thick), img.width, img.height, crop, 5, 8, 1, true);
    const rows = grid(patternFromSamples(s, 5, 8, 0.35, false).cells, 8);
    expect(rows).toEqual([
      '10000001', //
      '10000001',
      '01000010',
      '01100110',
      '00111100',
    ]);
  });

  it('keeps the curve where it crosses gridlines and the axis, and drops the 0 label (zoomed crop)', () => {
    const region = { x: 70, y: 100, width: 60, height: 60 };
    const z = findForeground(rgb, img.width, img.height, { tolerance: 40, minPieceRatio: 0.15, removeLines: true, region });
    const onCurve = (y: number) => {
      const dx = Math.round(Math.sqrt((150 - y) / 0.032));
      return [100 - dx, 100 + dx].every((cx) => [-1, 0, 1].some((d) => z.mask[y * img.width + cx + d] === 1));
    };
    expect(onCurve(130)).toBe(true); // crossing a horizontal gridline
    const yAt80 = Math.round(150 - 0.032 * 20 ** 2); // crossing the vertical gridline x = 80
    expect([-1, 0, 1].some((d) => z.mask[(yAt80 + d) * img.width + 80] === 1)).toBe(true);
    expect(z.mask[150 * img.width + 100]).toBe(1); // the vertex, sitting on the x-axis
    for (let y = 152; y < 158; y++) for (let x = 103; x < 108; x++) expect(z.mask[y * img.width + x]).toBe(0); // the 0 label
  });

  it('can be told to keep the lines', () => {
    const kept = findForeground(rgb, img.width, img.height, { tolerance: 40, minPieceRatio: 0.15, removeLines: false });
    expect(kept.linesRemoved).toBe(false);
    expect(kept.mask[150 * img.width + 30]).toBe(1);
  });
});

describe('not graphs', () => {
  it('a thin letter T is not mistaken for axes', () => {
    const img = image(100, 100, (x, y) =>
      (y >= 10 && y <= 11 && x >= 10 && x <= 90) || (x >= 50 && x <= 51 && y >= 10 && y <= 90) ? BLACK : WHITE,
    );
    const fg = findForeground(toRgb(img), 100, 100, { tolerance: 40, minPieceRatio: 0.15, removeLines: 'auto' });
    expect(fg.lines.length).toBe(2);
    expect(fg.graphLikely).toBe(false);
    expect(fg.subject).toEqual({ x: 10, y: 10, width: 81, height: 81 });
  });

  it('the straight edges of a filled triangle are not lines', () => {
    const img = diagram();
    expect(findForeground(toRgb(img), img.width, img.height, opts).lines).toEqual([]);
  });
});

describe('thin lines', () => {
  it('thickens thin strokes to about half a pin and leaves filled shapes alone', () => {
    const m = new Uint8Array(40 * 40);
    for (let x = 0; x < 40; x++) m[20 * 40 + x] = 1; // 1 px horizontal line
    const thick = thickenThinLines(m, 40, 40, 1, { w: 20, h: 20 });
    let rows = 0;
    for (let y = 0; y < 40; y++) rows += thick[y * 40 + 10];
    expect(rows).toBe(11); // 1 + 2 * round(20 / 4 - 1 / 2)
    // Half a pin or more (a filled shape, a bold stroke): left alone.
    expect(thickenThinLines(m, 40, 40, 10, { w: 20, h: 20 })).toBe(m);
  });

  it('also grows a medium stroke (a blurred camera line, 0.35 of a pin) to half a pin, so it raises the pins it crosses', () => {
    const m = new Uint8Array(40 * 40);
    for (let y = 17; y < 24; y++) for (let x = 0; x < 40; x++) m[y * 40 + x] = 1; // 7 px line
    const thick = thickenThinLines(m, 40, 40, 7, { w: 20, h: 20 });
    let rows = 0;
    for (let y = 0; y < 40; y++) rows += thick[y * 40 + 10];
    expect(rows).toBe(11); // 7 + 2 * round(20 / 4 - 7 / 2) = 7 + 2 * 2
  });

  it('still thickens a thin line when pins are long and flat (a stretched, zoomed-in graph)', () => {
    const m = new Uint8Array(60 * 20);
    for (let x = 0; x < 60; x++) m[10 * 60 + x] = 1; // 1 px line
    const thick = thickenThinLines(m, 60, 20, 1.3, { w: 12, h: 3.4 });
    expect(thick).not.toBe(m);
  });

  it('dilates with a rectangular block', () => {
    const m = new Uint8Array(7 * 7);
    m[3 * 7 + 3] = 1;
    const d = dilate(m, 7, 7, 1, 2);
    expect(grid(Array.from(d), 7)).toEqual(['0000000', '0011100', '0011100', '0011100', '0011100', '0011100', '0000000']);
  });

  it('measures stroke width', () => {
    const line = new Uint8Array(50 * 50);
    for (let x = 5; x < 45; x++) for (let y = 20; y < 24; y++) line[y * 50 + x] = 1;
    expect(strokeWidth(line, 50, 50)).toBeCloseTo(4, 0);
  });
});

describe('automatic tolerance', () => {
  it('keeps a pale fill on white (the cut sits between the background and the fill)', () => {
    const img = diagram(); // pale yellow (distance ~42 from white) with a green edge and labels
    const fg = findForeground(toRgb(img), img.width, img.height, { tolerance: 'auto', minPieceRatio: 0.15 });
    expect(fg.tolerance).toBeLessThan(42);
    expect(fg.mask[100 * img.width + 180]).toBe(1); // inside the pale fill
    expect(fg.subject).toEqual({ x: 40, y: 40, width: 161, height: 81 });
  });

  it('rises above paper grain so the background stays background', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 28; // +-14 grain
    const img = image(200, 150, (x, y) => {
      const ink = Math.hypot(x - 100, y - 75) < 30;
      const g = rand();
      return ink ? [40 + g, 40 + g, 50 + g] : [236 + g, 232 + g, 220 + g];
    });
    const fg = findForeground(toRgb(img), img.width, img.height, { tolerance: 'auto', minPieceRatio: 0 });
    let leaked = 0;
    for (let y = 0; y < 150; y++) for (let x = 0; x < 200; x++) if (Math.hypot(x - 100, y - 75) > 33 && fg.mask[y * 200 + x]) leaked++;
    expect(leaked).toBe(0);
    expect(fg.mask[75 * 200 + 100]).toBe(1);
  });

  it('uses the minimum on a clean screenshot-like image', () => {
    const d = new Float32Array(1000);
    for (let i = 900; i < 1000; i++) d[i] = 200; // a dark subject on a perfectly flat background
    expect(autoTolerance(d, 0)).toBeGreaterThanOrEqual(AUTO_MIN);
    expect(autoTolerance(d, 0)).toBeLessThan(200);
  });
});

describe('removing anti-aliased axes', () => {
  it('erases the whole axis band, its dark core as well as its light edge row', () => {
    // A 2-row axis: a light anti-aliased edge row (219) above a near-black core row (24), crossing a plot,
    // with a red curve so the image counts as a graph.
    const W = 300;
    const H = 200;
    const img = image(W, H, (x, y) => {
      if (Math.abs(y - (150 - 0.004 * (x - 150) ** 2)) <= 1) return [199, 68, 64];
      if (y === 149) return [219, 219, 219];
      if (y === 150) return [24, 24, 24];
      if (x === 150) return [24, 24, 24];
      return [255, 255, 255];
    });
    const fg = findForeground(toRgb(img), W, H, { tolerance: 40, minPieceRatio: 0, removeLines: true });
    expect(fg.mask[150 * W + 30]).toBe(0); // dark core gone
    expect(fg.mask[149 * W + 30]).toBe(0); // light edge gone
    expect(fg.mask[60 * W + 150]).toBe(0); // vertical axis gone
  });
});

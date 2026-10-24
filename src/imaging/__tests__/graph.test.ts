import type { RasterImage } from '../convert';
import type { Rect } from '../geometry';
import { toRgb } from '../foreground';
import {
  type AxisReading,
  curveKeyPoint,
  labelBands,
  MIN_PX_PER_PIN,
  tidyKeyPoint,
  wavesThatFit,
  findLabelBoxes,
  type GraphAxes,
  graphWindow,
  gridStep,
  readAxes,
  rescale,
  scaleFromGrid,
  scaleFromLabels,
} from '../graph';
import { findGrid } from '../plotGrid';

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

interface Plot {
  W: number;
  H: number;
  /** Pixel of x = 0 and y = 0 (may be off screen). */
  ox: number;
  oy: number;
  /** Pixels per unit. */
  ppu: number;
  /** Units per major gridline and minor lines per major square. */
  major: number;
  minors: number;
  f?: (x: number) => number;
}

/** A Desmos-like graph: white, faint minor lines, grey major lines, dark 2 px axes and a red 3 px curve. */
function graph(p: Plot): RasterImage {
  const step = (p.major / p.minors) * p.ppu;
  const onLine = (pos: number, origin: number, every: number) => {
    const k = (pos - origin) / every;
    return Math.abs(k - Math.round(k)) * every < 0.5;
  };
  return image(p.W, p.H, (x, y) => {
    if (p.f) {
      const ux = (x + 0.5 - p.ox) / p.ppu;
      const uy = p.f(ux);
      const slope = (p.f(ux + 1e-3) - p.f(ux - 1e-3)) / 2e-3;
      const py = p.oy - uy * p.ppu;
      if (Math.abs(y + 0.5 - py) / Math.hypot(1, slope) <= 1.5) return [199, 68, 64];
    }
    if (Math.abs(x + 0.5 - p.ox) <= 1 || Math.abs(y + 0.5 - p.oy) <= 1) return [60, 60, 60];
    if (onLine(x, p.ox, p.major * p.ppu) || onLine(y, p.oy, p.major * p.ppu)) return [200, 200, 200];
    if (onLine(x, p.ox, step) || onLine(y, p.oy, step)) return [232, 232, 232];
    return [255, 255, 255];
  });
}

function analyse(p: Plot) {
  const img = graph(p);
  const rgb = toRgb(img);
  const grid = findGrid(rgb, img.width, img.height)!;
  expect(grid).not.toBeNull();
  const axes = readAxes(grid);
  // The curve's own pixels (red), as the smart crop's curve finder returns them.
  const mask = new Float32Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) if (rgb[i * 3] === 199 && rgb[i * 3 + 1] === 68) mask[i] = 1;
  return { img, rgb, axes, mask };
}

const base: Plot = { W: 640, H: 400, ox: 320, oy: 200, ppu: 20, major: 2, minors: 4 };

describe('axes and grid', () => {
  it.each([
    ['centred origin, major every 2 units', { ...base }],
    ['origin off centre, major every 5', { ...base, ox: 180, oy: 300, ppu: 12, major: 5, minors: 5 }],
    ['zoomed in, major every 1', { ...base, ppu: 64, major: 1, minors: 5 }],
  ])('%s', (_, p) => {
    const { axes } = analyse(p);
    expect(axes.originX).toBeCloseTo(p.ox, -0.5);
    expect(axes.originY).toBeCloseTo(p.oy, -0.5);
    expect(axes.majorX).toBeCloseTo(p.major * p.ppu, 0);
    expect(axes.majorY).toBeCloseTo(p.major * p.ppu, 0);
  });

  it('with the axes off screen: no origin, the grid spacing is still measured', () => {
    const { axes } = analyse({ ...base, ox: -300, oy: 900 });
    expect(axes.originX).toBeNull();
    expect(axes.originY).toBeNull();
    // The numbers are then looked for along the plot's edges.
    expect(labelBands(axes).map((b) => b.axis)).toEqual(['x', 'x', 'y', 'y']);
    // Without the darker axes the shades still separate major from minor lines.
    expect(axes.majorX).toBeCloseTo(40, 0);
  });

  it('grid step tolerates missing and extra lines', () => {
    expect(gridStep([0, 40, 80, 160, 200, 240])).toBeCloseTo(40, 5); // 120 missing
    expect(gridStep([0, 40, 80, 97, 120, 160, 200])).toBeCloseTo(40, 0); // a stray line at 97
    expect(gridStep([10, 50])).toBeNull();
  });
});

describe('key point of the curve', () => {
  const unit = (p: Plot, k: { x: number; y: number }) => ({ x: (k.x - p.ox) / p.ppu, y: (p.oy - k.y) / p.ppu });

  it('parabola: the vertex, at the bottom of the window', () => {
    const p = { ...base, f: (x: number) => x * x };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('vertex');
    expect(k.place).toBe('bottom');
    expect(unit(p, k).x).toBeCloseTo(0, 0);
    expect(unit(p, k).y).toBeCloseTo(0, 0);
  });

  it('parabola broken at its vertex (where it lies on the x-axis): still one curve, its vertex found', () => {
    // A live screen share can lose a few pixels of the curve where it runs along the dark axis: the two arms then
    // come apart, and one arm alone looks like a curve that stops there ("Starts", window beside the vertex).
    const p = { ...base, f: (x: number) => x * x };
    const { axes, mask, img } = analyse(p);
    for (let y = 0; y < img.height; y++) for (let x = p.ox - 4; x <= p.ox + 4; x++) mask[y * img.width + x] = 0;
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('vertex');
    expect(k.place).toBe('bottom');
    expect(Math.abs(unit(p, k).x)).toBeLessThan(0.3);
    expect(Math.abs(unit(p, k).y)).toBeLessThan(0.3);
  });

  it('wide parabola: the vertex in the middle of its flat bottom, not at one end of it', () => {
    // y = 0.1x² stays within a pixel of its lowest row for about 14 px each side of the vertex.
    const p = { ...base, f: (x: number) => 0.1 * x * x };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('vertex');
    expect(Math.abs(k.x - p.ox)).toBeLessThanOrEqual(2);
  });

  it('shifted parabola: the vertex wherever it is', () => {
    const p = { ...base, f: (x: number) => 0.5 * (x - 3) ** 2 - 2 };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('vertex');
    expect(Math.abs(unit(p, k).x - 3)).toBeLessThan(0.3);
    expect(Math.abs(unit(p, k).y + 2)).toBeLessThan(0.3);
  });

  it('upside-down parabola: the vertex at the top', () => {
    const p = { ...base, f: (x: number) => -0.5 * x * x + 3 };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.place).toBe('top');
    expect(Math.abs(unit(p, k).y - 3)).toBeLessThan(0.3);
  });

  it('cubic: the middle, where the bend changes', () => {
    const p = { ...base, f: (x: number) => 0.2 * x ** 3 };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('inflection');
    expect(k.place).toBe('centre');
    expect(Math.abs(unit(p, k).x)).toBeLessThan(0.5);
  });

  it('cubic with two turns: the middle between them', () => {
    const p = { ...base, f: (x: number) => 0.1 * (x ** 3 - 12 * x) + 1 };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('inflection');
    expect(Math.abs(unit(p, k).x)).toBeLessThan(0.5);
    expect(Math.abs(unit(p, k).y - 1)).toBeLessThan(0.5);
  });

  it('sine wave: the zero crossing nearest the origin', () => {
    const p = { ...base, f: (x: number) => 3 * Math.sin(x) };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.place).toBe('centre');
    expect(Math.abs(unit(p, k).x)).toBeLessThan(0.4);
  });

  it('two curves crossing: each colour on its own, the one with a turn wins', () => {
    const p = { ...base, f: (x: number) => x * x - 2 };
    const img = graph(p);
    // Add a blue line y = 2x + 1 over it.
    const line = (x: number) => p.oy - (2 * ((x + 0.5 - p.ox) / p.ppu) + 1) * p.ppu;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (Math.abs(y + 0.5 - line(x)) / Math.hypot(1, 2) <= 1.5) (img.data as Uint8Array).set([45, 112, 179, 255], (y * img.width + x) * 4);
    const rgb = toRgb(img);
    const axes = readAxes(findGrid(rgb, img.width, img.height)!);
    const mask = new Float32Array(img.width * img.height);
    for (let i = 0; i < mask.length; i++) if (rgb[i * 3] === 199 || rgb[i * 3 + 2] === 179) mask[i] = 1;
    const k = curveKeyPoint(mask, img.width, img.height, axes, rgb)!;
    expect(k.kind).toBe('vertex');
    expect(Math.abs((k.x - p.ox) / p.ppu)).toBeLessThan(0.2);
    expect(Math.abs((p.oy - k.y) / p.ppu + 2)).toBeLessThan(0.2);
  });

  it('line: where it crosses the y-axis', () => {
    const p = { ...base, f: (x: number) => 0.5 * x + 2 };
    const { axes, mask, img } = analyse(p);
    const k = curveKeyPoint(mask, img.width, img.height, axes)!;
    expect(k.kind).toBe('intercept');
    expect(Math.abs(unit(p, k).x)).toBeLessThan(0.2);
    expect(Math.abs(unit(p, k).y - 2)).toBeLessThan(0.2);
  });
});

describe('major gridlines: no rhythm made up from shrinking', () => {
  it('lines of one shade that look alternately darker after shrinking are all major lines (one supporting line is not a rhythm)', () => {
    // The columns and depths measured on a camera frame of a printed grid whose lines are all one shade.
    const line = (at: number, depth: number) => ({ at, start: 30, end: 327, depth });
    const cols = [[22, 5], [47, 11], [71, 28], [97, 11], [121, 5], [148, 11], [173, 5], [196, 11], [220, 5]].map(([a, d]) => line(a, d));
    const rows = [[54, 11], [78, 5], [103, 11], [128, 5], [153, 11], [177, 82], [202, 11], [227, 5], [252, 11], [276, 11], [301, 5]].map(([a, d]) =>
      ({ at: a, start: 0, end: 228, depth: d }),
    );
    const axes = readAxes({ plot: { x: 0, y: 30, width: 228, height: 297 }, rows, cols });
    expect(axes.majorX).toBeCloseTo(24.9, 0);
    expect(axes.majorY).toBeCloseTo(24.7, 0);
  });

  it('nor do two lines on the rhythm when only one of them looks darker', () => {
    // Another camera frame of the same printed grid: across, every line has depth 5 but one (11), 5 lines from the axis.
    const cols = [[369, 5], [387, 5], [406, 5], [425, 5], [444, 5], [462, 5], [481, 56], [500, 5], [519, 5], [538, 5], [557, 5], [576, 11], [595, 5]].map(
      ([a, d]) => ({ at: a, start: 66, end: 293, depth: d }),
    );
    const rows = [[83, 5], [102, 5], [121, 5], [140, 5], [159, 5], [177, 28], [197, 11], [215, 5], [234, 5], [253, 5], [272, 5]].map(([a, d]) => ({
      at: a,
      start: 365,
      end: 601,
      depth: d,
    }));
    const axes = readAxes({ plot: { x: 365, y: 66, width: 236, height: 227 }, rows, cols });
    expect(axes.majorX).toBeCloseTo(18.9, 0);
    expect(axes.majorY).toBeCloseTo(18.9, 0);
  });

  it('a real numbered line next to the axis still counts, when it is clearly darker than all the others', () => {
    const cols = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ at: 100 + 20 * i, start: 0, end: 300, depth: i === 0 ? 80 : i === 5 ? 30 : 10 }));
    const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ at: 50 + 20 * i, start: 0, end: 300, depth: i === 0 ? 80 : i === 5 ? 30 : 10 }));
    const axes = readAxes({ plot: { x: 0, y: 0, width: 300, height: 300 }, rows, cols });
    expect(axes.majorX).toBeCloseTo(100, 0);
  });
});

describe('window', () => {
  const scale = (ppu: number) => ({ pxPerUnitX: ppu, pxPerUnitY: ppu, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: ppu, majorY: ppu, from: 'labels' as const });
  const plot: Rect = { x: 0, y: 0, width: 1000, height: 800 };

  it('+/-5 units across, same scale up and down, in the pins proportions (8 x 5)', () => {
    const { box: w, fit } = graphWindow({ x: 500, y: 400, place: 'centre', kind: 'inflection' }, scale(40), 5, plot, 5, 8);
    expect(fit).toBe('exact');
    expect(w.width).toBe(400); // 10 units
    expect(w.height).toBe(250); // 10 * 5/8 units
    expect(w.x + w.width / 2).toBeCloseTo(500, 0);
    expect(w.y + w.height / 2).toBeCloseTo(400, 0);
  });

  it('a vertex sits in the bottom row', () => {
    const w = graphWindow({ x: 500, y: 600, place: 'bottom', kind: 'vertex' }, scale(40), 5, plot, 5, 8).box;
    const row = w.height / 5;
    expect(600 - w.y).toBeGreaterThan(4 * row);
    expect(600 - w.y).toBeLessThan(5 * row);
  });

  it('stays inside the plot, and keeps its size (reaching past the plot) when the plot shows less than the range', () => {
    const near = graphWindow({ x: 20, y: 20, place: 'centre', kind: 'middle' }, scale(40), 5, plot, 5, 8).box;
    expect(near.x).toBe(0);
    expect(near.y).toBe(0);
    const small = graphWindow({ x: 100, y: 100, place: 'centre', kind: 'middle' }, scale(40), 5, { x: 0, y: 0, width: 200, height: 200 }, 5, 8);
    expect(small.fit).toBe('shrunk');
    // Still 10 units across (the curve keeps its size on the pins), centred on the key point, not slid into the plot.
    expect(small.box.width).toBe(400);
    expect(small.box.x + small.box.width / 2).toBeCloseTo(100, 0);
    expect(small.box.width / small.box.height).toBeCloseTo(8 / 5, 1);
  });

  it('zoomed far out: grows to a usable size instead of a few pixels', () => {
    // 0.9 px per unit: +/-5 units would be 9 px for 8 pins.
    const g = graphWindow({ x: 500, y: 400, place: 'centre', kind: 'middle' }, scale(0.9), 5, plot, 5, 8);
    expect(g.fit).toBe('grown');
    expect(g.box.width).toBeGreaterThanOrEqual(8 * MIN_PX_PER_PIN - 1);
  });

  it('tidies the key point: within 3 px of a tidy value it snaps to it', () => {
    const axes: GraphAxes = { plot, originX: 500, originY: 400, majorX: 80, majorY: 80 };
    const s = { ...scale(40), unitsPerMajorX: 2, unitsPerMajorY: 2 };
    const k = tidyKeyPoint({ x: 502, y: 398.5, place: 'bottom', kind: 'vertex' }, axes, s);
    expect(k.x).toBe(500);
    expect(k.y).toBe(400);
    // 0.3 units (12 px) from 0, but on a 0.2 step: snaps to 0.2 only if within 3 px (it is 4 px off): unchanged.
    expect(tidyKeyPoint({ x: 512, y: 400, place: 'centre', kind: 'middle' }, axes, s).x).toBe(512);
  });
});

describe('scale from the axis numbers', () => {
  const axes: GraphAxes = { plot: { x: 0, y: 0, width: 800, height: 600 }, originX: 400, originY: 300, majorX: 80, majorY: 80 };
  // 2 units per major line: 40 px per unit.
  const xs = (vals: number[], jitter = 0): AxisReading[] => vals.map((v, i) => ({ axis: 'x', value: v, at: 400 + v * 40 + (i % 2 ? jitter : -jitter) }));

  it('reads pixels per unit and snaps to the grid', () => {
    const s = scaleFromLabels(axes, xs([-8, -6, -4, -2, 2, 4, 6, 8], 2))!;
    expect(s.pxPerUnitX).toBeCloseTo(40, 5);
    expect(s.unitsPerMajorX).toBeCloseTo(2, 5);
    // Only x readable: y uses the same scale.
    expect(s.pxPerUnitY).toBeCloseTo(40, 5);
    expect(s.from).toBe('labels');
  });

  it('ignores misreads and lost minus signs', () => {
    const r = xs([-6, -4, -2, 2, 4, 6]);
    r[0].value = 6; // "-6" read as "6"
    r[3].value = 7; // "2" read as "7"
    expect(scaleFromLabels(axes, r)!.pxPerUnitX).toBeCloseTo(40, 5);
  });

  it('works with the axis off screen (labels on one side)', () => {
    const off: GraphAxes = { ...axes, originX: null };
    const r: AxisReading[] = [10, 12, 14, 16].map((v) => ({ axis: 'x', value: v, at: -200 + v * 40 }));
    expect(scaleFromLabels(off, r)!.pxPerUnitX).toBeCloseTo(40, 5);
  });

  it('axis off screen with misreads (a lost first digit, a lost minus): the consensus wins', () => {
    const off: GraphAxes = { ...axes, originX: null };
    const r: AxisReading[] = [10, 12, 14, 16, 18, 20].map((v) => ({ axis: 'x', value: v, at: -200 + v * 40 + (v % 4 ? 1 : -1) }));
    r[2].value = 4; // "14" read as "4"
    r[4].value = 8; // "18" read as "8"
    expect(scaleFromLabels(off, r)!.pxPerUnitX).toBeCloseTo(40, 5);
  });

  it('a single disagreeing number is not enough', () => {
    expect(scaleFromLabels(axes, [{ axis: 'x', value: 3, at: 480 }])).toBeNull();
    expect(scaleFromLabels(axes, [])).toBeNull();
  });

  it('without numbers: one major square is one unit', () => {
    expect(scaleFromGrid(axes)!.pxPerUnitX).toBe(80);
  });

  it('a measured scale is reused while the zoom is unchanged, not after zooming', () => {
    const s = scaleFromLabels(axes, xs([-4, -2, 2, 4]))!;
    expect(rescale(s, { ...axes, originX: 250 })!.pxPerUnitX).toBeCloseTo(40, 5); // panned
    expect(rescale(s, { ...axes, majorX: 100, majorY: 100 })).toBeNull(); // zoomed
  });
});

describe('finding the numbers in a label band', () => {
  // A band 300 x 30: white, a grey gridline crossing it, a red curve, and three "numbers" made of glyph blocks.
  const W = 300;
  const H = 30;
  const glyph = (x: number, y: number, gx: number, w = 6, h = 12) => x >= gx && x < gx + w && y >= 8 && y < 8 + h;
  const band = image(W, H, (x, y) => {
    if (x === 150) return [120, 120, 120]; // gridline from edge to edge
    if (Math.abs(y - (x - 200) * 0.5) < 1.5 && x > 200) return [199, 68, 64]; // curve
    if (glyph(x, y, 30) || glyph(x, y, 38)) return [30, 30, 30]; // "10"
    if (x >= 90 && x < 95 && y >= 13 && y < 15) return [30, 30, 30]; // minus
    if (glyph(x, y, 97)) return [30, 30, 30]; // "-5"
    if (glyph(x, y, 250)) return [30, 30, 30]; // "5"
    return [255, 255, 255];
  });

  it('groups glyphs into numbers and skips gridlines and curves', () => {
    const boxes = findLabelBoxes(band.data, W, H).sort((a, b) => a.x - b.x);
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toMatchObject({ x: 30, width: 14 }); // "10"
    expect(boxes[1]).toMatchObject({ x: 90, width: 13 }); // "-5", minus included
    expect(boxes[2]).toMatchObject({ x: 250, width: 6 });
  });

  it('dark theme: light numbers on a dark band', () => {
    const dark = image(W, H, (x, y) => (glyph(x, y, 40) ? [230, 230, 230] : [20, 20, 24]));
    expect(findLabelBoxes(dark.data, W, H)).toHaveLength(1);
  });

  it('an empty band has no numbers', () => {
    expect(findLabelBoxes(image(W, H, () => [255, 255, 255]).data, W, H)).toEqual([]);
  });
});

describe('the grid guess (no readable numbers)', () => {
  const plot = { x: 0, y: 0, width: 300, height: 300 };
  it('across and down a rhythm apart (4x, 5x): one misread, the smaller spacing is used both ways', () => {
    const s = scaleFromGrid({ plot, originX: 64, originY: 163, majorX: 25.95, majorY: 103.45 })!;
    expect(s.pxPerUnitX).toBeCloseTo(25.95, 1);
    expect(s.pxPerUnitY).toBeCloseTo(25.95, 1);
    expect(scaleFromGrid({ plot, originX: 1, originY: 1, majorX: 122.5, majorY: 25.7 })!.pxPerUnitX).toBeCloseTo(25.7, 1);
  });
  it('an unevenly zoomed graph (another ratio) keeps both', () => {
    const s = scaleFromGrid({ plot, originX: 1, originY: 1, majorX: 86.4, majorY: 125.7 })!;
    expect(s.pxPerUnitX).toBeCloseTo(86.4, 1);
    expect(s.pxPerUnitY).toBeCloseTo(125.7, 1);
  });
});

describe('whole curve: waves the pins can show', () => {
  const box = { x: 0, y: 50, width: 600, height: 200 };
  const key = (turns: number[]) => ({ x: 300, y: 150, place: 'centre' as const, kind: 'inflection' as const, turns });

  it('3 waves on 6 columns: the middle wave, whole, at the full height of the curve', () => {
    const fit = wavesThatFit(key([50, 150, 250, 350, 450, 550]), box, 6)!;
    expect(fit).toMatchObject({ shown: 1, total: 3 });
    // Turns 250 and 350, half a wave (50 px) beyond each.
    expect(fit.box).toEqual({ x: 200, y: 50, width: 200, height: 200 });
    // 8 columns show 2 waves.
    expect(wavesThatFit(key([50, 150, 250, 350, 450, 550]), box, 8)).toMatchObject({ shown: 2, total: 3 });
  });

  it('a curve that fits (the two turns of a cubic, one wave) is shown whole', () => {
    expect(wavesThatFit(key([200, 400]), box, 6)).toBeNull();
    expect(wavesThatFit({ x: 300, y: 150, place: 'bottom', kind: 'vertex' }, box, 6)).toBeNull();
  });
});

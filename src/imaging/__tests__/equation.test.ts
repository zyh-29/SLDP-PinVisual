import { EQUATION_PLOT, parseEquation, renderEquation } from '../equation';
import { toRgb } from '../foreground';
import { type GraphRange, parseGraphRange } from '../graphRange';
import { traceLinePins } from '../pinSampling';
import { smartSubject } from '../smartCrop';

describe('typed equations', () => {
  const at = (src: string, x: number) => parseEquation(src)(x);

  it('reads the ways people write them', () => {
    expect(at('y = x^2 - 3', 2)).toBe(1);
    expect(at('f(x) = 2x^2', 3)).toBe(18);
    expect(at('-x^2', 3)).toBe(-9);
    expect(at('3(x+1)', 1)).toBe(6);
    expect(at('2sin(x)cos(x)', 0.4)).toBeCloseTo(Math.sin(0.8), 10);
    expect(at('x sin x', 1)).toBeCloseTo(Math.sin(1), 10);
    expect(at('sqrt(x) + |x - 4|', 1)).toBe(4);
    expect(at('2^3^2', 0)).toBe(512);
    expect(at('x^-1', 4)).toBe(0.25);
    expect(at('y = πx', 1)).toBeCloseTo(Math.PI, 10);
    expect(at('e^x', 1)).toBeCloseTo(Math.E, 10);
    expect(at('exp(x) − 1', 0)).toBe(0);
    expect(at('x² + x³', 2)).toBe(12);
    expect(at('ln(e)', 0)).toBe(1);
    expect(at('1/x', 4)).toBe(0.25);
  });

  it('says what is wrong instead of guessing', () => {
    expect(() => parseEquation('y = foo(x)')).toThrow(/Unknown name/);
    expect(() => parseEquation('y = (x + 1')).toThrow(/Missing/);
    expect(() => parseEquation('x = 2')).toThrow();
    expect(() => parseEquation('')).toThrow(/Type an equation/);
    expect(() => parseEquation('sqrt(-1 - x^2)')).toThrow(/no values/);
    expect(() => parseEquation('2 +')).toThrow(/ends too soon/);
  });

  it('drawn and read back like a screenshot: Graph Range finds the vertex, at the exact scale', () => {
    const { raster, scale } = renderEquation(parseEquation('y = x^2 - 3'));
    const { width: W, height: H, ppu } = EQUATION_PLOT;
    const rgb = toRgb(raster);
    const r = smartSubject(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, removeLines: 'auto' }, undefined, undefined, {
      range: { kind: 'window', units: 5, side: 'both' },
      scale,
      rows: 5,
      cols: 8,
      pinPitchRatio: 1,
    });
    expect(r.kind).toBe('curves');
    const g = r.graph!;
    expect(g.key!.kind).toBe('vertex');
    expect((g.key!.x - g.axes.originX!) / ppu).toBeCloseTo(0, 1);
    expect((g.axes.originY! - g.key!.y) / ppu).toBeCloseTo(-3, 1);
    expect(g.window!.width / ppu).toBeCloseTo(10, 0);
    const pins = traceLinePins(r.mask!, W, H, r.box, 5, 8, 1, true);
    expect(pins.cells.filter(Boolean).length).toBeGreaterThan(6);
  });

  it('a curve far from the x-axis is moved into view', () => {
    const { raster } = renderEquation(parseEquation('x + 40'));
    const rgb = toRgb(raster);
    let red = 0;
    for (let i = 0; i < rgb.length; i += 3) if (rgb[i] === 199 && rgb[i + 1] === 68) red++;
    expect(red).toBeGreaterThan(500);
  });

  it('Whole on a wavy curve: only the waves the pins can show, not a board full of pins', () => {
    const pinsFor = (eq: string) => {
      const { raster, scale } = renderEquation(parseEquation(eq));
      const { width: W, height: H } = EQUATION_PLOT;
      const r = smartSubject(toRgb(raster), W, H, { tolerance: 'auto', minPieceRatio: 0.15, removeLines: 'auto' }, undefined, undefined, {
        range: { kind: 'whole' },
        scale,
        rows: 5,
        cols: 6,
        pinPitchRatio: 1,
      });
      return { r, raised: traceLinePins(r.mask!, W, H, r.box, 5, 6, 1, true).cells.filter(Boolean).length };
    };
    // 2 sin x over the plot is 3 waves; 6 columns show 1 clearly (3 waves raised nearly every pin).
    const wave = pinsFor('2sin(x)');
    expect(wave.r.graph!.waves).toEqual({ shown: 1, total: 3 });
    expect(wave.raised).toBeLessThanOrEqual(15);
    // Curves without waves are shown whole, as before.
    expect(pinsFor('x^2').r.graph!.waves ?? null).toBeNull();
    expect(pinsFor('x^3/5 - 2x').r.graph!.waves ?? null).toBeNull();
  });

  it('Auto: the whole curve when it hides nothing, else the part where it turns and bends', () => {
    const { width: W, height: H, ppu } = EQUATION_PLOT;
    const auto = (eq: string) => {
      const { raster, scale } = renderEquation(parseEquation(eq));
      const r = smartSubject(toRgb(raster), W, H, { tolerance: 'auto', minPieceRatio: 0.15, removeLines: 'auto' }, undefined, undefined, {
        range: { kind: 'auto' },
        scale,
        rows: 5,
        cols: 6,
        pinPitchRatio: 1,
      });
      const g = r.graph!;
      const ux = (px: number) => (px - g.axes.originX!) / ppu;
      const rows = traceLinePins(r.mask!, W, H, r.box, 5, 6, 1, true).cells;
      /** Highest raised row (0 = top) in each pin column. */
      const tops = Array.from({ length: 6 }, (_, c) => [0, 1, 2, 3, 4].find((row) => rows[row * 6 + c]) ?? 5);
      return { g, from: ux(r.box.x), to: ux(r.box.x + r.box.width), tops };
    };
    // A parabola: whole, as before (a U).
    const parabola = auto('x^2');
    expect(parabola.g.features ?? null).toBeNull();
    expect(parabola.tops[0]).toBe(0);
    expect(parabola.tops[5]).toBe(0);
    // A cubic with two turns at x = ±1 (y = ±2): whole, its arms reach y = ±10 and the turns fall in one row. Auto
    // shows x from about −2 to 2, where the pins go up, down and up again.
    const cubic = auto('x^3 - 3x');
    expect(cubic.g.features).toBeTruthy();
    expect(cubic.from).toBeGreaterThan(-2.5);
    expect(cubic.to).toBeLessThan(2.5);
    const t = cubic.tops;
    expect(Math.min(t[1], t[2])).toBeLessThan(Math.max(t[0], t[3])); // a peak on the left
    expect(Math.max(t[3], t[4])).toBeGreaterThan(Math.min(t[2], t[5])); // a trough on the right
    // A bell curve: its bump, not a wide flat line with a spike.
    const bell = auto('e^(-x^2)');
    expect(bell.to - bell.from).toBeLessThan(4);
    // Waves: one wave, as Whole shows them.
    expect(auto('2sin(x)').g.waves).toEqual({ shown: 1, total: 3 });
  });

  it('a typed range: ±, + and − around the vertex, each a new window over the same detection', () => {
    const { raster, scale } = renderEquation(parseEquation('y = x^2 - 3'));
    const { width: W, height: H, ppu } = EQUATION_PLOT;
    const rgb = toRgb(raster);
    const o = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };
    const view = (range: GraphRange) => smartSubject(rgb, W, H, o, undefined, undefined, { range, scale, rows: 5, cols: 6, pinPitchRatio: 1 });
    const read = (text: string) => {
      const r = parseGraphRange(text);
      if (!('range' in r)) throw new Error(r.error);
      const res = view(r.range);
      const ox = res.graph!.axes.originX!;
      return { res, from: (res.box.x - ox) / ppu, to: (res.box.x + res.box.width - ox) / ppu };
    };
    const both = read('+-2');
    expect(both.from).toBeCloseTo(-2, 0);
    expect(both.to).toBeCloseTo(2, 0);
    const right = read('+2');
    expect(right.from).toBeGreaterThan(-0.5);
    expect(right.to).toBeCloseTo(2, 0);
    const left = read('-2');
    expect(left.from).toBeCloseTo(-2, 0);
    expect(left.to).toBeLessThan(0.5);
    // Measured from the middle of the graph (x = 0), not the curve's vertex: (x − 3)² at ±2 shows x from −2 to 2.
    const shifted = renderEquation(parseEquation('(x-3)^2'));
    const sr = smartSubject(toRgb(shifted.raster), W, H, o, undefined, undefined, {
      range: { kind: 'window', units: 2, side: 'both' },
      scale: shifted.scale,
      rows: 5,
      cols: 6,
      pinPitchRatio: 1,
    });
    const sox = sr.graph!.axes.originX!;
    expect((sr.box.x - sox) / ppu).toBeCloseTo(-2, 0);
    expect((sr.box.x + sr.box.width - sox) / ppu).toBeCloseTo(2, 0);
    // The curve's vertex still describes it in words.
    expect((sr.graph!.key!.x - sox) / ppu).toBeCloseTo(3, 0);
    // The curves were found once for this picture: every range reuses them (the same pixels, not found again).
    expect(right.res.mask).toBe(both.res.mask);
    expect(left.res.mask).toBe(both.res.mask);
    expect(view({ kind: 'auto' }).mask).toBe(both.res.mask);
  });

  it('1/x: two branches, no line joining them across the gap', () => {
    const { raster } = renderEquation(parseEquation('1/x'));
    const { width: W, height: H } = EQUATION_PLOT;
    const rgb = toRgb(raster);
    // Just right of the y-axis, low down: only a line joining the branches (from -inf to +inf) would be there.
    let red = 0;
    for (let y = H - 100; y < H - 5; y++)
      for (let x = W / 2 + 2; x <= W / 2 + 4; x++) if (rgb[(y * W + x) * 3] === 199 && rgb[(y * W + x) * 3 + 1] === 68) red++;
    expect(red).toBe(0);
  });
});

import { EQUATION_PLOT, parseEquation, renderEquation } from '../equation';
import { toRgb } from '../foreground';
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
      range: 5,
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

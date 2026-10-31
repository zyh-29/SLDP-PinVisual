import { luma, rgbaToRgb, rgbToRgba } from '../pixels';

describe('pixel helpers', () => {
  it('brightness weights green most and blue least', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255);
    expect(luma(0, 255, 0)).toBeGreaterThan(luma(255, 0, 0));
    expect(luma(255, 0, 0)).toBeGreaterThan(luma(0, 0, 255));
  });

  it('RGBA to RGB and back (opaque)', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 9, 4, 5, 6, 0]);
    const rgb = rgbaToRgb(rgba, 2);
    expect(Array.from(rgb)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(rgbToRgba(rgb, 2, new Uint8ClampedArray(8)))).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('writes into a reused buffer', () => {
    const out = new Uint8ClampedArray(3);
    expect(rgbaToRgb([7, 8, 9, 255], 1, out)).toBe(out);
  });
});

import { type RasterImage, toGrayscale } from '../convert';

/** Builds an RGBA image from a per-pixel function. */
function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number?]): RasterImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = px(x, y);
      data.set([r, g, b, a], (y * w + x) * 4);
    }
  return { width: w, height: h, data, channels: 4 };
}

describe('grayscale', () => {
  it('uses Rec. 709 weights', () => {
    const g = toGrayscale(image(3, 1, (x) => (x === 0 ? [255, 0, 0] : x === 1 ? [0, 255, 0] : [0, 0, 255])));
    expect(g[0]).toBeCloseTo(54.2, 1);
    expect(g[1]).toBeCloseTo(182.4, 1);
    expect(g[2]).toBeCloseTo(18.4, 1);
  });

  it('composites transparent pixels over white so they stay lowered', () => {
    const g = toGrayscale(image(2, 1, (x) => [0, 0, 0, x === 0 ? 0 : 128]));
    expect(g[0]).toBe(255);
    expect(g[1]).toBeCloseTo(127, 0);
  });
});

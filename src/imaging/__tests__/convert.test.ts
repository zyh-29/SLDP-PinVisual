import { encode } from 'fast-png';
import { type RasterImage, toGrayscale } from '../convert';
import { decodePngToRaster } from '../decodePng';

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

describe('PNG decoding', () => {
  it('decodes real PNG bytes', () => {
    const w = 16;
    const h = 10;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x >= 8 ? 0 : 255; // right half black
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    const png = encode({ width: w, height: h, data, channels: 4, depth: 8 });
    const raster = decodePngToRaster(png);
    expect(raster).toMatchObject({ width: 16, height: 10, channels: 4 });
    const gray = toGrayscale(raster);
    expect([gray[0], gray[7], gray[8], gray[w * h - 1]]).toEqual([255, 255, 0, 0]);
  });

  it('decodes 16-bit grayscale PNGs', () => {
    const data = Uint16Array.of(0, 65535, 65535, 0);
    const raster = decodePngToRaster(encode({ width: 2, height: 2, data, channels: 1, depth: 16 }));
    expect(Array.from(raster.data)).toEqual([0, 255, 255, 0]);
  });
});

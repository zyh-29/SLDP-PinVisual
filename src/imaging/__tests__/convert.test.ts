import { encode } from 'fast-png';
import {
  computePlacement,
  imageToPattern,
  patternFromLuminance,
  type RasterImage,
  sampleCells,
  thresholdCells,
  toGrayscale,
} from '../convert';
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

const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const grid = (cells: readonly number[], cols: number) =>
  Array.from({ length: cells.length / cols }, (_, r) => cells.slice(r * cols, (r + 1) * cols).join(''));

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

describe('threshold conversion', () => {
  it('raises dark pins by default and lowers them with invert', () => {
    expect(thresholdCells([0, 100, 127, 128, 200, 255], 128, false)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(thresholdCells([0, 100, 127, 128, 200, 255], 128, true)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('threshold 0 lowers everything, threshold 255 raises all but pure white', () => {
    expect(thresholdCells([0, 254, 255], 0, false)).toEqual([0, 0, 0]);
    expect(thresholdCells([0, 254, 255], 255, false)).toEqual([1, 1, 0]);
  });

  it('converts a left-black / right-white image into raised left columns', () => {
    const img = image(80, 50, (x) => (x < 40 ? BLACK : WHITE));
    const { pattern } = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fit' });
    expect(grid(pattern.cells, 8)).toEqual(Array(5).fill('11110000'));
  });

  it('keeps row order top-to-bottom', () => {
    const img = image(8, 5, (_x, y) => (y === 0 ? BLACK : WHITE));
    const { pattern } = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fit' });
    expect(grid(pattern.cells, 8)).toEqual(['11111111', '00000000', '00000000', '00000000', '00000000']);
  });

  it('moving the threshold changes which grey cells are raised', () => {
    const img = image(8, 1, (x) => [x * 32, x * 32, x * 32]); // 0, 32, ..., 224
    const { cellLuminance } = imageToPattern(img, { rows: 1, cols: 8, threshold: 128, invert: false, fit: 'fill' });
    expect(patternFromLuminance(cellLuminance, 1, 8, 64, false).cells).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(patternFromLuminance(cellLuminance, 1, 8, 200, false).cells).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
  });
});

describe('aspect ratio handling', () => {
  it("'fit' pads a square image with lowered pins on the sides", () => {
    // Solid black square on an 8x5 grid: occupies the centre 5 columns.
    const img = image(100, 100, () => BLACK);
    const { pattern, cellLuminance } = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fit' });
    // Square spans columns 1.5..6.5: cols 0 and 7 are pure padding, 1 and 6 half covered.
    expect(cellLuminance[0]).toBe(255);
    expect(cellLuminance[1]).toBeCloseTo(127.5, 3);
    // 127.5 is just darker than 128, so the half-covered edge columns count as dark...
    expect(grid(pattern.cells, 8)).toEqual(Array(5).fill('01111110'));
    // ...and a slightly lower threshold leaves only the fully covered columns raised.
    expect(grid(patternFromLuminance(cellLuminance, 5, 8, 120, false).cells, 8)).toEqual(Array(5).fill('00111100'));
  });

  it("'fill' crops the overflow and covers every pin", () => {
    const img = image(100, 100, () => BLACK);
    const { pattern } = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fill' });
    expect(pattern.cells.every((v) => v === 1)).toBe(true);
  });

  it("'fill' crops top and bottom equally for a tall image", () => {
    // 8x16 image, top quarter black: after cropping to 8x5 aspect (centre 10 rows), no black remains.
    const img = image(8, 16, (_x, y) => (y < 3 ? BLACK : WHITE));
    const { pattern } = imageToPattern(img, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fill' });
    expect(pattern.cells.every((v) => v === 0)).toBe(true);
    const pl = computePlacement(8, 16, 5, 8, 'fill');
    expect(pl.offsetY).toBeCloseTo(-5.5, 5); // 16px * scale 1 = 16 units tall, grid 5 -> 5.5 cropped each side
  });

  it('respects a non-square pin pitch', () => {
    const pl = computePlacement(100, 100, 5, 8, 'fit', 0.5); // grid is 4 x 5 units
    expect(pl.scale).toBeCloseTo(0.04);
    expect(pl.offsetY).toBeCloseTo(0.5);
  });

  it('averages exactly over fractional pixel coverage', () => {
    // 3x1 image filling a 1x2 grid: centred crop keeps pixels 0.5..2.5,
    // so cell 0 covers half of px0 (black) and half of px1 (white).
    const gray = Float32Array.of(0, 255, 255);
    const cells = sampleCells(gray, 3, 1, 1, 2, 'fill');
    expect(cells[0]).toBeCloseTo(127.5, 3);
    expect(cells[1]).toBe(255);
  });
});

describe('PNG decoding', () => {
  it('decodes real PNG bytes and converts them end to end', () => {
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
    const { pattern } = imageToPattern(raster, { rows: 5, cols: 8, threshold: 128, invert: false, fit: 'fit' });
    expect(grid(pattern.cells, 8)).toEqual(Array(5).fill('00001111'));
  });

  it('decodes 16-bit grayscale PNGs', () => {
    const data = Uint16Array.of(0, 65535, 65535, 0);
    const raster = decodePngToRaster(encode({ width: 2, height: 2, data, channels: 1, depth: 16 }));
    expect(Array.from(raster.data)).toEqual([0, 255, 255, 0]);
  });
});

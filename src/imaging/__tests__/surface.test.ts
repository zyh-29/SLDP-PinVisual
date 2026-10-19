/**
 * Camera pictures of flat things: finding and flattening a screen or a page seen in perspective, and telling the
 * background (several colours, shadows) from the subject.
 */
import { findForeground } from '../foreground';
import type { Point } from '../geometry';
import { smartSubject } from '../smartCrop';
import { findSurface, flatten, mapRect, quadHomography, type Quad } from '../surface';

const W = 320;
const H = 180;
type C = [number, number, number];

function picture(px: (x: number, y: number) => C, noise = 4, seed = 1): Uint8ClampedArray {
  let s = seed;
  const n = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s & 0xffff) / 0x10000 - 0.5) * 2 * noise;
  };
  const rgb = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = px(x, y);
      for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = c[k] + n();
    }
  return rgb;
}

const wood = (x: number, y: number): C => [150 + 14 * Math.sin(x / 5 + Math.sin(y / 20) * 3), 108, 74];
const cloth = (x: number, y: number): C => ((Math.floor(x / 30) + Math.floor(y / 30)) % 2 ? [70, 90, 120] : [200, 190, 160]);

/** A sheet of paper in perspective (corners `q`), with `drawing(u, v)` on it (null = paper), on `table`. */
function sheet(q: Quad, drawing: (u: number, v: number) => C | null, table = wood) {
  const map = quadHomography(q);
  return picture((x, y) => {
    const p = map.toPage(x + 0.5, y + 0.5);
    if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) return drawing(p.x, p.y) ?? [245, 244, 238];
    return table(x, y);
  });
}

const tilted: Quad = [
  { x: 100, y: 40 },
  { x: 250, y: 25 },
  { x: 262, y: 160 },
  { x: 90, y: 150 },
];
const triangle = (u: number, v: number): C | null => (v > 0.25 && v < 0.85 && Math.abs(u - 0.5) < ((v - 0.25) / 0.6) * 0.3 ? [235, 120, 30] : null);
const near = (a: Point, b: Point, d: number) => Math.hypot(a.x - b.x, a.y - b.y) <= d;

describe('finding a flat surface (a page, a screen) in a camera picture', () => {
  it('finds a tilted sheet of paper on a wooden table, corners within a few pixels', () => {
    const s = findSurface(sheet(tilted, triangle), W, H);
    expect(s).not.toBeNull();
    s!.quad.forEach((p, i) => expect(near(p, tilted[i], 6)).toBe(true));
  });

  it('finds it on a checked cloth too (the background is two colours)', () => {
    const s = findSurface(sheet(tilted, triangle, cloth), W, H);
    expect(s).not.toBeNull();
    s!.quad.forEach((p, i) => expect(near(p, tilted[i], 10)).toBe(true));
  });

  it('flattens it: the drawing comes out straight, in the page’s proportions, without the table', () => {
    const rgb = sheet(tilted, triangle);
    const page = flatten(rgb, W, H, findSurface(rgb, W, H)!);
    const at = (u: number, v: number) => {
      const i = (Math.floor(v * page.height) * page.width + Math.floor(u * page.width)) * 3;
      return [page.rgb[i], page.rgb[i + 1], page.rgb[i + 2]];
    };
    // Corners of the page: paper (no wood); the triangle's middle: orange.
    for (const [u, v] of [
      [0.04, 0.04],
      [0.96, 0.04],
      [0.96, 0.96],
      [0.04, 0.96],
    ])
      expect(Math.min(...at(u, v))).toBeGreaterThan(200);
    expect(at(0.5, 0.7)[0]).toBeGreaterThan(200);
    expect(at(0.5, 0.7)[2]).toBeLessThan(90);
    // Page coordinates and picture coordinates map back and forth.
    const p = { x: page.width * 0.3, y: page.height * 0.6 };
    const back = page.toPage(page.toPicture(p));
    expect(near(back, p, 0.01)).toBe(true);
    const box = mapRect({ x: 0, y: 0, width: page.width, height: page.height }, page.toPicture);
    expect(box.x).toBeGreaterThan(85);
    expect(box.x + box.width).toBeLessThan(265);
  });

  it('a plain card is not a page (nothing on it: it is the subject itself)', () => {
    expect(findSurface(sheet(tilted, () => null), W, H)).toBeNull();
  });

  it('a triangle is not a page (it has no fourth corner)', () => {
    const rgb = picture((x, y) => (y > 30 && y < 160 && Math.abs(x - 160) < ((y - 30) / 130) * 90 ? [240, 240, 236] : wood(x, y)));
    expect(findSurface(rgb, W, H)).toBeNull();
  });

  it('a screen filling the whole view has nothing to flatten', () => {
    const rgb = picture((x, y) => (x % 20 === 0 || y % 20 === 0 ? [215, 215, 215] : Math.abs(y - 90 - 0.01 * (x - 160) ** 2) < 2 ? [45, 112, 179] : [250, 250, 250]));
    expect(findSurface(rgb, W, H)).toBeNull();
  });
});

describe('camera backgrounds: several colours and shadows are background', () => {
  const square = (x: number, y: number) => Math.abs(x - 160) < 45 && Math.abs(y - 90) < 45;
  const shadowed = (table: (x: number, y: number) => C) => (x: number, y: number): C => {
    if (square(x, y)) return [40, 150, 80];
    const c = table(x, y);
    return square(x - 8, y - 10) ? (c.map((v) => v * 0.62) as C) : c;
  };

  it('a green square on a checked cloth: only the square is kept (camera)', () => {
    const rgb = picture(shadowed(cloth));
    const old = findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15 });
    const cam = findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, camera: true });
    // Without the camera model one cloth colour counts as subject; with it the square comes out alone.
    expect(old.subject!.width).toBeGreaterThan(200);
    expect(cam.subject).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    // Within 10 px: where the shadow falls on the dark-blue squares a sliver of it stays (shading is not
    // allowed for on dark colours, so that a black object on a dark table still shows).
    expect(Math.abs(cam.subject!.width - 90)).toBeLessThanOrEqual(10);
    expect(Math.abs(cam.subject!.height - 90)).toBeLessThanOrEqual(10);
  });

  it('its shadow on a plain desk is background, not part of the subject', () => {
    const rgb = picture(shadowed(() => [236, 234, 228]));
    const cam = findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, camera: true });
    expect(Math.abs(cam.subject!.width - 90)).toBeLessThanOrEqual(4);
  });

  it('a black object on a dark table still stands out (no "shading" on dark backgrounds)', () => {
    const rgb = picture((x, y) => (Math.hypot(x - 160, y - 90) < 40 ? [26, 26, 30] : [64, 68, 72]));
    const cam = findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, camera: true });
    expect(cam.subject).not.toBeNull();
    expect(Math.abs(cam.subject!.width - 80)).toBeLessThanOrEqual(6);
  });
});

describe('camera pictures: what is not a curve, and what is not a subject', () => {
  const o = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };

  it('wood grain is not a graph curve: an object on a wooden table is found as a shape', () => {
    const rgb = picture((x, y) => (Math.hypot(x - 160, y - 90) < 45 ? [40, 90, 200] : wood(x, y)));
    const r = smartSubject(rgb, W, H, { ...o, camera: true });
    expect(r.kind).toBe('shape');
    expect(Math.abs(r.box.width - 90)).toBeLessThanOrEqual(6);
  });

  it('a coloured strip along a flattened page’s edge (a sliver of table) is not a curve', () => {
    const rgb = picture((x, y) => (x < 4 ? [70, 90, 140] : Math.hypot(x - 160, y - 90) < 40 ? [235, 120, 30] : [245, 244, 238]));
    const r = smartSubject(rgb, W, H, { ...o, flatSurface: true, camera: true });
    expect(r.kind).toBe('shape');
  });

  it('a plain card: the card is the subject, not a sliver at its rim', () => {
    // The card's left edge is a little darker (light falling off), which used to be taken for "what is on it".
    const rgb = picture((x, y) => (Math.abs(x - 160) < 50 && Math.abs(y - 90) < 50 ? (x < 116 ? [30, 128, 68] : [40, 150, 80]) : [62, 66, 70]));
    const r = smartSubject(rgb, W, H, { ...o, camera: true });
    expect(r.box.width).toBeGreaterThan(90);
    expect(r.box.height).toBeGreaterThan(90);
  });
});

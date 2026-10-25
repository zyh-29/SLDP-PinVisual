/**
 * A shared screen: a desktop wallpaper (a gradient or a photo) with a menu bar, a dock, and a window with a soft
 * shadow. The subject is inside the window.
 */
import { findForeground } from '../foreground';
import type { Rect } from '../geometry';
import { cropPixels, pasteMask, sameBox, uncutPhoto } from '../screenPhoto';
import { smartSubject } from '../smartCrop';

type C = [number, number, number];
const W = 800;
const H = 500;
const WINDOW: Rect = { x: 100, y: 40, width: 600, height: 390 };
const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const, flatSurface: false, camera: false };

/** Deterministic noise in 0..1. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Blue to purple to orange, corner to corner. */
function gradient(x: number, y: number): C {
  const t = (x / W + y / H) / 2;
  const stops: C[] = [
    [58, 110, 165],
    [142, 90, 168],
    [224, 138, 90],
  ];
  const k = t < 0.6 ? 0 : 1;
  const f = k === 0 ? t / 0.6 : (t - 0.6) / 0.4;
  return stops[k].map((v, i) => Math.round(v + (stops[k + 1][i] - v) * f)) as C;
}

/** A photo: soft blotches of grass and fur colours, with grain. */
function photo(seed: number) {
  const r = noise(seed);
  const blobs = Array.from({ length: 14 }, () => ({ x: r() * W, y: r() * H, s: 60 + r() * 120, c: [r() * 200 + 30, r() * 200 + 30, r() * 150 + 20] }));
  const grain = noise(seed + 1);
  return (x: number, y: number): C => {
    let w = 0;
    const c = [0, 0, 0];
    for (const b of blobs) {
      const k = Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (b.s * b.s));
      w += k;
      for (let i = 0; i < 3; i++) c[i] += b.c[i] * k;
    }
    return c.map((v) => Math.max(0, Math.min(255, v / Math.max(w, 1e-6) + (grain() - 0.5) * 30))) as C;
  };
}

/** The desktop: wallpaper, menu bar, dock, and the window (drawn by `inside`, window coordinates) with its shadow. */
function desktop(wallpaper: (x: number, y: number) => C, inside: (x: number, y: number) => C) {
  const rgb = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: C;
      const inWindow = x >= WINDOW.x && x < WINDOW.x + WINDOW.width && y >= WINDOW.y && y < WINDOW.y + WINDOW.height;
      if (inWindow) c = inside(x - WINDOW.x, y - WINDOW.y);
      else if (y < 13) c = x % 40 < 22 && y > 3 && y < 10 && x < 300 ? [30, 30, 30] : [236, 236, 238];
      else if (y > 466 && y < 492 && x > 290 && x < 510) c = (x - 290) % 28 < 24 ? [((x * 7) % 200) + 40, 120, 200] : [200, 200, 210];
      else {
        c = wallpaper(x, y);
        // The window's soft shadow, deepest just below it.
        const dx = Math.max(WINDOW.x - x, 0, x - (WINDOW.x + WINDOW.width));
        const dy = Math.max(WINDOW.y + 12 - y, 0, y - (WINDOW.y + WINDOW.height + 12));
        const d = Math.hypot(dx, dy);
        const k = 1 - 0.45 * Math.max(0, 1 - d / 40);
        c = c.map((v) => Math.round(v * k)) as C;
      }
      rgb.set(c, (y * W + x) * 3);
    }
  return rgb;
}

/** A light window: grey toolbar, white page, and `page` drawn on it (page coordinates). */
const lightWindow = (page: (x: number, y: number) => C | null) => (x: number, y: number): C =>
  y < 40 ? [222, 225, 230] : (page(x, y - 40) ?? [255, 255, 255]);

const RED_DISC = (x: number, y: number): C | null => (Math.hypot(x - 400, y - 170) < 90 ? [220, 36, 94] : null);
const DISC_BOX: Rect = { x: WINDOW.x + 310, y: WINDOW.y + 40 + 80, width: 180, height: 180 };

const near = (a: Rect, b: Rect, slack: number) =>
  Math.abs(a.x - b.x) <= slack &&
  Math.abs(a.y - b.y) <= slack &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= slack &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= slack;

describe('screen share: the desktop around the window is background', () => {
  it('a gradient wallpaper of several colours (one colour or a two-colour gradient can’t describe it)', () => {
    const rgb = desktop(gradient, lightWindow(RED_DISC));
    const fg = findForeground(rgb, W, H, { ...opts });
    // Wallpaper anywhere (left, right, below the window) is gone; the window is kept.
    expect(fg.mask[250 * W + 40]).toBe(0);
    expect(fg.mask[250 * W + 760]).toBe(0);
    expect(fg.mask[455 * W + 150]).toBe(0);
    expect(fg.mask[100 * W + 200]).toBe(1);
    expect(near(smartSubject(rgb, W, H, opts).box, DISC_BOX, 6)).toBe(true);
  });

  it('a photo wallpaper (textured, where windows are flat)', () => {
    const rgb = desktop(photo(7), lightWindow(RED_DISC));
    const fg = findForeground(rgb, W, H, { ...opts });
    expect(fg.mask[250 * W + 40]).toBe(0);
    expect(fg.mask[455 * W + 600]).toBe(0);
    expect(near(smartSubject(rgb, W, H, opts).box, DISC_BOX, 6)).toBe(true);
  });

  it('a dark window keeps its flat inside (the wallpaper’s texture reaching its edge doesn’t let the drift in)', () => {
    const dark = (x: number, y: number): C => (y < 40 ? [43, 43, 43] : Math.hypot(x - 400, y - 210) < 90 ? [154, 154, 154] : [30, 30, 30]);
    // A browser's gradient is dithered: a level or two of noise, enough to count as texture.
    const d = noise(11);
    const dithered = (x: number, y: number) => gradient(x, y).map((v) => v + Math.round((d() - 0.5) * 6)) as C;
    const rgb = desktop(dithered, dark);
    expect(near(smartSubject(rgb, W, H, opts).box, DISC_BOX, 6)).toBe(true);
  });

  it('a photo on the page whose colours match the wallpaper: the window is still looked inside', () => {
    // An orange-and-beige "photo" (like a cat in front of a wall) in the window, the wallpaper's colours.
    const r = noise(3);
    const PHOTO: Rect = { x: 300, y: 30, width: 240, height: 260 };
    const page = (x: number, y: number): C | null =>
      x >= PHOTO.x && x < PHOTO.x + PHOTO.width && y >= PHOTO.y && y < PHOTO.y + PHOTO.height
        ? ((Math.hypot(x - 420, y - 170) < 80 ? [214, 132, 70] : [176, 120, 160]).map((v) => v + (r() - 0.5) * 40) as C)
        : null;
    const rgb = desktop(gradient, lightWindow(page));
    const box = smartSubject(rgb, W, H, opts).box;
    // Inside the photo (its orange subject, or the photo itself), not the window or the desktop.
    const inPhoto = { x: WINDOW.x + PHOTO.x, y: WINDOW.y + 40 + PHOTO.y, width: PHOTO.width, height: PHOTO.height };
    expect(box.x).toBeGreaterThanOrEqual(inPhoto.x - 2);
    expect(box.y).toBeGreaterThanOrEqual(inPhoto.y - 2);
    expect(box.x + box.width).toBeLessThanOrEqual(inPhoto.x + inPhoto.width + 2);
    expect(box.y + box.height).toBeLessThanOrEqual(inPhoto.y + inPhoto.height + 2);
  });
});

describe('photos shown on a screen (screenPhoto)', () => {
  const w = 160;
  const h = 120;
  const r = noise(5);
  // A photo's fine grain: brightness wobbling by a few levels from pixel to pixel.
  const grainy = new Uint8ClampedArray(w * h * 3).map(() => 120 + r() * 10);
  const flat = new Uint8ClampedArray(w * h * 3).fill(200);
  const box: Rect = { x: 10, y: 5, width: 120, height: 90 };
  const maskFilling = (inside: (x: number, y: number) => boolean) => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside(x, y) ? 1 : 0;
    return m;
  };
  const inBox = (x: number, y: number) => x >= 10 && x < 130 && y >= 5 && y < 95;

  it('crops pixels and puts a crop-sized mask back in place', () => {
    const rgb = new Uint8ClampedArray(w * h * 3).map((_, i) => i % 251);
    const crop = cropPixels(rgb, w, h, box);
    expect([crop.width, crop.height]).toEqual([120, 90]);
    expect(Array.from(crop.rgb.slice(0, 3))).toEqual(Array.from(rgb.slice((5 * w + 10) * 3, (5 * w + 10) * 3 + 3)));
    const back = pasteMask(new Float32Array(120 * 90).fill(1), crop.box, w, h);
    expect(back[5 * w + 10]).toBe(1);
    expect(back[94 * w + 129]).toBe(1);
    expect(back[4 * w + 10]).toBe(0);
    expect(back[5 * w + 130]).toBe(0);
  });

  it('a grainy photo the colour removal kept whole needs the cut-out', () => {
    expect(uncutPhoto(grainy, w, h, box, maskFilling(inBox))).toBe(true);
  });

  it('not a flat picture, nor a photo the colour removal already cut', () => {
    expect(uncutPhoto(flat, w, h, box, maskFilling(inBox))).toBe(false);
    expect(uncutPhoto(grainy, w, h, box, maskFilling((x, y) => Math.hypot(x - 70, y - 50) < 35))).toBe(false);
  });

  it('a live frame’s box that moved a little is the same photo', () => {
    expect(sameBox(box, { x: 11, y: 6, width: 120, height: 89 }, 800, 500)).toBe(true);
    expect(sameBox(box, { x: 100, y: 5, width: 120, height: 90 }, 800, 500)).toBe(false);
  });
});

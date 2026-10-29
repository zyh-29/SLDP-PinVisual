import { findSky, isLandscape, landMask, skylineBand } from '../scene';
import { noise } from './support/cameraScenes';

const W = 640;
const H = 400;

/** The ridge: jagged peaks between y = 110 and y = 190. */
const ridge = (x: number) => 150 + 40 * Math.sin(x / 37) * Math.cos(x / 91) + 15 * Math.sin(x / 9);

type Paint = (x: number, y: number, n: (amp: number) => number) => [number, number, number] | null;

/** Sky (a soft blue gradient), mountains below the ridge (grey rock with texture), anything `extra` paints on top. */
function landscape(extra?: Paint, seed = 5) {
  const n = noise(seed);
  const rgb = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: [number, number, number];
      if (y < ridge(x)) c = [120 + y * 0.3, 160 + y * 0.25, 225];
      else {
        // Rock and forest: texture everywhere.
        const t = ((x * 7 + y * 13) % 23) * 3 + n(18);
        c = y < 260 ? [95 + t, 92 + t, 98 + t] : [40 + t, 80 + t, 35 + t];
      }
      const e = extra?.(x, y, n);
      if (e) c = e;
      const i = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) rgb[i + k] = c[k] + n(2);
    }
  return rgb;
}

/** A puffy cloud at (cx, cy): white, its edge lumpy and its inside shaded. */
const cloud = (cx: number, cy: number, r: number): Paint => (x, y, n) => {
  const d = Math.hypot((x - cx) / 1.8, y - cy);
  if (d > r + 4 * Math.sin(x / 3)) return null;
  const v = 235 - (d / r) * 30 + n(10);
  return [v, v, v + 4];
};

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

describe('landscapes: the sky and the skyline', () => {
  // Within 20 px (5% of the height): the sky is found on a copy 160 px wide, so the bottom of a narrow V between
  // two peaks blurs into the rock. On the pins (a row is a fifth of the crop) that's nothing.
  it('finds the skyline along the peaks', () => {
    const sky = findSky(landscape(), W, H)!;
    expect(sky).not.toBeNull();
    let off = 0;
    for (let x = 0; x < W; x += 8) if (!near(sky.skyline[x], ridge(x), 20)) off++;
    expect(off).toBeLessThanOrEqual(3);
  });

  it('clouds in the sky are not land, even when they stop the sky from growing', () => {
    const sky = findSky(landscape(cloud(200, 50, 30)), W, H)!;
    for (const x of [160, 200, 240]) expect(near(sky.skyline[x], ridge(x), 20)).toBe(true);
  });

  it('a cloud touching a peak, with sky below the rest of it, is not land either', () => {
    // The peak near x = 430 (y = 140) touches the cloud's underside; on either side there is sky below the cloud.
    const peak = 430;
    const sky = findSky(landscape(cloud(peak, ridge(peak) - 18, 20)), W, H)!;
    for (const x of [400, 460]) expect(near(sky.skyline[x], ridge(x), 20)).toBe(true);
  });

  // (A cloud lying along the ridge with no sky under it anywhere stays land: nothing in the picture tells them apart.)

  it('a room (no sky across the top) has no skyline', () => {
    const n = noise(9);
    const rgb = new Uint8ClampedArray(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const t = ((i * 7) % 29) * 4 + n(20);
      rgb[i * 3] = 120 + t;
      rgb[i * 3 + 1] = 90 + t;
      rgb[i * 3 + 2] = 70 + t;
    }
    expect(findSky(rgb, W, H)).toBeNull();
  });

  it('the land is everything below the skyline; the band shows the peaks above solid ground', () => {
    const sky = findSky(landscape(), W, H)!;
    const land = landMask(sky);
    expect(land[10 * W + 100]).toBe(0);
    expect(land[350 * W + 100]).toBe(1);
    const band = skylineBand(sky);
    expect(band.x).toBe(0);
    expect(band.width).toBe(W);
    const top = Math.min(...Array.from(sky.skyline));
    expect(band.y).toBeLessThanOrEqual(top);
    expect(band.y + band.height).toBeGreaterThan(195);
    expect(band.y + band.height).toBeLessThan(H);
  });
});

describe('landscape or an object in front of the sky', () => {
  const sky = findSky(landscape(), W, H)!;
  const mask = (inside: (x: number, y: number) => boolean) => {
    const m = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) m[y * W + x] = 1;
    return m;
  };

  it('no cut-out at all: the land is the subject', () => {
    expect(isLandscape(sky, null)).toBe(true);
  });

  it('a cut-out whose top edge is the ridge (the mountains themselves): a landscape', () => {
    expect(isLandscape(sky, mask((x, y) => y >= ridge(x) + 3 && y < 300))).toBe(true);
  });

  it('a car well below the skyline: an object, shown as itself', () => {
    expect(isLandscape(sky, mask((x, y) => x > 180 && x < 460 && y > 270 && y < 360))).toBe(false);
  });

  it('a cut-out of the whole picture, sky and all (a photo framed by a screen): still a landscape', () => {
    expect(isLandscape(sky, mask((x, y) => x > 4 && x < W - 4 && y > 4 && y < H - 4))).toBe(true);
  });

  it('a cut-out of the ground (a meadow running out of the bottom, all the way across): still a landscape', () => {
    expect(isLandscape(sky, mask((x, y) => y > 240))).toBe(true);
  });

  it('a car filling the view, its wheels at the bottom edge: an object', () => {
    const wheel = (x: number, y: number, cx: number) => Math.hypot(x - cx, y - 370) < 30;
    expect(isLandscape(sky, mask((x, y) => (x > 40 && x < 600 && y > 230 && y < 360) || wheel(x, y, 150) || wheel(x, y, 490)))).toBe(false);
  });

  it('a speck (a hiker on the ridge): not enough to be the subject', () => {
    expect(isLandscape(sky, mask((x, y) => x > 300 && x < 310 && y > 250 && y < 280))).toBe(true);
  });
});

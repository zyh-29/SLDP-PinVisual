/**
 * The camera lock under pressure: a virtual phone camera moves over a desk with two graphs side by side and a
 * shape card (look-alikes on purpose), pans, comes closer, backs off, with sensor noise. The tracker must stay
 * on the item it was locked to, and switch only when told to.
 */
import type { Rect } from '../geometry';
import { smallGray, TargetTracker } from '../tracker';

type C = [number, number, number];
const W = 640;
const H = 360;

/** The desk, in world units (1 unit = 1 frame pixel at zoom 1). */
const PLOT_A: Rect = { x: 120, y: 120, width: 220, height: 200 };
const PLOT_B: Rect = { x: 400, y: 120, width: 220, height: 200 };
const CARD: Rect = { x: 680, y: 160, width: 110, height: 110 };

/** The two graphs: where each is, and its curve. Built once: world() runs for every pixel of every frame. */
const PLOTS = [
  [PLOT_A, (u: number) => 70 + 0.008 * (u - 110) ** 2], // parabola
  [PLOT_B, (u: number) => 170 - 0.8 * (u - 40)], // line
] as const;

function world(x: number, y: number): C {
  const inR = (r: Rect) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
  for (let i = 0; i < PLOTS.length; i++) {
    const r = PLOTS[i][0];
    const curve = PLOTS[i][1];
    if (!inR(r)) continue;
    const u = x - r.x;
    const v = y - r.y;
    if (Math.abs(v - curve(u)) < 2.2) return r === PLOT_A ? [200, 60, 55] : [40, 105, 185];
    if (Math.abs(u - r.width / 2) < 1.2 || Math.abs(v - r.height / 2) < 1.2) return [90, 90, 90];
    if (u % 20 < 1 || v % 20 < 1) return [205, 205, 205];
    return [250, 249, 245];
  }
  if (inR(CARD)) {
    const u = x - CARD.x;
    const v = y - CARD.y;
    return v > 15 && v < 95 && Math.abs(u - 55) < ((v - 15) / 80) * 45 ? [240, 140, 30] : [235, 230, 220];
  }
  return [150 + 12 * Math.sin(x / 9 + Math.sin(y / 40) * 3), 110, 75]; // wooden desk
}

interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

/** A camera frame (RGB, 3 channels) and how the world maps into it. */
function shoot(cam: Camera, seed: number) {
  let s = seed >>> 0;
  const n = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s & 0xffff) / 0x10000 - 0.5) * 16;
  };
  const rgb = new Uint8ClampedArray(W * H * 3);
  for (let v = 0; v < H; v++)
    for (let u = 0; u < W; u++) {
      const c = world(cam.cx + (u - W / 2) / cam.zoom, cam.cy + (v - H / 2) / cam.zoom);
      for (let k = 0; k < 3; k++) rgb[(v * W + u) * 3 + k] = c[k] + n();
    }
  const toFrame = (r: Rect): Rect => ({
    x: (r.x - cam.cx) * cam.zoom + W / 2,
    y: (r.y - cam.cy) * cam.zoom + H / 2,
    width: r.width * cam.zoom,
    height: r.height * cam.zoom,
  });
  return { rgb, toFrame };
}

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A walk: pan right and back, come closer (zoom 1.7), back off (0.75), with a little shake. */
function path(steps: number): Camera[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return {
      cx: 260 + 90 * Math.sin(t * Math.PI * 2) + 3 * Math.sin(i * 1.7),
      cy: 220 + 25 * Math.sin(t * Math.PI * 3) + 2 * Math.cos(i * 1.3),
      zoom: 1 + 0.7 * Math.sin(t * Math.PI) - 0.25 * Math.sin(t * Math.PI * 2) ** 2,
    };
  });
}

describe('camera lock (tracking one item while the phone moves)', () => {
  it('stays on the locked graph through pans, coming closer and backing off, never jumping to the look-alike next to it', () => {
    const cams = path(28);
    const tracker = new TargetTracker();
    const first = shoot(cams[0], 1);
    expect(tracker.lock(smallGray(first.rgb, W, H), first.toFrame(PLOT_A))).toBe(true);
    for (let i = 1; i < cams.length; i++) {
      const f = shoot(cams[i], i + 1);
      const r = tracker.track(smallGray(f.rgb, W, H));
      expect(r).not.toBeNull();
      const truth = f.toFrame(PLOT_A);
      const got = centre(r!.box);
      const want = centre(truth);
      // Within 15% of the plot's size, and the size within 25%.
      expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(0.15 * truth.width);
      expect(r!.box.width / truth.width).toBeGreaterThan(0.75);
      expect(r!.box.width / truth.width).toBeLessThan(1.25);
      const other = centre(f.toFrame(PLOT_B));
      expect(Math.hypot(got.x - other.x, got.y - other.y)).toBeGreaterThan(0.5 * truth.width);
    }
  });

  it('keeps pointing at the spot the user tapped inside the item (e.g. one curve of a graph)', () => {
    const cams = path(12);
    const tracker = new TargetTracker();
    const f0 = shoot(cams[0], 3);
    const box0 = f0.toFrame(PLOT_A);
    // The tap: a quarter in from the left, near the top.
    tracker.lock(smallGray(f0.rgb, W, H), box0, { x: box0.x + 0.25 * box0.width, y: box0.y + 0.2 * box0.height });
    for (let i = 1; i < cams.length; i++) {
      const f = shoot(cams[i], i + 7);
      const r = tracker.track(smallGray(f.rgb, W, H))!;
      const t = f.toFrame(PLOT_A);
      expect(Math.abs(r.point.x - (t.x + 0.25 * t.width))).toBeLessThan(0.15 * t.width);
      expect(Math.abs(r.point.y - (t.y + 0.2 * t.height))).toBeLessThan(0.15 * t.height);
    }
  });

  it('switches when told to (a tap on another item), then follows that one', () => {
    const cams = path(16);
    const tracker = new TargetTracker();
    const f0 = shoot(cams[0], 5);
    tracker.lock(smallGray(f0.rgb, W, H), f0.toFrame(PLOT_A));
    const f1 = shoot(cams[1], 6);
    tracker.track(smallGray(f1.rgb, W, H));
    tracker.lock(smallGray(f1.rgb, W, H), f1.toFrame(PLOT_B));
    for (let i = 2; i < cams.length; i++) {
      const f = shoot(cams[i], i + 20);
      const r = tracker.track(smallGray(f.rgb, W, H))!;
      const want = centre(f.toFrame(PLOT_B));
      const got = centre(r.box);
      expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(0.15 * f.toFrame(PLOT_B).width);
    }
  });

  it('when the item leaves the view it holds its last place for a while, then lets go', () => {
    const tracker = new TargetTracker();
    const f0 = shoot({ cx: 230, cy: 220, zoom: 1 }, 9);
    tracker.lock(smallGray(f0.rgb, W, H), f0.toFrame(PLOT_A));
    // The phone turns away to the empty desk far to the right.
    const away = smallGray(shoot({ cx: 1600, cy: 220, zoom: 1 }, 10).rgb, W, H);
    const first = tracker.track(away);
    expect(first).not.toBeNull();
    expect(first!.score).toBeLessThan(0.6);
    let n = 1;
    while (tracker.track(away) && n < 40) n++;
    expect(tracker.locked).toBe(false);
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it('refine() takes the smart crop’s exact box when it agrees, and ignores one that jumped elsewhere', () => {
    const tracker = new TargetTracker();
    const f0 = shoot({ cx: 230, cy: 220, zoom: 1 }, 11);
    const g0 = smallGray(f0.rgb, W, H);
    tracker.lock(g0, f0.toFrame(PLOT_A));
    const f1 = shoot({ cx: 240, cy: 220, zoom: 1.1 }, 12);
    const g1 = smallGray(f1.rgb, W, H);
    tracker.track(g1);
    tracker.refine(g1, f1.toFrame(PLOT_B)); // a wrong detection: ignored
    const r = tracker.track(smallGray(shoot({ cx: 245, cy: 222, zoom: 1.12 }, 13).rgb, W, H))!;
    expect(r.box.x + r.box.width).toBeLessThan(f1.toFrame(PLOT_B).x + 20);
  });

  it('a flat, featureless box can’t be locked', () => {
    const flat = new Uint8ClampedArray(W * H * 3).fill(128);
    expect(new TargetTracker().lock(smallGray(flat, W, H), { x: 100, y: 100, width: 80, height: 60 })).toBe(false);
  });
});

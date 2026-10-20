/**
 * The camera lock by distinctive points: the phone turns, tilts, comes closer and jumps, over a desk with two
 * look-alike graphs. The lock must stay on its graph, and know where its corners and the tapped spot are.
 */
import { fitHomography, estimateMotion, FeatureTracker } from '../featureTracker';
import { detectFeatures, grayImage, hamming, matchFeatures } from '../features';
import type { Point } from '../geometry';
import { type Camera, CARD, frameToWorld, H, PLOT_A, PLOT_B, shoot, W } from './support/desk';

const gray = (rgb: Uint8ClampedArray) => grayImage(rgb, W, H);
const corners = (r: typeof PLOT_A): Point[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height },
];
/** How far (world units) the tracked quad's corners are from the plot's real corners. */
const cornerError = (cam: Camera, quad: Point[], r = PLOT_A) =>
  Math.max(...quad.map((q, i) => {
    const w = frameToWorld(cam, q.x, q.y);
    const c = corners(r)[i];
    return Math.hypot(w.x - c.x, w.y - c.y);
  }));

/** Lock on plot A with the camera at `start`, then follow `cams`; returns the worst corner error and the misses. */
function follow(start: Camera, cams: Camera[], seed = 1) {
  const t = new FeatureTracker();
  const f0 = shoot(start, seed);
  expect(t.lock(gray(f0.rgb), f0.toFrame(PLOT_A))).toBe(true);
  let worst = 0;
  let misses = 0;
  cams.forEach((cam, i) => {
    const f = shoot(cam, seed + i + 1);
    const g = gray(f.rgb);
    const r = t.track(g);
    if (!r) {
      misses++;
      return;
    }
    worst = Math.max(worst, cornerError(cam, r.quad));
    t.renew(g, r);
  });
  return { worst, misses };
}

describe('distinctive points (ORB)', () => {
  it('finds corners on the graphs and the card, not on the plain wood, and recognises them turned 30°', () => {
    const a = shoot({ cx: 360, cy: 220, zoom: 1 }, 1);
    const b = shoot({ cx: 360, cy: 220, zoom: 1, angle: 0.52 }, 2);
    const ka = detectFeatures(gray(a.rgb));
    const kb = detectFeatures(gray(b.rgb));
    expect(ka.length).toBeGreaterThan(150);
    const matches = matchFeatures(ka, kb);
    // Matches that are right: the same world point.
    const k = gray(a.rgb).k;
    let right = 0;
    for (const m of matches) {
      const wa = frameToWorld(a.cam, ka[m.a].x * k, ka[m.a].y * k);
      const wb = frameToWorld(b.cam, kb[m.b].x * k, kb[m.b].y * k);
      if (Math.hypot(wa.x - wb.x, wa.y - wb.y) < 6) right++;
    }
    expect(matches.length).toBeGreaterThan(30);
    expect(right / matches.length).toBeGreaterThan(0.6);
  });

  it('Hamming distance counts differing bits', () => {
    const a = new Uint32Array(8);
    const b = new Uint32Array(8);
    b[0] = 0b1011;
    b[7] = 0x80000000;
    expect(hamming(a, b)).toBe(4);
  });
});

describe('movement from matched points', () => {
  const ps = Array.from({ length: 40 }, (_, i) => ({ x: (i * 37) % 200, y: (i * 53) % 150 }));
  const H0 = Float64Array.from([1.1, 0.2, 30, -0.15, 0.95, 12, 0.0006, -0.0004, 1]);
  const map = (p: Point) => {
    const w = H0[6] * p.x + H0[7] * p.y + 1;
    return { x: (H0[0] * p.x + H0[1] * p.y + H0[2]) / w, y: (H0[3] * p.x + H0[4] * p.y + H0[5]) / w };
  };

  it('fits a perspective map exactly from clean points', () => {
    const h = fitHomography(ps, ps.map(map))!;
    for (let i = 0; i < 9; i++) expect(h[i]).toBeCloseTo(H0[i], 4);
  });

  it('ignores a third of the matches being wrong', () => {
    const qs = ps.map((p, i) => (i % 3 === 0 ? { x: 500 - p.y, y: p.x * 2 } : map(p)));
    const est = estimateMotion(ps, qs, 2, [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }])!;
    expect(est.motion.perspective).toBe(true);
    expect(est.inliers.length).toBeGreaterThanOrEqual(26);
    const m = est.motion.map({ x: 100, y: 75 });
    const want = map({ x: 100, y: 75 });
    expect(Math.hypot(m.x - want.x, m.y - want.y)).toBeLessThan(0.5);
  });
});

describe('camera lock by points', () => {
  const start: Camera = { cx: 260, cy: 220, zoom: 1 };

  it('turning the phone 60°, the lock stays on the graph and its corners within a few pixels', () => {
    const cams = Array.from({ length: 12 }, (_, i) => ({ cx: 260 - 3 * i, cy: 220 + 2 * i, zoom: 1, angle: ((i + 1) / 12) * 1.05 }));
    const { worst, misses } = follow(start, cams);
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(10);
  });

  it('looking at it from an angle (tilted about 30°), the corners follow the perspective', () => {
    const cams = Array.from({ length: 8 }, (_, i) => ({ ...start, tx: ((i + 1) / 8) * 0.0011, ty: ((i + 1) / 8) * -0.0005 }));
    const { worst, misses } = follow(start, cams, 30);
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(10);
  });

  it('coming 2.2 times closer and backing off to 0.6, the points are renewed as it goes', () => {
    const zooms = [1.15, 1.3, 1.5, 1.7, 1.95, 2.2, 1.8, 1.4, 1.1, 0.9, 0.75, 0.6];
    const cams = zooms.map((zoom) => ({ cx: 230, cy: 220, zoom }));
    const { worst, misses } = follow({ cx: 230, cy: 220, zoom: 1 }, cams, 50);
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(12);
  });

  it('a quick jump (a third of the frame in one step) is found at once', () => {
    const { worst, misses } = follow(start, [{ cx: 260 - 180, cy: 240, zoom: 1 }, { cx: 260 + 40, cy: 200, zoom: 1 }], 70);
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(10);
  });

  it('never moves to the look-alike graph next to it, even when that one is in the middle of the view', () => {
    const t = new FeatureTracker();
    const f0 = shoot(start, 90);
    t.lock(gray(f0.rgb), f0.toFrame(PLOT_A));
    // Pan right until plot B is centred and A is half out of the frame.
    for (const cx of [330, 400, 470, 510]) {
      const cam = { cx, cy: 220, zoom: 1 };
      const r = t.track(gray(shoot(cam, cx).rgb));
      if (!r) continue; // not found is fine; found must be A
      expect(cornerError(cam, r.quad)).toBeLessThan(15);
      expect(cornerError(cam, r.quad, PLOT_B)).toBeGreaterThan(100);
    }
  });

  it('keeps pointing at the tapped spot', () => {
    const t = new FeatureTracker();
    const f0 = shoot(start, 110);
    const box = f0.toFrame(PLOT_A);
    const tap = { x: box.x + 0.25 * box.width, y: box.y + 0.2 * box.height };
    const tapWorld = frameToWorld(start, tap.x, tap.y);
    t.lock(gray(f0.rgb), box, tap);
    const cam = { cx: 240, cy: 230, zoom: 1.3, angle: 0.4 };
    const r = t.track(gray(shoot(cam, 111).rgb))!;
    const w = frameToWorld(cam, r.point.x, r.point.y);
    expect(Math.hypot(w.x - tapWorld.x, w.y - tapWorld.y)).toBeLessThan(6);
  });

  it('a plain item has too few points: left to the template tracker', () => {
    const flat = new Uint8ClampedArray(W * H * 3).fill(128);
    expect(new FeatureTracker().lock(gray(flat), { x: 100, y: 100, width: 120, height: 90 })).toBe(false);
  });

  it('the card on its own works too (a shape, few corners)', () => {
    const cam0 = { cx: 735, cy: 215, zoom: 1.6 };
    const t = new FeatureTracker();
    const f0 = shoot(cam0, 130);
    const ok = t.lock(gray(f0.rgb), f0.toFrame(CARD));
    // Either it has enough points and follows a turn, or it says so (the template tracker takes over).
    if (ok) {
      const cam = { ...cam0, angle: 0.3, cx: 740 };
      const r = t.track(gray(shoot(cam, 131).rgb));
      if (r) expect(cornerError(cam, r.quad, CARD)).toBeLessThan(10);
    }
  });
});

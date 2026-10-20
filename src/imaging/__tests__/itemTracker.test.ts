/**
 * The camera lock as the app uses it: by the item's points, with the template as the fallback.
 */
import type { Rect } from '../geometry';
import { ItemTracker, trackFrame } from '../itemTracker';
import { type Camera, frameToWorld, H, PLOT_A, PLOT_B, shoot, W } from './support/desk';

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const frame = (cam: Camera, seed: number) => {
  const f = shoot(cam, seed);
  return { ...f, t: trackFrame(f.rgb, W, H) };
};

/** A walk: pan right and back, closer (1.7) and further (0.75), turning up to 40° and back, a little shake. */
function walk(steps: number): Camera[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return {
      cx: 260 + 90 * Math.sin(t * Math.PI * 2) + 3 * Math.sin(i * 1.7),
      cy: 220 + 25 * Math.sin(t * Math.PI * 3) + 2 * Math.cos(i * 1.3),
      zoom: 1 + 0.7 * Math.sin(t * Math.PI) - 0.25 * Math.sin(t * Math.PI * 2) ** 2,
      angle: 0.7 * Math.sin(t * Math.PI),
    };
  });
}

describe('camera lock (points first, template as the fallback)', () => {
  it('stays on its graph through a walk with turning, by its points, and never on the look-alike', () => {
    const cams = walk(24);
    const tr = new ItemTracker();
    const f0 = frame(cams[0], 1);
    expect(tr.lock(f0.t, f0.toFrame(PLOT_A))).toBe(true);
    let byPoints = 0;
    for (let i = 1; i < cams.length; i++) {
      const f = frame(cams[i], i + 1);
      const r = tr.track(f.t)!;
      expect(r).not.toBeNull();
      // The tracked middle is the plot's middle in the world (within 6% of its width).
      const m = frameToWorld(cams[i], centre(r.box).x, centre(r.box).y);
      expect(Math.hypot(m.x - (PLOT_A.x + PLOT_A.width / 2), m.y - (PLOT_A.y + PLOT_A.height / 2))).toBeLessThan(0.06 * PLOT_A.width);
      if (tr.by === 'points') byPoints++;
    }
    expect(byPoints).toBeGreaterThanOrEqual(cams.length - 3);
  });

  it('a plain item with no corners (a soft-edged dark disc) is followed by the template instead', () => {
    const disc = (cx: number, cy: number) => {
      const rgb = new Uint8ClampedArray(W * H * 3);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          // Dark inside, light outside, a smooth 12 px edge (slightly out of focus).
          const t = Math.min(1, Math.max(0, (Math.hypot(x - cx, y - cy) - 44) / 12));
          rgb.fill(40 + 185 * t * t * (3 - 2 * t), (y * W + x) * 3, (y * W + x) * 3 + 3);
        }
      return trackFrame(rgb, W, H);
    };
    const tr = new ItemTracker();
    expect(tr.lock(disc(200, 180), { x: 150, y: 130, width: 100, height: 100 })).toBe(true);
    for (const [i, cx] of [215, 235, 260, 290].entries()) {
      const r = tr.track(disc(cx, 180 + 3 * i))!;
      expect(tr.by).toBe('template');
      expect(Math.abs(centre(r.box).x - cx)).toBeLessThan(8);
    }
  });

  it('when the item leaves the view it holds its last place for a while, then lets go', () => {
    const tr = new ItemTracker();
    const f0 = frame({ cx: 230, cy: 220, zoom: 1 }, 9);
    tr.lock(f0.t, f0.toFrame(PLOT_A));
    const away = frame({ cx: 1600, cy: 220, zoom: 1 }, 10).t;
    let n = 0;
    while (tr.track(away) && n < 40) n++;
    expect(tr.locked).toBe(false);
    expect(n).toBeGreaterThanOrEqual(8);
  });

  it('switches when told to, then follows the other graph', () => {
    const tr = new ItemTracker();
    const f0 = frame({ cx: 380, cy: 220, zoom: 1 }, 20);
    tr.lock(f0.t, f0.toFrame(PLOT_A));
    tr.lock(f0.t, f0.toFrame(PLOT_B));
    for (const [i, cam] of [{ cx: 400, cy: 225, zoom: 1.1, angle: 0.15 }, { cx: 430, cy: 230, zoom: 1.2, angle: 0.3 }].entries()) {
      const r = tr.track(frame(cam, 21 + i).t)!;
      const m = frameToWorld(cam, centre(r.box).x, centre(r.box).y);
      expect(Math.hypot(m.x - (PLOT_B.x + PLOT_B.width / 2), m.y - (PLOT_B.y + PLOT_B.height / 2))).toBeLessThan(15);
    }
  });
});

/**
 * Background removal with the GrabCut-style refinement: camera pictures (textured desks, knots, noise, pale
 * subjects) and screenshots, compared with the true outline.
 */
import { findForeground } from '../foreground';

const W = 320;
const H = 200;
type C = [number, number, number];

function picture(px: (x: number, y: number) => C, noise: number, seed = 1) {
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

/** Overlap of the mask with the true shape: intersection over union. */
function iou(mask: Uint8Array, truth: (x: number, y: number) => boolean) {
  let i = 0;
  let u = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = mask[y * W + x] === 1;
      const b = truth(x, y);
      if (a && b) i++;
      if (a || b) u++;
    }
  return i / u;
}

const run = (rgb: Uint8ClampedArray, refine: boolean, camera = true) =>
  findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, camera, refine });

/** Wood grain, for the timing test. */
const wood = (x: number, y: number): C => [158 + 10 * Math.sin(x / 6 + Math.sin(y / 25) * 2), 112, 76];

/**
 * A cloth with red flowers on it, none on the picture's edge (so the edge colours don't include red), two of them
 * touching the object (so they join its piece and dropping small pieces can't remove them).
 */
const flowers = [
  [60, 50],
  [250, 150],
  [90, 160],
  [270, 40],
  [209, 100],
  [126, 136],
];
const cloth = (x: number, y: number): C => {
  for (const [fx, fy] of flowers) if (Math.hypot(x - fx, y - fy) < 11) return [200, 50, 60];
  return [225, 218, 196];
};

describe('background removal, refined (GrabCut-style)', () => {
  it('a pattern of the background seen only away from the edge (flowers on a cloth) is background too', () => {
    const inDisc = (x: number, y: number) => Math.hypot(x - 160, y - 100) < 45;
    const rgb = picture((x, y) => (inDisc(x, y) ? [45, 95, 200] : cloth(x, y)), 10);
    const before = run(rgb, false);
    const after = run(rgb, true);
    expect(after.refined).toBe(true);
    expect(iou(after.mask, inDisc)).toBeGreaterThan(0.93);
    expect(iou(after.mask, inDisc)).toBeGreaterThan(iou(before.mask, inDisc));
    // The box is the disc's, not stretched by a flower.
    expect(Math.abs(after.subject!.width - 90)).toBeLessThanOrEqual(6);
  });

  it('a pale card on a noisy white desk comes out solid, without speckles or bites', () => {
    const inCard = (x: number, y: number) => Math.abs(x - 160) < 70 && Math.abs(y - 100) < 50;
    const rgb = picture((x, y) => (inCard(x, y) ? [238, 226, 175] : [236, 236, 232]), 22, 3);
    const before = run(rgb, false);
    const after = run(rgb, true);
    expect(iou(after.mask, inCard)).toBeGreaterThan(0.95);
    expect(iou(after.mask, inCard)).toBeGreaterThan(iou(before.mask, inCard) + 0.03);
  });

  it('a shadowed object on a two-colour cloth: the cloth and the shadow go, the object stays', () => {
    const inSq = (x: number, y: number) => Math.abs(x - 160) < 40 && Math.abs(y - 100) < 40;
    const cloth = (x: number, y: number): C => ((Math.floor(x / 25) + Math.floor(y / 25)) % 2 ? [70, 90, 120] : [200, 190, 160]);
    const rgb = picture((x, y) => {
      if (inSq(x, y)) return [40, 150, 80];
      const c = cloth(x, y);
      return inSq(x - 8, y - 10) ? (c.map((v) => v * 0.62) as C) : c;
    }, 6, 5);
    const after = run(rgb, true);
    expect(iou(after.mask, inSq)).toBeGreaterThan(0.9);
  });

  it('a screenshot icon (flat colours, anti-aliased edge) is left as exact as it was', () => {
    const d = (x: number, y: number) => Math.hypot(x - 160, y - 100) - 40;
    const rgb = picture((x, y) => {
      const t = Math.min(1, Math.max(0, 0.5 - d(x, y)));
      return [255 - 200 * t, 255 - 120 * t, 255 - 10 * t];
    }, 0);
    const before = run(rgb, false, false);
    const after = run(rgb, true, false);
    const inDisc = (x: number, y: number) => d(x, y) < 0;
    expect(iou(after.mask, inDisc)).toBeGreaterThanOrEqual(iou(before.mask, inDisc) - 0.01);
    expect(iou(after.mask, inDisc)).toBeGreaterThan(0.97);
  });

  it('a thin line drawing is not refined (the cut would thin it out)', () => {
    const onTri = (x: number, y: number) => {
      const e = [Math.abs(y - 160), Math.abs(1.6 * (x - 160) - (y - 40)) / 1.9, Math.abs(-1.6 * (x - 160) - (y - 40)) / 1.9];
      return Math.min(...e) < 1.2 && y >= 39 && y <= 161 && Math.abs(x - 160) <= 76;
    };
    const rgb = picture((x, y) => (onTri(x, y) ? [20, 20, 20] : [250, 250, 250]), 3);
    const r = run(rgb, true, false);
    expect(r.refined).toBe(false);
    expect(r.subject).not.toBeNull();
  });

  it('costs little on top of the first mask for a live frame (640 x 360)', () => {
    const big = new Uint8ClampedArray(640 * 360 * 3);
    for (let y = 0; y < 360; y++)
      for (let x = 0; x < 640; x++) big.set(Math.hypot(x - 320, y - 180) < 90 ? [45, 95, 200] : wood(x / 2, y / 2), (y * 640 + x) * 3);
    const time = (refine: boolean) => {
      const t0 = performance.now();
      const r = findForeground(big, 640, 360, { tolerance: 'auto', minPieceRatio: 0.15, camera: true, refine });
      return { ms: performance.now() - t0, r };
    };
    time(true); // warm up
    const base = time(false);
    const refined = time(true);
    expect(refined.r.refined).toBe(true);
    expect(refined.ms - base.ms).toBeLessThan(60);
  });
});

describe('told which object is the subject', () => {
  it('another object and a leftover patch outside the subject’s box are background', () => {
    const inDisc = (x: number, y: number) => Math.hypot(x - 110, y - 100) < 40;
    // A second, bigger-than-clutter object (an orange block) and a dark patch of desk.
    const rgb = picture((x, y) => {
      if (inDisc(x, y)) return [45, 95, 200];
      if (x > 220 && x < 280 && y > 60 && y < 140) return [230, 140, 40];
      if (x > 150 && x < 200 && y > 160 && y < 190) return [120, 110, 100];
      return [228, 224, 214];
    }, 8, 9);
    const box = { x: 70, y: 60, width: 80, height: 80 };
    const r = findForeground(rgb, W, H, { tolerance: 'auto', minPieceRatio: 0.15, camera: true, refine: true, subjectBox: box });
    expect(r.refined).toBe(true);
    expect(iou(r.mask, inDisc)).toBeGreaterThan(0.93);
  });
});

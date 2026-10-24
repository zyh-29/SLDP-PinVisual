/**
 * The camera lock with a shaking hand: pointing at an item locks onto it quickly, and a tap locks on a frame taken
 * after the tap.
 */
import { type Camera, CARD, frameToWorld, H, PLOT_A, PLOT_B, shoot, W } from '@/imaging/__tests__/support/desk';
import type { Rect } from '@/imaging/geometry';
import { smartSubject } from '@/imaging/smartCrop';
import { CameraLock } from '../useCameraLock';
import type { PickedImage } from '../useImageConversion';

let seed = 5;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** Motion blur along x (a box blur r px each way), as a shaking camera smears some frames. */
function blur(rgb: Uint8ClampedArray, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgb.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= W) continue;
          s += rgb[(y * W + xx) * 3 + c];
          n++;
        }
        out[(y * W + x) * 3 + c] = s / n;
      }
  return out;
}

/** Aiming at (cx, cy) with a hand shaking up to ±ax, ±ay px each frame, every third frame smeared. */
function shakyFrames(n: number, cx: number, cy: number, ax: number, ay: number) {
  seed = 5;
  return Array.from({ length: n }, (_, i) => {
    const cam: Camera = { cx: cx + ax * rnd(), cy: cy + ay * rnd(), zoom: 1.3, angle: 0.06 * rnd() };
    const shot = shoot(cam, i + 1);
    const rgb = i % 3 === 2 ? blur(shot.rgb, 4) : shot.rgb;
    const picked = { uri: '', rgb, raster: { width: W, height: H, data: new Uint8Array(0), channels: 3 } } as unknown as PickedImage;
    return { cam, picked };
  });
}

const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const, camera: true };
const items: [string, Rect][] = [
  ['graph A', PLOT_A],
  ['graph B', PLOT_B],
  ['card', CARD],
];
/** Which item of the desk a frame box is on. */
const itemAt = (cam: Camera, r: Rect) => {
  const m = frameToWorld(cam, r.x + r.width / 2, r.y + r.height / 2);
  return items.find(([, w]) => m.x >= w.x && m.x <= w.x + w.width && m.y >= w.y && m.y <= w.y + w.height)?.[0] ?? 'desk';
};

describe('camera lock with a shaking hand', () => {
  it('pointing at the card locks onto it within a few frames, though blurred frames pick the graph beside it', () => {
    const frames = shakyFrames(10, 700, 215, 45, 30);
    const lock = new CameraLock();
    let lockedAt = -1;
    for (const [i, f] of frames.entries()) {
      const target = smartSubject(f.picked.rgb, W, H, opts).target;
      if (lock.onTarget(f.picked, target)) {
        lockedAt = i;
        expect(itemAt(f.cam, target)).toBe('card');
        break;
      }
    }
    expect(lockedAt).toBeGreaterThanOrEqual(1);
    expect(lockedAt).toBeLessThanOrEqual(3);
    // And it stays on the card through the shaking that follows.
    for (const f of frames.slice(lockedAt + 1)) {
      const r = lock.follow(f.picked.rgb, W, H);
      expect(r).toBeTruthy();
      expect(itemAt(f.cam, r!.box)).toBe('card');
    }
  });

  it('a tap locks on the next frame, not the older one on screen when the tap came', () => {
    const frames = shakyFrames(3, 520, 215, 45, 30);
    const lock = new CameraLock();
    const target = (i: number) => smartSubject(frames[i].picked.rgb, W, H, opts).target;
    lock.tap({ x: W / 2, y: H / 2 }, frames[0].picked.rgb);
    // The frame that was on screen: no lock yet.
    expect(lock.onTarget(frames[0].picked, target(0))).toBe(false);
    expect(lock.tracker.locked).toBe(false);
    // The next frame: locked.
    expect(lock.onTarget(frames[1].picked, target(1))).toBe(true);
    expect(lock.tracker.locked).toBe(true);
  });
});

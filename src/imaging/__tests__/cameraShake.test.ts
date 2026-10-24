import { frameShift } from '../cameraShake';
import { smallGray } from '../tracker';
import { type Camera, H, shoot, W, worldToFrame } from './support/desk';

const small = (cam: Camera, seed: number) => smallGray(shoot(cam, seed).rgb, W, H);
/** How far the middle of the view moved on screen from camera a to camera b (the true shake). */
const truth = (a: Camera, b: Camera) => {
  const p = { x: a.cx, y: a.cy };
  const q = worldToFrame(b, p);
  return { dx: q.x - W / 2, dy: q.y - H / 2 };
};

describe('camera shake between frames', () => {
  it.each([
    ['a small jump', { cx: 236, cy: 214 }],
    ['a big jump sideways', { cx: 300, cy: 225 }],
    ['a big jump diagonally', { cx: 170, cy: 265 }],
    ['a jump with the phone turned a little', { cx: 260, cy: 200, angle: 0.05 }],
  ] as [string, Partial<Camera>][])('%s: measured within a few pixels', (_name, move) => {
    const a: Camera = { cx: 230, cy: 220, zoom: 1 };
    const b: Camera = { cx: 230, cy: 220, zoom: 1, ...move };
    const s = frameShift(small(a, 1), small(b, 2))!;
    expect(s).not.toBeNull();
    const t = truth(a, b);
    const tol = move.angle ? 8 : 4;
    expect(Math.abs(s.dx - t.dx)).toBeLessThanOrEqual(tol);
    expect(Math.abs(s.dy - t.dy)).toBeLessThanOrEqual(tol);
  });

  it('no movement: about zero', () => {
    const cam: Camera = { cx: 400, cy: 200, zoom: 1.2 };
    const s = frameShift(small(cam, 1), small(cam, 2))!;
    expect(Math.abs(s.dx) + Math.abs(s.dy)).toBeLessThanOrEqual(2);
  });

  it('a plain view with no detail, or frames of different sizes: no estimate', () => {
    const flat = smallGray(new Uint8ClampedArray(W * H * 3).fill(128), W, H);
    expect(frameShift(flat, flat)).toBeNull();
    const other = smallGray(new Uint8ClampedArray(320 * 180 * 3).fill(90), 320, 180);
    expect(frameShift(small({ cx: 230, cy: 220, zoom: 1 }, 1), other)).toBeNull();
  });
});

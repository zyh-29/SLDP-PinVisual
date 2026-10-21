import { createEmptyPattern, togglePin } from '@/domain/pattern';
import type { GraphScale } from '@/imaging/graph';
import {
  CAPTURE,
  type CaptureWatch,
  carryRect,
  holdGraphPins,
  nextGraphScale,
  onlyInside,
  pinsApart,
  rectInside,
  searchAreaAround,
  watchCapture,
  zoomedFrom,
} from '../conversionLogic';

const scale = (major: number, units = 1): GraphScale => ({
  pxPerUnitX: major / units,
  pxPerUnitY: major / units,
  unitsPerMajorX: units,
  unitsPerMajorY: units,
  majorX: major,
  majorY: major,
  from: 'labels',
});

describe('where to search around a locked item', () => {
  const box = { x: 200, y: 100, width: 100, height: 80 };
  it('the item and 40% of its size around it, inside the picture', () => {
    expect(searchAreaAround(box, 640, 360, null)).toEqual({ x: 160, y: 60, width: 180, height: 160 });
    expect(searchAreaAround({ ...box, x: 10 }, 640, 360, null)!.x).toBe(0);
  });
  it('none when nothing is locked, when it would be most of the picture, or when it leaves out the focus', () => {
    expect(searchAreaAround(null, 640, 360, null)).toBeUndefined();
    expect(searchAreaAround({ x: 50, y: 30, width: 500, height: 300 }, 640, 360, null)).toBeUndefined();
    expect(searchAreaAround(box, 640, 360, { x: 600, y: 300 })).toBeUndefined();
    expect(searchAreaAround(box, 640, 360, { x: 250, y: 140 })).toBeDefined();
  });
});

describe('carrying the graph scale between frames', () => {
  it('another zoom level: a 1% change in spacing, or another step', () => {
    expect(zoomedFrom(scale(100), scale(100.5))).toBe(false);
    expect(zoomedFrom(scale(100), scale(102))).toBe(true);
    expect(zoomedFrom(scale(100), scale(100, 2))).toBe(true);
  });
  it('locks the camera scale to the tracked width once, then follows a shared screen zoom', () => {
    expect(nextGraphScale(null, scale(100), 300, false)).toBeNull();
    expect(nextGraphScale(scale(100), scale(100), 300, false)).toEqual({ ...scale(100), atWidth: 300 });
    expect(nextGraphScale({ ...scale(100), atWidth: 300 }, scale(100), 320, false)).toBeNull();
    expect(nextGraphScale(scale(100), scale(120), null, true)).toEqual({ ...scale(120), followed: true });
    expect(nextGraphScale(scale(100), scale(100.2), null, true)).toBeNull();
  });
});

describe('holding the pins while a zoomed graph is read again', () => {
  const a = togglePin(createEmptyPattern(5, 8), 1, 1);
  const b = togglePin(createEmptyPattern(5, 8), 2, 2);
  const live = { live: true, graph: true, windowed: true, readingNumbers: false, wholeCurve: false };
  it('remembers the windowed pins, shows them while reading, and forgets them when not needed', () => {
    expect(holdGraphPins(null, a, live)).toEqual({ shown: a, held: a });
    expect(holdGraphPins(a, a, live)).toEqual({ shown: a, held: undefined });
    expect(holdGraphPins(a, b, { ...live, windowed: false, readingNumbers: true })).toEqual({ shown: a, held: undefined });
    expect(holdGraphPins(a, b, { ...live, windowed: false, wholeCurve: true })).toEqual({ shown: b, held: null });
    expect(holdGraphPins(a, b, { ...live, live: false, windowed: false })).toEqual({ shown: b, held: null });
  });
});

describe('pins only inside the graph', () => {
  it('clears ink outside a rectangle', () => {
    const ink = new Float32Array(4 * 3).fill(1);
    const out = onlyInside(ink, 4, 3, { x: 1, y: 1, width: 2, height: 1 });
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(rectInside({ x: 1, y: 1, width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 3 })).toBe(true);
    expect(rectInside({ x: -1, y: 1, width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 3 })).toBe(false);
  });
});

describe('capturing a locked frame', () => {
  const pins = createEmptyPattern(4, 10);
  const off1 = togglePin(pins, 0, 0);
  const run = (frames: { raw: typeof pins; steady?: typeof pins; sharp?: boolean; ready?: boolean }[]) => {
    let watch: CaptureWatch<number> | null = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const r: { watch: CaptureWatch<number> | null; capture: number | null } = watchCapture(watch, { ready: f.ready ?? true, sharp: f.sharp ?? true, steady: f.steady ?? pins, raw: f.raw, item: i });
      if (r.capture !== null) return r.capture;
      watch = r.watch;
    }
    return null;
  };
  it('counts differing pins', () => {
    expect(pinsApart(pins, off1)).toBe(1);
    expect(pinsApart(pins, createEmptyPattern(5, 10))).toBe(Infinity);
  });
  it('keeps the first frame that agrees once the pins have settled', () => {
    expect(run([{ raw: pins }, { raw: pins }, { raw: pins }, { raw: pins }])).toBe(CAPTURE.settle - 1);
  });
  it('waits while the steady pins still change, or the frame is blurry or not ready', () => {
    expect(run([{ raw: pins }, { raw: off1, steady: off1 }, { raw: pins }, { raw: pins }])).toBeNull();
    expect(run([{ raw: pins }, { raw: pins, sharp: false }, { raw: pins }])).toBeNull();
    expect(run([{ raw: pins }, { raw: pins }, { raw: pins, ready: false }, { raw: pins }])).toBeNull();
  });
  it('a frame far from the settled pins is not kept, but after a while the closest one is', () => {
    let far = pins;
    for (let c = 0; c < 4; c++) far = togglePin(far, 1, c);
    const frames = Array.from({ length: CAPTURE.maxFrames }, (_, i) => ({ raw: i === 5 ? off1 : far }));
    expect(run(frames)).toBe(5);
  });
  it('carries a box with its item', () => {
    expect(carryRect({ x: 10, y: 10, width: 20, height: 20 }, { x: 0, y: 0, width: 40, height: 40 }, { x: 100, y: 50, width: 80, height: 40 })).toEqual({
      x: 120,
      y: 60,
      width: 40,
      height: 20,
    });
  });
});

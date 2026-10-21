import { createEmptyPattern, togglePin } from '@/domain/pattern';
import type { GraphScale } from '@/imaging/graph';
import { holdGraphPins, nextGraphScale, onlyInside, rectInside, searchAreaAround, zoomedFrom } from '../conversionLogic';

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

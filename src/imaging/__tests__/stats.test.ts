import { convexHull, iou, polygonArea } from '../geometry';
import { median } from '../stats';

describe('shared helpers', () => {
  it('median: the middle value (upper middle for an even count), without changing the input', () => {
    const xs = [5, 1, 4, 2, 3];
    expect(median(xs)).toBe(3);
    expect(xs).toEqual([5, 1, 4, 2, 3]);
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median(new Float32Array([7]))).toBe(7);
    expect(median([])).toBeNaN();
    expect(median([], 255)).toBe(255);
    const big = Array.from({ length: 10001 }, (_, i) => (i * 7919) % 10001);
    expect(median(big)).toBe(5000);
  });

  it('iou, polygon area and convex hull', () => {
    expect(iou({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 })).toBeCloseTo(50 / 150, 6);
    expect(iou({ x: 0, y: 0, width: 4, height: 4 }, { x: 10, y: 10, width: 4, height: 4 })).toBe(0);
    const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    expect(polygonArea(square)).toBe(4);
    expect(polygonArea([...square].reverse())).toBe(4);
    expect(convexHull([...square, { x: 1, y: 1 }, { x: 1, y: 0 }])).toHaveLength(4);
  });
});

import { onlyInside, rectInside } from '../conversionLogic';

describe('pins only inside the graph', () => {
  it('clears ink outside a rectangle', () => {
    const ink = new Float32Array(4 * 3).fill(1);
    const out = onlyInside(ink, 4, 3, { x: 1, y: 1, width: 2, height: 1 });
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(rectInside({ x: 1, y: 1, width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 3 })).toBe(true);
    expect(rectInside({ x: -1, y: 1, width: 2, height: 1 }, { x: 0, y: 0, width: 4, height: 3 })).toBe(false);
  });
});

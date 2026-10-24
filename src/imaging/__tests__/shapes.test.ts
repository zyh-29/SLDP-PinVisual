import { closeShape, convexHull, detectShape, fillHoles, isMirrorSymmetric, outlineOf, polygonArea, renderShape, simplifyConvex } from '../shapes';

const W = 120;
const H = 100;
const full = { x: 0, y: 0, width: W, height: H };
const grid = (cells: readonly number[], cols: number) =>
  Array.from({ length: cells.length / cols }, (_, r) => cells.slice(r * cols, (r + 1) * cols).join(''));

function maskOf(inside: (x: number, y: number) => boolean): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x + 0.5, y + 0.5)) m[y * W + x] = 1;
  return m;
}

const sideOf = (ax: number, ay: number, bx: number, by: number, x: number, y: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
/** Tilted triangle like the Wikipedia picture. */
const tri = (x: number, y: number) =>
  sideOf(55, 10, 100, 90, x, y) >= 0 && sideOf(100, 90, 20, 75, x, y) >= 0 && sideOf(20, 75, 55, 10, x, y) >= 0;

describe('geometry helpers', () => {
  it('hull and area of a square', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(4);
  });

  it('simplifies a many-sided triangle back to three corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 0.01 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
      { x: 2.5, y: 4.01 },
    ];
    expect(simplifyConvex(convexHull(pts))).toHaveLength(3);
  });
});

describe('fill and outline', () => {
  it('fills a drawn outline, even with a one-pixel gap', () => {
    const ring = maskOf((x, y) => {
      const d = Math.hypot(x - 60, y - 50);
      return d >= 28 && d <= 31 && !(Math.abs(y - 50) < 0.6 && x > 85); // gap on the right
    });
    const filled = fillHoles(ring, W, H, full);
    expect(filled[50 * W + 60]).toBe(1); // centre now solid
    expect(filled[5 * W + 5]).toBe(0); // outside stays empty
  });

  it('keeps real holes: a donut and a thick frame stay open, and are not snapped to a solid shape', () => {
    const donut = maskOf((x, y) => {
      const d = Math.hypot(x - 60, y - 50);
      return d >= 20 && d <= 45;
    });
    const d = closeShape(donut, W, H, full);
    expect(d.mask[50 * W + 60]).toBe(0);
    expect(d.keptHoles).toBe(1);
    expect(detectShape(d.mask, W, H, full)).toBeNull();
    const frame = maskOf((x, y) => {
      const a = Math.max(Math.abs(x - 60), Math.abs(y - 50));
      return a <= 45 && a >= 22;
    });
    const f = closeShape(frame, W, H, full);
    expect(f.mask[50 * W + 60]).toBe(0);
    expect(f.keptHoles).toBe(1);
  });

  it('fills specks: pinholes in a solid shape', () => {
    const speckled = maskOf((x, y) => Math.hypot(x - 60, y - 50) <= 45 && !(Math.abs(x - 60.5) < 1 && Math.abs(y - 50.5) < 1));
    const r = closeShape(speckled, W, H, full);
    expect(r.mask[50 * W + 60]).toBe(1);
    expect(r.keptHoles).toBe(0);
  });

  it('keeps only the edge for outline style', () => {
    const solid = maskOf((x, y) => x > 20 && x < 80 && y > 20 && y < 80);
    const edge = outlineOf(solid, W, H);
    expect(edge[50 * W + 50]).toBe(0);
    expect(edge[20 * W + 50]).toBe(1);
  });
});

describe('shape detection', () => {
  it('finds a tilted triangle drawn as an outline', () => {
    const outline = outlineOf(maskOf(tri), W, H);
    const shape = detectShape(fillHoles(outline, W, H, full), W, H, full);
    expect(shape?.name).toBe('Triangle');
    expect(shape?.points).toHaveLength(3);
  });

  it('names squares, rectangles and circles', () => {
    expect(
      detectShape(
        maskOf((x, y) => x > 30 && x < 80 && y > 25 && y < 75),
        W,
        H,
        full,
      )?.name,
    ).toBe('Square');
    expect(
      detectShape(
        maskOf((x, y) => x > 10 && x < 110 && y > 30 && y < 70),
        W,
        H,
        full,
      )?.name,
    ).toBe('Rectangle');
    expect(
      detectShape(
        maskOf((x, y) => Math.hypot(x - 60, y - 50) < 35),
        W,
        H,
        full,
      )?.name,
    ).toBe('Circle');
    expect(
      detectShape(
        maskOf((x, y) => ((x - 60) / 50) ** 2 + ((y - 50) / 25) ** 2 < 1),
        W,
        H,
        full,
      )?.name,
    ).toBe('Oval');
    const hexagon = (x: number, y: number) => {
      const dx = Math.abs(x - 60);
      const dy = Math.abs(y - 50);
      return dy <= 38 * 0.866 && dx * 0.866 + dy * 0.5 <= 38 * 0.866;
    };
    expect(detectShape(maskOf(hexagon), W, H, full)?.name).toBe('Hexagon');
    const pentagon = (x: number, y: number) =>
      [0, 1, 2, 3, 4].every((i) => {
        const t = -Math.PI / 2 + (i * 2 * Math.PI) / 5 + Math.PI / 5;
        return (x - 60) * Math.cos(t) + (y - 52) * Math.sin(t) <= 36 * Math.cos(Math.PI / 5);
      });
    expect(detectShape(maskOf(pentagon), W, H, full)?.name).toBe('Pentagon');
  });

  it('ignores letters and other non-convex things', () => {
    const letterL = maskOf((x, y) => (x > 20 && x < 32 && y > 10 && y < 90) || (x > 20 && x < 80 && y > 78 && y < 90));
    expect(detectShape(letterL, W, H, full)).toBeNull();
    const twoDots = maskOf((x, y) => Math.hypot(x - 30, y - 50) < 12 || Math.hypot(x - 90, y - 50) < 12);
    expect(detectShape(twoDots, W, H, full)).toBeNull();
  });
});

describe('drawing the shape on the pins', () => {
  const shape = detectShape(maskOf(tri), W, H, full)!;

  it('fills a clean triangle as large as the grid allows, with all three corners', () => {
    const p = renderShape(shape, 5, 8, 1, 'filled', 0.35);
    const rows = grid(p.cells, 8);
    expect(rows).toEqual([
      '00010000', //
      '00011000',
      '00111000',
      '01111100',
      '00011110',
    ]);
    // Top tip, left corner and bottom-right corner are all present.
    expect(rows[0]).toContain('1');
    expect(rows.some((r) => r[1] === '1')).toBe(true);
    expect(rows[4][6]).toBe('1');
  });

  it('draws only the edge in outline style', () => {
    const filled = renderShape(shape, 5, 8, 1, 'filled', 0.35).cells.filter(Boolean).length;
    const outline = renderShape(shape, 5, 8, 1, 'outline', 0.35).cells.filter(Boolean).length;
    expect(outline).toBeGreaterThan(0);
    expect(outline).toBeLessThanOrEqual(filled + 4);
  });
});

describe('perfecting', () => {
  const mirrored = (rows: string[]) => rows.every((r) => r === [...r].reverse().join(''));
  const triangleMask = (a: [number, number], b: [number, number], c: [number, number]) =>
    maskOf((x, y) => {
      const s1 = sideOf(a[0], a[1], b[0], b[1], x, y);
      const s2 = sideOf(b[0], b[1], c[0], c[1], x, y);
      const s3 = sideOf(c[0], c[1], a[0], a[1], x, y);
      return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
    });

  it('turns a slightly tilted, uneven triangle into a centred, symmetric one', () => {
    // Like the yellow clip-art triangle: apex a bit off-centre, base tilted ~2 degrees.
    const shape = detectShape(triangleMask([58, 12], [98, 86], [20, 84]), W, H, full)!;
    expect(shape.name).toBe('Triangle');
    expect(isMirrorSymmetric(shape.points, 'x')).toBe(true);
    const rows = grid(renderShape(shape, 5, 8, 1, 'filled', 0.35).cells, 8);
    expect(mirrored(rows)).toBe(true);
    expect(rows[0]).toBe('00011000'); // the tip sits on the grid's centre line
    expect(rows[4].split('1').length - 1).toBeGreaterThanOrEqual(6); // wide base
  });

  it('leaves a clearly tilted triangle tilted', () => {
    const shape = detectShape(maskOf(tri), W, H, full)!;
    expect(isMirrorSymmetric(shape.points, 'x')).toBe(false);
  });

  it('straightens a slightly rotated rectangle and makes the pins symmetric both ways', () => {
    const t = 4 * (Math.PI / 180);
    const rect = maskOf((x, y) => {
      const dx = x - 60;
      const dy = y - 50;
      const u = dx * Math.cos(t) + dy * Math.sin(t);
      const v = -dx * Math.sin(t) + dy * Math.cos(t);
      return Math.abs(u) < 45 && Math.abs(v) < 22;
    });
    const shape = detectShape(rect, W, H, full)!;
    expect(shape.name).toBe('Rectangle');
    expect(isMirrorSymmetric(shape.points, 'x') && isMirrorSymmetric(shape.points, 'y')).toBe(true);
    const rows = grid(renderShape(shape, 5, 8, 1, 'filled', 0.35).cells, 8);
    expect(mirrored(rows)).toBe(true);
    expect(rows).toEqual([...rows].reverse());
  });

  it('makes a slightly squashed circle a perfect circle', () => {
    const shape = detectShape(
      maskOf((x, y) => ((x - 60) / 33) ** 2 + ((y - 50) / 30) ** 2 < 1),
      W,
      H,
      full,
    )!;
    expect(shape.name).toBe('Circle');
    const rows = grid(renderShape(shape, 5, 8, 1, 'filled', 0.35).cells, 8);
    expect(mirrored(rows)).toBe(true);
    expect(rows).toEqual([...rows].reverse());
  });

  it('recognises a diamond', () => {
    const diamond = maskOf((x, y) => Math.abs(x - 60) / 40 + Math.abs(y - 50) / 40 <= 1);
    expect(detectShape(diamond, W, H, full)?.name).toBe('Diamond');
  });
});

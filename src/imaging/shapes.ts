/**
 * Shape clean-up for a small pin grid (a few dozen pins). Pure functions, unit tested.
 *
 *  - fillHoles: closes a drawn outline into a solid shape.
 *  - outlineOf: the reverse, keeps only the edge of a shape.
 *  - detectShape: if the subject is a clean convex shape (triangle,
 *    rectangle, pentagon, hexagon, circle/oval), finds its exact geometry.
 *  - renderShape: draws that perfect shape onto the pins with exact
 *    coverage, instead of sampling the wobbly pixels.
 */
import type { Pattern, PinValue } from '@/domain/pattern';
import { bounds, convexHull, cross, polygonArea, type Rect } from './geometry';
import { labelComponents } from './masks';

// Kept here too for code that thinks of them as shape helpers.
export { convexHull, polygonArea };

export interface Point {
  x: number;
  y: number;
}

export type ShapeStyle = 'filled' | 'outline';

export interface DetectedShape {
  kind: 'polygon' | 'ellipse';
  /** "Triangle", "Square", "Circle", ... */
  name: string;
  /** Corners in source pixels (an ellipse is stored as a 64-sided polygon). */
  points: Point[];
}

/** A hole this small a share of its shape (with the hole) is a speck: filled whatever the shape. */
const PINHOLE = 0.03;
/** A shape whose band is thinner than this share of the hole's width is a drawn outline: the hole is filled. */
const OUTLINE = 0.3;

/**
 * Fills areas enclosed by content inside `region`: a drawn outline becomes a solid shape. Gaps of a pixel or two
 * in the outline are bridged first, so slightly broken drawings still close.
 *
 * Real holes stay: a donut, a ring, a picture frame, the letter O. A hole is filled when the shape around it is a
 * thin outline compared to the hole (band thinner than OUTLINE x the hole's width; a drawn circle is a few pixels
 * round a wide hole, a donut's band is as wide as its hole), or when it is a speck (pinholes from noise).
 */
export function fillHoles(mask: Uint8Array, width: number, height: number, region: Rect, gap = 1): Uint8Array {
  return closeShape(mask, width, height, region, gap).mask;
}

/** fillHoles, also saying how many real holes were kept (a shape with holes can't be snapped to a solid shape). */
export function closeShape(mask: Uint8Array, width: number, height: number, region: Rect, gap = 1): { mask: Uint8Array; keptHoles: number } {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  // Closed = mask grown by `gap` pixels.
  const closed = new Uint8Array(mask.length);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -gap; dy <= gap; dy++)
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= x0 && nx < x1 && ny >= y0 && ny < y1) closed[ny * width + nx] = 1;
        }
    }
  // Flood the outside from the region's border.
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * width + x;
    if (!closed[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = x0; x < x1; x++) {
    push(x, y0);
    push(x, y1 - 1);
  }
  for (let y = y0; y < y1; y++) {
    push(x0, y);
    push(x1 - 1, y);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % width;
    const y = (p - x) / width;
    if (x > x0) push(x - 1, y);
    if (x < x1 - 1) push(x + 1, y);
    if (y > y0) push(x, y - 1);
    if (y < y1 - 1) push(x, y + 1);
  }
  // The enclosed pixels: open interior, or the grown ring on the inside of the stroke (not touching the outside).
  const enclosed = new Uint8Array(mask.length);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (outside[p] || mask[p]) continue;
      const touchesOutside =
        (x > x0 && outside[p - 1]) ||
        (x < x1 - 1 && outside[p + 1]) ||
        (y > y0 && outside[p - width]) ||
        (y < y1 - 1 && outside[p + width]);
      if (!closed[p] || !touchesOutside) enclosed[p] = 1;
    }

  // Each hole against the piece of the shape around it: its band's width (area / half its edge, see strokeWidth),
  // and the hole's own width (of a circle with its area).
  const pieces = labelComponents(mask, width, height);
  const edges = new Float64Array(pieces.components.length);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width])
        edges[pieces.labels[p] - 1]++;
    }
  const holes = labelComponents(enclosed, width, height);
  const fill = new Uint8Array(holes.components.length);
  let keptHoles = 0;
  holes.components.forEach((hole, i) => {
    // The piece around it: the one most of the hole's rim touches.
    const touching = new Map<number, number>();
    const { x: hx, y: hy, width: hw, height: hh } = hole.box;
    for (let y = Math.max(y0, hy - 1); y < Math.min(y1, hy + hh + 1); y++)
      for (let x = Math.max(x0, hx - 1); x < Math.min(x1, hx + hw + 1); x++) {
        const p = y * width + x;
        const l = pieces.labels[p];
        if (!l) continue;
        const nextToHole =
          (x > x0 && holes.labels[p - 1] === i + 1) ||
          (x < x1 - 1 && holes.labels[p + 1] === i + 1) ||
          (y > y0 && holes.labels[p - width] === i + 1) ||
          (y < y1 - 1 && holes.labels[p + width] === i + 1);
        if (nextToHole) touching.set(l, (touching.get(l) ?? 0) + 1);
      }
    let around = 0;
    let most = 0;
    touching.forEach((n, l) => {
      if (n > most) {
        most = n;
        around = l;
      }
    });
    if (!around) {
      fill[i] = 1;
      return;
    }
    const area = pieces.components[around - 1].area;
    const band = area / Math.max(1, edges[around - 1] / 2);
    const holeWidth = 2 * Math.sqrt(hole.area / Math.PI);
    const speck = hole.area < PINHOLE * (area + hole.area);
    const outline = band < OUTLINE * holeWidth;
    if (speck || outline) fill[i] = 1;
    else keptHoles++;
  });

  const out = mask.slice();
  for (let p = 0; p < out.length; p++) if (enclosed[p] && fill[holes.labels[p] - 1]) out[p] = 1;
  return { mask: out, keptHoles };
}

/** Keeps the edge pixels of the mask (content with a background 4-neighbour). */
export function outlineOf(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width])
        out[p] = 1;
    }
  return out;
}

/**
 * Removes the least important corner one at a time: the one that sticks out
 * least from the line joining its neighbours. Stops when every remaining
 * corner sticks out more than `minDepth` of the shape's size. Pixel
 * stair-steps and blunted tips stick out a few percent; real corners 30%+.
 * Returns indices into `poly`.
 */
export function simplifyConvexIndices(poly: Point[], minDepth = 0.15): number[] {
  const size = Math.sqrt(polygonArea(poly));
  let keep = poly.map((_, i) => i);
  while (keep.length > 3) {
    let best = -1;
    let bestDepth = Infinity;
    for (let k = 0; k < keep.length; k++) {
      const a = poly[keep[(k - 1 + keep.length) % keep.length]];
      const p = poly[keep[k]];
      const b = poly[keep[(k + 1) % keep.length]];
      const depth = Math.abs(cross(a, p, b)) / Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y));
      if (depth < bestDepth) {
        bestDepth = depth;
        best = k;
      }
    }
    if (bestDepth > size * minDepth) break;
    keep = keep.filter((_, k) => k !== best);
  }
  return keep;
}

export function simplifyConvex(poly: Point[], minDepth = 0.15): Point[] {
  return simplifyConvexIndices(poly, minDepth).map((i) => poly[i]);
}

/**
 * Sharpens corners blunted by pixels: fits a straight line to the hull
 * points along each side, then puts each corner where neighbouring sides meet.
 */
function refineCorners(hull: Point[], keep: number[]): Point[] {
  const n = keep.length;
  const limit = 0.2 * Math.sqrt(polygonArea(hull));
  const lines = keep.map((start, k) => {
    const end = keep[(k + 1) % n];
    const pts: Point[] = [];
    for (let i = start; ; i = (i + 1) % hull.length) {
      pts.push(hull[i]);
      if (i === end) break;
    }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (const p of pts) {
      sxx += (p.x - cx) ** 2;
      syy += (p.y - cy) ** 2;
      sxy += (p.x - cx) * (p.y - cy);
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { cx, cy, dx: Math.cos(angle), dy: Math.sin(angle) };
  });
  return keep.map((index, k) => {
    const a = lines[(k - 1 + n) % n];
    const b = lines[k];
    const det = a.dx * b.dy - a.dy * b.dx;
    const original = hull[index];
    if (Math.abs(det) < 1e-6) return original;
    const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / det;
    const corner = { x: a.cx + t * a.dx, y: a.cy + t * a.dy };
    // Never move a corner absurdly far (nearly parallel sides).
    return Math.hypot(corner.x - original.x, corner.y - original.y) < limit ? corner : original;
  });
}

const POLYGON_NAMES: Record<number, string> = { 3: 'Triangle', 4: 'Quadrilateral', 5: 'Pentagon', 6: 'Hexagon' };

function nameQuad(q: Point[]): string {
  const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y));
  const right = q.every((p, i) => {
    const a = q[(i - 1 + 4) % 4];
    const b = q[(i + 1) % 4];
    const dot = (a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y);
    return Math.abs(dot) / (Math.hypot(a.x - p.x, a.y - p.y) * Math.hypot(b.x - p.x, b.y - p.y)) < 0.17; // within ~10° of square
  });
  if (!right) return 'Quadrilateral';
  return Math.max(...sides) / Math.min(...sides) < 1 + SQUARE ? 'Square' : 'Rectangle';
}

/**
 * Finds a clean convex shape in the (filled) mask inside `region`, or null
 * for anything else (letters, several pieces, stars, graphs, photos).
 */
export function detectShape(mask: Uint8Array, width: number, height: number, region: Rect): DetectedShape | null {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const corners: Point[] = [];
  let area = 0;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      area++;
      const cx = x + 0.5;
      const cy = y + 0.5;
      sx += cx;
      sy += cy;
      sxx += cx * cx;
      syy += cy * cy;
      sxy += cx * cy;
      const edge =
        x === x0 || y === y0 || x === x1 - 1 || y === y1 - 1 || !mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width];
      if (edge) corners.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 });
    }
  if (area < 40) return null;
  const hull = convexHull(corners);
  const hullArea = polygonArea(hull);
  // Solid and convex: the shape fills its hull.
  if (hullArea <= 0 || area / hullArea < 0.88) return null;

  const ellipse = fitEllipse(mask, width, x0, y0, x1, y1, area, { sx, sy, sxx, syy, sxy });
  // A near-perfect ellipse wins first (an oval's flat ends would otherwise look like corners).
  if (ellipse && ellipse.mismatch <= 0.04) return perfectShape(ellipse.shape);
  const keep = simplifyConvexIndices(hull);
  if (keep.length <= 6) {
    const simple = refineCorners(hull, keep);
    const name = simple.length === 4 ? nameQuad(simple) : POLYGON_NAMES[simple.length];
    return perfectShape({ kind: 'polygon', name, points: simple });
  }
  return ellipse && ellipse.mismatch <= 0.08 ? perfectShape(ellipse.shape) : null;
}

/** Ellipse with the same second moments as the area, and how much the area differs from it. */
function fitEllipse(
  mask: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  area: number,
  m: { sx: number; sy: number; sxx: number; syy: number; sxy: number },
): { shape: DetectedShape; mismatch: number } | null {
  const mx = m.sx / area;
  const my = m.sy / area;
  const cxx = m.sxx / area - mx * mx;
  const cyy = m.syy / area - my * my;
  const cxy = m.sxy / area - mx * my;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const a = 2 * Math.sqrt(Math.max(tr / 2 + disc, 0));
  const b = 2 * Math.sqrt(Math.max(tr / 2 - disc, 0));
  if (a <= 0 || b <= 0) return null;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let mismatch = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - mx;
      const dy = y + 0.5 - my;
      const u = (dx * cos + dy * sin) / a;
      const v = (-dx * sin + dy * cos) / b;
      if ((u * u + v * v <= 1 ? 1 : 0) !== mask[y * width + x]) mismatch++;
    }
  const points: Point[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const ex = a * Math.cos(t);
    const ey = b * Math.sin(t);
    points.push({ x: mx + ex * cos - ey * sin, y: my + ex * sin + ey * cos });
  }
  return { shape: { kind: 'ellipse', name: a / b < 1.15 ? 'Circle' : 'Oval', points }, mismatch: mismatch / area };
}

function insidePolygon(poly: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToEdges(poly: Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Perfecting: small imperfections from drawing, blur or pixels are removed.

const DEG = Math.PI / 180;
/** Shapes tilted less than this are straightened. */
const STRAIGHTEN = 8 * DEG;
/** Sides within this share of each other count as equal. */
const EQUAL = 0.12;
/** A rectangle counts as a square only if its sides are within this share of each other (stricter than EQUAL: a slightly tall box is not a square). */
const SQUARE = 0.07;
/** Angles within this of a right angle count as right angles. */
const RIGHT = 10 * DEG;

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point) => Math.hypot(v.x, v.y);
const centroidOf = (pts: Point[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
const rotateAll = (pts: Point[], angle: number, c: Point) =>
  pts.map((p) => {
    const d = sub(p, c);
    return { x: c.x + d.x * Math.cos(angle) - d.y * Math.sin(angle), y: c.y + d.x * Math.sin(angle) + d.y * Math.cos(angle) };
  });
const nearlyEqual = (a: number, b: number) => Math.abs(a - b) <= EQUAL * Math.max(a, b);
/** The signed angle (radians) to turn `angle` to the nearest multiple of `step`. */
const snapDelta = (angle: number, step: number) => {
  const k = Math.round(angle / step);
  return k * step - angle;
};
const angleAt = (prev: Point, p: Point, next: Point) => {
  const a = sub(prev, p);
  const b = sub(next, p);
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (len(a) * len(b)))));
};

function regularPolygon(n: number, centre: Point, radius: number, firstAngle: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = firstAngle + (i * 2 * Math.PI) / n;
    return { x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) };
  });
}

function perfectTriangle(pts: Point[]): Point[] {
  // Base: the side closest to horizontal or vertical. Level it if it's only slightly off.
  const sides = [0, 1, 2].map((i) => ({ i, a: pts[i], b: pts[(i + 1) % 3] }));
  const tilt = (s: { a: Point; b: Point }) => snapDelta(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x), Math.PI / 2);
  const base = sides.reduce((best, s) => (Math.abs(tilt(s)) < Math.abs(tilt(best)) ? s : best));
  let p = pts;
  if (Math.abs(tilt(base)) <= STRAIGHTEN) p = rotateAll(pts, tilt(base), centroidOf(pts));
  const A = p[base.i];
  const B = p[(base.i + 1) % 3];
  const C = p[(base.i + 2) % 3]; // apex, opposite the base
  const baseVec = sub(B, A);
  const baseLen = len(baseVec);
  const u = { x: baseVec.x / baseLen, y: baseVec.y / baseLen };
  const normal = { x: -u.y, y: u.x };
  const side = sub(C, A).x * normal.x + sub(C, A).y * normal.y >= 0 ? 1 : -1;
  const n = { x: normal.x * side, y: normal.y * side };
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const ac = len(sub(C, A));
  const bc = len(sub(C, B));

  // Equilateral.
  if (nearlyEqual(ac, bc) && nearlyEqual(ac, baseLen) && nearlyEqual(bc, baseLen)) {
    const s = (ac + bc + baseLen) / 3;
    const a2 = { x: mid.x - (u.x * s) / 2, y: mid.y - (u.y * s) / 2 };
    const b2 = { x: mid.x + (u.x * s) / 2, y: mid.y + (u.y * s) / 2 };
    const h = (s * Math.sqrt(3)) / 2;
    return [a2, b2, { x: mid.x + n.x * h, y: mid.y + n.y * h }];
  }
  // Right angle at a base corner: make it exact (the apex goes straight up from that corner).
  const height = sub(C, A).x * n.x + sub(C, A).y * n.y;
  if (Math.abs(angleAt(B, A, C) - Math.PI / 2) <= RIGHT) return [A, B, { x: A.x + n.x * height, y: A.y + n.y * height }];
  if (Math.abs(angleAt(A, B, C) - Math.PI / 2) <= RIGHT) return [A, B, { x: B.x + n.x * height, y: B.y + n.y * height }];
  // Isosceles: the apex goes over the middle of the base.
  if (nearlyEqual(ac, bc)) return [A, B, { x: mid.x + n.x * height, y: mid.y + n.y * height }];
  return p;
}

function perfectQuad(pts: Point[]): { points: Point[]; name: string } | null {
  const c = centroidOf(pts);
  const angles = pts.map((p, i) => angleAt(pts[(i + 3) % 4], p, pts[(i + 1) % 4]));
  const sides = pts.map((p, i) => len(sub(pts[(i + 1) % 4], p)));
  if (angles.every((a) => Math.abs(a - Math.PI / 2) <= RIGHT)) {
    // Rectangle: orientation from the first side, straightened if nearly level.
    let theta = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    const d = snapDelta(theta, Math.PI / 2);
    let w = (sides[0] + sides[2]) / 2;
    let h = (sides[1] + sides[3]) / 2;
    const square = Math.abs(w - h) <= SQUARE * Math.max(w, h);
    if (square) w = h = (w + h) / 2;
    // A square standing on a corner is a diamond: snap it to exactly 45 degrees.
    const onCorner = square && Math.abs(Math.abs(d) - Math.PI / 4) <= STRAIGHTEN;
    if (onCorner) theta += snapDelta(theta + Math.PI / 4, Math.PI / 2);
    else if (Math.abs(d) <= STRAIGHTEN) theta += d;
    const corners = [
      { x: -w / 2, y: -h / 2 },
      { x: w / 2, y: -h / 2 },
      { x: w / 2, y: h / 2 },
      { x: -w / 2, y: h / 2 },
    ];
    return {
      points: rotateAll(
        corners.map((p) => ({ x: c.x + p.x, y: c.y + p.y })),
        theta,
        c,
      ),
      name: onCorner ? 'Diamond' : square ? 'Square' : 'Rectangle',
    };
  }
  if (sides.every((s) => nearlyEqual(s, sides[0]))) {
    // Rhombus with (nearly) upright diagonals: a diamond.
    const d1 = sub(pts[2], pts[0]);
    const d2 = sub(pts[3], pts[1]);
    const theta = Math.atan2(d1.y, d1.x);
    if (Math.abs(snapDelta(theta, Math.PI / 2)) <= STRAIGHTEN) {
      const horizontal = Math.abs(Math.cos(theta)) > 0.5;
      const half1 = len(d1) / 2;
      const half2 = len(d2) / 2;
      const hw = horizontal ? half1 : half2;
      const hh = horizontal ? half2 : half1;
      return {
        points: [
          { x: c.x, y: c.y - hh },
          { x: c.x + hw, y: c.y },
          { x: c.x, y: c.y + hh },
          { x: c.x - hw, y: c.y },
        ],
        name: 'Diamond',
      };
    }
  }
  return null;
}

function perfectRegular(pts: Point[]): Point[] | null {
  const n = pts.length;
  const sides = pts.map((p, i) => len(sub(pts[(i + 1) % n], p)));
  const mean = sides.reduce((s, x) => s + x, 0) / n;
  if (!sides.every((s) => Math.abs(s - mean) <= 0.15 * mean)) return null;
  const c = centroidOf(pts);
  const radius = pts.reduce((s, p) => s + len(sub(p, c)), 0) / n;
  // Upright orientations: a pentagon with a point at the top or bottom; a hexagon with flat or pointed top.
  const step = n === 5 ? Math.PI / 5 : Math.PI / 6;
  let first = Math.atan2(pts[0].y - c.y, pts[0].x - c.x);
  const d = snapDelta(first + Math.PI / 2, step);
  if (Math.abs(d) <= STRAIGHTEN * 1.5) first += d;
  return regularPolygon(n, c, radius, first);
}

function perfectEllipse(shape: DetectedShape): DetectedShape {
  const pts = shape.points;
  const c = centroidOf(pts);
  const dists = pts.map((p) => len(sub(p, c)));
  let a = Math.max(...dists);
  let b = Math.min(...dists);
  const far = pts[dists.indexOf(a)];
  let theta = Math.atan2(far.y - c.y, far.x - c.x);
  const d = snapDelta(theta, Math.PI / 2);
  if (Math.abs(d) <= STRAIGHTEN * 1.5) theta += d;
  const circle = a / b < 1.15;
  if (circle) a = b = (a + b) / 2;
  const points: Point[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const ex = a * Math.cos(t);
    const ey = b * Math.sin(t);
    points.push({ x: c.x + ex * Math.cos(theta) - ey * Math.sin(theta), y: c.y + ex * Math.sin(theta) + ey * Math.cos(theta) });
  }
  return { kind: 'ellipse', name: circle ? 'Circle' : 'Oval', points };
}

/**
 * Removes small imperfections so the pins show the shape that was meant:
 * straightens shapes tilted by a few degrees and makes nearly-equilateral,
 * isosceles or right triangles, rectangles, squares, diamonds, regular
 * pentagons/hexagons and circles exact.
 */
export function perfectShape(shape: DetectedShape): DetectedShape {
  if (shape.kind === 'ellipse') return perfectEllipse(shape);
  const n = shape.points.length;
  if (n === 3) return { ...shape, points: perfectTriangle(shape.points) };
  if (n === 4) {
    const q = perfectQuad(shape.points);
    return q ? { kind: 'polygon', ...q } : shape;
  }
  const r = perfectRegular(shape.points);
  return r ? { ...shape, points: r } : shape;
}

/** Whether the shape is its own mirror image about the vertical (x) or horizontal (y) line through its box centre. */
export function isMirrorSymmetric(points: Point[], axis: 'x' | 'y'): boolean {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const eps = 0.02 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return points.every((p) => {
    const m = axis === 'x' ? { x: 2 * cx - p.x, y: p.y } : { x: p.x, y: 2 * cy - p.y };
    return points.some((q) => Math.hypot(q.x - m.x, q.y - m.y) <= eps);
  });
}

/** Bounding box of a shape's corners. */
export function shapeBounds(shape: DetectedShape): Rect {
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(1e-6, Math.max(...xs) - x), height: Math.max(1e-6, Math.max(...ys) - y) };
}

/**
 * Draws the shape as large as the grid allows (aspect ratio kept, centred).
 * Filled: a pin is raised when at least `pinFill` of it is inside, and sharp
 * corners (under 75 degrees) always get their pin, so a thin tip doesn't vanish.
 * Symmetric shapes get symmetric pins.
 * Outline: a pin is raised when the edge passes through it.
 */
export function renderShape(
  shape: DetectedShape,
  rows: number,
  cols: number,
  pinPitchRatio: number,
  style: ShapeStyle,
  pinFill: number,
): Pattern {
  const box = shapeBounds(shape);
  const gridW = cols * pinPitchRatio;
  const scale = Math.min(gridW / box.width, rows / box.height);
  const offX = (gridW - box.width * scale) / 2;
  const offY = (rows - box.height * scale) / 2;
  // Shape in grid units.
  const poly = shape.points.map((p) => ({ x: (p.x - box.x) * scale + offX, y: (p.y - box.y) * scale + offY }));
  const N = 8; // samples per side of a pin
  const cells: PinValue[] = [];
  const coverage = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let on = false;
      if (style === 'filled') {
        let inside = 0;
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++) if (insidePolygon(poly, (c + (j + 0.5) / N) * pinPitchRatio, r + (i + 0.5) / N)) inside++;
        coverage[r * cols + c] = inside / (N * N);
        on = inside / (N * N) >= pinFill && inside > 0;
      } else {
        // The edge passes through the pin when it comes within ~half a pin of its centre.
        on = distanceToEdges(poly, (c + 0.5) * pinPitchRatio, r + 0.5) <= 0.5;
      }
      cells.push(on ? 1 : 0);
    }
  // A symmetric shape gets a symmetric pin pattern (no pixel-level wobble).
  const symX = isMirrorSymmetric(shape.points, 'x');
  const symY = isMirrorSymmetric(shape.points, 'y');
  if (style === 'filled' && (symX || symY)) {
    const avg = coverage.slice();
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const mirrors = [r * cols + c];
        if (symX) mirrors.push(r * cols + (cols - 1 - c));
        if (symY) mirrors.push((rows - 1 - r) * cols + c);
        if (symX && symY) mirrors.push((rows - 1 - r) * cols + (cols - 1 - c));
        avg[r * cols + c] = mirrors.reduce((s, i) => s + coverage[i], 0) / mirrors.length;
      }
    for (let i = 0; i < cells.length; i++) {
      coverage[i] = avg[i];
      cells[i] = avg[i] >= pinFill && avg[i] > 0 ? 1 : 0;
    }
  }
  const raise = (r: number, c: number) => {
    cells[r * cols + c] = 1;
    if (symX) cells[r * cols + (cols - 1 - c)] = 1;
    if (symY) cells[(rows - 1 - r) * cols + c] = 1;
    if (symX && symY) cells[(rows - 1 - r) * cols + (cols - 1 - c)] = 1;
  };
  if (shape.kind === 'polygon' && style === 'filled') {
    // Corners: nudge each slightly inwards so it lands in the pin it points into.
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k];
      // Only sharp tips (they are the corners that vanish); right angles are already well covered.
      if (angleAt(poly[(k - 1 + poly.length) % poly.length], p, poly[(k + 1) % poly.length]) > 75 * DEG) continue;
      const d = Math.hypot(cx - p.x, cy - p.y) || 1;
      const x = p.x + ((cx - p.x) / d) * 0.25;
      const y = p.y + ((cy - p.y) / d) * 0.25;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / pinPitchRatio)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y)));
      // Only if the shape really reaches into that pin.
      if (coverage[r * cols + c] >= 0.1) raise(r, c);
    }
  }
  return { rows, cols, cells };
}

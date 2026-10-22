/**
 * Flat surfaces in camera pictures: a laptop or phone screen, a sheet of paper, a card, a whiteboard. Seen by a
 * camera they are four-cornered shapes in perspective (a screen photographed from the side is a trapezoid), with
 * the room around them. Like a document scanner, this finds the surface's four corners and flattens it, so the
 * rest of the app sees what is on it as if it were a screenshot or a scan: straight gridlines, the page's own
 * background, no room. Pure functions, unit tested.
 *
 *  1. Regions: brightness on a small copy is cut at several levels, brighter-than and darker-than (a white page,
 *     a dark-theme screen), and each large connected region is a candidate. So are the large smooth regions
 *     (no edges inside): a page under uneven light is one smooth region, while wood grain or a checked cloth
 *     break up into small pieces.
 *  2. Four corners: the region's convex hull, reduced to the four-cornered shape with the largest area.
 *  3. Is it a flat surface? The region, with its holes (the drawing on the page) filled, must fill that
 *     four-cornered shape (a page, not a blob), be large, and not be the backdrop (touching three or more edges
 *     of the picture: the table, the wall).
 *  4. Flatten: a homography (perspective map) from the flat page to the four corners; every page pixel is read
 *     from the picture by bilinear interpolation.
 */
import { convexHull, type Point, polygonArea, type Rect } from './geometry';
import { labelComponents } from './masks';

export type Quad = [Point, Point, Point, Point]; // top-left, top-right, bottom-right, bottom-left

/** A perspective map from page coordinates (u, v in 0..1) to picture coordinates, and back. */
export interface Homography {
  toPicture(u: number, v: number): Point;
  toPage(x: number, y: number): Point;
}

/** The homography taking the unit square onto `q` (standard square-to-quad construction), and its inverse. */
export function quadHomography(q: Quad): Homography {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;
  // Inverse: the adjugate of [[a b c] [d e f] [g h 1]].
  const A = e - f * h;
  const B = c * h - b;
  const C = b * f - c * e;
  const D = f * g - d;
  const E = a - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const Hh = b * g - a * h;
  const I = a * e - b * d;
  return {
    toPicture: (u, v) => {
      const w = g * u + h * v + 1;
      return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
    },
    toPage: (x, y) => {
      const w = G * x + Hh * y + I;
      return { x: (A * x + B * y + C) / w, y: (D * x + E * y + F) / w };
    },
  };
}

/**
 * The four hull points spanning the largest area (the hull is first thinned to at most 28 points, so this is a
 * few tens of thousands of area tests at most), returned as top-left, top-right, bottom-right, bottom-left.
 */
export function largestQuad(hull: Point[]): Quad | null {
  if (hull.length < 4) return null;
  const step = Math.max(1, Math.ceil(hull.length / 28));
  const h = hull.filter((_, i) => i % step === 0);
  const n = h.length;
  if (n < 4) return null;
  let best = -1;
  let bq: Point[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const area = polygonArea([h[i], h[j], h[k], h[l]]);
          if (area > best) {
            best = area;
            bq = [h[i], h[j], h[k], h[l]];
          }
        }
  return orderCorners(bq);
}

/** Corners in reading order: the top two (left, right), then the bottom two (right, left). */
export function orderCorners(pts: Point[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // atan2 order from -π: top-left, top-right, bottom-right, bottom-left (y grows downwards).
  const start = byAngle.reduce((bi, p, i) => (p.x + p.y < byAngle[bi].x + byAngle[bi].y ? i : bi), 0);
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad;
}

export interface Surface {
  /** The four corners in the picture (picture pixels). */
  quad: Quad;
  /** Width / height of the flattened page (from the corners' side lengths). */
  aspect: number;
  /** How well the region fills its four corners, 0..1. */
  fill: number;
}

/**
 * How clearly the quad's sides stand out: for each side not lying on the picture's border, the median brightness
 * difference between points just inside and just outside it; the weakest side counts.
 */
function edgeContrast(lum: Float32Array, w: number, h: number, q: Quad): number {
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
  const reach = Math.max(2, 0.03 * Math.min(w, h));
  let weakest = Infinity;
  for (let s = 0; s < 4; s++) {
    const a = q[s];
    const b = q[(s + 1) % 4];
    const onBorder = (p: Point) => p.x <= 2 || p.y <= 2 || p.x >= w - 3 || p.y >= h - 3;
    if (onBorder(a) && onBorder(b)) continue;
    const diffs: number[] = [];
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      // Inward: towards the centre.
      const len = Math.hypot(c.x - px, c.y - py) || 1;
      const ix = ((c.x - px) / len) * reach;
      const iy = ((c.y - py) / len) * reach;
      if (px - ix < 0 || py - iy < 0 || px - ix >= w || py - iy >= h) continue;
      diffs.push(Math.abs(at(px + ix, py + iy) - at(px - ix, py - iy)));
    }
    if (diffs.length < 5) continue;
    diffs.sort((x, y) => x - y);
    weakest = Math.min(weakest, diffs[diffs.length >> 1]);
  }
  return weakest === Infinity ? 0 : weakest;
}

/**
 * Every interior angle under 155°, and no side shorter than a quarter of the longest (a page or screen is at most
 * 4:1 even in perspective; a triangle with a notch from its shadow has one tiny "side").
 */
function realCorners(q: Quad): boolean {
  const sides = q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y));
  if (Math.min(...sides) < 0.25 * Math.max(...sides)) return false;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4];
    const b = q[i];
    const c = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > (155 * Math.PI) / 180) return false;
  }
  return true;
}

/**
 * Something is drawn or shown on the surface: at least 0.5% of its inner part (away from its edges) has a clear
 * brightness step. A blank card or an object's flat face has none.
 */
function hasContent(lum: Float32Array, w: number, h: number, q: Quad): boolean {
  const H = quadHomography(q);
  let steps = 0;
  let n = 0;
  for (let j = 1; j < 40; j++)
    for (let i = 1; i < 40; i++) {
      const u = 0.1 + (0.8 * i) / 40;
      const v = 0.1 + (0.8 * j) / 40;
      const p = H.toPicture(u, v);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const k = y * w + x;
      n++;
      if (Math.max(Math.abs(lum[k + 1] - lum[k - 1]), Math.abs(lum[k + w] - lum[k - w])) > 14) steps++;
    }
  return n > 0 && steps / n >= 0.005;
}

/** Brightness on a copy `k` times smaller. */
function smallLum(rgb: ArrayLike<number>, width: number, height: number, k: number) {
  const w = Math.floor(width / k);
  const h = Math.floor(height / k);
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h * k; y++)
    for (let x = 0; x < w * k; x++) {
      const p = (y * width + x) * 3;
      lum[Math.floor(y / k) * w + Math.floor(x / k)] += (0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2]) / (k * k);
    }
  return { lum, w, h };
}

/**
 * The main flat surface in a camera picture, or null. `minShare`: the smallest share of the picture it may
 * cover; anything covering more than 92% is the picture itself (the surface fills the view: nothing to flatten).
 */
export function findSurface(rgb: ArrayLike<number>, width: number, height: number, minShare = 0.08): Surface | null {
  const k = Math.max(1, Math.round(Math.max(width, height) / 320));
  const { lum, w, h } = smallLum(rgb, width, height, k);
  const sorted = Float32Array.from(lum).sort();
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  let best: (Surface & { score: number }) | null = null;

  // Smooth: no brightness step of more than a few levels to the neighbours (camera frames are denoised first).
  const smooth = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.max(Math.abs(lum[i + 1] - lum[i - 1]), Math.abs(lum[i + w] - lum[i - w]));
      smooth[i] = g < 6 ? 1 : 0;
    }
  const masks: Uint8Array[] = [smooth];
  for (const level of [0.25, 0.45, 0.65, 0.8])
    for (const brighter of [true, false]) {
      const t = q(level);
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) m[i] = brighter ? (lum[i] > t ? 1 : 0) : lum[i] < t ? 1 : 0;
      masks.push(m);
    }

  for (const m of masks) {
    const { labels, components } = labelComponents(m, w, h);
    {
      components.forEach((comp, ci) => {
        if (comp.area / (w * h) < minShare * 0.5) return;
        // Its outline: the leftmost and rightmost pixel of each row are enough for the hull. The span between
        // them is the region with its holes filled (the drawing on a page belongs to the page).
        const pts: Point[] = [];
        let spanArea = 0;
        for (let y = comp.box.y; y < comp.box.y + comp.box.height; y++) {
          let lo = -1;
          let hi = -1;
          for (let x = comp.box.x; x < comp.box.x + comp.box.width; x++)
            if (labels[y * w + x] === ci + 1) {
              if (lo < 0) lo = x;
              hi = x;
            }
          if (lo >= 0) {
            pts.push({ x: lo, y }, { x: hi + 1, y }, { x: lo, y: y + 1 }, { x: hi + 1, y: y + 1 });
            spanArea += hi - lo + 1;
          }
        }
        const share = spanArea / (w * h);
        if (share < minShare || share > 0.92) return;
        // The backdrop (table, wall) reaches three or more edges of the picture.
        // (Within a pixel: the smoothness map has no values on the picture's outermost ring.)
        const edges =
          +(comp.box.x <= 1) + +(comp.box.y <= 1) + +(comp.box.x + comp.box.width >= w - 1) + +(comp.box.y + comp.box.height >= h - 1);
        if (edges >= 3) return;
        const hull = convexHull(pts);
        const quad = largestQuad(hull);
        if (!quad) return;
        const quadArea = polygonArea(quad);
        const fill = spanArea / quadArea;
        const convexity = quadArea / polygonArea(hull);
        // A page: fills its four corners, which are nearly its whole outline; not too thin.
        if (fill < 0.88 || convexity < 0.92) return;
        const side = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
        const wTop = side(quad[0], quad[1]);
        const wBottom = side(quad[3], quad[2]);
        const hLeft = side(quad[0], quad[3]);
        const hRight = side(quad[1], quad[2]);
        const aspect = (wTop + wBottom) / (hLeft + hRight);
        if (aspect < 0.25 || aspect > 4) return;
        // Four real corners: a triangle's "fourth corner" sits on one of its sides (an angle near 180°).
        if (!realCorners(quad)) return;
        // Something on it: a plain card or an object is not a page to look into (it is the subject itself).
        if (!hasContent(lum, w, h, quad)) return;
        // A real surface stands out from what surrounds it (paper on a table, a screen in its bezel); a panel
        // inside a screen doesn't. Brightness just inside and just outside each side must differ clearly.
        if (edgeContrast(lum, w, h, quad) < 18) return;
        // Bigger and fuller wins; a surface touching the picture's edge is likely cut off, so it ranks lower.
        const score = share * Math.min(1, fill) ** 4 * (edges ? 0.5 : 1);
        if (!best || score > best.score)
          best = { quad: quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad, aspect, fill, score };
      });
    }
  }
  if (!best) return null;
  const { quad, aspect, fill } = best;
  return { quad, aspect, fill };
}

/** The flattened page: RGB pixels `width` x `height`, and where they came from. */
export interface FlatPage {
  rgb: Uint8ClampedArray;
  width: number;
  height: number;
  /** Page pixel → picture pixel, and back. */
  toPicture(p: Point): Point;
  toPage(p: Point): Point;
}

/**
 * Flattens the surface into a page of about the same number of pixels it had in the picture (longest side at
 * most `maxSide`), keeping the surface's own proportions. Bilinear sampling.
 */
export function flatten(rgb: ArrayLike<number>, width: number, height: number, s: Surface, maxSide = 640, inset = 0.03): FlatPage {
  const [p0, p1, p2, p3] = s.quad;
  const across = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p2.x - p3.x, p2.y - p3.y));
  const down = Math.max(Math.hypot(p3.x - p0.x, p3.y - p0.y), Math.hypot(p2.x - p1.x, p2.y - p1.y));
  // The page keeps the measured proportions; its size follows the surface's size in the picture.
  const longest = Math.min(maxSide, Math.max(across, down));
  const pw = Math.max(8, Math.round(s.aspect >= 1 ? longest : longest * s.aspect));
  const ph = Math.max(8, Math.round(s.aspect >= 1 ? longest / s.aspect : longest));
  const H = quadHomography(s.quad);
  // A little inside the corners: the found outline can include a sliver of what's around (a bezel, the table,
  // the paper's shadow), which would otherwise frame the page and be taken for its edge or a stroke.
  const m = inset;
  const span = 1 - 2 * m;
  const toPicture = (px: number, py: number) => H.toPicture(m + (px / pw) * span, m + (py / ph) * span);
  const out = new Uint8ClampedArray(pw * ph * 3);
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const p = toPicture(x + 0.5, y + 0.5);
      const fx = Math.min(width - 1.001, Math.max(0, p.x - 0.5));
      const fy = Math.min(height - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * width + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + width * 3;
      const i11 = i01 + 3;
      for (let c = 0; c < 3; c++) {
        const top = rgb[i00 + c] * (1 - ax) + rgb[i10 + c] * ax;
        const bottom = rgb[i01 + c] * (1 - ax) + rgb[i11 + c] * ax;
        out[(y * pw + x) * 3 + c] = top * (1 - ay) + bottom * ay;
      }
    }
  return {
    rgb: out,
    width: pw,
    height: ph,
    toPicture: (p) => toPicture(p.x, p.y),
    toPage: (p) => {
      const u = H.toPage(p.x, p.y);
      return { x: ((u.x - m) / span) * pw, y: ((u.y - m) / span) * ph };
    },
  };
}

/**
 * A flattened page as the live camera delivers it: the page is what the app analyses, and these map between it
 * and the camera picture shown behind the crop box (frame pixels, at the frame size given).
 */
export interface SurfaceView {
  frameWidth: number;
  frameHeight: number;
  /** The surface's corners in the frame. */
  quad: Quad;
  toFrame(p: Point): Point;
  toPage(p: Point): Point;
}

/** A rectangle mapped through `f` (a perspective map), as the rectangle around the result. */
export function mapRect(r: Rect, f: (p: Point) => Point, bounds?: { width: number; height: number }): Rect {
  const pts = [f({ x: r.x, y: r.y }), f({ x: r.x + r.width, y: r.y }), f({ x: r.x + r.width, y: r.y + r.height }), f({ x: r.x, y: r.y + r.height })];
  let x0 = Math.min(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y));
  let x1 = Math.max(...pts.map((p) => p.x));
  let y1 = Math.max(...pts.map((p) => p.y));
  if (bounds) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(bounds.width, x1);
    y1 = Math.min(bounds.height, y1);
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * Follows the surface across live camera frames: found on two looks in a row before it is used, held through two
 * misses (a hand passing over), corners smoothed so the flattened page doesn't jitter, and searched for only
 * every other frame while held (the search is the costly part). With nothing found for a while (an object on a
 * table, no page in view), only every third frame: a page coming into view is still found within three frames.
 */
export class SurfaceWatch {
  private quad: Quad | null = null;
  private aspect = 1;
  private seen = 0;
  private missed = 0;
  private frame = 0;
  /** Searches in a row that found nothing. */
  private empty = 0;

  update(rgb: ArrayLike<number>, width: number, height: number): Surface | null {
    this.frame++;
    const held = this.quad && this.seen >= 2;
    const skip = held ? this.frame % 2 === 0 : !this.quad && this.empty >= 3 && this.frame % 3 !== 0;
    if (!skip) {
      const s = findSurface(rgb, width, height);
      this.empty = s ? 0 : this.empty + 1;
      if (s) {
        const jump = this.quad ? Math.max(...s.quad.map((p, i) => Math.hypot(p.x - this.quad![i].x, p.y - this.quad![i].y))) : Infinity;
        const near = jump < 0.06 * Math.max(width, height);
        // Close to the last place: blend (steadier); far: a new surface, or the phone moved a lot.
        this.quad = near ? (s.quad.map((p, i) => ({ x: 0.5 * p.x + 0.5 * this.quad![i].x, y: 0.5 * p.y + 0.5 * this.quad![i].y })) as Quad) : s.quad;
        this.aspect = near ? 0.7 * this.aspect + 0.3 * s.aspect : s.aspect;
        this.seen = near ? this.seen + 1 : 1;
        this.missed = 0;
      } else if (++this.missed > 2) {
        this.quad = null;
        this.seen = 0;
      }
    }
    return this.quad && this.seen >= 2 ? { quad: this.quad, aspect: this.aspect, fill: 1 } : null;
  }

  reset() {
    this.quad = null;
    this.seen = 0;
    this.missed = 0;
    this.empty = 0;
  }
}

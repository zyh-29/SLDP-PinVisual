/**
 * Follows a locked item by its distinctive points (features.ts): turning the phone, tilting it, quick moves and
 * look-alike items next to it, which the template tracker (tracker.ts) can't handle. Pure, unit tested.
 *
 * Lock: the item's points (inside its box) are kept, with their positions in the frame it was locked in.
 * Each frame:
 *  1. Match: each kept point to the frame's points by description (ratio test, so ambiguous points drop out).
 *  2. Movement (RANSAC): matches include mistakes, so the movement is guessed from 2 random matches at a time
 *     (shift, turn and size: a "similarity"), and the guess most other matches agree with wins. Its agreeing
 *     matches ("inliers") are then fitted exactly, by least squares.
 *  3. Tilt: with enough inliers a full perspective map (homography, 8 numbers) is fitted to them as well, and used
 *     when it is sane (a convex shape, not much bigger or smaller than the similarity says) and fits as well.
 *  4. The item's box corners mapped through that: where the item is now, turned and tilted (a quad), and its
 *     bounding box for the smart crop.
 * The kept points are renewed from the current frame when the item has come much closer, gone much further or
 * turned a lot, so the descriptions keep matching.
 */
import type { FrameShift } from './cameraShake';
import { detectFeatures, type GrayImage, type Keypoint, matchFeatures } from './features';
import { cross, type Point, polygonArea, type Rect } from './geometry';

/** Maps a point of the lock frame (gray pixels) to the current frame (gray pixels). */
export interface Motion {
  map: (p: Point) => Point;
  /** Size now relative to the lock frame. */
  scale: number;
  /** Turn since the lock frame, radians. */
  angle: number;
  /** A perspective (tilt) fit was used. */
  perspective: boolean;
}

export interface FeatureTrack {
  /** The item's box corners now (frame pixels): top-left, top-right, bottom-right, bottom-left. */
  quad: [Point, Point, Point, Point];
  /** Its bounding box (frame pixels). */
  box: Rect;
  /** The spot of the item that was tapped (or its middle), now (frame pixels). */
  point: Point;
  motion: Motion;
  /** Matches agreeing with the movement. */
  inliers: number;
  /**
   * How much of the item the agreeing points cover (their bounding box over the item's box, in the lock frame,
   * 0..1). Points bunched in one corner pin down where the item is but not how big it is.
   */
  spread: number;
  /** 0..1: how sure. */
  score: number;
}

/** Fewer points than this on an item: too plain to follow by features (the template tracker does). */
export const MIN_ITEM_POINTS = 20;
/** Fewer agreeing matches than this: not found in this frame. */
const MIN_INLIERS = 10;
const RANSAC_ROUNDS = 220;

interface Sim {
  ar: number;
  ai: number;
  tx: number;
  ty: number;
}
const applySim = (s: Sim, p: Point): Point => ({ x: s.ar * p.x - s.ai * p.y + s.tx, y: s.ai * p.x + s.ar * p.y + s.ty });

/** Least-squares similarity (shift, turn, size) from pairs. */
function fitSim(ps: Point[], qs: Point[]): Sim | null {
  const n = ps.length;
  if (n < 2) return null;
  let pcx = 0;
  let pcy = 0;
  let qcx = 0;
  let qcy = 0;
  for (let i = 0; i < n; i++) {
    pcx += ps[i].x;
    pcy += ps[i].y;
    qcx += qs[i].x;
    qcy += qs[i].y;
  }
  pcx /= n;
  pcy /= n;
  qcx /= n;
  qcy /= n;
  let den = 0;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const px = ps[i].x - pcx;
    const py = ps[i].y - pcy;
    const qx = qs[i].x - qcx;
    const qy = qs[i].y - qcy;
    den += px * px + py * py;
    re += px * qx + py * qy;
    im += px * qy - py * qx;
  }
  if (den < 1e-9) return null;
  const ar = re / den;
  const ai = im / den;
  return { ar, ai, tx: qcx - (ar * pcx - ai * pcy), ty: qcy - (ai * pcx + ar * pcy) };
}

/** A 3 x 3 perspective map (row-major, h[8] = 1). */
type Homography = Float64Array;
const applyH = (h: Homography, p: Point): Point => {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
};

/** Solves A x = b (n x n, row-major) by Gaussian elimination with partial pivoting. Null when singular. */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = Float64Array.from(A);
  const v = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (Math.abs(M[piv * n + c]) < 1e-12) return null;
    if (piv !== c) {
      for (let k = 0; k < n; k++) [M[c * n + k], M[piv * n + k]] = [M[piv * n + k], M[c * n + k]];
      [v[c], v[piv]] = [v[piv], v[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      v[r] -= f * v[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = v[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

/** Shift and scale so points sit around 0 at an average distance of √2 (keeps the fit well conditioned). */
function normaliser(ps: Point[]) {
  let cx = 0;
  let cy = 0;
  for (const p of ps) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ps.length;
  cy /= ps.length;
  let d = 0;
  for (const p of ps) d += Math.hypot(p.x - cx, p.y - cy);
  const s = Math.SQRT2 / Math.max(1e-9, d / ps.length);
  return { cx, cy, s };
}

/** Least-squares homography from 4 or more pairs (normalised DLT with h33 = 1). */
export function fitHomography(ps: Point[], qs: Point[]): Homography | null {
  const n = ps.length;
  if (n < 4) return null;
  const np = normaliser(ps);
  const nq = normaliser(qs);
  const AtA = new Float64Array(64);
  const Atb = new Float64Array(8);
  const row = new Float64Array(8);
  const add = (r: Float64Array, b: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += r[i] * b;
      for (let j = 0; j < 8; j++) AtA[i * 8 + j] += r[i] * r[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const x = (ps[i].x - np.cx) * np.s;
    const y = (ps[i].y - np.cy) * np.s;
    const u = (qs[i].x - nq.cx) * nq.s;
    const v = (qs[i].y - nq.cy) * nq.s;
    row.set([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    add(row, u);
    row.set([0, 0, 0, x, y, 1, -v * x, -v * y]);
    add(row, v);
  }
  const h = solve(AtA, Atb, 8);
  if (!h) return null;
  // Undo the normalisation: H = Tq^-1 * Hn * Tp.
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const Tp = [np.s, 0, -np.s * np.cx, 0, np.s, -np.s * np.cy, 0, 0, 1];
  const TqInv = [1 / nq.s, 0, nq.cx, 0, 1 / nq.s, nq.cy, 0, 0, 1];
  const mul = (A: number[], B: number[]) => {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return C;
  };
  const H = mul(TqInv, mul(Hn, Tp));
  if (!H[8]) return null;
  return Float64Array.from(H.map((v) => v / H[8]));
}

function convex(q: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
    if (!c) return false;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

/**
 * The movement from matched points `ps` (lock frame) to `qs` (now), robust to wrong matches. `tol`: how far
 * (gray pixels) a match may be from the movement to agree with it. `corners`: the item's box in the lock frame,
 * to check a perspective fit is sane. Null when too few matches agree.
 */
export function estimateMotion(ps: Point[], qs: Point[], tol: number, corners: Point[], seed = 1): { motion: Motion; inliers: number[] } | null {
  const n = ps.length;
  if (n < MIN_INLIERS) return null;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const agree = (map: (p: Point) => Point) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = map(ps[i]);
      if (Math.hypot(m.x - qs[i].x, m.y - qs[i].y) <= tol) out.push(i);
    }
    return out;
  };
  let best: number[] = [];
  for (let r = 0; r < RANSAC_ROUNDS; r++) {
    const i = Math.floor(rnd() * n);
    let j = Math.floor(rnd() * (n - 1));
    if (j >= i) j++;
    const sim = fitSim([ps[i], ps[j]], [qs[i], qs[j]]);
    if (!sim) continue;
    const scale = Math.hypot(sim.ar, sim.ai);
    // The phone can't come 4 times closer between two frames.
    if (scale < 0.25 || scale > 4) continue;
    const inl = agree((p) => applySim(sim, p));
    if (inl.length > best.length) best = inl;
  }
  if (best.length < MIN_INLIERS) return null;
  // Least squares on the agreeing matches, then once more with whoever agrees with that.
  let sim = fitSim(best.map((i) => ps[i]), best.map((i) => qs[i]))!;
  let inliers = agree((p) => applySim(sim, p));
  if (inliers.length >= MIN_INLIERS) sim = fitSim(inliers.map((i) => ps[i]), inliers.map((i) => qs[i])) ?? sim;
  else inliers = best;
  const simScale = Math.hypot(sim.ar, sim.ai);
  let motion: Motion = { map: (p) => applySim(sim, p), scale: simScale, angle: Math.atan2(sim.ai, sim.ar), perspective: false };
  // Tilt: a perspective map, if it is sane and explains the matches at least as well.
  if (inliers.length >= 12) {
    const H = fitHomography(inliers.map((i) => ps[i]), inliers.map((i) => qs[i]));
    if (H) {
      const q = corners.map((c) => applyH(H, c));
      const ratio = polygonArea(q) / Math.max(1e-9, polygonArea(corners) * simScale * simScale);
      const finite = q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (finite && convex(q) && ratio > 0.5 && ratio < 2) {
        const hIn = agree((p) => applyH(H, p));
        // Only when the tilt is real: the item's corners land clearly elsewhere than the similarity puts them.
        // Otherwise the extra freedom just fits noise, and the corners (far from most points) wobble.
        const bend = Math.max(...corners.map((c, i) => Math.hypot(q[i].x - applySim(sim, c).x, q[i].y - applySim(sim, c).y)));
        if (hIn.length >= inliers.length && bend > tol) {
          motion = { ...motion, map: (p) => applyH(H, p), perspective: true };
          inliers = hIn;
        }
      }
    }
  }
  return { motion, inliers };
}

export class FeatureTracker {
  /** The item's points, positions in `base` frame's gray pixels. */
  private points: Keypoint[] = [];
  /** The item's box corners in the base frame (gray pixels). */
  private corners: Point[] = [];
  /** The spot to point at (tapped, or the middle), in the base frame (gray pixels). */
  private anchor: Point = { x: 0, y: 0 };
  private k = 1;
  /** The last frame's movement (from the base frame), to predict where the points are now. */
  private last: Motion | null = null;

  get locked() {
    return this.points.length > 0;
  }

  /**
   * Locks onto the item in `box` (frame pixels); `at` is the tapped spot in it, if any. False when it has too few
   * points to follow this way.
   */
  lock(img: GrayImage, box: Rect, at?: Point): boolean {
    const b = { x: box.x / img.k, y: box.y / img.k, width: box.width / img.k, height: box.height / img.k };
    const pts = detectFeatures(img, { max: 300, region: b });
    if (pts.length < MIN_ITEM_POINTS) {
      this.unlock();
      return false;
    }
    this.points = pts;
    this.corners = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ];
    this.anchor = at ? { x: at.x / img.k, y: at.y / img.k } : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    this.k = img.k;
    this.last = null;
    return true;
  }

  unlock() {
    this.points = [];
    this.last = null;
  }

  /**
   * Where the item is in this frame; null when it isn't found here (covered, out of view, too blurred).
   * `shake`: how far the whole picture moved since the last frame (cameraShake.ts): the points are looked for that
   * much further on.
   */
  track(img: GrayImage, shake?: FrameShift | null): FeatureTrack | null {
    if (!this.points.length || img.k !== this.k) return null;
    const frame = detectFeatures(img, { max: 500 });
    const diag = Math.hypot(this.corners[2].x - this.corners[0].x, this.corners[2].y - this.corners[0].y);
    // Agreement within 3% of the item's size (as now seen), at least 3 pixels.
    const tol = Math.max(3, 0.03 * diag * (this.last?.scale ?? 1));
    const attempt = (near?: Parameters<typeof matchFeatures>[4]) => {
      // Near the expected place only neighbours compete, so the ratio test can be looser.
      const matches = near ? matchFeatures(this.points, frame, 0.9, 72, near) : matchFeatures(this.points, frame, 0.8, 64);
      const points = matches.map((m) => this.points[m.a]);
      const est = estimateMotion(points, matches.map((m) => frame[m.b]), tol, this.corners);
      return est && { ...est, points };
    };
    // Two ways, both every frame:
    //  - near: each point only near where the last movement says it is (a hand moves a little between frames).
    //    Repeated patterns elsewhere don't compete, so many points match.
    //  - wide: anywhere in the frame. Only points unique in the whole picture survive the ratio test (on a graph:
    //    its curve, not its gridlines), so fewer match, but they can't be fooled by a look-alike.
    // After a big jump "near" can land on a look-alike that moved into the item's old place (the next graph's
    // identical gridlines). So when the two disagree about where the item is, "wide" wins.
    const last = this.last;
    const sx = shake ? shake.dx / this.k : 0;
    const sy = shake ? shake.dy / this.k : 0;
    const expected = (i: number) => {
      const p = last!.map(this.points[i]);
      return { x: p.x + sx, y: p.y + sy };
    };
    const near = last ? attempt({ at: expected, radius: 0.25 * diag * last.scale + 12 }) : null;
    const wide = attempt();
    let est = near ?? wide;
    if (near && wide) {
      const mid = { x: (this.corners[0].x + this.corners[2].x) / 2, y: (this.corners[0].y + this.corners[2].y) / 2 };
      const a = near.motion.map(mid);
      const b = wide.motion.map(mid);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 3 * tol) est = wide;
    }
    if (!est) return null;
    const { motion, inliers } = est;
    this.last = motion;
    const used = inliers.map((i) => est.points[i]);
    const ux = used.map((p) => p.x);
    const uy = used.map((p) => p.y);
    const itemArea = polygonArea(this.corners);
    const spread = Math.min(1, ((Math.max(...ux) - Math.min(...ux)) * (Math.max(...uy) - Math.min(...uy))) / Math.max(1, itemArea));
    const k = this.k;
    const quad = this.corners.map((c) => {
      const p = motion.map(c);
      return { x: p.x * k, y: p.y * k };
    }) as [Point, Point, Point, Point];
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const a = motion.map(this.anchor);
    return {
      quad,
      box: { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 },
      point: { x: a.x * k, y: a.y * k },
      motion,
      inliers: inliers.length,
      spread,
      score: Math.min(1, inliers.length / 40),
    };
  }

  /**
   * After a good track: when the item now looks a lot bigger, smaller or turned than its kept points, they are
   * renewed from this frame (inside its current outline), so they keep matching. `track`: this frame's result.
   */
  renew(img: GrayImage, track: FeatureTrack): boolean {
    const m = track.motion;
    // A real change of look: much bigger or smaller, turned more than ~20°, or seen clearly from a new angle.
    const sides = (q: Point[]) => q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y));
    const before = sides(this.corners);
    const now = sides(track.quad.map((p) => ({ x: p.x / img.k, y: p.y / img.k })));
    const shape = now.map((s, i) => s / before[i] / m.scale);
    const skewed = Math.max(...shape) / Math.min(...shape) > 1.2;
    const far = m.scale < 0.75 || m.scale > 1.33 || Math.abs(m.angle) > 0.35 || skewed;
    if (!far || track.inliers < 15 || img.k !== this.k) return false;
    const q = track.quad.map((p) => ({ x: p.x / img.k, y: p.y / img.k }));
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    const region = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    // Only points inside the item's (turned, tilted) outline.
    const pts = detectFeatures(img, { max: 300, region }).filter((p) => insideQuad(q, p));
    if (pts.length < MIN_ITEM_POINTS) return false;
    // This frame becomes the base: the item's outline is the mapped quad, the spot is where it is now.
    this.anchor = m.map(this.anchor);
    this.points = pts;
    this.corners = q;
    // This frame is now the base: no movement since.
    this.last = { map: (p) => p, scale: 1, angle: 0, perspective: false };
    return true;
  }
}

/** Point inside a convex quad. */
function insideQuad(q: Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], p);
    if (sign && c && Math.sign(c) !== sign) return false;
    if (c) sign = Math.sign(c);
  }
  return true;
}

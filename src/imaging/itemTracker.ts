/**
 * The camera lock's tracker: follows a locked item two ways and uses whichever is sure.
 *
 *  - By its distinctive points (featureTracker.ts): handles turning and tilting the phone, quick moves and a
 *    look-alike next to the item, and gives the item's exact outline. Needs an item with some detail.
 *  - By its overall look (tracker.ts, template matching): works on plain items with few points (a solid shape),
 *    and keeps the lock through frames where the points can't be found (motion blur).
 *
 * Each frame the points are tried first; when they find the item the template is just moved there (it stays in
 * step, ready to take over). When they don't, the template searches. The lock is released after GIVE_UP frames
 * in a row with neither finding it. Pure, unit tested.
 */
import { frameShift } from './cameraShake';
import { type FeatureTrack, FeatureTracker } from './featureTracker';
import { type GrayImage, grayImage } from './features';
import { iou, type Point, type Rect } from './geometry';
import { type SmallGray, smallGray, TargetTracker, type TrackResult } from './tracker';

/** A frame prepared for both trackers. */
export interface TrackFrame {
  small: SmallGray;
  gray: GrayImage;
}

export function trackFrame(rgb: ArrayLike<number>, width: number, height: number): TrackFrame {
  return { small: smallGray(rgb, width, height), gray: grayImage(rgb, width, height) };
}

/**
 * Points are trusted over the template when at least this many agree, spread over at least this share of the
 * item (bunched in one corner they say where it is, not how big; on a blurry frame of gridlines that happens).
 */
const SURE_INLIERS = 12;
const SURE_SPREAD = 0.3;
/**
 * So many points, so well spread, that the estimate is solid on its own: the points may be renewed without the
 * smart crop confirming (it can't, on a turned graph: it looks for level gridlines).
 */
const SOLID_INLIERS = 20;
const SOLID_SPREAD = 0.4;
/** Frames in a row without the item before the lock is released (as the template tracker). */
const GIVE_UP = 12;

export class ItemTracker {
  private readonly template = new TargetTracker();
  private readonly points = new FeatureTracker();
  private missed = 0;
  private last: TrackResult | null = null;
  /** The points' result for the last frame, kept until the smart crop confirms it (refine). */
  private lastPoints: FeatureTrack | null = null;
  /** How the item was found in the last frame. */
  by: 'points' | 'template' | null = null;
  /** The last frame looked at, to measure the camera's shake against (see cameraShake.ts). */
  private previous: SmallGray | null = null;

  get locked() {
    return this.template.locked || this.points.locked;
  }

  /** Locks onto the item in `box` (frame pixels), `at` the tapped spot. False when neither way can follow it. */
  lock(f: TrackFrame, box: Rect, at?: Point): boolean {
    const t = this.template.lock(f.small, box, at);
    const p = this.points.lock(f.gray, box, at);
    this.missed = 0;
    this.last = null;
    this.by = null;
    this.previous = f.small;
    return t || p;
  }

  unlock() {
    this.template.unlock();
    this.points.unlock();
    this.missed = 0;
    this.last = null;
    this.by = null;
    this.previous = null;
  }

  track(f: TrackFrame): TrackResult | null {
    if (!this.locked) return null;
    this.lastPoints = null;
    // A shaking hand moves the whole picture: both ways look for the item where the shake put it.
    const shake = this.previous ? frameShift(this.previous, f.small) : null;
    this.previous = f.small;
    if (this.points.locked) {
      const r = this.points.track(f.gray, shake);
      if (r && r.inliers >= SURE_INLIERS && r.spread >= SURE_SPREAD) {
        this.lastPoints = r;
        if (r.inliers >= SOLID_INLIERS && r.spread >= SOLID_SPREAD && this.points.renew(f.gray, r)) this.lastPoints = null;
        const q = r.quad;
        const centre = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
        const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
        const size = { width: (len(q[0], q[1]) + len(q[3], q[2])) / 2, height: (len(q[0], q[3]) + len(q[1], q[2])) / 2 };
        this.template.place(f.small, centre, size);
        this.missed = 0;
        this.by = 'points';
        this.last = { box: r.box, point: r.point, score: r.score, quad: r.quad, size };
        return this.last;
      }
    }
    if (this.template.locked) {
      const r = this.template.track(f.small, shake);
      if (r) {
        // The template reports a weak match (below its own threshold) while it holds the last place.
        const found = r.score >= 0.45;
        this.missed = found ? 0 : this.missed + 1;
        this.by = found ? 'template' : null;
        this.last = r;
        if (this.missed < GIVE_UP) return r;
      }
    } else if (++this.missed < GIVE_UP && this.last) {
      this.by = null;
      return { ...this.last, score: 0 };
    }
    this.unlock();
    return null;
  }

  /**
   * The smart crop's exact box for the item (frame pixels). The template takes it in (see TargetTracker.refine).
   * When it confirms where the points put the item, the points may be renewed from this frame (much closer,
   * further or turned: see FeatureTracker.renew); only then, so an off estimate is never made permanent.
   * An item that had too few points when locked (far away, blurred) gets them once it shows enough.
   */
  refine(f: TrackFrame, box: Rect) {
    this.template.refine(f.small, box);
    const p = this.lastPoints;
    if (p && iou(box, p.box) > 0.6) this.points.renew(f.gray, p);
    this.lastPoints = null;
    if (!this.points.locked && this.template.locked && this.last && this.by === 'template') this.points.lock(f.gray, box, this.last.point);
  }
}

/**
 * Live camera lock: once the smart crop has found an item (a graph, a shape, an object), the camera stays on that
 * item however the phone moves (closer, further, sideways) until the user taps another item. See tracker.ts.
 *
 *  - Auto: the same item found on two frames in a row is locked onto.
 *  - Tap: whatever the smart crop picks at the tapped point is locked onto instead (at that spot of it, so a
 *    tapped curve stays the chosen curve).
 *  - Every frame: the tracker finds the item and the smart crop is pointed at it; the smart crop's exact box
 *    then sharpens the lock. The lens is asked to focus on the item as it moves (where the browser allows).
 *  - Released by Auto Crop, a hand-drawn crop box, a new picture, or when the item stays out of view (~3 s).
 */
import { useEffect, useState } from 'react';

import type { Point, Rect } from '@/imaging/geometry';
import type { LiveCapture } from '@/imaging/imageInput';
import type { Focus } from '@/imaging/smartCrop';
import { type SmallGray, smallGray, TargetTracker } from '@/imaging/tracker';
import type { PickedImage } from './useImageConversion';

const iou = (a: Rect, b: Rect) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (w * h) / (a.width * a.height + b.width * b.height - w * h);
};

/** Refocus the lens when the item moved this much (share of the frame), or at least this often. */
const REFOCUS_MOVE = 0.08;
const REFOCUS_EVERY_MS = 3000;

/** The lock's working state, outside React: the frame callback and effects both use it. */
class CameraLock {
  readonly tracker = new TargetTracker();
  private camera: LiveCapture | null = null;
  /** A tap waiting for the smart crop to say what is there. */
  private pendingTap: Point | null = null;
  /** The lock came from a tap: keep pointing at that exact spot (e.g. one curve). */
  private byTap = false;
  private previous: Rect | null = null;
  private lens = { x: -1, y: -1, at: 0 };
  /** The last frame shrunk for the tracker: follow() and onTarget() see the same frame, so it's made once. */
  private gray: { rgb: ArrayLike<number> | null; small: SmallGray | null } = { rgb: null, small: null };

  private grayOf(rgb: ArrayLike<number>, width: number, height: number): SmallGray {
    if (this.gray.rgb !== rgb || !this.gray.small) this.gray = { rgb, small: smallGray(rgb, width, height) };
    return this.gray.small!;
  }

  setCamera(camera: LiveCapture | null) {
    this.camera = camera;
  }

  /** After a frame's smart crop: lock (auto or tapped) or sharpen the lock. True when it just locked. */
  onTarget(picked: PickedImage, target: Rect): boolean {
    const gray = this.grayOf(picked.rgb, picked.raster.width, picked.raster.height);
    if (this.pendingTap) {
      const at = this.pendingTap;
      this.pendingTap = null;
      this.byTap = true;
      this.previous = target;
      return this.tracker.lock(gray, target, at);
    }
    if (this.tracker.locked) {
      this.tracker.refine(gray, target);
      return false;
    }
    const again = !!this.previous && iou(this.previous, target) > 0.6;
    this.previous = target;
    if (again && this.tracker.lock(gray, target)) {
      this.byTap = false;
      return true;
    }
    return false;
  }

  /** A camera frame: where the locked item is now (see useCameraLock's follow). */
  follow(
    rgb: ArrayLike<number>,
    width: number,
    height: number,
    /** Where a point of this picture is in the camera's view (0..1): differs when the picture is a flattened page. */
    toLens: (p: Point) => Point = (p) => ({ x: p.x / width, y: p.y / height }),
  ): { focus: Focus; width: number } | null | undefined {
    if (!this.tracker.locked) return undefined;
    const r = this.tracker.track(this.grayOf(rgb, width, height));
    if (!r) {
      this.previous = null;
      return null;
    }
    // Keep the lens on the item as it moves.
    const now = Date.now();
    const { x: nx, y: ny } = toLens(r.point);
    if (this.camera && (Math.hypot(nx - this.lens.x, ny - this.lens.y) > REFOCUS_MOVE || now - this.lens.at > REFOCUS_EVERY_MS)) {
      this.lens = { x: nx, y: ny, at: now };
      this.camera.focusAt(nx, ny).catch(() => {});
    }
    return { focus: { ...r.point, tap: this.byTap }, width: r.box.width };
  }

  tap(point: Point) {
    this.tracker.unlock();
    this.pendingTap = point;
  }

  release() {
    this.tracker.unlock();
    this.pendingTap = null;
    this.previous = null;
    this.byTap = false;
  }
}

export function useCameraLock(live: LiveCapture | null) {
  const [session] = useState(() => new CameraLock());
  const [locked, setLocked] = useState(false);
  /** The locked item's width in the last frame (frame pixels). */
  const [width, setWidth] = useState<number | null>(null);
  const camera = live?.kind === 'camera' ? live : null;
  useEffect(() => {
    session.setCamera(camera);
  }, [session, camera]);

  return {
    /** For useLockTarget. */
    session,
    setLocked,
    camera,
    locked: !!camera && locked,
    /** The locked item's width now (frame pixels): how close the camera is to it. */
    width: camera && locked ? width : null,
    /**
     * Each camera frame, before it is shown: where the locked item is now, as the point the smart crop should
     * focus on. `undefined`: nothing locked, leave the focus alone; `null`: the lock was just lost.
     */
    follow: (rgb: ArrayLike<number>, w: number, h: number, toLens?: (p: Point) => Point): Focus | null | undefined => {
      const r = session.follow(rgb, w, h, toLens);
      if (r === undefined) return undefined;
      if (r === null) {
        setLocked(false);
        setWidth(null);
        return null;
      }
      setWidth(r.width);
      return r.focus;
    },
    /** A tap: lock onto whatever the smart crop finds there. */
    tap: (point: Point) => session.tap(point),
    /** Lets go (Auto Crop, a hand-drawn crop box, a new picture). */
    release: () => {
      session.release();
      setLocked(false);
      setWidth(null);
    },
  };
}

/**
 * After each frame's smart crop (call after useImageConversion): locks onto the item it picked (auto, or the
 * tapped one), or sharpens the lock with its exact box.
 */
export function useLockTarget(lock: ReturnType<typeof useCameraLock>, picked: PickedImage | null, target: Rect | null) {
  const { session, camera, setLocked } = lock;
  useEffect(() => {
    if (camera && picked && target && session.onTarget(picked, target)) setLocked(true);
  }, [session, camera, picked, target, setLocked]);
}

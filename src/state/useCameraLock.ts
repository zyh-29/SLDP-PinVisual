/**
 * Live camera lock: once the smart crop has found an item (a graph, a shape, an object), the camera stays on that
 * item however the phone moves (closer, further, sideways, turned or tilted) until the user taps another item.
 * See itemTracker.ts (by the item's distinctive points, with template matching as the fallback).
 *
 *  - Auto: the same item found in two of the last three frames is locked onto. "The same" allows for a shaking
 *    hand: each earlier box is first moved by how far the whole picture jumped since (cameraShake.ts), and one
 *    frame that picked something else (a blurred one) doesn't start the count again.
 *  - Tap: whatever the smart crop picks at the tapped point is locked onto instead (at that spot of it, so a
 *    tapped curve stays the chosen curve). On the first frame taken after the tap: the live view shows the camera
 *    now, the frame being analysed is a moment older, and with a shaking hand the tapped spot has moved on in it.
 *  - Every frame: the tracker finds the item and the smart crop is pointed at it; the smart crop's exact box
 *    then sharpens the lock. The lens is asked to focus on the item as it moves (where the browser allows).
 *  - Released by Auto Crop, a hand-drawn crop box, a new picture, or when the item stays out of view (~3 s).
 */
import { useEffect, useState } from 'react';

import { frameShift, shifted } from '@/imaging/cameraShake';
import { iou, type Point, type Rect } from '@/imaging/geometry';
import type { LiveCapture } from '@/imaging/imageInput';
import type { Focus } from '@/imaging/smartCrop';
import { ItemTracker, type TrackFrame, trackFrame } from '@/imaging/itemTracker';
import type { SmallGray } from '@/imaging/tracker';
import type { PickedImage } from './useImageConversion';

/** Refocus the lens when the item moved this much (share of the frame), or at least this often. */
const REFOCUS_MOVE = 0.08;
const REFOCUS_EVERY_MS = 3000;

/** Earlier frames an item must have been seen in (one of them) to lock on automatically. */
const AGREE_WITHIN = 2;

/** The lock's working state, outside React: the frame callback and effects both use it. Exported for tests. */
export class CameraLock {
  readonly tracker = new ItemTracker();
  private camera: LiveCapture | null = null;
  /** A tap waiting for the smart crop to say what is there. */
  private pendingTap: Point | null = null;
  /** The frame on screen when the tap came: the tap is for a newer one (see the top of this file). */
  private tapFrame: ArrayLike<number> | null = null;
  /** The lock came from a tap: keep pointing at that exact spot (e.g. one curve). */
  private byTap = false;
  /** What the smart crop picked in the last few frames (not locked), and those frames, newest last. */
  private recent: { box: Rect; frame: SmallGray }[] = [];
  private lens = { x: -1, y: -1, at: 0 };
  /** The last frame prepared for the tracker: follow() and onTarget() see the same frame, so it's made once. */
  private gray: { rgb: ArrayLike<number> | null; frame: TrackFrame | null } = { rgb: null, frame: null };

  private grayOf(rgb: ArrayLike<number>, width: number, height: number): TrackFrame {
    if (this.gray.rgb !== rgb || !this.gray.frame) this.gray = { rgb, frame: trackFrame(rgb, width, height) };
    return this.gray.frame!;
  }

  setCamera(camera: LiveCapture | null) {
    this.camera = camera;
  }

  /** After a frame's smart crop: lock (auto or tapped) or sharpen the lock. True when it just locked. */
  onTarget(picked: PickedImage, target: Rect): boolean {
    const gray = this.grayOf(picked.rgb, picked.raster.width, picked.raster.height);
    if (this.pendingTap) {
      if (picked.rgb === this.tapFrame) return false;
      const at = this.pendingTap;
      this.pendingTap = null;
      this.tapFrame = null;
      this.byTap = true;
      this.recent = [];
      return this.tracker.lock(gray, target, at);
    }
    if (this.tracker.locked) {
      this.tracker.refine(gray, target);
      return false;
    }
    // Seen before, once the camera's shake since then is taken out?
    const again = this.recent.some((r) => r.frame !== gray.small && iou(shifted(r.box, frameShift(r.frame, gray.small)), target) > 0.6);
    this.recent = [...this.recent.filter((r) => r.frame !== gray.small), { box: target, frame: gray.small }].slice(-AGREE_WITHIN);
    if (again && this.tracker.lock(gray, target)) {
      this.byTap = false;
      this.recent = [];
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
  ): { focus: Focus; box: Rect; width: number } | null | undefined {
    if (!this.tracker.locked) return undefined;
    const r = this.tracker.track(this.grayOf(rgb, width, height));
    if (!r) {
      this.recent = [];
      return null;
    }
    // Keep the lens on the item as it moves.
    const now = Date.now();
    const { x: nx, y: ny } = toLens(r.point);
    if (this.camera && (Math.hypot(nx - this.lens.x, ny - this.lens.y) > REFOCUS_MOVE || now - this.lens.at > REFOCUS_EVERY_MS)) {
      this.lens = { x: nx, y: ny, at: now };
      this.camera.focusAt(nx, ny).catch(() => {});
    }
    return { focus: { ...r.point, tap: this.byTap }, box: r.box, width: r.size.width };
  }

  /** `onScreen`: the frame being shown when the tap came (the lock is made on a newer one). */
  tap(point: Point, onScreen: ArrayLike<number> | null = null) {
    this.tracker.unlock();
    this.pendingTap = point;
    this.tapFrame = onScreen;
  }

  release() {
    this.tracker.unlock();
    this.pendingTap = null;
    this.tapFrame = null;
    this.recent = [];
    this.byTap = false;
  }
}

export function useCameraLock(live: LiveCapture | null) {
  const [session] = useState(() => new CameraLock());
  const [locked, setLocked] = useState(false);
  /** Where the locked item is in the last frame (picture pixels), and its own width (not turned). */
  const [box, setBox] = useState<Rect | null>(null);
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
    width: camera && locked && box ? width : null,
    /** Where the locked item is now: the smart crop only needs to look around it. */
    box: camera && locked ? box : null,
    /**
     * Each camera frame, before it is shown: where the locked item is now, as the point the smart crop should
     * focus on. `undefined`: nothing locked, leave the focus alone; `null`: the lock was just lost.
     */
    follow: (rgb: ArrayLike<number>, w: number, h: number, toLens?: (p: Point) => Point): Focus | null | undefined => {
      const r = session.follow(rgb, w, h, toLens);
      if (r === undefined) return undefined;
      if (r === null) {
        setLocked(false);
        setBox(null);
        return null;
      }
      setBox(r.box);
      setWidth(r.width);
      return r.focus;
    },
    /** A tap: lock onto whatever the smart crop finds there (searching the whole picture again until then). */
    tap: (point: Point, onScreen: ArrayLike<number> | null = null) => {
      session.tap(point, onScreen);
      setLocked(false);
      setBox(null);
    },
    /** Lets go (Auto Crop, a hand-drawn crop box, a new picture). */
    release: () => {
      session.release();
      setLocked(false);
      setBox(null);
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

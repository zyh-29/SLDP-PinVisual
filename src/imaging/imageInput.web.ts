/**
 * Browser-only ways to bring in an image: drag and drop and paste (imageDrop.web.ts), live screen sharing
 * (getDisplayMedia) and the live camera (getUserMedia; the camera itself in cameraDevice.web.ts). The phone app
 * versions are in imageInput.ts.
 */
import { denoiseFrame, FocusGate, frameLight, LightGate, sharpness } from './cameraFrame';
import type { RasterImage } from './convert';
import { flatten, type Quad, SurfaceWatch, type SurfaceView } from './surface';
import { cameraError, focusCameraAt, openCamera, tuneCamera } from './cameraDevice.web';

export interface ImageSource {
  uri: string;
  width?: number;
  height?: number;
}

/** Dropping files needs a mouse or trackpad; phones and tablets can't drag files into a browser. */
export const supportsFileDrop = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

/** Desktop Chrome, Edge, Firefox and Safari. Not available in any mobile browser. */
export const supportsScreenCapture =
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && supportsFileDrop;

/**
 * A live camera: phones (Chrome on Android, Safari and Chrome on iPhone) and laptops with a webcam. Browsers
 * only allow it on https:// pages (or localhost), which is why it needs `isSecureContext`.
 */
export const supportsCamera =
  typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';

export { imageUrlFromDrop, useImageDrop } from './imageDrop.web';

export type LiveSource = 'screen' | 'camera';
export type CameraFacing = 'environment' | 'user';

/** What a screen share shows: the entire screen, one window, or a browser tab. */
export type SharedSurface = 'screen' | 'window' | 'tab';

export interface LiveCapture {
  kind: LiveSource;
  /**
   * Screen sharing: what was picked, when the browser says (Safari doesn't). The entire screen usually shows
   * PinVisual itself, which confuses the smart crop: the screen warns about it.
   */
  shared?: SharedSurface;
  /**
   * The one video element that both feeds processing and is shown behind the
   * crop box. Reusing it matters: a shared window only sends a new frame when
   * something on it changes, so a second <video> attached later would stay
   * black until then.
   */
  video: HTMLVideoElement;
  /** Stops sharing (or the camera). Safe to call more than once. */
  stop: () => void;
  /** Camera only: the device has more than one camera (front and back), so flip() can switch. */
  canFlip: boolean;
  /** Camera only: which camera is in use. */
  facing?: CameraFacing;
  /** Camera only: switches between the back and front camera, keeping the same video element. */
  flip: () => Promise<void>;
  /**
   * Camera only: the current picture as a still photo (an object URL to load like any picked image), taken from
   * the camera's full picture, shrunk to the photo working size and denoised like live frames.
   */
  snapshot: () => Promise<string>;
  /**
   * How long the app took to analyse the last frame (ms, on the main thread). The capture paces itself to it:
   * longer gaps between frames on slow phones, so the video and touches stay smooth.
   */
  reportCost: (ms: number) => void;
  /**
   * Camera only: focus (and exposure) on this point of the picture, 0..1 across and down. False where the
   * browser gives no focus control (iPhones and most laptops focus by themselves).
   */
  focusAt: (x: number, y: number) => Promise<boolean>;
}

/** The size picked photos are analysed at (loadImage.web.ts): a capture is taken at that size, so nothing is lost. */
const SNAPSHOT_SIZE = 800;
/** A capture of a screen or page is taken from a picture this large, then flattened. */
const SNAPSHOT_SURFACE_SIZE = 1600;
/** Frames a capture chooses the sharpest from (about half a second)... */
const SNAPSHOT_TRIES = 6;
/** ...or, while none is as sharp as the live view recently was, up to this many (about 2 s). */
const SNAPSHOT_MAX_TRIES = 16;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves on the video's next new frame (or after 80 ms where the browser can't say), at least 60 ms apart. */
function nextFrame(video: FrameCallbackVideo): Promise<void> {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 60);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(done);
    else setTimeout(resolve, 80);
  });
}

/**
 * Longest side of frames. A shared screen: 800, for thin lines and small text. A camera: 640, because a phone
 * runs the whole conversion on every frame, and a camera picture has less fine detail anyway.
 */
const WORKING_SIZE: Record<LiveSource, number> = { screen: 800, camera: 640 };
/** A flat surface in view is read from the full-resolution video at up to this size across... */
const HI_SIZE = 1000;
/** ...and flattened into a page of at most this size: graphs on a screen need the detail. */
const PAGE_SIZE = 800;
/** The share of the main thread the analysis may use (see reportCost); the rest shows the video and takes touches. */
const MAX_BUSY = 0.45;
/** Shortest time between processed frames. A camera changes on every frame (noise), so it is paced a bit slower. */
const MIN_INTERVAL: Record<LiveSource, number> = { screen: 200, camera: 250 };

/**
 * What screen sharing asks the browser for. Sharing the entire screen usually shows PinVisual too, and the app
 * then sees its own preview and pins (a loop) or a window covering half the graph. So: "Window" first in the picker
 * (displaySurface), PinVisual's own tab left out (selfBrowserSurface), and the entire screen offered last
 * (monitorTypeSurfaces). Chrome and Edge follow these hints; other browsers ignore them, hence the warning when
 * the entire screen is shared anyway (LiveCapture.shared).
 */
const SHARE_OPTIONS = {
  video: { frameRate: 30, displaySurface: 'window' },
  audio: false,
  selfBrowserSurface: 'exclude',
  monitorTypeSurfaces: 'exclude',
} as DisplayMediaStreamOptions;

/** What was shared, as the browser reports it (Chrome, Edge, Firefox; Safari says nothing). */
function sharedSurface(stream: MediaStream): SharedSurface | undefined {
  const s = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  return s === 'monitor' ? 'screen' : s === 'window' ? 'window' : s === 'browser' ? 'tab' : undefined;
}

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/**
 * Starts a live source and keeps it running: `screen` asks the browser to
 * share a screen, window or tab; `camera` opens the camera (the back one on
 * phones). Each new frame is processed as soon as it arrives (at most every
 * `minIntervalMs`, with the latest frame always processed last), and only
 * when the picture changed. Camera frames are denoised first (see
 * cameraFrame.ts). `onEnd` runs when the source stops from the browser's own
 * controls. Returns null if the user cancels the screen picker.
 */
export async function startLiveCapture(o: {
  source?: LiveSource;
  /**
   * Each new frame. Camera, looking at a flat surface (a screen, a page): `frame` is that surface flattened (as
   * if scanned) and `surface` maps between it and the camera picture; otherwise `surface` is undefined.
   */
  onFrame: (frame: RasterImage, surface?: SurfaceView) => void;
  onEnd: () => void;
  /** Camera only: how many frames in a row were blurry (0 = in focus), after each frame. */
  onFocus?: (blurryFor: number) => void;
  /** Camera only: whether the picture is too dark to see anything (a covered lens, a dark room). */
  onDark?: (dark: boolean) => void;
  minIntervalMs?: number;
}): Promise<LiveCapture | null> {
  const kind = o.source ?? 'screen';
  const gate = new FocusGate();
  const light = new LightGate();
  /** A frame has been passed on (the camera view is up). */
  let delivered = false;
  const surfaces = new SurfaceWatch();
  /** The surface in view at the last frame, with the frame width its corners are measured in (for Capture). */
  let lastSurface: { quad: Quad; aspect: number; frameWidth: number } | null = null;
  /** For reading the surface's area from the full-resolution video. */
  const hiCanvas = document.createElement('canvas');
  const hiCtx = hiCanvas.getContext('2d', { willReadFrequently: true });
  /** Where the user last asked the camera to focus (0..1), kept across refocusing and capture. */
  let focusPoint: { x: number; y: number } | null = null;
  let facing: CameraFacing = 'environment';
  let stream: MediaStream;
  try {
    stream =
      kind === 'camera'
        ? await openCamera(facing)
        : await navigator.mediaDevices.getDisplayMedia(SHARE_OPTIONS);
  } catch (e) {
    if (kind === 'camera') throw cameraError(e);
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return null;
    throw e;
  }
  if (kind === 'camera') {
    await tuneCamera(stream);
    facing = (stream.getVideoTracks()[0]?.getSettings().facingMode as CameraFacing | undefined) ?? facing;
  }
  // Labels and device lists are only complete once the camera is allowed.
  const cameras =
    kind === 'camera' ? (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput').length : 0;
  const baseInterval = o.minIntervalMs ?? MIN_INTERVAL[kind];
  // Paced to the device: each frame's analysis runs on the page's main thread, which also shows the video and
  // handles touches. A slow phone (many Androids) is given longer between frames, so the main thread is never
  // busy more than about 45% of the time; a fast one (iPhones, laptops) keeps the full rate. (Frames stay
  // 640 px: smaller ones lose thin curves and gridlines, and the pins become unsteady.)
  let minInterval = baseInterval;
  const workingSize = WORKING_SIZE[kind];
  let cost = 0;
  /** The capture's own share of the last frame (drawing it, cleaning it, the app's frame callback), ms. */
  let prep = 0;
  const video: FrameCallbackVideo = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  Object.assign(video.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    objectFit: 'fill',
    pointerEvents: 'none',
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let lastSignature = -1;
  let lastRun = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  // Phones pause the video when the browser goes to the background; start it again on return.
  const resume = () => {
    if (!stopped && document.visibilityState === 'visible') video.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', resume);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(trailing);
    clearInterval(poll);
    document.removeEventListener('visibilitychange', resume);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const process = () => {
    if (stopped) return;
    lastRun = performance.now();
    try {
      processFrame();
    } finally {
      prep = performance.now() - lastRun;
    }
  };

  const processFrame = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!ctx || !vw || !vh) return;
    const scale = Math.min(1, workingSize / Math.max(vw, vh));
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    // Cheap change check, so a still screen costs nothing.
    let signature = width * 31 + height;
    for (let i = 0; i < data.length; i += 61) signature = (signature * 33 + data[i]) | 0;
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (kind === 'camera') {
        // Too dark, or the exposure still settling after the light changed: nothing worth the (costly) analysis.
        // Phones amplify a dark picture into noise, and the first frames after the light comes back are blown out.
        // (The very first frame is always shown, so the camera view appears even when it starts in the dark.)
        const lit = light.accept(frameLight(data, width, height));
        o.onDark?.(light.dark);
        if (!lit && delivered) return;
        // While the camera refocuses (or the hand moves), frames smear: keep the last sharp result on the pins.
        const use = gate.accept(sharpness(data, width, height));
        o.onFocus?.(gate.blurryFor);
        if (!use) return;
        denoiseFrame(data, width, height);
        const page = flattenSurface(data, width, height, vw, vh);
        if (page) {
          delivered = true;
          o.onFrame(page.frame, page.surface);
          return;
        }
      }
      delivered = true;
      o.onFrame({ width, height, data, channels: 4 });
    }
  };

  /**
   * A flat surface in view (a screen, a page): flattened from the full-resolution video, so a thin curve on a
   * laptop screen keeps the detail the 640 px frame loses. Null when there's none.
   */
  const flattenSurface = (data: Uint8ClampedArray, width: number, height: number, vw: number, vh: number) => {
    const rgb = new Uint8ClampedArray(width * height * 3);
    for (let p = 0; p < width * height; p++) {
      rgb[p * 3] = data[p * 4];
      rgb[p * 3 + 1] = data[p * 4 + 1];
      rgb[p * 3 + 2] = data[p * 4 + 2];
    }
    const found = surfaces.update(rgb, width, height);
    lastSurface = found ? { quad: found.quad, aspect: found.aspect, frameWidth: width } : null;
    if (!found || !hiCtx) return null;
    // The surface's area in the video, read at up to 1000 px across (enough detail, bounded cost).
    const k = vw / width;
    const xs = found.quad.map((p) => p.x * k);
    const ys = found.quad.map((p) => p.y * k);
    const bx = Math.max(0, Math.floor(Math.min(...xs)));
    const by = Math.max(0, Math.floor(Math.min(...ys)));
    const bw = Math.min(vw, Math.ceil(Math.max(...xs))) - bx;
    const bh = Math.min(vh, Math.ceil(Math.max(...ys))) - by;
    if (bw < 16 || bh < 16) return null;
    const r = Math.min(1, HI_SIZE / Math.max(bw, bh));
    const hw = Math.max(1, Math.round(bw * r));
    const hh = Math.max(1, Math.round(bh * r));
    if (hiCanvas.width !== hw || hiCanvas.height !== hh) {
      hiCanvas.width = hw;
      hiCanvas.height = hh;
    }
    hiCtx.drawImage(video, bx, by, bw, bh, 0, 0, hw, hh);
    const hi = hiCtx.getImageData(0, 0, hw, hh).data;
    denoiseFrame(hi, hw, hh);
    const hiRgb = new Uint8ClampedArray(hw * hh * 3);
    for (let p = 0; p < hw * hh; p++) {
      hiRgb[p * 3] = hi[p * 4];
      hiRgb[p * 3 + 1] = hi[p * 4 + 1];
      hiRgb[p * 3 + 2] = hi[p * 4 + 2];
    }
    // Frame pixel -> pixel of the area read, and back.
    const toHi = (p: { x: number; y: number }) => ({ x: (p.x * k - bx) * r, y: (p.y * k - by) * r });
    const fromHi = (p: { x: number; y: number }) => ({ x: (p.x / r + bx) / k, y: (p.y / r + by) / k });
    const page = flatten(hiRgb, hw, hh, { ...found, quad: found.quad.map(toHi) as Quad }, PAGE_SIZE);
    const surface: SurfaceView = {
      frameWidth: width,
      frameHeight: height,
      quad: found.quad,
      toFrame: (p) => fromHi(page.toPicture(p)),
      toPage: (p) => page.toPage(toHi(p)),
    };
    return { frame: { width: page.width, height: page.height, data: page.rgb, channels: 3 as const }, surface };
  };

  /** A new frame arrived: process now, or once the minimum interval has passed (so the latest frame is never skipped). */
  const onNewFrame = () => {
    if (stopped) return;
    const wait = minInterval - (performance.now() - lastRun);
    clearTimeout(trailing);
    if (wait <= 0) process();
    else trailing = setTimeout(process, wait);
  };

  /** The browser's own controls (or the system) ended the track. */
  const ended = () => {
    stop();
    o.onEnd();
  };
  stream.getVideoTracks()[0]?.addEventListener('ended', ended);

  const capture: LiveCapture = {
    kind,
    shared: kind === 'screen' ? sharedSurface(stream) : undefined,
    video,
    stop,
    canFlip: cameras > 1,
    facing: kind === 'camera' ? facing : undefined,
    flip: async () => {
      if (kind !== 'camera' || stopped) return;
      const want: CameraFacing = facing === 'environment' ? 'user' : 'environment';
      // Phones can't open both cameras at once: release this one first.
      stream.getVideoTracks()[0]?.removeEventListener('ended', ended);
      stream.getTracks().forEach((t) => t.stop());
      try {
        stream = await openCamera(want);
      } catch (e) {
        stream = await openCamera(facing).catch(() => {
          throw cameraError(e);
        });
      }
      await tuneCamera(stream);
      facing = (stream.getVideoTracks()[0]?.getSettings().facingMode as CameraFacing | undefined) ?? want;
      capture.facing = facing;
      stream.getVideoTracks()[0]?.addEventListener('ended', ended);
      video.srcObject = stream;
      lastSignature = -1;
      gate.reset();
      light.reset();
      surfaces.reset();
      focusPoint = null;
      await video.play().catch(() => {});
    },
    reportCost: (ms) => {
      if (stopped || !(ms > 0)) return;
      const total = ms + prep;
      // A costlier frame counts at once (the light came back and there's suddenly a screen to straighten and
      // a graph to read: waiting for an average to catch up would leave frames back to back and the video stuck);
      // cheaper ones bring it down gradually.
      cost = total > cost ? total : 0.7 * cost + 0.3 * total;
      // Started every cost / 0.45 ms, the main thread is busy at most 45% of the time.
      minInterval = Math.max(baseInterval, Math.min(1500, cost / MAX_BUSY));
    },
    focusAt: async (x, y) => {
      if (kind !== 'camera' || stopped) return false;
      focusPoint = { x, y };
      return focusCameraAt(stream, x, y);
    },
    snapshot: async () => {
      if (stopped || !video.videoWidth || !video.videoHeight) throw new Error('The camera has no picture yet.');
      // Focus once more where the user tapped (or the middle), give the lens a moment, then keep the sharpest of
      // the next few frames: one taken mid-refocus or mid-shake would be blurred.
      if (await focusCameraAt(stream, focusPoint?.x ?? 0.5, focusPoint?.y ?? 0.5)) await wait(450);
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // On a screen or page: the full picture, so the flattened page keeps its detail.
      const surface = lastSurface;
      const scale = Math.min(1, (surface ? SNAPSHOT_SURFACE_SIZE : SNAPSHOT_SIZE) / Math.max(vw, vh));
      const shot = document.createElement('canvas');
      shot.width = Math.max(1, Math.round(vw * scale));
      shot.height = Math.max(1, Math.round(vh * scale));
      const sctx = shot.getContext('2d', { willReadFrequently: true });
      if (!sctx) throw new Error('Canvas is not available in this browser.');
      sctx.imageSmoothingQuality = 'high';
      let img: ImageData | null = null;
      let best = -1;
      // "Sharp" is what the live view recently reached (same measure, scaled from 640 to 800 px frames is close
      // enough). Keep looking, up to about 2 s, until a frame gets near it: a lens still hunting gets a moment more.
      const target = gate.recentBest * 0.7;
      for (let i = 0; i < SNAPSHOT_MAX_TRIES && !stopped; i++) {
        if (i) await nextFrame(video);
        sctx.drawImage(video, 0, 0, shot.width, shot.height);
        const frame = sctx.getImageData(0, 0, shot.width, shot.height);
        const s = sharpness(frame.data, shot.width, shot.height);
        if (s > best) {
          best = s;
          img = frame;
        }
        if (i + 1 >= SNAPSHOT_TRIES && best >= target) break;
      }
      if (!img) throw new Error('The camera has no picture yet.');
      // Denoised like the live frames, so a photographed graph is still found as a graph.
      denoiseFrame(img.data, shot.width, shot.height);
      sctx.putImageData(img, 0, 0);
      if (surface) {
        // The photo is the surface flattened, as the live view analysed it.
        const rgb = new Uint8ClampedArray(shot.width * shot.height * 3);
        for (let p = 0; p < shot.width * shot.height; p++) {
          rgb[p * 3] = img.data[p * 4];
          rgb[p * 3 + 1] = img.data[p * 4 + 1];
          rgb[p * 3 + 2] = img.data[p * 4 + 2];
        }
        const f = shot.width / surface.frameWidth;
        const page = flatten(rgb, shot.width, shot.height, { ...surface, fill: 1, quad: surface.quad.map((q) => ({ x: q.x * f, y: q.y * f })) as Quad }, SNAPSHOT_SIZE);
        const out = new ImageData(page.width, page.height);
        for (let p = 0; p < page.width * page.height; p++) {
          out.data[p * 4] = page.rgb[p * 3];
          out.data[p * 4 + 1] = page.rgb[p * 3 + 1];
          out.data[p * 4 + 2] = page.rgb[p * 3 + 2];
          out.data[p * 4 + 3] = 255;
        }
        shot.width = page.width;
        shot.height = page.height;
        sctx.putImageData(out, 0, 0);
      }
      // PNG: lossless, so the cleaned pixels arrive exactly as they are.
      const blob = await new Promise<Blob | null>((resolve) => shot.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not capture the picture.');
      return URL.createObjectURL(blob);
    },
  };

  if (video.requestVideoFrameCallback) {
    // Chrome, Edge, Safari, recent Firefox: called exactly when a new frame is shown.
    const loop = () => {
      if (stopped) return;
      onNewFrame();
      video.requestVideoFrameCallback!(loop);
    };
    video.requestVideoFrameCallback(loop);
  } else {
    poll = setInterval(onNewFrame, baseInterval);
  }
  // The first frame: process it the moment it is decoded.
  video.addEventListener('loadeddata', onNewFrame, { once: true });

  try {
    await video.play();
  } catch (e) {
    stop();
    throw e;
  }
  return capture;
}

/**
 * Browser-only ways to bring in an image: drag and drop, paste, live screen
 * sharing (getDisplayMedia) and the live camera (getUserMedia). The phone
 * app versions are in imageInput.ts.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { denoiseFrame } from './cameraFrame';
import type { RasterImage } from './convert';

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

const imageFile = (files: FileList | null | undefined) => Array.from(files ?? []).find((f) => f.type.startsWith('image/'));

/**
 * What a drag can carry. From Finder or the desktop: a file. From a web page (Google Images, another tab):
 * no file at all, only a link (text/uri-list) and the <img> tag (text/html). Both must be accepted, or the
 * browser never even delivers the drop to the page.
 */
const carriesImage = (e: DragEvent) => {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
};

/** The image address in a drag from a web page: the <img src> from the HTML, else the first link. */
export function imageUrlFromDrop(html: string, uriList: string): string | null {
  const src = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  if (src) return src.replace(/&amp;/g, '&');
  const link = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return link ?? null;
}

/** Fetches a dropped image address into a local object URL. Fails when the site doesn't allow its images to be used elsewhere (CORS). */
async function loadDroppedUrl(url: string): Promise<string> {
  if (url.startsWith('data:image/') || url.startsWith('blob:')) return url;
  if (!/^https?:/i.test(url)) throw new Error("That isn't an image.");
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors' });
  } catch {
    throw new Error(
      "That website doesn't let other pages use its images. Right-click the image, choose Copy Image, then press Cmd+V (Ctrl+V) here.",
    );
  }
  if (!response.ok) throw new Error(`Couldn't download that image (error ${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error("That link isn't an image.");
  return URL.createObjectURL(blob);
}

/**
 * While the screen is focused: accepts an image dropped anywhere on the page (a file, or an image dragged
 * from another web page) or pasted with Cmd/Ctrl+V. Returns true while something is dragged over the page.
 */
export function useImageDrop(onImage: (source: ImageSource) => void, onError?: (message: string) => void): boolean {
  const [over, setOver] = useState(false);
  // Listeners are attached once per focus; they call the latest callbacks through these refs.
  const latest = useRef(onImage);
  const latestError = useRef(onError);
  useEffect(() => {
    latest.current = onImage;
    latestError.current = onError;
  });
  useFocusEffect(
    useCallback(() => {
      let depth = 0;
      const deliver = (file: File | undefined) => {
        if (file) latest.current({ uri: URL.createObjectURL(file) });
      };
      const fail = (message: string) => latestError.current?.(message);
      const enter = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        depth++;
        setOver(true);
      };
      const overHandler = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      };
      const leave = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) setOver(false);
      };
      const drop = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        depth = 0;
        setOver(false);
        const dt = e.dataTransfer;
        const files = Array.from(dt?.files ?? []);
        const file = imageFile(dt?.files);
        if (file) return deliver(file);
        if (files.length) return fail("That file isn't an image.");
        // Dragged from a web page: only a link and the <img> tag arrive.
        const url = imageUrlFromDrop(dt?.getData('text/html') ?? '', dt?.getData('text/uri-list') ?? '');
        if (!url) return fail("That isn't an image.");
        loadDroppedUrl(url).then(
          (uri) => latest.current({ uri }),
          (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
        );
      };
      const paste = (e: ClipboardEvent) => {
        const file = imageFile(e.clipboardData?.files);
        if (!file) return;
        e.preventDefault();
        deliver(file);
      };
      window.addEventListener('dragenter', enter);
      window.addEventListener('dragover', overHandler);
      window.addEventListener('dragleave', leave);
      window.addEventListener('drop', drop);
      window.addEventListener('paste', paste);
      return () => {
        window.removeEventListener('dragenter', enter);
        window.removeEventListener('dragover', overHandler);
        window.removeEventListener('dragleave', leave);
        window.removeEventListener('drop', drop);
        window.removeEventListener('paste', paste);
        setOver(false);
      };
    }, []),
  );
  return over;
}

export type LiveSource = 'screen' | 'camera';
export type CameraFacing = 'environment' | 'user';

export interface LiveCapture {
  kind: LiveSource;
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
}

/** The size picked photos are analysed at (loadImage.web.ts): a capture is taken at that size, so nothing is lost. */
const SNAPSHOT_SIZE = 800;

/**
 * Longest side of frames. A shared screen: 800, for thin lines and small text. A camera: 640, because a phone
 * runs the whole conversion on every frame, and a camera picture has less fine detail anyway.
 */
const WORKING_SIZE: Record<LiveSource, number> = { screen: 800, camera: 640 };
/** Shortest time between processed frames. A camera changes on every frame (noise), so it is paced a bit slower. */
const MIN_INTERVAL: Record<LiveSource, number> = { screen: 200, camera: 250 };

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/** A readable message for a camera that couldn't start (or null when the user just said no to a picker). */
function cameraError(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new Error('Camera access is blocked. Allow the camera for this site (the icon next to the address), then try again.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No camera was found on this device.');
  if (name === 'NotReadableError' || name === 'AbortError')
    return new Error('The camera is busy. Close other apps or tabs using it, then try again.');
  return e instanceof Error ? e : new Error(String(e));
}

async function openCamera(facing: CameraFacing): Promise<MediaStream> {
  // 1280 x 720 is plenty (frames are shrunk to 640 anyway) and every phone camera offers it.
  const video: MediaTrackConstraints = { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    // Some laptops reject the size or facing hints: any camera will do.
    if (e instanceof DOMException && e.name === 'OverconstrainedError')
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    throw e;
  }
}

/** Keeps the camera focusing by itself where the browser allows it (Chrome on Android). */
async function tuneCamera(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
  if (caps.focusMode?.includes('continuous'))
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
}

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
  onFrame: (frame: RasterImage) => void;
  onEnd: () => void;
  minIntervalMs?: number;
}): Promise<LiveCapture | null> {
  const kind = o.source ?? 'screen';
  let facing: CameraFacing = 'environment';
  let stream: MediaStream;
  try {
    stream =
      kind === 'camera'
        ? await openCamera(facing)
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
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
  const minInterval = o.minIntervalMs ?? MIN_INTERVAL[kind];
  const workingSize = WORKING_SIZE[kind];
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
      if (kind === 'camera') denoiseFrame(data, width, height);
      o.onFrame({ width, height, data, channels: 4 });
    }
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
      await video.play().catch(() => {});
    },
    snapshot: async () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (stopped || !vw || !vh) throw new Error('The camera has no picture yet.');
      const scale = Math.min(1, SNAPSHOT_SIZE / Math.max(vw, vh));
      const shot = document.createElement('canvas');
      shot.width = Math.max(1, Math.round(vw * scale));
      shot.height = Math.max(1, Math.round(vh * scale));
      const sctx = shot.getContext('2d', { willReadFrequently: true });
      if (!sctx) throw new Error('Canvas is not available in this browser.');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(video, 0, 0, shot.width, shot.height);
      // Denoised like the live frames, so a photographed graph is still found as a graph.
      const img = sctx.getImageData(0, 0, shot.width, shot.height);
      denoiseFrame(img.data, shot.width, shot.height);
      sctx.putImageData(img, 0, 0);
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
    poll = setInterval(onNewFrame, minInterval);
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

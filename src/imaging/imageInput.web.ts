/**
 * Browser-only ways to bring in an image: drag and drop, paste, and live
 * screen sharing (getDisplayMedia). The phone versions are in imageInput.ts.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

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

const imageFile = (files: FileList | null | undefined) => Array.from(files ?? []).find((f) => f.type.startsWith('image/'));
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * While the screen is focused: accepts an image dropped anywhere on the page
 * or pasted with Cmd/Ctrl+V. Returns true while a file is dragged over the page.
 */
export function useImageDrop(onImage: (source: ImageSource) => void): boolean {
  const [over, setOver] = useState(false);
  // Listeners are attached once per focus; they call the latest callback through this ref.
  const latest = useRef(onImage);
  useEffect(() => {
    latest.current = onImage;
  });
  useFocusEffect(
    useCallback(() => {
      let depth = 0;
      const deliver = (file: File | undefined) => {
        if (file) latest.current({ uri: URL.createObjectURL(file) });
      };
      const enter = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth++;
        setOver(true);
      };
      const overHandler = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      };
      const leave = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) setOver(false);
      };
      const drop = (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        setOver(false);
        deliver(imageFile(e.dataTransfer?.files));
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

export interface LiveCapture {
  stream: MediaStream;
  /**
   * The one video element that both feeds processing and is shown behind the
   * crop box. Reusing it matters: a shared window only sends a new frame when
   * something on it changes, so a second <video> attached later would stay
   * black until then.
   */
  video: HTMLVideoElement;
  /** Stops sharing. Safe to call more than once. */
  stop: () => void;
}

/** Longest side of frames taken from a shared screen. Higher than photos: screens have thin lines and small text. */
const LIVE_WORKING_SIZE = 800;

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/**
 * Asks the browser to share a screen, window or tab and keeps sharing.
 * Each new frame is processed as soon as it arrives (at most every
 * `minIntervalMs`, with the latest frame always processed last), and only
 * when the picture changed. `onEnd` runs when sharing stops from the
 * browser's own controls. Returns null if the user cancels the picker.
 */
export async function startLiveCapture(o: {
  onFrame: (frame: RasterImage) => void;
  onEnd: () => void;
  minIntervalMs?: number;
}): Promise<LiveCapture | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return null;
    throw e;
  }
  const minInterval = o.minIntervalMs ?? 200;
  const video: FrameCallbackVideo = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  Object.assign(video.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let lastSignature = -1;
  let lastRun = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(trailing);
    clearInterval(poll);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const process = () => {
    if (stopped) return;
    lastRun = performance.now();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!ctx || !vw || !vh) return;
    const scale = Math.min(1, LIVE_WORKING_SIZE / Math.max(vw, vh));
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

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    stop();
    o.onEnd();
  });

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
  return { stream, video, stop };
}

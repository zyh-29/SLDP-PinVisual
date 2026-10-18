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
  /** Stops sharing. Safe to call more than once. */
  stop: () => void;
}

/** Longest side of frames taken from a shared screen. Higher than photos: screens have thin lines and small text. */
const LIVE_WORKING_SIZE = 640;

/**
 * Asks the browser to share a screen, window or tab and keeps sharing.
 * Every `intervalMs` it grabs a downscaled frame and calls `onFrame`, but
 * only when the picture changed. `onEnd` runs when sharing stops from the
 * browser's own controls. Returns null if the user cancels the picker.
 */
export async function startLiveCapture(o: {
  onFrame: (frame: RasterImage) => void;
  onEnd: () => void;
  intervalMs?: number;
}): Promise<LiveCapture | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return null;
    throw e;
  }
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastSignature = -1;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  const tick = () => {
    if (stopped) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (ctx && vw && vh) {
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
    }
    timer = setTimeout(tick, o.intervalMs ?? 300);
  };

  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    stop();
    o.onEnd();
  });
  try {
    await video.play();
  } catch (e) {
    stop();
    throw e;
  }
  tick();
  return { stream, stop };
}

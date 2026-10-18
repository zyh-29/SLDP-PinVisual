/**
 * Phone version: drag and drop, paste and screen sharing are browser-only
 * (see imageInput.web.ts). Photos come from the image picker instead.
 */
import type { RasterImage } from './convert';

export interface ImageSource {
  uri: string;
  width?: number;
  height?: number;
}

export const supportsFileDrop = false;
export const supportsScreenCapture = false;

export function useImageDrop(_onImage: (source: ImageSource) => void): boolean {
  return false;
}

export interface LiveCapture {
  stream: unknown;
  video: unknown;
  stop: () => void;
}

export async function startLiveCapture(_o: {
  onFrame: (frame: RasterImage) => void;
  onEnd: () => void;
  minIntervalMs?: number;
}): Promise<LiveCapture | null> {
  return null;
}

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
/** The phone app takes still photos through the image picker; the live camera is in the web app. */
export const supportsCamera = false;

export function useImageDrop(_onImage: (source: ImageSource) => void, _onError?: (message: string) => void): boolean {
  return false;
}

export type LiveSource = 'screen' | 'camera';
export type CameraFacing = 'environment' | 'user';

export interface LiveCapture {
  kind: LiveSource;
  video: unknown;
  stop: () => void;
  canFlip: boolean;
  facing?: CameraFacing;
  flip: () => Promise<void>;
  snapshot: () => Promise<string>;
  focusAt: (x: number, y: number) => Promise<boolean>;
}

export async function startLiveCapture(_o: {
  source?: LiveSource;
  onFrame: (frame: RasterImage) => void;
  onFocus?: (blurryFor: number) => void;
  onEnd: () => void;
  minIntervalMs?: number;
}): Promise<LiveCapture | null> {
  return null;
}

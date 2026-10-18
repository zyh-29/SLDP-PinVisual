/**
 * Smart Cut-Out on phones: Apple Vision (iOS 17+) or Google ML Kit (Android),
 * through the local module in modules/subject-segmentation. Both are free and
 * run on the device. Not available in Expo Go; the app then keeps using the
 * colour-based background removal. The browser version is segment.web.ts.
 */
import { isAvailable, segmentAsync } from '../../modules/subject-segmentation';
import { base64ToBytes } from '@/protocol/base64';

export interface SegmentInput {
  /** RGB from `toRgb`, 3 bytes per pixel. */
  rgb: ArrayLike<number>;
  width: number;
  height: number;
  /** The downscaled image file the pixels came from (phones only). */
  fileUri?: string;
}

export const smartCutoutAvailable = isAvailable;

/** Subject probability 0..1 per pixel (width x height), or null when no subject was found. */
export async function segmentSubject(input: SegmentInput): Promise<Float32Array | null> {
  if (!input.fileUri) throw new Error('No image file to analyse');
  const base64 = await segmentAsync(input.fileUri, input.width, input.height);
  if (!base64) return null;
  const bytes = base64ToBytes(base64);
  const out = new Float32Array(input.width * input.height);
  for (let i = 0; i < out.length && i < bytes.length; i++) out[i] = bytes[i] / 255;
  return out;
}

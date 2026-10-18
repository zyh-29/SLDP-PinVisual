/**
 * On-device subject cut-out: Apple Vision on iOS 17+, Google ML Kit on Android.
 * Missing in Expo Go and on web, where `isAvailable` is false and callers fall back.
 */
import { requireOptionalNativeModule } from 'expo';

interface SubjectSegmentationNative {
  isSupported(): boolean;
  segmentAsync(uri: string, width: number, height: number): Promise<{ found: boolean; mask: string }>;
}

const native = requireOptionalNativeModule<SubjectSegmentationNative>('SubjectSegmentation');

export const isAvailable: boolean = (() => {
  try {
    return !!native && native.isSupported();
  } catch {
    return false;
  }
})();

/**
 * Mask of exactly width x height bytes (0 = background, 255 = subject) for
 * the image file at `uri`, base64 encoded; null when no subject was found.
 */
export async function segmentAsync(uri: string, width: number, height: number): Promise<string | null> {
  if (!native) throw new Error('Subject cut-out needs a development build');
  const result = await native.segmentAsync(uri, width, height);
  return result.found ? result.mask : null;
}

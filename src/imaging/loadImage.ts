/**
 * Expo side of the pipeline: downscale with expo-image-manipulator, export as
 * PNG (lossless, keeps transparency), then decode pixels in JS.
 * expo-image-manipulator has no pixel API, which is why decoding is separate.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { base64ToBytes } from '@/protocol/base64';
import type { RasterImage } from './convert';
import { decodePngToRaster } from './decodePng';

/** Longest side after downscaling. Keeps thin lines visible and is still fast to process. */
const WORKING_SIZE = 800;

/** Pixels plus the downscaled PNG they came from (used by Smart Cut-Out). */
export async function loadImagePixels(uri: string, width: number, height: number): Promise<RasterImage & { fileUri?: string }> {
  const context = ImageManipulator.manipulate(uri);
  if (width > WORKING_SIZE || height > WORKING_SIZE) {
    context.resize(width >= height ? { width: WORKING_SIZE } : { height: WORKING_SIZE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('Image manipulator returned no data');
  return { ...decodePngToRaster(base64ToBytes(saved.base64)), fileUri: saved.uri };
}

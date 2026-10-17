/**
 * Expo side of the pipeline: downscale with expo-image-manipulator, export as
 * PNG (lossless, keeps transparency), then decode pixels in JS.
 * expo-image-manipulator has no pixel API, which is why decoding is separate.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { base64ToBytes } from '@/protocol/base64';
import type { RasterImage } from './convert';
import { decodePngToRaster } from './decodePng';

/** Longest side after downscaling. Plenty for a 64x64 grid and fast to decode. */
const WORKING_SIZE = 256;

export async function loadImagePixels(uri: string, width: number, height: number): Promise<RasterImage> {
  const context = ImageManipulator.manipulate(uri);
  if (width > WORKING_SIZE || height > WORKING_SIZE) {
    context.resize(width >= height ? { width: WORKING_SIZE } : { height: WORKING_SIZE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('Image manipulator returned no data');
  return decodePngToRaster(base64ToBytes(saved.base64));
}

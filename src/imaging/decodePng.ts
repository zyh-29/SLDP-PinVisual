import { convertIndexedToRgb, decode } from 'fast-png';
import type { RasterImage } from './convert';

/**
 * Decodes PNG bytes into 8-bit interleaved pixels using fast-png (pure JS).
 * Handles palette images and 16-bit depth.
 */
export function decodePngToRaster(bytes: Uint8Array): RasterImage {
  const png = decode(bytes);
  if (png.palette) {
    const rgb = convertIndexedToRgb(png);
    const channels = rgb.length / (png.width * png.height);
    if (channels !== 3 && channels !== 4) throw new Error('Unsupported palette PNG');
    return { width: png.width, height: png.height, data: rgb, channels };
  }
  const { channels } = png;
  if (channels < 1 || channels > 4) throw new Error(`Unsupported PNG channel count ${channels}`);
  let data: ArrayLike<number> = png.data;
  if (png.depth === 16) {
    const src = png.data;
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] >> 8;
    data = out;
  } else if (png.depth !== 8) {
    // 1/2/4-bit grayscale: scale samples to 0..255.
    const max = (1 << png.depth) - 1;
    const src = png.data;
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = Math.round((src[i] / max) * 255);
    data = out;
  }
  return { width: png.width, height: png.height, data, channels: channels as RasterImage['channels'] };
}

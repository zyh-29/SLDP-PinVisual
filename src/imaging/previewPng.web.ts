/**
 * Browser version of previewPng.ts: the browser's own PNG encoder (native code, via a canvas) instead of encoding
 * in JavaScript, which matters on slow phones. (The live "What the pins see" preview skips PNGs altogether: see
 * PixelImage.web.tsx.)
 */
import { rgbToRgba } from './pixels';
let canvas: HTMLCanvasElement | null = null;

/** Encodes 8-bit RGB pixels as a PNG data URI, so a processed image can be shown with <Image>. */
export function rgbToPngDataUri(img: { width: number; height: number; data: Uint8Array }): string {
  canvas ??= document.createElement('canvas');
  canvas.width = Math.max(1, img.width);
  canvas.height = Math.max(1, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const rgba = new ImageData(canvas.width, canvas.height);
  rgbToRgba(img.data, img.width * img.height, rgba.data);
  ctx.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png');
}

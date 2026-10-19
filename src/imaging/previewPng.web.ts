/**
 * Browser version of previewPng.ts: the browser's own PNG encoder (native code, via a canvas) instead of encoding
 * in JavaScript. The "What the pins see" preview is redrawn on every live frame, so this matters on slow phones.
 */
let canvas: HTMLCanvasElement | null = null;

/** Encodes 8-bit RGB pixels as a PNG data URI, so a processed image can be shown with <Image>. */
export function rgbToPngDataUri(img: { width: number; height: number; data: Uint8Array }): string {
  canvas ??= document.createElement('canvas');
  canvas.width = Math.max(1, img.width);
  canvas.height = Math.max(1, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const rgba = new ImageData(canvas.width, canvas.height);
  for (let p = 0, n = img.width * img.height; p < n; p++) {
    rgba.data[p * 4] = img.data[p * 3];
    rgba.data[p * 4 + 1] = img.data[p * 3 + 1];
    rgba.data[p * 4 + 2] = img.data[p * 3 + 2];
    rgba.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
  return canvas.toDataURL('image/png');
}

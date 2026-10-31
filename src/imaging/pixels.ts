/**
 * Pixel helpers shared by the imaging code. Pictures are RGB (3 bytes a pixel) inside the app and RGBA (4 bytes,
 * the last one opacity) in the browser's canvas and ImageData.
 */

/** Brightness of a colour, 0 to 255, weighted the way eyes see it (Rec. 601: green counts most, blue least). */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** RGBA to RGB, opacity dropped, into `out` (a reused buffer) or a new array. `pixels` is width × height. */
export function rgbaToRgb(rgba: ArrayLike<number>, pixels: number, out = new Uint8ClampedArray(pixels * 3)): Uint8ClampedArray {
  for (let p = 0; p < pixels; p++) {
    out[p * 3] = rgba[p * 4];
    out[p * 3 + 1] = rgba[p * 4 + 1];
    out[p * 3 + 2] = rgba[p * 4 + 2];
  }
  return out;
}

/** RGB to opaque RGBA, written into `out` (usually an ImageData's data). `pixels` is width × height. */
export function rgbToRgba(rgb: ArrayLike<number>, pixels: number, out: Uint8ClampedArray): Uint8ClampedArray {
  for (let p = 0; p < pixels; p++) {
    out[p * 4] = rgb[p * 3];
    out[p * 4 + 1] = rgb[p * 3 + 1];
    out[p * 4 + 2] = rgb[p * 3 + 2];
    out[p * 4 + 3] = 255;
  }
  return out;
}

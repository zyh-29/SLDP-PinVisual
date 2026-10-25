/**
 * Photos shown on a screen: a picture on a web page, in a shared screen or a screenshot. The rest of the screen is
 * flat (windows, pages), so colour-based background removal finds the photo, but only as a whole: its own
 * background (a street behind a cat) is part of the picture, and every pin inside the rectangle goes up. Smart
 * Cut-Out is then run on the photo alone. Pure functions, unit tested.
 */
import type { Rect } from './geometry';
import { PHOTO_GRAIN, pictureKind } from './smartCrop';

/** At least this share of the photo's box kept by colour-based removal: it couldn't cut the photo (a rectangle). */
export const UNCUT_FILL = 0.9;

/** The box in whole pixels, inside the picture. */
export function pixelBox(box: Rect, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  return { x, y, width: Math.max(0, Math.min(width, Math.ceil(box.x + box.width)) - x), height: Math.max(0, Math.min(height, Math.ceil(box.y + box.height)) - y) };
}

/** The pixels in `box` (RGB, 3 bytes per pixel). */
export function cropPixels(rgb: ArrayLike<number>, width: number, height: number, box: Rect) {
  const b = pixelBox(box, width, height);
  const out = new Uint8ClampedArray(b.width * b.height * 3);
  for (let y = 0; y < b.height; y++) {
    const from = ((b.y + y) * width + b.x) * 3;
    for (let i = 0; i < b.width * 3; i++) out[y * b.width * 3 + i] = rgb[from + i];
  }
  return { rgb: out, width: b.width, height: b.height, box: b };
}

/** A mask made for `crop` (cropPixels' box), placed back into the whole picture (0 outside the crop). */
export function pasteMask(mask: Float32Array, crop: { x: number; y: number; width: number; height: number }, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < crop.height; y++) out.set(mask.subarray(y * crop.width, (y + 1) * crop.width), (crop.y + y) * width + crop.x);
  return out;
}

/**
 * Whether the subject in `box` is a photo that colour-based removal couldn't cut: photographic grain, and the
 * colour mask (1 = subject) fills nearly all of the box. A product photo on a plain backdrop is cut by colour (the
 * mask fills only the object's share of the box) and doesn't need Smart Cut-Out.
 */
export function uncutPhoto(rgb: ArrayLike<number>, width: number, height: number, box: Rect, mask: Uint8Array): boolean {
  const b = pixelBox(box, width, height);
  if (b.width < 24 || b.height < 24) return false;
  let kept = 0;
  for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) kept += mask[y * width + x];
  if (kept < b.width * b.height * UNCUT_FILL) return false;
  const crop = cropPixels(rgb, width, height, b);
  return pictureKind(crop.rgb, crop.width, crop.height).grain >= PHOTO_GRAIN;
}

/** Two boxes for the same thing: each side within 3% of the picture's size (a live frame moves a little). */
export function sameBox(a: Rect, b: Rect, width: number, height: number): boolean {
  const dx = width * 0.03;
  const dy = height * 0.03;
  return (
    Math.abs(a.x - b.x) <= dx &&
    Math.abs(a.y - b.y) <= dy &&
    Math.abs(a.x + a.width - b.x - b.width) <= dx &&
    Math.abs(a.y + a.height - b.y - b.height) <= dy
  );
}

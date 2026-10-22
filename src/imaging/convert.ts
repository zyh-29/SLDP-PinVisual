/**
 * Decoded pixels, and their grayscale. Pure functions, unit tested.
 */

export interface RasterImage {
  width: number;
  height: number;
  /** Interleaved samples, 8-bit, `channels` per pixel (1 gray, 2 gray+alpha, 3 RGB, 4 RGBA). */
  data: ArrayLike<number>;
  channels: 1 | 2 | 3 | 4;
}

const WHITE = 255;

/** Grayscale luminance 0..255 per pixel (Rec. 709), with transparent pixels over white. */
export function toGrayscale(img: RasterImage): Float32Array {
  const { width, height, data, channels } = img;
  const out = new Float32Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += channels) {
    let lum: number;
    let alpha = 255;
    if (channels === 1 || channels === 2) {
      lum = data[i];
      if (channels === 2) alpha = data[i + 1];
    } else {
      lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (channels === 4) alpha = data[i + 3];
    }
    const a = alpha / 255;
    out[p] = lum * a + WHITE * (1 - a);
  }
  return out;
}

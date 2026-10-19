/** Working with 0/1 pixel masks: connected pieces and growing. Pure functions, unit tested. */
import type { Rect } from './geometry';

export interface Component {
  /** Number of pixels. */
  area: number;
  box: Rect;
}

/** 8-connected pieces of the mask. Returns a label per pixel (0 = background, 1.. = piece) and piece stats. */
export function labelComponents(mask: Uint8Array, width: number, height: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = components.length + 1;
    let area = 0;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    labels[start] = label;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !labels[q]) {
            labels[q] = label;
            stack.push(q);
          }
        }
      }
    }
    components.push({ area, box: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } });
  }
  return { labels, components };
}

/** Grows every content pixel into a (2rx+1) x (2ry+1) block. Separable, O(pixels). */
export function dilate(mask: Uint8Array, width: number, height: number, rx: number, ry: number): Uint8Array {
  // Plain index arithmetic, row by row in memory order: this runs many times per live camera frame.
  const horizontal = (src: Uint8Array, r: number) => {
    if (r <= 0) return src;
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      // Running count of content pixels in the window [x - r, x + r].
      let count = 0;
      const first = Math.min(r, width);
      for (let x = 0; x < first; x++) count += src[row + x];
      for (let x = 0; x < width; x++) {
        if (x + r < width) count += src[row + x + r];
        if (x - r - 1 >= 0) count -= src[row + x - r - 1];
        out[row + x] = count > 0 ? 1 : 0;
      }
    }
    return out;
  };
  const vertical = (src: Uint8Array, r: number) => {
    if (r <= 0) return src;
    const out = new Uint8Array(src.length);
    // One running count per column, moved down a row at a time.
    const count = new Int32Array(width);
    const first = Math.min(r, height);
    for (let y = 0; y < first; y++) for (let x = 0; x < width; x++) count[x] += src[y * width + x];
    for (let y = 0; y < height; y++) {
      const add = y + r < height ? (y + r) * width : -1;
      const sub = y - r - 1 >= 0 ? (y - r - 1) * width : -1;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (add >= 0) count[x] += src[add + x];
        if (sub >= 0) count[x] -= src[sub + x];
        out[row + x] = count[x] > 0 ? 1 : 0;
      }
    }
    return out;
  };
  return vertical(horizontal(mask, Math.round(rx)), Math.round(ry));
}

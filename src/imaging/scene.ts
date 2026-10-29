/**
 * Landscapes: what to show of a photo of mountains, hills or a skyline, where there is no one object to cut out.
 *
 * On a few dozen pins the useful thing to feel is the skyline: the land as raised pins, the sky lowered, cropped
 * around the ridge so the peaks fill the grid. A subject cut-out model (U²-Net) is made for "the main object" and on
 * a landscape keeps a shoreline strip, a patch of meadow or nothing at all.
 *
 * The sky is found the way a person would see it: the smooth area joined to the top of the picture, right across
 * it. Grown down from the top row through pixels that change only a little from their neighbours and have little
 * texture. Clouds and haze are smooth too, so they are sky; rock, trees, snow ridges and buildings have edges and
 * texture, so they stop it. Each column's skyline is where the sky ends.
 *
 * A car under the sky has a skyline too (trees, buildings), so a landscape is only one when the subject is the land
 * itself: when the cut-out found nothing, or what it found follows the skyline (its top edge is the ridge) instead
 * of sitting below it (a car's roof is well under the trees behind it). See isLandscape.
 *
 * Pure functions, no React Native imports.
 */
import type { Rect } from './geometry';

/** The sky is found on a copy about this wide (it's a large, smooth area: detail doesn't matter, speed does). */
const WORK_WIDTH = 160;
/** Most a sky pixel's colour may differ from its neighbour's (any channel), at WORK_WIDTH. */
const SKY_STEP = 9;
/** Most texture (mean absolute difference from the 3 x 3 average, any channel) a sky pixel may have. */
const SKY_TEXTURE = 5;
/** Too dark to be sky (a night photo, a black backdrop): 0..255 brightness. */
const SKY_DARKEST = 60;
/** At least this share of columns must have sky at the top. */
const MIN_SKY_COLUMNS = 0.85;
/** The sky must cover between these shares of the picture. */
const MIN_SKY_SHARE = 0.08;
const MAX_SKY_SHARE = 0.85;

export interface Sky {
  width: number;
  height: number;
  /** Per column of the picture: the first row that is not sky (0 = no sky in that column). */
  skyline: Int32Array;
  /** Share of the picture that is sky. */
  share: number;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The sky joined to the picture's top, and the skyline below it, or null when there is no sky across the top. */
export function findSky(rgb: ArrayLike<number>, width: number, height: number): Sky | null {
  const scale = Math.min(1, WORK_WIDTH / width);
  const sw = Math.max(8, Math.round(width * scale));
  const sh = Math.max(8, Math.round(height * scale));
  // Box-averaged copy (each cell of the original averaged): noise and JPEG blocks gone.
  const small = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor((y * height) / sh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / sh));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor((x * width) / sw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / sw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 3;
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
          n++;
        }
      const o = (y * sw + x) * 3;
      small[o] = r / n;
      small[o + 1] = g / n;
      small[o + 2] = b / n;
    }
  }
  // Texture: how far each pixel is from its 3 x 3 neighbourhood's average (worst channel).
  const texture = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
            s += small[(yy * sw + xx) * 3 + c];
            n++;
          }
        worst = Math.max(worst, Math.abs(small[(y * sw + x) * 3 + c] - s / n));
      }
      texture[y * sw + x] = worst;
    }
  const skyLike = (p: number) =>
    texture[p] <= SKY_TEXTURE && lum(small[p * 3], small[p * 3 + 1], small[p * 3 + 2]) >= SKY_DARKEST;
  const step = (a: number, b: number) =>
    Math.max(Math.abs(small[a * 3] - small[b * 3]), Math.abs(small[a * 3 + 1] - small[b * 3 + 1]), Math.abs(small[a * 3 + 2] - small[b * 3 + 2]));

  // Grow the sky from the top row.
  const sky = new Uint8Array(sw * sh);
  const queue: number[] = [];
  for (let x = 0; x < sw; x++)
    if (skyLike(x)) {
      sky[x] = 1;
      queue.push(x);
    }
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q];
    const x = p % sw;
    const y = (p - x) / sw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const n = yy * sw + xx;
      if (sky[n] || !skyLike(n) || step(p, n) > SKY_STEP) continue;
      sky[n] = 1;
      queue.push(n);
    }
  }

  // The land: what isn't sky, joined to the bottom of the picture. Clouds are islands in the sky (not joined to the
  // land), so they don't count, though they stopped the sky from growing through them.
  const land = new Uint8Array(sw * sh);
  const stack: number[] = [];
  for (let x = 0; x < sw; x++) {
    const p = (sh - 1) * sw + x;
    if (!sky[p]) {
      land[p] = 1;
      stack.push(p);
    }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % sw;
    const y = (p - x) / sw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const n = yy * sw + xx;
      if (land[n] || sky[n]) continue;
      land[n] = 1;
      stack.push(n);
    }
  }
  // Skyline per column: just below the column's lowest sky. Land never floats above sky, so anything with sky
  // under it is a cloud, even one resting against a peak (and so joined to the land). Where there's no sky below
  // the land's top, the land's top is the skyline.
  const smallLine = new Int32Array(sw);
  let columns = 0;
  let area = 0;
  for (let x = 0; x < sw; x++) {
    let top = 0;
    while (top < sh && !land[top * sw + x]) top++;
    let lowest = -1;
    for (let y = sh - 1; y >= 0; y--)
      if (sky[y * sw + x]) {
        lowest = y;
        break;
      }
    const y = Math.max(top, lowest + 1);
    let skyAbove = 0;
    for (let yy = 0; yy < y; yy++) skyAbove += sky[yy * sw + x];
    // Mostly cloud, little sky (the top of a picture that is all foliage or a ceiling): no skyline here.
    smallLine[x] = y > 0 && y < sh && skyAbove >= y * 0.4 ? y : 0;
    if (smallLine[x] > 0) columns++;
    area += smallLine[x];
  }
  const share = area / (sw * sh);
  if (columns < sw * MIN_SKY_COLUMNS || share < MIN_SKY_SHARE || share > MAX_SKY_SHARE) return null;
  // A column or two without sky (a branch, a lamp post at the top): the neighbours' skyline.
  const fixed = Int32Array.from(smallLine);
  for (let x = 0; x < sw; x++) {
    if (smallLine[x] > 0) continue;
    let l = x - 1;
    while (l >= 0 && smallLine[l] === 0) l--;
    let r = x + 1;
    while (r < sw && smallLine[r] === 0) r++;
    fixed[x] = l >= 0 && r < sw ? Math.round((smallLine[l] + smallLine[r]) / 2) : l >= 0 ? smallLine[l] : smallLine[r];
  }
  // Back to the picture's own columns and rows.
  const skyline = new Int32Array(width);
  for (let x = 0; x < width; x++) skyline[x] = Math.round((fixed[Math.min(sw - 1, Math.floor(x * scale))] * height) / sh);
  return { width, height, skyline, share };
}

/**
 * findSky a little inside the picture's edges (`inset`: share of each side), for a flattened print or screen: its
 * own frame (a print's white border, a screen's black bezel) runs along the top and would hide the sky from the top
 * edge. The skyline is given for the whole picture.
 */
export function findSkyInside(rgb: ArrayLike<number>, width: number, height: number, inset: number): Sky | null {
  const x0 = Math.round(width * inset);
  const y0 = Math.round(height * inset);
  const w = width - 2 * x0;
  const h = height - 2 * y0;
  if (w < 16 || h < 16) return null;
  const inner = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const from = ((y + y0) * width + x0) * 3;
    for (let k = 0; k < w * 3; k++) inner[y * w * 3 + k] = rgb[from + k];
  }
  const sky = findSky(inner, w, h);
  if (!sky) return null;
  const skyline = new Int32Array(width);
  for (let x = 0; x < width; x++) skyline[x] = sky.skyline[Math.min(w - 1, Math.max(0, x - x0))] + y0;
  return { width, height, skyline, share: sky.share };
}

/** The land: everything below the skyline (1 = land), as a subject mask (0..1 per pixel). */
export function landMask(sky: Sky): Float32Array {
  const { width, height, skyline } = sky;
  const mask = new Float32Array(width * height);
  for (let x = 0; x < width; x++) for (let y = skyline[x]; y < height; y++) mask[y * width + x] = 1;
  return mask;
}

/**
 * The part of the picture the pins show: the whole width, from just above the highest peak down far enough below
 * the ridge that the peaks rise out of solid ground. Graphs-style (stretched), so the ridge's shape fills the grid
 * whatever the photo's proportions.
 */
export function skylineBand(sky: Sky): Rect {
  const { width, height, skyline } = sky;
  const sorted = Array.from(skyline).sort((a, b) => a - b);
  const top = sorted[0];
  // The ridge's lower points (the valleys between peaks, the horizon beside a lone mountain).
  const low = sorted[Math.floor(sorted.length * 0.9)];
  const relief = Math.max(low - top, height * 0.04);
  const y0 = Math.max(0, Math.round(top - relief * 0.08));
  const y1 = Math.min(height, Math.round(low + relief * 0.45));
  return { x: 0, y: y0, width, height: Math.max(1, y1 - y0) };
}

/** How closely a cut-out's top edge must follow the skyline (share of the picture's height). */
const FOLLOWS = 0.04;
/** ...over at least this share of the columns the cut-out covers... */
const FOLLOWS_SHARE = 0.6;
/** ...and the cut-out spans at least this share of the width (a landscape runs edge to edge). */
const WIDE = 0.6;
/** A cut-out reaching the picture's bottom along this share of its width is the ground, not an object on it. */
const GROUND = 0.8;

/**
 * Whether the photo is a landscape (show the skyline) rather than an object in front of the sky (show the object).
 * `subject` is the cut-out model's mask, or null when it found nothing.
 */
export function isLandscape(sky: Sky, subject: Float32Array | null): boolean {
  if (!subject) return true;
  const { width, height, skyline } = sky;
  // A cut-out that takes in most of the sky is the whole picture (a photo framed by a screen's bezel stands out as
  // one object), not something in front of the sky: it says nothing about what to show.
  let skyPixels = 0;
  let skyTaken = 0;
  for (let x = 0; x < width; x += 2)
    for (let y = 0; y < skyline[x]; y += 2) {
      skyPixels++;
      if (subject[y * width + x] >= 0.5) skyTaken++;
    }
  if (skyPixels && skyTaken > skyPixels * 0.5) return true;
  let covered = 0;
  let follows = 0;
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height && subject[y * width + x] < 0.5) y++;
    if (y >= height) continue;
    covered++;
    if (Math.abs(y - skyline[x]) <= height * FOLLOWS) follows++;
  }
  // Too little found to call it an object: the land is the subject.
  if (covered < width * 0.05) return true;
  // The ground itself (a meadow, a lake shore): it runs out of the bottom of the picture nearly all the way across.
  // An object stands on the ground; even a car filling the view touches the bottom only at its wheels.
  let onBottom = 0;
  const bottom = Math.max(0, height - 1 - Math.round(height * 0.02));
  for (let x = 0; x < width; x++) if (subject[bottom * width + x] >= 0.5) onBottom++;
  if (onBottom >= width * GROUND) return true;
  return covered >= width * WIDE && follows >= covered * FOLLOWS_SHARE;
}

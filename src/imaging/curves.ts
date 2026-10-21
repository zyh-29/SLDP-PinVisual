/**
 * Graph curves in screenshots (as in Desmos): coloured, long, thin strokes, grouped by colour. Ignores UI that
 * shares a colour (buttons, input outlines, icons) and filled shapes with a coloured outline. Pure functions,
 * unit tested.
 */
import { AUTO_MIN } from './foreground';
import { expand, fullRect, overlaps, type Point, type Rect, union } from './geometry';
import { dilate, labelComponents } from './masks';

const HUE_BINS = 12;

/** Which of HUE_BINS hue ranges (30° each) a colour is in, given its largest and smallest channel. */
function hueBin(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return ((h / (360 / HUE_BINS)) | 0) % HUE_BINS;
}

/**
 * Coloured curves, as in a Desmos screenshot: per colour, the pieces that are
 * long (at least 12% of the region's short side) and thin (a few pixels).
 * Returns the box around the curves of the strongest colour(s), or null.
 */
export function findColouredCurves(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect = fullRect(width, height),
): Rect | null {
  return findCurves(rgb, width, height, region)?.box ?? null;
}

export interface CurveResult {
  /** Total length of the curves kept (px): how much curve was found. */
  score: number;
  box: Rect;
  /** Exactly the pixels of the accepted curves (1 = curve). */
  mask: Float32Array;
}

/** Saturation a pixel needs to count towards a curve. Low enough for curves dimmed by screen-capture colour smearing. */
const CURVE_MIN_SATURATION = 35;
/**
 * The same on a screen photographed by a camera and flattened (surface.ts): a display and a lens wash colours out,
 * so a thin curve blurred into white keeps only ~25 levels of colour, while the screen's own white has ~13. Which
 * works best depends on the picture (a faint, small screen's tinted white starts to pass at 22), so both are
 * tried and the one finding more curve wins.
 */
export const CAMERA_CURVE_SATURATIONS = [30, 22];

/**
 * `focus`: a tapped point. On (or within a few pixels of) a curve, only that curve's colour is kept (tap the
 * blue line to drop the red parabola); anywhere else, every comparable curve is kept as usual.
 */
export function findCurves(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  region: Rect,
  focus?: Point,
  /** Lower on a photographed screen (see CAMERA_CURVE_SATURATION). */
  minSaturation = CURVE_MIN_SATURATION,
): CurveResult | null {
  // Only part of the picture is searched (a locked item, a tapped plot): work on a copy of just that part, so
  // every pass below (per colour: grow, label, measure) covers it rather than the whole frame.
  const cx0 = Math.max(0, Math.floor(region.x));
  const cy0 = Math.max(0, Math.floor(region.y));
  const cx1 = Math.min(width, Math.ceil(region.x + region.width));
  const cy1 = Math.min(height, Math.ceil(region.y + region.height));
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  if (cx0 > 0 || cy0 > 0 || cx1 < width || cy1 < height) {
    const cw = cx1 - cx0;
    const ch = cy1 - cy0;
    const part = new Uint8ClampedArray(cw * ch * 3);
    for (let y = 0; y < ch; y++) {
      const from = ((cy0 + y) * width + cx0) * 3;
      for (let i = 0; i < cw * 3; i++) part[y * cw * 3 + i] = rgb[from + i];
    }
    const local = findCurves(part, cw, ch, { x: 0, y: 0, width: cw, height: ch }, focus && { ...focus, x: focus.x - cx0, y: focus.y - cy0 }, minSaturation);
    if (!local) return null;
    const mask = new Float32Array(width * height);
    for (let y = 0; y < ch; y++) mask.set(local.mask.subarray(y * cw, (y + 1) * cw), (cy0 + y) * width + cx0);
    return { score: local.score, box: { ...local.box, x: local.box.x + cx0, y: local.box.y + cy0 }, mask };
  }
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.width));
  const y1 = Math.min(height, Math.ceil(region.y + region.height));
  const shortSide = Math.min(x1 - x0, y1 - y0);
  const minLength = Math.max(12, shortSide * 0.12);
  const maxThickness = Math.max(4, shortSide * 0.02);

  // Coloured pixels, grouped by hue: each pixel's hue bin (plus one; 0 = not coloured) in one array, and a colour's
  // own mask made only if it has enough pixels to hold a curve.
  const hueOf = new Uint8Array(width * height);
  const counts = new Array<number>(HUE_BINS).fill(0);
  let any = false;
  for (let y = y0; y < y1; y++)
    for (let x = x0, p = y * width + x0; x < x1; x++, p++) {
      const r = rgb[p * 3];
      const g = rgb[p * 3 + 1];
      const b = rgb[p * 3 + 2];
      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      if (max - min < minSaturation || max < 60) continue;
      const k = hueBin(r, g, b, max, min);
      hueOf[p] = k + 1;
      counts[k]++;
      any = true;
    }
  if (!any) return null;
  const binMask = (k: number) => {
    const m = new Uint8Array(width * height);
    for (let p = 0; p < m.length; p++) if (hueOf[p] === k + 1) m[p] = 1;
    return m;
  };

  const results: {
    hueBin: number;
    score: number;
    box: Rect;
    labels: Int32Array;
    bin: Uint8Array;
    accepted: Set<number>;
    /** Each accepted piece's box, by label. */
    boxes: Map<number, Rect>;
  }[] = [];
  for (let binIndex = 0; binIndex < HUE_BINS; binIndex++) {
    // A colour with fewer pixels than one minimum-length curve can't hold a curve: skip the expensive part.
    if (counts[binIndex] < minLength) continue;
    const bin = binMask(binIndex);
    // Join pieces up to ~4 px apart (thin steep curves fragment when a large screenshot is shrunk),
    // but measure size and thickness on the real pixels.
    const { labels, components } = labelComponents(dilate(bin, width, height, 2, 2), width, height);
    const real = components.map(() => ({ area: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1, border: 0 }));
    // Pixels this close to the searched area's edge are "on its border".
    const band = Math.max(3, shortSide * 0.015);
    for (let p = 0; p < bin.length; p++) {
      if (!bin[p]) continue;
      const k = real[labels[p] - 1];
      const x = p % width;
      const y = (p - x) / width;
      k.area++;
      if (x - x0 < band || x1 - 1 - x < band || y - y0 < band || y1 - 1 - y < band) k.border++;
      if (x < k.x0) k.x0 = x;
      if (x > k.x1) k.x1 = x;
      if (y < k.y0) k.y0 = y;
      if (y > k.y1) k.y1 = y;
    }
    // Rectangle outlines (input boxes, buttons, frames) are not curves: they run along most of their own box's
    // perimeter, whatever is inside them (e.g. Desmos' solid icon square fused with the input outline).
    // A curve touches its box only at a few points (arm tips, vertex).
    const sides = real.map((k) =>
      k.area
        ? {
            top: new Uint8Array(k.x1 - k.x0 + 1),
            bottom: new Uint8Array(k.x1 - k.x0 + 1),
            left: new Uint8Array(k.y1 - k.y0 + 1),
            right: new Uint8Array(k.y1 - k.y0 + 1),
          }
        : null,
    );
    for (let p = 0; p < bin.length; p++) {
      if (!bin[p]) continue;
      const i = labels[p] - 1;
      const k = real[i];
      const sd = sides[i]!;
      const x = p % width;
      const y = (p - x) / width;
      if (y - k.y0 <= 2) sd.top[x - k.x0] = 1;
      if (k.y1 - y <= 2) sd.bottom[x - k.x0] = 1;
      if (x - k.x0 <= 2) sd.left[y - k.y0] = 1;
      if (k.x1 - x <= 2) sd.right[y - k.y0] = 1;
    }
    const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);
    const perimeterCover = sides.map((sd) =>
      sd ? (sum(sd.top) + sum(sd.bottom) + sum(sd.left) + sum(sd.right)) / (2 * sd.top.length + 2 * sd.left.length) : 0,
    );
    let score = 0;
    let box: Rect | null = null;
    const accepted = new Set<number>();
    const boxes = new Map<number, Rect>();
    real.forEach((k, i) => {
      if (!k.area) return;
      const kb = { x: k.x0, y: k.y0, width: k.x1 - k.x0 + 1, height: k.y1 - k.y0 + 1 };
      const length = Math.hypot(kb.width, kb.height);
      const thickness = k.area / length;
      if (length < minLength || thickness > maxThickness) return;
      const frame = kb.width >= 10 && kb.height >= 10 && perimeterCover[i] >= 0.6;
      if (frame) return;
      // Dead-straight horizontal or vertical coloured lines are UI (borders, underlines, separators), not curves.
      if (kb.width <= 3 || kb.height <= 3) return;
      // A stroke lying along the searched area's edge is its frame (a window border, a sliver of table at the
      // edge of a flattened page), not a curve.
      if (k.border > 0.7 * k.area) return;
      // A drawn stroke is solid along its path; scattered photo noise that only joins up after growing is not.
      const density = k.area / components[i].area;
      if (density < 0.12) return;
      score += length;
      box = box ? union(box, kb) : kb;
      accepted.add(i + 1);
      boxes.set(i + 1, kb);
    });
    if (box && score >= shortSide * 0.25) results.push({ hueBin: binIndex, score, box, labels, bin, accepted, boxes });
  }
  if (!results.length) return null;
  const top = Math.max(...results.map((r) => r.score));
  // Several curves of different colours (y = x² in red, y = 2x in blue) all count if they are comparable.
  /** What goes into the mask: per colour, the pieces to keep. */
  let chosen = results.filter((r) => r.score >= top * 0.35).map((r) => ({ r, keep: r.accepted }));
  if (focus) {
    // The curve under the finger, if any: its accepted pixels nearest the tap, within a finger's width.
    const reach = Math.max(6, shortSide * 0.03);
    let tapped: (typeof results)[number] | null = null;
    let nearest = Infinity;
    const fx0 = Math.max(x0, Math.floor(focus.x - reach));
    const fx1 = Math.min(x1 - 1, Math.ceil(focus.x + reach));
    const fy0 = Math.max(y0, Math.floor(focus.y - reach));
    const fy1 = Math.min(y1 - 1, Math.ceil(focus.y + reach));
    for (const r of results)
      for (let y = fy0; y <= fy1; y++)
        for (let x = fx0; x <= fx1; x++) {
          const p = y * width + x;
          if (!r.bin[p] || !r.accepted.has(r.labels[p])) continue;
          const d = Math.hypot(x - focus.x, y - focus.y);
          if (d <= reach && d < nearest) {
            nearest = d;
            tapped = r;
          }
        }
    if (tapped) {
      // The tapped colour, plus the pieces of the neighbouring hues that lie on it: a blurred (camera) or
      // anti-aliased curve straddles two hue bins, and keeping one would keep half the curve, varying by frame.
      const t = tapped;
      const near = expand(t.box, 0.02, width, height);
      chosen = [{ r: t, keep: t.accepted }];
      for (const r of results) {
        const d = Math.abs(r.hueBin - t.hueBin);
        if (r === t || Math.min(d, HUE_BINS - d) !== 1) continue;
        const keep = new Set([...r.boxes].filter(([, b]) => overlaps(b, near)).map(([l]) => l));
        if (keep.size) chosen.push({ r, keep });
      }
    }
  }
  // Only the accepted curves' own pixels: never an icon or button that happens to share the colour.
  const mask = new Float32Array(width * height);
  let box: Rect | null = null;
  for (const { r, keep } of chosen) {
    for (let p = 0; p < r.bin.length; p++) if (r.bin[p] && keep.has(r.labels[p])) mask[p] = 1;
    for (const l of keep) box = box ? union(box, r.boxes.get(l)!) : r.boxes.get(l)!;
  }
  return { box: box!, mask, score: chosen.reduce((t, c) => t + c.r.score, 0) };
}

/**
 * Removes pieces that run along most of their own box's perimeter (buttons, input boxes, panels): UI, not
 * drawing. Returns what is left as a 0/1 mask and its box.
 */
export function dropFramedPieces(source: Uint8Array, width: number, height: number): { mask: Float32Array; box: Rect | null } {
  const { labels, components } = labelComponents(source, width, height);
  const sides = components.map((c) => ({
    top: new Uint8Array(c.box.width),
    bottom: new Uint8Array(c.box.width),
    left: new Uint8Array(c.box.height),
    right: new Uint8Array(c.box.height),
  }));
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l) continue;
    const b = components[l - 1].box;
    const sd = sides[l - 1];
    const x = p % width;
    const y = (p - x) / width;
    if (y - b.y <= 2) sd.top[x - b.x] = 1;
    if (b.y + b.height - 1 - y <= 2) sd.bottom[x - b.x] = 1;
    if (x - b.x <= 2) sd.left[y - b.y] = 1;
    if (b.x + b.width - 1 - x <= 2) sd.right[y - b.y] = 1;
  }
  const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);
  const framed = components.map((c, i) => {
    if (c.box.width < 10 || c.box.height < 10) return false;
    const sd = sides[i];
    return (sum(sd.top) + sum(sd.bottom) + sum(sd.left) + sum(sd.right)) / (2 * c.box.width + 2 * c.box.height) >= 0.6;
  });
  const mask = new Float32Array(width * height);
  let box: Rect | null = null;
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p];
    if (!l || framed[l - 1]) continue;
    mask[p] = 1;
  }
  components.forEach((c, i) => {
    if (!framed[i]) box = box ? union(box, c.box) : c.box;
  });
  return { mask, box };
}

/**
 * True when the strokes are the outline of a filled shape rather than graph curves: inside their box, apart
 * from the strokes, at least 20% of the area is a *solid* region of another colour than the local background.
 * "Solid" means the pixel's whole 5 x 5 neighbourhood has that other colour, so thin things (gridlines, axes,
 * tick labels) never count, however dense the grid is. A triangle diagram's pale fill does.
 * "Another colour" means another hue or a much darker or lighter one: a glare patch or uneven light on a
 * photographed screen only brightens the same colour a little, and is not a fill.
 */
/** A colour clearly different from `bg`: in hue (opponent colour axes), or by a large step in brightness. */
function differsFrom(rgb: ArrayLike<number>, i: number, bg: { r: number; g: number; b: number }): boolean {
  const r = rgb[i];
  const g = rgb[i + 1];
  const b = rgb[i + 2];
  const chroma = Math.hypot(r - g - (bg.r - bg.g), (r + g) / 2 - b - ((bg.r + bg.g) / 2 - bg.b));
  const light = Math.abs((r + g + b) / 3 - (bg.r + bg.g + bg.b) / 3);
  return chroma > AUTO_MIN || light > 3 * AUTO_MIN;
}

export function enclosesFill(rgb: ArrayLike<number>, width: number, curves: CurveResult): boolean {
  const b = curves.box;
  const x0 = Math.floor(b.x);
  const y0 = Math.floor(b.y);
  const bw = Math.ceil(b.x + b.width) - x0;
  const bh = Math.ceil(b.y + b.height) - y0;
  if (bw < 5 || bh < 5) return false;
  // Local background: the most common colour (in 8 levels per channel) inside the box, then its real average.
  const key = (p: number) => ((rgb[p] >> 5) << 6) | ((rgb[p + 1] >> 5) << 3) | (rgb[p + 2] >> 5);
  const counts = new Uint32Array(512);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) counts[key(((y0 + y) * width + x0 + x) * 3)]++;
  let mode = 0;
  for (let i = 1; i < 512; i++) if (counts[i] > counts[mode]) mode = i;
  const bg = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const p = ((y0 + y) * width + x0 + x) * 3;
      if (key(p) !== mode) continue;
      bg.r += rgb[p];
      bg.g += rgb[p + 1];
      bg.b += rgb[p + 2];
    }
  bg.r /= counts[mode];
  bg.g /= counts[mode];
  bg.b /= counts[mode];

  // Pixels that are neither background nor (near) a stroke. The inverse is grown by 2 px, so what survives is solid.
  const notOther = new Uint8Array(bw * bh);
  let total = 0;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const q = (y0 + y) * width + x0 + x;
      let nearStroke = false;
      for (let d = -2; d <= 2 && !nearStroke; d++) nearStroke = !!curves.mask[q + d] || !!curves.mask[q + d * width];
      if (!nearStroke) total++;
      const other = !nearStroke && differsFrom(rgb, q * 3, bg);
      notOther[y * bw + x] = other ? 0 : 1;
    }
  const notSolid = dilate(notOther, bw, bh, 2, 2);
  let solid = 0;
  for (let i = 0; i < notSolid.length; i++) if (!notSolid[i]) solid++;
  return total > 0 && solid / total >= 0.2;
}

/** True if some piece of the mask (small gaps bridged) spans at least a quarter of the plot's shorter side. */
export function hasLongStroke(mask: Float32Array, width: number, height: number, plot: Rect): boolean {
  const bin = new Uint8Array(width * height);
  for (let p = 0; p < bin.length; p++) if (mask[p] > 0.5) bin[p] = 1;
  const { components } = labelComponents(dilate(bin, width, height, 2, 2), width, height);
  const need = Math.min(plot.width, plot.height) * 0.25;
  return components.some((c) => Math.hypot(c.box.width, c.box.height) >= need);
}

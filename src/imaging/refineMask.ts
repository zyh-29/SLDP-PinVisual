/**
 * Background removal, second opinion: a GrabCut-style refinement (Rother, Kolmogorov & Blake, 2004) of the
 * first, pixel-by-pixel mask from foreground.ts. Pure, unit tested.
 *
 * The first mask judges every pixel alone: is its colour far from the colours along the edge? That leaves bits
 * of background whose colour isn't on the edge (a knot in the wood, a shadow, a second colour of the desk),
 * speckles from camera noise, and bites out of the subject where it is pale. GrabCut instead:
 *  1. Learns what the background looks like from everything well away from the subject (not just the edge), and
 *     what the subject looks like from the subject: how often each colour is seen as each (16 levels per channel,
 *     blurred a little so nearby shades count).
 *  2. Scores each pixel by how often its colour is background rather than subject, plus a little of the first
 *     mask's verdict. Counts, not each side's proportions (standard GrabCut): a red flower printed on the cloth
 *     that happens to touch the object is a small share of the cloth but a big share of the object; by count,
 *     red is mostly cloth.
 *  3. Decides all pixels together by a minimum cut (maxflow.ts): neighbours pay to be split, less so across a
 *     clear edge in the picture. Speckles and pinholes disappear, and the outline follows the real edges.
 *  4. Learns the two histograms again from that result and cuts once more.
 * It runs on a copy about 160 pixels across (a few milliseconds), then the outline is redrawn at full size from
 * the colours along it.
 *
 * Only for filled subjects (shapes, objects): the cut's smoothing would thin out or cut a 1-2 pixel line, so
 * graph curves and line drawings keep the first mask (see findForeground).
 */
import { bounds, type Rect } from './geometry';
import { gridGraph, minCut } from './maxflow';

/** Largest side of the copy the cut runs on. */
const WORK = 160;
const BINS = 16;
const SHIFT = 4; // 256 / 16 levels
/** Weight of "neighbours should agree" against the colour evidence (nats). */
const SMOOTH = 4;
/** Weight of the first mask's verdict (nats). */
const PRIOR = 0.8;
/** Margin around the subject's box (share of its size) beyond which everything is background for sure. */
const BOX_MARGIN = 0.12;

const binOf = (r: number, g: number, b: number) => ((r >> SHIFT) * BINS + (g >> SHIFT)) * BINS + (b >> SHIFT);

/** Colour counts blurred over neighbouring bins: a shade a little lighter or darker counts too. */
function blurred(hist: Float64Array): Float64Array {
  const n = BINS;
  let a = hist;
  // Separable [1 2 1] blur along r, g and b: a shade a little lighter or darker counts.
  for (let axis = 0; axis < 3; axis++) {
    const out = new Float64Array(a.length);
    const stride = axis === 0 ? n * n : axis === 1 ? n : 1;
    for (let i = 0; i < a.length; i++) {
      const c = Math.floor(i / stride) % n;
      let v = 2 * a[i];
      let w = 2;
      if (c > 0) {
        v += a[i - stride];
        w++;
      }
      if (c < n - 1) {
        v += a[i + stride];
        w++;
      }
      out[i] = v / w;
    }
    a = out;
  }
  return a;
}

/**
 * Per colour bin, the cost (-log probability) of calling a pixel of that colour subject, and background: from
 * how often the colour was seen as each. A colour seen as neither is undecided (the neighbours and the first mask
 * decide).
 */
function colourCosts(fgCounts: Float64Array, bgCounts: Float64Array): { fg: Float32Array; bg: Float32Array } {
  const f = blurred(fgCounts);
  const b = blurred(bgCounts);
  const fg = new Float32Array(f.length);
  const bg = new Float32Array(f.length);
  const a = 0.5; // a pseudo-count each way
  for (let i = 0; i < f.length; i++) {
    const t = f[i] + b[i] + 2 * a;
    fg[i] = -Math.log((f[i] + a) / t);
    bg[i] = -Math.log((b[i] + a) / t);
  }
  return { fg, bg };
}

/**
 * The refined mask (1 = subject) inside `region`, or null when the refinement shouldn't be trusted (too little
 * background to learn from, or a result wildly different from the first mask). `mask` is the first mask after
 * clutter removal; pixels outside `region` are left at 0.
 */
export function refineSubject(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  mask: Uint8Array,
  region: Rect,
  /** Where the subject is (GrabCut's rectangle), e.g. what the smart crop picked; else the first mask's box. */
  subjectBox?: Rect,
  /**
   * Pixels known to be background although inside the subject's box (shadows found by removeShadows): sure
   * background. Otherwise a shadow tinted like the subject (a red apple's) is learnt as subject and put back.
   */
  knownBackground?: Uint8Array,
): Uint8Array | null {
  const { x0, y0, x1, y1 } = bounds(region, width, height);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const k = Math.max(1, Math.ceil(Math.max(rw, rh) / WORK));
  const sw = Math.ceil(rw / k);
  const sh = Math.ceil(rh / k);
  const n = sw * sh;
  if (sw < 8 || sh < 8) return null;
  // The small copy: mean colour and subject share per cell. Integer sums, and each column's cell worked out once:
  // this pass touches every pixel of the region, on every live frame.
  const colCell = new Int32Array(rw);
  for (let x = 0; x < rw; x++) colCell[x] = (x / k) | 0;
  const sr = new Uint32Array(n);
  const sg = new Uint32Array(n);
  const sb = new Uint32Array(n);
  const sf = new Uint32Array(n);
  const sc = new Uint32Array(n);
  const sk = new Uint32Array(n);
  let firstArea = 0;
  let bx0 = width;
  let by0 = height;
  let bx1 = -1;
  let by1 = -1;
  for (let y = y0; y < y1; y++) {
    const rowCell = (((y - y0) / k) | 0) * sw;
    let p = y * width + x0;
    let hit = false;
    for (let x = 0; x < rw; x++, p++) {
      const c = rowCell + colCell[x];
      const i = p * 3;
      sr[c] += rgb[i];
      sg[c] += rgb[i + 1];
      sb[c] += rgb[i + 2];
      sc[c]++;
      if (knownBackground?.[p]) sk[c]++;
      if (mask[p]) {
        sf[c]++;
        firstArea++;
        if (!hit) {
          hit = true;
          if (x0 + x < bx0) bx0 = x0 + x;
        }
        if (x0 + x > bx1) bx1 = x0 + x;
      }
    }
    if (hit) {
      if (y < by0) by0 = y;
      by1 = y;
    }
  }
  if (!firstArea) return null;
  if (subjectBox) {
    bx0 = subjectBox.x;
    by0 = subjectBox.y;
    bx1 = subjectBox.x + subjectBox.width - 1;
    by1 = subjectBox.y + subjectBox.height - 1;
  }
  const cr = new Float32Array(n);
  const cg = new Float32Array(n);
  const cb = new Float32Array(n);
  const frac = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const m = sc[c] || 1;
    cr[c] = sr[c] / m;
    cg[c] = sg[c] / m;
    cb[c] = sb[c] / m;
    frac[c] = sf[c] / m;
  }
  // Sure background: the edge ring of the region where the first mask says background, and everything beyond
  // the subject's box plus a margin.
  const mx = (bx1 - bx0 + 1) * BOX_MARGIN;
  const my = (by1 - by0 + 1) * BOX_MARGIN;
  const inBox = (cx: number, cy: number) => {
    const x = x0 + (cx + 0.5) * k;
    const y = y0 + (cy + 0.5) * k;
    return x >= bx0 - mx && x <= bx1 + mx && y >= by0 - my && y <= by1 + my;
  };
  const sure = new Uint8Array(n);
  let sureCount = 0;
  for (let cy = 0; cy < sh; cy++)
    for (let cx = 0; cx < sw; cx++) {
      const c = cy * sw + cx;
      const edge = cx === 0 || cy === 0 || cx === sw - 1 || cy === sh - 1;
      if ((edge && frac[c] < 0.5) || !inBox(cx, cy) || sk[c] * 2 > sc[c]) {
        sure[c] = 1;
        sureCount++;
      }
    }
  // Too little known background to learn its colours (the subject fills the picture): leave it.
  if (sureCount < Math.max(20, n * 0.05)) return null;

  const bin = new Int32Array(n);
  for (let c = 0; c < n; c++) bin[c] = binOf(cr[c], cg[c], cb[c]);

  // Neighbour weights: high between similar colours, low across an edge (GrabCut's contrast term).
  let sum = 0;
  let pairs = 0;
  const diff2 = (a: number, b: number) => (cr[a] - cr[b]) ** 2 + (cg[a] - cg[b]) ** 2 + (cb[a] - cb[b]) ** 2;
  for (let cy = 0; cy < sh; cy++)
    for (let cx = 0; cx < sw; cx++) {
      const c = cy * sw + cx;
      if (cx + 1 < sw) {
        sum += diff2(c, c + 1);
        pairs++;
      }
      if (cy + 1 < sh) {
        sum += diff2(c, c + sw);
        pairs++;
      }
    }
  const beta = 1 / (2 * Math.max(1, sum / Math.max(1, pairs)));

  let label: Uint8Array = new Uint8Array(n);
  for (let c = 0; c < n; c++) label[c] = !sure[c] && frac[c] >= 0.5 ? 1 : 0;
  let costs: { fg: Float32Array; bg: Float32Array } | null = null;
  for (let iter = 0; iter < 2; iter++) {
    // Colour models: the subject from what is labelled subject; the background from the sure background and,
    // after the first cut, everything labelled background.
    const fh = new Float64Array(BINS ** 3);
    const bh = new Float64Array(BINS ** 3);
    for (let c = 0; c < n; c++) {
      if (label[c]) fh[bin[c]]++;
      else if (sure[c] || iter > 0) bh[bin[c]]++;
    }
    costs = colourCosts(fh, bh);
    const { fg: fgCost, bg: bgCost } = costs;
    const g = gridGraph(sw, sh);
    for (let cy = 0; cy < sh; cy++)
      for (let cx = 0; cx < sw; cx++) {
        const c = cy * sw + cx;
        if (sure[c]) {
          g.sink[c] = 1e6;
        } else {
          // Source side = subject. source capacity = cost of calling it background, and the other way round.
          g.source[c] = bgCost[bin[c]] + PRIOR * frac[c];
          g.sink[c] = fgCost[bin[c]] + PRIOR * (1 - frac[c]);
        }
        if (cx + 1 < sw) g.right[c] = SMOOTH * Math.exp(-beta * diff2(c, c + 1));
        if (cy + 1 < sh) g.down[c] = SMOOTH * Math.exp(-beta * diff2(c, c + sw));
      }
    label = minCut(g).side;
  }

  // Back to full size. Inside a uniform block the cell's label holds; along the outline each pixel decides by its
  // own colour (which model it fits better, nudged by the first mask), so the edge is as sharp as the picture.
  // Cells on the outline (a neighbour has the other label), found once on the small grid.
  const border = new Uint8Array(n);
  for (let cy = 0; cy < sh; cy++)
    for (let cx = 0; cx < sw; cx++) {
      const c = cy * sw + cx;
      const l = label[c];
      if ((cx > 0 && label[c - 1] !== l) || (cx + 1 < sw && label[c + 1] !== l) || (cy > 0 && label[c - sw] !== l) || (cy + 1 < sh && label[c + sw] !== l))
        border[c] = sure[c] ? 0 : 1;
    }
  const out = new Uint8Array(width * height);
  let area = 0;
  const fm = costs!.fg;
  const bm = costs!.bg;
  for (let y = y0; y < y1; y++) {
    const rowCell = (((y - y0) / k) | 0) * sw;
    let p = y * width + x0;
    for (let x = 0; x < rw; x++, p++) {
      const c = rowCell + colCell[x];
      let v = label[c];
      if (border[c]) {
        const b = binOf(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
        v = bm[b] - fm[b] + (mask[p] ? PRIOR : -PRIOR) > 0 ? 1 : 0;
      }
      out[p] = v;
      area += v;
    }
  }
  // A result wildly different from the first mask means the colour models were fooled: keep the first mask.
  if (area < firstArea * 0.4 || area > firstArea * 2.5) return null;
  return out;
}

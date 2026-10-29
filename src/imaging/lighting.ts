/**
 * Evens out the light in a camera picture before the subject is looked for ("flat-field" or shading correction).
 *
 * A phone camera never sees paper evenly lit: the corners are darker (vignetting), a lamp makes a bright pool, a
 * window makes one side brighter. The subject is found by how far each pixel's colour is from the background's,
 * and the background is learned from the picture's edge, so uneven light makes whole areas of plain paper look
 * like subject. The background model (foreground.ts) can follow one colour, a few colours, or a straight-line
 * gradient, but not light that curves: brighter in the middle, a pool off to one side.
 *
 * So the light itself is measured and divided out, the way astronomy software removes a sky background
 * (photutils Background2D; Source Extractor) and document scanners remove shading:
 *  1. The picture is cut into cells (about 32 px). Each cell's background colour is the average of its brighter
 *     pixels (between the 60th and 90th brightness percentile): ink, pencil and shadows are darker than the paper
 *     they are on, so a cell crossed by a line still gives the paper's colour.
 *  2. A smooth surface (a polynomial of degree 4 in x and y, of each channel's logarithm: light multiplies) is fitted
 *     through the cells, robustly: cells that don't fit (inside a filled subject, a pale note, a dark object) are
 *     given less and less weight (Tukey's biweight, iteratively reweighted least squares), so the surface follows
 *     the paper alone.
 *  3. Each pixel is divided by the surface and scaled back to the paper's brightest level. Per channel, so a warm
 *     lamp's tint goes too.
 * Only when the light really is uneven (the surface varies by more than MIN_UNEVEN), the background is light enough
 * to measure, and most cells agree on it. Otherwise the picture is returned unchanged.
 *
 * Pure functions, no React Native imports.
 */

/** Cell size, pixels. */
const CELL = 32;
/** Brightness percentiles of a cell's pixels taken as its background. */
const LOW_PCT = 0.6;
const HIGH_PCT = 0.9;
/** Polynomial degree of the light surface (15 terms at degree 4). */
const DEGREE = 4;
/** The light must vary by at least this factor across the picture (brightest / darkest) to be corrected. */
export const MIN_UNEVEN = 1.12;
/** At least this share of cells must be background (fit the surface) for it to be trusted. */
const MIN_INLIERS = 0.4;
/** A background darker than this (0..255) is not corrected: dividing would only amplify noise. */
const MIN_BACKGROUND = 55;
/**
 * Light changes gradually: even a strong vignette or a lamp's pool changes by under ~8% from one cell to the next.
 * Neighbouring background cells that differ by more (log units, any channel) are a step: the edge of a card, a dark
 * object with its shadow, a checked cloth. Those are things, not light, so when more than STEP_SHARE of the
 * neighbouring background pairs step, nothing is corrected (foreground.ts handles them with its own palette and
 * shadow rules).
 */
const STEP = 0.12;
const STEP_SHARE = 0.01;
/** Tukey's biweight tuning constant (95% efficiency), and the least residual scale (log units, about 2.5%). */
const TUKEY = 4.685;
const MIN_SCALE = 0.025;

export interface LightField {
  /**
   * Light at the corners of the cells, per channel ((cols + 1) x (rows + 1) x 3, so the picture's own edges and
   * corners are included), as a factor of the paper's brightest level (<= ~1).
   */
  gain: Float32Array;
  cols: number;
  rows: number;
  /** Brightest / darkest light across the picture. */
  unevenness: number;
  /** Share of cells that fitted the surface (background). */
  inliers: number;
}

const powers = (() => {
  const p: [number, number][] = [];
  for (let d = 0; d <= DEGREE; d++) for (let i = 0; i <= d; i++) p.push([d - i, i]);
  return p;
})();

function terms(u: number, v: number, out: Float64Array) {
  for (let k = 0; k < powers.length; k++) out[k] = u ** powers[k][0] * v ** powers[k][1];
}

/** Solves the (small, symmetric) normal equations A x = b in place by Gaussian elimination with pivoting. */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-12) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) [A[c * n + k], A[p * n + k]] = [A[p * n + k], A[c * n + k]];
      [b[c], b[p]] = [b[p], b[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = s / A[r * n + r];
  }
  return x;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/** Share of neighbouring background cells (side by side or one above the other) whose colours step (see STEP). */
export function stepShare(cellLog: Float64Array, weight: Float64Array, cols: number, rows: number): number {
  let pairs = 0;
  let steps = 0;
  const check = (a: number, b: number) => {
    if (weight[a] <= 0.2 || weight[b] <= 0.2) return;
    pairs++;
    for (let ch = 0; ch < 3; ch++)
      if (Math.abs(cellLog[a * 3 + ch] - cellLog[b * 3 + ch]) > STEP) {
        steps++;
        return;
      }
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x;
      if (x + 1 < cols) check(c, c + 1);
      if (y + 1 < rows) check(c, c + cols);
    }
  return pairs ? steps / pairs : 0;
}

/** The light across the picture, or null when it can't be measured (too few cells agree, a dark background). */
export function measureLight(rgb: ArrayLike<number>, width: number, height: number): LightField | null {
  const cols = Math.max(4, Math.round(width / CELL));
  const rows = Math.max(4, Math.round(height / CELL));
  const n = cols * rows;
  const cellLog = new Float64Array(n * 3);
  const valid = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * width) / cols);
      const x1 = Math.floor(((cx + 1) * width) / cols);
      const y0 = Math.floor((cy * height) / rows);
      const y1 = Math.floor(((cy + 1) * height) / rows);
      hist.fill(0);
      let count = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 3;
          hist[(rgb[i] * 77 + rgb[i + 1] * 150 + rgb[i + 2] * 29) >> 8]++;
          count++;
        }
      if (!count) continue;
      // Brightness range of the cell's background: between the two percentiles.
      let lo = 0;
      let hi = 255;
      for (let v = 0, acc = 0; v < 256; v++) {
        acc += hist[v];
        if (acc < count * LOW_PCT) lo = v + 1;
        if (acc < count * HIGH_PCT) hi = v + 1;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let k = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 3;
          const l = (rgb[i] * 77 + rgb[i + 1] * 150 + rgb[i + 2] * 29) >> 8;
          if (l < lo || l > hi) continue;
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
          k++;
        }
      if (!k) continue;
      const c = cy * cols + cx;
      cellLog[c * 3] = Math.log(Math.max(1, r / k));
      cellLog[c * 3 + 1] = Math.log(Math.max(1, g / k));
      cellLog[c * 3 + 2] = Math.log(Math.max(1, b / k));
      valid[c] = 1;
    }

  // Robust fit: Tukey-weighted least squares, the weights recomputed from the residuals each round.
  const m = powers.length;
  const t = new Float64Array(m);
  const basis = new Float64Array(n * m);
  for (let c = 0; c < n; c++) {
    terms(((c % cols) + 0.5) / cols * 2 - 1, (Math.floor(c / cols) + 0.5) / rows * 2 - 1, t);
    basis.set(t, c * m);
  }
  const weight = new Float64Array(n);
  for (let c = 0; c < n; c++) weight[c] = valid[c];
  let coef: Float64Array[] = [];
  const resid = new Float64Array(n);
  for (let round = 0; round < 10; round++) {
    coef = [];
    for (let ch = 0; ch < 3; ch++) {
      const A = new Float64Array(m * m);
      const bv = new Float64Array(m);
      for (let c = 0; c < n; c++) {
        const w = weight[c];
        if (!w) continue;
        const o = c * m;
        const y = cellLog[c * 3 + ch];
        for (let i = 0; i < m; i++) {
          const wi = w * basis[o + i];
          bv[i] += wi * y;
          for (let j = i; j < m; j++) A[i * m + j] += wi * basis[o + j];
        }
      }
      for (let i = 0; i < m; i++) for (let j = 0; j < i; j++) A[i * m + j] = A[j * m + i];
      const x = solve(A, bv, m);
      if (!x) return null;
      coef.push(x);
    }
    // A cell's residual: its worst channel (a pale yellow note is close in brightness, far in blue).
    const fitted: number[] = [];
    for (let c = 0; c < n; c++) {
      if (!valid[c]) continue;
      let worst = 0;
      for (let ch = 0; ch < 3; ch++) {
        let f = 0;
        for (let i = 0; i < m; i++) f += coef[ch][i] * basis[c * m + i];
        worst = Math.max(worst, Math.abs(cellLog[c * 3 + ch] - f));
      }
      resid[c] = worst;
      fitted.push(worst);
    }
    const scale = Math.max(MIN_SCALE, 1.4826 * median(fitted));
    for (let c = 0; c < n; c++) {
      if (!valid[c]) continue;
      const u = resid[c] / (TUKEY * scale);
      weight[c] = u < 1 ? (1 - u * u) ** 2 : 0;
    }
  }

  let inlierCount = 0;
  let validCount = 0;
  for (let c = 0; c < n; c++) {
    if (!valid[c]) continue;
    validCount++;
    if (weight[c] > 0.2) inlierCount++;
  }
  const inliers = validCount ? inlierCount / validCount : 0;
  if (inliers < MIN_INLIERS) return null;
  if (stepShare(cellLog, weight, cols, rows) > STEP_SHARE) return null;

  // The light at every cell corner, relative to its brightest level (per channel). Corners, not centres: the
  // picture's outer edge then gets the surface's own value, not the nearest centre's (the corners of a vignetted
  // picture are darker still).
  const nodes = (cols + 1) * (rows + 1);
  const logLight = new Float64Array(nodes * 3);
  const top = [-Infinity, -Infinity, -Infinity];
  let lumMin = Infinity;
  let lumMax = -Infinity;
  for (let ny = 0; ny <= rows; ny++)
    for (let nx = 0; nx <= cols; nx++) {
      const k = ny * (cols + 1) + nx;
      terms((nx / cols) * 2 - 1, (ny / rows) * 2 - 1, t);
      let lum = 0;
      for (let ch = 0; ch < 3; ch++) {
        let f = 0;
        for (let i = 0; i < m; i++) f += coef[ch][i] * t[i];
        logLight[k * 3 + ch] = f;
        top[ch] = Math.max(top[ch], f);
        lum += [0.3, 0.59, 0.11][ch] * f;
      }
      lumMin = Math.min(lumMin, lum);
      lumMax = Math.max(lumMax, lum);
    }
  if (Math.exp(lumMax) < MIN_BACKGROUND) return null;
  const gain = new Float32Array(nodes * 3);
  for (let k = 0; k < nodes; k++) for (let ch = 0; ch < 3; ch++) gain[k * 3 + ch] = Math.exp(logLight[k * 3 + ch] - top[ch]);
  return { gain, cols, rows, unevenness: Math.exp(lumMax - lumMin), inliers };
}

/**
 * Divides the light out (a new array), interpolating between the cell corners bilinearly. Each column's place
 * between corners is worked out once, and each row's light once, so the per-pixel work is a multiply-add.
 */
export function applyLight(rgb: ArrayLike<number>, width: number, height: number, f: LightField): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 3);
  const { cols, rows, gain } = f;
  const stride = (cols + 1) * 3;
  // The inverse of the light at every corner (multiplying is cheaper than dividing).
  const inv = new Float32Array(gain.length);
  for (let k = 0; k < gain.length; k++) inv[k] = 1 / Math.max(0.05, gain[k]);
  const colNode = new Int32Array(width);
  const colFrac = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const gx = ((x + 0.5) / width) * cols;
    const x0 = Math.min(cols - 1, Math.floor(gx));
    colNode[x] = x0 * 3;
    colFrac[x] = gx - x0;
  }
  const row = new Float32Array(stride);
  for (let y = 0; y < height; y++) {
    const gy = ((y + 0.5) / height) * rows;
    const y0 = Math.min(rows - 1, Math.floor(gy));
    const fy = gy - y0;
    const a = y0 * stride;
    for (let k = 0; k < stride; k++) row[k] = inv[a + k] * (1 - fy) + inv[a + stride + k] * fy;
    let i = y * width * 3;
    for (let x = 0; x < width; x++, i += 3) {
      const n = colNode[x];
      const fx = colFrac[x];
      const gx = 1 - fx;
      out[i] = rgb[i] * (row[n] * gx + row[n + 3] * fx);
      out[i + 1] = rgb[i + 1] * (row[n + 1] * gx + row[n + 4] * fx);
      out[i + 2] = rgb[i + 2] * (row[n + 2] * gx + row[n + 5] * fx);
    }
  }
  return out;
}

const cache = new WeakMap<object, ArrayLike<number>>();

/**
 * The picture with its light evened out, or the picture itself when the light is even enough already or can't be
 * measured. Kept per picture (the same frame is analysed more than once: the smart crop, then the pins).
 */
export function evenLight(rgb: ArrayLike<number>, width: number, height: number): ArrayLike<number> {
  const key = rgb as unknown as object;
  const hit = cache.get(key);
  if (hit) return hit;
  const f = measureLight(rgb, width, height);
  const out = f && f.unevenness >= MIN_UNEVEN ? applyLight(rgb, width, height, f) : rgb;
  cache.set(key, out);
  // Already even: passing the result in again (smartSubject hands it to findForeground) costs nothing.
  if (out !== rgb) cache.set(out, out);
  return out;
}

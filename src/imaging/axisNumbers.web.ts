/**
 * Reads the numbers along a graph's axes in the browser, with Tesseract.js (Apache-2.0, WebAssembly, served by
 * the app itself from public/tesseract: works offline, costs nothing, loaded on first use only).
 *
 * The working image is too small for text (labels end up ~5 px tall), so the numbers are read from the
 * full-resolution source: the original picture, or the live share's current video frame. Each number is
 * found first (findLabelBoxes) and read on its own, enlarged: whole-band OCR misses single digits.
 */
import { APP_BASE, loadScript } from './webScript';
import type { Rect } from './geometry';
import { type AxisReading, findLabelBoxes } from './graph';

/** Where the picture comes from: the original image (URL), the live share's video, or pixels (a flattened page). */
export interface AxisNumberSource {
  uri?: string;
  video?: HTMLVideoElement;
  pixels?: { rgb: ArrayLike<number>; width: number; height: number };
}

interface TesseractWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
}
interface TesseractModule {
  createWorker(lang: string, oem: number, options: Record<string, unknown>): Promise<TesseractWorker>;
}

const url = (p: string) => new URL(`${APP_BASE}/tesseract/${p}`, window.location.href).href;

let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker() {
  workerPromise ??= (async () => {
    const w = window as unknown as { Tesseract?: TesseractModule };
    if (!w.Tesseract) await loadScript(url('tesseract.min.js'), 'number reader');
    const worker = await w.Tesseract!.createWorker('eng', 1, {
      workerPath: url('worker.min.js'),
      corePath: url('core'),
      langPath: url('lang'),
      gzip: true,
      workerBlobURL: false,
    });
    // One word per image; only what axis numbers are made of.
    await worker.setParameters({ tessedit_pageseg_mode: '8', tessedit_char_whitelist: '0123456789.-' });
    return worker;
  })().catch((e) => {
    workerPromise = null; // allow a retry
    throw e;
  });
  return workerPromise;
}

/** The source drawn at full resolution. */
async function fullResolution(source: AxisNumberSource): Promise<HTMLCanvasElement | null> {
  let el: CanvasImageSource;
  let w: number;
  let h: number;
  if (source.pixels) {
    const { rgb, width, height } = source.pixels;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const img = new ImageData(width, height);
    for (let p = 0; p < width * height; p++) {
      img.data[p * 4] = rgb[p * 3];
      img.data[p * 4 + 1] = rgb[p * 3 + 1];
      img.data[p * 4 + 2] = rgb[p * 3 + 2];
      img.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  if (source.video && source.video.videoWidth > 0) {
    el = source.video;
    w = source.video.videoWidth;
    h = source.video.videoHeight;
  } else if (source.uri) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = source.uri;
    await img.decode();
    el = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  } else return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(el, 0, 0, w, h);
  return canvas;
}

/** One number, enlarged to ~40 px tall, as clean black on white (what OCR reads best). */
function wordImage(band: ImageData, box: Rect): HTMLCanvasElement {
  const pad = Math.max(2, Math.round(box.height * 0.25));
  const x0 = Math.max(0, box.x - pad);
  const y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(band.width, box.x + box.width + pad);
  const y1 = Math.min(band.height, box.y + box.height + pad);
  const crop = document.createElement('canvas');
  crop.width = x1 - x0;
  crop.height = y1 - y0;
  crop.getContext('2d')!.putImageData(band, -x0, -y0, x0, y0, x1 - x0, y1 - y0);
  // Enlarge (smoothly), then threshold halfway between the paper and the ink: black ink on white, either theme.
  const k = Math.max(1, 40 / box.height);
  const big = document.createElement('canvas');
  big.width = Math.round(crop.width * k);
  big.height = Math.round(crop.height * k);
  const bctx = big.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(crop, 0, 0, big.width, big.height);
  const img = bctx.getImageData(0, 0, big.width, big.height);
  const d = img.data;
  const lum = new Float32Array(d.length / 4);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort();
  const paper = sorted[Math.floor(sorted.length / 2)];
  const dark = paper < 110;
  const ink = dark ? sorted[sorted.length - 1] : sorted[0];
  const t = (paper + ink) / 2;
  for (let i = 0; i < lum.length; i++) {
    const v = (dark ? lum[i] > t : lum[i] < t) ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  // A white margin around it.
  const margin = 16;
  const out = document.createElement('canvas');
  out.width = big.width + 2 * margin;
  out.height = big.height + 2 * margin;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(big, margin, margin);
  return out;
}

/** The number in OCR text. Small decimal points are often lost: an axis number never starts "0" + digit, so "02" is 0.2. */
function parseNumber(text: string): number | null {
  let s = text.replace(/[−–—]/g, '-').replace(/[^0-9.-]/g, '');
  if (!/\d/.test(s)) return null;
  s = s.replace(/(?!^)-/g, '').replace(/^(-?)0(\d)/, (_, sign: string, digit: string) => `${sign}0.${digit}`);
  const v = Number(s);
  return Number.isFinite(v) && Math.abs(v) < 1e7 ? v : null;
}

/**
 * Reads the numbers in the given bands (working-image pixels, see labelBands) from the full-resolution source.
 * Resolves to whatever could be read (possibly nothing); rejects only if the reader can't load.
 */
export async function readAxisNumbers(
  source: AxisNumberSource,
  workingWidth: number,
  bands: { axis: 'x' | 'y'; rect: Rect }[],
): Promise<AxisReading[]> {
  if (!bands.length) return [];
  const canvas = await fullResolution(source);
  if (!canvas) return [];
  const worker = await getWorker();
  const f = canvas.width / workingWidth;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const out: AxisReading[] = [];
  for (const b of bands) {
    const sx = Math.max(0, Math.round(b.rect.x * f));
    const sy = Math.max(0, Math.round(b.rect.y * f));
    const sw = Math.min(canvas.width - sx, Math.round(b.rect.width * f));
    const sh = Math.min(canvas.height - sy, Math.round(b.rect.height * f));
    if (sw < 4 || sh < 4) continue;
    const band = ctx.getImageData(sx, sy, sw, sh);
    // At most 24 numbers per band (a dense axis); they're all alike, so a sample is plenty.
    const boxes = findLabelBoxes(band.data, sw, sh).slice(0, 24);
    for (const box of boxes) {
      const { data } = await worker.recognize(wordImage(band, box));
      const value = parseNumber(data.text);
      if (value === null || data.confidence < 30) continue;
      const at = b.axis === 'x' ? (sx + box.x + box.width / 2) / f : (sy + box.y + box.height / 2) / f;
      out.push({ axis: b.axis, value, at });
    }
  }
  return out;
}

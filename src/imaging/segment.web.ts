/**
 * Smart Cut-Out in the browser: the U²-Net (small) salient-object model
 * (Apache-2.0, 4.4 MB, public/models/u2netp.onnx) run with ONNX Runtime Web
 * (MIT, WebAssembly, public/ort/). Both are served by the app itself, so this
 * works offline and costs nothing. Loaded on first use only.
 */
import type * as Ort from 'onnxruntime-web';

export interface SegmentInput {
  rgb: ArrayLike<number>;
  width: number;
  height: number;
  fileUri?: string;
}

const SIZE = 320; // the model's input size
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export const smartCutoutAvailable = typeof window !== 'undefined' && typeof WebAssembly === 'object';

let sessionPromise: Promise<{ ort: typeof Ort; session: Ort.InferenceSession }> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the cut-out engine'));
    document.head.appendChild(s);
  });
}

function getSession() {
  sessionPromise ??= (async () => {
    const w = window as unknown as { ort?: typeof Ort };
    if (!w.ort) await loadScript('/ort/ort.wasm.min.js');
    const ort = w.ort!;
    ort.env.wasm.wasmPaths = '/ort/';
    ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which a static host may not have
    const session = await ort.InferenceSession.create('/models/u2netp.onnx', { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((e) => {
    sessionPromise = null; // allow a retry
    throw e;
  });
  return sessionPromise;
}

/** Bilinear sample of a size x size map at (x, y) in that map's pixels. */
function bilinear(map: Float32Array, size: number, x: number, y: number) {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const top = map[y0 * size + x0] * (1 - fx) + map[y0 * size + x1] * fx;
  const bottom = map[y1 * size + x0] * (1 - fx) + map[y1 * size + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Subject probability 0..1 per pixel (width x height), or null when no subject was found. */
export async function segmentSubject(input: SegmentInput): Promise<Float32Array | null> {
  const { ort, session } = await getSession();
  const { rgb, width, height } = input;

  // Resize to 320 x 320 with the browser's smoothing.
  const src = document.createElement('canvas');
  src.width = width;
  src.height = height;
  const rgba = new ImageData(width, height);
  for (let p = 0; p < width * height; p++) {
    rgba.data[p * 4] = rgb[p * 3];
    rgba.data[p * 4 + 1] = rgb[p * 3 + 1];
    rgba.data[p * 4 + 2] = rgb[p * 3 + 2];
    rgba.data[p * 4 + 3] = 255;
  }
  src.getContext('2d')!.putImageData(rgba, 0, 0);
  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;

  // Planar, ImageNet-normalised input: [1, 3, 320, 320].
  const input3 = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) input3[c * SIZE * SIZE + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input3, [1, 3, SIZE, SIZE]) };
  const output = (await session.run(feeds))[session.outputNames[0]].data as Float32Array;

  // Normalise to 0..1, like rembg does.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (output[i] < min) min = output[i];
    if (output[i] > max) max = output[i];
  }
  if (!(max - min > 1e-6)) return null;
  const map = new Float32Array(SIZE * SIZE);
  let strong = 0;
  for (let i = 0; i < map.length; i++) {
    map[i] = (output[i] - min) / (max - min);
    if (map[i] >= 0.5) strong++;
  }
  if (strong < map.length * 0.002) return null;

  // Back to the image's size.
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = ((y + 0.5) * SIZE) / height - 0.5;
    for (let x = 0; x < width; x++) out[y * width + x] = bilinear(map, SIZE, ((x + 0.5) * SIZE) / width - 0.5, sy);
  }
  return out;
}

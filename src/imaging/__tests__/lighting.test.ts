import { GRID } from '@/config/hardware';
import { DEFAULT_MIN_PIECE_RATIO, findForeground, strokeWidth, toRgb } from '../foreground';
import { evenLight, measureLight } from '../lighting';
import { cellSizePx, inkFromMask, patternFromSamples, sampleCrop, thickenThinLines } from '../pinSampling';
import { smartSubject } from '../smartCrop';
import { cameraScene, H, LIGHTS, noise, SUBJECTS, W } from './support/cameraScenes';

const light = (name: string) => LIGHTS.find((l) => l.name === name)!;
const subject = (name: string) => SUBJECTS.find((s) => s.name === name)!;

const boxOf = (m: Uint8Array) => {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (m[y * W + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
};
const pins = (m: Uint8Array, box: ReturnType<typeof boxOf>, stroke: number) => {
  const cell = cellSizePx(box, GRID.rows, GRID.cols, GRID.pinPitchRatio, false);
  const s = sampleCrop(inkFromMask(thickenThinLines(m, W, H, stroke, cell)), W, H, box, GRID.rows, GRID.cols, GRID.pinPitchRatio, false);
  return patternFromSamples(s, GRID.rows, GRID.cols, 0.35, false).cells;
};

/** The camera path (as useImageConversion runs it): how much of the subject is found, and how many pins are wrong. */
function run(subjectName: string, lightName: string) {
  const { raster, truth } = cameraScene(subject(subjectName), light(lightName));
  const rgb = toRgb(raster);
  const opts = { tolerance: 'auto' as const, minPieceRatio: DEFAULT_MIN_PIECE_RATIO, removeLines: 'auto' as const, camera: true };
  const smart = smartSubject(rgb, W, H, opts);
  const fg = findForeground(rgb, W, H, {
    ...opts,
    region: smart.context,
    refine: true,
    subjectBox: smart.kind === 'shape' ? smart.box : undefined,
    subjectMask: smart.kind === 'curves' ? smart.mask : undefined,
  });
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < W * H; i++) {
    if (fg.mask[i] && truth[i]) inter++;
    if (fg.mask[i] || truth[i]) uni++;
  }
  const want = pins(truth, boxOf(truth), strokeWidth(truth, W, H));
  const got = pins(fg.mask, smart.box, fg.strokeWidth);
  return { overlap: inter / uni, wrongPins: want.filter((v, i) => v !== got[i]).length };
}

describe('camera pictures in uneven light', () => {
  // Before the light was evened out, all of these failed: the darker corners (or the bright pool) made the paper
  // itself look like subject. Overlap 0.02-0.41 and 4-16 wrong pins each.
  for (const lightName of ['vignette', 'lamp'])
    for (const subjectName of ['red disc', 'blue triangle', 'black star outline', 'yellow note', 'marker wave'])
      it(`${subjectName}, ${lightName}: every pin right`, () => {
        const r = run(subjectName, lightName);
        expect(r.wrongPins).toBe(0);
        expect(r.overlap).toBeGreaterThan(0.9);
      });

  it('a window on one side and dim warm light stay right too', () => {
    for (const lightName of ['window', 'dim warm', 'everything']) expect(run('blue triangle', lightName).wrongPins).toBe(0);
  });
});

describe('measuring the light', () => {
  it('evenly lit: the picture is left exactly as it is', () => {
    const rgb = toRgb(cameraScene(subject('red disc'), light('even')).raster);
    expect(evenLight(rgb, W, H)).toBe(rgb);
  });

  it('follows a vignette closely, the corners included, and ignores the subject on it', () => {
    const L = light('vignette');
    const f = measureLight(toRgb(cameraScene(subject('red disc'), L).raster), W, H)!;
    const top = L.light(W / 2, H / 2);
    const at = (nx: number, ny: number) => f.gain[(ny * (f.cols + 1) + nx) * 3 + 1];
    for (const [nx, ny] of [[0, 0], [f.cols, 0], [0, f.rows], [f.cols, f.rows], [f.cols >> 1, f.rows >> 1], [f.cols >> 1, 0]])
      expect(Math.abs(at(nx, ny) - L.light((nx / f.cols) * W, (ny / f.rows) * H) / top)).toBeLessThan(0.04);
  });

  it('a bright card on a dark desk is a thing, not light: nothing is corrected', () => {
    const n = noise(3);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const card = x > 150 && x < 490 && y > 100 && y < 380;
        const o = (y * W + x) * 4;
        const v = card ? [240, 238, 232] : [96, 72, 52];
        for (let c = 0; c < 3; c++) data[o + c] = v[c] + n(3);
        data[o + 3] = 255;
      }
    const rgb = toRgb({ width: W, height: H, data, channels: 4 });
    expect(measureLight(rgb, W, H)).toBeNull();
    expect(evenLight(rgb, W, H)).toBe(rgb);
  });

  it('corrects a frame in a few milliseconds', () => {
    const rgb = toRgb(cameraScene(subject('red disc'), light('lamp')).raster);
    measureLight(rgb, W, H);
    const t = performance.now();
    for (let k = 0; k < 5; k++) evenLight(rgb.slice(), W, H);
    // Generous: about 7 ms here, and a phone is slower.
    expect((performance.now() - t) / 5).toBeLessThan(60);
  });
});

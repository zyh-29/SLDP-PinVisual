import { createEmptyPattern, togglePin } from '@/domain/pattern';
import { denoiseFrame, FocusGate, frameLight, LightGate, sharpness, steadyPins, viewMoved, viewSketch, viewStill } from '../cameraFrame';
import { toRgb } from '../foreground';
import { smartSubject, isPhotoLike } from '../smartCrop';

/** Deterministic noise (a camera's sensor noise), roughly ±amp per channel. */
function noise(seed: number) {
  let s = seed >>> 0;
  return (amp: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    const u1 = (s & 0xffff) / 0x10000;
    s = (s * 1664525 + 1013904223) >>> 0;
    const u2 = (s & 0xffff) / 0x10000;
    return (u1 + u2 - 1) * amp * 1.7;
  };
}

/** A phone camera's view of a worksheet with two graphs: 640 x 288, noisy, slightly uneven light. */
function cameraWorksheet(seed = 1) {
  const W = 640;
  const H = 288;
  const n = noise(seed);
  const plots = [
    { x: 16, y: 24, w: 272, h: 240 },
    { x: 352, y: 24, w: 272, h: 240 },
  ];
  const data = new Uint8ClampedArray(W * H * 4);
  const parabola = (x: number) => 80 + 0.012 * (x - 152) ** 2;
  const line = (x: number) => 144 - 0.9 * (x - 488);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = [240, 240, 238];
      plots.forEach((p, i) => {
        if (x < p.x || x >= p.x + p.w || y < p.y || y >= p.y + p.h) return;
        const cx = p.x + p.w / 2;
        const cy = p.y + p.h / 2;
        c = [252, 252, 250];
        if ((x - cx) % 24 === 0 || (y - cy) % 24 === 0) c = [212, 212, 212];
        if (Math.abs(x - cx) < 1.5 || Math.abs(y - cy) < 1.5) c = [110, 110, 110];
        const f = i === 0 ? parabola : line;
        const slope = f(x + 0.5) - f(x - 0.5);
        if (Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, slope) <= 1.6) c = i === 0 ? [199, 68, 64] : [45, 112, 179];
      });
      const light = -10 * (x / W); // a little darker to one side
      for (let k = 0; k < 3; k++) data[(y * W + x) * 4 + k] = c[k] + light + n(6);
      data[(y * W + x) * 4 + 3] = 255;
    }
  return { W, H, data };
}

const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };

describe('camera frames', () => {
  it('raw camera noise makes a worksheet look like a photo; denoised, it is a flat picture again', () => {
    const { W, H, data } = cameraWorksheet();
    const raster = (d: Uint8ClampedArray) => ({ width: W, height: H, data: d, channels: 4 as const });
    expect(isPhotoLike(toRgb(raster(data)), W, H)).toBe(true);
    const clean = Uint8ClampedArray.from(data);
    denoiseFrame(clean, W, H);
    expect(isPhotoLike(toRgb(raster(clean)), W, H)).toBe(false);
  });

  it('after denoising, the graphs are found, and a tap picks one of them', () => {
    const { W, H, data } = cameraWorksheet(7);
    denoiseFrame(data, W, H);
    const rgb = toRgb({ width: W, height: H, data, channels: 4 });
    const auto = smartSubject(rgb, W, H, opts);
    expect(auto.kind).toBe('curves');
    const left = smartSubject(rgb, W, H, opts, undefined, { x: 40, y: 250 });
    expect(left.kind).toBe('curves');
    expect(left.box.x + left.box.width).toBeLessThan(300);
    const right = smartSubject(rgb, W, H, opts, undefined, { x: 600, y: 40 });
    expect(right.box.x).toBeGreaterThan(340);
  });

  it('keeps alpha, handles tiny frames, and leaves a flat picture flat', () => {
    const d = new Uint8ClampedArray(4 * 4 * 4).fill(100);
    for (let i = 3; i < d.length; i += 4) d[i] = 200;
    denoiseFrame(d, 4, 4);
    expect(Array.from(d.slice(0, 4))).toEqual([100, 100, 100, 200]);
    const tiny = new Uint8ClampedArray([1, 2, 3, 4]);
    denoiseFrame(tiny, 1, 1);
    expect(Array.from(tiny)).toEqual([1, 2, 3, 4]);
  });
});

describe('focus: sharpness and the blur gate', () => {
  /** A page of thin dark strokes; `blur` box-blurs it that many times (a camera out of focus). */
  function page(blur: number) {
    const W = 160;
    const H = 120;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ink = x % 16 < 2 || (y % 20 < 2 && x > 30) || Math.abs(y - 0.5 * x) < 1.2;
        d.set(ink ? [40, 40, 40, 255] : [235, 235, 230, 255], (y * W + x) * 4);
      }
    for (let i = 0; i < blur; i++) denoiseFrame(d, W, H);
    return sharpness(d, W, H);
  }

  it('drops steadily as the picture goes out of focus', () => {
    const s = [0, 1, 3, 6].map(page);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThan(s[i - 1] * 0.8);
    expect(s[3]).toBeLessThan(s[0] * 0.2);
  });

  it('tells a blurred frame from a sharp one through camera noise (640 x 360 frames, noise on both)', () => {
    const W = 640;
    const H = 360;
    const make = (blur: number, seed: number) => {
      const n = noise(seed);
      const d = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const ink = (x > 200 && x < 440 && y > 80 && y < 280) || (x % 40 < 3 && y > 300);
          d.set(ink ? [240, 140, 30, 255] : [150, 110, 75, 255], (y * W + x) * 4);
        }
      for (let i = 0; i < blur; i++) denoiseFrame(d, W, H); // 3 x 3 blur, many times: a defocused lens
      for (let i = 0; i < d.length; i++) if (i % 4 !== 3) d[i] += n(10);
      return sharpness(d, W, H);
    };
    const sharp = [1, 2, 3].map((s) => make(0, s));
    const blurred = [1, 2, 3].map((s) => make(12, s));
    expect(Math.max(...blurred)).toBeLessThan(Math.min(...sharp) * 0.5);
  });

  it('skips a blurry frame while the camera refocuses, then uses the sharp ones again', () => {
    const g = new FocusGate();
    const sharp = page(0);
    const blurred = page(4);
    expect(g.accept(sharp)).toBe(true);
    expect(g.accept(sharp * 0.95)).toBe(true);
    expect(g.accept(blurred)).toBe(false);
    expect(g.blurryFor).toBe(1);
    expect(g.accept(sharp)).toBe(true);
    expect(g.blurryFor).toBe(0);
  });

  it('never freezes: after a few blurry frames in a row it uses one anyway', () => {
    const g = new FocusGate(0.5, 3);
    g.accept(1000);
    const used = Array.from({ length: 8 }, () => g.accept(100));
    expect(used.slice(0, 3)).toEqual([false, false, false]);
    expect(used[3]).toBe(true);
    expect(g.blurryFor).toBeGreaterThanOrEqual(4);
  });

  it('a plainer new scene is soon accepted as sharp (the best decays)', () => {
    const g = new FocusGate();
    g.accept(1000);
    let n = 1;
    g.accept(300);
    while (g.blurryFor > 0 && n < 40) {
      g.accept(300);
      n++;
    }
    // About 7 frames (under 2 s at 4 frames a second).
    expect(n).toBeLessThanOrEqual(8);
  });
});

describe('light: too dark, and exposure settling', () => {
  const W = 160;
  const H = 96;
  /** A frame of brightness `level` (a scene with some detail when `detail`), plus sensor noise of ±`noise`. */
  function frame(level: number, detail: boolean, noise: number, seed = 1) {
    const n = (() => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return ((s & 0xffff) / 0x10000 - 0.5) * 2 * noise;
      };
    })();
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const v = level * (detail && (x > 40 && x < 120 && y > 20 && y < 76) ? 0.35 : 1) + n();
        d.set([v, v, v, 255], (y * W + x) * 4);
      }
    return frameLight(d, W, H);
  }

  it('a black frame full of amplified noise is "too dark"; a dim scene with something in it is not', () => {
    const g = new LightGate();
    expect(g.accept(frame(10, false, 40))).toBe(false);
    expect(g.dark).toBe(true);
    const g2 = new LightGate();
    expect(g2.accept(frame(60, true, 20))).toBe(true);
    expect(g2.dark).toBe(false);
  });

  it('when the light comes back, the frames while the exposure settles are skipped, but only a few', () => {
    const g = new LightGate();
    for (let i = 0; i < 5; i++) g.accept(frame(8, false, 30, i));
    const used = [250, 230, 200, 180, 170, 168].map((lvl, i) => g.accept(frame(lvl, true, 6, i + 10)));
    // The first bright frame and the big steps after it wait; once steady (or after 3 skips) frames are used.
    expect(used[0]).toBe(false);
    expect(used.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(used[used.length - 1]).toBe(true);
  });

  it('a steady scene is never skipped', () => {
    const g = new LightGate();
    expect([1, 2, 3, 4, 5].map((s) => g.accept(frame(180, true, 8, s)))).toEqual([true, true, true, true, true]);
  });
});

describe('steady pins (no flicker on a live camera)', () => {
  const empty = createEmptyPattern(5, 8);
  const one = togglePin(empty, 2, 3);

  it('a pin that flickers on for a single frame stays down', () => {
    let s = steadyPins(null, empty);
    s = steadyPins(s, one);
    expect(s.pattern.cells[2 * 8 + 3]).toBe(0);
    s = steadyPins(s, empty);
    expect(s.pattern.cells[2 * 8 + 3]).toBe(0);
  });

  it('a real change shows within three frames, and goes away again the same way', () => {
    let s = steadyPins(null, empty);
    let frames = 0;
    while (!s.pattern.cells[2 * 8 + 3] && frames < 10) {
      s = steadyPins(s, one);
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(3);
    frames = 0;
    while (s.pattern.cells[2 * 8 + 3] && frames < 10) {
      s = steadyPins(s, empty);
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(3);
  });

  it('a pin that wobbles every other frame doesn’t blink', () => {
    let s = steadyPins(null, one);
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      s = steadyPins(s, i % 2 ? one : empty);
      seen.add(s.pattern.cells[2 * 8 + 3]);
    }
    expect(seen.size).toBe(1);
  });

  it('returns the same pattern object while nothing visible changes, and starts over on a new grid size', () => {
    const a = steadyPins(null, one);
    const b = steadyPins(a, one);
    expect(b.pattern).toBe(a.pattern);
    const other = steadyPins(b, createEmptyPattern(4, 4));
    expect(other.pattern.rows).toBe(4);
  });
});

describe('a kept scene notices when the camera turns elsewhere', () => {
  const W = 320;
  const H = 240;
  /** A scene: a dark ridge across a lighter sky, shifted by `dx`, brighter by `gain`, with a little noise. */
  const view = (dx: number, gain = 1, seed = 1, horizon = 140) => {
    const n = noise(seed);
    const rgb = new Uint8ClampedArray(W * H * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const land = y > horizon + 30 * Math.sin((x + dx) / 30);
        const v = (land ? 70 : 200) * gain + n(4);
        for (let k = 0; k < 3; k++) rgb[(y * W + x) * 3 + k] = v;
      }
    return rgb;
  };
  const sketch = (rgb: Uint8ClampedArray) => viewSketch(rgb, W, H);

  it('a hand holding still (noise, a pixel or two of tremble) is the same view', () => {
    expect(viewMoved(sketch(view(0)), sketch(view(2, 1, 2)))).toBe(false);
  });

  it('the camera brightening or dimming the whole picture is the same view', () => {
    expect(viewMoved(sketch(view(0)), sketch(view(0, 1.12, 3)))).toBe(false);
  });

  it('pointing somewhere else is a new view', () => {
    expect(viewMoved(sketch(view(0)), sketch(view(0, 1, 4, 60)))).toBe(true);
  });
});

describe('resting while nothing in view changes', () => {
  const W = 640;
  const H = 360;
  const page = (seed: number, stroke = false) => {
    const n = noise(seed);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // A drawing on paper; `stroke` adds a short pen line (3 px wide, 30 px long) in one corner.
        const ink = Math.hypot(x - W / 2, y - H / 2) < 80 || (stroke && y >= 40 && y < 43 && x >= 40 && x < 70);
        const v = (ink ? 40 : 235) + n(4);
        const i = (y * W + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    return viewSketch(rgba, W, H, 4);
  };

  it('the same view with fresh sensor noise is still', () => {
    expect(viewStill(page(1), page(2))).toBe(true);
  });

  it('a small new pen stroke in a corner is a change', () => {
    expect(viewStill(page(1), page(2, true))).toBe(false);
  });

  it('reads RGBA the same as RGB', () => {
    const rgb = new Uint8ClampedArray(W * H * 3).map((_, i) => (i * 7) % 251);
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let p = 0; p < W * H; p++) for (let k = 0; k < 3; k++) rgba[p * 4 + k] = rgb[p * 3 + k];
    expect(Array.from(viewSketch(rgba, W, H, 4))).toEqual(Array.from(viewSketch(rgb, W, H)));
  });
});

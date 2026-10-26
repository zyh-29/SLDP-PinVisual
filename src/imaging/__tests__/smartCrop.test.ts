import type { RasterImage } from '../convert';
import { cellSizePx, inkFromMask, patternFromSamples, sampleCrop, thickenThinLines } from '../pinSampling';
import { findForeground, toRgb } from '../foreground';
import type { Rect } from '../geometry';
import { findColouredCurves } from '../curves';
import { findPlotArea } from '../plotGrid';
import { flatness, isPhotoLike, PHOTO_GRAIN, pictureKind, smartSubject } from '../smartCrop';

type C = [number, number, number];

function image(w: number, h: number, px: (x: number, y: number) => C): RasterImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data, channels: 4 };
}

const opts = { tolerance: 'auto' as const, minPieceRatio: 0.15, removeLines: 'auto' as const };
/** a lies within b, with `slack` pixels of tolerance on each side. */
const near = (a: Rect, b: Rect, slack: number) =>
  Math.abs(a.x - b.x) <= slack &&
  Math.abs(a.y - b.y) <= slack &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= slack &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= slack;

const RED: C = [199, 68, 64]; // Desmos red
const BLUE: C = [45, 112, 179]; // Desmos blue

/** A Desmos-like screenshot: toolbar, expression panel with a red icon and text, plot with grid, axes, ticks and curves. */
/**
 * `focusedExpression`: the focused row, its blue icon square and outline. 'L': only the outline's bottom edge
 * survives (a live share shrinks a 1 px outline, and its top and right edges can vanish), so the square and the
 * line make an L, not a frame.
 */
function desmos(withSecondCurve = false, focusedExpression: boolean | 'L' = false): RasterImage {
  const W = 640;
  const H = 400;
  const parabola = (x: number) => 300 - 0.012 * (x - 410) ** 2;
  const slope = (x: number) => -0.024 * (x - 410);
  const line = (x: number) => 300 - 1.1 * (x - 410);
  /** Pixel is on the curve: perpendicular distance under 1.5 px, like a real 3 px stroke. */
  const onParabola = (x: number, y: number) => Math.abs(y - parabola(x)) / Math.hypot(1, slope(x)) <= 1.5;
  return image(W, H, (x, y) => {
    // Toolbar with a filled blue button and white text.
    if (y < 40) {
      if (x >= 540 && x < 600 && y >= 9 && y < 31) return [47, 114, 220];
      if (x >= 20 && x < 120 && y >= 16 && y < 24 && x % 6 < 4) return [230, 230, 230];
      return [42, 42, 42];
    }
    // Expression panel: grey, a short red wave icon and black text "y = x²".
    if (x < 180) {
      if (focusedExpression) {
        // The focused row: a solid blue icon square and a light-blue 2 px outline around the input.
        if (focusedExpression === 'L') {
          // As Desmos draws it: the icon block fills the row's left end, the outline (same blue) starts at its edge.
          if (x < 30 && y >= 56 && y < 86) return [47, 114, 220];
          if (x >= 30 && x < 176 && y >= 84 && y < 86) return [47, 114, 220];
          if (x >= 10 && x < 28 && Math.abs(y - (70 + 5 * Math.sin((x - 10) / 3))) <= 1) return RED;
          return [255, 255, 255];
        }
        if (x >= 4 && x < 24 && y >= 56 && y < 86) return [61, 90, 254];
        const inBox = x >= 30 && x < 176 && y >= 56 && y < 86;
        const onBorder = inBox && (x < 32 || x >= 174 || y < 58 || y >= 84);
        if (onBorder) return [150, 180, 240];
      }
      if (x >= 10 && x < 28 && Math.abs(y - (70 + 5 * Math.sin((x - 10) / 3))) <= 1) return RED;
      if (x >= 40 && x < 100 && y >= 64 && y < 76 && x % 7 < 5) return [20, 20, 20];
      if (x === 179) return [200, 200, 200];
      return [245, 245, 245];
    }
    // Plot area.
    if (y >= 40 && onParabola(x + 0.5, y + 0.5)) return RED;
    if (withSecondCurve && Math.abs(y - line(x)) / Math.hypot(1, 1.1) <= 1.5 && y >= 40) return BLUE;
    if (x === 410 || y === 300) return [85, 85, 85];
    if (y >= 304 && y < 312 && (x - 410) % 100 === 0 && x !== 410) return [30, 30, 30];
    if ((x - 410) % 25 === 0 || (y - 300) % 25 === 0) return [232, 232, 232];
    return [255, 255, 255];
  });
}

describe('kind of image', () => {
  it('screenshots and drawings are flat; photos are not', () => {
    const shot = desmos();
    expect(flatness(toRgb(shot), shot.width, shot.height)).toBeGreaterThan(0.6);
    expect(isPhotoLike(toRgb(shot), shot.width, shot.height)).toBe(false);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 40;
    const photo = image(200, 150, (x, y) => [100 + rand() + x * 0.2, 90 + rand(), 70 + rand() + y * 0.2]);
    expect(isPhotoLike(toRgb(photo), photo.width, photo.height)).toBe(true);
  });

  describe('whole pictures: photo or screenshot, by grain (pictureKind)', () => {
    let seed = 11;
    /** Sensor noise: a few levels either way. */
    const noise = (a: number) => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * a;
    const kind = (img: RasterImage) => pictureKind(toRgb(img), img.width, img.height);

    it('a photo with a soft, out-of-focus background (smooth, but grainy): a photo, though flatness calls it a screenshot', () => {
      // A blurred background is a smooth blend; the camera adds a little noise everywhere.
      const img = image(320, 240, (x, y) => {
        const subject = (x - 160) ** 2 / 60 ** 2 + (y - 130) ** 2 / 80 ** 2 < 1;
        const base: C = subject ? [190, 120, 60] : [90 + x * 0.25, 140 + y * 0.1, 120];
        return base.map((v) => v + noise(5)) as C;
      });
      expect(isPhotoLike(toRgb(img), img.width, img.height)).toBe(false); // the old measure is fooled
      expect(kind(img).photo).toBe(true);
    });

    it('a photo with a blown-out white wall over half of it: still a photo', () => {
      const img = image(320, 240, (x, y) => (y < 120 ? [255, 255, 255] : ([120 + noise(16), 90 + noise(16), 60 + noise(16)] as C)));
      expect(kind(img).photo).toBe(true);
    });

    it('screenshots: a Desmos graph, and a smooth gradient page with text, are not photos', () => {
      expect(kind(desmos()).photo).toBe(false);
      const page = image(400, 260, (x, y) => {
        if (y > 100 && y < 120 && x > 60 && x < 340 && x % 9 < 6) return [255, 255, 255]; // a line of text
        return [79 + (x + y) * 0.2, 70 + x * 0.25, 229 - y * 0.15]; // a diagonal gradient
      });
      expect(kind(page).grain).toBeLessThan(PHOTO_GRAIN);
      expect(kind(page).photo).toBe(false);
    });
  });
});

describe('graphs (Desmos screenshots)', () => {
  it('crops to the curve, ignoring the toolbar, button, panel, icon, text, grid, axes and ticks', () => {
    const img = desmos();
    const rgb = toRgb(img);
    const result = smartSubject(rgb, img.width, img.height, opts);
    expect(result.kind).toBe('curves');
    // Parabola visible from x = 263..557 (top of the plot at y = 40) down to its vertex at y = 300.
    expect(near(result.box, { x: 263, y: 40, width: 295, height: 262 }, 4)).toBe(true);
  });

  it('end to end: a Desmos screenshot becomes a U on the pins', () => {
    const img = desmos();
    const rgb = toRgb(img);
    const smart = smartSubject(rgb, img.width, img.height, opts);
    // The curve's own colour is the subject: no background guessing near the toolbar or panel.
    const fg = findForeground(rgb, img.width, img.height, { ...opts, region: smart.context, subjectMask: smart.mask });
    const thick = thickenThinLines(fg.mask, img.width, img.height, fg.strokeWidth, cellSizePx(smart.box, 5, 8, 1, true));
    const s = sampleCrop(inkFromMask(thick), img.width, img.height, smart.box, 5, 8, 1, true);
    const rows = Array.from({ length: 5 }, (_, r) =>
      patternFromSamples(s, 5, 8, 0.35, false)
        .cells.slice(r * 8, r * 8 + 8)
        .join(''),
    );
    expect(rows[0][0]).toBe('1');
    expect(rows[0][7]).toBe('1');
    expect(rows[0].slice(2, 6)).toBe('0000'); // open at the top
    expect(rows[4].slice(3, 5)).toBe('11'); // vertex at the bottom middle
    expect(rows).toEqual(rows.map((r) => [...r].reverse().join(''))); // symmetric, like the parabola
  });

  it('ignores the focused expression row (blue icon square, input outline) even when the box includes it', () => {
    const img = desmos(false, true);
    const rgb = toRgb(img);
    // Like the screenshot: the box takes in the expression panel but only part of the curve (its left arm).
    const box = { x: 0, y: 45, width: 330, height: 270 };
    const result = smartSubject(rgb, img.width, img.height, opts, box);
    expect(result.kind).toBe('curves');
    // Only the parabola's left arm (from x = 263), not the panel at x < 180.
    expect(result.box.x).toBeGreaterThan(250);
    expect(result.mask![70 * img.width + 10]).toBe(0); // blue icon square
    expect(result.mask![57 * img.width + 100]).toBe(0); // input outline
    expect(result.mask![Math.round(300 - 0.012 * 140 ** 2) * img.width + 550]).toBe(0); // the right arm, outside the box
  });

  it('ignores a focused row that looks like an L (icon square and the bottom edge of its outline): not a curve', () => {
    const img = desmos(false, 'L');
    const rgb = toRgb(img);
    const view = { range: { kind: 'whole' as const }, scale: null, rows: 5, cols: 8, pinPitchRatio: 1, followZoom: true };
    const result = smartSubject(rgb, img.width, img.height, opts, undefined, undefined, view);
    expect(result.kind).toBe('curves');
    // The parabola only (x = 263..557), not the expression panel (x < 180).
    expect(near(result.box, { x: 263, y: 40, width: 295, height: 262 }, 4)).toBe(true);
    expect(result.mask![70 * img.width + 10]).toBe(0); // blue icon square
    expect(result.mask![85 * img.width + 100]).toBe(0); // the outline's bottom edge
  });

  it('finds the curve when the whole screen is shared, photo wallpaper and all', () => {
    // A noisy photo-like wallpaper fills the screen; the Desmos window sits in the middle.
    const app = desmos(false, true);
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 60;
    const W = 1400;
    const H = 900;
    const img = image(W, H, (x, y) => {
      const ax = x - 180;
      const ay = y - 120;
      if (ax >= 0 && ax < 640 && ay >= 0 && ay < 400) {
        const i = (ay * 640 + ax) * 4;
        return [app.data[i], app.data[i + 1], app.data[i + 2]] as C;
      }
      return [Math.round(60 + rand() + x * 0.05), Math.round(90 + rand()), Math.round(120 + rand() + y * 0.05)];
    });
    const rgb = toRgb(img);
    expect(isPhotoLike(rgb, W, H)).toBe(true); // the frame as a whole looks like a photo
    const result = smartSubject(rgb, W, H, opts);
    expect(result.kind).toBe('curves');
    expect(result.box.x).toBeGreaterThan(180 + 250); // inside the Desmos plot, not the panel
  });

  it('finds a faded curve (colour smeared by screen capture)', () => {
    const f = (x: number) => 260 - 0.006 * (x - 300) ** 2;
    const img = image(600, 320, (x, y) =>
      Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.012 * (x - 300)) <= 1 ? [205, 160, 158] : [255, 255, 255],
    ); // saturation only 47
    expect(smartSubject(toRgb(img), img.width, img.height, opts).kind).toBe('curves');
  });

  it('includes every curve of comparable size', () => {
    const img = desmos(true);
    const box = findColouredCurves(toRgb(img), img.width, img.height)!;
    // The blue line reaches further right and lower than the parabola.
    expect(box.x + box.width).toBeGreaterThan(560);
    expect(box.y + box.height).toBeGreaterThan(330);
  });

  it('still finds a curve that is broken into dashes (a thin curve in a shrunk screenshot)', () => {
    // 2 px thin stroke with a 1-column break every 8 columns (about 3 px along the steep parts).
    const f = (x: number) => 250 - 0.01 * (x - 200) ** 2;
    const img = image(400, 300, (x, y) =>
      x % 8 !== 0 && Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.02 * (x - 200)) <= 1 ? RED : [255, 255, 255],
    );
    const box = findColouredCurves(toRgb(img), img.width, img.height)!;
    expect(box.width).toBeGreaterThan(300);
  });

  it('finds a 1 px curve at the 512 px size photos are loaded at (not lost by shrinking for analysis)', () => {
    const f = (x: number) => 280 - 0.004 * (x - 300) ** 2;
    const img = image(512, 320, (x, y) => {
      const d = Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.008 * (x - 300));
      if (d > 1) return [255, 255, 255];
      const a = d <= 0.5 ? 1 : 0.55; // faint anti-aliased edge
      return [Math.round(255 - a * (255 - 199)), Math.round(255 - a * (255 - 68)), Math.round(255 - a * (255 - 64))];
    });
    const result = smartSubject(toRgb(img), img.width, img.height, opts);
    expect(result.kind).toBe('curves');
    expect(result.box.width).toBeGreaterThan(300);
  });

  it('keeps a faint 1 px second curve (a line shrunk to 512 px) next to the main one', () => {
    const f = (x: number) => 280 - 0.004 * (x - 300) ** 2;
    const line = (x: number) => 280 - 0.9 * (x - 300);
    const img = image(512, 320, (x, y) => {
      if (Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.008 * (x - 300)) <= 1) return RED;
      const d = Math.abs(y + 0.5 - line(x + 0.5)) / Math.hypot(1, 0.9);
      if (d <= 0.6) return [125, 170, 216]; // a 1 px blue line, partly blended with white
      return [255, 255, 255];
    });
    const box = findColouredCurves(toRgb(img), img.width, img.height)!;
    expect(box.y + box.height).toBeGreaterThan(300); // the line reaches the bottom; the parabola does not
  });

  it('does not mistake a short icon for a curve', () => {
    const img = image(400, 300, (x, y) =>
      x >= 10 && x < 28 && Math.abs(y - (70 + 5 * Math.sin((x - 10) / 3))) <= 1 ? RED : [255, 255, 255],
    );
    expect(findColouredCurves(toRgb(img), img.width, img.height)).toBeNull();
  });
});

describe('shapes on different backgrounds', () => {
  it('finds the shape on the main card of a busy page, not the card or the page', () => {
    // Dark page, three cards; the big central card holds a yellow triangle.
    const tri = (x: number, y: number) => y >= 150 && y <= 290 && Math.abs(x - 320) <= ((y - 150) / 140) * 80;
    const img = image(640, 400, (x, y) => {
      if (x >= 20 && x < 120 && y >= 30 && y < 110) return [210, 210, 210]; // small card, top left
      if (x >= 520 && x < 620 && y >= 290 && y < 370) return [180, 200, 230]; // small card, bottom right
      if (x >= 220 && x < 420 && y >= 120 && y < 320) return tri(x, y) ? [230, 197, 90] : [236, 236, 236]; // main card
      if (y >= 380 && x >= 220 && x < 400 && x % 5 < 3) return [232, 234, 237]; // caption text
      return [32, 33, 36];
    });
    const result = smartSubject(toRgb(img), img.width, img.height, opts);
    expect(result.kind).toBe('shape');
    expect(near(result.box, { x: 240, y: 150, width: 161, height: 141 }, 3)).toBe(true);
  });

  it('separates a shape from a gradient background', () => {
    const circle = (x: number, y: number) => Math.hypot(x - 200, y - 150) < 60;
    const img = image(400, 300, (x, y) =>
      circle(x, y) ? [60, 160, 90] : [Math.round(225 - x * 0.25), Math.round(232 - y * 0.3), Math.round(255 - (x + y) * 0.15)],
    );
    const rgb = toRgb(img);
    const result = smartSubject(rgb, img.width, img.height, opts);
    expect(near(result.box, { x: 140, y: 90, width: 121, height: 121 }, 3)).toBe(true);
    // No background leaks into the subject, even in the darkest corner of the gradient.
    const fg = findForeground(rgb, img.width, img.height, opts);
    expect(fg.mask[299 * 400 + 399]).toBe(0);
    expect(fg.mask[150 * 400 + 200]).toBe(1);
  });

  it.each([25, 14, 10, 8, 6, 5])('a graph with gridlines every %i px is still a graph (thin lines are not a fill)', (step) => {
    const f = (x: number) => 420 - 0.02 * (x - 400) ** 2;
    const img = image(800, 500, (x, y) => {
      if (Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.04 * (x - 400)) <= 1.3) return RED;
      if (x === 400 || y === 420) return [60, 60, 60];
      if ((x - 400) % (step * 5) === 0 || (y - 420) % (step * 5) === 0) return [205, 205, 205];
      const gx = (x - 400 + 1000 * step) % step;
      const gy = (y - 420 + 1000 * step) % step;
      if (gx <= 1 || gy <= 1) return [232, 232, 232]; // 2 px anti-aliased minor gridlines
      return [255, 255, 255];
    });
    expect(smartSubject(toRgb(img), img.width, img.height, opts).kind).toBe('curves');
  });

  it('a filled shape with a thin coloured outline is a shape, not a graph curve', () => {
    // Pale yellow right triangle with a thin green edge (a textbook diagram).
    const inside = (x: number, y: number) => x >= 80 && x <= 400 && y <= 260 && y >= 260 - (x - 80) * 0.5;
    const img = image(480, 300, (x, y) => {
      if (!inside(x, y)) return [255, 255, 255];
      const edge = !inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y - 2) || !inside(x, y + 2);
      return edge ? [90, 154, 122] : [251, 251, 214];
    });
    const result = smartSubject(toRgb(img), img.width, img.height, opts);
    expect(result.kind).toBe('shape');
    expect(near(result.box, { x: 80, y: 100, width: 321, height: 161 }, 3)).toBe(true);
  });

  it('a plain shape on white is cropped tightly', () => {
    const img = image(300, 200, (x, y) => (x >= 100 && x < 180 && y >= 50 && y < 130 ? [200, 40, 120] : [255, 255, 255]));
    const result = smartSubject(toRgb(img), img.width, img.height, opts);
    expect(result.box).toEqual({ x: 100, y: 50, width: 80, height: 80 });
  });
});

describe('Desmos with the expression row focused: icon square fused to the input outline (live share, box over the panel)', () => {
  // Recreates a real case: inside the user's box, Desmos' solid blue icon square touches the thin blue input outline,
  // so both form one piece; next to it, a faint green parabola (colour smeared by screen capture).
  const W = 486;
  const H = 318;
  const GREEN: C = [104, 150, 92];
  const f = (x: number) => 310 - 0.13 * (x - 422) ** 2;
  const img = image(W, H, (x, y) => {
    if (x < 272) {
      if (x < 16 && y >= 40 && y < 94) return [76, 108, 220]; // solid blue icon square (as thin overall as the real one: ~5 px)
      const onOutline = (x >= 16 && x < 272 && (y === 40 || y === 93)) || (x === 271 && y >= 40 && y < 94);
      if (onOutline) return [112, 140, 224]; // 1 px input outline, touching the icon
      return [255, 255, 255];
    }
    if (Math.abs(y + 0.5 - f(x + 0.5)) / Math.hypot(1, 0.26 * (x - 422)) <= 1.4) return GREEN;
    if (x === 422 || (x - 422) % 30 === 0 || y % 30 === 0) return [230, 230, 230];
    return [255, 255, 255];
  });
  const rgb = toRgb(img);

  it('takes only the green curve, not the expression row', () => {
    const result = smartSubject(rgb, W, H, opts);
    expect(result.kind).toBe('curves');
    expect(result.box.x).toBeGreaterThan(330); // the panel ends at x = 272
    expect(result.mask![66 * W + 5]).toBe(0); // icon square
    expect(result.mask![40 * W + 150]).toBe(0); // input outline
  });

  it('pins show the parabola, nothing in the top-left corner', () => {
    const smart = smartSubject(rgb, W, H, opts);
    const fg = findForeground(rgb, W, H, { ...opts, region: smart.context, subjectMask: smart.mask });
    const thick = thickenThinLines(fg.mask, W, H, fg.strokeWidth, cellSizePx(smart.box, 5, 8, 1, true));
    const s = sampleCrop(inkFromMask(thick), W, H, smart.box, 5, 8, 1, true);
    const rows = Array.from({ length: 5 }, (_, r) =>
      patternFromSamples(s, 5, 8, 0.35, false)
        .cells.slice(r * 8, r * 8 + 8)
        .join(''),
    );
    expect(rows[0][0]).toBe('1'); // left arm reaches the top-left
    expect(rows[4].slice(2, 6)).toContain('1'); // vertex near the bottom middle
    expect(rows[1].slice(2, 6)).toBe('0000'); // inside of the U is empty
  });
});

describe('graphs whose curve has no colour (black or grey): found by the plot area', () => {
  /** A whole Chrome + Desmos window at live-share scale: dark bars, expression panel, plot with grid, labels, zoom buttons. */
  function desmosWindow(curve: C, faintGrid = false): RasterImage {
    const ox = 520;
    const oy = 520;
    const u = 14;
    return image(800, 760, (x, y) => {
      if (y < 80) return [53, 54, 58]; // browser tabs + address bar
      if (y < 130)
        return (x > 190 && x < 270 && y > 92 && y < 118) || (x > 560 && x < 620 && y > 92 && y < 118) ? [60, 90, 220] : [42, 42, 42];
      if (x < 380) {
        if (x < 36 && y > 175 && y < 235) return [30, 30, 30]; // icon box
        if (x >= 36 && x < 378 && (y === 175 || y === 235)) return [120, 140, 220]; // focused row outline
        if (x >= 60 && x < 90 && y > 195 && y < 215 && x % 4 < 3) return [0, 0, 0]; // "x²"
        if (x === 379) return [200, 200, 200];
        return y < 170 ? [242, 242, 242] : [255, 255, 255];
      }
      const t = (x + 0.5 - ox) / u;
      if (Math.abs(y + 0.5 - (oy - t * t * u)) / Math.hypot(1, 2 * t) <= 1.3) return curve;
      if (x > 760 && x < 790 && ((y > 140 && y < 170) || (y > 180 && y < 210)))
        return x === 761 || x === 789 ? [200, 200, 200] : [248, 248, 248]; // zoom buttons
      for (let k = -2; k <= 2; k++) {
        if (k && x >= ox + k * 70 - 8 && x < ox + k * 70 + 8 && y > oy + 6 && y < oy + 18 && x % 3 < 2) return [30, 30, 30]; // tick labels
        if (k && x >= ox + 6 && x < ox + 22 && y > oy - k * 70 - 6 && y < oy - k * 70 + 6 && x % 3 < 2) return [30, 30, 30];
      }
      if (x === ox || y === oy) return [51, 51, 51]; // axes
      if (faintGrid) {
        // Only very faint 1 px gridlines (a big screen shrunk to 800 px blends them to ~247).
        if ((x - ox) % u === 0 || (y - oy) % u === 0) return [247, 247, 247];
        return [255, 255, 255];
      }
      if ((x - ox) % (u * 5) === 0 || (y - oy) % (u * 5) === 0) return [204, 204, 204]; // major gridlines
      if ((x - ox) % u === 0 || (y - oy) % u === 0) return [238, 238, 238]; // minor gridlines
      return [255, 255, 255];
    });
  }

  it.each([
    ['black', [0, 0, 0] as C],
    ['grey', [90, 90, 90] as C],
  ])('a %s curve: the plot is found by its grid, and only the curve is kept', (_name, colour) => {
    const img = desmosWindow(colour);
    const rgb = toRgb(img);
    const result = smartSubject(rgb, img.width, img.height, opts);
    expect(result.kind).toBe('curves');
    // y = x² from the top of the plot (y = 130) down to the vertex (520, 520): x = 520 ± 74.
    expect(near(result.box, { x: 446, y: 130, width: 149, height: 391 }, 4)).toBe(true);
    const at = (x: number, y: number) => result.mask![y * img.width + x];
    expect(at(10, 200)).toBe(0); // expression panel icon
    expect(at(775, 155)).toBe(0); // zoom button
    expect(at(590, 532)).toBe(0); // tick label
    expect(at(520, 300)).toBe(0); // y-axis
    // On the arms (x = 520 ± 42, y = 520 - 3² × 14 = 394).
    expect([392, 393, 394, 395, 396].some((y) => at(478, y) === 1)).toBe(true);
    expect([392, 393, 394, 395, 396].some((y) => at(562, y) === 1)).toBe(true);
    // The vertex touches the x-axis: kept for a black curve; a curve the same grey as the axis may lose a few pixels there.
    if (_name === 'black') expect(at(520, 519) || at(520, 520) || at(520, 518)).toBe(1);
  });

  it.each([
    ['black', [0, 0, 0] as C],
    ['grey', [90, 90, 90] as C],
  ])('a %s-curve graph becomes a U on the pins', (_name, colour) => {
    const img = desmosWindow(colour);
    const rgb = toRgb(img);
    const smart = smartSubject(rgb, img.width, img.height, opts);
    const fg = findForeground(rgb, img.width, img.height, { ...opts, region: smart.context, subjectMask: smart.mask });
    const thick = thickenThinLines(fg.mask, img.width, img.height, fg.strokeWidth, cellSizePx(smart.box, 5, 8, 1, true));
    const s = sampleCrop(inkFromMask(thick), img.width, img.height, smart.box, 5, 8, 1, true);
    const rows = Array.from({ length: 5 }, (_, r) =>
      patternFromSamples(s, 5, 8, 0.35, false)
        .cells.slice(r * 8, r * 8 + 8)
        .join(''),
    );
    expect(rows[0][0]).toBe('1');
    expect(rows[0][7]).toBe('1');
    expect(rows[1].slice(2, 6)).toBe('0000');
    expect(rows[4].slice(3, 5)).toBe('11');
  });

  it('finds the plot even when the grid is very faint', () => {
    const img = desmosWindow([0, 0, 0], true);
    const plot = findPlotArea(toRgb(img), img.width, img.height);
    expect(plot).not.toBeNull();
    expect(near(plot!, { x: 380, y: 130, width: 420, height: 630 }, 20)).toBe(true);
    const result = smartSubject(toRgb(img), img.width, img.height, opts);
    expect(near(result.box, { x: 446, y: 130, width: 149, height: 391 }, 4)).toBe(true);
  });

  it('pictures without a grid are not mistaken for plots', () => {
    const img = image(400, 300, (x, y) => (x >= 100 && x < 180 && y >= 50 && y < 130 ? [200, 40, 120] : [255, 255, 255]));
    expect(findPlotArea(toRgb(img), img.width, img.height)).toBeNull();
  });
});

describe('tap to focus (a grid of pictures, e.g. image search results)', () => {
  // Dark page, 3 x 2 light cards, each holding a different coloured shape.
  const cols = [40, 250, 460];
  const rows = [40, 250];
  const CARD = 180;
  type ShapeFn = (x: number, y: number) => boolean; // coordinates relative to the card
  const shapes: { colour: C; inside: ShapeFn; box: Rect }[] = [
    {
      colour: [230, 197, 90],
      inside: (x, y) => y >= 40 && y <= 140 && Math.abs(x - 90) <= ((y - 40) / 100) * 50,
      box: { x: 40, y: 40, width: 101, height: 101 },
    },
    { colour: [60, 160, 90], inside: (x, y) => Math.hypot(x - 90, y - 90) < 45, box: { x: 45, y: 45, width: 91, height: 91 } },
    { colour: [61, 90, 254], inside: (x, y) => x >= 50 && x < 130 && y >= 50 && y < 130, box: { x: 50, y: 50, width: 80, height: 80 } },
    {
      colour: [200, 40, 120],
      inside: (x, y) => Math.abs(x - 90) / 50 + Math.abs(y - 90) / 50 <= 1,
      box: { x: 40, y: 40, width: 101, height: 101 },
    },
    { colour: [240, 140, 30], inside: (x, y) => x >= 30 && x < 150 && y >= 70 && y < 110, box: { x: 30, y: 70, width: 120, height: 40 } },
    { colour: [120, 60, 180], inside: (x, y) => Math.hypot(x - 90, y - 90) < 30, box: { x: 60, y: 60, width: 61, height: 61 } },
  ];
  const cardAt = (i: number) => ({ x: cols[i % 3], y: rows[Math.floor(i / 3)] });
  const img = image(680, 470, (x, y) => {
    for (let i = 0; i < 6; i++) {
      const c = cardAt(i);
      if (x >= c.x && x < c.x + CARD && y >= c.y && y < c.y + CARD)
        return shapes[i].inside(x - c.x, y - c.y) ? shapes[i].colour : [240, 240, 240];
    }
    return [32, 33, 36];
  });
  const rgb = toRgb(img);
  const expected = (i: number) => {
    const c = cardAt(i);
    const b = shapes[i].box;
    return { x: c.x + b.x, y: c.y + b.y, width: b.width, height: b.height };
  };

  it.each([0, 1, 2, 3, 4, 5])("tapping card %i crops to that card's shape", (i) => {
    const c = cardAt(i);
    // Tap near the card's corner, on its plain background, not on the shape itself.
    const result = smartSubject(rgb, img.width, img.height, opts, undefined, { x: c.x + 15, y: c.y + 15 });
    expect(near(result.box, expected(i), 3)).toBe(true);
  });

  it.each([0, 1, 2, 3, 4, 5])('tapping card %i on its shape, or on the card’s very edge, gives the same crop', (i) => {
    const c = cardAt(i);
    for (const tap of [
      { x: c.x + 90, y: c.y + 90 },
      { x: c.x + 1, y: c.y + CARD - 2 },
      { x: c.x + CARD - 2, y: c.y + 1 },
    ]) {
      const result = smartSubject(rgb, img.width, img.height, opts, undefined, tap);
      expect(near(result.box, expected(i), 3)).toBe(true);
    }
  });

  it('a tap on the page between cards picks the nearest card', () => {
    // Just right of card 0, in the dark gap before card 1.
    const result = smartSubject(rgb, img.width, img.height, opts, undefined, { x: 40 + CARD + 8, y: 120 });
    expect(near(result.box, expected(0), 3)).toBe(true);
  });

  it('without a tap the usual automatic choice is unchanged', () => {
    const a = smartSubject(rgb, img.width, img.height, opts);
    const b = smartSubject(rgb, img.width, img.height, opts, undefined, undefined);
    expect(a.box).toEqual(b.box);
  });
});

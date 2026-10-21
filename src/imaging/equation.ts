/**
 * Typed equations ("y = x^2 - 3", "sin(2x)", "1/x"): parsed safely (no eval) into a function of x, then drawn as a
 * Desmos-like plot whose scale is known. That plot goes through the same graph pipeline as a screenshot, so Graph
 * Range, panning, one-pin lines and the summary all work on it, exactly, without reading any numbers.
 *
 * Supported: numbers, x, + - * / ^ (also ** and the symbols − × ÷ ²), brackets, |x|, implicit multiplication (2x,
 * 3(x+1), x sin x), sin cos tan asin acos atan sqrt abs ln log exp floor ceil, pi (π) and e.
 */
import type { RasterImage } from './convert';
import type { GraphScale } from './graph';

export type Fn = (x: number) => number;

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const FUNCS: Record<string, Fn> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
/** Longest first, so "asin" isn't read as "a" + "sin" and "exp" isn't "e" + "xp". */
const NAMES = [...Object.keys(FUNCS), ...Object.keys(CONSTS), 'x'].sort((a, b) => b.length - a.length);

function tokens(src: string): Tok[] {
  const s = src
    .replace(/\*\*/g, '^')
    .replace(/[−–]/g, '-')
    .replace(/×|·/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/π/g, 'pi')
    .toLowerCase();
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) i++;
    else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) throw new Error(`Can't read the number at “${s.slice(i, i + 4)}”`);
      out.push({ k: 'num', v: Number(m[1]) });
      i += m[1].length;
    } else if (/[a-z]/.test(ch)) {
      // A run of letters: split into known names ("xsinx" -> x sin x).
      let j = i;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      let word = s.slice(i, j);
      while (word) {
        const name = NAMES.find((n) => word.startsWith(n));
        if (!name) throw new Error(`Unknown name “${word}”. Use x, and functions like sin, sqrt or ln.`);
        out.push({ k: 'id', v: name });
        word = word.slice(name.length);
      }
      i = j;
    } else if ('+-*/^()|'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
    } else throw new Error(`Unexpected “${ch}”`);
  }
  return out;
}

/** Parses "y = …", "f(x) = …" or just "…" into a function of x. Throws an Error with a readable message. */
export function parseEquation(text: string): Fn {
  const rhs = text.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, '');
  if (rhs.includes('=')) throw new Error('Write it as y = something with x, e.g. y = x^2');
  const t = tokens(rhs);
  if (!t.length) throw new Error('Type an equation, e.g. y = x^2');
  let p = 0;
  const peek = () => t[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Missing “${v}”`);
    p++;
  };
  // Can this token start a factor (for implicit multiplication: 2x, 3(x+1))?
  const startsFactor = () => {
    const k = peek();
    return !!k && (k.k === 'num' || k.k === 'id' || (k.k === 'op' && (k.v === '(' || (k.v === '|' && !inAbs))));
  };
  let inAbs = false;

  const expr = (): Fn => {
    let f = term();
    while (isOp('+') || isOp('-')) {
      const op = t[p++].v;
      const a = f;
      const b = term();
      f = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return f;
  };
  const term = (): Fn => {
    let f = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = t[p++].v;
        const a = f;
        const b = unary();
        f = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
      } else if (startsFactor()) {
        const a = f;
        const b = power();
        f = (x) => a(x) * b(x);
      } else return f;
    }
  };
  const unary = (): Fn => {
    if (isOp('-')) {
      p++;
      const a = unary();
      return (x) => -a(x);
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Fn => {
    const base = atom();
    if (isOp('^')) {
      p++;
      const e = unary(); // right-associative: 2^3^2 = 2^9; x^-1 works
      return (x) => Math.pow(base(x), e(x));
    }
    return base;
  };
  const atom = (): Fn => {
    const k = peek();
    if (!k) throw new Error('The equation ends too soon');
    if (k.k === 'num') {
      p++;
      const v = k.v;
      return () => v;
    }
    if (k.k === 'id') {
      p++;
      if (k.v === 'x') return (x) => x;
      if (k.v in CONSTS) {
        const v = CONSTS[k.v];
        return () => v;
      }
      const fn = FUNCS[k.v];
      // sin(x), or sin x / sin 2x (the next factor, as people write it).
      const arg = isOp('(') ? (p++, ((a) => (expect(')'), a))(expr())) : power();
      return (x) => fn(arg(x));
    }
    if (k.v === '(') {
      p++;
      const a = expr();
      expect(')');
      return a;
    }
    if (k.v === '|' && !inAbs) {
      p++;
      inAbs = true;
      const a = expr();
      inAbs = false;
      expect('|');
      return (x) => Math.abs(a(x));
    }
    throw new Error(`Unexpected “${k.v}”`);
  };

  const f = expr();
  if (p < t.length) throw new Error(`Unexpected “${t[p].v}”`);
  // Must actually be a curve somewhere.
  if (!Array.from({ length: 401 }, (_, i) => f(i / 20 - 10)).some(Number.isFinite))
    throw new Error('That has no values to draw between x = −10 and 10');
  return f;
}

/** Plot size and scale: ±10 units across at 36 pixels per unit (Graph Range's ±10 fits, with a margin). */
export const EQUATION_PLOT = { width: 800, height: 600, ppu: 36 };

/**
 * The function drawn like Desmos: white, a grid every unit (minor lines every 0.2), dark axes, a red 3 px curve.
 * The y-axis is in the middle; the x-axis too, unless the curve would be off screen, then it moves (in whole
 * units) to centre the curve. Also returns the plot's exact scale.
 */
export function renderEquation(f: Fn): { raster: RasterImage; scale: GraphScale } {
  const { width: W, height: H, ppu } = EQUATION_PLOT;
  const ox = W / 2;
  const values: number[] = [];
  for (let px = 0; px < W; px++) {
    const v = f((px + 0.5 - ox) / ppu);
    if (Number.isFinite(v)) values.push(v);
  }
  const halfH = H / 2 / ppu;
  const visible = values.filter((v) => Math.abs(v) <= halfH).length;
  let mid = 0;
  if (values.length && visible < values.length * 0.2) {
    const s = [...values].sort((a, b) => a - b);
    mid = Math.round(s[s.length >> 1]);
  }
  const oy = H / 2 + mid * ppu;
  const data = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, c: readonly number[]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
  };
  // A gridline is the pixel column (row) nearest to each multiple of `every` from the origin: exactly one pixel
  // wide, never skipped (measuring from the pixel's centre put whole-unit lines exactly half a pixel away).
  const on = (pos: number, origin: number, every: number) => {
    const k = (pos - origin) / every;
    return Math.abs(k - Math.round(k)) * every < 0.5;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = [255, 255, 255];
      if (on(x, ox, ppu / 5) || on(y, oy, ppu / 5)) c = [232, 232, 232];
      if (on(x, ox, ppu) || on(y, oy, ppu)) c = [200, 200, 200];
      if (Math.abs(x + 0.5 - ox) <= 1 || Math.abs(y + 0.5 - oy) <= 1) c = [60, 60, 60];
      set(x, y, c);
      data[(y * W + x) * 4 + 3] = 255;
    }
  // The curve: in each column, a vertical run joining it to the previous column's height (steep parts stay
  // connected); a jump of more than the plot's height is a break (1/x, tan), not a line.
  const RED = [199, 68, 64];
  let prev: number | null = null;
  for (let px = 0; px < W; px++) {
    const v = f((px + 0.5 - ox) / ppu);
    const py = Number.isFinite(v) ? oy - v * ppu : null;
    if (py !== null && Math.abs(py) < H * 50) {
      const from = prev !== null && Math.abs(prev - py) < H ? prev : py;
      const y0 = Math.round(Math.min(from, py));
      const y1 = Math.round(Math.max(from, py));
      for (let y = Math.max(-1, y0 - 1); y <= Math.min(H, y1 + 1); y++) for (let dx = -1; dx <= 1; dx++) set(px + dx, y, RED);
    }
    prev = py;
  }
  return {
    raster: { width: W, height: H, data, channels: 4 },
    scale: { pxPerUnitX: ppu, pxPerUnitY: ppu, unitsPerMajorX: 1, unitsPerMajorY: 1, majorX: ppu, majorY: ppu, from: 'labels' },
  };
}

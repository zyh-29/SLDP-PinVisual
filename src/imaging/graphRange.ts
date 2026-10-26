/**
 * Graph Range: how much of a graph the pins show, typed by the user. Pure functions, unit tested.
 *
 *   ""  or "auto"            Auto: the whole curve, or the part where it turns and bends (see featureWindow)
 *   "whole" or "all"         the whole curve
 *   "5", "±5", "+-5", "+/-5"  5 units each side of the middle of the graph (see graphMiddle)
 *   "+5"                     5 units to the right of the middle
 *   "-5"                     5 units to the left of it
 *
 * Phone number pads have no + or − key, and no keyboard has ±, so "+-" and "+/-" mean ± too, and a number on its
 * own means both sides.
 */

export type RangeSide = 'both' | 'right' | 'left';

export type GraphRange = { kind: 'auto' } | { kind: 'whole' } | { kind: 'window'; units: number; side: RangeSide };

export const AUTO_RANGE: GraphRange = { kind: 'auto' };

/** Largest number of units accepted: past it the window is far bigger than any graph on screen. */
export const MAX_RANGE_UNITS = 100_000;

const WORDS: Record<string, GraphRange> = { '': AUTO_RANGE, auto: AUTO_RANGE, whole: { kind: 'whole' }, all: { kind: 'whole' } };

/** Sign prefixes, longest first (so "+-" isn't read as "+" followed by "-5"). */
const SIGNS: [string, RangeSide][] = [
  ['+/-', 'both'],
  ['+-', 'both'],
  ['-+', 'both'],
  ['±', 'both'],
  ['+', 'right'],
  ['-', 'left'],
];

/**
 * Reads what the user typed. Spaces are ignored, and the dashes and minus signs phones and text editors put in
 * (− – —) count as "-".
 */
export function parseGraphRange(text: string): { range: GraphRange } | { error: string } {
  const s = text.toLowerCase().replace(/\s+/g, '').replace(/[−–—]/g, '-');
  const word = WORDS[s];
  if (word) return { range: word };
  const sign = SIGNS.find(([p]) => s.startsWith(p));
  const side: RangeSide = sign?.[1] ?? 'both';
  const rest = sign ? s.slice(sign[0].length) : s;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(rest)) return { error: 'Type a number, like 5, +5 or -5. Leave it empty for Auto.' };
  const units = Number(rest);
  if (!(units > 0)) return { error: 'Use a number above 0.' };
  if (units > MAX_RANGE_UNITS) return { error: `Use ${MAX_RANGE_UNITS.toLocaleString('en-US')} or less.` };
  return { range: { kind: 'window', units, side } };
}

/** The range as the user would type it: "" for Auto, "whole", "±5", "+5", "-5". */
export function graphRangeText(r: GraphRange): string {
  if (r.kind === 'auto') return '';
  if (r.kind === 'whole') return 'whole';
  return `${r.side === 'both' ? '±' : r.side === 'right' ? '+' : '-'}${r.units}`;
}

/** The range for reading: "Auto", "Whole", "±5", "+5", "−5" (a real minus sign). */
export function graphRangeLabel(r: GraphRange): string {
  return r.kind === 'auto' ? 'Auto' : r.kind === 'whole' ? 'Whole' : graphRangeText(r).replace('-', '−');
}

export function sameGraphRange(a: GraphRange, b: GraphRange): boolean {
  return a.kind === b.kind && (a.kind !== 'window' || (b.kind === 'window' && a.units === b.units && a.side === b.side));
}

/** Units across the window: twice the range for ±, once for one side. */
export function rangeWidth(r: { units: number; side: RangeSide }): number {
  return r.side === 'both' ? 2 * r.units : r.units;
}

/** How far one press of an arrow moves the window: about a fifth of its width, a round 1, 2 or 5 (× 10ⁿ). */
export function panStep(r: { units: number; side: RangeSide }): number {
  const fifth = rangeWidth(r) / 5;
  const p = 10 ** Math.floor(Math.log10(fifth));
  const nice = [1, 2, 5, 10].map((k) => k * p).reduce((best, v) => (Math.abs(Math.log(v / fifth)) < Math.abs(Math.log(best / fifth)) ? v : best));
  return Number(nice.toPrecision(6));
}

/**
 * What the voice model reads from a sentence: its words, pairs of neighbouring words, and three-letter pieces of
 * each word, each hashed to one of BUCKETS numbers (the "hashing trick", as in fastText). Pieces of words make a
 * misheard or misspelt word ("hart", "colum", "camra") land near the right one.
 *
 * Shared by the app and by scripts/train-voice-model.mjs, which runs this file directly in Node, so it imports
 * nothing and uses only type annotations that can be stripped.
 */

export const BUCKETS = 4096;

/** Number words and their homophones: they all count as "a number" too, so "row too" reads like "row 2". */
const NUMBERS = new Set([
  'zero', 'one', 'won', 'two', 'to', 'too', 'three', 'tree', 'four', 'for', 'fore', 'five', 'six', 'seven', 'eight', 'ate',
  'nine', 'ten', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
]);

/** Lower case, apostrophes dropped ("what's" → "whats"), everything else but letters and digits a space. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** 32-bit FNV-1a hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The sentence's features, as bucket numbers (repeats allowed: a word said twice counts twice). */
export function features(text: string): number[] {
  const words = tokens(text).map((w) => (/^\d+(st|nd|rd|th)?$/.test(w) ? '#' : w));
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    out.push(`w:${w}`);
    if (w === '#' || NUMBERS.has(w)) out.push('w:#num');
    if (i > 0) out.push(`b:${words[i - 1]}_${w}`);
    if (w.length > 2) {
      const padded = `<${w}>`;
      for (let j = 0; j + 3 <= padded.length; j++) out.push(`c:${padded.slice(j, j + 3)}`);
    }
  }
  if (words.length === 1) out.push(`only:${words[0]}`);
  return out.map((f) => hash(f) % BUCKETS);
}

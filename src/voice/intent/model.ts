/**
 * The voice model (trained by scripts/train-voice-model.mjs): what kind of command a sentence is, and how sure.
 * Runs on the device in well under a millisecond, the same on phones and in the browser, with nothing downloaded.
 */
import { features, tokens } from './features';
import { WEIGHTS } from './weights';

export type IntentLabel = (typeof WEIGHTS.labels)[number];

export interface Intent {
  label: IntentLabel;
  /** 0 to 1. */
  probability: number;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to signed bytes, scaled back to numbers. (Not atob: it isn't everywhere React Native runs.) */
function decode(text: string, scale: number): Float32Array {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const clean = text.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (lookup[clean.charCodeAt(i)] << 18) | (lookup[clean.charCodeAt(i + 1)] << 12) | (lookup[clean.charCodeAt(i + 2)] << 6) | lookup[clean.charCodeAt(i + 3)];
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255;
    if (o < bytes.length) bytes[o++] = (n >> 8) & 255;
    if (o < bytes.length) bytes[o++] = n & 255;
  }
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = ((bytes[i] << 24) >> 24) * scale;
  return out;
}

let loaded: { e: Float32Array; w: Float32Array } | null = null;

/** Every kind of command, most likely first. */
export function classify(text: string): Intent[] {
  loaded ??= { e: decode(WEIGHTS.e, WEIGHTS.eScale), w: decode(WEIGHTS.w, WEIGHTS.wScale) };
  const { e, w } = loaded;
  const { dim, labels, bias } = WEIGHTS;
  const f = features(text);
  const h = new Float32Array(dim);
  for (const b of f) for (let d = 0; d < dim; d++) h[d] += e[b * dim + d];
  for (let d = 0; d < dim; d++) h[d] /= Math.max(1, f.length);
  const scores = labels.map((_, k) => {
    let s = bias[k];
    for (let d = 0; d < dim; d++) s += w[k * dim + d] * h[d];
    return s;
  });
  const max = Math.max(...scores);
  const exp = scores.map((s) => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return labels.map((label, k) => ({ label, probability: exp[k] / sum })).sort((a, b) => b.probability - a.probability);
}

let vocabulary: Set<string> | null = null;

/** Edit distance at most 1 (one letter added, dropped or changed). */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * The share of a sentence's words the model learned from, counting numbers and near misspellings ("sqare"), 0 to 1.
 * Low means the sentence is about something else, and the model's guess means little.
 */
export function familiarity(text: string): number {
  const words = tokens(text);
  if (!words.length) return 0;
  vocabulary ??= new Set(WEIGHTS.vocabulary.split(' '));
  const known = words.filter(
    (w) => vocabulary!.has(w) || /^\d+$/.test(w) || (w.length >= 4 && [...vocabulary!].some((v) => v.length >= 4 && nearly(w, v))),
  );
  return known.length / words.length;
}

let anchors: Map<string, Set<string>> | null = null;

/**
 * Whether a sentence has one of the words of the kind of command the model chose ("snap" for capture), counting
 * a longer word with one letter dropped or added ("captur"), but not changed: "shark" isn't "share". Without one the sentence is about
 * something else, whatever the model makes of its letters: "flower" isn't "lower", "cake" isn't "take".
 */
export function anchored(text: string, label: string): boolean {
  anchors ??= new Map(Object.entries(WEIGHTS.anchors).map(([l, words]) => [l, new Set(words.split(' ').filter(Boolean))]));
  const own = anchors.get(label);
  if (!own) return false;
  return tokens(text).some(
    (w) => own.has(w) || (w.length >= 5 && [...own].some((v) => v.length >= 5 && v.length !== w.length && v[0] === w[0] && nearly(w, v))),
  );
}

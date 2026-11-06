// Trains the voice model: a small fastText-style network that reads a sentence and says what kind of command it
// is (clear, a shape, open the camera, …) and how sure it is. Writes src/voice/intent/weights.ts.
//
//   node scripts/train-voice-model.mjs
//
// The network: each sentence becomes a bag of features (words, word pairs, three-letter pieces: see
// src/voice/intent/features.ts); each feature has a learned vector of DIM numbers; the sentence's vector is their
// average; one layer turns it into a score per kind, and softmax into probabilities. About 130,000 numbers, stored
// as bytes (≈180 KB as text), and it answers in well under a millisecond on any phone.
//
// Training sentences come from scripts/voice-training-data.mjs. Any that is word for word one of the test phrases
// (src/voice/__tests__/voicePhrases.ts) is dropped, so the test measures phrasings the model never saw.
// Needs Node 22.18 or newer (it runs the TypeScript files directly).
import fs from 'node:fs';
import path from 'node:path';

import { BUCKETS, features, tokens } from '../src/voice/intent/features.ts';
import { FRESH_PHRASES, PHRASES } from '../src/voice/__tests__/voicePhrases.ts';
import { examples, NAMES, POST, PRE, THINGS } from './voice-training-data.mjs';

const DIM = 32;
const EPOCHS = 12;
const LR = 0.5;

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const key = (s) => tokens(s).join(' ');
const held = new Set([...PHRASES, ...FRESH_PHRASES].map(([p]) => key(p)));

const all = examples(1);
const data = all.filter(([t]) => !held.has(key(t)));
const labels = [...new Set(data.map(([, l]) => l))];
const index = new Map(labels.map((l, i) => [l, i]));
const L = labels.length;

// Seeded random numbers, so training is repeatable.
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const E = new Float32Array(BUCKETS * DIM).map(() => (rnd() * 2 - 1) / DIM);
const W = new Float32Array(L * DIM);
const B = new Float32Array(L);

const encoded = data.map(([t, l]) => ({ f: features(t), y: index.get(l) }));
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
};
// Last 10% for checking, never trained on.
shuffle(encoded);
const split = Math.floor(encoded.length * 0.9);
const train = encoded.slice(0, split);
const check = encoded.slice(split);

const h = new Float32Array(DIM);
const p = new Float32Array(L);
const dh = new Float32Array(DIM);

function forward(f) {
  h.fill(0);
  for (const b of f) for (let d = 0; d < DIM; d++) h[d] += E[b * DIM + d];
  const n = Math.max(1, f.length);
  for (let d = 0; d < DIM; d++) h[d] /= n;
  let max = -Infinity;
  for (let k = 0; k < L; k++) {
    let s = B[k];
    for (let d = 0; d < DIM; d++) s += W[k * DIM + d] * h[d];
    p[k] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let k = 0; k < L; k++) sum += p[k] = Math.exp(p[k] - max);
  for (let k = 0; k < L; k++) p[k] /= sum;
}

const total = EPOCHS * train.length;
let step = 0;
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  shuffle(train);
  let loss = 0;
  for (const { f, y } of train) {
    const lr = LR * (1 - step++ / total);
    forward(f);
    loss -= Math.log(p[y] + 1e-9);
    dh.fill(0);
    for (let k = 0; k < L; k++) {
      const g = p[k] - (k === y ? 1 : 0);
      for (let d = 0; d < DIM; d++) {
        dh[d] += g * W[k * DIM + d];
        W[k * DIM + d] -= lr * g * h[d];
      }
      B[k] -= lr * g;
    }
    const n = Math.max(1, f.length);
    for (const b of f) for (let d = 0; d < DIM; d++) E[b * DIM + d] -= (lr * dh[d]) / n;
  }
  let right = 0;
  for (const { f, y } of check) {
    forward(f);
    let best = 0;
    for (let k = 1; k < L; k++) if (p[k] > p[best]) best = k;
    if (best === y) right++;
  }
  console.log(`epoch ${epoch + 1}: loss ${(loss / train.length).toFixed(3)}, held-back sentences ${((100 * right) / check.length).toFixed(1)}% right`);
}

// Stored as bytes: each matrix scaled so its largest number is 127.
function quantise(m) {
  let max = 0;
  for (const v of m) max = Math.max(max, Math.abs(v));
  const scale = max / 127 || 1;
  const q = new Int8Array(m.length);
  for (let i = 0; i < m.length; i++) q[i] = Math.round(m[i] / scale);
  return { scale, data: Buffer.from(q.buffer).toString('base64') };
}
// Every word the model learned from (typos left out: they'd make nonsense look familiar). A sentence mostly made of
// other words is outside what the model knows, and its guess isn't trusted (see understand.ts).
const clean = examples(1, 400, { noise: false }).filter(([t]) => !held.has(key(t)));
const vocabulary = [...new Set(clean.flatMap(([t]) => tokens(t)))].sort();
// Each kind of command's own words ("capture": capture, snap, take…): the words its sentences use, leaving out
// filler, the things named in them (pattern names, pictures) and words that many kinds share ("show", "the").
// The model's guess only counts when the sentence has one of them, so a thing ("flower") is never read as a
// command whose words it merely looks like ("lower"). See understand.ts.
const COMMON =
  'a an the is are am be was do does did done in out on at of to it its this that these them there thing some one all get give me my i you we what whats how which with from for and or so if not more tell';
const subjects = new Set([...NAMES, ...THINGS, ...PRE, ...POST, COMMON].flatMap((t) => tokens(t)));
const usedBy = new Map();
for (const [t, l] of clean) for (const w of new Set(tokens(t))) (usedBy.get(w) ?? usedBy.set(w, new Set()).get(w)).add(l);
const SHARED = 12;
const anchors = Object.fromEntries(
  labels.map((l) => [
    l,
    [...usedBy].filter(([w, ls]) => ls.has(l) && ls.size <= SHARED && !subjects.has(w)).map(([w]) => w).sort().join(' '),
  ]),
);
const e = quantise(E);
const w = quantise(W);
const file = `// Generated by scripts/train-voice-model.mjs from scripts/voice-training-data.mjs. Do not edit: run the script.
// ${data.length} training sentences (${all.length - data.length} dropped for being test phrases), ${L} kinds of command, ${vocabulary.length} words.
export const WEIGHTS = {
  dim: ${DIM},
  buckets: ${BUCKETS},
  labels: ${JSON.stringify(labels)},
  vocabulary: ${JSON.stringify(vocabulary.join(' '))},
  anchors: ${JSON.stringify(anchors)},
  eScale: ${e.scale},
  wScale: ${w.scale},
  bias: ${JSON.stringify(Array.from(B, (v) => Number(v.toFixed(4))))},
  e: '${e.data}',
  w: '${w.data}',
} as const;
`;
const out = path.join(root, 'src', 'voice', 'intent', 'weights.ts');
fs.writeFileSync(out, file);
console.log(`wrote ${path.relative(root, out)}: ${(file.length / 1024).toFixed(0)} KB, ${data.length} sentences, ${all.length - data.length} test phrases dropped`);

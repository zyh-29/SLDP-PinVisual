// Copies the web app's on-device engines from node_modules into public/, so the web app serves them itself:
// no CDN, works offline. Runs after `npm install`.
//  - public/ort: ONNX Runtime (WebAssembly), runs the Smart Cut-Out model (public/models).
//  - public/tesseract: Tesseract.js OCR, reads the numbers on graph axes (for Graph Range). Optional: without
//    it, a graph's major grid square counts as one unit.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const nm = (...p) => path.join(root, 'node_modules', ...p);

const groups = [
  {
    name: 'ONNX Runtime',
    to: 'ort',
    files: ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((f) => [nm('onnxruntime-web', 'dist', f), f]),
  },
  {
    name: 'Tesseract.js',
    to: 'tesseract',
    files: [
      [nm('tesseract.js', 'dist', 'tesseract.min.js'), 'tesseract.min.js'],
      [nm('tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
      // Text-recognition (LSTM) engine; the browser loads the one variant it supports.
      ...['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'].map((f) => [
        nm('tesseract.js-core', f),
        `core/${f}`,
      ]),
      // English model (the compact "best_int" version), for digits and minus signs.
      [nm('@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'lang/eng.traineddata.gz'],
    ],
  },
];

for (const g of groups) {
  const missing = g.files.filter(([from]) => !fs.existsSync(from));
  if (missing.length) {
    console.warn(`copy-ort: ${g.name} is not installed; skipping (${path.basename(missing[0][0])})`);
    continue;
  }
  for (const [from, rel] of g.files) {
    const to = path.join(root, 'public', g.to, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  console.log(`copy-ort: copied ${g.files.length} ${g.name} files to public/${g.to}`);
}

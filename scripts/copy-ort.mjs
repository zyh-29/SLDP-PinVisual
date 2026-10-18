// Copies the ONNX Runtime (WebAssembly) files into public/ort so the web app
// serves them itself: no CDN, works offline. Runs after `npm install`.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const from = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = path.join(root, 'public', 'ort');
const files = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

if (!fs.existsSync(from)) {
  console.warn('copy-ort: onnxruntime-web is not installed; skipping');
  process.exit(0);
}
fs.mkdirSync(to, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`copy-ort: copied ${files.length} files to public/ort`);

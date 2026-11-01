// After `expo export -p web` (and before web-routes.mjs): makes the website work offline and installable.
//  - Writes dist/sw.js, the service worker (from scripts/service-worker.js), with every file of this build and a
//    hash of its contents: a changed file is downloaded again, an unchanged one isn't.
//  - Links the web app manifest (public/manifest.json: name, icons) from index.html, so the site can be added to a
//    phone's home screen and opens like an app.
// The service worker is registered by src/offline/serviceWorker.web.ts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dist = path.resolve(root, process.argv[2] ?? 'dist');
const page = path.join(dist, 'index.html');
if (!fs.existsSync(page)) {
  console.error(`web-offline: ${page} not found; run "expo export -p web" first`);
  process.exit(1);
}

// Same as app.config.js: '' at a site's root, or e.g. '/pinvisual'.
const raw = process.env.WEB_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
const base = raw && !raw.startsWith('/') ? `/${raw}` : raw;

// The manifest link (and the icon iOS uses for the home screen). Skipped if already there.
let html = fs.readFileSync(page, 'utf8');
if (!html.includes('rel="manifest"')) {
  html = html.replace(
    '</head>',
    `<link rel="manifest" href="${base}/manifest.json"/>\n<link rel="apple-touch-icon" href="${base}/icon-192.png"/>\n</head>`,
  );
  fs.writeFileSync(page, html);
}

// Engines are big (about 30 MB) and only needed for Smart Cut-Out and reading graph numbers: saved after the app.
const ENGINE_DIRS = new Set(['models', 'ort', 'tesseract']);
// Not part of the app: the service worker itself, copies of index.html for other addresses, host and OS files,
// and source maps (only for debugging).
const skip = (rel) =>
  rel === 'sw.js' || rel === '404.html' || /\/index\.html$/.test(rel) || /(^|\/)\./.test(rel) || rel.endsWith('.map');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(dist, full).split(path.sep).join('/');
    if (skip(rel)) continue;
    if (entry.isDirectory()) walk(full);
    else {
      const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16);
      files.push([rel, hash, ENGINE_DIRS.has(rel.split('/')[0]) ? 'engine' : 'app']);
    }
  }
};
walk(dist);
files.sort((a, b) => a[0].localeCompare(b[0]));

const version = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12);
const template = fs.readFileSync(path.join(root, 'scripts', 'service-worker.js'), 'utf8');
const sw = template.replace('self.__FILES__', JSON.stringify(files)).replace('self.__VERSION__', JSON.stringify(version));
if (sw.includes('self.__FILES__') || sw.includes('self.__VERSION__')) {
  console.error('web-offline: the service worker template has changed; update web-offline.mjs');
  process.exit(1);
}
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

const mb = (kind) =>
  (files.filter((f) => f[2] === kind).reduce((n, [rel]) => n + fs.statSync(path.join(dist, rel)).size, 0) / 1e6).toFixed(1);
console.log(`web-offline: sw.js version ${version}: ${mb('app')} MB of app, ${mb('engine')} MB of engines`);

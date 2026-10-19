// After `expo export -p web`: the web app is one page (index.html), but every tab has its own address
// (/image, /saved, ...). Opening or refreshing one of those asks the web host for a file that doesn't exist,
// and most hosts answer 404. This writes the same page at each address, plus 404.html, so the app works on any
// static host (GitHub Pages, Netlify, Vercel, a plain web server) without host-specific rewrite rules.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const dist = path.resolve(root, process.argv[2] ?? 'dist');
const page = path.join(dist, 'index.html');
if (!fs.existsSync(page)) {
  console.error(`web-routes: ${page} not found; run "expo export -p web" first`);
  process.exit(1);
}

// Route folders in src/app: skip groups like "(display)" (no address of their own) and "_layout"-style files.
const appDir = path.join(root, 'src', 'app');
const routes = fs
  .readdirSync(appDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('_') && !d.name.startsWith('['))
  .map((d) => d.name);

for (const r of routes) {
  fs.mkdirSync(path.join(dist, r), { recursive: true });
  fs.copyFileSync(page, path.join(dist, r, 'index.html'));
}
fs.copyFileSync(page, path.join(dist, '404.html'));
// GitHub Pages: serve folders starting with "_" (the app's code is in _expo/).
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`web-routes: wrote ${routes.map((r) => `/${r}`).join(', ')} and 404.html`);

/* global self, caches, fetch, Response, URL */
// The website's service worker: keeps a copy of the web app in the browser so it opens and works with no internet.
// This is a template: scripts/web-offline.mjs fills in FILES and writes it to dist/sw.js at build time.
//
// - The app's code and pictures are saved when it is first opened (all of them, or none: never half an app).
// - Pages are fetched fresh when online (so an update shows at once) and from the saved copy when not.
// - A new version is saved alongside the old one and takes over the next time the app is opened, so an open page
//   never mixes files from two versions. Unchanged files are copied from the old version, not downloaded again.

/** [path relative to the app's address, content hash] for every file of this build. */
const FILES = self.__FILES__;
const VERSION = self.__VERSION__;

const PREFIX = 'pinvisual-';
const CACHE = `${PREFIX}${VERSION}`;
const HASH = 'x-pinvisual-hash';
const NAVIGATION_TIMEOUT_MS = 4000;

const scope = new URL(self.registration.scope);
const urlOf = (path) => new URL(path, scope).href;
const hashOf = new Map(FILES.map(([path, hash]) => [urlOf(path), hash]));
const PAGE = urlOf('index.html');

/** A response with its file's hash attached, so the next version can tell whether it changed. */
async function tagged(res, hash) {
  const headers = new Headers(res.headers);
  headers.set(HASH, hash);
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

/** Saves one file into this version: from an older version if it's unchanged there, else from the server. */
async function save(cache, path, hash) {
  const url = urlOf(path);
  const old = await caches.match(url);
  if (old && old.headers.get(HASH) === hash) return cache.put(url, old);
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return cache.put(url, await tagged(res, hash));
}

async function saveAll(cache, files) {
  // A few at a time: phones on slow connections cope better than with dozens of downloads at once.
  const queue = [...files];
  const one = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) await save(cache, f[0], f[1]);
  };
  await Promise.all([one(), one(), one(), one()]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await saveAll(cache, FILES);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** The page from the server (fresh), or the saved one when offline or the server is too slow to answer. */
async function page(request) {
  const saved = () => caches.match(PAGE, { cacheName: CACHE });
  try {
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS);
      fetch(request).then(
        (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
    if (res.ok) return res;
    return (await saved()) || res;
  } catch (e) {
    const s = await saved();
    if (s) return s;
    throw e;
  }
}

/** A file of this build: the saved copy, or downloaded and saved. */
async function file(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  const hash = hashOf.get(request.url);
  if (res.ok && hash) await cache.put(request, await tagged(res.clone(), hash)).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope.href)) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (hashOf.has(url.href) && url.href === request.url) event.respondWith(file(request));
  // Anything else (another site, a file not in this build) goes to the network as usual.
});

const scope = new URL(self.registration.scope);
const cachePrefix = `potok:${scope.pathname}:`;
const revision = '5bd46aed0007d05a';
const cacheName = `${cachePrefix}${revision}`;
const home = new URL('index.html', scope).href;
const assets = new Set([
  home,
  ...['flow.css', 'preferences.js', 'catalog.js', 'bible-data.js', 'bible-references.js', 'guide-references.js', 'epub.js', 'app.js', 'annotation-text.js', 'annotation-sync.js', 'annotations.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']
    .map(file => new URL(file, scope).href),
]);

self.addEventListener('install', event => {
  event.waitUntil(prepareOfflineCache());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  const isHome = request.mode === 'navigate' && (url.href === scope.href || url.href === home);
  if (!isHome && !assets.has(url.href)) return;
  event.respondWith(loadAsset(isHome ? home : url.href));
});

self.addEventListener('message', event => {
  const [reply] = event.ports;
  if (event.data !== 'offline-status' || !reply) return;
  event.waitUntil(prepareOfflineCache().then(() => reply.postMessage(true), () => reply.postMessage(false)));
});

async function prepareOfflineCache() {
  const cache = await caches.open(cacheName);
  const available = new Set((await cache.keys()).map(request => request.url));
  const missing = [...assets].filter(url => !available.has(url));
  if (missing.length) await cache.addAll(missing.map(url => new Request(url, {cache: 'reload'})));
}

async function loadAsset(key) {
  const cache = await caches.open(cacheName).catch(() => null);
  const available = await cache?.match(key).catch(() => null);
  if (available) return available;

  const response = await fetch(key, {cache: 'reload'});
  if (response.status === 200) await cache?.put(key, response.clone()).catch(() => {});
  return response;
}

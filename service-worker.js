const scope = new URL(self.registration.scope);
const cachePrefix = `potok:${scope.pathname}:`;
const cacheName = `${cachePrefix}v3`;
const home = new URL('index.html', scope).href;
const assets = new Set([
  home,
  ...['flow.css', 'catalog.js', 'bible-data.js', 'bible-references.js', 'epub.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']
    .map(file => new URL(file, scope).href),
]);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll([...assets].map(url => new Request(url, {cache: 'reload'}))),
  ));
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
  event.respondWith(loadAsset(request, isHome ? home : url.href));
});

async function loadAsset(request, key) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone()).catch(() => {});
      return response;
    }
    return await cache.match(key) ?? response;
  } catch (error) {
    const available = await cache.match(key);
    if (available) return available;
    throw error;
  }
}

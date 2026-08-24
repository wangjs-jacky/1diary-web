const CACHE_NAME = 'one-diary-shell-v1';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('/index.html', { cache: 'no-store' });
  const html = await response.clone().text();
  await cache.put('/index.html', response);
  await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html' } }));
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  try {
    const manifest = await fetch('/.vite/manifest.json', { cache: 'no-store' }).then((value) => value.json());
    Object.values(manifest).forEach((item) => {
      if (item.file) assets.push(`/${item.file}`);
      (item.css || []).forEach((file) => assets.push(`/${file}`));
      (item.assets || []).forEach((file) => assets.push(`/${file}`));
    });
  } catch {
    // The HTML-referenced entry assets still provide a usable offline shell.
  }
  await cache.addAll([...new Set(assets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().catch(() => caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && ['script', 'style', 'font', 'image'].includes(request.destination)) {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

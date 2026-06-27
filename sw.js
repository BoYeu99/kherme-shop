const CACHE = 'kherme-v2';
const SHELL = ['/', '/index.html', '/admin.html', '/icon-shop.svg', '/icon-admin.svg', '/manifest.json', '/admin-manifest.json'];

// Install: cache app shell
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// Activate: clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Fetch: network-first for API/images, cache-first for shell
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Always network for API calls and media uploads
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { headers: {'Content-Type':'application/json'} })));
    return;
  }
  // Cache-first for app shell (HTML, icons, manifests)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
        return res;
      });
      return cached || network;
    })
  );
});

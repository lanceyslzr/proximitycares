// Proximity PSW Portal Service Worker
const CACHE = 'proximity-psw-v1';
const STATIC = [
  '/psw-portal.html',
  '/psw-manifest.json',
  '/psw-icon-192.png',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Lora:ital,wght@0,400;0,500;1,400&family=Poppins:wght@300;400;500;600&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit network for Railway API calls
  if (url.hostname === 'proximity-agent-production.up.railway.app') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ success: false, error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Cache first for static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/psw-portal.html'));
    })
  );
});

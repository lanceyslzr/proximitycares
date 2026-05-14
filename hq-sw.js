// Proximity HQ Service Worker v5
// Fix: hq.html never cached (network-first always), cache version bumped
const CACHE = 'proximity-hq-v5';
const STATIC = [
  '/hq-manifest.json',
  '/icon-192.png',
  '/favicon-32.png',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&display=swap'
];
// NOTE: hq.html intentionally excluded from STATIC cache
// Always fetched fresh so HQ updates deploy immediately

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always hit network for Railway API calls
  if (url.hostname === 'proximity-agent-production.up.railway.app') {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ success: false, error: 'Offline — no connection to server' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // hq.html — ALWAYS network first, never serve stale
  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '/hq.html') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => res) // never cache
        .catch(() => caches.match('/hq.html')) // offline fallback only
    );
    return;
  }

  // SW files — never cache
  if (url.pathname.endsWith('.js') && url.pathname.includes('sw')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Everything else — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/hq.html'));
    })
  );
});

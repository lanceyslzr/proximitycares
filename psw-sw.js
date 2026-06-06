// Proximity PSW Portal — Service Worker v8
// Upgraded: offline queue sync + web push notifications + cache bust
// v8: offline shell is /psw-portal.html (index.html is now the family marketing site)
const CACHE = 'proximity-psw-v8';
const STATIC = [
  '/psw-portal.html',
  '/psw-manifest.json',
  '/psw-icon-192.png',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&display=swap'
];

// ── INSTALL ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(STATIC))
      .then(() => self.skipWaiting())
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
        new Response(JSON.stringify({ success: false, error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Network-first for HTML, cache-first for everything else
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200 && e.request.url.startsWith('http')) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque' &&
            e.request.url.startsWith('http')) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/psw-portal.html'));
    })
  );
});

// ── BACKGROUND SYNC — offline queue replay ──
self.addEventListener('sync', e => {
  if (e.tag === 'proximity-queue') {
    e.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  const db = await openQueueDB();
  const tx = db.transaction('actions', 'readwrite');
  const store = tx.objectStore('actions');
  const all = await getAllFromStore(store);

  for (const action of all) {
    try {
      const res = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload)
      });
      if (res.ok) {
        const delTx = db.transaction('actions', 'readwrite');
        delTx.objectStore('actions').delete(action.id);
      }
    } catch (err) {
      // Still offline — leave in queue
    }
  }

  // Notify open clients sync is done
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'QUEUE_REPLAYED' }));
}

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'Proximity Care', body: e.data.text() }; }

  const title = data.title || 'Proximity Care';
  const options = {
    body: data.body || 'You have an update.',
    icon: '/psw-icon-192.png',
    badge: '/psw-icon-192.png',
    tag: data.tag || 'proximity-update',
    renotify: true,
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: data.actions || []
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes('proximitycares.ca') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// ── INDEXEDDB HELPERS ──
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('proximity-offline', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror = e => reject(e.target.error);
  });
}

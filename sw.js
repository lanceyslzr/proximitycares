// Proximity Care marketing/family site service worker.
// HTML = network-first (deploys are always fresh; cache is only an offline fallback).
// Static assets = cache-first (fast, offline-capable).
// Cache bumped v1 -> v2 to purge the old cache-first HTML that could serve stale pages.
const C = "pcs-v2";
const A = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(A)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const isHTML = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // NETWORK-FIRST for HTML: always try the network so a new deploy shows immediately.
    // Refresh the cached copy on success; fall back to cache (then index.html) when offline.
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200) {
          const cp = res.clone();
          caches.open(C).then(c => c.put(req, cp));
        }
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match("/index.html")))
    );
    return;
  }

  // CACHE-FIRST for static assets (css/js/img/fonts).
  e.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === "basic") {
        const cp = res.clone();
        caches.open(C).then(c => c.put(req, cp));
      }
      return res;
    }))
  );
});

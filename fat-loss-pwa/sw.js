// 减脂助手 Service Worker v1.0
const CACHE = "fat-loss-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=Space+Mono:wght@400;700&family=Noto+Sans+SC:wght@300;400;500&display=swap"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("firebasejs") || e.request.url.includes("googleapis.com/identitytoolkit")) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});

const CACHE = "phecompte-v4";
const FILES = ["./", "./index.html", "./aliments.html", "./recettes-communaute.json", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./vendor/jspdf.umd.min.js", "./vendor/jspdf.plugin.autotable.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const put = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url), same = url.origin === location.origin;
  // pages et recettes de la communauté : réseau d'abord (toujours à jour), cache si hors connexion
  if (same && (req.mode === "navigate" || url.pathname.endsWith(".json") || url.pathname.endsWith(".html"))) {
    e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req, {ignoreSearch: true}).then(h => h || caches.match("./index.html"))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => (same || url.hostname.startsWith("fonts.g")) ? put(req, r) : r)));
});

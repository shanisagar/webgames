/* Offline cache for the games site. Pages: network first (always the newest build when online). Hashed build files:
   cache first (they never change). Images and fonts: cached, refreshed in the background. Ads, analytics and the
   database are never cached. */
const PAGES = "pages-v1", ASSETS = "assets-v1", MEDIA = "media-v1";
const KEEP = [PAGES, ASSETS, MEDIA];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon-192.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const font = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !font) return;
  // The dev preview site (<site>/dev/) has its own worker and cache.
  if (sameOrigin && url.pathname.startsWith(new URL("./dev/", self.location).pathname)) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(PAGES).then((c) => c.put("./", copy)); return res; })
        .catch(() => caches.match("./").then((r) => r || Response.error())),
    );
    return;
  }
  if (sameOrigin && url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)).then(() => trim(ASSETS, 160)); }
        return res;
      })),
    );
    return;
  }
  if (font || /\.(webp|png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(MEDIA).then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })),
    );
  }
});

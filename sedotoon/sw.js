// 세로툰 서비스 워커: 앱을 오프라인에서도 열리게 하고, 다른 앱에서 공유한 그림을 받는다.
const APP = "sedotoon-app-v11";
const SHELL = ["./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sedotoon-app-") && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  // pictures shared from the gallery / drawing app (Android)
  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData(), files = fd.getAll("images"), box = await caches.open("sedotoon-inbox");
        let i = 0;
        for (const f of files) { if (f && f.size) await box.put(new Request("./inbox/" + Date.now() + "-" + (i++)), new Response(f, { headers: { "Content-Type": f.type || "image/png" } })); }
      } catch (err) { /* nothing to keep */ }
      return Response.redirect("./index.html?shared=1", 303);
    })());
    return;
  }
  if (req.method !== "GET") return;
  // the app itself: network first so updates arrive, cache when offline
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(APP).then((c) => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html"))));
    return;
  }
  // AI library and fonts: keep a copy so the app works without internet
  if (/cdn\.jsdelivr\.net$|fonts\.googleapis\.com$|fonts\.gstatic\.com$/.test(url.hostname)) {
    e.respondWith(caches.open("sedotoon-libs").then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
  }
});

// 제타 스튜디오 오프라인 캐시 — 항상 최신 먼저(네트워크 우선), 오프라인일 때만 저장본
const CACHE = "zeta-studio-v5";
const SHELL = ["./", "./index.html", "./gif.js", "./ai.js", "./dna.js", "./studio.webmanifest", "./studio-192.png", "./studio-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("zeta-studio-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/sedotoon/")) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(e.request, { cache: "no-cache" });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch(err){
      return (await c.match(e.request)) || (await c.match("./index.html")) || Response.error();
    }
  })());
});

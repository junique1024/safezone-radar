// 오프라인 시연용 서비스 워커: 앱 파일은 네트워크 우선 + 캐시 대체, API는 캐시하지 않음
const CACHE = "szr-v2";
const CORE = ["/", "/index.html", "/app.js", "/styles.css", "/qrcode.min.js", "/icon.svg", "/manifest.webmanifest", "/sample-kma-asos.csv"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;
  const isFont = url.hostname.includes("fonts.g");
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: url.origin === location.origin }).then(r => r || (req.mode === "navigate" ? caches.match("/index.html") : undefined)))
  );
});

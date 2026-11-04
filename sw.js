/* オフラインでも開けるように、アプリ本体をキャッシュする。
 * ページ（HTML）は通信できるときは常に最新を取り、取れないときだけキャッシュを使う。
 * Googleのログインやドライブとの通信はキャッシュしない。
 */
const CACHE = "joutatsu-note-v12";
const SHELL = ["./", "index.html", "drive.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/googleapis\.com$|accounts\.google\.com$|gstatic\.com$/.test(url.hostname) && !url.hostname.startsWith("fonts")) return;
  if (req.mode === "navigate" || (url.origin === location.origin && /\.(js|webmanifest)$/.test(url.pathname))) {
    // 本体は毎回サーバーに更新を確かめる（GitHub Pages は最大10分ブラウザに保存させるため、no-cache で再検証する）
    e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req).then((r) => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.hostname))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});

/* TripRoute Pro service worker — network-first,確保部署新版後不會卡舊快取 */
const CACHE = 'triproute-v2.0.1';
const APP_SHELL = [
  './', './index.html',
  './styles.css?v=2.0.1', './app.js?v=2.0.1',
  './favicon.svg', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // 只清理本 app 的舊版快取;同網域(GitHub Pages 子目錄)其他專案的快取不可動
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('triproute-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只處理同源 GET;Google API 一律直連不快取
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 只快取成功回應,避免部署空窗期的 404/500 蓋掉好的 app shell
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => {
          if (hit) return hit;
          // 帶查詢參數的導航(例如 ?fbclid=)離線時退回 app shell
          if (e.request.mode === 'navigate') return caches.match('./');
          return Promise.reject(new Error('offline'));
        })
      )
  );
});

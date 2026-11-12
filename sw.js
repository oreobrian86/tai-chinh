// Service worker: lưu đệm "vỏ" giao diện để mở nhanh và cài được như ứng dụng.
// KHÔNG BAO GIỜ lưu dữ liệu tài chính: chỉ các file của app; mọi yêu cầu tới Google đều đi thẳng.
// Khi có bản vá mới trên GitHub, lần mở app tiếp theo tự lấy bản mới (mạng trước, đệm sau).
const VERSION = 'shell-2026-11-12-1';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;  // Google API: không đụng tới
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

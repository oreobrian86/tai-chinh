// Service worker: chỉ lưu đệm "vỏ" giao diện để mở nhanh và cài được như ứng dụng.
// KHÔNG BAO GIỜ lưu đệm dữ liệu /api (dữ liệu tài chính luôn lấy trực tiếp từ máy tính của bạn).
const VERSION = 'shell-v1';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/util.js', '/js/ui.js', '/js/state.js',
  '/js/forms.js', '/js/charts.js', '/js/views/dashboard.js', '/js/views/income.js', '/js/views/expenses.js',
  '/js/views/calendar.js', '/js/views/savings.js', '/js/views/reports.js', '/js/views/settings.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // Mạng trước, đệm sau: luôn lấy bản mới nhất khi có kết nối.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
  );
});

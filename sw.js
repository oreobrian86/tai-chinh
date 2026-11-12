// Service worker: mở app tức thì từ bản đã lưu trên máy, đồng thời lấy bản mới ở nền.
// KHÔNG BAO GIỜ lưu dữ liệu tài chính: chỉ các file giao diện; mọi yêu cầu tới Google đi thẳng, không qua đây.
// Mỗi bản phát hành đổi VERSION → máy tự tải trọn bộ file mới và app hiện thông báo "Đã có bản mới".
const VERSION = '2026-11-12-5';
const CACHE = 'shell-' + VERSION;
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'js/app.js',
  'js/theme-boot.js',
  'config.js',
  'js/api.js',
  'js/charts.js',
  'js/demo.js',
  'js/forms.js',
  'js/google.js',
  'js/state.js',
  'js/theme.js',
  'js/ui.js',
  'js/util.js',
  'js/core/backups.js',
  'js/core/db.js',
  'js/core/finance.js',
  'js/core/gcal.js',
  'js/core/importer.js',
  'js/core/reports.js',
  'js/core/router.js',
  'js/core/services.js',
  'js/core/store.js',
  'js/core/validate.js',
  'js/views/calendar.js',
  'js/views/dashboard.js',
  'js/views/expenses.js',
  'js/views/income.js',
  'js/views/reports.js',
  'js/views/savings.js',
  'js/views/settings.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;  // Google API: không đụng tới
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }  // có sẵn: trả ngay, cập nhật ở nền
    return (await network) || (await cache.match('index.html')) || Response.error();
  })());
});

// Áp chế độ nền NGAY khi mở trang (trước khi vẽ) để không bị chớp nền sáng khi đang dùng nền tối.
// Lựa chọn nền lưu riêng trên từng thiết bị (không phải dữ liệu tài chính).
(function () {
  var t = 'cream';
  try { t = localStorage.getItem('theme') || 'cream'; } catch (e) { }
  document.documentElement.setAttribute('data-theme', t);
  var dark = t === 'dark' || t === 'oled' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'oled' ? '#000000' : dark ? '#141917' : t === 'white' ? '#F6F7F7' : '#F6F5F0');
})();

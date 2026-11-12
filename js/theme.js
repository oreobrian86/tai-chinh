// Chế độ nền: kem (mặc định), trắng, tối, đen OLED, theo hệ thống.
export const THEMES = [
  ['cream', 'Kem sáng', ['#F6F5F0', '#FFFFFF', '#5F8370']],
  ['white', 'Trắng', ['#F6F7F7', '#FFFFFF', '#4F7D66']],
  ['dark', 'Tối', ['#141917', '#1C2320', '#7FAE93']],
  ['oled', 'Đen OLED', ['#000000', '#0D100E', '#7FAE93']],
  ['system', 'Theo hệ thống', ['#F6F5F0', '#141917', '#7FAE93']],
];

export function currentTheme() {
  try { return localStorage.getItem('theme') || 'cream'; } catch (_) { return 'cream'; }
}

export function setTheme(t) {
  try { localStorage.setItem('theme', t); } catch (_) { }
  document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || t === 'oled' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'oled' ? '#000000' : dark ? '#141917' : t === 'white' ? '#F6F7F7' : '#F6F5F0');
}

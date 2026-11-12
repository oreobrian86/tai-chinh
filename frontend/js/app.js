// Khởi động: kiểm tra phiên → thiết lập / đăng nhập / mở khóa → khung ứng dụng + điều hướng.
import { get, onApi, post, setCsrf } from './api.js';
import { openQuickAdd } from './forms.js';
import { loadRefs, onChanged, state } from './state.js';
import { busy, formData, icon, sheet, showErrors, toastErr } from './ui.js';
import { $, $$, applyDynamic, h, on } from './util.js';
import { calendarView } from './views/calendar.js';
import { dashboardView } from './views/dashboard.js';
import { expensesView } from './views/expenses.js';
import { incomeView, jobView } from './views/income.js';
import { reportsView } from './views/reports.js';
import { savingsView } from './views/savings.js';
import { settingsView } from './views/settings.js';

const app = document.getElementById('app');
const ROUTES = {
  '': dashboardView, income: incomeView, job: jobView, expenses: expensesView, calendar: calendarView,
  savings: savingsView, reports: reportsView, settings: settingsView,
};
const NAV = [['', 'Tổng quan', 'home'], ['income', 'Thu nhập', 'income'], ['expenses', 'Chi tiêu', 'expense'],
  ['calendar', 'Lịch làm việc', 'calendar'], ['savings', 'Tiết kiệm', 'savings'], ['reports', 'Báo cáo', 'reports'], ['settings', 'Cài đặt', 'settings']];
const TABS = [['', 'Tổng quan', 'home'], ['expenses', 'Chi tiêu', 'expense'], null, ['calendar', 'Lịch', 'calendar'], 'more'];

// ---------- màn hình xác thực ----------
const authShell = inner => `<main class="auth"><div class="auth-card">
  <div class="brand-mark big"><svg viewBox="0 0 24 24" aria-hidden="true">${'<rect x="2" y="7" width="20" height="10" rx="2" fill="#5F8370"/><path d="M6 7v10M18 7v10" stroke="#22302A" stroke-width="1.5"/>'}</svg></div>${inner}</div></main>`;

function setupScreen() {
  app.innerHTML = authShell(`<h1>Chào mừng</h1>
    <p class="muted">Tạo tài khoản để bảo vệ dữ liệu tài chính của bạn. Dữ liệu chỉ lưu trên máy tính này.</p>
    <form class="form" novalidate>
      <label class="field"><span>Tên đăng nhập</span><input class="input" name="username" autocomplete="username" autofocus pattern="[A-Za-z0-9_.\\-]+" placeholder="Ví dụ: phuc"></label>
      <label class="field"><span>Tên hiển thị</span><input class="input" name="display_name" placeholder="Tên của bạn"></label>
      <label class="field"><span>Mật khẩu</span><input class="input" type="password" name="password" autocomplete="new-password"><span class="hint">Ít nhất 10 ký tự. Một câu dài dễ nhớ an toàn hơn mật khẩu ngắn phức tạp.</span></label>
      <label class="field"><span>Nhập lại mật khẩu</span><input class="input" type="password" name="password2" autocomplete="new-password"></label>
      <button class="btn primary block" type="submit">Tạo tài khoản</button>
    </form>`);
  const form = $('form', app);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = formData(form);
    if (d.password !== d.password2) return showErrors(form, { fields: { password2: 'Mật khẩu nhập lại không khớp' } });
    await busy(form.querySelector('[type=submit]'), async () => {
      try { await post('/api/auth/setup', { username: d.username, display_name: d.display_name || null, password: d.password }); boot(); }
      catch (err) { showErrors(form, err); }
    });
  });
}

function loginScreen() {
  app.innerHTML = authShell(`<h1>Đăng nhập</h1><p class="muted">Tài chính và lịch làm việc của bạn.</p>
    <form class="form" novalidate>
      <label class="field"><span>Tên đăng nhập</span><input class="input" name="username" autocomplete="username" autofocus></label>
      <label class="field"><span>Mật khẩu</span><input class="input" type="password" name="password" autocomplete="current-password"></label>
      <button class="btn primary block" type="submit">Đăng nhập</button>
    </form>`);
  const form = $('form', app);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    await busy(form.querySelector('[type=submit]'), async () => {
      try { await post('/api/auth/login', formData(form)); boot(); } catch (err) { showErrors(form, err); form.password.select(); }
    });
  });
}

function lockScreen() {
  stopIdle();
  const hasPin = state.user?.has_pin;
  app.innerHTML = authShell(`<h1>Đã khóa</h1><p class="muted">${hasPin ? 'Nhập mã PIN 6 số để mở khóa.' : 'Nhập mật khẩu để mở khóa.'}</p>
    ${hasPin ? `<div class="pin-dots" aria-hidden="true">${'<i></i>'.repeat(6)}</div><p class="err center small" id="pinerr"></p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button class="fn" data-k="pw">Mật khẩu</button><button data-k="0">0</button><button class="fn" data-k="back" aria-label="Xóa">⌫</button></div>` : ''}
    <form class="form ${hasPin ? 'hidden' : ''}" novalidate>
      <label class="field"><span>Mật khẩu</span><input class="input" type="password" name="password" autocomplete="current-password" autofocus></label>
      <button class="btn primary block" type="submit">Mở khóa</button>
    </form>
    <p class="center mt"><button class="btn ghost sm" data-logout>Đăng xuất</button></p>`);
  let pin = '';
  const dots = () => $$('.pin-dots i', app).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const unlock = async body => {
    try { await post('/api/auth/unlock', body); boot(); }
    catch (err) {
      if (err.code === 'unauthenticated') return boot();
      pin = ''; dots();
      const pe = $('#pinerr', app); if (pe) pe.textContent = err.message;
      if (!hasPin || body.password) showErrors($('form', app), err);
    }
  };
  on(app, 'click', '[data-k]', (e, el) => {
    const k = el.dataset.k;
    if (k === 'pw') { $('form', app).classList.remove('hidden'); $('.keypad', app).classList.add('hidden'); $('.pin-dots', app).classList.add('hidden'); $('[name=password]', app).focus(); return; }
    if (k === 'back') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k;
    dots();
    if (pin.length === 6) unlock({ pin });
  });
  document.onkeydown = e => { if (hasPin && /^\d$/.test(e.key) && !$('form', app).contains(document.activeElement)) { if (pin.length < 6) { pin += e.key; dots(); if (pin.length === 6) unlock({ pin }); } } };
  $('form', app).addEventListener('submit', e => { e.preventDefault(); unlock({ password: $('[name=password]', app).value }); });
  $('[data-logout]', app).addEventListener('click', async () => { try { await post('/api/auth/logout'); } catch (_) { } location.reload(); });
}

// ---------- khung ứng dụng ----------
function shell() {
  app.innerHTML = `<div class="shell">
    <aside class="side" aria-label="Điều hướng">
      <div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="2" fill="#5F8370"/><path d="M6 7v10M18 7v10" stroke="#F6F5F0" stroke-width="1.5"/></svg></span>
        <span>${h(state.user?.display_name || 'Tài chính')}</span></div>
      <nav class="nav">${NAV.map(([r, l, i]) => `<a href="#/${r}" data-r="${r}">${icon(i)}${l}</a>`).join('')}</nav>
      <div class="side-foot"><button class="btn ghost" data-lock>${icon('lock')}Khóa ứng dụng</button></div>
    </aside>
    <main class="main" id="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Điều hướng nhanh">${TABS.map(t => t === 'more' ? `<button data-more>${icon('menu')}Thêm</button>`
      : t ? `<a href="#/${t[0]}" data-r="${t[0]}">${icon(t[2])}${t[1]}</a>`
      : `<button class="tab-add" data-add aria-label="Thêm nhanh"><span>${icon('plus')}</span></button>`).join('')}</nav>
    <button class="fab" data-add>${icon('plus')}Thêm nhanh</button>
  </div>`;
  on(app, 'click', '[data-add]', () => openQuickAdd());
  on(app, 'click', '[data-lock]', () => lockNow());
  on(app, 'click', '[data-more]', () => sheet('Mục khác', `<nav class="list more-menu">
      ${[['income', 'Thu nhập và show', 'income'], ['income/receivables', 'Công nợ cần thu', 'income'], ['savings', 'Tiết kiệm', 'savings'],
         ['reports', 'Báo cáo', 'reports'], ['expenses/obligations', 'Khoản phải trả', 'expense'], ['settings', 'Cài đặt và sao lưu', 'settings']]
        .map(([r, l, i]) => `<a class="item" href="#/${r}"><span class="ic">${icon(i)}</span><span class="t">${l}</span><span></span></a>`).join('')}
      <button class="item" data-lock-m><span class="ic">${icon('lock')}</span><span class="t">Khóa ứng dụng</span><span></span></button></nav>`, {
    onMount(root, close) {
      on(root, 'click', 'a.item', () => close());
      on(root, 'click', '[data-lock-m]', () => { close(); lockNow(); });
    },
  }));
}

let renderSeq = 0;
async function render({ keepScroll = false } = {}) {
  const view = $('#view');
  if (!view) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = ROUTES[parts[0]] ? parts[0] : '';
  const fn = ROUTES[name];
  const navKey = name === 'job' ? 'income' : name;
  $$('[data-r]').forEach(a => { if (a.dataset.r === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const seq = ++renderSeq;
  const y = window.scrollY;
  if (!keepScroll) view.innerHTML = `<div class="page"><div class="loading"><div class="skeleton"></div></div></div>`;
  // Mỗi lần vẽ dùng một khung mới (listener gắn trên khung này đi theo nó vào trang).
  const frame = document.createElement('div');
  try {
    await fn(frame, parts.slice(1));
    if (seq !== renderSeq) return;
    view.replaceChildren(frame);
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err.status === 423 || err.status === 401) return;
    view.innerHTML = `<div class="page"><div class="empty"><div class="big">⚠️</div><p>${h(err.message)}</p><button class="btn">Thử lại</button></div></div>`;
    $('button', view).addEventListener('click', () => render());
    return;
  }
  applyDynamic(view);
  if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); }
  document.title = (NAV.find(n => n[0] === navKey)?.[1] || 'Tài chính') + ' · Tài chính & Lịch';
}

// ---------- tự khóa ----------
let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  const m = Number(state.settings?.lock_minutes || 0);
  if (m > 0) idleTimer = setTimeout(lockNow, m * 60 * 1000);
}
function stopIdle() { clearTimeout(idleTimer); ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.removeEventListener(ev, resetIdle)); }
function startIdle() { ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true })); resetIdle(); }
async function lockNow() {
  try { await post('/api/auth/lock'); } catch (_) { }
  $$('.overlay').forEach(o => o.remove()); document.body.style.overflow = '';
  lockScreen();
}
window.addEventListener('app-lock', lockNow);

// ---------- khởi động ----------
let started = false;
async function boot() {
  document.onkeydown = null;
  let st;
  try { st = await get('/api/auth/state'); }
  catch (err) { app.innerHTML = authShell(`<h1>Không kết nối được</h1><p class="muted">${h(err.message)}</p>`); return; }
  setCsrf(st.csrf || null);
  if (st.setup_needed) return setupScreen();
  if (!st.authenticated) return loginScreen();
  state.user = st.user; state.settings = st.settings || {};
  if (st.locked) return lockScreen();
  try { await loadRefs(); } catch (err) { if (err.status === 423) return lockScreen(); toastErr(err); }
  shell();
  startIdle();
  if (!started) {
    started = true;
    window.addEventListener('hashchange', () => render());
    onChanged(() => render({ keepScroll: true }));
    onApi('locked', () => lockScreen());
    onApi('unauth', () => boot());
  }
  render();
}

// Phần tử mới (trang vẽ lại, bảng trượt) tự được áp chiều rộng/màu động.
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) applyDynamic(n.parentElement || n);
}).observe(document.body, { childList: true, subtree: true });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/sw.js').catch(() => { });
}
boot();

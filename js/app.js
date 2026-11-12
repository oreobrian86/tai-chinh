// Khởi động: đăng nhập Google → mở (hoặc tạo) file dữ liệu trên Drive → khung ứng dụng + điều hướng.
import { get, onApi, post, put, setBackend } from './api.js';
import { Backups } from './core/backups.js';
import { Api } from './core/router.js';
import { DataSession, MemoryStore, SheetsStore } from './core/store.js';
import { CalendarSync } from './core/gcal.js';
import { seedDemo } from './demo.js';
import { updateSettings } from './core/services.js';
import { openQuickAdd } from './forms.js';
import * as google from './google.js';
import { loadRefs, onChanged, state } from './state.js';
import { icon, sheet, toast, toastErr } from './ui.js';
import { $, $$, applyDynamic, h, on, privacy } from './util.js';
import { calendarView } from './views/calendar.js';
import { dashboardView } from './views/dashboard.js';
import { expensesView } from './views/expenses.js';
import { incomeView, jobView } from './views/income.js';
import { reportsView } from './views/reports.js';
import { savingsView } from './views/savings.js';
import { settingsView } from './views/settings.js';

const app = document.getElementById('app');
const DEMO = new URLSearchParams(location.search).has('demo');
const ROUTES = {
  '': dashboardView, income: incomeView, job: jobView, expenses: expensesView, calendar: calendarView,
  savings: savingsView, reports: reportsView, settings: settingsView,
};
const NAV = [['', 'Tổng quan', 'home'], ['income', 'Thu nhập', 'income'], ['expenses', 'Chi tiêu', 'expense'],
  ['calendar', 'Lịch làm việc', 'calendar'], ['savings', 'Tiết kiệm', 'savings'], ['reports', 'Báo cáo', 'reports'], ['settings', 'Cài đặt', 'settings']];
const TABS = [['', 'Tổng quan', 'home'], ['expenses', 'Chi tiêu', 'expense'], null, ['calendar', 'Lịch', 'calendar'], 'more'];

export const runtime = { store: null, session: null, backups: null, demo: DEMO };

// ---------- màn hình đăng nhập ----------
const mark = '<rect x="2" y="7" width="20" height="10" rx="2" fill="#5F8370"/><path d="M6 7v10M18 7v10" stroke="#22302A" stroke-width="1.5"/>';
const authShell = inner => `<main class="auth"><div class="auth-card">
  <div class="brand-mark big"><svg viewBox="0 0 24 24" aria-hidden="true">${mark}</svg></div>${inner}</div></main>`;

function loginScreen({ locked = false, message = '' } = {}) {
  stopIdle();
  if (!google.configured()) {
    app.innerHTML = authShell(`<h1>Chưa cấu hình</h1>
      <p class="muted">Mở file <b>config.js</b> và dán Client ID của bạn vào dòng CLIENT_ID, rồi tải file lên GitHub.</p>
      <p class="mt"><a class="btn block" href="?demo">Xem thử với dữ liệu mẫu</a></p>`);
    return;
  }
  app.innerHTML = authShell(`<h1>${locked ? 'Đã khóa' : 'Tài chính & Lịch'}</h1>
    <p class="muted">${locked ? 'Đăng nhập lại bằng Google để mở khóa.' : 'Đăng nhập bằng tài khoản Google chứa dữ liệu của bạn. Dữ liệu nằm trong Google Drive của bạn, không lưu trên máy này.'}</p>
    ${message ? `<div class="notice danger mt">${h(message)}</div>` : ''}
    <button class="btn primary block mt" data-signin>${locked ? 'Mở khóa bằng Google' : 'Đăng nhập bằng Google'}</button>
    <p class="small faint mt">Lần đầu, Google sẽ hỏi bạn có cho ứng dụng tạo và dùng file dữ liệu riêng trong Drive không. Ứng dụng không xem được các file khác của bạn.</p>`);
  $('[data-signin]', app).addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Đang đăng nhập…';
    try {
      await google.signIn();
      await openData();
    } catch (err) {
      loginScreen({ locked, message: err.message });
    }
  });
}

async function openData() {
  app.innerHTML = authShell(`<h1>Đang mở dữ liệu…</h1><p class="muted">Đang kết nối Google Drive.</p><div class="skeleton mt"></div>`);
  if (!runtime.store) {
    runtime.store = new SheetsStore(google.getToken);
    runtime.session = new DataSession(runtime.store);
    runtime.backups = new Backups(runtime.store, runtime.session);
    setBackend(new Api(runtime.session, { backups: runtime.backups, calendar: new CalendarSync(google.getToken, undefined, { canRead: google.calendarReadGranted }),
      appUrl: location.origin + location.pathname }));
  }
  if (!runtime.store.id) await runtime.store.open();
  await runtime.session.refresh();
  runtime.session.onUpdate = () => render({ keepScroll: true });
  await start();
  // tự sao lưu mỗi ngày (không chặn giao diện)
  runtime.backups.maybeAuto(state.settings.last_backup_at)
    .then(done => done && runtime.session.mutate((tx, db) => updateSettings(tx, db, { last_backup_at: new Date().toISOString() })))
    .catch(() => { });
}

async function start() {
  const st = await get('/api/state');
  if (st.setup_needed) await post('/api/setup');
  state.settings = (await get('/api/state')).settings;
  privacy.on = !!state.settings.hide_amounts;
  state.user = { display_name: state.settings.display_name || 'Tài chính' };
  await loadRefs();
  shell();
  startIdle();
  if (!started) {
    started = true;
    window.addEventListener('hashchange', () => render());
    onChanged(() => { render({ keepScroll: true }); scheduleCalendarSync(); });
    onApi('unauth', () => reauthPrompt());
  }
  render();
  scheduleCalendarSync(500);
}

// ---------- tự đồng bộ Google Calendar (chạy ngầm) ----------
// Đẩy lên: 4 giây sau lần sửa cuối. Lấy về: khi mở app, khi quay lại app và mỗi 5 phút lúc đang mở.
let calTimer = null, calWarned = false, calLast = 0;
const calActive = () => !runtime.demo && state.settings && (
  (state.settings.gcal_enabled && google.calendarGranted()) || (state.settings.gcal_import && google.calendarReadGranted()));
function scheduleCalendarSync(delay = 4000) {
  if (!calActive()) return;
  clearTimeout(calTimer);
  calTimer = setTimeout(async () => {
    calLast = Date.now();
    try {
      const r = await post('/api/gcal/sync');
      calWarned = false;
      const im = r?.imported;
      if (im && im.added + im.changed + im.removed > 0) {
        render({ keepScroll: true });
        if (im.added) toast(`Đã lấy ${im.added} lịch mới từ Google Calendar thành show nháp. Mở show để điền khách và tiền công.`);
      }
    } catch (e) { if (!calWarned && e.code !== 'google_auth') { calWarned = true; toast('Chưa đồng bộ được Google Calendar: ' + e.message, 'err'); } }
  }, delay);
}
setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - calLast > 4.5 * 60_000) scheduleCalendarSync(0); }, 60_000);

/** Bật/tắt ẩn số tiền (nhớ chung cho mọi thiết bị). */
export async function togglePrivacy() {
  privacy.on = !privacy.on;
  updateEye();
  render({ keepScroll: true });
  try { state.settings = await put('/api/settings', { hide_amounts: privacy.on }); } catch (_) { }
}
function updateEye() {
  $$('[data-eye]').forEach(b => {
    b.innerHTML = `${icon(privacy.on ? 'eyeOff' : 'eye')}<span class="eye-label">${privacy.on ? 'Hiện số tiền' : 'Ẩn số tiền'}</span>`;
    b.setAttribute('aria-pressed', String(privacy.on));
  });
}
window.addEventListener('toggle-privacy', togglePrivacy);

let reauthOpen = false;
function reauthPrompt() {
  if (reauthOpen || runtime.demo) return;
  reauthOpen = true;
  sheet('Phiên Google đã hết hạn', `<p class="muted">Vì an toàn, quyền truy cập Google chỉ kéo dài khoảng 1 giờ. Bấm tiếp tục để đăng nhập lại; dữ liệu bạn đang nhập dở trong hộp thoại khác vẫn giữ nguyên.</p>
    <div class="sheet-foot"><button class="btn primary block" data-re>Tiếp tục với Google</button></div>`, {
    onClose() { reauthOpen = false; },
    onMount(root, close) {
      $('[data-re]', root).addEventListener('click', async () => {
        try { await google.signIn(); close(); toast('Đã đăng nhập lại'); render({ keepScroll: true }); }
        catch (e) { toastErr(e); }
      });
    },
  });
}

// ---------- khung ứng dụng ----------
function shell() {
  app.innerHTML = `${runtime.demo ? '<div class="demo-bar">Chế độ dùng thử: dữ liệu mẫu, tải lại trang là mất. <a href="./">Thoát</a></div>' : ''}<div class="shell">
    <aside class="side" aria-label="Điều hướng">
      <div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="2" fill="#5F8370"/><path d="M6 7v10M18 7v10" stroke="#F6F5F0" stroke-width="1.5"/></svg></span>
        <span>${h(state.user?.display_name || 'Tài chính')}</span></div>
      <nav class="nav">${NAV.map(([r, l, i]) => `<a href="#/${r}" data-r="${r}">${icon(i)}${l}</a>`).join('')}</nav>
      <div class="side-foot"><button class="btn ghost" data-eye></button><button class="btn ghost" data-lock>${icon('lock')}Khóa ứng dụng</button></div>
    </aside>
    <main class="main" id="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Điều hướng nhanh">${TABS.map(t => t === 'more' ? `<button data-more>${icon('menu')}Thêm</button>`
      : t ? `<a href="#/${t[0]}" data-r="${t[0]}">${icon(t[2])}${t[1]}</a>`
      : `<button class="tab-add" data-add aria-label="Thêm nhanh"><span>${icon('plus')}</span></button>`).join('')}</nav>
    <button class="fab" data-add>${icon('plus')}Thêm nhanh</button>
  </div>`;
  on(app, 'click', '[data-add]', () => openQuickAdd());
  on(app, 'click', '[data-eye]', () => togglePrivacy());
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
  const navKey = name === 'job' ? 'income' : name;
  $$('[data-r]').forEach(a => { if (a.dataset.r === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const seq = ++renderSeq;
  const y = window.scrollY;
  if (!keepScroll) view.innerHTML = `<div class="page"><div class="loading"><div class="skeleton"></div></div></div>`;
  const frame = document.createElement('div');
  try {
    await ROUTES[name](frame, parts.slice(1));
    if (seq !== renderSeq) return;
    view.replaceChildren(frame);
  } catch (err) {
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="page"><div class="empty"><div class="big">⚠️</div><p>${h(err.message)}</p><button class="btn">Thử lại</button></div></div>`;
    $('button', view).addEventListener('click', () => { runtime.session.loadedAt = 0; render(); });
    return;
  }
  applyDynamic(view);
  updateEye();
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  document.title = (NAV.find(n => n[0] === navKey)?.[1] || 'Tài chính') + ' · Tài chính & Lịch';
}

// ---------- khóa ----------
let idleTimer = null;
function resetIdle() {
  clearTimeout(idleTimer);
  const m = Number(state.settings?.lock_minutes || 0);
  if (m > 0) idleTimer = setTimeout(lockNow, m * 60 * 1000);
}
function stopIdle() { clearTimeout(idleTimer); ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.removeEventListener(ev, resetIdle)); }
function startIdle() { ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true })); resetIdle(); }

function lockNow() {
  $$('.overlay').forEach(o => o.remove());
  document.body.style.overflow = '';
  if (runtime.demo) { toast('Chế độ dùng thử không có khóa'); return; }
  google.forget();
  runtime.session.db = new runtime.session.db.constructor();  // xóa dữ liệu khỏi bộ nhớ
  runtime.session.loadedAt = 0;
  loginScreen({ locked: true });
}
window.addEventListener('app-lock', lockNow);

// ---------- khởi động ----------
let started = false;
async function boot() {
  if (DEMO) {
    google.forget();
    runtime.store = new MemoryStore();
    runtime.session = new DataSession(runtime.store);
    runtime.session.onUpdate = () => render({ keepScroll: true });
    setBackend(new Api(runtime.session));
    await post('/api/setup');
    await seedDemo();
    await start();
    return;
  }
  loginScreen();
  if (google.configured()) google.init().catch(() => { });  // tải sẵn thư viện đăng nhập
}

new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) applyDynamic(n.parentElement || n);
}).observe(document.body, { childList: true, subtree: true });

// ---------- bản cập nhật mới ----------
function showUpdateBar(worker) {
  if (document.querySelector('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Đã có bản cập nhật mới.</span><button class="btn sm">Dùng bản mới</button>';
  bar.querySelector('button').onclick = () => { worker.postMessage('skip-waiting'); };
  document.body.appendChild(bar);
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(w); });
    });
    setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
  }).catch(() => { });
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
}

// Mở lại app từ nền (chuyển tab / mở lại trên điện thoại): lấy dữ liệu mới ở nền, không bắt chờ.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && runtime.session?.loadedAt && Date.now() - runtime.session.loadedAt > 15000) {
    runtime.session.backgroundRefresh();
  }
  if (document.visibilityState === 'visible' && Date.now() - calLast > 60_000) scheduleCalendarSync(1500);
});
boot();

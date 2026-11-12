// Thành phần giao diện: bảng trượt, xác nhận, thông báo, biểu tượng, lỗi form.
import { $, $$, applyDynamic, h } from './util.js';

export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  income: '<path d="M12 3v14m0 0-5-5m5 5 5-5M4 21h16"/>',
  expense: '<path d="M12 21V7m0 0-5 5m5-5 5 5M4 3h16"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  savings: '<path d="M4 12a8 8 0 0 1 16 0v1a3 3 0 0 1-3 3h-1l-1 4H9l-1-4H7a3 3 0 0 1-3-3z"/><path d="M12 8v4"/>',
  reports: '<path d="M4 20V10m6 10V4m6 16v-7m6 7H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.5 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M4 20h16"/>',
  upload: '<path d="M12 20V9m0 0-4 4m4-4 4 4M4 4h16"/>',
  logo: '<rect x="2" y="7" width="20" height="10" rx="2" fill="#5F8370"/><path d="M6 7v10M18 7v10" stroke="#22302A" stroke-width="1.5"/><path d="M9 12h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};

export const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------- thông báo nhỏ ----------
export function toast(msg, kind = '') {
  let host = $('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2600);
}
export const toastErr = e => toast(e?.message || 'Có lỗi xảy ra', 'err');

// ---------- bảng trượt ----------
let openCount = 0;
export function sheet(title, bodyHTML, { onMount, onClose, wide = false } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2>${h(title)}</h2><button class="btn ghost icon-btn" data-close aria-label="Đóng">${icon('close')}</button></div>
    <div class="sheet-body">${bodyHTML}</div></div>`;
  document.body.appendChild(ov);
  openCount++;
  document.body.style.overflow = 'hidden';
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => ov.classList.add('show'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    ov.classList.remove('show');
    openCount--;
    if (!openCount) document.body.style.overflow = '';
    setTimeout(() => ov.remove(), 200);
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelector('[data-close]').addEventListener('click', close);
  const body = ov.querySelector('.sheet-body');
  applyDynamic(body);
  onMount?.(body, close);
  const first = body.querySelector('[autofocus], input:not([type=hidden]), select, textarea');
  if (first && window.matchMedia('(min-width: 861px)').matches) {
    // Không giành con trỏ nếu người dùng đã kịp chọn một ô khác trong hộp thoại.
    setTimeout(() => { if (!ov.querySelector('.sheet-body').contains(document.activeElement)) first.focus(); }, 60);
  }
  return close;
}

export function confirmDialog(message, { ok = 'Đồng ý', danger = false, title = 'Xác nhận' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    sheet(title, `<p>${h(message)}</p>
      <div class="row confirm-row"><span class="spacer"></span>
      <button class="btn" data-no>Không</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${h(ok)}</button></div>`,
      {
        onMount(body, cl) {
          body.querySelector('[data-no]').onclick = () => { answered = true; resolve(false); cl(); };
          body.querySelector('[data-yes]').onclick = () => { answered = true; resolve(true); cl(); };
        },
        onClose() { if (!answered) resolve(false); },
      });
  });
}

// ---------- form ----------
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}

export function showErrors(form, err) {
  $$('.err', form).forEach(e => e.remove());
  $$('.invalid', form).forEach(e => e.classList.remove('invalid'));
  const fields = err?.fields || {};
  let shown = false;
  for (const [k, msg] of Object.entries(fields)) {
    const name = k.split('.')[0];
    const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (el) {
      el.classList.add('invalid');
      const s = document.createElement('span'); s.className = 'err'; s.textContent = msg;
      (el.closest('.field') || el.parentElement).appendChild(s);
      shown = true;
    }
  }
  if (!shown) toastErr(err);
}

/** Nút gửi form: khóa trong lúc chờ để không bấm 2 lần (tránh ghi trùng giao dịch). */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = 'Đang lưu…';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}

export const field = (label, inner, hint = '') =>
  `<label class="field"><span>${h(label)}</span>${inner}${hint ? `<span class="hint">${h(hint)}</span>` : ''}</label>`;

export const options = (items, selected) =>
  items.map(([v, l]) => `<option value="${h(v)}"${String(v) === String(selected ?? '') ? ' selected' : ''}>${h(l)}</option>`).join('');

export const empty = (big, text, btn = '') => `<div class="empty"><div class="big">${big}</div><p>${h(text)}</p>${btn}</div>`;

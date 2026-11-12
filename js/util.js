// Tiện ích dùng chung: định dạng tiền, ngày, chống XSS, DOM.

const nf = new Intl.NumberFormat('vi-VN');

/** Escape mọi dữ liệu người dùng trước khi chèn vào HTML. */
export function h(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
}

/** Chế độ ẩn số tiền (nút con mắt). */
export const privacy = { on: false };
const MASK = '••••••';

export const money = (v, { sign = false, unit = true } = {}) => {
  if (privacy.on) return MASK + (unit ? 'đ' : '');
  const n = Math.round(Number(v) || 0);
  const s = nf.format(Math.abs(n));
  const pre = n < 0 ? '−' : (sign && n > 0 ? '+' : '');
  return pre + s + (unit ? 'đ' : '');
};

/** Rút gọn: 1.500.000 → 1,5tr ; 45.000 → 45k */
export const short = v => {
  if (privacy.on) return '•••';
  const n = Math.round(Number(v) || 0), a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e9) return s + trim(a / 1e9) + ' tỷ';
  if (a >= 1e6) return s + trim(a / 1e6) + 'tr';
  if (a >= 1e3) return s + trim(a / 1e3) + 'k';
  return s + a;
};
const trim = x => (Math.round(x * 10) / 10).toString().replace('.', ',');

/** Đọc số tiền người dùng gõ: "45.000", "45k", "1,5tr", "1tr5", "2 triệu" */
export function parseMoney(input) {
  if (input === null || input === undefined) return NaN;
  let s = String(input).trim().toLowerCase().replace(/\s+/g, '').replace(/đ|vnd|vnđ/g, '');
  if (!s) return NaN;
  let m = s.match(/^(\d+)(?:tr|triệu|m)(\d{1,3})$/); // 1tr5 → 1.500.000
  if (m) return Number(m[1]) * 1e6 + Number(m[2].padEnd(3, '0')) * 1e3;
  m = s.match(/^([\d.,]+)(k|ng|nghìn|ngàn|tr|triệu|m|tỷ|ty|b)?$/);
  if (!m) return NaN;
  let num = m[1], mult = 1;
  const u = m[2];
  if (u) {
    mult = { k: 1e3, ng: 1e3, 'nghìn': 1e3, 'ngàn': 1e3, tr: 1e6, 'triệu': 1e6, m: 1e6, 'tỷ': 1e9, ty: 1e9, b: 1e9 }[u];
    num = num.replace(',', '.');
    if ((num.match(/\./g) || []).length > 1) num = num.replace(/\./g, '');
    return Math.round(parseFloat(num) * mult);
  }
  return Number(num.replace(/[.,]/g, ''));
}

export function formatMoneyInput(el) {
  el.addEventListener('input', () => {
    const raw = el.value;
    if (/[a-zà-ỹ]/i.test(raw)) return; // đang gõ dạng 45k / 1tr5 thì để nguyên
    const digits = raw.replace(/\D/g, '');
    const pos = el.selectionStart, before = raw.length;
    el.value = digits ? nf.format(Number(digits)) : '';
    const diff = el.value.length - before;
    try { el.setSelectionRange(pos + diff, pos + diff); } catch (_) { }
  });
}

// ---------- ngày ----------
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const addMonths = (s, n) => { const d = parseISO(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return iso(d); };
export const monthStart = s => s.slice(0, 8) + '01';
export const monthEnd = s => { const d = parseISO(s); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DOW_LONG = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const dow = s => DOW[parseISO(s).getDay()];
export const dmy = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
export const dm = s => { if (!s) return ''; const [, m, d] = s.split('-'); return `${d}/${m}`; };
export function niceDate(s) {
  if (!s) return '';
  const t = today();
  if (s === t) return 'Hôm nay';
  if (s === addDays(t, -1)) return 'Hôm qua';
  if (s === addDays(t, 1)) return 'Ngày mai';
  const d = parseISO(s);
  const yr = s.slice(0, 4) !== t.slice(0, 4) ? `/${s.slice(0, 4)}` : '';
  return `${DOW_LONG[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}${yr}`;
}
export const monthLabel = ym => { const [y, m] = ym.split('-'); return `Tháng ${Number(m)}/${y}`; };
export const monthShort = ym => `T${Number(ym.split('-')[1])}`;

// ---------- DOM ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** CSP chặn thuộc tính style trong HTML, nên chiều rộng/màu động gán qua data-* rồi đặt bằng JS. */
export function applyDynamic(root) {
  $$('[data-w]', root).forEach(e => { e.style.width = Math.max(0, Math.min(100, Number(e.dataset.w))) + '%'; });
  $$('[data-left]', root).forEach(e => { e.style.left = Math.max(0, Math.min(100, Number(e.dataset.left))) + '%'; });
  $$('[data-bg]', root).forEach(e => { if (/^#[0-9a-f]{6}$/i.test(e.dataset.bg)) e.style.background = e.dataset.bg; });
  $$('[data-tint]', root).forEach(e => { if (/^#[0-9a-f]{6}$/i.test(e.dataset.tint)) e.style.background = e.dataset.tint + '24'; });
}

/** Ủy quyền sự kiện. Gọi lại với cùng (event, selector) trên cùng root sẽ THAY handler cũ,
 *  nên một trang tự vẽ lại nhiều lần không bị gắn trùng (tránh mở 2 hộp thoại / ghi 2 lần). */
export function on(root, event, selector, fn) {
  const reg = root.__handlers || (root.__handlers = new Map());
  const key = event + '|' + selector;
  if (reg.has(key)) root.removeEventListener(event, reg.get(key));
  const handler = e => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  reg.set(key, handler);
  root.addEventListener(event, handler);
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const WORK_TYPES = { video: 'Quay phim', edit: 'Dựng phim', photo: 'Chụp ảnh', other: 'Khác' };
export const WORK_ICONS = { video: '🎥', edit: '✂️', photo: '📷', other: '•' };
export const SESSION_KINDS = { shoot: 'Ngày quay', photo: 'Ngày chụp', edit: 'Ngày dựng', deadline: 'Hạn bàn giao', other: 'Khác' };
export const JOB_STATUS = { booked: 'Đã nhận show', in_progress: 'Đang thực hiện', done: 'Hoàn thành', cancelled: 'Đã hủy' };
export const PAY_STATUS = { unpaid: 'Chưa thanh toán', partial: 'Thanh toán một phần', paid: 'Đã thanh toán' };
export const ACCOUNT_KINDS = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử', savings: 'Tiết kiệm', other: 'Khác' };
export const TX_KINDS = { job_payment: 'Tiền show', job_refund: 'Hoàn cọc', other_income: 'Thu khác', expense: 'Chi', transfer: 'Chuyển khoản', adjustment: 'Điều chỉnh số dư' };

export function payChip(j) {
  if (j.work_status === 'cancelled') return `<span class="chip">Đã hủy</span>`;
  if (j.outstanding > 0 && j.overdue_days > 0) return `<span class="chip danger">Quá hạn ${j.overdue_days} ngày</span>`;
  if (j.pay_status === 'paid') return `<span class="chip sage">Đã thanh toán</span>`;
  if (j.pay_status === 'partial') return `<span class="chip amber">Còn ${short(j.outstanding)}</span>`;
  return `<span class="chip mist">Chưa nhận tiền</span>`;
}

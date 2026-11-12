// Nghiệp vụ ghi dữ liệu (chuyển nguyên từ bản Python). Mọi hàm ghi nhận (tx, db, ...) và chạy trong MỘT lần ghi nguyên khối.
import * as fe from './finance.js';
import { nowIso } from './db.js';
import { AppError } from './store.js';

const fmt = n => new Intl.NumberFormat('vi-VN').format(n);

export const DEFAULT_EXPENSE_CATEGORIES = [
  ['Ăn uống', '🍜', '#C9875B'], ['Cà phê, nước uống', '☕', '#A47551'], ['Đi chơi, hẹn hò', '🎈', '#C77D8E'],
  ['Đi lại, xăng xe', '⛽', '#7C8FA6'], ['Mua sắm', '🛍', '#B48BBE'], ['Thiết bị quay, chụp', '🎥', '#5F8370'],
  ['Phần mềm, dịch vụ', '💻', '#6E8FB5'], ['Sinh hoạt', '🏠', '#8EA27A'], ['Gia đình', '👪', '#D19A66'],
  ['Sức khỏe', '💊', '#7FA9A3'], ['Khác', '•', '#9A968E'],
];
export const DEFAULT_INCOME_CATEGORIES = [['Thu nhập khác', '💰', '#7C9A85'], ['Quà tặng', '🎁', '#C77D8E'], ['Hoàn tiền', '↩', '#7C8FA6']];
export const DEFAULT_SETTINGS = { lock_minutes: 10, exclude_one_off: false, display_name: '', hide_amounts: false,
  gcal_enabled: false, gcal_calendar_id: null, gcal_include_fee: false, gcal_last_sync: null,
  gcal_import: false, gcal_read_ids: [], gcal_import_keyword: '', gcal_import_tasks: true, monthly_budget: 0 };

export const notFound = what => new AppError(404, 'not_found', `Không tìm thấy ${what}`);
const owned = (db, table, id, what = 'dữ liệu') => { const r = db.get(table, id); if (!r) throw notFound(what); return r; };
export { owned };

// ---------- khởi tạo lần đầu ----------
export const needsSetup = db => db.live('categories').length === 0 && db.live('accounts').length === 0;

export function initialSetup(tx) {
  DEFAULT_EXPENSE_CATEGORIES.forEach(([name, icon, color], i) =>
    tx.insert('categories', { name, kind: 'expense', icon, color, sort: i, is_system: name === 'Khác' ? 1 : 0 }));
  DEFAULT_INCOME_CATEGORIES.forEach(([name, icon, color], i) =>
    tx.insert('categories', { name, kind: 'income', icon, color, sort: i, is_system: i === 0 ? 1 : 0 }));
  [['Tiền mặt', 'cash'], ['Ngân hàng', 'bank']].forEach(([name, kind], i) => tx.insert('accounts', { name, kind, sort: i, archived: 0 }));
  tx.audit('setup', null, 'create');
}

// ---------- cài đặt ----------
export function getSettings(db) {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of db.live('settings')) { try { s[r.id] = JSON.parse(r.value); } catch (_) { } }
  return s;
}
export function updateSettings(tx, db, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (db.byId.settings.get(k)) tx.update('settings', k, { value: JSON.stringify(v), deleted_at: null });
    else tx.insert('settings', { id: k, value: JSON.stringify(v) });
  }
  return getSettings(db);
}

// ---------- tra cứu ----------
const account = (db, id) => owned(db, 'accounts', id, 'tài khoản');
function category(db, id, kind) {
  if (!id) return null;
  const c = owned(db, 'categories', id, 'danh mục');
  if (kind && c.kind !== kind) throw new AppError(422, 'bad_category', 'Danh mục không đúng loại.', { category_id: 'Sai loại danh mục' });
  return c;
}
export function systemCategory(db, kind) {
  const cs = db.live('categories').filter(c => c.kind === kind).sort((a, b) => (b.is_system || 0) - (a.is_system || 0) || (a.sort || 0) - (b.sort || 0));
  return cs[0]?.id || null;
}

// ---------- giao dịch (lõi) ----------
export function insertTx(tx, kind, date, lines, f = {}) {
  if (!lines.length) throw new AppError(422, 'no_lines', 'Giao dịch không có dòng tiền.');
  if (lines.some(([, a]) => !a)) throw new AppError(422, 'zero_amount', 'Số tiền phải khác 0.', { amount: 'Số tiền phải khác 0' });
  if (kind === 'transfer' && (lines.length !== 2 || lines[0][1] + lines[1][1] !== 0 || lines[0][0] === lines[1][0])) {
    throw new AppError(422, 'bad_transfer', 'Chuyển khoản phải gồm 2 tài khoản khác nhau và tổng bằng 0.');
  }
  if (kind === 'job_payment' || kind === 'job_refund') { if (!f.job_id) throw new AppError(422, 'validation', 'Thiếu show.'); }
  if (f.import_hash && tx.db.live('transactions').some(t => t.import_hash === f.import_hash)) {
    throw new AppError(409, 'duplicate_import', 'Giao dịch này đã được nhập trước đó.');
  }
  const t = tx.insert('transactions', { kind, date, description: f.description ?? null, category_id: f.category_id ?? null,
    job_id: f.job_id ?? null, obligation_id: f.obligation_id ?? null, is_one_off: f.is_one_off ? 1 : 0,
    import_batch_id: f.import_batch_id ?? null, import_hash: f.import_hash ?? null, note: f.note ?? null });
  for (const [aid, amount] of lines) tx.insert('transaction_lines', { transaction_id: t.id, account_id: aid, amount: Math.trunc(amount) });
  return t.id;
}

const displayAmount = (kind, lines) => {
  if (kind === 'transfer') return lines.filter(l => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return kind === 'expense' ? -total : total;
};

export function getTx(db, id) {
  const t = fe.stripPriv(owned(db, 'transactions', id, 'giao dịch'));
  const accs = new Map(db.all('accounts').map(a => [a.id, a]));
  t.lines = fe.txLines(db, id).map(l => ({ account_id: l.account_id, amount: l.amount, account_name: accs.get(l.account_id)?.name }))
    .sort((a, b) => a.amount - b.amount);
  t.amount = displayAmount(t.kind, t.lines);
  return t;
}

export function createTx(tx, db, data, today) {
  const kind = data.kind, d = data.date || today, amount = data.amount;
  const acc = account(db, data.account_id);
  if (acc.archived) throw new AppError(422, 'archived_account', 'Tài khoản đã lưu trữ.');
  const jobId = data.job_id ? owned(db, 'jobs', data.job_id, 'show').id : null;
  const pos = () => { if (amount <= 0) throw new AppError(422, 'bad_amount', 'Số tiền phải lớn hơn 0.', { amount: 'Phải lớn hơn 0' }); };
  let id;
  if (kind === 'expense') {
    pos();
    const c = category(db, data.category_id, 'expense');
    id = insertTx(tx, kind, d, [[acc.id, -amount]], { category_id: c ? c.id : systemCategory(db, 'expense'),
      description: data.description, note: data.note, is_one_off: data.is_one_off, job_id: jobId });
  } else if (kind === 'other_income') {
    pos();
    const c = category(db, data.category_id, 'income');
    id = insertTx(tx, kind, d, [[acc.id, amount]], { category_id: c ? c.id : systemCategory(db, 'income'), description: data.description, note: data.note });
  } else if (kind === 'transfer') {
    pos();
    const to = account(db, data.to_account_id);
    if (to.id === acc.id) throw new AppError(422, 'same_account', 'Tài khoản nguồn và đích phải khác nhau.', { to_account_id: 'Phải khác tài khoản nguồn' });
    id = insertTx(tx, kind, d, [[acc.id, -amount], [to.id, amount]], { description: data.description || `Chuyển ${acc.name} → ${to.name}`, note: data.note });
    if (data.fee > 0) insertTx(tx, 'expense', d, [[acc.id, -data.fee]], { category_id: systemCategory(db, 'expense'), description: 'Phí chuyển khoản', note: `Phí của giao dịch ${id}` });
  } else if (kind === 'adjustment') {
    id = insertTx(tx, kind, d, [[acc.id, amount]], { description: data.description || 'Điều chỉnh số dư', note: data.note });
  } else throw new AppError(422, 'bad_kind', 'Loại giao dịch không hợp lệ.');
  tx.audit('transaction', id, 'create', data);
  return getTx(db, id);
}

export function updateTx(tx, db, id, patch) {
  const t = getTx(db, id);
  const kind = t.kind;
  if (kind === 'job_refund' && (patch.amount != null || patch.account_id)) throw new AppError(409, 'refund_locked', 'Khoản hoàn cọc chỉ sửa được ngày và ghi chú.');
  const amount = kind === 'job_refund' ? -t.amount : patch.amount != null ? patch.amount : t.amount;
  if (kind !== 'adjustment' && amount <= 0) throw new AppError(422, 'bad_amount', 'Số tiền phải lớn hơn 0.', { amount: 'Phải lớn hơn 0' });
  if (kind === 'adjustment' && amount === 0) throw new AppError(422, 'bad_amount', 'Số tiền phải khác 0.', { amount: 'Khác 0' });
  const set = {};
  for (const f of ['date', 'description', 'note']) if (patch[f] != null) set[f] = patch[f];
  if (patch.is_one_off != null) set.is_one_off = patch.is_one_off ? 1 : 0;
  if (patch.category_id) { category(db, patch.category_id, kind === 'other_income' ? 'income' : 'expense'); set.category_id = patch.category_id; }
  let lines;
  if (kind === 'transfer') {
    const src = account(db, patch.account_id || t.lines.find(l => l.amount < 0).account_id).id;
    const dst = account(db, patch.to_account_id || t.lines.find(l => l.amount > 0).account_id).id;
    if (src === dst) throw new AppError(422, 'same_account', 'Tài khoản nguồn và đích phải khác nhau.');
    lines = [[src, -amount], [dst, amount]];
  } else {
    const aid = account(db, patch.account_id || t.lines[0].account_id).id;
    lines = [[aid, kind === 'expense' || kind === 'job_refund' ? -amount : amount]];
  }
  if (kind === 'job_payment' && t.job_id) {
    const job = owned(db, 'jobs', t.job_id, 'show');
    const other = fe.jobReceived(db, job.id) - t.lines.reduce((a, l) => a + l.amount, 0);
    if (job.work_status !== 'cancelled' && other + amount > job.total_fee && !patch.allow_overpay) {
      throw new AppError(409, 'overpay', 'Số tiền vượt quá tổng tiền công của show.');
    }
  }
  for (const l of fe.txLines(db, id)) tx.softDelete('transaction_lines', l.id);
  for (const [aid, a] of lines) tx.insert('transaction_lines', { transaction_id: id, account_id: aid, amount: a });
  tx.update('transactions', id, set);
  tx.audit('transaction', id, 'update', { before: t, patch });
  return getTx(db, id);
}

export function deleteTx(tx, db, id) {
  const t = getTx(db, id);
  tx.softDelete('transactions', id);
  if (t.obligation_id) {
    const o = db.get('obligations', t.obligation_id);
    if (o && o.paid_transaction_id === id) tx.update('obligations', o.id, { paid_transaction_id: null });
  }
  tx.audit('transaction', id, 'delete', t);
}

export function listTx(db, q) {
  const cats = new Map(db.all('categories').map(c => [c.id, c]));
  const jobs = new Map(db.all('jobs').map(j => [j.id, j]));
  const kinds = q.kind ? q.kind.split(',') : null;
  const s = (q.q || '').toLowerCase();
  let items = db.live('transactions').filter(t =>
    (!q.from || t.date >= q.from) && (!q.to || t.date <= q.to) && (!kinds || kinds.includes(t.kind)) &&
    (!q.category_id || t.category_id === q.category_id) && (!q.job_id || t.job_id === q.job_id) &&
    (!q.account_id || fe.txLines(db, t.id).some(l => l.account_id === q.account_id)) &&
    (!s || (t.description || '').toLowerCase().includes(s) || (t.note || '').toLowerCase().includes(s)));
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  const limit = Math.min(Number(q.limit) || 200, 1000), offset = Math.max(Number(q.offset) || 0, 0);
  items = items.slice(offset, offset + limit).map(t => {
    const c = cats.get(t.category_id);
    const full = getTx(db, t.id);
    return { ...full, category_name: c?.name || null, category_icon: c?.icon || null, category_color: c?.color || null,
      job_title: jobs.get(t.job_id)?.title || null };
  });
  return { items, total };
}

export function expenseSummary(db, start, end, group) {
  const key = d => {
    if (group === 'day') return d;
    if (group === 'month') return d.slice(0, 7);
    // %W của SQLite: tuần bắt đầu thứ hai, tuần 00 trước thứ hai đầu tiên
    const y = d.slice(0, 4), jan1 = `${y}-01-01`;
    const yday = fe.diffDays(jan1, d), w = Math.floor((yday + 7 - fe.weekday(d)) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
  };
  const m = new Map();
  for (const t of db.live('transactions')) {
    if (t.kind !== 'expense' || t.date < start || t.date > end) continue;
    const k = key(t.date), cur = m.get(k) || { period: k, total: 0, count: 0 };
    cur.total -= fe.txSum(db, t); cur.count++; m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
}

// ---------- tài khoản ----------
export function createAccount(tx, db, data, today) {
  const sort = Math.max(0, ...db.all('accounts').map(a => a.sort || 0)) + 1;
  const a = tx.insert('accounts', { name: data.name, kind: data.kind, sort, archived: 0 });
  if (data.opening_balance) insertTx(tx, 'adjustment', data.opening_date || today, [[a.id, data.opening_balance]], { description: 'Số dư đầu kỳ' });
  tx.audit('account', a.id, 'create', data);
  return fe.stripPriv(a);
}
export function updateAccount(tx, db, id, patch) {
  account(db, id);
  const set = {};
  for (const f of ['name', 'kind', 'sort']) if (patch[f] != null) set[f] = patch[f];
  if (patch.archived != null) set.archived = patch.archived ? 1 : 0;
  tx.update('accounts', id, set);
  tx.audit('account', id, 'update', patch);
  return fe.stripPriv(db.get('accounts', id));
}
export function deleteAccount(tx, db, id) {
  account(db, id);
  const used = db.live('transactions').some(t => fe.txLines(db, t.id).some(l => l.account_id === id));
  if (used) { tx.update('accounts', id, { archived: 1 }); tx.audit('account', id, 'archive'); return { archived: true }; }
  tx.softDelete('accounts', id); tx.audit('account', id, 'delete');
  return { deleted: true };
}

// ---------- danh mục ----------
export function listCategories(db) {
  const usage = new Map();
  for (const t of db.live('transactions')) if (t.category_id) usage.set(t.category_id, (usage.get(t.category_id) || 0) + 1);
  return db.live('categories').map(c => ({ ...fe.stripPriv(c), is_system: c.is_system || 0, usage: usage.get(c.id) || 0 }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
}
export function createCategory(tx, db, data) {
  if (db.live('categories').some(c => c.kind === data.kind && c.name.toLowerCase() === data.name.toLowerCase())) {
    throw new AppError(409, 'duplicate', 'Danh mục đã tồn tại.', { name: 'Đã tồn tại' });
  }
  const sort = data.sort ?? Math.max(0, ...db.live('categories').filter(c => c.kind === data.kind).map(c => c.sort || 0)) + 1;
  const c = tx.insert('categories', { name: data.name, kind: data.kind, icon: data.icon || null, color: data.color || '#9A968E', sort, is_system: 0 });
  tx.audit('category', c.id, 'create', data);
  return fe.stripPriv(c);
}
export function updateCategory(tx, db, id, patch) {
  category(db, id);
  const set = {};
  for (const f of ['name', 'icon', 'color', 'sort']) if (patch[f] != null) set[f] = patch[f];
  tx.update('categories', id, set);
  return fe.stripPriv(db.get('categories', id));
}
export function deleteCategory(tx, db, id, reassignTo) {
  const cat = category(db, id);
  if (cat.is_system) throw new AppError(409, 'system_category', 'Không thể xóa danh mục mặc định cuối cùng (Khác).');
  const usedTx = db.live('transactions').filter(t => t.category_id === id);
  const target = reassignTo || systemCategory(db, cat.kind);
  if (usedTx.length) {
    const tgt = category(db, target, cat.kind);
    if (tgt.id === id) throw new AppError(422, 'bad_reassign', 'Chọn danh mục khác để chuyển giao dịch sang.');
    for (const t of usedTx) tx.update('transactions', t.id, { category_id: tgt.id });
    for (const o of db.live('obligations').filter(o => o.category_id === id)) tx.update('obligations', o.id, { category_id: tgt.id });
  }
  tx.softDelete('categories', id);
  tx.audit('category', id, 'delete', { moved: usedTx.length, to: target });
  return { deleted: true, moved: usedTx.length };
}

// ---------- khách hàng ----------
export function resolveClient(tx, db, clientId, clientName) {
  if (clientId) return owned(db, 'clients', clientId, 'khách hàng').id;
  if (clientName) {
    const found = db.live('clients').find(c => c.name.toLowerCase() === clientName.toLowerCase());
    if (found) return found.id;
    return tx.insert('clients', { name: clientName }).id;
  }
  return null;
}
export function saveClient(tx, db, data, id = null) {
  if (id) { owned(db, 'clients', id, 'khách hàng'); tx.update('clients', id, { name: data.name, phone: data.phone ?? null, note: data.note ?? null }); }
  else id = tx.insert('clients', { name: data.name, phone: data.phone ?? null, note: data.note ?? null }).id;
  tx.audit('client', id, 'save', data);
  return fe.stripPriv(db.get('clients', id));
}
/** Khách gần đây kèm thông tin show gần nhất, để điền sẵn khi tạo show mới. */
export function recentClients(db, limit = 12) {
  const jobs = db.live('jobs').slice().sort((a, b) => (b.work_date || '').localeCompare(a.work_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
  const sessions = new Map();
  for (const s of db.live('job_sessions')) if (!sessions.has(s.job_id) || s.date < sessions.get(s.job_id).date) sessions.set(s.job_id, s);
  const out = new Map();
  for (const j of jobs) {
    if (!j.client_id) continue;
    const c = db.get('clients', j.client_id);
    if (!c) continue;
    const cur = out.get(c.id);
    if (cur) { cur.job_count++; continue; }
    const s = sessions.get(j.id) || {};
    out.set(c.id, { id: c.id, name: c.name, phone: c.phone || null, job_count: 1, last_date: j.work_date,
      last: { title: j.title, work_type: j.work_type, total_fee: j.total_fee, location: j.location || s.location || null,
        start_time: s.start_time || null, end_time: s.end_time || null } });
  }
  return [...out.values()].slice(0, limit);
}

export function deleteClient(tx, db, id) { owned(db, 'clients', id, 'khách hàng'); tx.softDelete('clients', id); }

// ---------- show ----------
export const DEFAULT_SESSION_KIND = { video: 'shoot', video_edit: 'shoot', photo: 'photo', edit: 'edit', other: 'other' };

function saveSessions(tx, db, jobId, sessions) {
  const keep = new Set();
  for (const s of sessions) {
    if (s.start_time && s.end_time && s.end_time <= s.start_time) {
      throw new AppError(422, 'bad_time', 'Giờ kết thúc phải sau giờ bắt đầu.', { sessions: 'Giờ không hợp lệ' });
    }
    const vals = { kind: s.kind, date: s.date, start_time: s.start_time ?? null, end_time: s.end_time ?? null,
      location: s.location ?? null, note: s.note ?? null };
    const existing = s.id ? db.byId.job_sessions.get(s.id) : null;
    if (existing && existing.job_id === jobId) { tx.update('job_sessions', s.id, { ...vals, deleted_at: null }); keep.add(s.id); }
    else keep.add(tx.insert('job_sessions', { job_id: jobId, ...vals }).id);
  }
  for (const s of db.live('job_sessions')) if (s.job_id === jobId && !keep.has(s.id)) tx.softDelete('job_sessions', s.id);
}

export function sessionConflicts(db, { ids = null, start = null, end = null } = {}) {
  const jobs = new Map(db.live('jobs').map(j => [j.id, j]));
  const ss = db.live('job_sessions').filter(s => {
    const j = jobs.get(s.job_id);
    return j && j.work_status !== 'cancelled' && s.kind !== 'deadline' && s.start_time && s.end_time;
  });
  const idset = ids ? new Set(ids) : null;
  const out = [], seen = new Set();
  for (const a of ss) {
    if (idset && !idset.has(a.id)) continue;
    if ((start && a.date < start) || (end && a.date > end)) continue;
    for (const b of ss) {
      if (a.id === b.id || a.date !== b.date) continue;
      if (!(a.start_time < b.end_time && b.start_time < a.end_time)) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a_id: a.id, b_id: b.id, date: a.date, a_start: a.start_time, a_end: a.end_time, b_start: b.start_time, b_end: b.end_time,
        a_title: jobs.get(a.job_id).title, b_title: jobs.get(b.job_id).title, a_job: a.job_id, b_job: b.job_id });
    }
  }
  return out;
}

export function getJob(db, id, today) {
  const j = fe.jobsWithMoney(db, today, x => x.id === id)[0];
  if (!j) throw notFound('show');
  j.sessions = db.live('job_sessions').filter(s => s.job_id === id).map(fe.stripPriv)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
  const accs = new Map(db.all('accounts').map(a => [a.id, a]));
  j.payments = db.live('transactions').filter(t => t.job_id === id && (t.kind === 'job_payment' || t.kind === 'job_refund'))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || '').localeCompare(b.created_at || ''))
    .flatMap(t => fe.txLines(db, t.id).map(l => ({ id: t.id, kind: t.kind, date: t.date, note: t.note, created_at: t.created_at,
      amount: l.amount, account_name: accs.get(l.account_id)?.name, account_id: l.account_id })));
  j.conflicts = sessionConflicts(db, { ids: j.sessions.map(s => s.id) });
  return j;
}

export function createJob(tx, db, data, today) {
  const clientId = resolveClient(tx, db, data.client_id, data.client_name);
  if ((data.deposit || 0) > data.total_fee) throw new AppError(422, 'deposit_too_big', 'Tiền cọc không được lớn hơn tổng tiền công.', { deposit: 'Lớn hơn tổng công' });
  const j = tx.insert('jobs', { title: data.title, client_id: clientId, work_type: data.work_type, work_date: data.work_date,
    total_fee: data.total_fee, due_date: data.due_date ?? null, work_status: data.work_status || 'booked', location: data.location ?? null,
    description: data.description ?? null, note: data.note ?? null });
  const sessions = data.sessions?.length ? data.sessions : [{ kind: DEFAULT_SESSION_KIND[data.work_type], date: data.work_date,
    start_time: data.start_time, end_time: data.end_time, location: data.location }];
  // Quay + dựng mà chỉ nhập một ngày: thêm ngày dựng là hôm sau (sửa lại được)
  if (data.work_type === 'video_edit' && !sessions.some(s => s.kind === 'edit')) sessions.push({ kind: 'edit', date: fe.addDays(data.work_date, 1) });
  saveSessions(tx, db, j.id, sessions);
  if (data.deposit > 0) {
    const acc = account(db, data.deposit_account_id);
    insertTx(tx, 'job_payment', data.deposit_date || today, [[acc.id, data.deposit]], { job_id: j.id, description: `Cọc: ${data.title}`, note: 'Tiền cọc' });
  }
  tx.audit('job', j.id, 'create', data);
  return getJob(db, j.id, today);
}

export function updateJob(tx, db, id, patch, today) {
  const job = owned(db, 'jobs', id, 'show');
  if (job.work_status === 'cancelled' && (patch.total_fee != null || patch.work_status != null)) {
    throw new AppError(409, 'cancelled', 'Show đã hủy, không thể đổi tiền công hoặc trạng thái.');
  }
  const set = {};
  for (const f of ['title', 'work_type', 'work_date', 'total_fee', 'work_status']) if (patch[f] != null) set[f] = patch[f];
  for (const f of ['due_date', 'location', 'description', 'note']) if (f in patch) set[f] = patch[f];
  if ('client_id' in patch || 'client_name' in patch) set.client_id = resolveClient(tx, db, patch.client_id, patch.client_name);
  if (job.draft) set.draft = 0;  // show nháp từ Google Calendar: lưu form = đã xác nhận
  tx.update('jobs', id, set);
  if (patch.sessions) saveSessions(tx, db, id, patch.sessions);
  tx.audit('job', id, 'update', patch);
  return getJob(db, id, today);
}

export function deleteJob(tx, db, id) {
  owned(db, 'jobs', id, 'show');
  if (db.live('transactions').some(t => t.job_id === id && (t.kind === 'job_payment' || t.kind === 'job_refund'))) {
    throw new AppError(409, 'has_payments', "Show đã có tiền nhận. Hãy dùng 'Hủy show' để xử lý tiền cọc, hoặc xóa các khoản thanh toán trước.");
  }
  tx.softDelete('jobs', id);
  for (const s of db.live('job_sessions').filter(s => s.job_id === id)) tx.softDelete('job_sessions', s.id);
  tx.audit('job', id, 'delete');
}

export function addPayment(tx, db, id, data, today) {
  const job = owned(db, 'jobs', id, 'show');
  if (job.work_status === 'cancelled') throw new AppError(409, 'cancelled', 'Show đã hủy, không thể nhận thêm tiền.');
  const acc = account(db, data.account_id);
  const received = fe.jobReceived(db, id);
  if (received + data.amount > job.total_fee && !data.allow_overpay) {
    throw new AppError(409, 'overpay', `Số tiền vượt công nợ còn lại (${fmt(Math.max(0, job.total_fee - received))}đ).`, { amount: 'Vượt công nợ còn lại' });
  }
  const tid = insertTx(tx, 'job_payment', data.date || today, [[acc.id, data.amount]], { job_id: id, description: `Thanh toán: ${job.title}`, note: data.note });
  tx.audit('job_payment', tid, 'create', data);
  return getJob(db, id, today);
}

export function cancelJob(tx, db, id, data, today) {
  const job = owned(db, 'jobs', id, 'show');
  if (job.work_status === 'cancelled') throw new AppError(409, 'cancelled', 'Show đã được hủy trước đó.');
  const received = fe.jobReceived(db, id);
  if (data.policy === 'refund' && received > 0) {
    const acc = account(db, data.account_id);
    insertTx(tx, 'job_refund', data.date || today, [[acc.id, -received]], { job_id: id, description: `Hoàn cọc: ${job.title}`, note: data.note });
  }
  tx.update('jobs', id, { work_status: 'cancelled', cancel_policy: data.policy });
  tx.audit('job', id, 'cancel', { policy: data.policy, received });
  return getJob(db, id, today);
}

// ---------- lịch ----------
export function calendarRange(db, start, end, today) {
  const jobs = new Map(fe.jobsWithMoney(db, today).map(j => [j.id, j]));
  const sessions = db.live('job_sessions').filter(s => s.date >= start && s.date <= end && jobs.has(s.job_id))
    .map(s => { const j = jobs.get(s.job_id); return { ...fe.stripPriv(s), title: j.title, work_type: j.work_type, work_status: j.work_status, draft: j.draft || 0,
      total_fee: j.total_fee, client_name: j.client_name, pay_status: j.pay_status, outstanding: j.outstanding }; })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '99').localeCompare(b.start_time || '99'));
  const day_offs = db.live('day_offs').filter(d => d.date >= start && d.date <= end).map(fe.stripPriv).sort((a, b) => a.date.localeCompare(b.date));
  return { sessions, day_offs, conflicts: sessionConflicts(db, { start, end }) };
}

const minutes = (a, b) => {
  if (!a || !b) return 0;
  const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number);
  return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
};

export function workStats(db, start, end, today) {
  const live = new Map(db.live('jobs').map(j => [j.id, j]));
  const ss = db.live('job_sessions').filter(s => { const j = live.get(s.job_id); return j && j.work_status !== 'cancelled' && s.kind !== 'deadline' && s.date >= start && s.date <= end; });
  const jobs = fe.jobsWithMoney(db, today, j => j.work_date >= start && j.work_date <= end && j.work_status !== 'cancelled');
  const upcoming = fe.jobsWithMoney(db, today, j => j.work_status === 'booked' || j.work_status === 'in_progress');
  return { work_days: new Set(ss.map(s => s.date)).size, hours: Math.round(ss.reduce((a, s) => a + minutes(s.start_time, s.end_time), 0) / 6) / 10,
    sessions: ss.length, fee_total: jobs.reduce((a, j) => a + j.total_fee, 0), jobs: jobs.length,
    expected_from_booked: upcoming.reduce((a, j) => a + j.outstanding, 0), booked_jobs: upcoming.length };
}

export const saveDayOff = (tx, db, data) => fe.stripPriv(tx.insert('day_offs', { date: data.date, note: data.note ?? null }));
export function deleteDayOff(tx, db, id) { owned(db, 'day_offs', id, 'ngày nghỉ'); tx.softDelete('day_offs', id); }

// ---------- tiết kiệm ----------
export function createGoal(tx, db, data, today) {
  const g = tx.insert('goals', { name: data.name, target_amount: data.target_amount, target_date: data.target_date ?? null,
    monthly_plan: data.monthly_plan ?? null, is_emergency: data.is_emergency ? 1 : 0, archived: 0, note: data.note ?? null });
  if (data.initial_amount) tx.insert('goal_allocations', { goal_id: g.id, date: today, amount: data.initial_amount, note: 'Số đã có ban đầu' });
  tx.audit('goal', g.id, 'create', data);
  return g.id;
}
export function updateGoal(tx, db, id, patch) {
  owned(db, 'goals', id, 'mục tiêu');
  const set = {};
  for (const f of ['name', 'target_amount', 'target_date', 'monthly_plan', 'note']) if (patch[f] != null) set[f] = patch[f];
  for (const f of ['is_emergency', 'archived']) if (patch[f] != null) set[f] = patch[f] ? 1 : 0;
  tx.update('goals', id, set);
  tx.audit('goal', id, 'update', patch);
}
export function deleteGoal(tx, db, id) {
  owned(db, 'goals', id, 'mục tiêu');
  for (const a of db.live('goal_allocations').filter(a => a.goal_id === id)) tx.softDelete('goal_allocations', a.id);
  tx.softDelete('goals', id);
  tx.audit('goal', id, 'delete');
}
const goalSaved = (db, id) => db.live('goal_allocations').filter(a => a.goal_id === id).reduce((s, a) => s + a.amount, 0);

export function allocate(tx, db, id, data, today) {
  const amount = data.amount;
  if (!amount) throw new AppError(422, 'zero_amount', 'Số tiền phải khác 0.', { amount: 'Khác 0' });
  owned(db, 'goals', id, 'mục tiêu');
  const saved = goalSaved(db, id);
  if (amount < 0 && saved + amount < 0) throw new AppError(422, 'insufficient', 'Không thể rút nhiều hơn số đã dành cho mục tiêu.', { amount: 'Vượt số đã dành' });
  if (amount > 0) {
    const pos = fe.cashPosition(db, today);
    if (amount > pos.available) {
      throw new AppError(409, 'not_enough_available', `Tiền khả dụng chỉ còn ${fmt(Math.max(0, pos.available))}đ, không đủ để dành thêm.`, { amount: 'Vượt tiền khả dụng' });
    }
  }
  const a = tx.insert('goal_allocations', { goal_id: id, date: data.date || today, amount, note: data.note ?? null });
  tx.audit('goal_allocation', a.id, 'create', data);
  return { id: a.id };
}
export function deleteAllocation(tx, db, id) {
  const a = owned(db, 'goal_allocations', id, 'lần phân bổ');
  if (a.amount > 0 && goalSaved(db, a.goal_id) - a.amount < 0) {
    throw new AppError(409, 'would_go_negative', 'Xóa lần dành tiền này sẽ làm mục tiêu âm. Hãy xóa lần rút tiền trước.');
  }
  tx.softDelete('goal_allocations', id);
}
export function goalsOverview(db, today) {
  const cap = fe.monthlyCapacity(db, today);
  let needTotal = 0;
  const goals = fe.goalBalances(db).map(g => {
    const plan = fe.goalPlan(g, today, cap);
    const allocations = db.live('goal_allocations').filter(a => a.goal_id === g.id).map(fe.stripPriv)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 50);
    if (!g.archived && plan.remaining > 0) needTotal += plan.required_monthly || g.monthly_plan || 0;
    return { ...g, plan, allocations };
  });
  return { goals, monthly_capacity: cap, monthly_need_total: needTotal,
    overall_feasibility: needTotal && cap !== null ? fe.feasibility(needTotal, cap) : null };
}

// ---------- khoản phải trả ----------
// Ba loại: bill = chi cố định lặp lại (wifi, CapCut…); debt = trả sau / trả góp nhiều kỳ (SPayLater…); once = trả một lần.
function normObligation(data, cur = {}) {
  const kind = data.kind || cur.kind || 'bill';
  const out = { ...data, kind };
  if (kind === 'debt') {
    const total = data.installments ?? cur.installments ?? 1;
    const no = data.installment_no ?? cur.installment_no ?? 1;
    if (no > total) throw new AppError(422, 'bad_installment', 'Kỳ hiện tại không được lớn hơn tổng số kỳ.', { installment_no: 'Lớn hơn tổng số kỳ' });
    Object.assign(out, { installments: total, installment_no: no, recurrence: total > 1 ? 'monthly' : 'none' });
  } else {
    Object.assign(out, { installments: null, installment_no: null });
    if (kind === 'once') out.recurrence = 'none';
  }
  return out;
}
export function saveObligation(tx, db, data, id = null) {
  if (data.category_id) category(db, data.category_id, 'expense');
  if (id) {
    const cur = owned(db, 'obligations', id, 'khoản phải trả');
    const d = normObligation(data, cur);
    const set = {};
    for (const f of ['name', 'amount', 'due_date', 'recurrence', 'category_id', 'note', 'kind', 'provider']) if (d[f] != null) set[f] = d[f];
    set.installments = d.installments; set.installment_no = d.installment_no;
    tx.update('obligations', id, set);
  } else {
    const d = normObligation(data);
    id = tx.insert('obligations', { name: d.name, amount: d.amount, due_date: d.due_date, recurrence: d.recurrence || 'none',
      category_id: d.category_id ?? null, note: d.note ?? null, kind: d.kind, provider: d.provider ?? null,
      installments: d.installments, installment_no: d.installment_no }).id;
  }
  tx.audit('obligation', id, 'save', data);
  return fe.stripPriv(db.get('obligations', id));
}
export function deleteObligation(tx, db, id) { owned(db, 'obligations', id, 'khoản phải trả'); tx.softDelete('obligations', id); }
export function payObligation(tx, db, id, data, today) {
  const o = owned(db, 'obligations', id, 'khoản phải trả');
  if (o.paid_transaction_id) throw new AppError(409, 'already_paid', 'Khoản này đã được trả.');
  const acc = account(db, data.account_id);
  const tid = insertTx(tx, 'expense', data.date || today, [[acc.id, -(data.amount || o.amount)]],
    { category_id: o.category_id || systemCategory(db, 'expense'), description: o.name, obligation_id: id });
  tx.update('obligations', id, { paid_transaction_id: tid });
  let nextId = null;
  const more = o.kind === 'debt' ? (o.installment_no || 1) < (o.installments || 1) : o.recurrence === 'monthly' || o.recurrence === 'yearly';
  if (more) {
    nextId = tx.insert('obligations', { name: o.name, amount: o.amount, due_date: fe.addMonths(o.due_date, o.recurrence === 'yearly' ? 12 : 1),
      recurrence: o.recurrence, category_id: o.category_id, note: o.note, kind: o.kind, provider: o.provider,
      installments: o.installments, installment_no: o.kind === 'debt' ? (o.installment_no || 1) + 1 : null }).id;
  }
  tx.audit('obligation', id, 'pay', { tx: tid, next: nextId });
  return { transaction_id: tid, next_id: nextId };
}
/** Tổng hợp: chi cố định mỗi tháng, nợ trả góp còn lại theo nơi cho vay, khoản sắp/đã quá hạn. */
export function obligationSummary(db, today) {
  const unpaid = db.live('obligations').filter(o => !o.paid_transaction_id);
  const kind = o => o.kind || (o.recurrence === 'monthly' ? 'bill' : 'once');
  const bills = unpaid.filter(o => kind(o) === 'bill' && (o.recurrence === 'monthly' || o.recurrence === 'yearly'));
  const fixed_monthly = bills.reduce((a, o) => a + (o.recurrence === 'yearly' ? Math.round(o.amount / 12) : o.amount), 0);
  const debts = new Map();
  for (const o of unpaid.filter(o => kind(o) === 'debt')) {
    const left = (o.installments || 1) - (o.installment_no || 1) + 1;
    const key = o.provider || o.name;
    const d = debts.get(key) || { provider: key, remaining: 0, periods_left: 0, next_due: null, next_amount: 0 };
    d.remaining += o.amount * left; d.periods_left += left;
    if (!d.next_due || o.due_date < d.next_due) { d.next_due = o.due_date; d.next_amount = o.amount; }
    debts.set(key, d);
  }
  const soon = fe.addDays(today, 3);
  const due_soon = unpaid.filter(o => o.due_date <= soon).sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map(o => ({ id: o.id, name: o.name, amount: o.amount, due_date: o.due_date, overdue: o.due_date < today, kind: kind(o),
      installment_no: o.installment_no, installments: o.installments }));
  const debtList = [...debts.values()].sort((a, b) => a.next_due.localeCompare(b.next_due));
  return { fixed_monthly, bill_count: bills.length, debts: debtList, debt_remaining: debtList.reduce((a, d) => a + d.remaining, 0), due_soon };
}

export function listObligations(db, includePaid) {
  const cats = new Map(db.all('categories').map(c => [c.id, c]));
  return db.live('obligations').filter(o => includePaid || !o.paid_transaction_id)
    .map(o => ({ ...fe.stripPriv(o), category_name: cats.get(o.category_id)?.name || null, category_icon: cats.get(o.category_id)?.icon || null }))
    .sort((a, b) => (a.paid_transaction_id ? 1 : 0) - (b.paid_transaction_id ? 1 : 0) || a.due_date.localeCompare(b.due_date));
}

export { nowIso };

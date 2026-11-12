// Nhập giao dịch từ CSV: xem trước → ghép cột → kiểm tra lỗi & trùng → xác nhận. Hoàn tác theo lô.
import * as fe from './finance.js';
import { AppError } from './store.js';
import * as sv from './services.js';

export const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20000;
const pending = new Map();  // token → { filename, rows, at } (chỉ trong bộ nhớ phiên)
const TTL = 30 * 60 * 1000;

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sample = text.slice(0, 4096);
  const counts = [',', ';', '\t', '|'].map(d => [d, (sample.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] ? counts[0][0] : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(c => c)) rows.push(row);
      row = [];
      if (rows.length >= MAX_ROWS) break;
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(c => c) && rows.length < MAX_ROWS) rows.push(row);
  return rows;
}

export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  if (file.size > MAX_BYTES) throw new AppError(413, 'too_large', 'File quá lớn (tối đa 5 MB).');
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    throw new AppError(415, 'bad_type', 'File Excel: hãy mở bằng Excel hoặc Google Sheets rồi chọn Tải xuống / Lưu dạng .csv, sau đó nhập file .csv.');
  }
  if (!(name.endsWith('.csv') || name.endsWith('.txt') || !name)) throw new AppError(415, 'bad_type', 'Chỉ hỗ trợ file .csv.');
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) { text = new TextDecoder('windows-1258').decode(buf); }
  return parseCsv(text);
}

export function storePending(filename, rows) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > TTL) pending.delete(k);
  const token = crypto.randomUUID();
  pending.set(token, { filename, rows, at: now });
  return token;
}

function getPending(token) {
  const p = pending.get(token);
  if (!p) throw new AppError(410, 'expired', 'Phiên nhập file đã hết hạn, hãy tải file lên lại.');
  return p;
}

const strip = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
export function guessMapping(header) {
  const keys = {
    date: ['ngay', 'date', 'thoi gian', 'ngay gd', 'ngay giao dich'], amount: ['so tien', 'amount', 'tien', 'gia tri'],
    debit: ['ghi no', 'debit', 'tien ra', 'chi', 'rut'], credit: ['ghi co', 'credit', 'tien vao', 'thu', 'nap'],
    description: ['noi dung', 'mo ta', 'dien giai', 'description', 'chi tiet', 'ten'], category: ['danh muc', 'category', 'loai', 'nhom'],
    note: ['ghi chu', 'note'],
  };
  const hn = header.map(h => strip(String(h)));
  const out = {}, used = new Set();
  for (const [f, cands] of Object.entries(keys)) {
    out[f] = null;
    for (let i = 0; i < hn.length; i++) {
      if (!used.has(i) && cands.some(c => hn[i] === c || hn[i].startsWith(c))) { out[f] = i; used.add(i); break; }
    }
  }
  return out;
}

export function parseAmount(s) {
  if (s === null || s === undefined) return null;
  s = String(s).trim();
  if (!s) return null;
  const neg = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[^\d,.\-]/g, '').replace(/^-+|-+$/g, '');
  if (!s) return null;
  let v;
  if (/^\d+[.,]\d{1,2}$/.test(s)) v = Math.round(parseFloat(s.replace(',', '.')));
  else v = parseInt(s.replace(/[.,]/g, '') || '0', 10);
  return neg ? -v : v;
}

export function parseDate(s, fmt) {
  s = String(s || '').trim().split(' ')[0].split('T')[0];
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/), y, mo, d;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let a = +m[1], b = +m[2]; y = +m[3]; if (y < 100) y += 2000;
    if (fmt === 'mdy') [a, b] = [b, a];
    d = a; mo = b;
  } else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return fe.isValidDate(iso) ? iso : null;
}

const normDesc = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function analyze(db, req) {
  const p = getPending(req.token);
  sv.owned(db, 'accounts', req.account_id, 'tài khoản');
  const rows = req.skip_header !== false ? p.rows.slice(1) : p.rows;
  const mp = req.mapping, mode = req.amount_mode || 'expense_positive';
  const cats = new Map(sv.listCategories(db).map(c => [c.name.toLowerCase(), c]));
  const cell = (r, f) => { const i = mp[f]; return i !== null && i !== undefined && i >= 0 && i < r.length ? r[i] : ''; };
  const existing = new Set(db.live('transactions').map(t => t.import_hash).filter(Boolean));
  const manual = new Set();
  for (const t of db.live('transactions')) {
    if (t.import_hash) continue;
    for (const l of fe.txLines(db, t.id)) manual.add(`${t.date}|${l.account_id}|${l.amount}`);
  }
  const occ = new Map(), out = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx], errors = [];
    const d = parseDate(cell(r, 'date'), req.date_format || 'auto');
    if (!d) errors.push('Ngày không hợp lệ');
    let signed;
    if (mode === 'debit_credit') signed = Math.abs(parseAmount(cell(r, 'credit')) || 0) - Math.abs(parseAmount(cell(r, 'debit')) || 0);
    else {
      const a = parseAmount(cell(r, 'amount'));
      signed = a === null ? null : mode === 'expense_positive' ? (a > 0 ? -Math.abs(a) : Math.abs(a)) : a;
    }
    if (!signed) errors.push('Số tiền trống hoặc bằng 0');
    else if (Math.abs(signed) > 100_000_000_000) errors.push('Số tiền quá lớn');
    const desc = String(cell(r, 'description')).slice(0, 300);
    const kind = (signed || 0) < 0 ? 'expense' : 'other_income';
    let cat = cats.get(String(cell(r, 'category')).trim().toLowerCase());
    if (cat && cat.kind !== (kind === 'expense' ? 'expense' : 'income')) cat = null;
    let status = errors.length ? 'error' : 'ok', hash = null;
    if (!errors.length) {
      const base = `${d}|${signed}|${normDesc(desc)}|${req.account_id}`;
      occ.set(base, (occ.get(base) || 0) + 1);
      hash = await sha256(`${base}|${occ.get(base)}`);
      if (existing.has(hash)) status = 'duplicate';
      else if (manual.has(`${d}|${req.account_id}|${signed}`)) status = 'suspect';
    }
    out.push({ index: idx, date: d, amount: signed, kind, description: desc, category_id: cat?.id || null, category_name: cat?.name || null,
      note: String(cell(r, 'note')).slice(0, 500), status, errors, hash, raw: r.slice(0, 12) });
  }
  const counts = Object.fromEntries(['ok', 'error', 'duplicate', 'suspect'].map(s => [s, out.filter(x => x.status === s).length]));
  return { rows: out, counts, filename: p.filename };
}

export async function commit(session, req) {
  // phân tích (bất đồng bộ, có băm) rồi ghi nguyên khối trên dữ liệu mới nhất
  const db0 = await session.refresh();
  const res = await analyze(db0, req);
  const include = new Set(req.include_duplicates || []);
  const result = await session.mutate((tx, db) => {
    const fresh = new Set(db.live('transactions').map(t => t.import_hash).filter(Boolean));
    const rows = res.rows.filter(r => (r.status === 'ok' || (r.status === 'suspect' && include.has(r.index))) && !fresh.has(r.hash));
    const b = tx.insert('import_batches', { filename: res.filename, row_count: res.rows.length, imported_count: rows.length,
      skipped_count: res.rows.length - rows.length, status: 'committed' });
    const expD = sv.systemCategory(db, 'expense'), incD = sv.systemCategory(db, 'income');
    for (const r of rows) {
      sv.insertTx(tx, r.kind, r.date, [[req.account_id, r.amount]], { description: r.description || null, note: r.note || null,
        category_id: r.category_id || (r.kind === 'expense' ? expD : incD), import_batch_id: b.id, import_hash: r.hash });
    }
    tx.audit('import_batch', b.id, 'commit', { imported: rows.length, file: res.filename });
    return { batch_id: b.id, imported: rows.length, skipped: res.rows.length - rows.length, counts: res.counts };
  });
  pending.delete(req.token);
  return result;
}

export function undo(tx, db, id) {
  const b = db.get('import_batches', id);
  if (!b) throw new AppError(404, 'not_found', 'Không tìm thấy lô nhập.');
  if (b.status === 'undone') throw new AppError(409, 'already_undone', 'Lô này đã được hoàn tác.');
  const txs = db.live('transactions').filter(t => t.import_batch_id === id);
  for (const t of txs) tx.softDelete('transactions', t.id);
  tx.update('import_batches', id, { status: 'undone' });
  tx.audit('import_batch', id, 'undo', { removed: txs.length });
  return { removed: txs.length };
}

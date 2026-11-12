// Kho lưu trữ: Google Sheet (thật) và bộ nhớ (kiểm thử / dùng thử). Cùng một giao diện:
//   load()          → { table: [obj...] }
//   commit(ops)     → ghi nguyên khối
//   replaceAll(data)→ thay toàn bộ dữ liệu (khôi phục)
import { DB, SCHEMA, TABLES, Tx, rowToValues } from './db.js';

export class AppError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}

// ======================= bộ nhớ (giả lập Sheet: mảng 2 chiều, dòng 1 là tiêu đề) =======================
export class MemoryStore {
  constructor() {
    this.sheets = {};
    for (const t of TABLES) this.sheets[t] = [SCHEMA[t].slice()];
    this.commits = 0;
  }
  async load() {
    const out = {};
    for (const t of TABLES) {
      const [header, ...rows] = this.sheets[t];
      out[t] = rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
    }
    return out;
  }
  async commit(ops) {
    // kiểm tra trước, áp sau: giống tính nguyên khối của Sheets batchUpdate
    const staged = structuredClone(this.sheets);
    for (const op of ops) {
      const sheet = staged[op.table];
      const values = rowToValues(op.table, op.row, sheet[0]);
      if (op.type === 'append') sheet.push(values);
      else {
        if (op.row._row < 2 || op.row._row > sheet.length) throw new AppError(409, 'conflict', 'Dòng cần sửa không tồn tại trên Sheet.');
        sheet[op.row._row - 1] = values;
      }
    }
    this.sheets = staged;
    this.commits++;
  }
  async replaceAll(data) {
    for (const t of TABLES) {
      const header = SCHEMA[t].slice();
      this.sheets[t] = [header, ...(data[t] || []).map(r => header.map(h => r[h] ?? null))];
    }
  }
  info() { return { kind: 'memory' }; }
}

// ======================= Google Sheets =======================
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const FILE_TITLE = 'Tài chính & Lịch Freelance (dữ liệu)';
const APP_PROP = 'finance_app_data';
const BACKUP_PROP = 'finance_app_backup';

export class SheetsStore {
  /** getToken(): trả access token hiện tại (hoặc ném lỗi 401 để yêu cầu đăng nhập lại). */
  constructor(getToken, fetchImpl = (...a) => fetch(...a)) {
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.id = null;
    this.sheetIds = {};
    this.headers = {};
  }

  async req(url, { method = 'GET', body } = {}) {
    const token = await this.getToken();
    let res;
    try {
      res = await this.fetch(url, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new AppError(0, 'offline', 'Không kết nối được tới Google. Kiểm tra mạng rồi thử lại.');
    }
    if (res.status === 401) throw new AppError(401, 'google_auth', 'Phiên đăng nhập Google đã hết hạn.');
    if (res.status === 429) throw new AppError(429, 'rate_limited', 'Google đang giới hạn tốc độ, đợi khoảng 1 phút rồi thử lại.');
    if (!res.ok) {
      let msg = `Google báo lỗi ${res.status}`;
      try { const j = await res.json(); if (j.error?.message) msg += `: ${j.error.message}`; } catch (_) { }
      throw new AppError(res.status, 'google_error', msg);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Tìm file dữ liệu của app (chỉ thấy file do chính app tạo) hoặc tạo mới. */
  async open() {
    const q = encodeURIComponent(`appProperties has { key='${APP_PROP}' and value='1' } and trashed=false`);
    const found = await this.req(`${DRIVE}?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime&spaces=drive`);
    if (found.files?.length) this.id = found.files[0].id;
    else {
      const created = await this.req(SHEETS, { method: 'POST', body: {
        properties: { title: FILE_TITLE, timeZone: 'Asia/Ho_Chi_Minh' },
        sheets: TABLES.map(t => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } })),
      } });
      this.id = created.spreadsheetId;
      await this.req(`${DRIVE}/${this.id}?fields=id`, { method: 'PATCH', body: { appProperties: { [APP_PROP]: '1' } } });
    }
    await this.ensureSchema();
    return this.id;
  }

  async meta() {
    const m = await this.req(`${SHEETS}/${this.id}?fields=sheets(properties(sheetId,title))`);
    this.sheetIds = Object.fromEntries(m.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  }

  /** Tạo tab còn thiếu, bổ sung cột mới vào tiêu đề (nâng cấp cấu trúc mà không mất dữ liệu). */
  async ensureSchema() {
    await this.meta();
    const missing = TABLES.filter(t => !(t in this.sheetIds));
    if (missing.length) {
      await this.req(`${SHEETS}/${this.id}:batchUpdate`, { method: 'POST', body: {
        requests: missing.map(t => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })) } });
      await this.meta();
    }
    const ranges = TABLES.map(t => `ranges=${encodeURIComponent(`${t}!1:1`)}`).join('&');
    const res = await this.req(`${SHEETS}/${this.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
    const requests = [];
    res.valueRanges.forEach((vr, i) => {
      const t = TABLES[i];
      const header = (vr.values?.[0] || []).map(String);
      const add = SCHEMA[t].filter(c => !header.includes(c));
      if (add.length) {
        requests.push({ updateCells: {
          range: { sheetId: this.sheetIds[t], startRowIndex: 0, endRowIndex: 1, startColumnIndex: header.length, endColumnIndex: header.length + add.length },
          rows: [{ values: add.map(c => ({ userEnteredValue: { stringValue: c } })) }], fields: 'userEnteredValue' } });
      }
      this.headers[t] = [...header, ...add];
    });
    if (requests.length) await this.req(`${SHEETS}/${this.id}:batchUpdate`, { method: 'POST', body: { requests } });
  }

  async load() {
    const ranges = TABLES.map(t => `ranges=${encodeURIComponent(t)}`).join('&');
    const res = await this.req(`${SHEETS}/${this.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
    const out = {};
    res.valueRanges.forEach((vr, i) => {
      const t = TABLES[i];
      const [header = [], ...rows] = vr.values || [];
      this.headers[t] = header.map(String);
      out[t] = rows.map(r => Object.fromEntries(this.headers[t].map((h, j) => [h, r[j] ?? null])));
    });
    return out;
  }

  static cell(v) {
    if (v === null || v === undefined) return {};
    if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
    return { userEnteredValue: { stringValue: String(v) } };  // chuỗi bắt đầu bằng "=" vẫn chỉ là chữ, không thành công thức
  }

  async commit(ops) {
    if (!ops.length) return;
    const requests = ops.map(op => {
      const header = this.headers[op.table];
      const values = rowToValues(op.table, op.row, header).map(SheetsStore.cell);
      if (op.type === 'append') {
        return { appendCells: { sheetId: this.sheetIds[op.table], rows: [{ values }], fields: 'userEnteredValue' } };
      }
      return { updateCells: {
        range: { sheetId: this.sheetIds[op.table], startRowIndex: op.row._row - 1, endRowIndex: op.row._row,
          startColumnIndex: 0, endColumnIndex: header.length },
        rows: [{ values }], fields: 'userEnteredValue' } };
    });
    await this.req(`${SHEETS}/${this.id}:batchUpdate`, { method: 'POST', body: { requests } });
  }

  /** Ghi đè toàn bộ dữ liệu trong một lệnh nguyên khối (dùng khi khôi phục). */
  async replaceAll(data, oldCounts) {
    const requests = [];
    for (const t of TABLES) {
      const header = SCHEMA[t];
      const rows = [header, ...(data[t] || []).map(r => header.map(h => r[h] ?? null))];
      const total = Math.max(rows.length, (oldCounts?.[t] || 0) + 1);
      const width = Math.max(header.length, this.headers[t]?.length || 0);
      const grid = Array.from({ length: total }, (_, i) => ({
        values: Array.from({ length: width }, (_, j) => SheetsStore.cell(rows[i]?.[j] ?? null)) }));
      requests.push({ updateCells: {
        range: { sheetId: this.sheetIds[t], startRowIndex: 0, endRowIndex: total, startColumnIndex: 0, endColumnIndex: width },
        rows: grid, fields: 'userEnteredValue' } });
      this.headers[t] = header.slice();
    }
    await this.req(`${SHEETS}/${this.id}:batchUpdate`, { method: 'POST', body: { requests } });
  }

  // ---------- sao lưu trên Drive ----------
  async backup(label = 'thu-cong') {
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}`;
    return this.req(`${DRIVE}/${this.id}/copy?fields=id,name,createdTime`, { method: 'POST', body: {
      name: `Sao lưu tài chính ${stamp} (${label})`, appProperties: { [BACKUP_PROP]: '1' } } });
  }

  async listBackups() {
    const q = encodeURIComponent(`appProperties has { key='${BACKUP_PROP}' and value='1' } and trashed=false`);
    const r = await this.req(`${DRIVE}?q=${q}&fields=files(id,name,createdTime,webViewLink)&orderBy=createdTime desc&pageSize=100`);
    return r.files || [];
  }

  async deleteFile(id) {
    await this.req(`${DRIVE}/${id}`, { method: 'DELETE' });
  }

  async readOther(fileId) {
    const other = new SheetsStore(this.getToken, this.fetch);
    other.id = fileId;
    await other.meta();
    return other.load();
  }

  info() { return { kind: 'sheets', id: this.id, url: `https://docs.google.com/spreadsheets/d/${this.id}/edit` }; }
}

// ======================= phiên dữ liệu =======================
export class DataSession {
  constructor(store) {
    this.store = store;
    this.db = new DB();
    this.loadedAt = 0;
    this.queue = Promise.resolve();
  }

  async refresh() {
    this.db = new DB(await this.store.load());
    this.loadedAt = Date.now();
    return this.db;
  }

  /** Đọc: dùng dữ liệu đã tải nếu còn mới (mặc định 20 giây) để app nhanh. */
  async read(maxAgeMs = 20000) {
    if (!this.loadedAt || Date.now() - this.loadedAt > maxAgeMs) await this.refresh();
    return this.db;
  }

  /** Ghi: luôn tải lại dữ liệu mới nhất trước (tránh đè thay đổi từ thiết bị khác), xếp hàng tuần tự. */
  mutate(fn) {
    const run = async () => {
      await this.refresh();
      const tx = new Tx(this.db);
      let result;
      try {
        result = await fn(tx, this.db);
        await this.store.commit(tx.ops);
      } catch (e) {
        this.loadedAt = 0;  // bộ nhớ có thể đã bị sửa dở: lần đọc sau tải lại từ Sheet
        throw e;
      }
      this.loadedAt = Date.now();
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => { });
    return p;
  }
}

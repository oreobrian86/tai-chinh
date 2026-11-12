// Lớp dữ liệu: các bảng nằm trong bộ nhớ trình duyệt (chỉ trong phiên), nguồn gốc là Google Sheet.
// Mọi thao tác ghi: tải dữ liệu MỚI NHẤT từ Sheet → kiểm tra & tính toán → ghi tất cả thay đổi
// trong MỘT lệnh nguyên khối (hoặc ghi hết, hoặc không ghi gì).

const META = ['created_at', 'updated_at', 'deleted_at', 'version'];

export const SCHEMA = {
  accounts: ['id', 'name', 'kind', 'archived', 'sort', ...META],
  clients: ['id', 'name', 'phone', 'note', ...META],
  categories: ['id', 'name', 'kind', 'icon', 'color', 'sort', 'is_system', ...META],
  jobs: ['id', 'title', 'client_id', 'work_type', 'work_date', 'total_fee', 'due_date', 'work_status', 'cancel_policy',
    'location', 'description', 'note', ...META],
  job_sessions: ['id', 'job_id', 'kind', 'date', 'start_time', 'end_time', 'location', 'note', ...META],
  day_offs: ['id', 'date', 'note', ...META],
  transactions: ['id', 'kind', 'date', 'description', 'category_id', 'job_id', 'obligation_id', 'is_one_off',
    'import_batch_id', 'import_hash', 'note', ...META],
  transaction_lines: ['id', 'transaction_id', 'account_id', 'amount', ...META],
  goals: ['id', 'name', 'target_amount', 'target_date', 'monthly_plan', 'is_emergency', 'archived', 'note', ...META],
  goal_allocations: ['id', 'goal_id', 'date', 'amount', 'note', ...META],
  obligations: ['id', 'name', 'amount', 'due_date', 'recurrence', 'category_id', 'paid_transaction_id', 'note', ...META],
  import_batches: ['id', 'filename', 'row_count', 'imported_count', 'skipped_count', 'status', ...META],
  settings: ['id', 'value', ...META],
  audit_log: ['id', 'at', 'entity', 'entity_id', 'action', 'data_json', ...META],
};

/** Cột kiểu số (tiền là số nguyên VNĐ; cờ đúng/sai lưu 0/1). */
export const NUMERIC = new Set(['archived', 'sort', 'is_system', 'total_fee', 'is_one_off', 'amount', 'target_amount',
  'monthly_plan', 'is_emergency', 'row_count', 'imported_count', 'skipped_count', 'version']);

export const TABLES = Object.keys(SCHEMA);

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Chuẩn hóa một dòng đọc từ Sheet về đúng kiểu. */
export function normalize(table, obj) {
  const out = {};
  for (const col of SCHEMA[table]) {
    let v = obj[col];
    if (v === undefined || v === '') v = null;
    if (v !== null && NUMERIC.has(col)) {
      v = Number(v);
      if (!Number.isFinite(v)) v = null;
    } else if (v !== null && typeof v !== 'string') {
      v = String(v);
    }
    out[col] = v;
  }
  return out;
}

export class DB {
  /** data: { table: [rowObject, ...] } theo đúng thứ tự dòng trong Sheet (dòng 2 trở đi). */
  constructor(data = {}) {
    this.t = {};
    for (const table of TABLES) {
      this.t[table] = (data[table] || []).map((r, i) => Object.assign(normalize(table, r), { _row: i + 2 }));
    }
    this._index();
  }

  _index() {
    this.byId = {};
    for (const table of TABLES) {
      const m = new Map();
      for (const r of this.t[table]) if (r.id) m.set(r.id, r);
      this.byId[table] = m;
    }
  }

  all(table) { return this.t[table]; }
  live(table) { return this.t[table].filter(r => !r.deleted_at); }
  get(table, id) {
    const r = id ? this.byId[table].get(id) : null;
    return r && !r.deleted_at ? r : null;
  }
}

/** Một lần ghi: gom thay đổi, áp ngay vào bộ nhớ, rồi được gửi lên Sheet trong một lệnh. */
export class Tx {
  constructor(db) {
    this.db = db;
    this.ops = [];
  }

  insert(table, values) {
    const now = nowIso();
    const row = normalize(table, { id: newId(), created_at: now, updated_at: now, version: 1, ...values });
    row._row = this.db.t[table].length + 2;
    row._new = true;
    this.db.t[table].push(row);
    this.db._linesByTx = null; this.db._received = null;
    if (row.id) this.db.byId[table].set(row.id, row);
    this.ops.push({ type: 'append', table, row });
    return row;
  }

  update(table, id, patch) {
    this.db._linesByTx = null; this.db._received = null;
    const row = this.db.byId[table].get(id);
    if (!row) throw new Error(`Không tìm thấy ${table}/${id}`);
    for (const [k, v] of Object.entries(patch)) {
      if (!SCHEMA[table].includes(k)) throw new Error(`Cột không tồn tại: ${table}.${k}`);
      row[k] = v === undefined ? null : v;
    }
    Object.assign(row, normalize(table, row), { _row: row._row, _new: row._new });
    row.updated_at = nowIso();
    row.version = (row.version || 0) + 1;
    if (!row._new) this.ops.push({ type: 'update', table, row });  // dòng mới trong cùng lần ghi: chỉ cần append bản cuối
    return row;
  }

  softDelete(table, id) {
    return this.update(table, id, { deleted_at: nowIso() });
  }

  audit(entity, entityId, action, data) {
    this.insert('audit_log', { at: nowIso(), entity, entity_id: entityId, action,
      data_json: data === undefined ? null : JSON.stringify(data).slice(0, 4000) });
  }
}

/** Chuyển dòng thành mảng giá trị theo thứ tự cột của Sheet. */
export function rowToValues(table, row, header) {
  return header.map(col => {
    const v = row[col];
    return v === undefined ? null : v;
  });
}

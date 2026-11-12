// Kiểm tra dữ liệu đầu vào (thay cho Pydantic ở bản Python). Lỗi → AppError 422 kèm tên trường.
import { isValidDate } from './finance.js';
import { AppError } from './store.js';

export const MAX_MONEY = 100_000_000_000;  // 100 tỷ: chặn nhập nhầm thừa số 0
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

class Fail extends Error { constructor(field, msg) { super(msg); this.field = field; } }

const T = {
  str: (o = {}) => ({ ...o, t: 'str' }),
  int: (o = {}) => ({ ...o, t: 'int' }),
  bool: (o = {}) => ({ ...o, t: 'bool' }),
  date: (o = {}) => ({ ...o, t: 'date' }),
  time: (o = {}) => ({ ...o, t: 'time' }),
  enum: (values, o = {}) => ({ ...o, t: 'enum', values }),
  list: (item, o = {}) => ({ ...o, t: 'list', item }),
  map: (o = {}) => ({ ...o, t: 'map' }),
};
export { T };

function check(field, spec, v) {
  if (v === undefined || v === null || (v === '' && spec.t !== 'str')) {
    if (spec.required) throw new Fail(field, 'Bắt buộc nhập');
    return spec.default !== undefined ? structuredClone(spec.default) : null;
  }
  switch (spec.t) {
    case 'str': {
      if (typeof v !== 'string') throw new Fail(field, 'Phải là chữ');
      v = v.trim();
      if (spec.min !== undefined && v.length < spec.min) throw new Fail(field, spec.min === 1 ? 'Bắt buộc nhập' : `Ít nhất ${spec.min} ký tự`);
      if (spec.max !== undefined && v.length > spec.max) throw new Fail(field, `Tối đa ${spec.max} ký tự`);
      if (spec.pattern && !spec.pattern.test(v)) throw new Fail(field, spec.patternMsg || 'Không đúng định dạng');
      if (!v && !spec.required) return null;
      return v;
    }
    case 'int': {
      if (typeof v !== 'number' || !Number.isInteger(v)) throw new Fail(field, 'Phải là số nguyên');
      if (spec.gt !== undefined && !(v > spec.gt)) throw new Fail(field, `Phải lớn hơn ${spec.gt}`);
      if (spec.ge !== undefined && v < spec.ge) throw new Fail(field, `Phải từ ${spec.ge} trở lên`);
      const max = spec.le ?? MAX_MONEY, min = spec.lo ?? -MAX_MONEY;
      if (v > max || v < min) throw new Fail(field, 'Số tiền quá lớn');
      return v;
    }
    case 'bool': return !!v;
    case 'date': if (!isValidDate(v)) throw new Fail(field, 'Ngày không hợp lệ (định dạng YYYY-MM-DD)'); return v;
    case 'time': if (typeof v !== 'string' || !TIME_RE.test(v)) throw new Fail(field, 'Giờ không hợp lệ (HH:MM)'); return v;
    case 'enum': if (!spec.values.includes(v)) throw new Fail(field, 'Giá trị không hợp lệ'); return v;
    case 'list': if (!Array.isArray(v)) throw new Fail(field, 'Phải là danh sách'); return v.map((x, i) => spec.item.t === 'obj' ? parse(spec.item.shape, x, `${field}.${i}`) : check(`${field}.${i}`, spec.item, x));
    case 'map': if (typeof v !== 'object' || Array.isArray(v)) throw new Fail(field, 'Không hợp lệ'); return v;
    default: return v;
  }
}

/** Trả về object chỉ gồm các trường có gửi lên (giống model_dump(exclude_unset=True)). */
export function parse(shape, body, prefix = '') {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'bad_json', 'Dữ liệu gửi lên không hợp lệ.');
  const out = {};
  for (const k of Object.keys(body)) {
    if (!(k in shape)) throw new AppError(422, 'validation', `Trường không được phép: ${k}`, { [k]: 'Không được phép' });
  }
  for (const [k, spec] of Object.entries(shape)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (!(k in body)) {
      if (spec.required) throw new AppError(422, 'validation', 'Bắt buộc nhập', { [name]: 'Bắt buộc nhập' });
      if (spec.default !== undefined) out[k] = structuredClone(spec.default);
      continue;
    }
    try { out[k] = check(name, spec, body[k]); }
    catch (e) { if (e instanceof Fail) throw new AppError(422, 'validation', e.message, { [e.field]: e.message }); throw e; }
  }
  return out;
}

const Money = (o = {}) => T.int({ ge: 0, ...o });
const PosMoney = (o = {}) => T.int({ gt: 0, ...o });
const SignedMoney = (o = {}) => T.int(o);
const Text = () => T.str({ max: 2000 });
const Name = (o = {}) => T.str({ min: 1, max: 200, ...o });
const WORK_TYPE = ['video', 'video_edit', 'edit', 'photo', 'other'];
const ACC_KIND = ['cash', 'bank', 'ewallet', 'savings', 'other'];

const SessionIn = {
  id: T.str({ max: 100 }), kind: T.enum(['shoot', 'photo', 'edit', 'deadline', 'other'], { required: true }),
  date: T.date({ required: true }), start_time: T.time(), end_time: T.time(),
  location: T.str({ max: 300 }), note: Text(),
};

export const S = {
  Settings: { lock_minutes: T.int({ ge: 0, le: 1440 }), exclude_one_off: T.bool(), display_name: T.str({ max: 100 }),
    hide_amounts: T.bool(), gcal_include_fee: T.bool(), gcal_import_keyword: T.str({ max: 200 }),
    monthly_budget: T.int({ ge: 0, le: 10_000_000_000 }) },
  Account: { name: Name({ required: true }), kind: T.enum(ACC_KIND, { default: 'cash' }), opening_balance: SignedMoney({ default: 0 }),
    opening_date: T.date(), archived: T.bool() },
  AccountPatch: { name: Name(), kind: T.enum(ACC_KIND), archived: T.bool(), sort: T.int({ lo: -1e9, le: 1e9 }) },
  Category: { name: T.str({ min: 1, max: 60, required: true }), kind: T.enum(['expense', 'income'], { default: 'expense' }),
    icon: T.str({ max: 8 }), color: T.str({ pattern: /^#[0-9a-fA-F]{6}$/ }), sort: T.int({ lo: -1e9, le: 1e9 }) },
  CategoryPatch: { name: T.str({ min: 1, max: 60 }), icon: T.str({ max: 8 }), color: T.str({ pattern: /^#[0-9a-fA-F]{6}$/ }), sort: T.int({ lo: -1e9, le: 1e9 }) },
  Client: { name: Name({ required: true }), phone: T.str({ max: 30 }), note: Text() },
  Job: { title: Name({ required: true }), client_id: T.str({ max: 100 }), client_name: T.str({ max: 200 }),
    work_type: T.enum(WORK_TYPE, { default: 'video' }), work_date: T.date({ required: true }), total_fee: Money({ required: true }),
    due_date: T.date(), work_status: T.enum(['booked', 'in_progress', 'done'], { default: 'booked' }),
    location: T.str({ max: 300 }), description: Text(), note: Text(), deposit: Money({ default: 0 }),
    deposit_account_id: T.str({ max: 100 }), deposit_date: T.date(), sessions: T.list({ t: 'obj', shape: SessionIn }),
    start_time: T.time(), end_time: T.time() },
  JobPatch: { title: Name(), client_id: T.str({ max: 100 }), client_name: T.str({ max: 200 }), work_type: T.enum(WORK_TYPE),
    work_date: T.date(), total_fee: Money(), due_date: T.date(), work_status: T.enum(['booked', 'in_progress', 'done']),
    location: T.str({ max: 300 }), description: Text(), note: Text(), sessions: T.list({ t: 'obj', shape: SessionIn }) },
  Payment: { amount: PosMoney({ required: true }), date: T.date(), account_id: T.str({ required: true, max: 100 }), note: Text(),
    allow_overpay: T.bool({ default: false }) },
  Cancel: { policy: T.enum(['keep', 'refund'], { required: true }), account_id: T.str({ max: 100 }), date: T.date(), note: Text() },
  Tx: { kind: T.enum(['expense', 'other_income', 'transfer', 'adjustment'], { required: true }), amount: SignedMoney({ required: true }),
    date: T.date(), account_id: T.str({ required: true, max: 100 }), to_account_id: T.str({ max: 100 }),
    category_id: T.str({ max: 100 }), description: T.str({ max: 300 }), note: Text(), is_one_off: T.bool({ default: false }),
    job_id: T.str({ max: 100 }), fee: Money({ default: 0 }) },
  TxPatch: { amount: SignedMoney(), date: T.date(), account_id: T.str({ max: 100 }), to_account_id: T.str({ max: 100 }),
    category_id: T.str({ max: 100 }), description: T.str({ max: 300 }), note: Text(), is_one_off: T.bool(), allow_overpay: T.bool() },
  Goal: { name: Name({ required: true }), target_amount: PosMoney({ required: true }), target_date: T.date(), monthly_plan: Money(),
    is_emergency: T.bool({ default: false }), note: Text(), initial_amount: Money({ default: 0 }) },
  GoalPatch: { name: Name(), target_amount: PosMoney(), target_date: T.date(), monthly_plan: Money(), is_emergency: T.bool(),
    archived: T.bool(), note: Text() },
  Allocation: { amount: SignedMoney({ required: true }), date: T.date(), note: Text() },
  Obligation: { name: Name({ required: true }), amount: PosMoney({ required: true }), due_date: T.date({ required: true }),
    recurrence: T.enum(['none', 'monthly', 'yearly'], { default: 'none' }), category_id: T.str({ max: 100 }), note: Text(),
    kind: T.enum(['bill', 'debt', 'once'], { default: 'bill' }), provider: T.str({ max: 100 }),
    installments: T.int({ ge: 1, le: 60 }), installment_no: T.int({ ge: 1, le: 60 }) },
  ObligationPatch: { name: Name(), amount: PosMoney(), due_date: T.date(), recurrence: T.enum(['none', 'monthly', 'yearly']),
    category_id: T.str({ max: 100 }), note: Text(), kind: T.enum(['bill', 'debt', 'once']), provider: T.str({ max: 100 }),
    installments: T.int({ ge: 1, le: 60 }), installment_no: T.int({ ge: 1, le: 60 }) },
  PayObligation: { account_id: T.str({ required: true, max: 100 }), date: T.date(), amount: PosMoney() },
  DayOff: { date: T.date({ required: true }), note: T.str({ max: 300 }) },
  ImportMap: { token: T.str({ required: true, max: 100 }), mapping: T.map({ required: true }), account_id: T.str({ required: true, max: 100 }),
    date_format: T.enum(['auto', 'dmy', 'ymd', 'mdy'], { default: 'auto' }),
    amount_mode: T.enum(['expense_positive', 'signed', 'debit_credit'], { default: 'expense_positive' }),
    skip_header: T.bool({ default: true }), include_duplicates: T.list(T.int({ ge: 0, le: 1e9 }), { default: [] }) },
};

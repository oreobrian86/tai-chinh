// finance: NƠI DUY NHẤT chứa công thức tiền (chuyển nguyên từ bản Python đã kiểm thử).
// - Số dư = tổng các dòng giao dịch chưa xóa. Không lưu số dư.
// - Doanh thu lấy từ show; tiền về lấy từ giao dịch. Không cộng hai nguồn.
// - Công nợ = tổng công − đã nhận, tính lại mỗi lần. Show hủy → công nợ 0.
// - Chuyển khoản / điều chỉnh không phải thu hay chi. Tiết kiệm không phải chi tiêu.
// - Công nợ chưa thu KHÔNG BAO GIỜ nằm trong tiền khả dụng.

export const MIN_HISTORY_DAYS = 14;
export const MIN_EXPENSE_COUNT = 10;

// ---------- ngày (chuỗi YYYY-MM-DD, không phụ thuộc múi giờ) ----------
const pad = n => String(n).padStart(2, '0');
const toD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromD = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); };
export const diffDays = (a, b) => Math.round((toD(b) - toD(a)) / 864e5);  // b − a
export const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();  // m: 1..12
export function monthBounds(s) {
  const [y, m] = s.split('-').map(Number);
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`];
}
export function addMonths(s, n) {
  const [y0, m0, d0] = s.split('-').map(Number);
  const idx = y0 * 12 + (m0 - 1) + n;
  const y = Math.floor(idx / 12), m = (idx % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(d0, lastDay(y, m)))}`;
}
export const weekday = s => (toD(s).getUTCDay() + 6) % 7;  // Thứ hai = 0
export const isValidDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromD(toD(s)) === s;

// ---------- truy vấn cơ bản ----------
const liveTx = db => db.live('transactions');

function linesByTx(db) {
  if (db._linesByTx) return db._linesByTx;
  const m = new Map();
  for (const l of db.live('transaction_lines')) {
    if (!m.has(l.transaction_id)) m.set(l.transaction_id, []);
    m.get(l.transaction_id).push(l);
  }
  db._linesByTx = m;
  return m;
}
export const txLines = (db, txId) => linesByTx(db).get(txId) || [];
export const txSum = (db, tx) => txLines(db, tx.id).reduce((a, l) => a + l.amount, 0);
export function invalidate(db) { db._linesByTx = null; }

// ---------- số dư ----------
export function accountBalances(db) {
  const bal = new Map();
  for (const t of liveTx(db)) for (const l of txLines(db, t.id)) bal.set(l.account_id, (bal.get(l.account_id) || 0) + l.amount);
  return db.live('accounts')
    .map(a => ({ id: a.id, name: a.name, kind: a.kind, archived: a.archived || 0, sort: a.sort || 0, balance: bal.get(a.id) || 0 }))
    .sort((a, b) => a.archived - b.archived || a.sort - b.sort);
}

export function totalBalance(db) {
  const live = new Set(db.live('accounts').map(a => a.id));
  let s = 0;
  for (const t of liveTx(db)) for (const l of txLines(db, t.id)) if (live.has(l.account_id)) s += l.amount;
  return s;
}

// ---------- show & công nợ ----------
export function jobReceived(db, jobId) {
  let s = 0;
  for (const t of liveTx(db)) if (t.job_id === jobId && (t.kind === 'job_payment' || t.kind === 'job_refund')) s += txSum(db, t);
  return s;
}

export function enrichJob(job, received, today) {
  const fee = job.total_fee || 0;
  const cancelled = job.work_status === 'cancelled';
  const outstanding = cancelled ? 0 : Math.max(0, fee - received);
  const pay_status = received <= 0 ? 'unpaid' : (received < fee && !cancelled ? 'partial' : 'paid');
  const overdue_days = outstanding > 0 && job.due_date ? Math.max(0, diffDays(job.due_date, today)) : 0;
  const revenue = cancelled ? Math.max(0, received) : job.work_status === 'done' ? fee : 0;
  return { ...job, received, outstanding, pay_status, overdue_days, revenue,
    expected_revenue: cancelled ? 0 : fee, overpaid: cancelled ? 0 : Math.max(0, received - fee) };
}

/** filter(job) → bool. Trả danh sách show kèm số tiền, mới nhất trước. */
function receivedMap(db) {
  if (db._linesByTx && db._received) return db._received;
  const received = new Map();
  for (const t of liveTx(db)) {
    if (t.job_id && (t.kind === 'job_payment' || t.kind === 'job_refund')) received.set(t.job_id, (received.get(t.job_id) || 0) + txSum(db, t));
  }
  db._received = received;  // bị xóa cùng _linesByTx mỗi khi có thay đổi
  return received;
}

export function jobsWithMoney(db, today, filter = () => true) {
  const received = receivedMap(db);
  const clients = new Map(db.all('clients').map(c => [c.id, c]));
  return db.live('jobs').filter(filter)
    .sort((a, b) => (b.work_date || '').localeCompare(a.work_date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
    .map(j => enrichJob({ ...stripPriv(j), client_name: clients.get(j.client_id)?.name || null }, received.get(j.id) || 0, today));
}

export const stripPriv = r => { const o = { ...r }; delete o._row; delete o._new; return o; };

export const receivablesTotal = (db, today) =>
  jobsWithMoney(db, today, j => j.work_status !== 'cancelled').reduce((a, j) => a + j.outstanding, 0);

// ---------- tiết kiệm ----------
export function goalBalances(db) {
  const saved = new Map();
  for (const a of db.live('goal_allocations')) saved.set(a.goal_id, (saved.get(a.goal_id) || 0) + a.amount);
  return db.live('goals')
    .map(g => ({ ...stripPriv(g), archived: g.archived || 0, is_emergency: g.is_emergency || 0, saved: saved.get(g.id) || 0 }))
    .sort((a, b) => a.archived - b.archived || b.is_emergency - a.is_emergency || (a.created_at || '').localeCompare(b.created_at || ''));
}

export function feasibility(need, capacity) {
  if (capacity <= 0) return 'not_feasible';
  const r = need / capacity;
  if (r > 1) return 'not_feasible';
  if (r >= 0.7) return 'tight';
  return 'ok';
}

export function goalPlan(goal, today, capacity) {
  const target = goal.target_amount, saved = goal.saved;
  const remaining = Math.max(0, target - saved);
  const out = { remaining, progress: target ? Math.min(1, saved / target) : 0, months_at_plan: null, eta_at_plan: null,
    required_monthly: null, months_left: null, feasibility: null };
  const plan = goal.monthly_plan || 0;
  if (remaining === 0) out.months_at_plan = 0;
  else if (plan > 0) {
    out.months_at_plan = Math.ceil(remaining / plan);
    out.eta_at_plan = addMonths(today, out.months_at_plan);
  }
  if (goal.target_date && remaining > 0) {
    const [ty, tm] = goal.target_date.split('-').map(Number), [y, m] = today.split('-').map(Number);
    out.months_left = Math.max(1, (ty - y) * 12 + (tm - m));
    out.required_monthly = Math.ceil(remaining / out.months_left);
  }
  const need = out.required_monthly !== null ? out.required_monthly : (remaining ? plan : 0);
  if (need && capacity !== null && capacity !== undefined) out.feasibility = feasibility(need, capacity);
  return out;
}

export function reservedTotal(db) {
  let regular = 0, emergency = 0;
  for (const g of goalBalances(db)) {
    if (g.archived) continue;
    const s = Math.max(0, g.saved);
    if (g.is_emergency) emergency += s; else regular += s;
  }
  return [regular, emergency];
}

// ---------- khoản phải trả ----------
export const obligationsDue = (db, until) =>
  db.live('obligations').filter(o => !o.paid_transaction_id && o.due_date <= until)
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).map(stripPriv);

// ---------- thu / chi ----------
export function expensesBetween(db, start, end, excludeOneOff = false) {
  let total = 0, count = 0;
  for (const t of liveTx(db)) {
    if (t.kind !== 'expense' || t.date < start || t.date > end) continue;
    if (excludeOneOff && t.is_one_off) continue;
    total -= txSum(db, t);
    count++;
  }
  return [total, count];
}

export function incomeBetween(db, start, end) {
  const by = { job_payment: 0, job_refund: 0, other_income: 0 };
  for (const t of liveTx(db)) if (t.kind in by && t.date >= start && t.date <= end) by[t.kind] += txSum(db, t);
  const jobs = by.job_payment + by.job_refund;
  return { job_cash: jobs, other: by.other_income, total: jobs + by.other_income };
}

export function revenueBetween(db, start, end, today) {
  const jobs = jobsWithMoney(db, today, j => j.work_date >= start && j.work_date <= end);
  const by_type = {};
  for (const j of jobs) if (j.revenue) by_type[j.work_type] = (by_type[j.work_type] || 0) + j.revenue;
  return {
    earned: jobs.reduce((a, j) => a + j.revenue, 0),
    expected: jobs.filter(j => j.work_status === 'booked' || j.work_status === 'in_progress').reduce((a, j) => a + j.expected_revenue, 0),
    by_type, jobs_done: jobs.filter(j => j.work_status === 'done').length,
    jobs_count: jobs.filter(j => j.work_status !== 'cancelled').length,
  };
}

export function firstActivityDate(db) {
  let min = null;
  for (const t of liveTx(db)) if (t.kind !== 'adjustment' && (!min || t.date < min)) min = t.date;
  return min;
}

// ---------- tiền khả dụng & dự báo ----------
export function cashPosition(db, today, horizon = 'month_end') {
  const balance = totalBalance(db);
  const [regular, emergency] = reservedTotal(db);
  const [, mend] = monthBounds(today);
  const until = horizon === 'month_end' ? mend : addDays(today, 29);
  const obligations = obligationsDue(db, until);
  const obligationsSum = obligations.reduce((a, o) => a + o.amount, 0);
  const available = balance - regular - emergency - obligationsSum;
  return {
    balance, reserved_goals: regular, emergency_fund: emergency, obligations_due: obligationsSum, obligations_until: until,
    obligations, receivables: receivablesTotal(db, today),  // chỉ để hiển thị, KHÔNG cộng
    available, over_committed: available < 0, reserved_exceeds_balance: regular + emergency > balance,
  };
}

export function spendingStats(db, today, excludeOneOff = false) {
  const first = firstActivityDate(db);
  const historyDays = first ? diffDays(first, today) + 1 : 0;
  const win = n => {
    const [spent, count] = expensesBetween(db, addDays(today, -(n - 1)), today, excludeOneOff);
    const days = historyDays ? Math.min(n, historyDays) : 0;
    return [spent, count, days ? Math.round(spent / days) : 0];
  };
  const [s30, c30, a30] = win(30);
  const [s90, c90, a90] = win(90);
  const months = [];
  const [curStart] = monthBounds(today);
  for (let i = 1; i <= 3; i++) {
    const ms = addMonths(curStart, -i);
    const [, me] = monthBounds(ms);
    if (first && me >= first) months.push(expensesBetween(db, ms, me, excludeOneOff)[0]);
  }
  return {
    history_days: historyDays, spent_30: s30, count_30: c30, avg_daily_30: a30, spent_90: s90, avg_daily_90: a90,
    avg_monthly_3m: months.length ? Math.round(months.reduce((a, b) => a + b, 0) / months.length) : null,
    months_in_3m_avg: months.length, avg_monthly_from_30: a30 * 30,
    insufficient_data: historyDays < MIN_HISTORY_DAYS || c90 < MIN_EXPENSE_COUNT,
  };
}

export function forecast(db, today, excludeOneOff = false) {
  const pos = cashPosition(db, today);
  const st = spendingStats(db, today, excludeOneOff);
  const avg = st.avg_daily_30 || st.avg_daily_90;
  const available = pos.available;
  const runway = available <= 0 ? 0 : avg > 0 ? Math.floor(available / avg) : null;
  const [mstart, mend] = monthBounds(today);
  const daysLeftMonth = diffDays(today, mend) + 1;
  const safeDaily = Math.floor(Math.max(0, available) / daysLeftMonth);
  const wd = weekday(today);
  const weekEnd = addDays(today, 6 - wd), weekStart = addDays(today, -wd);
  const daysLeftWeek = diffDays(today, weekEnd) + 1;
  const receivableThisMonth = jobsWithMoney(db, today, j => j.work_status !== 'cancelled' && j.due_date && j.due_date <= mend)
    .reduce((a, j) => a + j.outstanding, 0);
  const projected = pos.balance - avg * diffDays(today, mend) - pos.obligations_due;
  return {
    ...pos, ...st, avg_daily_used: avg, runway_days: runway,
    out_of_money_date: runway !== null ? addDays(today, runway) : null,
    days_left_month: daysLeftMonth, safe_daily: safeDaily, weekly_allowance: safeDaily * daysLeftWeek,
    days_left_week: daysLeftWeek, spent_this_week: expensesBetween(db, weekStart, today)[0],
    spent_today: expensesBetween(db, today, today)[0],
    projected_eom_balance: projected, projected_eom_optimistic: projected + receivableThisMonth,
    receivable_due_this_month: receivableThisMonth, month_start: mstart, month_end: mend,
  };
}

export function monthlyCapacity(db, today) {
  const first = firstActivityDate(db);
  if (!first) return null;
  const [curStart] = monthBounds(today);
  const incs = [], exps = [];
  for (let i = 1; i <= 3; i++) {
    const ms = addMonths(curStart, -i);
    const [, me] = monthBounds(ms);
    if (me >= first) { incs.push(incomeBetween(db, ms, me).total); exps.push(expensesBetween(db, ms, me)[0]); }
  }
  const sum = a => a.reduce((x, y) => x + y, 0);
  if (incs.length) return Math.round((sum(incs) - sum(exps)) / incs.length);
  const days = diffDays(first, today) + 1;
  return Math.round((incomeBetween(db, first, today).total - expensesBetween(db, first, today)[0]) / days * 30);
}

export function monthSeries(db, today, months = 6) {
  const [curStart] = monthBounds(today);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ms = addMonths(curStart, -i);
    const [, me] = monthBounds(ms);
    const inc = incomeBetween(db, ms, me);
    const [exp, cnt] = expensesBetween(db, ms, me);
    const rev = revenueBetween(db, ms, me, today);
    out.push({ month: ms.slice(0, 7), income: inc.total, job_cash: inc.job_cash, expense: exp, expense_count: cnt,
      revenue: rev.earned, revenue_by_type: rev.by_type, net: inc.total - exp });
  }
  return out;
}

export function expenseByCategory(db, start, end) {
  const cats = new Map(db.all('categories').map(c => [c.id, c]));
  const by = new Map();
  for (const t of liveTx(db)) {
    if (t.kind !== 'expense' || t.date < start || t.date > end) continue;
    const key = t.category_id || '';
    by.set(key, (by.get(key) || 0) - txSum(db, t));
  }
  return [...by.entries()].map(([id, total]) => {
    const c = cats.get(id);
    return { category_id: id, name: c?.name || 'Chưa phân loại', color: c?.color || null, icon: c?.icon || null, total };
  }).sort((a, b) => b.total - a.total);
}

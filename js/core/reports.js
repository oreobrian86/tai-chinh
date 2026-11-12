// Báo cáo tháng, công nợ, xuất CSV / JSON.
import * as fe from './finance.js';
import { TABLES } from './db.js';

export const KIND_LABEL = { job_payment: 'Tiền show', job_refund: 'Hoàn cọc', other_income: 'Thu khác', expense: 'Chi',
  transfer: 'Chuyển khoản', adjustment: 'Điều chỉnh' };

export function monthsBack(today, n) {
  const [start] = fe.monthBounds(today);
  return Array.from({ length: n }, (_, i) => fe.addMonths(start, -(n - 1 - i)).slice(0, 7));
}

export function monthlyReport(db, months, today) {
  const live = new Map(db.live('jobs').map(j => [j.id, j]));
  return months.map(m => {
    const ms = `${m}-01`, [, me] = fe.monthBounds(ms);
    const inc = fe.incomeBetween(db, ms, me);
    const [exp, cnt] = fe.expensesBetween(db, ms, me);
    const rev = fe.revenueBetween(db, ms, me, today);
    const statsEnd = ms <= today ? (me < today ? me : today) : me;
    const daysIn = ms <= today ? fe.diffDays(ms, statsEnd) + 1 : 0;
    const workDays = new Set(db.live('job_sessions').filter(s => {
      const j = live.get(s.job_id);
      return j && j.work_status !== 'cancelled' && s.kind !== 'deadline' && s.date >= ms && s.date <= me;
    }).map(s => s.date)).size;
    const saved = db.live('goal_allocations').filter(a => a.date >= ms && a.date <= me).reduce((s, a) => s + a.amount, 0);
    const recv = fe.jobsWithMoney(db, today, j => j.work_date >= ms && j.work_date <= me && j.work_status !== 'cancelled')
      .reduce((s, j) => s + j.receivable, 0);
    return { month: m, revenue: rev.earned, revenue_by_type: rev.by_type, jobs_done: rev.jobs_done,
      cash_in: inc.total, job_cash: inc.job_cash, other_income: inc.other, expense: exp, expense_count: cnt,
      net_cashflow: inc.total - exp, receivable_from_month: recv, work_days: workDays,
      avg_per_job: rev.jobs_done ? Math.round(rev.earned / rev.jobs_done) : 0,
      avg_daily_expense: daysIn ? Math.round(exp / daysIn) : 0, saved,
      savings_rate: inc.total > 0 ? Math.round(saved / inc.total * 10000) / 10000 : null };
  });
}

export function receivablesReport(db, today) {
  const all = fe.jobsWithMoney(db, today, j => j.work_status !== 'cancelled');
  const jobs = all.filter(j => j.receivable > 0);
  const expected = all.filter(j => j.pending > 0).sort((a, b) => a.work_date.localeCompare(b.work_date));
  const accs = new Map(db.all('accounts').map(a => [a.id, a]));
  const by = new Map();
  for (const j of jobs) {
    const key = j.client_id || '_none';
    if (!by.has(key)) by.set(key, { client_id: j.client_id, client_name: j.client_name || '(Chưa có tên khách)', total: 0, jobs: [], max_overdue: 0 });
    const c = by.get(key);
    c.total += j.receivable;
    c.max_overdue = Math.max(c.max_overdue, j.overdue_days);
    const payments = db.live('transactions').filter(t => t.job_id === j.id && (t.kind === 'job_payment' || t.kind === 'job_refund'))
      .sort((a, b) => a.date.localeCompare(b.date))
      .flatMap(t => fe.txLines(db, t.id).map(l => ({ id: t.id, date: t.date, kind: t.kind, amount: l.amount, account_name: accs.get(l.account_id)?.name, note: t.note })));
    c.jobs.push({ ...j, payments });
  }
  const clients = [...by.values()].sort((a, b) => b.max_overdue - a.max_overdue || b.total - a.total);
  return { total: clients.reduce((s, c) => s + c.total, 0), overdue_total: jobs.filter(j => j.overdue_days > 0).reduce((s, j) => s + j.outstanding, 0),
    clients, job_count: jobs.length,
    expected: { total: expected.reduce((s, j) => s + j.pending, 0), jobs: expected } };
}

// ---------- xuất ----------
const looksNumber = v => /^[-+]?[\d.,]+$/.test(v);
export const safeCell = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !looksNumber(v) ? "'" + v : v);

export function toCsv(table) {
  const esc = v => {
    v = safeCell(v ?? '');
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + table.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';  // BOM để Excel đọc đúng tiếng Việt
}

export function transactionsTable(db, start, end) {
  const cats = new Map(db.all('categories').map(c => [c.id, c]));
  const accs = new Map(db.all('accounts').map(a => [a.id, a]));
  const jobs = new Map(db.all('jobs').map(j => [j.id, j]));
  const out = [['Ngày', 'Loại', 'Nội dung', 'Danh mục', 'Tài khoản', 'Số tiền (+vào/-ra)', 'Show', 'Ghi chú']];
  const txs = db.live('transactions').filter(t => (!start || t.date >= start) && (!end || t.date <= end))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || '').localeCompare(b.created_at || ''));
  for (const t of txs) for (const l of fe.txLines(db, t.id)) {
    out.push([t.date, KIND_LABEL[t.kind] || t.kind, t.description || '', cats.get(t.category_id)?.name || '', accs.get(l.account_id)?.name || '',
      l.amount, jobs.get(t.job_id)?.title || '', t.note || '']);
  }
  return out;
}

export function reportTable(rep) {
  const out = [['Tháng', 'Doanh thu (đã làm)', 'Tiền về', 'Chi tiêu', 'Dòng tiền ròng', 'Công nợ từ tháng', 'Số ngày làm',
    'Show hoàn thành', 'TB mỗi show', 'Chi TB/ngày', 'Đã để dành', 'Tỷ lệ tiết kiệm']];
  for (const r of rep) out.push([r.month, r.revenue, r.cash_in, r.expense, r.net_cashflow, r.receivable_from_month, r.work_days,
    r.jobs_done, r.avg_per_job, r.avg_daily_expense, r.saved, r.savings_rate === null ? '' : `${(r.savings_rate * 100).toFixed(1)}%`]);
  return out;
}

export function exportAll(db) {
  const data = { format: 'finance-app-export', version: 2, exported_at: new Date().toISOString() };
  for (const t of TABLES) data[t] = db.all(t).map(fe.stripPriv);
  return data;
}

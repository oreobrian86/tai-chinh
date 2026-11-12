// Bộ định tuyến chạy trong trình duyệt: giữ nguyên các đường dẫn /api/... của bản máy chủ cũ,
// nên giao diện gọi y như trước, chỉ khác là dữ liệu đọc/ghi thẳng vào Google Sheet.
import * as fe from './finance.js';
import * as imp from './importer.js';
import * as rp from './reports.js';
import * as sv from './services.js';
import { AppError } from './store.js';
import { S, parse } from './validate.js';

const pad = n => String(n).padStart(2, '0');
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const checkDates = (...ds) => ds.forEach(d => { if (!fe.isValidDate(d)) throw new AppError(422, 'bad_date', 'Ngày không hợp lệ (YYYY-MM-DD).'); });

export class Api {
  /** session: DataSession; today(): chuỗi ngày hôm nay (cho phép giả lập khi kiểm thử). */
  constructor(session, { today = localToday, backups = null } = {}) {
    this.s = session;
    this.today = today;
    this.backups = backups;
    this.routes = [];
    this.build();
  }

  on(method, pattern, fn, model = null) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, fn, model });
  }

  async handle(method, url, body) {
    const [path, qs = ''] = url.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs));
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const data = r.model ? parse(r.model, body ?? {}) : body;
      return clone(await r.fn({ p, q, body: data, today: this.today() }));
    }
    throw new AppError(404, 'not_found', 'API không tồn tại.');
  }

  // tiện ích
  read() { return this.s.read(); }
  write(fn) { return this.s.mutate(fn); }

  build() {
    const R = (fn) => async ctx => fn(ctx, await this.read());
    const W = (fn) => ctx => this.write((tx, db) => fn(ctx, tx, db));
    const on = this.on.bind(this);

    // ---------- khởi tạo & cài đặt ----------
    on('GET', '/api/state', R((c, db) => ({ setup_needed: sv.needsSetup(db), settings: sv.getSettings(db) })));
    on('POST', '/api/setup', W((c, tx, db) => { if (!sv.needsSetup(db)) return { ok: true, already: true }; sv.initialSetup(tx); return { ok: true }; }));
    on('GET', '/api/settings', R((c, db) => sv.getSettings(db)));
    on('PUT', '/api/settings', W((c, tx, db) => sv.updateSettings(tx, db, c.body)), S.Settings);

    // ---------- tổng quan ----------
    on('GET', '/api/dashboard', R(({ today }, db) => {
      const st = sv.getSettings(db);
      const fc = fe.forecast(db, today, !!st.exclude_one_off);
      const [ms, me] = fe.monthBounds(today);
      const inc = fe.incomeBetween(db, ms, me);
      const [exp, cnt] = fe.expensesBetween(db, ms, me);
      const rev = fe.revenueBetween(db, ms, me, today);
      const series = fe.monthSeries(db, today, 6);
      const byType = {};
      for (const m of series) for (const [k, v] of Object.entries(m.revenue_by_type)) byType[k] = (byType[k] || 0) + v;
      const jobs = new Map(fe.jobsWithMoney(db, today, j => j.work_status !== 'cancelled').map(j => [j.id, j]));
      const until = fe.addDays(today, 14);
      const upcoming = db.live('job_sessions').filter(s => jobs.has(s.job_id) && s.date >= today && s.date <= until)
        .map(s => { const j = jobs.get(s.job_id); return { ...fe.stripPriv(s), title: j.title, work_type: j.work_type, client_name: j.client_name }; })
        .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '99').localeCompare(b.start_time || '99')).slice(0, 8);
      const rec = rp.receivablesReport(db, today);
      const warnings = [];
      if (fc.insufficient_data) warnings.push({ level: 'info', text: 'Dữ liệu chi tiêu còn ít (dưới 14 ngày hoặc dưới 10 khoản chi) nên dự báo chưa chính xác.' });
      if (fc.over_committed) warnings.push({ level: 'danger', text: 'Tiền đã dành và các khoản phải trả đang nhiều hơn số tiền bạn có.' });
      if (rec.overdue_total > 0) warnings.push({ level: 'warn', text: `Có ${new Intl.NumberFormat('vi-VN').format(rec.overdue_total)}đ công nợ đã quá hạn.` });
      return { today, forecast: fc,
        month: { income: inc.total, job_cash: inc.job_cash, other_income: inc.other, expense: exp, expense_count: cnt, revenue: rev.earned, expected_revenue: rev.expected },
        series, expense_by_category: fe.expenseByCategory(db, ms, me), revenue_by_type: byType, upcoming,
        receivables: { total: rec.total, overdue_total: rec.overdue_total, job_count: rec.job_count,
          top: rec.clients.slice(0, 5).map(c => ({ client_name: c.client_name, total: c.total, max_overdue: c.max_overdue })) },
        accounts: fe.accountBalances(db), warnings };
    }));
    on('GET', '/api/forecast', R(({ today }, db) => fe.forecast(db, today, !!sv.getSettings(db).exclude_one_off)));

    // ---------- tài khoản / danh mục / khách ----------
    on('GET', '/api/accounts', R((c, db) => fe.accountBalances(db)));
    on('POST', '/api/accounts', W((c, tx, db) => sv.createAccount(tx, db, c.body, c.today)), S.Account);
    on('PATCH', '/api/accounts/{id}', W((c, tx, db) => sv.updateAccount(tx, db, c.p.id, c.body)), S.AccountPatch);
    on('DELETE', '/api/accounts/{id}', W((c, tx, db) => sv.deleteAccount(tx, db, c.p.id)));
    on('GET', '/api/categories', R((c, db) => sv.listCategories(db)));
    on('POST', '/api/categories', W((c, tx, db) => sv.createCategory(tx, db, c.body)), S.Category);
    on('PATCH', '/api/categories/{id}', W((c, tx, db) => sv.updateCategory(tx, db, c.p.id, c.body)), S.CategoryPatch);
    on('DELETE', '/api/categories/{id}', W((c, tx, db) => sv.deleteCategory(tx, db, c.p.id, c.q.reassign_to)));
    on('GET', '/api/clients', R((c, db) => db.live('clients').map(fe.stripPriv).sort((a, b) => a.name.localeCompare(b.name))));
    on('POST', '/api/clients', W((c, tx, db) => sv.saveClient(tx, db, c.body)), S.Client);
    on('PUT', '/api/clients/{id}', W((c, tx, db) => sv.saveClient(tx, db, c.body, c.p.id)), S.Client);
    on('DELETE', '/api/clients/{id}', W((c, tx, db) => { sv.deleteClient(tx, db, c.p.id); return { ok: true }; }));

    // ---------- show / công nợ ----------
    on('GET', '/api/jobs', R(({ q, today }, db) => {
      const sts = q.status ? q.status.split(',') : null, s = (q.q || '').toLowerCase();
      const clients = new Map(db.all('clients').map(c => [c.id, c.name.toLowerCase()]));
      let items = fe.jobsWithMoney(db, today, j => (!sts || sts.includes(j.work_status)) && (!q.from || j.work_date >= q.from) &&
        (!q.to || j.work_date <= q.to) && (!q.type || j.work_type === q.type) &&
        (!s || j.title.toLowerCase().includes(s) || (clients.get(j.client_id) || '').includes(s)));
      if (q.pay === 'unpaid') items = items.filter(j => j.outstanding > 0);
      const sum = k => items.reduce((a, j) => a + j[k], 0);
      return { items, totals: { fee: sum('expected_revenue'), received: sum('received'), outstanding: sum('outstanding') } };
    }));
    on('POST', '/api/jobs', W((c, tx, db) => sv.createJob(tx, db, c.body, c.today)), S.Job);
    on('GET', '/api/jobs/{id}', R((c, db) => sv.getJob(db, c.p.id, c.today)));
    on('PATCH', '/api/jobs/{id}', W((c, tx, db) => sv.updateJob(tx, db, c.p.id, c.body, c.today)), S.JobPatch);
    on('DELETE', '/api/jobs/{id}', W((c, tx, db) => { sv.deleteJob(tx, db, c.p.id); return { ok: true }; }));
    on('POST', '/api/jobs/{id}/payments', W((c, tx, db) => sv.addPayment(tx, db, c.p.id, c.body, c.today)), S.Payment);
    on('POST', '/api/jobs/{id}/cancel', W((c, tx, db) => sv.cancelJob(tx, db, c.p.id, c.body, c.today)), S.Cancel);
    on('GET', '/api/receivables', R((c, db) => rp.receivablesReport(db, c.today)));

    // ---------- giao dịch ----------
    on('GET', '/api/transactions', R((c, db) => sv.listTx(db, c.q)));
    on('POST', '/api/transactions', W((c, tx, db) => sv.createTx(tx, db, c.body, c.today)), S.Tx);
    on('GET', '/api/transactions/summary', R(({ q, today }, db) => {
      const group = q.group || 'day';
      if (!['day', 'week', 'month'].includes(group)) throw new AppError(422, 'bad_group', 'group phải là day/week/month');
      const end = q.to || today, start = q.from || fe.addDays(today, -29);
      checkDates(start, end);
      return sv.expenseSummary(db, start, end, group);
    }));
    on('PATCH', '/api/transactions/{id}', W((c, tx, db) => sv.updateTx(tx, db, c.p.id, c.body)), S.TxPatch);
    on('DELETE', '/api/transactions/{id}', W((c, tx, db) => { sv.deleteTx(tx, db, c.p.id); return { ok: true }; }));

    // ---------- lịch ----------
    const range = ({ q, today }) => {
      const [ms, me] = fe.monthBounds(today);
      const s = q.from || ms, e = q.to || me;
      checkDates(s, e);
      return [s, e];
    };
    on('GET', '/api/calendar', R((c, db) => sv.calendarRange(db, ...range(c), c.today)));
    on('GET', '/api/calendar/stats', R((c, db) => sv.workStats(db, ...range(c), c.today)));
    on('POST', '/api/day-offs', W((c, tx, db) => sv.saveDayOff(tx, db, c.body)), S.DayOff);
    on('DELETE', '/api/day-offs/{id}', W((c, tx, db) => { sv.deleteDayOff(tx, db, c.p.id); return { ok: true }; }));

    // ---------- tiết kiệm / khoản phải trả ----------
    on('GET', '/api/goals', R((c, db) => sv.goalsOverview(db, c.today)));
    on('POST', '/api/goals', W((c, tx, db) => ({ id: sv.createGoal(tx, db, c.body, c.today) })), S.Goal);
    on('PATCH', '/api/goals/{id}', W((c, tx, db) => { sv.updateGoal(tx, db, c.p.id, c.body); return { ok: true }; }), S.GoalPatch);
    on('DELETE', '/api/goals/{id}', W((c, tx, db) => { sv.deleteGoal(tx, db, c.p.id); return { ok: true }; }));
    on('POST', '/api/goals/{id}/allocations', W((c, tx, db) => sv.allocate(tx, db, c.p.id, c.body, c.today)), S.Allocation);
    on('DELETE', '/api/allocations/{id}', W((c, tx, db) => { sv.deleteAllocation(tx, db, c.p.id); return { ok: true }; }));
    on('GET', '/api/obligations', R((c, db) => sv.listObligations(db, c.q.all === '1')));
    on('POST', '/api/obligations', W((c, tx, db) => sv.saveObligation(tx, db, c.body)), S.Obligation);
    on('PATCH', '/api/obligations/{id}', W((c, tx, db) => sv.saveObligation(tx, db, c.body, c.p.id)), S.ObligationPatch);
    on('DELETE', '/api/obligations/{id}', W((c, tx, db) => { sv.deleteObligation(tx, db, c.p.id); return { ok: true }; }));
    on('POST', '/api/obligations/{id}/pay', W((c, tx, db) => sv.payObligation(tx, db, c.p.id, c.body, c.today)), S.PayObligation);

    // ---------- nhập file ----------
    on('POST', '/api/import/upload', async ({ body }) => {
      const f = body?.get ? body.get('file') : body?.file;
      if (!f || typeof f === 'string') throw new AppError(422, 'no_file', 'Chưa chọn file.');
      const table = await imp.parseFile(f);
      if (!table.length) throw new AppError(422, 'empty', 'File không có dữ liệu.');
      return { token: imp.storePending(f.name || '', table), header: table[0], preview: table.slice(1, 21), total_rows: table.length - 1,
        columns: Math.max(...table.slice(0, 50).map(r => r.length)), guess: imp.guessMapping(table[0]) };
    });
    on('POST', '/api/import/analyze', async c => imp.analyze(await this.s.refresh(), c.body), S.ImportMap);
    on('POST', '/api/import/commit', c => imp.commit(this.s, c.body), S.ImportMap);
    on('GET', '/api/import/batches', R((c, db) => db.live('import_batches').map(fe.stripPriv)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 50)));
    on('POST', '/api/import/batches/{id}/undo', W((c, tx, db) => imp.undo(tx, db, c.p.id)));

    // ---------- báo cáo / xuất ----------
    const months = ({ q, today }) => {
      if (q.from && q.to) {
        if (!/^\d{4}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}$/.test(q.to)) throw new AppError(422, 'bad_month', 'Tháng phải có dạng YYYY-MM');
        const out = [];
        for (let a = `${q.from}-01`; a <= `${q.to}-01` && out.length < 60; a = fe.addMonths(a, 1)) out.push(a.slice(0, 7));
        return out;
      }
      return rp.monthsBack(today, Math.max(1, Math.min(Number(q.months) || 6, 36)));
    };
    on('GET', '/api/reports/monthly', R((c, db) => {
      const rep = rp.monthlyReport(db, months(c), c.today);
      const tot = {};
      for (const k of ['revenue', 'cash_in', 'expense', 'net_cashflow', 'work_days', 'jobs_done', 'saved']) tot[k] = rep.reduce((a, r) => a + r[k], 0);
      tot.savings_rate = tot.cash_in > 0 ? Math.round(tot.saved / tot.cash_in * 10000) / 10000 : null;
      tot.avg_per_job = tot.jobs_done ? Math.round(tot.revenue / tot.jobs_done) : 0;
      return { months: rep, totals: tot, receivables: rp.receivablesReport(db, c.today).total };
    }));
    on('GET', '/api/export/transactions.csv', R(({ q, today }, db) => ({ __download: {
      filename: `giao-dich-${today}.csv`, mime: 'text/csv;charset=utf-8', content: rp.toCsv(rp.transactionsTable(db, q.from, q.to)) } })));
    on('GET', '/api/export/report.csv', R((c, db) => ({ __download: {
      filename: `bao-cao-${c.today}.csv`, mime: 'text/csv;charset=utf-8', content: rp.toCsv(rp.reportTable(rp.monthlyReport(db, months(c), c.today))) } })));
    on('GET', '/api/export/all.json', R((c, db) => ({ __download: {
      filename: `toan-bo-du-lieu-${c.today}.json`, mime: 'application/json', content: JSON.stringify(rp.exportAll(db), null, 1) } })));

    // ---------- sao lưu (Google Drive) ----------
    on('GET', '/api/backups', async () => (this.backups ? this.backups.list() : []));
    on('POST', '/api/backups', async () => {
      if (!this.backups) throw new AppError(400, 'demo', 'Chế độ dùng thử không có sao lưu.');
      const r = await this.backups.create('thu-cong');
      await this.write((tx, db) => sv.updateSettings(tx, db, { last_backup_at: new Date().toISOString() }));
      return r;
    });
    on('POST', '/api/backups/restore', async ({ body }) => {
      if (!this.backups) throw new AppError(400, 'demo', 'Chế độ dùng thử không có khôi phục.');
      return this.backups.restore(body);
    });
  }
}

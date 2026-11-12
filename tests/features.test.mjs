// Tính năng: danh mục, giao dịch, lịch, tiết kiệm, báo cáo, xuất file, nhập file, ĐỒNG BỘ 2 THIẾT BỊ.
import { test } from 'node:test';
import { assert, makeApp } from './helpers.mjs';
import * as fe from '../js/core/finance.js';
import { parseAmount, parseDate, parseCsv } from '../js/core/importer.js';
import { DataSession, MemoryStore } from '../js/core/store.js';
import { Api } from '../js/core/router.js';

test('danh mục: tạo, trùng tên, sửa, xóa có chuyển giao dịch, không xóa danh mục hệ thống', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const n = await c.post('/api/categories', { name: 'Thuê phụ quay', kind: 'expense', icon: '🎬' });
  await c.post('/api/categories', { name: 'thuê phụ quay', kind: 'expense' }, 409);
  await c.patch(`/api/categories/${n.id}`, { name: 'Thuê phụ quay/trợ lý' });
  const t = await c.post('/api/transactions', { kind: 'expense', amount: 300_000, account_id: cash, category_id: n.id });
  const food = (await c.cat('Ăn uống')).id;
  assert.equal((await c.del(`/api/categories/${n.id}?reassign_to=${food}`)).moved, 1);
  assert.deepEqual((await c.get(`/api/transactions?category_id=${food}`)).items.map(x => x.id), [t.id]);
  await c.del(`/api/categories/${(await c.cat('Khác')).id}`, 409);
});

test('giao dịch: sửa số tiền + đổi tài khoản, tìm kiếm, xóa mềm, có nhật ký', async () => {
  const c = await makeApp();
  const a = await c.accounts();
  let t = await c.post('/api/transactions', { kind: 'expense', amount: 50_000, account_id: a['Tiền mặt'].id, category_id: (await c.cat('Ăn uống')).id, description: 'Phở' });
  t = await c.patch(`/api/transactions/${t.id}`, { amount: 65_000, account_id: a['Ngân hàng'].id });
  assert.equal(t.amount, 65_000);
  const a2 = await c.accounts();
  assert.deepEqual([a2['Tiền mặt'].balance, a2['Ngân hàng'].balance], [0, -65_000]);
  assert.equal((await c.get('/api/transactions?q=phở')).total, 1);
  assert.equal((await c.get(`/api/transactions?from=${c.today}&to=${c.today}&kind=expense`)).total, 1);
  await c.del(`/api/transactions/${t.id}`);
  assert.equal((await c.fc()).balance, 0);
  const data = await c.store.load();
  assert.ok(data.transactions.find(x => x.id === t.id).deleted_at);  // xóa mềm
  assert.ok(data.audit_log.filter(x => x.entity === 'transaction').length >= 3);
});

test('kiểm tra dữ liệu đầu vào', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const r = await c.post('/api/transactions', { kind: 'expense', amount: 0, account_id: cash }, 422);
  assert.ok('amount' in r.error.fields);
  await c.post('/api/transactions', { kind: 'expense', amount: -5, account_id: cash }, 422);
  await c.post('/api/transactions', { kind: 'expense', amount: 10 ** 12, account_id: cash }, 422);
  await c.post('/api/transactions', { kind: 'expense', amount: 1000, account_id: cash, date: '2026-02-30' }, 422);
  await c.post('/api/transactions', { kind: 'expense', amount: 1000, account_id: 'khong-co' }, 404);
  await c.post('/api/transactions', { kind: 'job_payment', amount: 1000, account_id: cash }, 422);
  await c.post('/api/transactions', { kind: 'expense', amount: 1.5, account_id: cash }, 422);
  await c.post('/api/transactions', { kind: 'expense', amount: 1000, account_id: cash, hacker: 1 }, 422);
});

test('tổng hợp chi theo ngày / tháng', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  for (const [i, amt] of [10_000, 20_000, 30_000].entries()) await c.post('/api/transactions', { kind: 'expense', amount: amt, account_id: cash, date: c.day(-i) });
  const days = await c.get(`/api/transactions/summary?group=day&from=${c.day(-5)}&to=${c.today}`);
  assert.equal(days.reduce((a, d) => a + d.total, 0), 60_000); assert.equal(days.length, 3);
  const weeks = await c.get(`/api/transactions/summary?group=week&from=${c.day(-5)}&to=${c.today}`);
  assert.equal(weeks.reduce((a, d) => a + d.total, 0), 60_000);
});

test('tài khoản có lịch sử thì lưu trữ, không xóa mất tiền', async () => {
  const c = await makeApp();
  const a = await c.post('/api/accounts', { name: 'MoMo', kind: 'ewallet', opening_balance: 200_000 });
  assert.equal((await c.accounts()).MoMo.balance, 200_000);
  assert.deepEqual(await c.del(`/api/accounts/${a.id}`), { archived: true });
  assert.equal((await c.fc()).balance, 200_000);
  const b = await c.post('/api/accounts', { name: 'Trống', kind: 'bank' });
  assert.deepEqual(await c.del(`/api/accounts/${b.id}`), { deleted: true });
});

test('show nhiều ngày, trùng giờ, thống kê lịch, sửa lịch, hủy hết trùng, ngày nghỉ', async () => {
  const c = await makeApp();
  const d0 = c.day(3), D = n => fe.addDays(d0, n);
  let j = await c.post('/api/jobs', { title: 'Cưới Hoàng & Mai', client_name: 'Studio X', work_type: 'video', work_date: d0, total_fee: 6_000_000, due_date: D(14),
    sessions: [{ kind: 'shoot', date: d0, start_time: '06:00', end_time: '12:00', location: 'Nhà gái' },
      { kind: 'shoot', date: D(1), start_time: '16:00', end_time: '22:00' }, { kind: 'edit', date: D(4), start_time: '09:00', end_time: '17:00' },
      { kind: 'deadline', date: D(10) }] });
  assert.equal(j.sessions.length, 4);
  const j2 = await c.post('/api/jobs', { title: 'Chụp kỷ yếu', work_type: 'photo', work_date: d0, total_fee: 2_000_000, start_time: '10:00', end_time: '13:00' });
  assert.equal(j2.conflicts.length, 1);
  const cal = await c.get(`/api/calendar?from=${d0}&to=${D(10)}`);
  assert.equal(cal.sessions.length, 5); assert.equal(cal.conflicts.length, 1);
  const st = await c.get(`/api/calendar/stats?from=${d0}&to=${D(10)}`);
  assert.equal(st.work_days, 3); assert.equal(st.hours, 23); assert.equal(st.fee_total, 8_000_000); assert.equal(st.expected_from_booked, 8_000_000);
  const keep = j.sessions.filter(s => s.kind !== 'edit').map(s => ({ id: s.id, kind: s.kind, date: s.date, start_time: s.start_time, end_time: s.end_time }));
  j = await c.patch(`/api/jobs/${j.id}`, { sessions: keep });
  assert.equal(j.sessions.length, 3);
  await c.post(`/api/jobs/${j2.id}/cancel`, { policy: 'keep' });
  assert.deepEqual((await c.get(`/api/calendar?from=${d0}&to=${d0}`)).conflicts, []);
  await c.post('/api/jobs', { title: 'x', work_type: 'photo', work_date: d0, total_fee: 1, start_time: '13:00', end_time: '10:00' }, 422);
  const off = await c.post('/api/day-offs', { date: D(2), note: 'Nghỉ' });
  assert.equal((await c.get(`/api/calendar?from=${d0}&to=${D(5)}`)).day_offs.length, 1);
  await c.del(`/api/day-offs/${off.id}`);
});

test('công nợ quá hạn theo khách', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/jobs', { title: 'Dựng TVC', client_name: 'Chị Lan', work_type: 'edit', work_date: c.day(-20), total_fee: 3_000_000,
    due_date: c.day(-12), work_status: 'done', deposit: 1_000_000, deposit_account_id: cash });
  await c.post('/api/jobs', { title: 'Chụp sản phẩm', client_name: 'chị lan', work_type: 'photo', work_date: c.today, total_fee: 1_500_000 });
  const r = await c.get('/api/receivables');
  assert.equal(r.total, 3_500_000); assert.equal(r.overdue_total, 2_000_000);
  assert.equal(r.clients.length, 1);  // "Chị Lan" và "chị lan" là cùng một khách
  assert.equal(r.clients[0].max_overdue, 12);
  assert.equal(r.clients[0].jobs.find(j => j.title === 'Dựng TVC').payments.length, 1);
});

test('toán mục tiêu tiết kiệm', async () => {
  const p = fe.goalPlan({ target_amount: 400_000_000, saved: 0, monthly_plan: 7_000_000, target_date: '2030-01-15' }, '2026-01-15', 10_000_000);
  assert.deepEqual([p.months_at_plan, p.months_left, p.required_monthly, p.feasibility], [58, 48, 8_333_334, 'tight']);
  assert.equal(fe.feasibility(5, 0), 'not_feasible'); assert.equal(fe.feasibility(11, 10), 'not_feasible'); assert.equal(fe.feasibility(1, 10), 'ok');
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const g = await c.post('/api/goals', { name: 'Máy ảnh', target_amount: 30_000_000, target_date: fe.addMonths(c.today, 10), monthly_plan: 2_000_000 });
  await c.post('/api/transactions', { kind: 'adjustment', amount: 10_000_000, account_id: cash });
  await c.post(`/api/goals/${g.id}/allocations`, { amount: 10_000_000 });
  const goal = (await c.get('/api/goals')).goals[0];
  assert.deepEqual([goal.plan.remaining, goal.plan.months_at_plan, goal.plan.months_left, goal.plan.required_monthly], [20_000_000, 10, 10, 2_000_000]);
  await c.del(`/api/goals/${g.id}`);
  assert.equal((await c.fc()).available, 10_000_000);  // xóa mục tiêu → tiền trở lại khả dụng
});

test('báo cáo tháng và xuất file (chống chèn công thức)', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/jobs', { title: 'Show', work_type: 'video', work_date: c.today, total_fee: 2_000_000, work_status: 'done', deposit: 2_000_000, deposit_account_id: cash });
  await c.post('/api/transactions', { kind: 'expense', amount: 500_000, account_id: cash, description: '=HYPERLINK("http://x")' });
  const g = await c.post('/api/goals', { name: 'Dự phòng', target_amount: 15_000_000, is_emergency: true });
  await c.post(`/api/goals/${g.id}/allocations`, { amount: 300_000 });
  const rep = await c.get('/api/reports/monthly?months=3');
  const m = rep.months.at(-1);
  assert.deepEqual([m.revenue, m.cash_in, m.expense, m.net_cashflow, m.jobs_done, m.work_days, m.saved, m.savings_rate],
    [2_000_000, 2_000_000, 500_000, 1_500_000, 1, 1, 300_000, 0.15]);
  assert.equal(rep.months.length, 3);
  const csv = (await c.get('/api/export/transactions.csv')).__download.content;
  assert.ok(csv.startsWith('﻿')); assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
  const all = JSON.parse((await c.get('/api/export/all.json')).__download.content);
  assert.equal(all.transactions.length, 2); assert.equal(all.goal_allocations.length, 1);
  assert.ok((await c.get('/api/export/report.csv')).__download.content.includes('Doanh thu'));
});

test('bộ đọc số tiền, ngày, CSV', () => {
  assert.equal(parseAmount('1.500.000'), 1_500_000); assert.equal(parseAmount('1,500,000đ'), 1_500_000);
  assert.equal(parseAmount('-45.000'), -45_000); assert.equal(parseAmount('(70,000)'), -70_000);
  assert.equal(parseAmount('45000.0'), 45_000); assert.equal(parseAmount(''), null);
  assert.equal(parseDate('05/11/2026', 'auto'), '2026-11-05'); assert.equal(parseDate('2026-11-05', 'auto'), '2026-11-05');
  assert.equal(parseDate('11/05/2026', 'mdy'), '2026-11-05'); assert.equal(parseDate('31/02/2026', 'auto'), null);
  assert.equal(parseDate('5/11/26', 'auto'), '2026-11-05');
  assert.deepEqual(parseCsv('a;b\r\n"x;y";2\n'), [['a', 'b'], ['x;y', '2']]);
  assert.deepEqual(parseCsv('﻿Ngày,"Nội dung ""đặc biệt"""\n1,2'), [['Ngày', 'Nội dung "đặc biệt"'], ['1', '2']]);
});

test('import từ chối file Excel/khác CSV với hướng dẫn rõ', async () => {
  const c = await makeApp();
  const f = name => ({ get: () => new File(['x'], name) });
  const r = await c.post('/api/import/upload', f('vcb.xlsx'), 415);
  assert.match(r.error.message, /csv/i);
  await c.post('/api/import/upload', f('a.exe'), 415);
});

test('dự báo không chia cho 0 khi chưa có chi tiêu', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'adjustment', amount: 1_000_000, account_id: cash });
  const f = await c.fc();
  assert.equal(f.runway_days, null); assert.equal(f.out_of_money_date, null);
  assert.equal(f.safe_daily, Math.floor(1_000_000 / f.days_left_month));
});

test('ĐỒNG BỘ: máy tính và điện thoại cùng ghi vào một Sheet không làm mất hay nhân đôi dữ liệu', async () => {
  const store = new MemoryStore();
  const pc = await makeApp({ store });
  const phoneSession = new DataSession(store);
  const phone = new Api(phoneSession, { today: () => pc.today });
  const cash = (await pc.accounts())['Tiền mặt'].id;
  // điện thoại tải dữ liệu trước
  await phone.handle('GET', '/api/dashboard');
  // máy tính tạo show có cọc
  const j = await pc.post('/api/jobs', { title: 'Show PC', work_type: 'video', work_date: pc.today, total_fee: 2_000_000, deposit: 500_000, deposit_account_id: cash });
  // điện thoại (đang giữ dữ liệu cũ) ghi nhận khách trả thêm → phải thấy show của máy tính, không đè mất
  const after = await phone.handle('POST', `/api/jobs/${j.id}/payments`, { amount: 700_000, account_id: cash });
  assert.equal(after.received, 1_200_000); assert.equal(after.outstanding, 800_000);
  // điện thoại thêm khoản chi, máy tính sửa tiêu đề show cùng lúc
  await Promise.all([
    phone.handle('POST', '/api/transactions', { kind: 'expense', amount: 100_000, account_id: cash }),
    pc.patch(`/api/jobs/${j.id}`, { title: 'Show PC (đổi tên)' }),
  ]);
  // cả hai thiết bị đọc lại từ Sheet: số liệu giống hệt nhau
  await pc.session.refresh(); await phoneSession.refresh();
  const a = await pc.fc(), b = await phone.handle('GET', '/api/forecast');
  assert.equal(a.balance, 1_100_000); assert.equal(b.balance, 1_100_000);
  assert.equal(a.receivables, 800_000); assert.equal(b.receivables, 800_000);
  const job = await phone.handle('GET', `/api/jobs/${j.id}`);
  assert.equal(job.title, 'Show PC (đổi tên)'); assert.equal(job.payments.length, 2);
  // điện thoại giữ dữ liệu cũ vẫn bị chặn trả quá công nợ (vì luôn tải lại trước khi ghi)
  await assert.rejects(phone.handle('POST', `/api/jobs/${j.id}/payments`, { amount: 800_001, account_id: cash }), e => e.code === 'overpay');
});

test('ghi lỗi giữa chừng thì không có gì được lưu (nguyên khối)', async () => {
  const c = await makeApp();
  const before = JSON.stringify(c.store.sheets);
  // cọc lớn hơn tổng công: bị từ chối sau khi đã tạo khách → không được lưu gì
  await c.post('/api/jobs', { title: 'X', client_name: 'Khách mới', work_type: 'video', work_date: c.today, total_fee: 100, deposit: 200,
    deposit_account_id: (await c.accounts())['Tiền mặt'].id }, 422);
  assert.equal(JSON.stringify(c.store.sheets), before);
  assert.equal((await c.get('/api/clients')).length, 0);
});

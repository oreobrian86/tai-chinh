// 10 kịch bản tiền BẮT BUỘC (mục F của yêu cầu) — chuyển nguyên từ bộ test Python.
import { test } from 'node:test';
import { assert, makeApp } from './helpers.mjs';

async function makeShow(c, { fee = 1_500_000, deposit = 500_000, title = 'Quay sự kiện A', ...kw } = {}) {
  const cash = (await c.accounts())['Tiền mặt'].id;
  return c.post('/api/jobs', { title, client_name: 'Anh Minh', work_type: 'video', work_date: kw.work_date || c.today,
    total_fee: fee, deposit, deposit_account_id: cash, ...kw });
}

test('1-2-3: thanh toán từng đợt làm giảm công nợ đúng', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  let j = await makeShow(c);
  assert.deepEqual([j.total_fee, j.received, j.outstanding, j.pay_status], [1_500_000, 500_000, 1_000_000, 'partial']);
  assert.equal((await c.get('/api/receivables')).total, 1_000_000);
  j = await c.post(`/api/jobs/${j.id}/payments`, { amount: 500_000, account_id: cash });
  assert.deepEqual([j.received, j.outstanding], [1_000_000, 500_000]);
  j = await c.post(`/api/jobs/${j.id}/payments`, { amount: 500_000, account_id: cash });
  assert.deepEqual([j.received, j.outstanding, j.pay_status], [1_500_000, 0, 'paid']);
  assert.equal((await c.get('/api/receivables')).total, 0);
  assert.equal(j.payments.length, 3);
  const r = await c.post(`/api/jobs/${j.id}/payments`, { amount: 1, account_id: cash }, 409);
  assert.equal(r.error.code, 'overpay');
});

test('4: tổng thu nhập và dòng tiền không bị ghi trùng', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const j = await makeShow(c);
  await c.post(`/api/jobs/${j.id}/payments`, { amount: 500_000, account_id: cash });
  await c.post(`/api/jobs/${j.id}/payments`, { amount: 500_000, account_id: cash });
  await c.patch(`/api/jobs/${j.id}`, { work_status: 'done' });
  const d = await c.get('/api/dashboard');
  assert.equal(d.month.income, 1_500_000);
  assert.equal(d.month.revenue, 1_500_000);
  assert.equal(d.forecast.balance, 1_500_000);
  const rep = (await c.get('/api/reports/monthly?months=1')).months[0];
  assert.equal(rep.revenue, 1_500_000); assert.equal(rep.cash_in, 1_500_000);
  // Đối chiếu dữ liệu thật trên "Sheet": đúng 3 giao dịch tiền show, tổng 1.500.000
  const data = await c.store.load();
  const pays = data.transactions.filter(t => t.kind === 'job_payment' && !t.deleted_at);
  const sum = data.transaction_lines.filter(l => !l.deleted_at && pays.some(p => p.id === l.transaction_id)).reduce((a, l) => a + l.amount, 0);
  assert.equal(pays.length, 3); assert.equal(sum, 1_500_000);
});

test('5: chi 100.000 làm tiền khả dụng giảm đúng 100.000', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'adjustment', amount: 5_000_000, account_id: cash });
  const before = (await c.fc()).available;
  await c.post('/api/transactions', { kind: 'expense', amount: 100_000, account_id: cash, category_id: (await c.cat('Ăn uống')).id, description: 'Cơm trưa' });
  const after = await c.fc();
  assert.equal(before - after.available, 100_000);
  assert.equal(after.balance, 4_900_000);
});

test('6: chuyển tiền giữa hai tài khoản không đổi tổng tài sản', async () => {
  const c = await makeApp();
  const acc = await c.accounts();
  await c.post('/api/transactions', { kind: 'adjustment', amount: 3_000_000, account_id: acc['Ngân hàng'].id });
  await c.post('/api/transactions', { kind: 'transfer', amount: 2_000_000, account_id: acc['Ngân hàng'].id, to_account_id: acc['Tiền mặt'].id });
  const a2 = await c.accounts();
  assert.equal((await c.fc()).balance, 3_000_000);
  assert.deepEqual([a2['Ngân hàng'].balance, a2['Tiền mặt'].balance], [1_000_000, 2_000_000]);
  const m = (await c.get('/api/dashboard')).month;
  assert.equal(m.income, 0); assert.equal(m.expense, 0);
  await c.post('/api/transactions', { kind: 'transfer', amount: 1, account_id: acc['Tiền mặt'].id, to_account_id: acc['Tiền mặt'].id }, 422);
  await c.post('/api/transactions', { kind: 'transfer', amount: 500_000, fee: 3_300, account_id: acc['Ngân hàng'].id, to_account_id: acc['Tiền mặt'].id });
  assert.equal((await c.fc()).balance, 3_000_000 - 3_300);
  assert.equal((await c.get('/api/dashboard')).month.expense, 3_300);
});

test('7: phân bổ tiết kiệm không bị tính thành chi tiêu', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'adjustment', amount: 10_000_000, account_id: cash });
  const g = await c.post('/api/goals', { name: 'Mua máy ảnh mới', target_amount: 30_000_000 });
  await c.post(`/api/goals/${g.id}/allocations`, { amount: 3_000_000 });
  let f = await c.fc();
  assert.deepEqual([f.balance, f.reserved_goals, f.available], [10_000_000, 3_000_000, 7_000_000]);
  assert.equal((await c.get('/api/dashboard')).month.expense, 0);
  await c.post(`/api/goals/${g.id}/allocations`, { amount: 7_000_001 }, 409);
  await c.post(`/api/goals/${g.id}/allocations`, { amount: -3_000_001 }, 422);
  await c.post(`/api/goals/${g.id}/allocations`, { amount: -1_000_000 });
  f = await c.fc();
  assert.deepEqual([f.available, f.reserved_goals, f.balance], [8_000_000, 2_000_000, 10_000_000]);
  assert.equal((await c.get('/api/dashboard')).month.income, 0);
});

test('8: hủy show xử lý đúng doanh thu dự kiến và tiền cọc (giữ / hoàn)', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  let a = await makeShow(c, { title: 'Show A' });
  a = await c.post(`/api/jobs/${a.id}/cancel`, { policy: 'keep' });
  assert.deepEqual([a.work_status, a.outstanding, a.revenue, a.expected_revenue], ['cancelled', 0, 500_000, 0]);
  assert.equal((await c.fc()).balance, 500_000);
  let b = await makeShow(c, { title: 'Show B' });
  b = await c.post(`/api/jobs/${b.id}/cancel`, { policy: 'refund', account_id: cash });
  assert.deepEqual([b.outstanding, b.revenue, b.received], [0, 0, 0]);
  assert.equal((await c.fc()).balance, 500_000);
  assert.equal((await c.get('/api/receivables')).total, 0);
  const d = await c.get('/api/dashboard');
  assert.deepEqual([d.month.revenue, d.month.income, d.month.expected_revenue], [500_000, 500_000, 0]);
  await c.post(`/api/jobs/${a.id}/payments`, { amount: 1, account_id: cash }, 409);
  await c.patch(`/api/jobs/${a.id}`, { total_fee: 9 }, 409);
  const s = await makeShow(c, { title: 'Show C' });
  await c.del(`/api/jobs/${s.id}`, 409);
});

function csvFile(text, name = 'sao-ke.csv') {
  return { get: k => (k === 'file' ? new File([text], name, { type: 'text/csv' }) : null) };
}

test('9: giao dịch nhập từ file không bị nhân đôi', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const d1 = c.day(-2).split('-').reverse().join('/'), d2 = c.day(-1).split('-').reverse().join('/');
  const text = `Ngày,Nội dung,Số tiền,Danh mục\n${d1},Cà phê,25.000,"Cà phê, nước uống"\n${d1},Cà phê,25.000,"Cà phê, nước uống"\n${d2},Đổ xăng,"70,000","Đi lại, xăng xe"\nsai-ngay,Lỗi,10.000,\n`;
  const up = await c.post('/api/import/upload', csvFile(text));
  assert.deepEqual([up.guess.date, up.guess.amount, up.guess.description], [0, 2, 1]);
  const req = { token: up.token, mapping: up.guess, account_id: cash, amount_mode: 'expense_positive' };
  const an = await c.post('/api/import/analyze', req);
  assert.deepEqual(an.counts, { ok: 3, error: 1, duplicate: 0, suspect: 0 });
  const res = await c.post('/api/import/commit', req);
  assert.equal(res.imported, 3);
  assert.equal((await c.fc()).balance, -120_000);
  const up2 = await c.post('/api/import/upload', csvFile(text));
  const req2 = { ...req, token: up2.token };
  const an2 = await c.post('/api/import/analyze', req2);
  assert.equal(an2.counts.duplicate, 3); assert.equal(an2.counts.ok, 0);
  assert.equal((await c.post('/api/import/commit', req2)).imported, 0);
  assert.equal((await c.fc()).balance, -120_000);
  await c.post(`/api/import/batches/${res.batch_id}/undo`);
  assert.equal((await c.fc()).balance, 0);
});

test('9b: dòng giống khoản nhập tay được đánh dấu nghi trùng, mặc định bỏ qua', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'expense', amount: 45_000, account_id: cash, date: c.today });
  const text = `date,description,amount\n${c.today},Bún bò,45000\n`;
  let up = await c.post('/api/import/upload', csvFile(text, 'a.csv'));
  let req = { token: up.token, mapping: up.guess, account_id: cash };
  assert.equal((await c.post('/api/import/analyze', req)).counts.suspect, 1);
  assert.equal((await c.post('/api/import/commit', req)).imported, 0);
  up = await c.post('/api/import/upload', csvFile(text, 'a.csv'));
  req = { token: up.token, mapping: up.guess, account_id: cash, include_duplicates: [0] };
  assert.equal((await c.post('/api/import/commit', req)).imported, 1);
});

test('10: dự báo số ngày dùng tiền loại trừ công nợ chưa thu và quỹ dự phòng', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  const start = c.day(-29);
  await c.post('/api/transactions', { kind: 'adjustment', amount: 30_000_000, account_id: cash, date: c.day(-30) });
  for (let i = 0; i < 30; i++) {
    await c.post('/api/transactions', { kind: 'expense', amount: 100_000, account_id: cash, date: c.day(-29 + i) });
  }
  void start;
  await makeShow(c, { fee: 5_000_000, deposit: 0, title: 'Show chưa trả' });
  const g = await c.post('/api/goals', { name: 'Quỹ dự phòng', target_amount: 15_000_000, is_emergency: true });
  await c.post(`/api/goals/${g.id}/allocations`, { amount: 15_000_000 });
  const f = await c.fc();
  assert.equal(f.balance, 27_000_000);
  assert.equal(f.receivables, 5_000_000);
  assert.equal(f.emergency_fund, 15_000_000);
  assert.equal(f.available, 12_000_000);
  assert.equal(f.avg_daily_30, 100_000);
  assert.equal(f.runway_days, 120);
  assert.equal(f.insufficient_data, false);
  assert.equal(f.out_of_money_date, c.day(120));
});

test('10b: lịch sử ít thì báo chưa đủ dữ liệu', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'adjustment', amount: 1_000_000, account_id: cash });
  await c.post('/api/transactions', { kind: 'expense', amount: 50_000, account_id: cash });
  assert.equal((await c.fc()).insufficient_data, true);
  assert.ok((await c.get('/api/dashboard')).warnings.some(w => w.text.includes('chưa chính xác')));
});

test('khoản phải trả chỉ trừ vào tiền khả dụng một lần', async () => {
  const c = await makeApp();
  const cash = (await c.accounts())['Tiền mặt'].id;
  await c.post('/api/transactions', { kind: 'adjustment', amount: 10_000_000, account_id: cash });
  const o = await c.post('/api/obligations', { name: 'Tiền nhà', amount: 4_000_000, due_date: c.today, recurrence: 'monthly' });
  assert.equal((await c.fc()).available, 6_000_000);
  const r = await c.post(`/api/obligations/${o.id}/pay`, { account_id: cash });
  const f = await c.fc();
  assert.deepEqual([f.balance, f.available], [6_000_000, 6_000_000]);
  const next = (await c.get('/api/obligations')).find(x => x.id === r.next_id);
  assert.ok(next.due_date > c.today);
  await c.post(`/api/obligations/${o.id}/pay`, { account_id: cash }, 409);
});

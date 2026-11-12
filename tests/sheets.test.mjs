// Kiểm tra lớp Google Sheets (SheetsStore) trên API giả lập: tạo file, ghi/đọc đúng ô, đồng bộ 2 thiết bị,
// nâng cấp cột mới, sao lưu, khôi phục, phiên hết hạn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';
import { DataSession, SheetsStore } from '../js/core/store.js';
import { Api } from '../js/core/router.js';
import { SCHEMA } from '../js/core/db.js';
import { Backups } from '../js/core/backups.js';

const TODAY = '2026-11-12';

async function device(g, token = 'tok') {
  const store = new SheetsStore(async () => token, g.fetch);
  await store.open();
  const session = new DataSession(store);
  const api = new Api(session, { today: () => TODAY, backups: new Backups(store, session) });
  return { store, session, api, call: (m, p, b) => api.handle(m, p, b) };
}

test('lần đầu tạo đúng 1 file, thiết bị thứ hai tìm thấy file đó (không tạo trùng)', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const phone = await device(g);
  assert.equal(g.files.size, 1);
  assert.equal(phone.store.id, pc.store.id);
  const accs = await phone.call('GET', '/api/accounts');
  assert.deepEqual(accs.map(a => a.name), ['Tiền mặt', 'Ngân hàng']);
  // tiêu đề cột được ghi đúng
  const f = g.files.get(pc.store.id);
  assert.deepEqual(f.sheets.get('transactions').grid[0], SCHEMA.transactions);
});

test('ghi qua Sheets: số tiền là số, chuỗi "=..." vẫn là chữ, sửa đúng dòng', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  const t = await pc.call('POST', '/api/transactions', { kind: 'expense', amount: 45_000, account_id: cash, description: '=SUM(A1:A9)' });
  await pc.call('PATCH', `/api/transactions/${t.id}`, { amount: 55_000 });
  const grid = g.files.get(pc.store.id).sheets.get('transactions').grid;
  const head = grid[0], row = grid.find(r => r[0] === t.id);
  assert.equal(row[head.indexOf('description')], '=SUM(A1:A9)');
  assert.equal(row[head.indexOf('version')], 2);
  const lines = g.files.get(pc.store.id).sheets.get('transaction_lines').grid;
  const lh = lines[0];
  const live = lines.slice(1).filter(r => r[lh.indexOf('transaction_id')] === t.id && !r[lh.indexOf('deleted_at')]);
  assert.equal(live.length, 1);
  assert.equal(live[0][lh.indexOf('amount')], -55_000);
  assert.equal(typeof live[0][lh.indexOf('amount')], 'number');
  // mọi lệnh ghi đều gửi bằng batchUpdate nguyên khối
  assert.ok(g.calls.filter(c => c.method === 'POST' && c.url.includes(':batchUpdate')).every(c => c.body.requests.length));
});

test('đồng bộ 2 thiết bị qua Sheets: cùng ghi, không mất, không nhân đôi', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const phone = await device(g);
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  await phone.call('GET', '/api/dashboard');
  const j = await pc.call('POST', '/api/jobs', { title: 'Show', work_type: 'video', work_date: TODAY, total_fee: 2_000_000, deposit: 500_000, deposit_account_id: cash });
  const p = await phone.call('POST', `/api/jobs/${j.id}/payments`, { amount: 700_000, account_id: cash });
  assert.equal(p.outstanding, 800_000);
  await Promise.all([
    phone.call('POST', '/api/transactions', { kind: 'expense', amount: 100_000, account_id: cash }),
    pc.call('PATCH', `/api/jobs/${j.id}`, { title: 'Show (đổi tên)' }),
    pc.call('POST', '/api/transactions', { kind: 'expense', amount: 50_000, account_id: cash }),
  ]);
  await pc.session.refresh(); await phone.session.refresh();
  for (const d of [pc, phone]) {
    const f = await d.call('GET', '/api/forecast');
    assert.equal(f.balance, 1_050_000);
    assert.equal(f.receivables, 800_000);
    assert.equal((await d.call('GET', `/api/jobs/${j.id}`)).title, 'Show (đổi tên)');
  }
  // sửa 1 dòng sau nhiều lần ghi xen kẽ: vẫn sửa đúng dòng
  const tx = (await phone.call('GET', '/api/transactions?kind=expense')).items.find(t => t.amount === 50_000);
  await phone.call('PATCH', `/api/transactions/${tx.id}`, { amount: 60_000 });
  await pc.session.refresh();
  assert.equal((await pc.call('GET', '/api/forecast')).balance, 1_040_000);
});

test('nâng cấp: Sheet cũ thiếu cột mới thì tự thêm cột, không mất dữ liệu', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const f = g.files.get(pc.store.id);
  // giả sử bản cũ chưa có cột "note" ở bảng clients
  const sh = f.sheets.get('clients');
  sh.grid[0] = SCHEMA.clients.filter(c => c !== 'note');
  const again = await device(g);
  assert.ok(f.sheets.get('clients').grid[0].includes('note'));
  await again.call('POST', '/api/clients', { name: 'Anh Minh', note: 'khách quen' });
  await again.session.refresh();
  assert.equal((await again.call('GET', '/api/clients'))[0].note, 'khách quen');
});

test('sao lưu ra file riêng trên Drive, khôi phục từ bản sao lưu', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  await pc.call('POST', '/api/transactions', { kind: 'adjustment', amount: 1_000_000, account_id: cash });
  const b = await pc.call('POST', '/api/backups');
  await pc.call('POST', '/api/transactions', { kind: 'expense', amount: 999_000, account_id: cash });
  assert.equal((await pc.call('GET', '/api/forecast')).balance, 1_000);
  const list = await pc.call('GET', '/api/backups');
  assert.ok(list.some(x => x.id === b.id));
  const r = await pc.call('POST', '/api/backups/restore', { backup_id: b.id });
  assert.ok(r.safety_backup);
  assert.equal((await pc.call('GET', '/api/forecast')).balance, 1_000_000);
  const phone = await device(g);
  assert.equal((await phone.call('GET', '/api/forecast')).balance, 1_000_000);
});

test('khôi phục từ file JSON đã xuất', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  await pc.call('POST', '/api/transactions', { kind: 'adjustment', amount: 2_000_000, account_id: cash });
  const json = (await pc.call('GET', '/api/export/all.json')).__download.content;
  await pc.call('POST', '/api/transactions', { kind: 'expense', amount: 500_000, account_id: cash });
  await pc.call('POST', '/api/backups/restore', { json });
  assert.equal((await pc.call('GET', '/api/forecast')).balance, 2_000_000);
  await assert.rejects(pc.call('POST', '/api/backups/restore', { json: '{"format":"khac"}' }), e => e.status === 422);
});

test('phiên Google hết hạn → báo lỗi rõ ràng, không ghi dở', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  pc.store.getToken = async () => 'het-han';
  await assert.rejects(pc.call('POST', '/api/transactions', { kind: 'expense', amount: 1, account_id: cash }), e => e.code === 'google_auth');
  pc.store.getToken = async () => 'tok';
  assert.equal((await pc.call('GET', '/api/forecast')).balance, 0);
});

test('một lệnh ghi bị Google từ chối thì không ô nào bị ghi', async () => {
  const g = fakeGoogle();
  const pc = await device(g);
  await pc.call('POST', '/api/setup');
  const before = JSON.stringify([...g.files.get(pc.store.id).sheets.entries()]);
  const bad = { appendCells: { sheetId: 999999, rows: [], fields: 'userEnteredValue' } };
  const realReq = pc.store.req.bind(pc.store);
  pc.store.req = (url, o) => (url.includes(':batchUpdate') ? realReq(url, { ...o, body: { requests: [...o.body.requests, bad] } }) : realReq(url, o));
  const cash = (await pc.call('GET', '/api/accounts'))[0].id;
  await assert.rejects(pc.call('POST', '/api/transactions', { kind: 'adjustment', amount: 5, account_id: cash }));
  assert.equal(JSON.stringify([...g.files.get(pc.store.id).sheets.entries()]), before);
});

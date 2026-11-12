// Dữ liệu mẫu cho chế độ dùng thử (?demo). Không bao giờ ghi lên Google.
import { get, post } from './api.js';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

export async function seedDemo() {
  const accs = Object.fromEntries((await get('/api/accounts')).map(a => [a.name, a.id]));
  const cats = Object.fromEntries((await get('/api/categories')).map(c => [c.name, c.id]));
  const cash = accs['Tiền mặt'], bank = accs['Ngân hàng'];
  await post('/api/transactions', { kind: 'adjustment', amount: 3_500_000, account_id: cash, date: day(-120) });
  await post('/api/transactions', { kind: 'adjustment', amount: 21_000_000, account_id: bank, date: day(-120) });
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const plan = [['Ăn uống', 35, 90], ['Cà phê, nước uống', 25, 55], ['Đi lại, xăng xe', 50, 80]];
  for (let i = 0; i < 100; i++) {
    for (const [name, lo, hi] of plan) {
      if (rnd() < 0.55) await post('/api/transactions', { kind: 'expense', amount: (lo + Math.floor(rnd() * (hi - lo) / 5) * 5) * 1000,
        account_id: cash, category_id: cats[name], date: day(-i), description: name });
    }
  }
  await post('/api/transactions', { kind: 'expense', amount: 1_290_000, account_id: bank, category_id: cats['Phần mềm, dịch vụ'], date: day(-9), description: 'Adobe Premiere năm' });
  await post('/api/transactions', { kind: 'expense', amount: 4_800_000, account_id: bank, category_id: cats['Thiết bị quay, chụp'], date: day(-40), description: 'Gimbal mới', is_one_off: true });
  const jobs = [['Quay cưới Hoàng & Mai', 'Studio Mây', 'video', -50, 6_000_000, 6_000_000, 'done', -36],
    ['Chụp kỷ yếu THPT Lê Lợi', 'Chị Lan', 'photo', -32, 3_500_000, 1_500_000, 'done', -12],
    ['Dựng TVC quán cà phê', 'Anh Minh', 'edit', -15, 4_000_000, 1_000_000, 'done', 5],
    ['Quay sự kiện ra mắt sản phẩm', 'Anh Minh', 'video', 4, 2_500_000, 500_000, 'booked', 18],
    ['Chụp sản phẩm mỹ phẩm', 'Studio Mây', 'photo', 9, 1_800_000, 0, 'booked', 25]];
  for (const [title, client, wt, off, fee, dep, st, due] of jobs) {
    await post('/api/jobs', { title, client_name: client, work_type: wt, work_date: day(off), total_fee: fee, deposit: dep, deposit_account_id: bank,
      deposit_date: day(off), work_status: st, due_date: day(due), start_time: '08:00', end_time: '12:00' });
  }
  for (let m = 1; m <= 3; m++) {
    await post('/api/jobs', { title: `Show tháng trước ${m}`, client_name: 'Studio Mây', work_type: 'video', work_date: day(-(30 * m + 5)),
      total_fee: 3_000_000 + m * 500_000, deposit: 3_000_000 + m * 500_000, deposit_account_id: bank, deposit_date: day(-(30 * m + 5)), work_status: 'done' });
  }
  let g = await post('/api/goals', { name: 'Quỹ dự phòng', target_amount: 15_000_000, is_emergency: true, monthly_plan: 1_000_000 });
  await post(`/api/goals/${g.id}/allocations`, { amount: 6_000_000 });
  g = await post('/api/goals', { name: 'Mua máy ảnh mới', target_amount: 30_000_000, target_date: day(330), monthly_plan: 2_000_000 });
  await post(`/api/goals/${g.id}/allocations`, { amount: 4_000_000 });
  await post('/api/obligations', { name: 'Tiền nhà', amount: 3_000_000, due_date: day(6), recurrence: 'monthly' });
}

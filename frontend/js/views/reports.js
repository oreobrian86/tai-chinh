import { download, get } from '../api.js';
import { C, groupedBars } from '../charts.js';
import { toastErr } from '../ui.js';
import { h, money, monthLabel, monthShort, on, short, today } from '../util.js';

let months = 6;
let compare = null; // [thángA, thángB]

const pctTxt = v => (v === null || v === undefined ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%');

export async function reportsView(root) {
  const rep = await get('/api/reports/monthly?months=' + months);
  const ms = rep.months;
  compare ||= [ms[ms.length - 2]?.month, ms[ms.length - 1]?.month];
  const A = ms.find(m => m.month === compare[0]) || ms[0], B = ms.find(m => m.month === compare[1]) || ms[ms.length - 1];
  const rows = [
    ['Doanh thu show đã làm', 'revenue'], ['Tiền thực về', 'cash_in'], ['Chi tiêu', 'expense'], ['Dòng tiền ròng (lợi nhuận thực tế)', 'net_cashflow'],
    ['Công nợ phát sinh từ tháng', 'receivable_from_month'], ['Số ngày làm việc', 'work_days', 'n'], ['Show hoàn thành', 'jobs_done', 'n'],
    ['Thu nhập trung bình mỗi show', 'avg_per_job'], ['Chi tiêu trung bình mỗi ngày', 'avg_daily_expense'], ['Đã để dành', 'saved'], ['Tỷ lệ tiết kiệm', 'savings_rate', 'p'],
  ];
  const fmt = (v, t) => t === 'n' ? v : t === 'p' ? pctTxt(v) : money(v);
  const diff = (a, b, k, t) => {
    if (t === 'p') return a === null || b === null ? '' : ((b - a) * 100).toFixed(1).replace('.', ',') + ' điểm';
    const d = b - a;
    if (!d) return '<span class="faint">Không đổi</span>';
    const good = k === 'expense' || k === 'avg_daily_expense' || k === 'receivable_from_month' ? d < 0 : d > 0;
    return `<span class="${good ? 'pos' : 'neg'}">${d > 0 ? '+' : '−'}${t === 'n' ? Math.abs(d) : short(Math.abs(d))}</span>`;
  };
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Báo cáo</h1><p class="muted">Doanh thu tính theo ngày làm show. Tiền về tính theo ngày nhận tiền. Hai con số này không cộng vào nhau.</p></div>
      <div class="row wrap"><button class="btn" data-x="xlsx">Xuất Excel</button><button class="btn" data-x="csv">Xuất CSV giao dịch</button></div></div>
    <div class="row wrap"><div class="seg">${[3, 6, 12].map(n => `<button data-m="${n}" aria-pressed="${months === n}">${n} tháng</button>`).join('')}</div></div>
    <div class="figures mt">
      <div class="fig"><div class="k">Doanh thu ${months} tháng</div><div class="v">${money(rep.totals.revenue)}</div><div class="n">${rep.totals.jobs_done} show, TB ${short(rep.totals.avg_per_job)}/show</div></div>
      <div class="fig"><div class="k">Tiền thực về</div><div class="v pos">${money(rep.totals.cash_in)}</div><div class="n">&nbsp;</div></div>
      <div class="fig"><div class="k">Chi tiêu</div><div class="v">${money(rep.totals.expense)}</div><div class="n">${rep.totals.work_days} ngày đi làm</div></div>
      <div class="fig"><div class="k">Dòng tiền ròng</div><div class="v ${rep.totals.net_cashflow < 0 ? 'neg' : ''}">${money(rep.totals.net_cashflow)}</div><div class="n">Tỷ lệ tiết kiệm ${pctTxt(rep.totals.savings_rate)}</div></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Doanh thu, tiền về và chi tiêu</h2>
        <div class="legend"><span><i class="dot" data-bg="${C.revenue}"></i>Doanh thu</span><span><i class="dot" data-bg="${C.income}"></i>Tiền về</span><span><i class="dot" data-bg="${C.expense}"></i>Chi tiêu</span></div></div>
      ${groupedBars({ labels: ms.map(m => monthShort(m.month)), height: 240, series: [
        { name: 'Doanh thu', color: C.revenue, values: ms.map(m => m.revenue) },
        { name: 'Tiền về', color: C.income, values: ms.map(m => m.cash_in) },
        { name: 'Chi tiêu', color: C.expense, values: ms.map(m => m.expense) }] })}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Từng tháng</h2></div>
      <div class="table-wrap"><table class="t"><thead><tr><th></th>${ms.map(m => `<th class="r">${h(monthShort(m.month))}/${m.month.slice(2, 4)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([l, k, t]) => `<tr><td>${h(l)}</td>${ms.map(m => `<td class="r">${fmt(m[k], t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>So sánh hai tháng</h2>
        <div class="row"><select class="input w-auto" data-c="0" aria-label="Tháng thứ nhất">${ms.map(m => `<option value="${m.month}"${m.month === A.month ? ' selected' : ''}>${h(monthLabel(m.month))}</option>`).join('')}</select>
        <span class="faint">với</span><select class="input w-auto" data-c="1" aria-label="Tháng thứ hai">${ms.map(m => `<option value="${m.month}"${m.month === B.month ? ' selected' : ''}>${h(monthLabel(m.month))}</option>`).join('')}</select></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th></th><th class="r">${h(monthLabel(A.month))}</th><th class="r">${h(monthLabel(B.month))}</th><th class="r">Thay đổi</th></tr></thead>
        <tbody>${rows.map(([l, k, t]) => `<tr><td>${h(l)}</td><td class="r">${fmt(A[k], t)}</td><td class="r">${fmt(B[k], t)}</td><td class="r">${diff(A[k], B[k], k, t)}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <p class="small faint">Công nợ hiện tại: ${money(rep.receivables)}. Xem chi tiết ở trang Công nợ cần thu.</p>
  </div>`;
  on(root, 'click', '[data-m]', (e, b) => { months = Number(b.dataset.m); compare = null; reportsView(root); });
  root.querySelectorAll('[data-c]').forEach(s => s.addEventListener('change', () => { compare[Number(s.dataset.c)] = s.value; reportsView(root); }));
  on(root, 'click', '[data-x]', async (e, b) => {
    try {
      if (b.dataset.x === 'xlsx') await download('/api/export/report.xlsx?months=' + months, 'bao-cao.xlsx');
      else await download('/api/export/transactions.csv', 'giao-dich.csv');
    } catch (err) { toastErr(err); }
  });
}

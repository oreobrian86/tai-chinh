import { get } from '../api.js';
import { C, groupedBars, lineChart } from '../charts.js';
import { openPaymentForm } from '../forms.js';
import { empty } from '../ui.js';
import { addDays, daysBetween, dm, h, money, monthShort, niceDate, privacy, SESSION_KINDS, short, WORK_TYPES } from '../util.js';
import { icon } from '../ui.js';

const WINDOW = 60; // số ngày hiển thị trên thanh đường chạy tiền

function runway(f, d) {
  const t = d.today;
  const days = f.runway_days;
  const pct = x => (Math.max(0, Math.min(WINDOW, x)) / WINDOW) * 100;
  const clipCls = f.available <= 0 ? 'empty' : days !== null && days < 14 ? 'short' : '';
  const clipW = f.available <= 0 ? 1.2 : days === null ? 100 : pct(days);
  const marks = [];
  for (const o of f.obligations || []) {
    const x = daysBetween(t, o.due_date);
    if (x <= WINDOW) marks.push(`<i class="runway-mark obl" data-left="${pct(Math.max(0, x))}" title="${h(o.name)}: ${h(money(o.amount))} (${h(dm(o.due_date))})"></i>`);
  }
  for (const r of d.receivable_marks || []) {
    const x = daysBetween(t, r.date);
    if (x >= 0 && x <= WINDOW) marks.push(`<i class="runway-mark rec" data-left="${pct(x)}" title="Khách hẹn trả ${h(money(r.amount))}"></i>`);
  }
  const eom = daysBetween(t, f.month_end);
  marks.push(`<i class="runway-mark eom" data-left="${pct(eom + 1)}" title="Cuối tháng"></i>`);
  let headline;
  if (f.history_days === 0 && f.balance === 0) headline = `Bắt đầu bằng cách nhập số dư hiện có của từng tài khoản trong <a href="#/settings">Cài đặt</a>, rồi ghi các khoản chi hằng ngày.`;
  else if (f.available <= 0) headline = `Tiền khả dụng đã hết. Hãy xem lại các khoản đã dành và khoản phải trả.`;
  else if (days === null) headline = `Chưa có khoản chi nào để ước tính số ngày đủ dùng.`;
  else headline = `Với mức chi ${short(f.avg_daily_used)}/ngày, tiền đủ dùng <b>${days} ngày</b>, đến <b>${niceDate(f.out_of_money_date).toLowerCase()}</b>${days > WINDOW ? '' : ''}.`;
  return `<div class="runway" aria-label="Đường chạy tiền">
      <p class="hero-sub">${headline}${f.insufficient_data && days !== null && f.available > 0 ? ' <span class="chip amber">Dữ liệu còn ít</span>' : ''}</p>
      <div class="runway-track" role="img" aria-label="${days === null ? 'Chưa ước tính được' : `Đủ dùng ${days} ngày`}">
        <div class="runway-clip ${clipCls}" data-w="${clipW}"></div>${marks.join('')}<i class="runway-head"></i>
      </div>
      <div class="runway-scale"><span>Hôm nay</span><span>+15 ngày</span><span>+30 ngày</span><span>+45 ngày</span><span>+60 ngày</span></div>
      <div class="runway-legend"><span><i class="l-run"></i>Số ngày tiền còn đủ dùng</span><span><i class="l-obl"></i>Khoản phải trả</span><span><i class="l-rec"></i>Khách hẹn trả</span></div>
    </div>`;
}

export async function dashboardView(root) {
  const [d, rec] = await Promise.all([get('/api/dashboard'), get('/api/receivables')]);
  d.receivable_marks = rec.clients.flatMap(c => c.jobs.filter(j => j.due_date).map(j => ({ date: j.due_date, amount: j.outstanding })));
  const f = d.forecast, m = d.month;
  const series = d.series;
  const cats = d.expense_by_category;
  const catMax = Math.max(1, ...cats.map(c => c.total));
  const types = Object.entries(d.revenue_by_type).sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(1, ...types.map(t => t[1]));
  const DOWL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const td = new Date(d.today + 'T00:00:00');
  const hello = `${DOWL[td.getDay()]}, ${d.today.slice(8)}/${d.today.slice(5, 7)}/${d.today.slice(0, 4)}`;

  root.innerHTML = `<div class="page">
    <section class="hero">
      <div class="row wrap"><span class="hero-label">Có thể tiêu</span>
        <button class="btn ghost icon-btn eye-btn" data-eye aria-label="Ẩn hoặc hiện số tiền"></button>
        <span class="spacer"></span><span class="faint small">${h(hello)}</span></div>
      <div class="hero-amount${f.available < 0 ? ' neg' : ''}">${money(f.available, { unit: false })}<span class="cur">đ</span></div>
      <p class="hero-sub">Mỗi ngày nên tiêu tối đa <b>${money(f.safe_daily)}</b> đến hết tháng (còn ${f.days_left_month} ngày). Tuần này còn <b>${money(f.weekly_allowance)}</b>.</p>
      ${runway(f, d)}
    </section>

    ${d.warnings.map(w => `<div class="notice ${w.level === 'danger' ? 'danger' : w.level === 'warn' ? 'warn' : ''}">${h(privacy.on ? w.text.replace(/[\d.]+đ/g, '••••••đ') : w.text)}</div>`).join('')}

    <div class="figures">
      <div class="fig"><div class="k">Số dư thực có</div><div class="v">${money(f.balance)}</div><div class="n">${d.accounts.filter(a => !a.archived).length} tài khoản</div></div>
      <div class="fig"><div class="k">Khách còn nợ</div><div class="v">${money(f.receivables)}</div><div class="n">Chưa tính vào tiền có thể tiêu</div></div>
      <div class="fig"><div class="k">Đang dành tiết kiệm</div><div class="v">${money(f.reserved_goals + f.emergency_fund)}</div><div class="n">${f.emergency_fund ? `Dự phòng ${short(f.emergency_fund)}` : 'Mục tiêu và quỹ dự phòng'}</div></div>
      <div class="fig"><div class="k">Sắp phải trả</div><div class="v">${money(f.obligations_due)}</div><div class="n">Đến ${h(dm(f.obligations_until))}</div></div>
    </div>

    <div class="grid g2">
      <section class="panel">
        <div class="panel-head"><h2>Tháng này</h2><a class="btn sm ghost" href="#/reports">Báo cáo</a></div>
        <div class="stats">
          <div class="stat"><div class="k">Tiền thu về</div><div class="stat-v pos">${money(m.income)}</div><div class="n">Tiền công ${short(m.job_cash)}${m.other_income ? `, thu khác ${short(m.other_income)}` : ''}</div></div>
          <div class="stat"><div class="k">Tiền đã chi</div><div class="stat-v">${money(m.expense)}</div><div class="n">${m.expense_count} khoản chi</div></div>
          <div class="stat"><div class="k">Doanh thu show đã làm</div><div class="stat-v">${money(m.revenue)}</div><div class="n">Tính theo ngày làm, kể cả chưa thu</div></div>
          <div class="stat"><div class="k">Show đã nhận, chưa làm</div><div class="stat-v">${money(m.expected_revenue)}</div><div class="n">Doanh thu dự kiến</div></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Tình hình sử dụng tiền</h2></div>
        <div class="stats">
          <div class="stat"><div class="k">Trung bình mỗi ngày</div><div class="stat-v">${money(f.avg_daily_30)}</div><div class="n">30 ngày gần nhất. 90 ngày: ${short(f.avg_daily_90)}</div></div>
          <div class="stat"><div class="k">Trung bình mỗi tháng</div><div class="stat-v">${f.avg_monthly_3m !== null ? money(f.avg_monthly_3m) : '—'}</div><div class="n">${f.avg_monthly_3m !== null ? `${f.months_in_3m_avg} tháng gần nhất` : 'Chưa có tháng nào trọn vẹn'}</div></div>
          <div class="stat"><div class="k">Số dư cuối tháng dự kiến</div><div class="stat-v">${money(f.projected_eom_balance)}</div><div class="n">Nếu khách trả đúng hẹn: ${short(f.projected_eom_optimistic)}</div></div>
          <div class="stat"><div class="k">Đã chi hôm nay</div><div class="stat-v">${money(f.spent_today)}</div><div class="n">Tuần này: ${short(f.spent_this_week)}</div></div>
        </div>
        ${f.insufficient_data ? `<p class="small faint">Dữ liệu chi tiêu chưa đủ 14 ngày hoặc 10 khoản chi nên các con số dự báo chỉ mang tính tham khảo.</p>` : ''}
      </section>
    </div>

    <div class="grid g2" id="charts">
      <section class="panel">
        <div class="panel-head"><h2>Thu và chi 6 tháng</h2>
          <div class="legend"><span><i class="dot" data-bg="${C.income}"></i>Tiền về</span><span><i class="dot" data-bg="${C.expense}"></i>Chi tiêu</span></div></div>
        ${groupedBars({ labels: series.map(s => monthShort(s.month)), series: [
          { name: 'Tiền về', color: C.income, values: series.map(s => s.income) },
          { name: 'Chi tiêu', color: C.expense, values: series.map(s => s.expense) }] })}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Xu hướng chi tiêu</h2></div>
        ${lineChart({ labels: series.map(s => monthShort(s.month)), values: series.map(s => s.expense), avgLabel: 'TB' })}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Chi theo danh mục</h2><span class="faint small">Tháng này</span></div>
        ${cats.length ? cats.slice(0, 8).map(c => `<div class="hbar"><span>${h(c.icon || '')} ${h(c.name)}</span>
          <div class="bar mist"><i data-w="${(c.total / catMax) * 100}"></i></div><span class="num">${short(c.total)}</span></div>`).join('')
          : empty('🧾', 'Chưa có khoản chi nào trong tháng.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Thu nhập theo loại việc</h2><span class="faint small">6 tháng</span></div>
        ${types.length ? types.map(([k, v]) => `<div class="hbar"><span>${h(WORK_TYPES[k] || k)}</span>
          <div class="bar"><i data-w="${(v / typeMax) * 100}"></i></div><span class="num">${short(v)}</span></div>`).join('')
          : empty('🎬', 'Chưa có show nào hoàn thành.')}
      </section>
    </div>

    <div class="grid g2">
      <section class="panel">
        <div class="panel-head"><h2>Lịch 2 tuần tới</h2><a class="btn sm ghost" href="#/calendar">Xem lịch</a></div>
        ${d.upcoming.length ? `<div class="list">${d.upcoming.map(s => `<a class="item" href="#/job/${h(s.job_id)}">
            <span class="ic">${s.kind === 'deadline' ? '⚑' : s.kind === 'edit' ? '✂️' : s.kind === 'photo' ? '📷' : '🎥'}</span>
            <span><div class="t">${h(s.title)}</div><div class="s">${h(SESSION_KINDS[s.kind])}${s.start_time ? `, ${h(s.start_time)}–${h(s.end_time || '')}` : ''}${s.client_name ? `, ${h(s.client_name)}` : ''}</div></span>
            <span class="v small">${h(niceDate(s.date))}</span></a>`).join('')}</div>`
          : empty('🗓', 'Chưa có lịch làm việc sắp tới.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Khách đang nợ</h2><a class="btn sm ghost" href="#/income/receivables">Công nợ</a></div>
        ${d.receivables.top.length ? `<div class="list">${d.receivables.top.map(c => `<a class="item" href="#/income/receivables">
            <span class="ic">👤</span><span><div class="t">${h(c.client_name)}</div>
            <div class="s">${c.max_overdue ? `Quá hạn ${c.max_overdue} ngày` : 'Chưa đến hạn'}</div></span>
            <span class="v">${money(c.total)}</span></a>`).join('')}</div>
            <button class="btn block" data-pay>Ghi nhận tiền khách trả</button>`
          : empty('✅', 'Không ai nợ tiền bạn.')}
      </section>
    </div>
  </div>`;
  root.querySelector('[data-pay]')?.addEventListener('click', () => openPaymentForm(null));
}

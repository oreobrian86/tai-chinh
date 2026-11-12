import { del, get, post } from '../api.js';
import { openCancelForm, openJobForm, openPaymentForm, openTxEditor } from '../forms.js';
import { confirmDialog, empty, icon, options, sheet, toast, toastErr } from '../ui.js';
import {
  $, dmy, h, JOB_STATUS, money, monthEnd, monthStart, niceDate, on, payChip, SESSION_KINDS, short, today, WORK_ICONS, WORK_TYPES,
} from '../util.js';
import { renderMoneyForm } from '../forms.js';
import { changed } from '../state.js';

const tabs = active => `<div class="seg" role="tablist">
  <a class="btn sm ${active === 'jobs' ? '' : 'ghost'}" href="#/income" aria-pressed="${active === 'jobs'}">Show và dự án</a>
  <a class="btn sm ${active === 'rec' ? '' : 'ghost'}" href="#/income/receivables">Công nợ cần thu</a>
  <a class="btn sm ${active === 'other' ? '' : 'ghost'}" href="#/income/other">Thu khác</a></div>`;

const jobItem = j => `<a class="item" href="#/job/${h(j.id)}">
  <span class="ic">${WORK_ICONS[j.work_type] || '•'}</span>
  <span><div class="t">${h(j.title)}</div>
    <div class="s">${h(niceDate(j.work_date))}${j.client_name ? `, ${h(j.client_name)}` : ''}</div></span>
  <span class="v">${money(j.work_status === 'cancelled' ? j.revenue : j.total_fee)}<small>${payChip(j)}</small></span></a>`;

let filter = { month: today().slice(0, 7), status: '', q: '' };

export async function incomeView(root, params) {
  let sub = params[0] || 'jobs';
  if (sub === 'draft') { filter = { month: '', status: '', q: '', draft: true }; sub = 'jobs'; params = []; }
  if (sub === 'receivables') return receivablesView(root);
  if (sub === 'other') return otherIncomeView(root);
  const qs = new URLSearchParams();
  if (filter.month) { qs.set('from', filter.month + '-01'); qs.set('to', monthEnd(filter.month + '-01')); }
  if (filter.status) qs.set('status', filter.status);
  if (filter.q) qs.set('q', filter.q);
  if (filter.draft) qs.set('draft', '1');
  const data = await get('/api/jobs?' + qs);
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Thu nhập</h1><p class="muted">Mỗi show ghi một lần. Tiền khách trả từng đợt chỉ làm giảm công nợ.</p></div>
      <button class="btn primary" data-new>${icon('plus')}Show mới</button></div>
    <div class="row wrap">${tabs('jobs')}</div>
    ${filter.draft ? `<div class="notice warn mt">Đang xem show nháp lấy từ Google Calendar. Mở từng show để điền khách và tiền công.</div>` : ''}
    <section class="panel mt">
      <div class="row wrap">
        <input class="input w-auto" type="month" name="month" value="${h(filter.month)}" aria-label="Tháng">
        <select class="input w-auto" name="status" aria-label="Trạng thái">${options([['', 'Mọi trạng thái'], ...Object.entries(JOB_STATUS)], filter.status)}</select>
        <input class="input w-grow" name="q" value="${h(filter.q)}" placeholder="Tìm theo tên show hoặc khách" aria-label="Tìm">
        <button class="btn sm ghost" data-all>${filter.month ? 'Xem mọi tháng' : 'Chỉ tháng này'}</button>
      </div>
      <div class="stats mt">
        <div class="stat"><div class="k">Tổng tiền công</div><div class="stat-v">${money(data.totals.fee)}</div></div>
        <div class="stat"><div class="k">Đã nhận</div><div class="stat-v pos">${money(data.totals.received)}</div></div>
        <div class="stat"><div class="k">Còn phải thu</div><div class="stat-v">${money(data.totals.outstanding)}</div></div>
        <div class="stat"><div class="k">Số show</div><div class="stat-v">${data.items.length}</div></div>
      </div>
      <div class="list mt">${data.items.length ? data.items.map(jobItem).join('') : empty('🎬', 'Chưa có show nào trong khoảng này.', '<button class="btn" data-new>Thêm show đầu tiên</button>')}</div>
    </section></div>`;
  on(root, 'click', '[data-new]', () => openJobForm());
  $('[name=month]', root).addEventListener('change', e => { filter.draft = false; filter.month = e.target.value; incomeView(root, params); });
  $('[name=status]', root).addEventListener('change', e => { filter.draft = false; filter.status = e.target.value; incomeView(root, params); });
  let t; $('[name=q]', root).addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { filter.draft = false; filter.q = e.target.value; incomeView(root, params).then(() => { const q = $('[name=q]', root); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); });
  $('[data-all]', root).addEventListener('click', () => { filter.month = filter.month ? '' : today().slice(0, 7); incomeView(root, params); });
}

async function receivablesView(root) {
  const r = await get('/api/receivables');
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Công nợ cần thu</h1><p class="muted">Tiền công đã kiếm nhưng chưa về tài khoản. Không tính vào tiền có thể tiêu.</p></div></div>
    <div class="row wrap">${tabs('rec')}</div>
    <div class="figures mt">
      <div class="fig"><div class="k">Tổng chưa thu</div><div class="v">${money(r.total)}</div><div class="n">${r.job_count} show</div></div>
      <div class="fig"><div class="k">Đã quá hạn</div><div class="v ${r.overdue_total ? 'neg' : ''}">${money(r.overdue_total)}</div><div class="n">Cần nhắc khách</div></div>
      <div class="fig"><div class="k">Số khách đang nợ</div><div class="v">${r.clients.length}</div><div class="n">&nbsp;</div></div>
      <div class="fig"><div class="k">Chưa đến hạn</div><div class="v">${money(r.total - r.overdue_total)}</div><div class="n">&nbsp;</div></div>
    </div>
    ${r.clients.length ? r.clients.map(c => `<section class="panel">
      <div class="panel-head"><div><h2>${h(c.client_name)}</h2>${c.max_overdue ? `<span class="chip danger">Quá hạn lâu nhất ${c.max_overdue} ngày</span>` : ''}</div>
        <div class="money"><b>${money(c.total)}</b></div></div>
      <div class="list">${c.jobs.map(j => `<div class="item rec-job" data-job="${h(j.id)}">
        <span class="ic">${WORK_ICONS[j.work_type]}</span>
        <span><div class="t">${h(j.title)}</div>
          <div class="s">Làm ${h(dmy(j.work_date))}, công ${short(j.total_fee)}, đã nhận ${short(j.received)}${j.due_date ? `, hạn ${h(dmy(j.due_date))}` : ''}</div>
          ${j.payments.length ? `<div class="s">Đã trả: ${j.payments.map(p => `${h(dmy(p.date))} ${h(short(p.amount))}`).join('; ')}</div>` : ''}</span>
        <span class="v">${money(j.outstanding)}<small>${payChip(j)}</small>
          <button class="btn sm sage mt-xs" data-pay="${h(j.id)}">Ghi nhận tiền về</button></span></div>`).join('')}</div>
    </section>`).join('') : `<section class="panel">${empty('✅', 'Không có khoản công nợ nào. Mọi show đã được thanh toán đủ.')}</section>`}
  </div>`;
  on(root, 'click', '[data-pay]', async (e, b) => {
    e.stopPropagation();
    const job = r.clients.flatMap(c => c.jobs).find(j => j.id === b.dataset.pay);
    openPaymentForm(job);
  });
  on(root, 'click', '.rec-job', (e, el) => { if (!e.target.closest('button')) location.hash = '#/job/' + el.dataset.job; });
}

async function otherIncomeView(root) {
  const data = await get('/api/transactions?kind=other_income&limit=300');
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Thu khác</h1><p class="muted">Tiền vào không gắn với show nào: bán đồ cũ, quà tặng, hoàn tiền…</p></div>
      <button class="btn primary" data-new>${icon('plus')}Thêm khoản thu</button></div>
    <div class="row wrap">${tabs('other')}</div>
    <section class="panel mt"><div class="list">${data.items.length ? data.items.map(t => `<div class="item" data-tx="${h(t.id)}">
      <span class="ic">${h(t.category_icon || '💰')}</span><span><div class="t">${h(t.description || t.category_name || 'Khoản thu')}</div>
      <div class="s">${h(niceDate(t.date))}, ${h(t.lines[0]?.account_name || '')}</div></span>
      <span class="v pos">${money(t.amount, { sign: true })}</span></div>`).join('') : empty('💰', 'Chưa có khoản thu khác.')}</div></section></div>`;
  on(root, 'click', '[data-new]', () => sheet('Thêm khoản thu', '', { onMount: (b, c) => renderMoneyForm(b, { kind: 'other_income', close: c }) }));
  on(root, 'click', '[data-tx]', (e, el) => openTxEditor(data.items.find(t => t.id === el.dataset.tx)));
}

export async function jobView(root, params) {
  const j = await get('/api/jobs/' + encodeURIComponent(params[0]));
  const pct = j.total_fee ? Math.min(100, (j.received / j.total_fee) * 100) : 0;
  root.innerHTML = `<div class="page">
    <a class="btn ghost sm" href="#/income">${icon('left')}Thu nhập</a>
    <div class="page-head mt"><div><h1>${h(j.title)}</h1>
      <p class="muted">${WORK_ICONS[j.work_type]} ${h(WORK_TYPES[j.work_type])}${j.client_name ? `, ${h(j.client_name)}` : ''}, ${h(niceDate(j.work_date))}</p></div>
      <div class="row wrap">
        ${j.work_status !== 'cancelled' && j.outstanding > 0 ? `<button class="btn sage" data-pay>Ghi nhận tiền về</button>` : ''}
        ${j.work_status !== 'cancelled' ? `<button class="btn" data-edit>${icon('edit')}Sửa</button>` : ''}
        <button class="btn" data-copy>Nhân bản show</button>
      </div></div>
    ${j.draft ? `<div class="notice warn draft-notice"><div><b>Show nháp lấy từ Google Calendar.</b> Điền khách và tiền công để app tính công nợ. Nếu đây là việc riêng, bấm "Không phải show", app sẽ không lấy sự kiện này nữa.</div>
      <div class="row wrap mt-xs"><button class="btn sm sage" data-fill>Điền khách và tiền công</button><button class="btn sm ghost danger" data-notshow>Không phải show</button></div></div>` : ''}
    ${j.conflicts.length ? `<div class="notice danger">Trùng giờ với: ${j.conflicts.map(c => h(c.a_job === j.id ? c.b_title : c.a_title) + ' (' + dmy(c.date) + ')').join(', ')}</div>` : ''}
    <div class="grid g2 mt">
      <section class="panel">
        <div class="panel-head"><h2>Tiền công</h2><span>${payChip(j)} <span class="chip">${h(JOB_STATUS[j.work_status])}</span></span></div>
        <div class="job-money">
          <div class="stat"><div class="k">Tổng công</div><div class="stat-v">${money(j.work_status === 'cancelled' ? j.revenue : j.total_fee)}</div></div>
          <div class="stat"><div class="k">Đã nhận</div><div class="stat-v pos">${money(j.received)}</div></div>
          <div class="stat"><div class="k">Còn nợ</div><div class="stat-v">${money(j.outstanding)}</div></div>
        </div>
        <div class="bar"><i data-w="${pct}"></i></div>
        <p class="small muted mt-xs">${j.due_date ? `Hạn thanh toán ${h(dmy(j.due_date))}${j.overdue_days ? `, đã quá ${j.overdue_days} ngày` : ''}.` : 'Chưa đặt hạn thanh toán.'}
          ${j.work_status === 'cancelled' ? (j.cancel_policy === 'keep' ? ' Show đã hủy, giữ lại tiền cọc.' : ' Show đã hủy, đã hoàn cọc.') : ''}</p>
        <h3 class="mt">Lịch sử thanh toán</h3>
        ${j.payments.length ? `<div class="timeline-pay mt-xs">${j.payments.map(p => `<div class="tp ${p.kind === 'job_refund' ? 'refund' : ''}">
          <div class="row"><b class="money">${money(p.amount, { sign: true })}</b><span class="spacer"></span>
            <button class="btn sm ghost" data-etx="${h(p.id)}" aria-label="Sửa">${icon('edit')}</button>
            <button class="btn sm ghost danger" data-dtx="${h(p.id)}" aria-label="Xóa">${icon('trash')}</button></div>
          <div class="small muted">${h(dmy(p.date))}, ${h(p.account_name)}${p.kind === 'job_refund' ? ', hoàn cọc' : ''}${p.note ? `, ${h(p.note)}` : ''}</div></div>`).join('')}</div>`
          : `<p class="muted small mt-xs">Chưa nhận đồng nào.</p>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Lịch làm việc</h2></div>
        <div class="list">${j.sessions.map(s => `<div class="item">
          <span class="ic">${s.kind === 'deadline' ? '⚑' : s.kind === 'edit' ? '✂️' : s.kind === 'photo' ? '📷' : '🎥'}</span>
          <span><div class="t">${h(SESSION_KINDS[s.kind])}</div><div class="s">${s.start_time ? `${h(s.start_time)}–${h(s.end_time || '')}` : 'Cả ngày'}${s.location ? `, ${h(s.location)}` : ''}</div></span>
          <span class="v small">${h(niceDate(s.date))}</span></div>`).join('')}</div>
        ${j.gcal_src ? `<p class="small faint mt-xs">Ngày giờ lấy theo Google Calendar: đổi giờ trên Google Calendar thì app tự cập nhật.</p>` : ''}
        ${j.description ? `<h3 class="mt">Nội dung</h3><p class="muted pre">${h(j.description)}</p>` : ''}
        ${j.note ? `<h3 class="mt">Ghi chú</h3><p class="muted pre">${h(j.note)}</p>` : ''}
      </section>
    </div>
    <div class="row wrap mt">
      ${j.work_status !== 'cancelled' ? `<button class="btn danger" data-cancel>Hủy show</button>` : ''}
      ${j.received === 0 && !j.payments.length ? `<button class="btn ghost danger" data-del>${icon('trash')}Xóa show</button>` : ''}
    </div></div>`;
  const reload = () => jobView(root, params);
  $('[data-pay]', root)?.addEventListener('click', () => openPaymentForm(j, reload));
  $('[data-edit]', root)?.addEventListener('click', () => openJobForm(j, { onDone: reload }));
  $('[data-fill]', root)?.addEventListener('click', () => openJobForm(j, { onDone: reload }));
  $('[data-notshow]', root)?.addEventListener('click', async () => {
    try { await del('/api/jobs/' + j.id); toast('Đã bỏ. App sẽ không lấy sự kiện này nữa.'); location.hash = '#/calendar'; await changed(); } catch (e) { toastErr(e); }
  });
  $('[data-copy]', root)?.addEventListener('click', () => openJobForm(null, { copyFrom: j, onDone: saved => { location.hash = '#/job/' + saved.id; } }));
  $('[data-cancel]', root)?.addEventListener('click', () => {
    if (j.received > 0) openCancelForm(j, reload);
    else confirmDialog('Hủy show này? Công nợ sẽ về 0.', { ok: 'Hủy show', danger: true }).then(async ok => {
      if (!ok) return;
      try { await post(`/api/jobs/${j.id}/cancel`, { policy: 'keep' }); toast('Đã hủy show'); await changed(); }
      catch (e) { toastErr(e); }
    });
  });
  $('[data-del]', root)?.addEventListener('click', async () => {
    if (!await confirmDialog(`Xóa show "${j.title}"? Lịch làm việc của show cũng bị xóa.`, { ok: 'Xóa', danger: true })) return;
    try { await del('/api/jobs/' + j.id); toast('Đã xóa show'); location.hash = '#/income'; await changed(); } catch (e) { toastErr(e); }
  });
  on(root, 'click', '[data-etx]', async (e, b) => {
    const p = j.payments.find(x => x.id === b.dataset.etx);
    openTxEditor({ id: p.id, kind: p.kind, amount: p.amount, date: p.date, note: p.note, description: 'Thanh toán show', lines: [{ account_id: p.account_id }] }, reload);
  });
  on(root, 'click', '[data-dtx]', async (e, b) => {
    if (!await confirmDialog('Xóa lần thanh toán này? Công nợ của show sẽ tăng lại tương ứng.', { ok: 'Xóa', danger: true })) return;
    try { await del('/api/transactions/' + b.dataset.dtx); toast('Đã xóa'); await changed(); } catch (e) { toastErr(e); }
  });
}

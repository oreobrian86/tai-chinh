import { api, del, get, patch, post } from '../api.js';
import { dailyBars } from '../charts.js';
import { openQuickAdd, openTxEditor } from '../forms.js';
import { accountOptions, changed, expenseCats, state } from '../state.js';
import { busy, confirmDialog, empty, field, formData, icon, options, sheet, showErrors, toast, toastErr } from '../ui.js';
import {
  $, $$, addDays, dmy, formatMoneyInput, h, iso, money, monthEnd, niceDate, on, parseISO, parseMoney, short, today, TX_KINDS,
} from '../util.js';

const tabs = a => `<div class="seg">
  <a class="btn sm ${a === 'tx' ? '' : 'ghost'}" href="#/expenses" aria-pressed="${a === 'tx'}">Giao dịch</a>
  <a class="btn sm ${a === 'obl' ? '' : 'ghost'}" href="#/expenses/obligations" aria-pressed="${a === 'obl'}">Khoản phải trả</a>
  <a class="btn sm ${a === 'import' ? '' : 'ghost'}" href="#/expenses/import" aria-pressed="${a === 'import'}">Nhập từ file</a></div>`;

let f = { month: today().slice(0, 7), category_id: '', account_id: '', kind: 'expense', q: '' };

export async function expensesView(root, params) {
  if (params[0] === 'obligations') return obligationsView(root);
  if (params[0] === 'import') return importView(root);
  const from = f.month + '-01', to = monthEnd(from);
  const qs = new URLSearchParams({ from, to, limit: 1000 });
  ['category_id', 'account_id', 'kind', 'q'].forEach(k => f[k] && qs.set(k, f[k]));
  const t = today();
  const weekStart = addDays(t, -((parseISO(t).getDay() + 6) % 7));
  const [list, daily, weekSum] = await Promise.all([
    get('/api/transactions?' + qs),
    get(`/api/transactions/summary?group=day&from=${from}&to=${to}`),
    get(`/api/transactions/summary?group=month&from=${weekStart}&to=${t}`),
  ]);
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const dmap = Object.fromEntries(daily.map(x => [x.period, x.total]));
  const monthTotal = daily.reduce((a, b) => a + b.total, 0);
  const todayTotal = dmap[t] || 0;
  const weekTotal = weekSum.reduce((a, b) => a + b.total, 0);
  const passed = t.slice(0, 7) === f.month ? Number(t.slice(8)) : days.length;
  // nhóm theo ngày
  const groups = [];
  for (const tx of list.items) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== tx.date) { g = { date: tx.date, items: [], spent: 0 }; groups.push(g); }
    g.items.push(tx);
    if (tx.kind === 'expense') g.spent += tx.amount;
  }
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Chi tiêu</h1><p class="muted">Bấm vào một dòng để sửa hoặc xóa.</p></div>
      <button class="btn primary" data-add>${icon('plus')}Thêm khoản chi</button></div>
    <div class="row wrap">${tabs('tx')}</div>
    <div class="figures mt">
      <div class="fig"><div class="k">Hôm nay</div><div class="v">${money(todayTotal)}</div></div>
      <div class="fig"><div class="k">Tuần này</div><div class="v">${money(weekTotal)}</div></div>
      <div class="fig"><div class="k">${f.month === t.slice(0, 7) ? 'Tháng này' : 'Tháng ' + Number(f.month.slice(5))}</div><div class="v">${money(monthTotal)}</div></div>
      <div class="fig"><div class="k">Trung bình mỗi ngày</div><div class="v">${money(passed ? Math.round(monthTotal / passed) : 0)}</div><div class="n">${passed} ngày đã qua</div></div>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Chi từng ngày</h2><span class="faint small">Cột đậm là hôm nay</span></div>
      ${dailyBars({ days, values: days.map(d => dmap[d] || 0), highlight: t })}
    </section>
    <section class="panel">
      <div class="row wrap">
        <input class="input w-auto" type="month" name="month" value="${h(f.month)}" aria-label="Tháng">
        <select class="input w-auto" name="kind" aria-label="Loại">${options([['', 'Mọi giao dịch'], ['expense', 'Khoản chi'], ['job_payment,job_refund', 'Tiền show'], ['other_income', 'Thu khác'], ['transfer', 'Chuyển khoản'], ['adjustment', 'Điều chỉnh']], f.kind)}</select>
        <select class="input w-auto" name="category_id" aria-label="Danh mục">${options([['', 'Mọi danh mục'], ...state.categories.map(c => [c.id, (c.icon || '') + ' ' + c.name])], f.category_id)}</select>
        <select class="input w-auto" name="account_id" aria-label="Tài khoản">${options([['', 'Mọi tài khoản'], ...state.accounts.map(a => [a.id, a.name])], f.account_id)}</select>
        <input class="input w-grow" name="q" value="${h(f.q)}" placeholder="Tìm nội dung, ghi chú" aria-label="Tìm">
      </div>
      <div class="list">${groups.length ? groups.map(g => `<div class="day-head"><span>${h(niceDate(g.date))}</span><span class="num">${g.spent ? '−' + short(g.spent) : ''}</span></div>
        ${g.items.map(txItem).join('')}`).join('') : empty('🧾', 'Không có giao dịch nào khớp bộ lọc.', '<button class="btn" data-add>Thêm khoản chi</button>')}</div>
    </section></div>`;
  const rerender = () => expensesView(root, params);
  $$('select, input[type=month]', root).forEach(el => el.addEventListener('change', () => { f[el.name] = el.value; rerender(); }));
  let tm; $('[name=q]', root).addEventListener('input', e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; rerender().then(() => { const q = $('[name=q]', root); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); });
  on(root, 'click', '[data-add]', () => openQuickAdd('expense'));
  on(root, 'click', '[data-tx]', (e, el) => txDetail(list.items.find(x => x.id === el.dataset.tx)));
}

export function txItem(tx) {
  const isOut = tx.kind === 'expense' || tx.kind === 'job_refund' || (tx.kind === 'adjustment' && tx.amount < 0);
  const icon = tx.kind === 'transfer' ? '⇄' : tx.kind === 'job_payment' ? '🎬' : tx.kind === 'job_refund' ? '↩' : tx.kind === 'adjustment' ? '±' : (tx.category_icon || '•');
  const title = tx.description || tx.category_name || TX_KINDS[tx.kind];
  const acc = tx.kind === 'transfer' ? `${tx.lines[0]?.account_name} → ${tx.lines[1]?.account_name}` : tx.lines[0]?.account_name;
  const sub = [tx.kind === 'expense' ? tx.category_name : TX_KINDS[tx.kind], acc, tx.import_batch_id ? 'nhập từ file' : ''].filter(Boolean).join(', ');
  const amt = tx.kind === 'transfer' ? money(tx.amount) : money(isOut ? -Math.abs(tx.amount) : Math.abs(tx.amount), { sign: true });
  return `<div class="item" data-tx="${h(tx.id)}" tabindex="0" role="button">
    <span class="ic" ${tx.category_color ? `data-tint="${h(tx.category_color)}"` : ''}>${h(icon)}</span>
    <span><div class="t">${h(title)}</div><div class="s">${h(sub)}</div></span>
    <span class="v ${isOut ? '' : tx.kind === 'transfer' || tx.kind === 'adjustment' ? 'faint' : 'pos'}">${amt}</span></div>`;
}

function txDetail(tx) {
  const isJob = tx.kind === 'job_payment' || tx.kind === 'job_refund';
  sheet(TX_KINDS[tx.kind], `<div class="stack">
    <div class="amount-wrap"><div class="amount-input">${money(tx.kind === 'expense' ? -tx.amount : tx.amount)}</div></div>
    <div class="stats">
      <div class="stat"><div class="k">Ngày</div><div>${h(dmy(tx.date))}</div></div>
      <div class="stat"><div class="k">Tài khoản</div><div>${h(tx.lines.map(l => l.account_name).join(' → '))}</div></div>
      ${tx.category_name ? `<div class="stat"><div class="k">Danh mục</div><div>${h(tx.category_icon || '')} ${h(tx.category_name)}</div></div>` : ''}
      ${tx.job_title ? `<div class="stat"><div class="k">Show</div><div><a href="#/job/${h(tx.job_id)}">${h(tx.job_title)}</a></div></div>` : ''}
    </div>
    ${tx.description ? `<p>${h(tx.description)}</p>` : ''}${tx.note ? `<p class="muted pre">${h(tx.note)}</p>` : ''}
    ${isJob ? '<p class="small muted">Đây là tiền khách trả cho show. Sửa ở đây sẽ cập nhật công nợ của show.</p>' : ''}
    <div class="row"><button class="btn ghost danger" data-del>${icon('trash')}Xóa</button><span class="spacer"></span><button class="btn primary" data-edit>${icon('edit')}Sửa</button></div>
  </div>`, {
    onMount(root, close) {
      $('[data-edit]', root).onclick = () => { close(); openTxEditor(tx); };
      $('[data-del]', root).onclick = async () => {
        if (!await confirmDialog('Xóa giao dịch này? Số dư sẽ được tính lại.', { ok: 'Xóa', danger: true })) return;
        try { await del('/api/transactions/' + tx.id); toast('Đã xóa giao dịch'); close(); await changed(); } catch (e) { toastErr(e); }
      };
    },
  });
}

// ---------- khoản phải trả ----------
async function obligationsView(root) {
  const items = await get('/api/obligations?all=1');
  const unpaid = items.filter(o => !o.paid_transaction_id), paid = items.filter(o => o.paid_transaction_id).slice(0, 20);
  const t = today();
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Khoản phải trả</h1><p class="muted">Tiền nhà, điện nước, trả góp… Những khoản đến hạn trong tháng được giữ lại khỏi tiền có thể tiêu.</p></div>
      <button class="btn primary" data-new>${icon('plus')}Thêm khoản phải trả</button></div>
    <div class="row wrap">${tabs('obl')}</div>
    <section class="panel mt"><div class="panel-head"><h2>Chưa trả</h2><span class="money">${money(unpaid.reduce((a, o) => a + o.amount, 0))}</span></div>
      <div class="list">${unpaid.length ? unpaid.map(o => `<div class="item" data-o="${h(o.id)}">
        <span class="ic">${h(o.category_icon || '📌')}</span>
        <span><div class="t">${h(o.name)}</div><div class="s">Hạn ${h(dmy(o.due_date))}${o.recurrence === 'monthly' ? ', lặp lại hằng tháng' : ''}${o.due_date < t ? ', đã quá hạn' : ''}</div></span>
        <span class="v">${money(o.amount)}<small><button class="btn sm sage" data-pay="${h(o.id)}">Đã trả</button></small></span></div>`).join('') : empty('📌', 'Chưa có khoản phải trả nào.')}</div></section>
    ${paid.length ? `<section class="panel"><div class="panel-head"><h2>Đã trả gần đây</h2></div><div class="list">${paid.map(o => `<div class="item">
      <span class="ic">✓</span><span><div class="t">${h(o.name)}</div><div class="s">Hạn ${h(dmy(o.due_date))}</div></span><span class="v faint">${money(o.amount)}</span></div>`).join('')}</div></section>` : ''}
  </div>`;
  on(root, 'click', '[data-new]', () => obligationForm());
  on(root, 'click', '[data-o]', (e, el) => { if (!e.target.closest('button')) obligationForm(unpaid.find(o => o.id === el.dataset.o)); });
  on(root, 'click', '[data-pay]', (e, b) => payObligation(unpaid.find(o => o.id === b.dataset.pay)));
}

function obligationForm(o = null) {
  sheet(o ? 'Sửa khoản phải trả' : 'Khoản phải trả mới', `<form class="form" novalidate>
    ${field('Tên khoản', `<input class="input" name="name" value="${h(o?.name || '')}" placeholder="Ví dụ: Tiền nhà" maxlength="200">`)}
    <div class="two">${field('Số tiền', `<input class="input" name="amount" inputmode="numeric" value="${o ? new Intl.NumberFormat('vi-VN').format(o.amount) : ''}">`)}
      ${field('Hạn trả', `<input class="input" type="date" name="due_date" value="${h(o?.due_date || today())}">`)}</div>
    <div class="two">${field('Lặp lại', `<select class="input" name="recurrence">${options([['none', 'Một lần'], ['monthly', 'Hằng tháng']], o?.recurrence)}</select>`)}
      ${field('Danh mục khi trả', `<select class="input" name="category_id">${options([['', 'Khác'], ...expenseCats().map(c => [c.id, c.name])], o?.category_id)}</select>`)}</div>
    ${field('Ghi chú', `<input class="input" name="note" value="${h(o?.note || '')}" maxlength="300">`)}
    <div class="row">${o ? `<button type="button" class="btn ghost danger" data-del>${icon('trash')}Xóa</button>` : ''}<span class="spacer"></span>
      <button class="btn primary" type="submit">Lưu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      formatMoneyInput(form.amount);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const body = { name: d.name, amount: parseMoney(d.amount), due_date: d.due_date, recurrence: d.recurrence, category_id: d.category_id || null, note: d.note || null };
        await busy(form.querySelector('[type=submit]'), async () => {
          try { o ? await patch('/api/obligations/' + o.id, body) : await post('/api/obligations', body); toast('Đã lưu'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
      $('[data-del]', root)?.addEventListener('click', async () => {
        if (!await confirmDialog('Xóa khoản phải trả này?', { ok: 'Xóa', danger: true })) return;
        try { await del('/api/obligations/' + o.id); toast('Đã xóa'); close(); await changed(); } catch (err) { toastErr(err); }
      });
    },
  });
}

function payObligation(o) {
  sheet('Ghi nhận đã trả', `<form class="form" novalidate>
    <p><b>${h(o.name)}</b>: ${money(o.amount)}</p>
    <div class="two">${field('Trả từ tài khoản', `<select class="input" name="account_id">${options(accountOptions())}</select>`)}
      ${field('Ngày trả', `<input class="input" type="date" name="date" value="${today()}">`)}</div>
    ${field('Số tiền thực trả', `<input class="input" name="amount" inputmode="numeric" value="${new Intl.NumberFormat('vi-VN').format(o.amount)}">`)}
    <p class="small muted">Một khoản chi sẽ được tạo.${o.recurrence === 'monthly' ? ' Kỳ tháng sau được tự động thêm.' : ''}</p>
    <div class="sheet-foot"><button class="btn primary block" type="submit">Ghi nhận đã trả</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      formatMoneyInput(form.amount);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        await busy(form.querySelector('[type=submit]'), async () => {
          try { await post(`/api/obligations/${o.id}/pay`, { account_id: d.account_id, date: d.date, amount: parseMoney(d.amount) }); toast('Đã ghi nhận'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

// ---------- nhập từ file ----------
const FIELDS = [['date', 'Ngày'], ['description', 'Nội dung'], ['amount', 'Số tiền'], ['debit', 'Tiền ra (ghi nợ)'], ['credit', 'Tiền vào (ghi có)'], ['category', 'Danh mục'], ['note', 'Ghi chú']];
const STATUS = { ok: ['sage', 'Sẽ nhập'], error: ['danger', 'Lỗi'], duplicate: ['', 'Đã có, bỏ qua'], suspect: ['amber', 'Nghi trùng'] };

async function importView(root) {
  const batches = await get('/api/import/batches');
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Nhập từ file</h1><p class="muted">Hỗ trợ file CSV, ví dụ sao kê ngân hàng. File Excel: mở bằng Excel hoặc Google Sheets rồi lưu dạng .csv. Bạn xem trước, ghép cột, rồi mới xác nhận. Dữ liệu cũ không bị ghi đè.</p></div></div>
    <div class="row wrap">${tabs('import')}</div>
    <section class="panel mt" id="imp">
      <form class="form" id="upform">
        ${field('Chọn file', `<input class="input" type="file" name="file" accept=".csv,.txt">`, 'Tối đa 5 MB. Dòng đầu tiên nên là tiêu đề cột.')}
        <div><button class="btn primary" type="submit">${icon('upload')}Tải lên và xem trước</button></div>
      </form>
      <div id="step2"></div>
    </section>
    <section class="panel"><div class="panel-head"><h2>Các lần nhập trước</h2></div>
      ${batches.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Thời gian</th><th>File</th><th class="r">Đã nhập</th><th class="r">Bỏ qua</th><th></th></tr></thead><tbody>
      ${batches.map(b => `<tr><td>${h(new Date(b.created_at).toLocaleString('vi-VN'))}</td><td>${h(b.filename)}</td><td class="r">${b.imported_count}</td><td class="r">${b.skipped_count}</td>
        <td>${b.status === 'undone' ? '<span class="chip">Đã hoàn tác</span>' : `<button class="btn sm ghost danger" data-undo="${h(b.id)}">Hoàn tác</button>`}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Chưa nhập file nào.</p>'}</section></div>`;
  const up = $('#upform', root);
  up.addEventListener('submit', async e => {
    e.preventDefault();
    const file = up.file.files[0];
    if (!file) return toast('Hãy chọn file', 'err');
    const fd = new FormData(); fd.append('file', file);
    await busy(up.querySelector('[type=submit]'), async () => {
      try { mapping(root, await api('POST', '/api/import/upload', fd, { form: true })); } catch (err) { toastErr(err); }
    });
  });
  on(root, 'click', '[data-undo]', async (e, b) => {
    if (!await confirmDialog('Hoàn tác lần nhập này? Mọi giao dịch của lần nhập sẽ bị xóa.', { ok: 'Hoàn tác', danger: true })) return;
    try { const r = await post(`/api/import/batches/${b.dataset.undo}/undo`); toast(`Đã xóa ${r.removed} giao dịch`); await changed(); } catch (err) { toastErr(err); }
  });
}

function mapping(root, up) {
  const s2 = $('#step2', root);
  const cols = [['', '(không dùng)'], ...Array.from({ length: up.columns }, (_, i) => [String(i), `Cột ${i + 1}: ${up.header[i] || ''}`])];
  const g = up.guess;
  const defMode = g.debit !== null && g.credit !== null && g.amount === null ? 'debit_credit' : 'expense_positive';
  s2.innerHTML = `<hr class="sep"><h2>Ghép cột (${up.total_rows} dòng)</h2>
    <div class="table-wrap mt"><table class="t"><thead><tr>${up.header.map(x => `<th>${h(x)}</th>`).join('')}</tr></thead>
      <tbody>${up.preview.slice(0, 5).map(r => `<tr>${r.map(c => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <form class="form mt" id="mapform">
      <div class="grid g3">${FIELDS.map(([k, l]) => field(l, `<select class="input" name="m_${k}">${options(cols, g[k] ?? '')}</select>`)).join('')}</div>
      <div class="grid g3">
        ${field('Cách đọc số tiền', `<select class="input" name="amount_mode">${options([['expense_positive', 'Số dương là khoản chi'], ['signed', 'Số âm là chi, số dương là thu'], ['debit_credit', 'Hai cột tiền ra / tiền vào']], defMode)}</select>`)}
        ${field('Định dạng ngày', `<select class="input" name="date_format">${options([['auto', 'Ngày/tháng/năm (VN)'], ['mdy', 'Tháng/ngày/năm']], 'auto')}</select>`)}
        ${field('Vào tài khoản', `<select class="input" name="account_id">${options(accountOptions())}</select>`)}
      </div>
      <div><button class="btn" type="submit">Kiểm tra dữ liệu</button></div>
    </form><div id="step3"></div>`;
  const mf = $('#mapform', s2);
  const req = () => {
    const d = formData(mf);
    const m = {}; FIELDS.forEach(([k]) => { m[k] = d['m_' + k] === '' ? null : Number(d['m_' + k]); });
    return { token: up.token, mapping: m, account_id: d.account_id, amount_mode: d.amount_mode, date_format: d.date_format };
  };
  mf.addEventListener('submit', async e => {
    e.preventDefault();
    await busy(mf.querySelector('[type=submit]'), async () => {
      try { review(root, req(), await post('/api/import/analyze', req())); } catch (err) { toastErr(err); }
    });
  });
}

function review(root, req, an) {
  const s3 = $('#step3', root);
  const c = an.counts;
  s3.innerHTML = `<hr class="sep"><h2>Kiểm tra trước khi nhập</h2>
    <div class="row wrap mt"><span class="chip sage">${c.ok} dòng sẽ nhập</span><span class="chip amber">${c.suspect} nghi trùng</span>
      <span class="chip">${c.duplicate} đã có</span><span class="chip danger">${c.error} lỗi</span></div>
    <p class="small muted mt-xs">Dòng "nghi trùng" là dòng cùng ngày, cùng số tiền, cùng tài khoản với một giao dịch bạn đã nhập tay. Mặc định bỏ qua, tích chọn nếu vẫn muốn nhập.</p>
    <div class="table-wrap mt"><table class="t"><thead><tr><th></th><th>Ngày</th><th>Nội dung</th><th class="r">Số tiền</th><th>Danh mục</th><th>Trạng thái</th></tr></thead><tbody>
    ${an.rows.slice(0, 300).map(r => `<tr><td>${r.status === 'suspect' ? `<input type="checkbox" data-inc="${r.index}" aria-label="Vẫn nhập">` : ''}</td>
      <td>${h(r.date ? dmy(r.date) : (r.raw[req.mapping.date] ?? ''))}</td><td>${h(r.description)}</td>
      <td class="r ${r.amount > 0 ? 'pos' : ''}">${r.amount ? money(r.amount, { sign: true }) : ''}</td><td>${h(r.category_name || '')}</td>
      <td><span class="chip ${STATUS[r.status][0]}">${h(STATUS[r.status][1])}</span>${r.errors.length ? ` <span class="small neg">${h(r.errors.join(', '))}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div>${an.rows.length > 300 ? `<p class="small muted">Đang hiện 300/${an.rows.length} dòng.</p>` : ''}
    <div class="row mt"><span class="spacer"></span><button class="btn primary" data-commit${c.ok + c.suspect ? '' : ' disabled'}>Nhập các dòng hợp lệ</button></div>`;
  $('[data-commit]', s3).addEventListener('click', async e => {
    const include = $$('[data-inc]:checked', s3).map(x => Number(x.dataset.inc));
    await busy(e.currentTarget, async () => {
      try {
        const r = await post('/api/import/commit', { ...req, include_duplicates: include });
        toast(`Đã nhập ${r.imported} giao dịch, bỏ qua ${r.skipped}`);
        await changed();
      } catch (err) { toastErr(err); }
    });
  });
}

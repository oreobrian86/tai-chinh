// Các form nhập liệu dùng chung: chi/thu, chuyển khoản, show, ghi nhận tiền về, hủy show, thêm nhanh.
import { get, patch, post } from './api.js';
import { accountOptions, activeAccounts, changed, expenseCats, incomeCats, state } from './state.js';
import { busy, field, formData, options, sheet, showErrors, toast, toastErr } from './ui.js';
import {
  $, $$, dmy, formatMoneyInput, h, money, on, parseMoney, SESSION_KINDS, short, today, WORK_ICONS, WORK_TYPES,
} from './util.js';

const amountBlock = (value = '', label = 'Số tiền') => `
  <div class="amount-wrap">
    <label class="sr" for="amt">${h(label)}</label>
    <input id="amt" class="amount-input" name="amount" inputmode="numeric" autocomplete="off" placeholder="0"
      value="${value ? new Intl.NumberFormat('vi-VN').format(value) : ''}" autofocus>
    <div class="unit">đồng</div>
    <div class="quick-amt">
      <button type="button" class="btn sm" data-amt="000">+000</button>
      <button type="button" class="btn sm" data-amt="20000">20k</button>
      <button type="button" class="btn sm" data-amt="50000">50k</button>
      <button type="button" class="btn sm" data-amt="100000">100k</button>
      <button type="button" class="btn sm ghost" data-amt="clear">Xóa</button>
    </div>
  </div>`;

function bindAmount(root) {
  const inp = $('[name=amount]', root);
  formatMoneyInput(inp);
  on(root, 'click', '[data-amt]', (e, b) => {
    const cur = parseMoney(inp.value) || 0;
    const a = b.dataset.amt;
    const v = a === 'clear' ? 0 : a === '000' ? cur * 1000 : Number(a);
    inp.value = v ? new Intl.NumberFormat('vi-VN').format(v) : '';
    inp.focus();
  });
  return () => parseMoney(inp.value);
}

const accountSelect = (name = 'account_id', selected) =>
  `<select class="input" name="${name}">${options(accountOptions(), selected || activeAccounts()[0]?.id)}</select>`;

// ---------- chi tiêu / thu khác ----------
export function renderMoneyForm(root, { kind = 'expense', tx = null, close, onDone } = {}) {
  const cats = kind === 'expense' ? expenseCats() : incomeCats();
  const selCat = tx?.category_id || '';
  root.innerHTML = `<form class="form" novalidate>
    ${amountBlock(tx ? Math.abs(tx.amount) : '')}
    <div class="cat-grid" role="group" aria-label="Danh mục">
      ${cats.map(c => `<button type="button" class="cat-btn" data-cat="${h(c.id)}" aria-pressed="${c.id === selCat}">
        <span class="ic">${h(c.icon || '•')}</span>${h(c.name)}</button>`).join('')}
    </div>
    <input type="hidden" name="category_id" value="${h(selCat)}">
    <div class="two">
      ${field('Tài khoản', accountSelect('account_id', tx?.lines?.[0]?.account_id))}
      ${field('Ngày', `<input class="input" type="date" name="date" value="${h(tx?.date || today())}" max="2100-12-31">`)}
    </div>
    ${field(kind === 'expense' ? 'Nội dung' : 'Nguồn tiền', `<input class="input" name="description" maxlength="300" value="${h(tx?.description || '')}" placeholder="${kind === 'expense' ? 'Ví dụ: cơm trưa' : 'Ví dụ: bán lại ống kính cũ'}">`)}
    <details class="more"${tx?.note || tx?.is_one_off ? ' open' : ''}><summary>Thêm ghi chú</summary>
      <div class="form">
        ${field('Ghi chú', `<textarea class="input" name="note" maxlength="2000">${h(tx?.note || '')}</textarea>`)}
        ${kind === 'expense' ? `<label class="check"><input type="checkbox" name="is_one_off"${tx?.is_one_off ? ' checked' : ''}> Khoản chi lớn bất thường (có thể loại khỏi mức chi trung bình)</label>` : ''}
      </div>
    </details>
    <div class="sheet-foot"><button class="btn primary block" type="submit">${tx ? 'Lưu thay đổi' : kind === 'expense' ? 'Lưu khoản chi' : 'Lưu khoản thu'}</button></div>
  </form>`;
  const form = $('form', root);
  const amount = bindAmount(root);
  on(root, 'click', '[data-cat]', (e, b) => {
    $$('[data-cat]', root).forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', 'true');
    form.category_id.value = b.dataset.cat;
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = formData(form);
    const amt = amount();
    if (!amt || amt <= 0) return showErrors(form, { fields: { amount: 'Nhập số tiền lớn hơn 0' } });
    const body = { amount: amt, account_id: d.account_id, date: d.date, description: d.description || null,
      category_id: d.category_id || null, note: d.note || null };
    if (kind === 'expense') body.is_one_off = !!d.is_one_off;
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        if (tx) await patch(`/api/transactions/${tx.id}`, body);
        else await post('/api/transactions', { kind, ...body });
        toast(tx ? 'Đã lưu thay đổi' : `Đã lưu ${kind === 'expense' ? 'khoản chi' : 'khoản thu'} ${money(amt)}`);
        close?.(); await changed(); onDone?.();
      } catch (err) { showErrors(form, err); }
    });
  });
}

// ---------- chuyển khoản ----------
export function renderTransferForm(root, { tx = null, close } = {}) {
  const accs = activeAccounts();
  if (accs.length < 2) {
    root.innerHTML = `<p class="muted">Cần ít nhất 2 tài khoản để chuyển tiền. Thêm tài khoản trong Cài đặt.</p>
      <div class="sheet-foot"><a class="btn block" href="#/settings">Mở Cài đặt</a></div>`;
    return;
  }
  const src = tx?.lines?.find(l => l.amount < 0)?.account_id || accs.find(a => a.kind === 'bank')?.id || accs[0].id;
  const dst = tx?.lines?.find(l => l.amount > 0)?.account_id || accs.find(a => a.id !== src)?.id;
  root.innerHTML = `<form class="form" novalidate>
    ${amountBlock(tx?.amount || '')}
    <div class="two">
      ${field('Từ tài khoản', accountSelect('account_id', src))}
      ${field('Sang tài khoản', accountSelect('to_account_id', dst))}
    </div>
    <div class="two">
      ${field('Ngày', `<input class="input" type="date" name="date" value="${h(tx?.date || today())}">`)}
      ${tx ? '' : field('Phí chuyển (nếu có)', `<input class="input" name="fee" inputmode="numeric" placeholder="0">`, 'Phí được ghi thành 1 khoản chi riêng')}
    </div>
    ${field('Ghi chú', `<input class="input" name="note" maxlength="300" value="${h(tx?.note || '')}" placeholder="Ví dụ: rút tiền mặt">`)}
    <p class="small muted">Chuyển tiền giữa các tài khoản không tính là thu hay chi, tổng tài sản giữ nguyên.</p>
    <div class="sheet-foot"><button class="btn primary block" type="submit">${tx ? 'Lưu thay đổi' : 'Chuyển tiền'}</button></div>
  </form>`;
  const form = $('form', root);
  const amount = bindAmount(root);
  if (form.fee) formatMoneyInput(form.fee);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = formData(form);
    const amt = amount();
    if (!amt || amt <= 0) return showErrors(form, { fields: { amount: 'Nhập số tiền lớn hơn 0' } });
    if (d.account_id === d.to_account_id) return showErrors(form, { fields: { to_account_id: 'Chọn tài khoản khác tài khoản nguồn' } });
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        const body = { amount: amt, account_id: d.account_id, to_account_id: d.to_account_id, date: d.date, note: d.note || null };
        if (tx) await patch(`/api/transactions/${tx.id}`, body);
        else await post('/api/transactions', { kind: 'transfer', fee: parseMoney(d.fee) || 0, ...body });
        toast(tx ? 'Đã lưu thay đổi' : 'Đã chuyển tiền');
        close?.(); await changed();
      } catch (err) { showErrors(form, err); }
    });
  });
}

// ---------- ghi nhận tiền về từ show ----------
export async function renderPaymentForm(root, { job = null, close, onDone } = {}) {
  let jobs = [];
  if (!job) {
    root.innerHTML = '<div class="loading">Đang tải danh sách show…</div>';
    jobs = (await get('/api/jobs?pay=unpaid&status=booked,in_progress,done')).items;
    if (!jobs.length) {
      root.innerHTML = `<div class="empty"><div class="big">🎉</div><p>Không có show nào đang chờ thanh toán.</p></div>
        <div class="sheet-foot"><button class="btn block" data-newjob>Tạo show mới</button></div>`;
      $('[data-newjob]', root).onclick = () => { close?.(); openJobForm(); };
      return;
    }
  }
  const pick = job || jobs[0];
  root.innerHTML = `<form class="form" novalidate>
    ${job ? `<div><div class="t"><b>${h(job.title)}</b></div><div class="small muted">${h(job.client_name || 'Chưa có tên khách')}: còn nợ ${money(job.outstanding)}</div></div>` :
      field('Show', `<select class="input" name="job_id">${jobs.map(j => `<option value="${h(j.id)}" data-out="${j.outstanding}">${h(j.title)} (${h(j.client_name || '')}): còn ${h(short(j.outstanding))}</option>`).join('')}</select>`)}
    ${amountBlock(pick.outstanding, 'Số tiền nhận')}
    <div class="two">
      ${field('Vào tài khoản', accountSelect())}
      ${field('Ngày nhận', `<input class="input" type="date" name="date" value="${today()}">`)}
    </div>
    ${field('Ghi chú', `<input class="input" name="note" maxlength="300" placeholder="Ví dụ: khách chuyển khoản đợt 2">`)}
    <p class="small muted">Chỉ cần nhập số tiền nhận được. Công nợ của show tự giảm, tiền được cộng vào tài khoản. Đây không phải thu nhập mới.</p>
    <div class="sheet-foot"><button class="btn primary block" type="submit">Ghi nhận tiền về</button></div>
  </form>`;
  const form = $('form', root);
  const amount = bindAmount(root);
  form.job_id?.addEventListener('change', () => {
    const o = form.job_id.selectedOptions[0].dataset.out;
    form.amount.value = new Intl.NumberFormat('vi-VN').format(Number(o));
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const d = formData(form);
    const amt = amount();
    if (!amt || amt <= 0) return showErrors(form, { fields: { amount: 'Nhập số tiền lớn hơn 0' } });
    const jid = job?.id || d.job_id;
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        const j = await post(`/api/jobs/${jid}/payments`, { amount: amt, account_id: d.account_id, date: d.date, note: d.note || null });
        toast(j.outstanding > 0 ? `Đã nhận ${money(amt)}. Còn nợ ${money(j.outstanding)}` : `Đã nhận ${money(amt)}. Show đã thanh toán đủ`);
        close?.(); await changed(); onDone?.(j);
      } catch (err) { showErrors(form, err); }
    });
  });
}

export const openPaymentForm = (job, onDone) =>
  sheet('Ghi nhận tiền về', '', { onMount: (b, c) => renderPaymentForm(b, { job, close: c, onDone }) });

// ---------- show ----------
const sessionRow = (s = {}) => `
  <div class="session-row" data-sid="${h(s.id || '')}">
    <div class="two">
      <select class="input" data-f="kind" aria-label="Công đoạn">${options(Object.entries(SESSION_KINDS), s.kind || 'shoot')}</select>
      <input class="input" type="date" data-f="date" value="${h(s.date || today())}" aria-label="Ngày">
    </div>
    <div class="two">
      <input class="input" type="time" data-f="start_time" value="${h(s.start_time || '')}" aria-label="Giờ bắt đầu">
      <input class="input" type="time" data-f="end_time" value="${h(s.end_time || '')}" aria-label="Giờ kết thúc">
    </div>
    <div class="row"><input class="input" data-f="location" value="${h(s.location || '')}" placeholder="Địa điểm" aria-label="Địa điểm">
      <button type="button" class="btn ghost icon-btn" data-rm aria-label="Bỏ ngày này">✕</button></div>
  </div>`;

export function openJobForm(job = null, { date, onDone, copyFrom = null } = {}) {
  const multi = job && job.sessions && job.sessions.length > 1;
  const first = job?.sessions?.[0] || {};
  const pre = job || copyFrom;  // nhân bản show: điền sẵn từ show cũ nhưng tạo show MỚI
  const pfirst = job ? first : (copyFrom?.sessions?.[0] || {});
  const isDraft = !!job?.draft;  // show nháp lấy từ Google Calendar: cho chọn khách quen như show mới
  const recent = job && !isDraft ? [] : (state.recentClients || []).slice(0, 8);
  const body = `<form class="form" novalidate>
    ${field('Tên show / dự án', `<input class="input" name="title" maxlength="200" value="${h(pre?.title || '')}" placeholder="Ví dụ: Quay cưới Hoàng & Mai" autofocus>`)}
    ${recent.length ? `<div class="field"><span>Khách gần đây (chạm để chọn, tự điền theo show gần nhất)</span><div class="row wrap client-chips">${recent.map(c => `<button type="button" class="chip client-chip" data-client="${h(c.id)}">${h(c.name)}</button>`).join('')}</div></div>` : ''}
    <div class="two">
      ${field('Khách hàng / chủ show', `<input class="input" name="client_name" list="client-list" maxlength="200" value="${h(pre?.client_name || '')}" placeholder="Tên người thuê">
        <datalist id="client-list">${state.clients.map(c => `<option value="${h(c.name)}">`).join('')}</datalist>`)}
      ${field('Loại công việc', `<select class="input" name="work_type">${options(Object.entries(WORK_TYPES), pre?.work_type || 'video')}</select>`)}
    </div>
    ${field('Tổng tiền công', `<input class="input" name="total_fee" inputmode="numeric" value="${pre && !isDraft ? new Intl.NumberFormat('vi-VN').format(pre.total_fee) : ''}" placeholder="Ví dụ: 1.500.000 hoặc 1tr5">`)}
    <p class="small muted autofill-hint hidden"></p>
    ${job ? '' : `<div class="two">
      ${field('Tiền cọc đã nhận', `<input class="input" name="deposit" inputmode="numeric" placeholder="0">`)}
      ${field('Cọc vào tài khoản', accountSelect('deposit_account_id'))}
    </div>`}
    <div class="two">
      ${field('Ngày thực hiện', `<input class="input" type="date" name="work_date" value="${h(job?.work_date || date || today())}">`)}
      ${field('Hạn thanh toán', `<input class="input" type="date" name="due_date" value="${h(job?.due_date || '')}">`)}
    </div>
    <div class="single-session${multi ? ' hidden' : ''}">
      <div class="two">
        ${field('Giờ bắt đầu', `<input class="input" type="time" name="start_time" value="${h(pfirst.start_time || '')}">`)}
        ${field('Giờ kết thúc', `<input class="input" type="time" name="end_time" value="${h(pfirst.end_time || '')}">`)}
      </div>
      ${field('Địa điểm', `<input class="input" name="location" maxlength="300" value="${h(pre?.location || pfirst.location || '')}">`)}
    </div>
    <label class="check"><input type="checkbox" name="multi"${multi ? ' checked' : ''}> Nhiều ngày làm / nhiều công đoạn (quay, dựng, bàn giao…)</label>
    <div class="sessions${multi ? '' : ' hidden'}">
      <div class="session-list stack">${(job?.sessions?.length ? job.sessions : [{ date: date || today() }]).map(sessionRow).join('')}</div>
      <button type="button" class="btn sm" data-addsess>Thêm ngày làm</button>
    </div>
    ${field('Tình trạng công việc', `<select class="input" name="work_status"${job?.work_status === 'cancelled' ? ' disabled' : ''}>${options([['booked', 'Chưa làm'], ['in_progress', 'Đang làm'], ['done', 'Đã làm xong']], job?.work_status || 'booked')}</select>`,
      'Chỉ là tình trạng công việc, không liên quan tiền. Chưa làm xong: tiền còn thiếu là dự kiến. Làm xong: thành công nợ. Tiền chỉ vào khi bấm "Ghi nhận tiền về".')}
    <details class="more"${pre?.description || pre?.note ? ' open' : ''}><summary>Nội dung và ghi chú</summary>
      <div class="form">
        ${field('Nội dung công việc', `<textarea class="input" name="description" maxlength="2000">${h(pre?.description || '')}</textarea>`)}
        ${field('Ghi chú', `<textarea class="input" name="note" maxlength="2000">${h(job?.note || '')}</textarea>`)}
      </div>
    </details>
    <div class="sheet-foot"><button class="btn primary block" type="submit">${job ? 'Lưu show' : 'Tạo show'}</button></div>
  </form>`;
  sheet(isDraft ? 'Điền thông tin show' : job ? 'Sửa show' : copyFrom ? 'Nhân bản show' : 'Show mới', body, {
    onMount(root, close) {
      const form = $('form', root);
      ['total_fee', 'deposit'].forEach(n => form[n] && formatMoneyInput(form[n]));
      // Chọn khách quen: điền tên + các thông tin theo show gần nhất với khách đó (chỉ ô còn trống hoặc chưa sửa)
      const touched = new Set();
      ['work_type', 'total_fee', 'location', 'start_time', 'end_time'].forEach(n => form[n]?.addEventListener('input', () => touched.add(n)));
      const applyClient = c => {
        if (!c || (job && !isDraft)) return;
        form.client_name.value = c.name;
        $$('.client-chip', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.client === c.id)));
        const L = c.last || {};
        const set = (n, v) => { if (v !== null && v !== undefined && v !== '' && form[n] && !touched.has(n)) form[n].value = v; };
        set('work_type', L.work_type);
        if (L.total_fee) set('total_fee', new Intl.NumberFormat('vi-VN').format(L.total_fee));
        set('location', L.location); set('start_time', L.start_time); set('end_time', L.end_time);
        const hint = $('.autofill-hint', root);
        hint.textContent = `Đã điền theo show gần nhất với ${c.name} (${L.title || ''}${L.total_fee ? `, ${short(L.total_fee)}` : ''}). Sửa nếu lần này khác. Đã làm ${c.job_count} show với khách này.`;
        hint.classList.remove('hidden');
      };
      on(root, 'click', '.client-chip', (e, b) => applyClient(recent.find(c => c.id === b.dataset.client)));
      form.client_name.addEventListener('change', () => applyClient((state.recentClients || []).find(c => c.name.toLowerCase() === form.client_name.value.trim().toLowerCase())));
      form.multi.addEventListener('change', () => {
        $('.sessions', root).classList.toggle('hidden', !form.multi.checked);
        $('.single-session', root).classList.toggle('hidden', form.multi.checked);
        if (form.multi.checked) {
          const r = $('.session-row', root);
          if (r) {
            $('[data-f=date]', r).value = form.work_date.value;
            $('[data-f=start_time]', r).value = form.start_time.value;
            $('[data-f=end_time]', r).value = form.end_time.value;
            $('[data-f=location]', r).value = form.location.value;
            const kindMap = { video: 'shoot', video_edit: 'shoot', photo: 'photo', edit: 'edit', other: 'other' };
            $('[data-f=kind]', r).value = kindMap[form.work_type.value];
          }
        }
      });
      // Quay + dựng: tự tách thành ngày quay và ngày dựng (mặc định hôm sau, sửa được)
      form.work_type.addEventListener('change', () => {
        if (form.work_type.value !== 'video_edit' || form.multi.checked) return;
        form.multi.checked = true;
        form.multi.dispatchEvent(new Event('change'));
        if (!$$('.session-row', root).some(r => $('[data-f=kind]', r).value === 'edit')) {
          const d = form.work_date.value || today();
          $('.session-list', root).insertAdjacentHTML('beforeend', sessionRow({ date: new Date(new Date(d).getTime() + 864e5).toISOString().slice(0, 10), kind: 'edit' }));
        }
      });
      on(root, 'click', '[data-addsess]', () => {
        const last = $$('.session-row', root).pop();
        const d = last ? $('[data-f=date]', last).value : form.work_date.value;
        const next = d ? new Date(new Date(d).getTime() + 864e5).toISOString().slice(0, 10) : today();
        $('.session-list', root).insertAdjacentHTML('beforeend', sessionRow({ date: next, kind: 'edit' }));
      });
      on(root, 'click', '[data-rm]', (e, b) => {
        if ($$('.session-row', root).length > 1) b.closest('.session-row').remove();
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const fee = parseMoney(d.total_fee);
        if (!d.title) return showErrors(form, { fields: { title: 'Nhập tên show' } });
        if (!(fee >= 0)) return showErrors(form, { fields: { total_fee: 'Nhập tổng tiền công' } });
        const body = { title: d.title, client_name: d.client_name || null, work_type: d.work_type, work_date: d.work_date,
          total_fee: fee, due_date: d.due_date || null, description: d.description || null, note: d.note || null };
        if (d.work_status) body.work_status = d.work_status;
        let sessions;
        if (form.multi.checked) {
          sessions = $$('.session-row', root).map(r => {
            const s = { kind: $('[data-f=kind]', r).value, date: $('[data-f=date]', r).value,
              start_time: $('[data-f=start_time]', r).value || null, end_time: $('[data-f=end_time]', r).value || null,
              location: $('[data-f=location]', r).value || null };
            if (r.dataset.sid) s.id = r.dataset.sid;
            return s;
          });
          body.location = sessions[0]?.location || null;
        } else {
          body.location = d.location || null;
          const kindMap = { video: 'shoot', video_edit: 'shoot', photo: 'photo', edit: 'edit', other: 'other' };
          if (job) sessions = [{ id: first.id, kind: first.kind || kindMap[d.work_type], date: d.work_date,
            start_time: d.start_time || null, end_time: d.end_time || null, location: d.location || null }];
          else { body.start_time = d.start_time || null; body.end_time = d.end_time || null; }
        }
        if (sessions) body.sessions = sessions;
        if (!job) {
          const dep = parseMoney(d.deposit) || 0;
          if (dep > fee) return showErrors(form, { fields: { deposit: 'Tiền cọc lớn hơn tổng tiền công' } });
          if (dep > 0) { body.deposit = dep; body.deposit_account_id = d.deposit_account_id; }
        }
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            const saved = job ? await patch(`/api/jobs/${job.id}`, body) : await post('/api/jobs', body);
            if (saved.conflicts?.length) {
              const c = saved.conflicts[0];
              toast(`Lưu ý: trùng giờ với "${c.a_job === saved.id ? c.b_title : c.a_title}" ngày ${dmy(c.date)}`, 'err');
            } else toast(job ? 'Đã lưu show' : 'Đã tạo show');
            close(); await changed(); onDone?.(saved);
          } catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

export function openCancelForm(job, onDone) {
  sheet('Hủy show', `<form class="form" novalidate>
    <p>Show <b>${h(job.title)}</b> đã nhận ${money(job.received)}. Chọn cách xử lý tiền đã nhận:</p>
    <label class="check"><input type="radio" name="policy" value="keep" checked> Giữ lại tiền cọc (tính là doanh thu của show đã hủy)</label>
    <label class="check"><input type="radio" name="policy" value="refund"${job.received > 0 ? '' : ' disabled'}> Hoàn lại tiền cọc cho khách</label>
    <div class="refund-acc hidden">${field('Hoàn từ tài khoản', accountSelect())}</div>
    <p class="small muted">Sau khi hủy, công nợ của show về 0 và show không còn nằm trong doanh thu dự kiến.</p>
    <div class="sheet-foot"><button class="btn danger block" type="submit">Hủy show</button></div>
  </form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('change', () => $('.refund-acc', root).classList.toggle('hidden', formData(form).policy !== 'refund'));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            const j = await post(`/api/jobs/${job.id}/cancel`, { policy: d.policy, account_id: d.policy === 'refund' ? d.account_id : null });
            toast('Đã hủy show'); close(); await changed(); onDone?.(j);
          } catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

// ---------- sửa giao dịch bất kỳ ----------
export function openTxEditor(tx, onDone) {
  if (tx.kind === 'expense' || tx.kind === 'other_income') {
    return sheet(tx.kind === 'expense' ? 'Sửa khoản chi' : 'Sửa khoản thu', '', { onMount: (b, c) => renderMoneyForm(b, { kind: tx.kind, tx, close: c, onDone }) });
  }
  if (tx.kind === 'transfer') return sheet('Sửa chuyển khoản', '', { onMount: (b, c) => renderTransferForm(b, { tx, close: c }) });
  // tiền show, hoàn cọc, điều chỉnh: sửa ngày / số tiền / ghi chú
  const locked = tx.kind === 'job_refund';
  sheet('Sửa giao dịch', `<form class="form" novalidate>
    <p class="muted">${h(tx.description || '')}</p>
    ${locked ? `<p>Số tiền: <b>${money(tx.amount)}</b> (khoản hoàn cọc chỉ sửa được ngày và ghi chú)</p>` : amountBlock(Math.abs(tx.amount))}
    ${field('Ngày', `<input class="input" type="date" name="date" value="${h(tx.date)}">`)}
    ${field('Ghi chú', `<input class="input" name="note" maxlength="300" value="${h(tx.note || '')}">`)}
    <div class="sheet-foot"><button class="btn primary block" type="submit">Lưu thay đổi</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      const amount = locked ? null : bindAmount(root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const body = { date: d.date, note: d.note || null };
        if (amount) body.amount = tx.kind === 'adjustment' && tx.amount < 0 ? -amount() : amount();
        await busy(form.querySelector('[type=submit]'), async () => {
          try { await patch(`/api/transactions/${tx.id}`, body); toast('Đã lưu thay đổi'); close(); await changed(); onDone?.(); }
          catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

// ---------- thêm nhanh ----------
export function openQuickAdd(initial = 'text') {
  sheet('Thêm nhanh', `<div class="seg qa-seg" role="group" aria-label="Loại">
      <button data-k="text">Gõ câu</button><button data-k="expense">Chi</button><button data-k="payment">Khách trả</button>
      <button data-k="other_income">Thu khác</button><button data-k="transfer">Chuyển</button><button data-k="job">Show mới</button>
    </div><div class="qa-body"></div>`, {
    onMount(root, close) {
      const bodyEl = $('.qa-body', root);
      const show = k => {
        $$('.qa-seg button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
        bodyEl.innerHTML = '';
        if (k === 'text') renderTextEntry(bodyEl, { close });
        else if (k === 'expense' || k === 'other_income') renderMoneyForm(bodyEl, { kind: k, close });
        else if (k === 'transfer') renderTransferForm(bodyEl, { close });
        else if (k === 'payment') renderPaymentForm(bodyEl, { close }).catch(toastErr);
        else if (k === 'job') { close(); openJobForm(); }
        const a = $('[name=amount]', bodyEl);
        if (a && window.matchMedia('(min-width: 861px)').matches) a.focus();
      };
      on(root, 'click', '.qa-seg button', (e, b) => show(b.dataset.k));
      show(initial);
    },
  });
}

// ---------- gõ câu ngắn: app tự hiểu ----------
const QT = { expense: ['Chi', ''], other_income: ['Thu', 'sage'], job: ['Show mới', 'mist'], payment: ['Khách trả', 'sage'], obligation: ['Phải trả', 'amber'], unknown: ['Chưa hiểu', 'danger'] };
let lastText = '';
function renderTextEntry(el, { close }) {
  el.innerHTML = `<div class="form">
    <label class="field"><span>Mỗi dòng một việc, gõ như nhắn tin. Có dấu hay không dấu đều được.</span>
      <textarea class="input qt-text" rows="5" maxlength="5000" placeholder="ăn trưa 45k&#10;cf 30k momo hôm qua&#10;15/12 quay cưới Linh 6tr5 cọc 2tr khách Studio Mây&#10;anh Minh chuyển khoản 2tr&#10;wifi 220k hàng tháng ngày 5&#10;spaylater 1tr2 3 kỳ ngày 15">${h(lastText)}</textarea></label>
    <details class="more"><summary>Xem các kiểu câu app hiểu</summary><ul class="small muted qt-help">
      <li><b>Chi:</b> "ăn trưa 45k", "đổ xăng 80k tiền mặt", "mua thẻ nhớ 1tr2 ck 10/11"</li>
      <li><b>Thu khác:</b> "bán lens cũ 3tr5", "hoàn tiền shopee 120k"</li>
      <li><b>Show mới:</b> "thứ 7 quay + dựng sự kiện ABC 6h-11h tại GEM 8tr cọc 2tr", "20/12 chụp kỷ yếu 3tr cho chị Lan"</li>
      <li><b>Khách trả:</b> "anh Minh chuyển khoản 2tr", "Linh trả nốt 4tr" (tìm show đang nợ theo tên)</li>
      <li><b>Chi cố định:</b> "wifi 220k hàng tháng ngày 5", "gia hạn capcut 1tr2 mỗi năm 3/1"</li>
      <li><b>Trả sau, trả góp:</b> "spaylater 1tr250 3 kỳ ngày 15", "trả góp điện thoại kỳ 2/6 1tr5 ngày 20"</li>
      <li>Ngày: hôm nay, hôm qua, mai, thứ 7, cn, 15/12, ngày 5. Tài khoản: tiền mặt, ck, momo hoặc tên tài khoản của bạn.</li></ul></details>
    <button type="button" class="btn primary block" data-read>Đọc</button>
    <div class="qt-preview"></div></div>`;
  const ta = $('.qt-text', el), pv = $('.qt-preview', el);
  if (window.matchMedia('(min-width: 861px)').matches) ta.focus();
  let items = [];
  const draw = () => {
    const n = items.filter(i => i.on).length;
    pv.innerHTML = `<div class="list mt">${items.map((it, i) => `<div class="item qt-item${it.type === 'unknown' ? ' muted' : ''}">
      <span class="ic"><input type="checkbox" data-i="${i}"${it.on ? ' checked' : ''}${it.ok ? '' : ' disabled'} aria-label="Chọn dòng ${i + 1}"></span>
      <span><div class="t"><span class="chip ${QT[it.type][1]}">${QT[it.type][0]}</span> ${h(it.summary)}</div>
        <div class="s faint">"${h(it.line)}"</div>
        ${it.warnings.map(w => `<div class="s qt-warn">${h(w)}</div>`).join('')}</span>
      <span class="v">${it.type === 'job' ? `<button type="button" class="btn sm ghost" data-edit-i="${i}">Sửa rồi lưu</button>` : ''}</span></div>`).join('')}</div>
      ${items.length ? `<button type="button" class="btn primary block mt" data-save${n ? '' : ' disabled'}>Lưu ${n} mục</button>` : ''}`;
  };
  const read = () => busy($('[data-read]', el), async () => {
    lastText = ta.value;
    if (!ta.value.trim()) return toast('Gõ ít nhất một dòng', 'err');
    try { items = (await post('/api/quick/parse', { text: ta.value })).items.map(it => ({ ...it, on: it.ok })); draw(); }
    catch (err) { toastErr(err); }
  });
  on(el, 'click', '[data-read]', read);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); read(); } });
  on(el, 'change', '[data-i]', (e, cb) => { items[+cb.dataset.i].on = cb.checked; draw(); });
  on(el, 'click', '[data-edit-i]', (e, b) => {
    const it = items[+b.dataset.editI], d = it.data;
    close();
    openJobForm(null, { date: d.work_date, copyFrom: { title: d.title, client_name: d.client_name, work_type: d.work_type, total_fee: d.total_fee,
      location: d.location, description: null, sessions: [{ start_time: d.start_time, end_time: d.end_time, location: d.location }] } });
  });
  on(el, 'click', '[data-save]', (e, b) => busy(b, async () => {
    const chosen = items.filter(i => i.on).map(i => ({ type: i.type, data: i.data }));
    try {
      const r = await post('/api/quick/commit', { items: chosen });
      lastText = '';
      toast(`Đã lưu ${r.saved} mục`);
      close(); await changed();
    } catch (err) { toastErr(err); }
  }));
}

export { WORK_ICONS };

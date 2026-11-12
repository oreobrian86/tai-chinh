import { del, get, patch, post } from '../api.js';
import { changed } from '../state.js';
import { busy, confirmDialog, empty, field, formData, icon, sheet, showErrors, toast, toastErr } from '../ui.js';
import { $, dmy, formatMoneyInput, h, money, on, parseMoney, short, today } from '../util.js';

const FEAS = { ok: ['sage', 'Phù hợp với thu chi hiện tại'], tight: ['amber', 'Khá căng so với thu chi'], not_feasible: ['danger', 'Chưa khả thi với thu chi hiện tại'] };

export async function savingsView(root) {
  const [ov, fc] = await Promise.all([get('/api/goals'), get('/api/forecast')]);
  const goals = ov.goals.filter(g => !g.archived), archived = ov.goals.filter(g => g.archived);
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Tiết kiệm</h1><p class="muted">Tiền để dành vẫn nằm trong tài khoản của bạn, chỉ được giữ riêng ra khỏi tiền có thể tiêu. Để dành không phải là chi tiêu.</p></div>
      <button class="btn primary" data-new>${icon('plus')}Mục tiêu mới</button></div>
    <div class="figures">
      <div class="fig"><div class="k">Đã để dành</div><div class="v">${money(fc.reserved_goals + fc.emergency_fund)}</div><div class="n">Dự phòng ${short(fc.emergency_fund)}</div></div>
      <div class="fig"><div class="k">Có thể dành thêm</div><div class="v">${money(Math.max(0, fc.available))}</div><div class="n">Bằng tiền có thể tiêu hiện tại</div></div>
      <div class="fig"><div class="k">Dư ra mỗi tháng</div><div class="v">${ov.monthly_capacity === null ? '—' : money(ov.monthly_capacity)}</div><div class="n">Tiền về trừ chi tiêu, TB 3 tháng</div></div>
      <div class="fig"><div class="k">Cần để dành mỗi tháng</div><div class="v">${money(ov.monthly_need_total)}</div>
        <div class="n">${ov.overall_feasibility ? `<span class="chip ${FEAS[ov.overall_feasibility][0]}">${FEAS[ov.overall_feasibility][1]}</span>` : 'Cho mọi mục tiêu'}</div></div>
    </div>
    ${fc.reserved_exceeds_balance ? '<div class="notice danger">Số tiền đã dành đang lớn hơn số dư thực có. Hãy rút bớt khỏi mục tiêu cho khớp.</div>' : ''}
    <div class="grid g2">${goals.length ? goals.map(goalCard).join('') : `<section class="panel">${empty('🎯', 'Chưa có mục tiêu nào. Ví dụ: mua máy ảnh mới, quỹ dự phòng 3 tháng chi tiêu.', '<button class="btn" data-new>Tạo mục tiêu</button>')}</section>`}</div>
    ${archived.length ? `<section class="panel mt"><div class="panel-head"><h2>Đã lưu trữ</h2></div><div class="list">${archived.map(g => `<div class="item" data-edit="${h(g.id)}"><span class="ic">📦</span><span><div class="t">${h(g.name)}</div><div class="s">${money(g.saved)} / ${money(g.target_amount)}</div></span><span class="v"></span></div>`).join('')}</div></section>` : ''}
  </div>`;
  on(root, 'click', '[data-new]', () => goalForm());
  on(root, 'click', '[data-edit]', (e, b) => goalForm(ov.goals.find(g => g.id === b.dataset.edit)));
  on(root, 'click', '[data-alloc]', (e, b) => allocForm(goals.find(g => g.id === b.dataset.alloc), 1, fc));
  on(root, 'click', '[data-withdraw]', (e, b) => allocForm(goals.find(g => g.id === b.dataset.withdraw), -1, fc));
  on(root, 'click', '[data-hist]', (e, b) => history(goals.find(g => g.id === b.dataset.hist)));
}

function goalCard(g) {
  const p = g.plan;
  const lines = [];
  if (p.remaining === 0) lines.push('Đã đạt mục tiêu.');
  else {
    lines.push(`Còn thiếu <b>${money(p.remaining)}</b>.`);
    if (p.months_at_plan) lines.push(`Để dành ${short(g.monthly_plan)}/tháng thì sau <b>${p.months_at_plan} tháng</b> sẽ đạt (khoảng ${dmy(p.eta_at_plan).slice(3)}).`);
    if (p.required_monthly) lines.push(`Muốn đạt trước ${dmy(g.target_date)} cần để dành <b>${money(p.required_monthly)}/tháng</b> trong ${p.months_left} tháng.`);
    if (!p.months_at_plan && !p.required_monthly) lines.push('Đặt mức để dành mỗi tháng hoặc ngày mong muốn để xem kế hoạch.');
  }
  return `<section class="panel goal">
    <div class="panel-head"><div><h2>${h(g.name)}</h2>${g.is_emergency ? '<span class="chip mist">Quỹ dự phòng: không dùng để chi tiêu</span>' : ''}</div>
      <button class="btn ghost icon-btn" data-edit="${h(g.id)}" aria-label="Sửa mục tiêu">${icon('edit')}</button></div>
    <div class="row"><span class="stat-v money">${money(g.saved)}</span><span class="faint">/ ${money(g.target_amount)}</span><span class="spacer"></span><b>${Math.round(p.progress * 100)}%</b></div>
    <div class="bar mt-xs ${g.is_emergency ? 'mist' : ''}"><i data-w="${p.progress * 100}"></i></div>
    <p class="small muted mt-xs">${lines.join(' ')}</p>
    ${p.feasibility && p.remaining ? `<p class="mt-xs"><span class="chip ${FEAS[p.feasibility][0]}">${FEAS[p.feasibility][1]}</span></p>` : ''}
    <div class="row wrap mt"><button class="btn sage sm" data-alloc="${h(g.id)}">Dành thêm</button>
      <button class="btn sm" data-withdraw="${h(g.id)}"${g.saved > 0 ? '' : ' disabled'}>Rút ra</button>
      <span class="spacer"></span><button class="btn sm ghost" data-hist="${h(g.id)}">Lịch sử</button></div>
  </section>`;
}

function goalForm(g = null) {
  sheet(g ? 'Sửa mục tiêu' : 'Mục tiêu mới', `<form class="form" novalidate>
    ${field('Tên mục tiêu', `<input class="input" name="name" value="${h(g?.name || '')}" placeholder="Ví dụ: Mua máy ảnh mới" maxlength="200">`)}
    <div class="two">${field('Số tiền cần đạt', `<input class="input" name="target_amount" inputmode="numeric" value="${g ? new Intl.NumberFormat('vi-VN').format(g.target_amount) : ''}" placeholder="30tr">`)}
      ${field('Ngày mong muốn hoàn thành', `<input class="input" type="date" name="target_date" value="${h(g?.target_date || '')}">`)}</div>
    <div class="two">${field('Dự định để dành mỗi tháng', `<input class="input" name="monthly_plan" inputmode="numeric" value="${g?.monthly_plan ? new Intl.NumberFormat('vi-VN').format(g.monthly_plan) : ''}">`)}
      ${g ? '' : field('Số đã có sẵn', `<input class="input" name="initial_amount" inputmode="numeric" placeholder="0">`, 'Trừ vào tiền có thể tiêu')}</div>
    <label class="check"><input type="checkbox" name="is_emergency"${g?.is_emergency ? ' checked' : ''}> Đây là quỹ dự phòng (luôn giữ riêng, không tính vào tiền có thể tiêu)</label>
    ${g ? `<label class="check"><input type="checkbox" name="archived"${g.archived ? ' checked' : ''}> Lưu trữ mục tiêu (ẩn khỏi danh sách, tiền vẫn được giữ)</label>` : ''}
    <div class="row">${g ? `<button type="button" class="btn ghost danger" data-del>${icon('trash')}Xóa</button>` : ''}<span class="spacer"></span><button class="btn primary" type="submit">Lưu</button></div>
  </form>`, {
    onMount(root, close) {
      const form = $('form', root);
      ['target_amount', 'monthly_plan', 'initial_amount'].forEach(n => form[n] && formatMoneyInput(form[n]));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const body = { name: d.name, target_amount: parseMoney(d.target_amount), target_date: d.target_date || null,
          monthly_plan: d.monthly_plan ? parseMoney(d.monthly_plan) : null, is_emergency: !!d.is_emergency };
        if (!g && d.initial_amount) body.initial_amount = parseMoney(d.initial_amount);
        if (g) body.archived = !!d.archived;
        if (!(body.target_amount > 0)) return showErrors(form, { fields: { target_amount: 'Nhập số tiền cần đạt' } });
        await busy(form.querySelector('[type=submit]'), async () => {
          try { g ? await patch('/api/goals/' + g.id, body) : await post('/api/goals', body); toast('Đã lưu mục tiêu'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
      $('[data-del]', root)?.addEventListener('click', async () => {
        if (!await confirmDialog(`Xóa mục tiêu "${g.name}"? ${money(g.saved)} đã dành sẽ trở lại tiền có thể tiêu.`, { ok: 'Xóa', danger: true })) return;
        try { await del('/api/goals/' + g.id); toast('Đã xóa mục tiêu'); close(); await changed(); } catch (err) { toastErr(err); }
      });
    },
  });
}

function allocForm(g, sign, fc) {
  const max = sign > 0 ? Math.max(0, fc.available) : g.saved;
  sheet(sign > 0 ? `Dành thêm cho "${g.name}"` : `Rút ra khỏi "${g.name}"`, `<form class="form" novalidate>
    ${field('Số tiền', `<input class="input" name="amount" inputmode="numeric" autofocus value="${sign > 0 && g.plan.required_monthly ? new Intl.NumberFormat('vi-VN').format(Math.min(max, g.plan.required_monthly)) : ''}">`,
      sign > 0 ? `Tối đa ${money(max)} (tiền có thể tiêu hiện tại)` : `Tối đa ${money(max)} đã dành`)}
    ${field('Ghi chú', `<input class="input" name="note" maxlength="300">`)}
    <p class="small muted">${sign > 0 ? 'Số dư tài khoản không đổi. Tiền có thể tiêu giảm tương ứng.' : 'Tiền rút ra trở lại tiền có thể tiêu. Nếu bạn tiêu nó, hãy ghi thêm một khoản chi như bình thường.'}</p>
    <div class="sheet-foot"><button class="btn primary block" type="submit">${sign > 0 ? 'Dành thêm' : 'Rút ra'}</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      formatMoneyInput(form.amount);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const amt = parseMoney(d.amount);
        if (!(amt > 0)) return showErrors(form, { fields: { amount: 'Nhập số tiền lớn hơn 0' } });
        await busy(form.querySelector('[type=submit]'), async () => {
          try { await post(`/api/goals/${g.id}/allocations`, { amount: sign * amt, note: d.note || null }); toast(sign > 0 ? 'Đã dành thêm' : 'Đã rút ra'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

function history(g) {
  sheet('Lịch sử: ' + g.name, g.allocations.length ? `<div class="list">${g.allocations.map(a => `<div class="item">
      <span class="ic">${a.amount > 0 ? '＋' : '－'}</span><span><div class="t">${money(a.amount, { sign: true })}</div><div class="s">${h(dmy(a.date))}${a.note ? ', ' + h(a.note) : ''}</div></span>
      <span class="v"><button class="btn sm ghost danger" data-del="${h(a.id)}" aria-label="Xóa">${icon('trash')}</button></span></div>`).join('')}</div>`
    : '<p class="muted">Chưa có lần dành tiền nào.</p>', {
    onMount(root, close) {
      on(root, 'click', '[data-del]', async (e, b) => {
        if (!await confirmDialog('Xóa lần ghi này?', { ok: 'Xóa', danger: true })) return;
        try { await del('/api/allocations/' + b.dataset.del); toast('Đã xóa'); close(); await changed(); } catch (err) { toastErr(err); }
      });
    },
  });
}

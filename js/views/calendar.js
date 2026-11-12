import { del, get, post } from '../api.js';
import { openJobForm } from '../forms.js';
import { changed } from '../state.js';
import { confirmDialog, empty, icon, sheet, toast, toastErr } from '../ui.js';
import {
  $, addDays, addMonths, dmy, h, iso, money, monthEnd, monthStart, niceDate, on, pad, parseISO, SESSION_KINDS, short, today,
} from '../util.js';

let mode = 'month';
let cursor = today();
const DOWS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const KIND_ICON = { shoot: '🎥', photo: '📷', edit: '✂️', deadline: '⚑', other: '•' };

const evLabel = s => `${s.start_time ? s.start_time + ' ' : ''}${s.title}`;

export async function calendarView(root) {
  let from, to;
  if (mode === 'month') {
    const ms = monthStart(cursor);
    const off = (parseISO(ms).getDay() + 6) % 7;
    from = addDays(ms, -off);
    to = addDays(from, 41);
  } else if (mode === 'week') {
    from = addDays(cursor, -((parseISO(cursor).getDay() + 6) % 7));
    to = addDays(from, 6);
  } else if (mode === 'list') {
    from = today(); to = addDays(from, 60);
  } else { from = to = today(); }
  const statFrom = mode === 'month' ? monthStart(cursor) : from, statTo = mode === 'month' ? monthEnd(cursor) : to;
  const [cal, st] = await Promise.all([get(`/api/calendar?from=${from}&to=${to}`), get(`/api/calendar/stats?from=${statFrom}&to=${statTo}`)]);
  const byDay = {};
  cal.sessions.forEach(s => (byDay[s.date] ||= []).push(s));
  const offs = new Set(cal.day_offs.map(d => d.date));
  const conflictIds = new Set(cal.conflicts.flatMap(c => [c.a_id, c.b_id]));
  const conflictDays = new Set(cal.conflicts.map(c => c.date));
  const t = today();
  const title = mode === 'month' ? `Tháng ${Number(cursor.slice(5, 7))}/${cursor.slice(0, 4)}` :
    mode === 'week' ? `Tuần ${dmy(from).slice(0, 5)} – ${dmy(to).slice(0, 5)}` : mode === 'list' ? '60 ngày tới' : niceDate(t);

  let body = '';
  if (mode === 'month') {
    const cells = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const ss = byDay[d] || [];
      const cls = ['day', d.slice(0, 7) !== cursor.slice(0, 7) ? 'out' : '', d === t ? 'today' : '', offs.has(d) ? 'off' : '', conflictDays.has(d) ? 'conflict' : ''].join(' ');
      cells.push(`<button class="${cls}" data-day="${d}" aria-label="${h(niceDate(d))}, ${ss.length} việc">
        <span class="dn">${Number(d.slice(8))}</span>
        ${ss.slice(0, 3).map(s => `<span class="ev ${s.kind} ${s.work_status === 'cancelled' ? 'cancelled' : ''}${s.draft ? ' draft' : ''}">${h(evLabel(s))}</span>`).join('')}
        ${ss.length > 3 ? `<span class="faint small">+${ss.length - 3}</span>` : ''}</button>`);
    }
    body = `<div class="cal">${DOWS.map(x => `<div class="dow">${x}</div>`).join('')}${cells.join('')}</div>`;
  } else if (mode === 'week') {
    const cols = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const ss = byDay[d] || [];
      cols.push(`<div class="col ${d === t ? 'today' : ''}">
        <div class="row"><b>${DOWS[(parseISO(d).getDay() + 6) % 7]} ${dmy(d).slice(0, 5)}</b><span class="spacer"></span>
          <button class="btn sm ghost icon-btn" data-addday="${d}" aria-label="Thêm show ngày này">${icon('plus')}</button></div>
        ${offs.has(d) ? '<p class="small faint">Ngày nghỉ</p>' : ''}
        ${ss.map(s => `<div class="ev ${s.kind} ${s.work_status === 'cancelled' ? 'cancelled' : ''}${s.draft ? ' draft' : ''}" data-job="${h(s.job_id)}" role="button" tabindex="0">
          <b>${KIND_ICON[s.kind]} ${h(s.title)}</b><br>${s.start_time ? h(s.start_time + '–' + (s.end_time || '')) : 'Cả ngày'}${s.location ? '<br>' + h(s.location) : ''}
          ${conflictIds.has(s.id) ? '<br><b>Trùng giờ</b>' : ''}</div>`).join('')}</div>`);
    }
    body = `<div class="week">${cols.join('')}</div>`;
  } else {
    const days = Object.keys(byDay).sort();
    body = days.length ? `<div class="list">${days.map(d => `<div class="day-head"><span>${h(niceDate(d))}</span><span>${offs.has(d) ? 'Ngày nghỉ' : ''}</span></div>
      ${byDay[d].map(sessionItem(conflictIds)).join('')}`).join('')}</div>`
      : empty('🗓', mode === 'today' ? 'Hôm nay không có lịch làm việc.' : 'Chưa có lịch làm việc trong 60 ngày tới.', '<button class="btn" data-addday="' + t + '">Thêm show</button>');
  }

  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Lịch làm việc</h1><p class="muted">Ngày quay, ngày chụp, ngày dựng và hạn bàn giao của từng show.</p></div>
      <button class="btn primary" data-addday="${mode === 'month' && cursor.slice(0, 7) !== t.slice(0, 7) ? monthStart(cursor) : t}">${icon('plus')}Show mới</button></div>
    <div class="row wrap">
      <div class="seg" role="group" aria-label="Chế độ xem">${[['month', 'Tháng'], ['week', 'Tuần'], ['list', 'Danh sách'], ['today', 'Hôm nay']].map(([k, l]) => `<button data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${mode === 'month' || mode === 'week' ? `<button class="btn ghost icon-btn" data-nav="-1" aria-label="Trước">${icon('left')}</button>
        <b>${h(title)}</b><button class="btn ghost icon-btn" data-nav="1" aria-label="Sau">${icon('right')}</button>
        <button class="btn sm" data-nav="0">Hôm nay</button>` : `<b>${h(title)}</b>`}
    </div>
    ${cal.conflicts.length ? `<div class="notice danger mt">Có ${cal.conflicts.length} chỗ trùng giờ: ${cal.conflicts.slice(0, 3).map(c => `${h(c.a_title)} và ${h(c.b_title)} (${dmy(c.date).slice(0, 5)})`).join('; ')}</div>` : ''}
    <section class="mt">${body}</section>
    <div class="kind-legend mt">${Object.entries(SESSION_KINDS).filter(([k]) => k !== 'other').map(([k, l]) => `<span class="ev ${k}">${KIND_ICON[k]} ${h(l)}</span>`).join('')}<span class="ev other">▨ Ngày nghỉ</span></div>
    <section class="panel mt"><div class="panel-head"><h2>${mode === 'month' ? 'Tổng hợp tháng' : 'Tổng hợp'}</h2></div>
      <div class="stats g4">
        <div class="stat"><div class="k">Số ngày đi làm</div><div class="stat-v">${st.work_days}</div></div>
        <div class="stat"><div class="k">Số giờ làm</div><div class="stat-v">${String(st.hours).replace('.', ',')} giờ</div><div class="n">${st.sessions} buổi có ghi giờ hoặc cả ngày</div></div>
        <div class="stat"><div class="k">Tiền công các show</div><div class="stat-v">${money(st.fee_total)}</div><div class="n">${st.jobs} show</div></div>
        <div class="stat"><div class="k">Sẽ thu từ show đã nhận</div><div class="stat-v">${money(st.expected_from_booked)}</div><div class="n">${st.booked_jobs} show chưa xong</div></div>
      </div></section>
  </div>`;
  const rerender = () => calendarView(root);
  on(root, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; rerender(); });
  on(root, 'click', '[data-nav]', (e, b) => {
    const n = Number(b.dataset.nav);
    cursor = n === 0 ? today() : mode === 'month' ? addMonths(monthStart(cursor), n) : addDays(cursor, 7 * n);
    rerender();
  });
  on(root, 'click', '[data-day]', (e, b) => dayPanel(b.dataset.day, byDay[b.dataset.day] || [], cal.day_offs.find(x => x.date === b.dataset.day), conflictIds));
  on(root, 'click', '[data-addday]', (e, b) => openJobForm(null, { date: b.dataset.addday }));
  on(root, 'click', '[data-job]', (e, b) => { location.hash = '#/job/' + b.dataset.job; });
}

const sessionItem = conflictIds => s => `<a class="item" href="#/job/${h(s.job_id)}">
  <span class="ic">${KIND_ICON[s.kind]}</span>
  <span><div class="t">${h(s.title)}${s.work_status === 'cancelled' ? ' (đã hủy)' : ''}</div>
    <div class="s">${h(SESSION_KINDS[s.kind])}, ${s.start_time ? h(s.start_time + '–' + (s.end_time || '')) : 'cả ngày'}${s.location ? ', ' + h(s.location) : ''}${s.client_name ? ', ' + h(s.client_name) : ''}</div></span>
  <span class="v small">${conflictIds.has(s.id) ? '<span class="chip danger">Trùng giờ</span>' : ''}${s.draft ? '<span class="chip amber">Nháp</span>' : s.kind !== 'deadline' ? `<small>${short(s.total_fee)}</small>` : ''}</span></a>`;

function dayPanel(d, ss, off, conflictIds) {
  sheet(niceDate(d), `<div class="stack">
    ${ss.length ? `<div class="list">${ss.map(sessionItem(conflictIds)).join('')}</div>` : '<p class="muted">Chưa có việc nào trong ngày.</p>'}
    ${off ? `<div class="notice">Ngày nghỉ${off.note ? ': ' + h(off.note) : ''}</div>` : ''}
    <div class="row wrap">
      <button class="btn primary" data-a="add">${icon('plus')}Thêm show ngày này</button>
      ${off ? `<button class="btn" data-a="unoff">Bỏ ngày nghỉ</button>` : `<button class="btn" data-a="off">Đánh dấu ngày nghỉ</button>`}
    </div></div>`, {
    onMount(root, close) {
      on(root, 'click', 'a.item', () => close());
      on(root, 'click', '[data-a]', async (e, b) => {
        try {
          if (b.dataset.a === 'add') { close(); openJobForm(null, { date: d }); }
          if (b.dataset.a === 'off') { await post('/api/day-offs', { date: d }); toast('Đã đánh dấu ngày nghỉ'); close(); await changed(); }
          if (b.dataset.a === 'unoff') { await del('/api/day-offs/' + off.id); toast('Đã bỏ ngày nghỉ'); close(); await changed(); }
        } catch (err) { toastErr(err); }
      });
    },
  });
}

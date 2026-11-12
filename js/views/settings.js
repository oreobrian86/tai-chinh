import { del, download, get, patch, post, put } from '../api.js';
import { runtime } from '../app.js';
import * as google from '../google.js';
import { changed, state } from '../state.js';
import { busy, confirmDialog, field, formData, icon, options, sheet, showErrors, toast, toastErr } from '../ui.js';
import { $, ACCOUNT_KINDS, formatMoneyInput, h, money, on, parseMoney } from '../util.js';

export async function settingsView(root) {
  const [accounts, backups, settings] = await Promise.all([get('/api/accounts'), get('/api/backups').catch(() => []), get('/api/settings')]);
  const cats = state.categories;
  const info = runtime.store?.info?.() || {};
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Cài đặt</h1></div></div>
    <div class="grid g2">
      <section class="panel"><div class="panel-head"><h2>Tài khoản tiền</h2><button class="btn sm" data-acc-new>${icon('plus')}Thêm</button></div>
        <div class="list">${accounts.map(a => `<div class="item" data-acc="${h(a.id)}"><span class="ic">${a.kind === 'bank' ? '🏦' : a.kind === 'ewallet' ? '📱' : a.kind === 'savings' ? '🐖' : '💵'}</span>
          <span><div class="t">${h(a.name)}${a.archived ? ' <span class="chip">Lưu trữ</span>' : ''}</div><div class="s">${h(ACCOUNT_KINDS[a.kind])}</div></span>
          <span class="v">${money(a.balance)}</span></div>`).join('')}</div>
        <p class="small muted mt-xs">Số dư được tính từ giao dịch. Để chỉnh số dư cho khớp thực tế, bấm vào tài khoản rồi nhập "Số dư thực tế hiện tại".</p></section>

      <section class="panel"><div class="panel-head"><h2>Danh mục</h2><button class="btn sm" data-cat-new>${icon('plus')}Thêm</button></div>
        <h3>Chi tiêu</h3><div class="row wrap mt-xs">${cats.filter(c => c.kind === 'expense').map(c => `<button class="chip cat-chip" data-cat="${h(c.id)}">${h(c.icon || '')} ${h(c.name)}</button>`).join('')}</div>
        <h3 class="mt">Thu khác</h3><div class="row wrap mt-xs">${cats.filter(c => c.kind === 'income').map(c => `<button class="chip cat-chip" data-cat="${h(c.id)}">${h(c.icon || '')} ${h(c.name)}</button>`).join('')}</div>
      </section>

      <section class="panel"><div class="panel-head"><h2>Khách hàng, chủ show</h2></div>
        ${state.clients.length ? `<div class="list">${state.clients.map(c => `<div class="item" data-client="${h(c.id)}"><span class="ic">👤</span><span><div class="t">${h(c.name)}</div><div class="s">${h(c.phone || '')}</div></span><span class="v"></span></div>`).join('')}</div>`
          : '<p class="muted small">Khách được tự thêm khi bạn tạo show.</p>'}</section>

      <section class="panel"><div class="panel-head"><h2>Bảo mật và hiển thị</h2></div>
        <div class="form">
          ${field('Tên hiển thị', `<input class="input" name="display_name" maxlength="100" value="${h(settings.display_name || '')}" placeholder="Tên của bạn">`)}
          ${field('Tự khóa sau khi không dùng', `<select class="input" name="lock_minutes">${options([[0, 'Không tự khóa'], [2, '2 phút'], [5, '5 phút'], [10, '10 phút'], [30, '30 phút'], [60, '1 giờ']], settings.lock_minutes)}</select>`,
            'Khi khóa, dữ liệu bị xóa khỏi bộ nhớ của trình duyệt; mở lại bằng đăng nhập Google.')}
          <label class="check"><input type="checkbox" name="exclude_one_off"${settings.exclude_one_off ? ' checked' : ''}> Bỏ các khoản chi lớn bất thường khỏi mức chi trung bình khi dự báo</label>
          <div class="row wrap"><button class="btn" data-lock>${icon('lock')}Khóa ngay</button>
            ${runtime.demo ? '' : '<button class="btn ghost danger" data-logout>Đăng xuất Google</button>'}</div>
        </div></section>

      <section class="panel"><div class="panel-head"><h2>Dữ liệu trên Google Drive</h2></div>
        ${runtime.demo ? '<p class="muted small">Chế độ dùng thử không lưu lên Google.</p>' : `
        <p class="small muted">Dữ liệu nằm trong file Google Sheet riêng của bạn. Có thể mở ra xem, nhưng <b>đừng sửa tay</b> để tránh lệch số. Google Sheet tự lưu lịch sử phiên bản (Tệp → Nhật ký phiên bản).</p>
        <div class="row wrap mt-xs">${info.url ? `<a class="btn sm" href="${h(info.url)}" target="_blank" rel="noopener noreferrer">Mở file dữ liệu</a>` : ''}
          <button class="btn sm sage" data-backup>Sao lưu ngay</button></div>
        <h3 class="mt">Bản sao lưu (tự động mỗi ngày, giữ 30 bản)</h3>
        <div class="list mt-xs">${backups.slice(0, 8).map(b => `<div class="item"><span class="ic">🗄</span><span><div class="t small">${h(b.name)}</div>
          <div class="s">${h(new Date(b.created_at).toLocaleString('vi-VN'))}</div></span>
          <span class="v"><button class="btn sm ghost" data-restore-id="${h(b.id)}" data-restore-name="${h(b.name)}">Khôi phục</button></span></div>`).join('') || '<p class="muted small">Chưa có bản sao lưu.</p>'}</div>`}
        <h3 class="mt">Xuất và nhập dữ liệu</h3>
        <div class="row wrap mt-xs"><button class="btn sm" data-export="json">Toàn bộ dữ liệu (JSON)</button><button class="btn sm" data-export="csv">Giao dịch (CSV)</button>
          <button class="btn sm" data-export="report">Báo cáo 12 tháng (CSV)</button>
          ${runtime.demo ? '' : '<button class="btn sm" data-restore-json>Khôi phục từ file JSON</button>'}</div>
      </section>
    </div></div>`;

  on(root, 'click', '[data-acc-new]', () => accountForm());
  on(root, 'click', '[data-acc]', (e, el) => accountForm(accounts.find(a => a.id === el.dataset.acc)));
  on(root, 'click', '[data-cat-new]', () => categoryForm());
  on(root, 'click', '[data-cat]', (e, el) => categoryForm(cats.find(c => c.id === el.dataset.cat)));
  on(root, 'click', '[data-client]', (e, el) => clientForm(state.clients.find(c => c.id === el.dataset.client)));
  const save = async patchBody => { try { state.settings = await put('/api/settings', patchBody); toast('Đã lưu'); } catch (err) { toastErr(err); } };
  $('[name=lock_minutes]', root).addEventListener('change', e => save({ lock_minutes: Number(e.target.value) }));
  $('[name=exclude_one_off]', root).addEventListener('change', e => save({ exclude_one_off: e.target.checked }));
  $('[name=display_name]', root).addEventListener('change', e => save({ display_name: e.target.value }));
  on(root, 'click', '[data-lock]', () => window.dispatchEvent(new Event('app-lock')));
  on(root, 'click', '[data-logout]', async () => {
    if (!await confirmDialog('Đăng xuất và thu hồi quyền của ứng dụng với Google Drive? Dữ liệu vẫn nằm nguyên trong Drive của bạn.', { ok: 'Đăng xuất' })) return;
    google.revoke(); location.reload();
  });
  on(root, 'click', '[data-backup]', (e, b) => busy(b, async () => { try { const r = await post('/api/backups'); toast('Đã sao lưu: ' + r.name); await changed(); } catch (err) { toastErr(err); } }));
  on(root, 'click', '[data-restore-id]', (e, b) => restoreBackup(b.dataset.restoreId, b.dataset.restoreName));
  on(root, 'click', '[data-restore-json]', () => restoreJson());
  on(root, 'click', '[data-export]', (e, b) => {
    const k = b.dataset.export;
    const p = k === 'json' ? '/api/export/all.json' : k === 'csv' ? '/api/export/transactions.csv' : '/api/export/report.csv?months=12';
    download(p, 'du-lieu').catch(toastErr);
  });
}

function accountForm(a = null) {
  sheet(a ? a.name : 'Tài khoản mới', `<form class="form" novalidate>
    ${field('Tên', `<input class="input" name="name" value="${h(a?.name || '')}" placeholder="Ví dụ: Vietcombank, MoMo" maxlength="200">`)}
    ${field('Loại', `<select class="input" name="kind">${options(Object.entries(ACCOUNT_KINDS), a?.kind || 'bank')}</select>`)}
    ${a ? `${field('Số dư thực tế hiện tại', `<input class="input" name="actual" inputmode="numeric" placeholder="${h(new Intl.NumberFormat('vi-VN').format(a.balance))}">`, 'Nhập nếu muốn điều chỉnh cho khớp. Ứng dụng tạo một giao dịch "Điều chỉnh số dư", không tính là thu hay chi.')}`
      : field('Số dư ban đầu', `<input class="input" name="opening_balance" inputmode="numeric" placeholder="0">`)}
    <div class="row">${a ? `<button type="button" class="btn ghost danger" data-del>${a.archived ? 'Đã lưu trữ' : 'Xóa / lưu trữ'}</button>` : ''}<span class="spacer"></span><button class="btn primary" type="submit">Lưu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      ['actual', 'opening_balance'].forEach(n => form[n] && formatMoneyInput(form[n]));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        await busy(form.querySelector('[type=submit]'), async () => {
          try {
            if (a) {
              await patch('/api/accounts/' + a.id, { name: d.name, kind: d.kind, archived: false });
              if (d.actual !== '') {
                const target = parseMoney(d.actual);
                const diff = target - a.balance;
                if (diff) await post('/api/transactions', { kind: 'adjustment', amount: diff, account_id: a.id, description: 'Điều chỉnh số dư' });
              }
            } else await post('/api/accounts', { name: d.name, kind: d.kind, opening_balance: parseMoney(d.opening_balance) || 0 });
            toast('Đã lưu'); close(); await changed();
          } catch (err) { showErrors(form, err); }
        });
      });
      $('[data-del]', root)?.addEventListener('click', async () => {
        if (!await confirmDialog('Tài khoản có giao dịch sẽ được lưu trữ (không mất dữ liệu). Tài khoản trống sẽ bị xóa. Tiếp tục?', { ok: 'Tiếp tục', danger: true })) return;
        try { const r = await del('/api/accounts/' + a.id); toast(r.archived ? 'Đã lưu trữ tài khoản' : 'Đã xóa tài khoản'); close(); await changed(); } catch (err) { toastErr(err); }
      });
    },
  });
}

function categoryForm(c = null) {
  const same = c ? state.categories.filter(x => x.kind === c.kind && x.id !== c.id) : [];
  sheet(c ? 'Sửa danh mục' : 'Danh mục mới', `<form class="form" novalidate>
    <div class="two">${field('Biểu tượng', `<input class="input" name="icon" value="${h(c?.icon || '')}" maxlength="4" placeholder="🍜">`)}
      ${field('Tên', `<input class="input" name="name" value="${h(c?.name || '')}" maxlength="60">`)}</div>
    ${c ? '' : field('Loại', `<select class="input" name="kind">${options([['expense', 'Chi tiêu'], ['income', 'Thu khác']], 'expense')}</select>`)}
    ${c && !c.is_system ? field(`Khi xóa, chuyển ${c.usage} giao dịch sang`, `<select class="input" name="reassign">${options(same.map(x => [x.id, x.name]))}</select>`) : ''}
    <div class="row">${c && !c.is_system ? `<button type="button" class="btn ghost danger" data-del>${icon('trash')}Xóa</button>` : ''}<span class="spacer"></span><button class="btn primary" type="submit">Lưu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        await busy(form.querySelector('[type=submit]'), async () => {
          try { c ? await patch('/api/categories/' + c.id, { name: d.name, icon: d.icon || null }) : await post('/api/categories', { name: d.name, icon: d.icon || null, kind: d.kind }); toast('Đã lưu'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
      $('[data-del]', root)?.addEventListener('click', async () => {
        try { const r = await del(`/api/categories/${c.id}?reassign_to=${encodeURIComponent(form.reassign.value)}`); toast(`Đã xóa danh mục${r.moved ? `, chuyển ${r.moved} giao dịch` : ''}`); close(); await changed(); }
        catch (err) { toastErr(err); }
      });
    },
  });
}

function clientForm(c) {
  sheet('Khách hàng', `<form class="form" novalidate>
    ${field('Tên', `<input class="input" name="name" value="${h(c.name)}" maxlength="200">`)}
    ${field('Số điện thoại', `<input class="input" name="phone" value="${h(c.phone || '')}" inputmode="tel" maxlength="30">`)}
    ${field('Ghi chú', `<textarea class="input" name="note" maxlength="2000">${h(c.note || '')}</textarea>`)}
    <div class="row"><button type="button" class="btn ghost danger" data-del>${icon('trash')}Xóa</button><span class="spacer"></span><button class="btn primary" type="submit">Lưu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        try { await put('/api/clients/' + c.id, { name: d.name, phone: d.phone || null, note: d.note || null }); toast('Đã lưu'); close(); await changed(); } catch (err) { showErrors(form, err); }
      });
      $('[data-del]', root).addEventListener('click', async () => {
        if (!await confirmDialog('Xóa khách này? Các show cũ vẫn giữ nguyên.', { ok: 'Xóa', danger: true })) return;
        try { await del('/api/clients/' + c.id); close(); await changed(); } catch (err) { toastErr(err); }
      });
    },
  });
}


async function restoreBackup(id, name) {
  if (!await confirmDialog(`Thay toàn bộ dữ liệu hiện tại bằng bản sao lưu "${name}"? Ứng dụng sẽ tự sao lưu dữ liệu hiện tại trước khi khôi phục.`, { ok: 'Khôi phục', danger: true })) return;
  try { const r = await post('/api/backups/restore', { backup_id: id }); toast('Đã khôi phục. Bản an toàn: ' + r.safety_backup); await changed(); }
  catch (err) { toastErr(err); }
}

function restoreJson() {
  sheet('Khôi phục từ file JSON', `<form class="form" novalidate>
    <div class="notice warn">Toàn bộ dữ liệu hiện tại sẽ được thay bằng nội dung file. Ứng dụng tự sao lưu dữ liệu hiện tại trước khi khôi phục. Nhận cả file xuất từ bản chạy trên máy tính trước đây.</div>
    ${field('File dữ liệu (.json)', `<input class="input" type="file" name="file" accept=".json,application/json">`)}
    <div class="sheet-foot"><button class="btn danger block" type="submit">Khôi phục</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = form.file.files[0];
        if (!f) return showErrors(form, { fields: { file: 'Chọn file .json' } });
        await busy(form.querySelector('[type=submit]'), async () => {
          try { await post('/api/backups/restore', { json: await f.text() }); toast('Đã khôi phục dữ liệu'); close(); await changed(); }
          catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

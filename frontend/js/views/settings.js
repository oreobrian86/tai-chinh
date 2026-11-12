import { api, del, download, get, patch, post, put } from '../api.js';
import { changed, state } from '../state.js';
import { busy, confirmDialog, empty, field, formData, icon, options, sheet, showErrors, toast, toastErr } from '../ui.js';
import { $, ACCOUNT_KINDS, formatMoneyInput, h, money, on, parseMoney, today } from '../util.js';

export async function settingsView(root) {
  const [accounts, sessions, backups, settings] = await Promise.all([get('/api/accounts'), get('/api/auth/sessions'), get('/api/backups'), get('/api/settings')]);
  const cats = state.categories;
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Cài đặt</h1></div></div>
    <div class="grid g2">
      <section class="panel"><div class="panel-head"><h2>Tài khoản tiền</h2><button class="btn sm" data-acc-new>${icon('plus')}Thêm</button></div>
        <div class="list">${accounts.map(a => `<div class="item" data-acc="${h(a.id)}"><span class="ic">${a.kind === 'bank' ? '🏦' : a.kind === 'ewallet' ? '📱' : a.kind === 'savings' ? '🐖' : '💵'}</span>
          <span><div class="t">${h(a.name)}${a.archived ? ' <span class="chip">Lưu trữ</span>' : ''}</div><div class="s">${h(ACCOUNT_KINDS[a.kind])}</div></span>
          <span class="v">${money(a.balance)}</span></div>`).join('')}</div>
        <p class="small muted mt-xs">Số dư được tính từ giao dịch. Để chỉnh số dư cho khớp thực tế, bấm vào tài khoản rồi chọn "Điều chỉnh số dư".</p></section>

      <section class="panel"><div class="panel-head"><h2>Danh mục</h2><button class="btn sm" data-cat-new>${icon('plus')}Thêm</button></div>
        <h3>Chi tiêu</h3><div class="row wrap mt-xs">${cats.filter(c => c.kind === 'expense').map(c => `<button class="chip cat-chip" data-cat="${h(c.id)}">${h(c.icon || '')} ${h(c.name)}</button>`).join('')}</div>
        <h3 class="mt">Thu khác</h3><div class="row wrap mt-xs">${cats.filter(c => c.kind === 'income').map(c => `<button class="chip cat-chip" data-cat="${h(c.id)}">${h(c.icon || '')} ${h(c.name)}</button>`).join('')}</div>
      </section>

      <section class="panel"><div class="panel-head"><h2>Khách hàng, chủ show</h2></div>
        ${state.clients.length ? `<div class="list">${state.clients.map(c => `<div class="item" data-client="${h(c.id)}"><span class="ic">👤</span><span><div class="t">${h(c.name)}</div><div class="s">${h(c.phone || '')}</div></span><span class="v"></span></div>`).join('')}</div>`
          : '<p class="muted small">Khách được tự thêm khi bạn tạo show.</p>'}</section>

      <section class="panel"><div class="panel-head"><h2>Bảo mật</h2></div>
        <div class="form">
          ${field('Tự khóa sau khi không dùng', `<select class="input" name="lock_minutes">${options([[0, 'Không tự khóa'], [2, '2 phút'], [5, '5 phút'], [10, '10 phút'], [30, '30 phút'], [60, '1 giờ']], settings.lock_minutes)}</select>`)}
          <label class="check"><input type="checkbox" name="exclude_one_off"${settings.exclude_one_off ? ' checked' : ''}> Bỏ các khoản chi lớn bất thường khỏi mức chi trung bình khi dự báo</label>
          <div class="row wrap"><button class="btn" data-pin>${state.user?.has_pin ? 'Đổi hoặc tắt mã PIN' : 'Đặt mã PIN mở khóa'}</button><button class="btn" data-pw>Đổi mật khẩu</button></div>
        </div>
        <h3 class="mt">Thiết bị đang đăng nhập</h3>
        <div class="list">${sessions.map(s => `<div class="item"><span class="ic">${/mobile|android|iphone/i.test(s.user_agent || '') ? '📱' : '💻'}</span>
          <span><div class="t">${h(deviceName(s.user_agent))}${s.current ? ' <span class="chip sage">Thiết bị này</span>' : ''}</div>
          <div class="s">${h(s.ip || '')}, dùng lần cuối ${h(new Date(s.last_seen_at).toLocaleString('vi-VN'))}</div></span>
          <span class="v">${s.current ? '' : `<button class="btn sm ghost danger" data-revoke="${h(s.id)}">Đăng xuất</button>`}</span></div>`).join('')}</div>
        ${sessions.length > 1 ? '<button class="btn sm mt-xs" data-revoke-all>Đăng xuất mọi thiết bị khác</button>' : ''}
      </section>

      <section class="panel"><div class="panel-head"><h2>Sao lưu và dữ liệu</h2></div>
        <p class="small muted">Ứng dụng tự sao lưu mỗi ngày và giữ 30 bản gần nhất trong thư mục data/backups. Nên chép định kỳ sang USB hoặc ổ khác.</p>
        <div class="row wrap mt-xs"><button class="btn sage" data-backup>Sao lưu ngay</button><button class="btn" data-restore>Khôi phục từ file</button></div>
        <div class="list mt-xs">${backups.slice(0, 6).map(b => `<div class="item"><span class="ic">🗄</span><span><div class="t small">${h(b.name)}</div>
          <div class="s">${h(new Date(b.created_at).toLocaleString('vi-VN'))}, ${(b.size / 1024).toFixed(0)} KB</div></span>
          <span class="v"><button class="btn sm ghost" data-dl="${h(b.name)}" aria-label="Tải về">${icon('download')}</button>
          <button class="btn sm ghost" data-restore-name="${h(b.name)}">Khôi phục</button></span></div>`).join('') || '<p class="muted small">Chưa có bản sao lưu.</p>'}</div>
        <h3 class="mt">Xuất dữ liệu</h3>
        <div class="row wrap mt-xs"><button class="btn sm" data-export="json">Toàn bộ dữ liệu (JSON)</button><button class="btn sm" data-export="csv">Giao dịch (CSV)</button><button class="btn sm" data-export="xlsx">Báo cáo 12 tháng (Excel)</button></div>
      </section>

      <section class="panel"><div class="panel-head"><h2>Dùng trên điện thoại</h2></div>
        <p class="small muted">Cách an toàn nhất là cài Tailscale trên máy tính và điện thoại, rồi mở địa chỉ Tailscale của máy tính. Xem hướng dẫn từng bước trong file docs/SECURITY.md. Sau khi mở được trên điện thoại, chọn "Thêm vào màn hình chính" để dùng như một ứng dụng.</p>
        <div class="row wrap mt"><button class="btn" data-lock>${icon('lock')}Khóa ngay</button><button class="btn ghost danger" data-logout>Đăng xuất</button></div>
      </section>
    </div></div>`;

  const reload = () => settingsView(root);
  on(root, 'click', '[data-acc-new]', () => accountForm());
  on(root, 'click', '[data-acc]', (e, el) => accountForm(accounts.find(a => a.id === el.dataset.acc)));
  on(root, 'click', '[data-cat-new]', () => categoryForm());
  on(root, 'click', '[data-cat]', (e, el) => categoryForm(cats.find(c => c.id === el.dataset.cat)));
  on(root, 'click', '[data-client]', (e, el) => clientForm(state.clients.find(c => c.id === el.dataset.client)));
  $('[name=lock_minutes]', root).addEventListener('change', async e => { try { state.settings = await put('/api/settings', { lock_minutes: Number(e.target.value) }); toast('Đã lưu'); } catch (err) { toastErr(err); } });
  $('[name=exclude_one_off]', root).addEventListener('change', async e => { try { state.settings = await put('/api/settings', { exclude_one_off: e.target.checked }); toast('Đã lưu'); } catch (err) { toastErr(err); } });
  on(root, 'click', '[data-pin]', () => pinForm());
  on(root, 'click', '[data-pw]', () => passwordForm());
  on(root, 'click', '[data-revoke]', async (e, b) => { try { await del('/api/auth/sessions/' + b.dataset.revoke); toast('Đã đăng xuất thiết bị'); reload(); } catch (err) { toastErr(err); } });
  on(root, 'click', '[data-revoke-all]', async () => { try { const r = await post('/api/auth/sessions/revoke-others'); toast(`Đã đăng xuất ${r.revoked} thiết bị`); reload(); } catch (err) { toastErr(err); } });
  on(root, 'click', '[data-backup]', async (e, b) => busy(b, async () => { try { const r = await post('/api/backups'); toast('Đã sao lưu: ' + r.name); reload(); } catch (err) { toastErr(err); } }));
  on(root, 'click', '[data-dl]', (e, b) => download('/api/backups/' + encodeURIComponent(b.dataset.dl), b.dataset.dl).catch(toastErr));
  on(root, 'click', '[data-restore]', () => restoreForm());
  on(root, 'click', '[data-restore-name]', (e, b) => restoreForm(b.dataset.restoreName));
  on(root, 'click', '[data-export]', (e, b) => {
    const k = b.dataset.export;
    const p = k === 'json' ? '/api/export/all.json' : k === 'csv' ? '/api/export/transactions.csv' : '/api/export/report.xlsx?months=12';
    download(p, 'du-lieu').catch(toastErr);
  });
  on(root, 'click', '[data-lock]', () => window.dispatchEvent(new Event('app-lock')));
  on(root, 'click', '[data-logout]', async () => { try { await post('/api/auth/logout'); } finally { location.reload(); } });
}

const deviceName = ua => {
  ua = ua || '';
  const os = /iphone|ipad/i.test(ua) ? 'iPhone/iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Thiết bị';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : '';
  return br ? `${br} trên ${os}` : os;
};

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

function pinForm() {
  sheet('Mã PIN mở khóa', `<form class="form" novalidate>
    ${field('Mã PIN mới (6 số)', `<input class="input" name="pin" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off">`, 'Để trống rồi lưu để tắt PIN (khi đó mở khóa bằng mật khẩu).')}
    ${field('Mật khẩu hiện tại', `<input class="input" type="password" name="password" autocomplete="current-password">`)}
    <div class="sheet-foot"><button class="btn primary block" type="submit">Lưu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if (d.pin && !/^\d{6}$/.test(d.pin)) return showErrors(form, { fields: { pin: 'PIN gồm đúng 6 chữ số' } });
        try { const r = await post('/api/auth/pin', { pin: d.pin || null, password: d.password }); state.user.has_pin = r.has_pin; toast(r.has_pin ? 'Đã đặt PIN' : 'Đã tắt PIN'); close(); }
        catch (err) { showErrors(form, err); }
      });
    },
  });
}

function passwordForm() {
  sheet('Đổi mật khẩu', `<form class="form" novalidate>
    ${field('Mật khẩu hiện tại', `<input class="input" type="password" name="current_password" autocomplete="current-password">`)}
    ${field('Mật khẩu mới', `<input class="input" type="password" name="new_password" autocomplete="new-password">`, 'Ít nhất 10 ký tự. Nên dùng một câu dài dễ nhớ.')}
    <p class="small muted">Các thiết bị khác sẽ bị đăng xuất.</p>
    <div class="sheet-foot"><button class="btn primary block" type="submit">Đổi mật khẩu</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        try { await post('/api/auth/password', formData(form)); toast('Đã đổi mật khẩu'); close(); } catch (err) { showErrors(form, err); }
      });
    },
  });
}

function restoreForm(name = null) {
  sheet('Khôi phục dữ liệu', `<form class="form" novalidate>
    <div class="notice warn">Toàn bộ dữ liệu hiện tại sẽ được thay bằng bản sao lưu. Ứng dụng tự tạo một bản sao lưu của dữ liệu hiện tại trước khi khôi phục.</div>
    ${name ? `<p>Bản sao lưu: <b>${h(name)}</b></p>` : field('File sao lưu (.db)', `<input class="input" type="file" name="file" accept=".db">`)}
    ${field('Nhập mật khẩu để xác nhận', `<input class="input" type="password" name="password" autocomplete="current-password">`)}
    <div class="sheet-foot"><button class="btn danger block" type="submit">Khôi phục</button></div></form>`, {
    onMount(root, close) {
      const form = $('form', root);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData();
        fd.append('password', form.password.value);
        if (name) fd.append('name', name);
        else if (form.file.files[0]) fd.append('file', form.file.files[0]);
        else return showErrors(form, { fields: { file: 'Chọn file sao lưu' } });
        await busy(form.querySelector('[type=submit]'), async () => {
          try { await api('POST', '/api/backups/restore', fd, { form: true }); toast('Đã khôi phục. Vui lòng đăng nhập lại.'); setTimeout(() => location.reload(), 1200); }
          catch (err) { showErrors(form, err); }
        });
      });
    },
  });
}

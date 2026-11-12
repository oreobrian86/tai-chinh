// Sao lưu: tạo bản sao file Sheet trên Google Drive của bạn. Khôi phục: từ bản sao lưu hoặc file JSON đã xuất.
import { TABLES, normalize } from './db.js';
import { AppError } from './store.js';

const KEEP = 30;

export class Backups {
  constructor(store, session) {
    this.store = store;
    this.session = session;
  }

  async list() {
    return (await this.store.listBackups()).map(f => ({ id: f.id, name: f.name, created_at: f.createdTime, url: f.webViewLink || null }));
  }

  async create(label = 'thu-cong') {
    const r = await this.store.backup(label);
    await this.prune();
    return { id: r.id, name: r.name };
  }

  async prune() {
    const all = await this.store.listBackups();  // mới nhất trước
    for (const f of all.slice(KEEP)) { try { await this.store.deleteFile(f.id); } catch (_) { } }
  }

  /** Tự sao lưu nếu lần gần nhất đã quá 24 giờ. Trả về true nếu vừa sao lưu. */
  async maybeAuto(lastIso) {
    if (lastIso && Date.now() - Date.parse(lastIso) < 24 * 3600 * 1000) return false;
    await this.create('tu-dong');
    return true;
  }

  /** body: { backup_id } hoặc { json: chuỗi JSON đã xuất }. Luôn tự sao lưu dữ liệu hiện tại trước. */
  async restore(body) {
    let data;
    if (body?.backup_id) {
      data = await this.store.readOther(body.backup_id);
    } else if (body?.json) {
      let obj;
      try { obj = JSON.parse(body.json); } catch (_) { throw new AppError(422, 'bad_file', 'File không phải JSON hợp lệ.'); }
      if (obj?.format !== 'finance-app-export' || !Array.isArray(obj.transactions)) {
        throw new AppError(422, 'bad_file', 'Đây không phải file dữ liệu xuất từ ứng dụng này.');
      }
      data = {};
      for (const t of TABLES) data[t] = Array.isArray(obj[t]) ? obj[t] : [];
    } else throw new AppError(422, 'validation', 'Chưa chọn bản sao lưu.');
    const clean = {};
    for (const t of TABLES) clean[t] = (data[t] || []).filter(r => r && typeof r === 'object').map(r => normalize(t, r));
    if (!clean.accounts.length && !clean.transactions.length) throw new AppError(422, 'empty', 'Bản sao lưu không có dữ liệu.');
    const current = await this.session.refresh();
    const oldCounts = Object.fromEntries(TABLES.map(t => [t, current.all(t).length]));
    const safety = await this.store.backup('truoc-khi-khoi-phuc');
    await this.store.replaceAll(clean, oldCounts);
    await this.session.refresh();
    return { ok: true, safety_backup: safety.name };
  }
}

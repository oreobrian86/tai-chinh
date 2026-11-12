// Đồng bộ HAI CHIỀU với Google Calendar:
//  • Đẩy lên: lịch làm việc trong app → một lịch riêng do app tạo (quyền calendar.app.created).
//    App là nguồn gốc; sửa sự kiện trong lịch riêng này sẽ bị ghi đè ở lần đồng bộ sau.
//  • Kéo về: sự kiện bạn thêm trong các lịch đã chọn (mặc định lịch chính) → show nháp chưa có giá
//    (quyền calendar.readonly — chỉ đọc, app không sửa hay xóa lịch cá nhân của bạn).
import * as fe from './finance.js';
import { AppError } from './store.js';

const API = 'https://www.googleapis.com/calendar/v3';
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const CAL_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const CAL_NAME = 'Lịch làm việc freelance';
const TZ = 'Asia/Ho_Chi_Minh';
const KIND = { shoot: ['🎥', 'Quay', '2'], photo: ['📷', 'Chụp', '7'], edit: ['✂️', 'Dựng', '3'], deadline: ['⚑', 'Hạn bàn giao', '11'], other: ['•', 'Việc', '8'] };
const WORK = { video: 'Quay phim', edit: 'Dựng phim', photo: 'Chụp ảnh', other: 'Khác' };

/** Mã sự kiện cố định theo mã buổi làm (Google chỉ cho chữ a–v và số 0–9). */
export const eventId = (prefix, uuid) => (prefix + uuid.replace(/-/g, '')).toLowerCase();

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const plusHours = (t, n) => {
  const [hh, mm] = t.split(':').map(Number);
  const m = Math.min(23 * 60 + 59, hh * 60 + mm + n * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Danh sách sự kiện cần có trên Google Calendar, tính từ dữ liệu app. */
export function desiredEvents(db, { includeFee = false, appUrl = '' } = {}) {
  const jobs = new Map(db.live('jobs').filter(j => j.work_status !== 'cancelled').map(j => [j.id, j]));
  const clients = new Map(db.all('clients').map(c => [c.id, c.name]));
  const out = [];
  for (const s of db.live('job_sessions')) {
    const j = jobs.get(s.job_id);
    if (!j || s.gcal) continue;  // buổi lấy từ Google Calendar: đã nằm trên lịch của bạn, không đẩy lại
    const [icon, label, color] = KIND[s.kind] || KIND.other;
    const client = clients.get(j.client_id);
    const desc = [`${WORK[j.work_type] || ''}${client ? ` cho ${client}` : ''}`];
    if (includeFee) desc.push(`Tiền công: ${new Intl.NumberFormat('vi-VN').format(j.total_fee)}đ`);
    if (s.note) desc.push(s.note);
    if (j.description) desc.push(j.description);
    if (appUrl) desc.push(`Mở trong app: ${appUrl}#/job/${j.id}`);
    const ev = { id: eventId('s', s.id), summary: `${icon} ${label}: ${j.title}${client ? ` (${client})` : ''}`,
      location: s.location || j.location || '', description: desc.join('\n'), colorId: color };
    if (s.start_time) {
      const end = s.end_time && s.end_time > s.start_time ? s.end_time : plusHours(s.start_time, 2);
      ev.start = { dateTime: `${s.date}T${s.start_time}:00`, timeZone: TZ };
      ev.end = { dateTime: `${s.date}T${end}:00`, timeZone: TZ };
    } else {
      ev.start = { date: s.date };
      ev.end = { date: fe.addDays(s.date, 1) };
    }
    out.push(ev);
  }
  for (const d of db.live('day_offs')) {
    out.push({ id: eventId('o', d.id), summary: `Ngày nghỉ${d.note ? `: ${d.note}` : ''}`, location: '', description: '', colorId: '8',
      start: { date: d.date }, end: { date: fe.addDays(d.date, 1) }, transparency: 'transparent' });
  }
  for (const e of out) e.extendedProperties = { private: { app: 'finance', h: hash(JSON.stringify(e)) } };
  return out;
}

export class CalendarSync {
  /** canRead(): người dùng đã cho phép đọc lịch chưa (mặc định coi như có, để kiểm thử). */
  constructor(getToken, fetchImpl = (...a) => fetch(...a), { canRead = () => true } = {}) {
    this.getToken = getToken;
    this.fetch = fetchImpl;
    this.canRead = canRead;
  }

  async req(path, { method = 'GET', body } = {}) {
    const token = await this.getToken();
    let res;
    try {
      res = await this.fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    } catch (_) { throw new AppError(0, 'offline', 'Không kết nối được Google Calendar.'); }
    if (res.status === 401) throw new AppError(401, 'google_auth', 'Phiên đăng nhập Google đã hết hạn.');
    if (res.status === 403) {
      let m = '';
      try { m = (await res.json()).error?.message || ''; } catch (_) { }
      if (/insufficient|scope/i.test(m)) throw new AppError(403, 'gcal_scope', 'Chưa cấp quyền Google Calendar. Hãy đăng xuất, đăng nhập lại và tick ô cho phép Lịch.');
      if (/not been used|disabled/i.test(m)) throw new AppError(403, 'gcal_api', 'Google Calendar API chưa được bật trong dự án Google Cloud.');
      throw new AppError(403, 'gcal_forbidden', `Google Calendar từ chối: ${m}`);
    }
    return res;
  }

  async json(path, opts) {
    const res = await this.req(path, opts);
    if (!res.ok) {
      let m = `Google Calendar báo lỗi ${res.status}`;
      try { const j = await res.json(); if (j.error?.message) m += `: ${j.error.message}`; } catch (_) { }
      throw new AppError(res.status, 'gcal_error', m);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Dùng lịch đã lưu nếu còn, nếu không thì tạo lịch mới. Trả về mã lịch. */
  async ensureCalendar(id) {
    if (id) {
      const r = await this.req(`/calendars/${encodeURIComponent(id)}`);
      if (r.ok) return id;
      if (r.status !== 404 && r.status !== 410) throw new AppError(r.status, 'gcal_error', `Không mở được lịch (${r.status}).`);
    }
    const c = await this.json('/calendars', { method: 'POST', body: { summary: CAL_NAME, timeZone: TZ,
      description: 'Lịch do ứng dụng Tài chính & Lịch Freelance tạo và tự cập nhật. Sửa lịch làm việc trong app, đừng sửa ở đây.' } });
    return c.id;
  }

  async listEvents(calId) {
    const out = [];
    let page = '';
    do {
      const r = await this.json(`/calendars/${encodeURIComponent(calId)}/events?maxResults=2500&showDeleted=false&fields=items(id,status,extendedProperties),nextPageToken${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      out.push(...(r.items || []));
      page = r.nextPageToken || '';
    } while (page);
    return out;
  }

  async upsert(calId, ev) {
    const base = `/calendars/${encodeURIComponent(calId)}/events`;
    const body = { ...ev, status: 'confirmed' };
    const r = await this.req(`${base}/${ev.id}`, { method: 'PUT', body });
    if (r.ok) return;
    if (r.status !== 404) throw new AppError(r.status, 'gcal_error', `Không cập nhật được sự kiện (${r.status}).`);
    await this.json(base, { method: 'POST', body });
  }

  async remove(calId, id) {
    const r = await this.req(`/calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new AppError(r.status, 'gcal_error', `Không xóa được sự kiện (${r.status}).`);
  }

  /** Các lịch bạn có quyền xem (để chọn lịch cần lấy về). */
  async listCalendars() {
    const r = await this.json('/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,summary,summaryOverride,primary,accessRole)');
    return (r.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary }));
  }

  /** Sự kiện trong khoảng ngày [from, to], đã tách lịch lặp thành từng lần, giờ theo Việt Nam. */
  async listRange(calId, from, to) {
    const out = [];
    let page = '';
    const q = new URLSearchParams({ singleEvents: 'true', showDeleted: 'false', maxResults: '2500', timeZone: TZ,
      timeMin: `${from}T00:00:00+07:00`, timeMax: `${fe.addDays(to, 1)}T00:00:00+07:00`,
      fields: 'items(id,status,summary,location,description,start,end,eventType,recurringEventId,extendedProperties),nextPageToken' });
    do {
      if (page) q.set('pageToken', page);
      const r = await this.json(`/calendars/${encodeURIComponent(calId)}/events?${q}`);
      out.push(...(r.items || []));
      page = r.nextPageToken || '';
    } while (page);
    return out;
  }

  /** So sánh và chỉ gửi phần khác: thêm mới, sửa, xóa. */
  async sync(calId, desired) {
    const existing = new Map((await this.listEvents(calId)).filter(e => e.status !== 'cancelled').map(e => [e.id, e]));
    const stats = { created: 0, updated: 0, deleted: 0, unchanged: 0 };
    for (const ev of desired) {
      const cur = existing.get(ev.id);
      existing.delete(ev.id);
      if (cur && cur.extendedProperties?.private?.h === ev.extendedProperties.private.h) { stats.unchanged++; continue; }
      await this.upsert(calId, ev);
      stats[cur ? 'updated' : 'created']++;
    }
    for (const [id, e] of existing) {
      if (e.extendedProperties?.private?.app !== 'finance') continue;  // sự kiện bạn tự thêm tay: không đụng tới
      await this.remove(calId, id); stats.deleted++;
    }
    return stats;
  }
}

// ================= KÉO VỀ: sự kiện trên Google Calendar → show nháp =================

export const IMPORT_PAST_DAYS = 7;      // lấy cả sự kiện 7 ngày trước
export const IMPORT_FUTURE_DAYS = 365;  // và 1 năm tới
const SKIP_TYPES = new Set(['birthday', 'outOfOffice', 'focusTime', 'workingLocation', 'fromGmail']);
const DEFAULT_KIND = { video: 'shoot', photo: 'photo', edit: 'edit', other: 'shoot' };

export const srcKey = (calId, evId) => `${calId}/${evId}`;

/** Đoán loại việc theo tiêu đề sự kiện. */
export function guessWorkType(title) {
  const t = (title || '').toLowerCase();
  if (/chụp|ảnh|photo|pre.?wedding|kỷ yếu|ky yeu/.test(t)) return 'photo';
  if (/dựng|edit|hậu kỳ|hau ky|bàn giao/.test(t)) return 'edit';
  if (/quay|video|phim|film|livestream|sự kiện|cưới|cuoi|event/.test(t)) return 'video';
  return 'other';
}

const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();

/** Có nên lấy sự kiện này về không. */
export function wanted(ev, keyword = '') {
  if (!ev || ev.status === 'cancelled') return false;
  if (SKIP_TYPES.has(ev.eventType)) return false;
  if (ev.recurringEventId) return false;                    // việc lặp lại hằng tuần (tập gym, họp…) không phải show
  if (ev.extendedProperties?.private?.app === 'finance') return false;  // sự kiện do chính app đẩy lên
  if (!ev.start || !(ev.start.date || ev.start.dateTime)) return false;
  const kws = (keyword || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (kws.length && !kws.some(k => (ev.summary || '').toLowerCase().includes(k))) return false;
  return true;
}

/** Ngày giờ của sự kiện → các buổi làm (giờ Việt Nam). */
export function eventSessions(ev, kind) {
  if (ev.start.date) {  // cả ngày; có thể kéo dài nhiều ngày (ngày kết thúc không tính)
    const out = [];
    const end = ev.end?.date || fe.addDays(ev.start.date, 1);
    for (let d = ev.start.date; d < end && out.length < 14; d = fe.addDays(d, 1)) out.push({ kind, date: d, start_time: null, end_time: null });
    return out;
  }
  const s = ev.start.dateTime, e = ev.end?.dateTime || s;
  const date = s.slice(0, 10);
  const start = s.slice(11, 16);
  let end = e.slice(0, 10) === date ? e.slice(11, 16) : '23:59';
  if (!end || end <= start) end = null;
  return [{ kind, date, start_time: start, end_time: end }];
}

const evHash = ev => hash(JSON.stringify([ev.summary || '', ev.location || '', ev.description || '', ev.start, ev.end]));

/**
 * Đưa các sự kiện đã tải về vào dữ liệu app.
 *  • Sự kiện mới → show nháp (chưa có khách, tiền công 0đ) để bạn điền sau.
 *  • Sự kiện đã lấy, bị đổi ngày giờ trên Google → cập nhật ngày giờ của show.
 *  • Sự kiện bị xóa trên Google → xóa show nháp tương ứng (show bạn đã điền thông tin thì giữ lại).
 *  • Show nháp bạn đã bấm "Không phải show" → không lấy lại nữa.
 * @param fetched  Map(calId → mảng sự kiện) của những lịch vừa tải thành công.
 */
export function applyImport(tx, db, fetched, { from, to, keyword = '' } = {}) {
  const stats = { added: 0, changed: 0, removed: 0 };
  const known = new Map();  // srcKey → job (kể cả đã xóa = đã bỏ qua)
  for (const j of db.all('jobs')) if (j.gcal_src) known.set(j.gcal_src, j);
  const seen = new Set();
  for (const [calId, evs] of fetched) {
    for (const ev of evs) {
      if (!wanted(ev, keyword)) continue;
      const key = srcKey(calId, ev.id);
      seen.add(key);
      const h = evHash(ev);
      const job = known.get(key);
      if (job?.deleted_at) continue;  // đã bấm "Không phải show"
      if (job && job.gcal_h === h) continue;
      const title = (strip(ev.summary) || '(Không tiêu đề)').slice(0, 200);
      const workType = job ? job.work_type : guessWorkType(title);
      const sessions = eventSessions(ev, DEFAULT_KIND[workType] || 'shoot');
      const location = strip(ev.location).slice(0, 300) || null;
      const description = strip(ev.description).slice(0, 1000) || null;
      if (!job) {
        const j = tx.insert('jobs', { title, client_id: null, work_type: workType, work_date: sessions[0].date, total_fee: 0, due_date: null,
          work_status: 'booked', location, description, note: null, draft: 1, gcal_src: key, gcal_h: h });
        for (const s of sessions) tx.insert('job_sessions', { job_id: j.id, ...s, location, note: null, gcal: 1 });
        tx.audit('job', j.id, 'gcal_import', { key });
        stats.added++;
        continue;
      }
      // Đã có: ngày giờ luôn theo Google; tên và nội dung chỉ cập nhật khi show còn là nháp.
      const set = { gcal_h: h, work_date: sessions[0].date, location };
      if (job.draft) Object.assign(set, { title, description });
      tx.update('jobs', job.id, set);
      for (const s of db.live('job_sessions').filter(s => s.job_id === job.id && s.gcal)) tx.softDelete('job_sessions', s.id);
      for (const s of sessions) tx.insert('job_sessions', { job_id: job.id, ...s, location, note: null, gcal: 1 });
      stats.changed++;
    }
  }
  // Sự kiện không còn trên Google (trong khoảng ngày vừa tải) → bỏ show nháp tương ứng.
  for (const [key, job] of known) {
    if (job.deleted_at || seen.has(key) || !job.draft) continue;
    const calId = key.slice(0, key.lastIndexOf('/'));
    if (!fetched.has(calId) || job.work_date < from || job.work_date > to) continue;
    if (db.live('transactions').some(t => t.job_id === job.id)) continue;
    tx.update('jobs', job.id, { gcal_src: null });  // không đánh dấu "bỏ qua": nếu sự kiện được khôi phục thì lấy lại
    tx.softDelete('jobs', job.id);
    for (const s of db.live('job_sessions').filter(s => s.job_id === job.id)) tx.softDelete('job_sessions', s.id);
    stats.removed++;
  }
  return stats;
}

// Đồng bộ MỘT CHIỀU: lịch làm việc trong app → một lịch riêng trên Google Calendar do app tạo.
// App là nguồn gốc; sửa trên Google Calendar sẽ bị ghi đè ở lần đồng bộ sau.
// Quyền dùng: calendar.app.created — chỉ quản lý lịch do app tạo, không đọc lịch cá nhân của bạn.
import * as fe from './finance.js';
import { AppError } from './store.js';

const API = 'https://www.googleapis.com/calendar/v3';
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
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
    if (!j) continue;
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
  constructor(getToken, fetchImpl = (...a) => fetch(...a)) {
    this.getToken = getToken;
    this.fetch = fetchImpl;
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

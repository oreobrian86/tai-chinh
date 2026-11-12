// Đăng nhập Google (Google Identity Services).
// Quyền truy cập (access token) tự hết hạn sau khoảng 1 giờ. Để bấm F5 không phải đăng nhập lại, token được giữ trong
// sessionStorage: chỉ thuộc về đúng tab này, tự xóa khi đóng tab/app, khi khóa app và khi hết hạn.
// Không lưu dữ liệu tài chính, không lưu mật khẩu, không có refresh token (không thể tự gia hạn quá 1 giờ).
import { CONFIG } from '../config.js';
import { AppError } from './core/store.js';

let client = null;
let token = null;
let expiresAt = 0;
let waiting = null;
let calendarOk = false;
let calendarReadOk = false;
let tasksReadOk = false;
const KEY = 'g_session';

function applyScopes(scope = '') {
  const has = s => !!s && scope.split(' ').includes(s);
  calendarOk = has(CONFIG.CALENDAR_SCOPE);
  calendarReadOk = has(CONFIG.CALENDAR_READ_SCOPE);
  tasksReadOk = has(CONFIG.TASKS_READ_SCOPE);
}

/** Mở lại sau khi bấm F5: dùng lại phiên còn hạn của tab này (còn ít nhất 3 phút). */
export function restore() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!v || !v.t || !(v.e - Date.now() > 3 * 60_000)) { sessionStorage.removeItem(KEY); return false; }
    token = v.t; expiresAt = v.e; applyScopes(v.s);
    return true;
  } catch (_) { return false; }
}

export const configured = () => CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.startsWith('DAN_CLIENT_ID');

function loadScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new AppError(0, 'offline', 'Không tải được thư viện đăng nhập của Google. Kiểm tra mạng.'));
    document.head.appendChild(s);
  });
}

export async function init() {
  await loadScript();
  if (client) return;
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: [CONFIG.SCOPE, CONFIG.CALENDAR_SCOPE, CONFIG.CALENDAR_READ_SCOPE, CONFIG.TASKS_READ_SCOPE].filter(Boolean).join(' '),
    include_granted_scopes: true,
    callback: resp => {
      const w = waiting; waiting = null;
      if (!w) return;
      if (resp.error) return w.reject(new AppError(401, 'google_denied', 'Bạn chưa cấp quyền cho ứng dụng.'));
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, CONFIG.SCOPE)) {
        return w.reject(new AppError(401, 'google_denied', 'Cần tick ô cho phép ứng dụng truy cập Google Drive.'));
      }
      const ok = s => !!s && window.google.accounts.oauth2.hasGrantedAllScopes(resp, s);
      const scope = [CONFIG.SCOPE, CONFIG.CALENDAR_SCOPE, CONFIG.CALENDAR_READ_SCOPE, CONFIG.TASKS_READ_SCOPE].filter(ok).join(' ');
      applyScopes(scope);
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: token, e: expiresAt, s: scope })); } catch (_) { }
      w.resolve(token);
    },
    error_callback: err => {
      const w = waiting; waiting = null;
      if (!w) return;
      const msg = err?.type === 'popup_closed' ? 'Bạn đã đóng cửa sổ đăng nhập Google.'
        : err?.type === 'popup_failed_to_open' ? 'Trình duyệt chặn cửa sổ đăng nhập. Hãy cho phép cửa sổ bật lên rồi thử lại.'
        : 'Đăng nhập Google không thành công.';
      w.reject(new AppError(401, 'google_denied', msg));
    },
  });
}

/** Phải gọi từ một cú bấm của người dùng (trình duyệt chặn cửa sổ bật lên tự động). */
export async function signIn() {
  await init();
  return new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    client.requestAccessToken({ prompt: '' });
  });
}

export async function getToken() {
  if (token && Date.now() < expiresAt - 60_000) return token;
  throw new AppError(401, 'google_auth', 'Phiên đăng nhập Google đã hết hạn.');
}

/** Người dùng có tick ô cho phép Google Calendar không. */
export const calendarGranted = () => calendarOk;
/** Người dùng có cho phép app đọc lịch (để lấy sự kiện về) không. */
export const calendarReadGranted = () => calendarReadOk;
/** Người dùng có cho phép app đọc Việc cần làm (Google Tasks) không. */
export const tasksReadGranted = () => tasksReadOk;

export const minutesLeft = () => (token ? Math.max(0, Math.floor((expiresAt - Date.now()) / 60000)) : 0);

/** Khóa: bỏ quyền truy cập khỏi bộ nhớ (lần sau mở lại cần đăng nhập Google). */
export function forget() {
  token = null; expiresAt = 0;
  try { sessionStorage.removeItem(KEY); } catch (_) { }
}

/** Đăng xuất hẳn: thu hồi quyền đã cấp cho app. */
export function revoke() {
  const t = token;
  forget();
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => { });
}

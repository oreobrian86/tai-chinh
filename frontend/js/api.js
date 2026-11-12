// Gọi API: tự gắn CSRF token, xử lý lỗi, khóa app (423), hết phiên (401).

let csrf = null;
const listeners = { locked: [], unauth: [] };

export const setCsrf = t => { csrf = t; };
export const onApi = (ev, fn) => listeners[ev].push(fn);

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Lỗi ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields || {};
  }
}

export async function api(method, path, body, { form = false, raw = false } = {}) {
  const headers = { 'X-Requested-With': 'finance-app' };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (form) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, { error: { message: 'Không kết nối được tới ứng dụng. Kiểm tra máy tính có đang chạy không.' } });
  }
  if (raw && res.ok) return res;
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 423) listeners.locked.forEach(f => f());
    if (res.status === 401 && data?.error?.code === 'unauthenticated') listeners.unauth.forEach(f => f());
    throw new ApiError(res.status, data);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

/** Tải file về (CSV/Excel/JSON/backup) qua fetch để giữ cookie + chặn khi khóa. */
export async function download(path, fallbackName) {
  const res = await api('GET', path, undefined, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = cd.match(/filename="?([^";]+)"?/);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

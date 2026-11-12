// Cầu nối giữa giao diện và "máy chủ" chạy trong trình duyệt (js/core/router.js).
// Giữ nguyên cách gọi api('GET', '/api/...') như bản cũ để giao diện không phải đổi.

let backend = null;
const listeners = { locked: [], unauth: [] };

export const setBackend = b => { backend = b; };
export const onApi = (ev, fn) => listeners[ev].push(fn);
export const setCsrf = () => { };  // không còn dùng (không có máy chủ riêng)

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Lỗi ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields || {};
  }
}

export async function api(method, path, body) {
  if (!backend) throw new ApiError(0, { error: { code: 'not_ready', message: 'Chưa đăng nhập.' } });
  try {
    return await backend.handle(method, path, body);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e?.status !== undefined) {
      const err = new ApiError(e.status, { error: { code: e.code, message: e.message, fields: e.fields } });
      if (e.code === 'google_auth') listeners.unauth.forEach(f => f());
      throw err;
    }
    console.error(e);
    throw new ApiError(500, { error: { code: 'client_error', message: 'Có lỗi không mong muốn. Hãy tải lại trang và thử lại.' } });
  }
}

export const get = p => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = p => api('DELETE', p);

/** Tải file xuất (CSV/JSON) về máy. */
export async function download(path, fallbackName) {
  const r = await api('GET', path);
  const d = r?.__download;
  if (!d) throw new ApiError(500, { error: { message: 'Không tạo được file.' } });
  const blob = new Blob([d.content], { type: d.mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = d.filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

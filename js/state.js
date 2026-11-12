// Bộ nhớ đệm dữ liệu dùng chung (tài khoản, danh mục, khách) + sự kiện "dữ liệu đã đổi".
import { get } from './api.js';

export const state = { user: null, settings: {}, accounts: [], categories: [], clients: [], loaded: false };
const subs = new Set();

export async function loadRefs() {
  const [accounts, categories, clients] = await Promise.all([get('/api/accounts'), get('/api/categories'), get('/api/clients')]);
  Object.assign(state, { accounts, categories, clients, loaded: true });
}

export const activeAccounts = () => state.accounts.filter(a => !a.archived);
export const expenseCats = () => state.categories.filter(c => c.kind === 'expense');
export const incomeCats = () => state.categories.filter(c => c.kind === 'income');
export const catById = id => state.categories.find(c => c.id === id);
export const accountOptions = () => activeAccounts().map(a => [a.id, a.name]);

/** Gọi sau mỗi thao tác ghi: làm mới dữ liệu tham chiếu và trang hiện tại. */
export async function changed() {
  try { await loadRefs(); } catch (_) { }
  subs.forEach(f => f());
}
export const onChanged = f => { subs.add(f); return () => subs.delete(f); };

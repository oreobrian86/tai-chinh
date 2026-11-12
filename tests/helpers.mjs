// Tiện ích kiểm thử: một "app" chạy trên kho bộ nhớ (giả lập Google Sheet), ngày hôm nay cố định được.
import assert from 'node:assert/strict';
import { Api } from '../js/core/router.js';
import { DataSession, MemoryStore } from '../js/core/store.js';
import { addDays } from '../js/core/finance.js';

export const TODAY = '2026-11-12';

export async function makeApp({ today = TODAY, store = new MemoryStore() } = {}) {
  const session = new DataSession(store);
  const api = new Api(session, { today: () => app.today });
  const app = {
    today, store, session, api,
    async call(method, path, body, expectStatus) {
      try {
        const r = await api.handle(method, path, body);
        if (expectStatus && expectStatus !== 200) assert.fail(`${method} ${path}: mong đợi lỗi ${expectStatus} nhưng thành công`);
        return r;
      } catch (e) {
        if (!e.status) throw e;
        if (expectStatus === e.status) return { error: { code: e.code, message: e.message, fields: e.fields } };
        assert.fail(`${method} ${path} → ${e.status} ${e.code}: ${e.message} ${JSON.stringify(e.fields)}`);
      }
    },
    get: (p, s) => app.call('GET', p, undefined, s),
    post: (p, b = {}, s) => app.call('POST', p, b, s),
    patch: (p, b, s) => app.call('PATCH', p, b, s),
    put: (p, b, s) => app.call('PUT', p, b, s),
    del: (p, s) => app.call('DELETE', p, undefined, s),
    async accounts() { return Object.fromEntries((await app.get('/api/accounts')).map(a => [a.name, a])); },
    async cat(name) { return (await app.get('/api/categories')).find(c => c.name === name); },
    fc: () => app.get('/api/forecast'),
    day: n => addDays(app.today, n),
  };
  await app.post('/api/setup');
  return app;
}

export { assert };

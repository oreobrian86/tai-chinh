// Giả lập Google Sheets API v4 + Drive API v3 (chỉ các lệnh app dùng), bám theo tài liệu chính thức.
// Mục đích: kiểm tra lớp SheetsStore gửi đúng cấu trúc lệnh và ghi đúng ô / đúng dòng.
export function fakeGoogle({ token = 'tok' } = {}) {
  const files = new Map();  // id → { name, appProperties, sheets: Map(title → { sheetId, grid: [][] }) }
  let seq = 1;
  const calls = [];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const err = (status, message) => json(status, { error: { code: status, message } });

  function cellValue(c) {
    const v = c?.userEnteredValue;
    if (!v) return undefined;
    if ('numberValue' in v) return v.numberValue;
    if ('stringValue' in v) return v.stringValue;
    if ('boolValue' in v) return v.boolValue;
    throw new Error('userEnteredValue không hợp lệ: ' + JSON.stringify(v));
  }
  const trim = row => { const r = row.slice(); while (r.length && (r[r.length - 1] === undefined || r[r.length - 1] === '')) r.pop(); return r; };
  const lastRow = grid => { let n = grid.length; while (n && !trim(grid[n - 1] || []).length) n--; return n; };

  function applyRequest(f, req) {
    const [kind] = Object.keys(req);
    const r = req[kind];
    const byId = id => { for (const s of f.sheets.values()) if (s.sheetId === id) return s; throw Object.assign(new Error(`sheetId ${id} không tồn tại`), { status: 400 }); };
    if (kind === 'addSheet') {
      const t = r.properties.title;
      if (f.sheets.has(t)) throw Object.assign(new Error('Sheet đã tồn tại'), { status: 400 });
      f.sheets.set(t, { sheetId: seq++, grid: [] });
    } else if (kind === 'appendCells') {
      if (r.fields !== 'userEnteredValue') throw Object.assign(new Error('fields phải có'), { status: 400 });
      const s = byId(r.sheetId);
      let at = lastRow(s.grid);
      for (const row of r.rows) s.grid[at++] = (row.values || []).map(cellValue);
    } else if (kind === 'updateCells') {
      if (!r.fields) throw Object.assign(new Error('fields phải có'), { status: 400 });
      const g = r.range, s = byId(g.sheetId);
      if (g.endRowIndex - g.startRowIndex !== r.rows.length) throw Object.assign(new Error('Số dòng không khớp range'), { status: 400 });
      r.rows.forEach((row, i) => {
        const ri = g.startRowIndex + i;
        s.grid[ri] = s.grid[ri] || [];
        for (let ci = g.startColumnIndex; ci < g.endColumnIndex; ci++) s.grid[ri][ci] = cellValue(row.values?.[ci - g.startColumnIndex]);
      });
    } else throw Object.assign(new Error('request không hỗ trợ: ' + kind), { status: 400 });
  }

  async function fetch(url, opts = {}) {
    const u = new URL(url), method = opts.method || 'GET';
    calls.push({ method, url: u.pathname + u.search, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.headers?.Authorization !== `Bearer ${token}`) return err(401, 'Invalid Credentials');
    const body = opts.body ? JSON.parse(opts.body) : null;
    // ---- Drive ----
    if (u.hostname === 'www.googleapis.com') {
      const m = u.pathname.match(/^\/drive\/v3\/files(?:\/([^/]+))?(?:\/(copy))?$/);
      if (!m) return err(404, 'not found');
      const [, id, copy] = m;
      if (!id && method === 'GET') {
        const q = u.searchParams.get('q');
        const pm = q.match(/key='(\w+)' and value='(\w+)'/);
        let list = [...files.entries()].filter(([, f]) => !f.trashed && f.appProperties?.[pm[1]] === pm[2])
          .map(([fid, f]) => ({ id: fid, name: f.name, createdTime: f.createdTime }));
        if ((u.searchParams.get('orderBy') || '').includes('desc')) list = list.reverse();
        return json(200, { files: list });
      }
      const f = files.get(id);
      if (!f) return err(404, 'File not found');
      if (copy && method === 'POST') {
        const nid = 'file' + seq++;
        files.set(nid, { name: body.name, appProperties: body.appProperties, createdTime: new Date().toISOString(), sheets: structuredClone(f.sheets) });
        return json(200, { id: nid, name: body.name });
      }
      if (method === 'PATCH') { f.appProperties = { ...f.appProperties, ...body.appProperties }; return json(200, { id }); }
      if (method === 'DELETE') { files.delete(id); return { ok: true, status: 204, json: async () => null }; }
      return err(400, 'unsupported');
    }
    // ---- Sheets ----
    if (u.pathname === '/v4/spreadsheets' && method === 'POST') {
      const id = 'file' + seq++;
      const sheets = new Map();
      for (const s of body.sheets) sheets.set(s.properties.title, { sheetId: seq++, grid: [] });
      files.set(id, { name: body.properties.title, appProperties: {}, createdTime: new Date().toISOString(), sheets });
      return json(200, { spreadsheetId: id });
    }
    let m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(?::batchUpdate|\/values:batchGet)?$/);
    if (!m) return err(404, 'not found');
    const f = files.get(m[1]);
    if (!f) return err(404, 'Requested entity was not found.');
    if (u.pathname.endsWith(':batchUpdate')) {
      const snapshot = structuredClone(f.sheets);
      try { for (const r of body.requests) applyRequest(f, r); }
      catch (e) { f.sheets = snapshot; return err(e.status || 500, e.message); }  // nguyên khối
      return json(200, { replies: body.requests.map(() => ({})) });
    }
    if (u.pathname.endsWith('values:batchGet')) {
      if (u.searchParams.get('valueRenderOption') !== 'UNFORMATTED_VALUE') return err(400, 'cần UNFORMATTED_VALUE');
      const valueRanges = u.searchParams.getAll('ranges').map(rg => {
        const [title, a1] = rg.split('!');
        const s = f.sheets.get(title);
        if (!s) throw new Error('range sai: ' + rg);
        let rows = s.grid.slice(0, lastRow(s.grid)).map(r => trim((r || []).map(v => v === undefined ? '' : v)));
        if (a1 === '1:1') rows = rows.slice(0, 1);
        return { range: rg, values: rows.length ? rows : undefined };
      });
      return json(200, { valueRanges });
    }
    // metadata
    return json(200, { sheets: [...f.sheets.entries()].map(([title, s]) => ({ properties: { title, sheetId: s.sheetId } })) });
  }
  return { fetch, files, calls };
}

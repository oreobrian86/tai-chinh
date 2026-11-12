// Nhập nhanh bằng câu ngắn: mỗi dòng một việc, app tự hiểu là khoản chi, khoản thu, show mới, khách trả tiền
// hay khoản phải trả (chi cố định, trả góp). Chạy hoàn toàn trên máy, không gửi chữ bạn gõ đi đâu.
// Gõ có dấu hay không dấu đều được: "an trua 45k" = "ăn trưa 45k".
import * as fe from './finance.js';

// ---------- chuẩn hóa: bỏ dấu nhưng giữ nguyên độ dài để cắt lại được chữ gốc ----------
const fold = s => [...s].map(c => c.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')[0] || c).join('');

/** Thay một đoạn bằng khoảng trắng (giữ vị trí các phần còn lại). */
const blank = (s, i, n) => s.slice(0, i) + ' '.repeat(n) + s.slice(i + n);

const pad = n => String(n).padStart(2, '0');
const WD = { 'thu 2': 0, 'thu hai': 0, t2: 0, 'thu 3': 1, 'thu ba': 1, t3: 1, 'thu 4': 2, 'thu tu': 2, t4: 2, 'thu 5': 3, 'thu nam': 3, t5: 3,
  'thu 6': 4, 'thu sau': 4, t6: 4, 'thu 7': 5, 'thu bay': 5, t7: 5, cn: 6, 'chu nhat': 6 };

// ---------- tiền ----------
const UNIT = { k: 1e3, ng: 1e3, nghin: 1e3, ngan: 1e3, tr: 1e6, trieu: 1e6, cu: 1e6, m: 1e6, ty: 1e9 };
export function moneyValue(num, unit, tail) {
  if (unit) {
    const u = UNIT[unit];
    if (tail) return Number(num.replace(/[.,]/g, '')) * u + Number(tail.padEnd(String(u).length - 1, '0'));  // 1tr5 → 1.500.000
    let n = num.replace(',', '.');
    if ((n.match(/\./g) || []).length > 1) n = n.replace(/\./g, '');
    return Math.round(parseFloat(n) * u);
  }
  return Number(num.replace(/[.,]/g, ''));
}

// ---------- từ khóa (viết không dấu) ----------
const CAT_WORDS = [
  ['Cà phê, nước uống', /\b(cf|cafe|ca phe|coffee|tra sua|tra chanh|sinh to|nuoc ep|highlands|starbucks|phuc long|katinat|nuoc ngot|nuoc suoi)\b/],
  ['Ăn uống', /\b(an|com|pho|bun|mi|banh mi|lau|nuong|bia|nhau|do an|an vat|grabfood|shopeefood|baemin|kfc|lotteria|pizza|sushi|che|xoi|chao)\b/],
  ['Thiết bị quay, chụp', /\b(the nho|pin|lens|ong kinh|gimbal|den|mic|micro|tripod|chan may|flycam|may anh|sd|ssd|o cung|filter|sac|cap|body|kit)\b/],
  ['Phần mềm, dịch vụ', /\b(capcut|adobe|premiere|after effects|lightroom|photoshop|netflix|spotify|youtube premium|icloud|google one|chatgpt|claude|canva|envato|artlist|epidemic|domain|hosting|4g|data|cuoc dien thoai|nap the|nap dt)\b/],
  ['Sinh hoạt', /\b(tien nha|thue nha|tien dien|dien|tien nuoc|gas|internet|wifi|giat|giat ui|sieu thi|bach hoa|cho|do dung|ve sinh)\b/],
  ['Đi lại, xăng xe', /\b(xang|do xang|grab|be|gojek|xanh sm|taxi|xe om|gui xe|ve xe|ve tau|ve may bay|bao duong|sua xe|rua xe|thay nhot|vetc|cau duong|phi duong)\b/],
  ['Đi chơi, hẹn hò', /\b(xem phim|cgv|lotte cinema|di choi|hen ho|karaoke|du lich|bida|game|concert)\b/],
  ['Sức khỏe', /\b(thuoc|kham|benh vien|nha khoa|rang|gym|vitamin|bao hiem y te|xet nghiem)\b/],
  ['Gia đình', /\b(gui me|gui bo|bieu|gia dinh|cho me|cho bo|ba me|bo me|mung|phong bi|di dam)\b/],
  ['Mua sắm', /\b(mua|quan|ao|giay|dep|tui|shopee|lazada|tiki|tiktok shop|my pham)\b/],
];
const INCOME_CAT = [['Hoàn tiền', /\b(hoan tien|refund|cashback|hoan)\b/], ['Quà tặng', /\b(qua|li xi|lixi|mung|tang|bieu)\b/]];
const ACC_WORDS = [
  ['cash', /\b(tien mat|tm|cash)\b/],
  ['ewallet', /\b(momo|zalo ?pay|vnpay|shopee ?pay|vi dien tu)\b/],
  ['bank', /\b(ck|chuyen khoan|bank|ngan hang|vcb|vietcombank|tcb|techcombank|mb|mbbank|acb|bidv|tpbank|vpbank|vietinbank|agribank|sacombank|stk)\b/],
];
const PROVIDERS = [['SPayLater', /\b(spaylater|shopee ?paylater|shopee ?later|spl)\b/], ['Lazada PayLater', /\blazada ?paylater\b/],
  ['Kredivo', /\bkredivo\b/], ['Home Credit', /\bhome ?credit\b/], ['FE Credit', /\bfe ?credit\b/], ['Thẻ tín dụng', /\bthe tin dung\b/]];
const JOB_WORDS = /\b(quay|chup|dung|edit|show|event|su kien|cuoi|dam cuoi|dam hoi|an hoi|ky yeu|livestream|tvc|mv|pre ?wedding|phong su|hau ky|recap|teaser|highlight|hoi nghi|hoi thao|khai truong)\b/;
const EXPENSE_START = /^(mua|an|uong|do xang|xang|grab|be|taxi|xe om|gui xe|nap|dong tien|dong|tra tien (nha|dien|nuoc|wifi|mang)|thanh toan (tien|hoa don)|chi|tieu|sua|thue|gui xe|cafe|cf)\b/;
const INCOME_START = /^(thu|duoc|ban|nhan duoc|hoan tien|thuong|luong|li xi|lixi|lai|tien lai|cashback|refund)\b/;
// mừng cưới, phong bì… là tiền chi, dù có chữ "cưới"
const GIFT_OUT = /\b(mung|phong bi|di dam|tien mung|di an cuoi|qua)\b/;
const PAY_VERB = /\b(tra|chuyen|ck|thanh toan|gui tien|gui|nhan tien|nhan|ban giao tien|tat toan|da tra|vua tra)\b/;
const RECUR_MONTH = /\b(hang thang|moi thang|thang nao cung|hthang|\/thang|1 thang 1 lan|monthly)\b/;
const RECUR_YEAR = /\b(hang nam|moi nam|nam nao cung|\/nam|1 nam 1 lan|yearly|goi nam)\b/;
const DEBT = /\b(tra gop|tra sau|gop|paylater|spaylater|shopee ?later|kredivo|credit|the tin dung|\d+\s*ky|ky \d+)\b/;

/**
 * Đọc nhiều dòng. ctx: { today, accounts, categories, clients, jobs } (jobs kèm outstanding, client_name).
 * Trả về mảng { line, type, ok, data, summary, warnings }.
 * type: expense | other_income | job | payment | obligation | unknown
 */
export function parseQuick(text, ctx) {
  return String(text || '').normalize('NFC').split(/\r?\n|;/).map(l => l.trim()).filter(Boolean).slice(0, 50).map(l => parseLine(l, ctx));
}

function nearestYear(today, m, d) {
  const y = Number(today.slice(0, 4));
  const cands = [y - 1, y, y + 1].map(yy => `${yy}-${pad(m)}-${pad(d)}`).filter(fe.isValidDate);
  return cands.sort((a, b) => Math.abs(fe.diffDays(today, a)) - Math.abs(fe.diffDays(today, b)))[0] || null;
}

export function parseLine(line, ctx) {
  const today = ctx.today;
  const orig = line;
  let f = fold(line.toLowerCase());  // bản không dấu, cùng độ dài với orig
  const warnings = [];
  const cut = (re, fn) => {  // tìm, xử lý rồi xóa khỏi bản làm việc
    const m = re.exec(f);
    if (!m) return null;
    const r = fn(m);
    f = blank(f, m.index, m[0].length);
    return r ?? true;
  };

  // --- kỳ trả góp: "kỳ 2/6", "6 kỳ" ---
  let installments = null, installment_no = null;
  cut(/\bky\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/, m => { installment_no = +m[1]; installments = +m[2]; });
  if (!installments) cut(/\b(\d{1,2})\s*ky\b/, m => { installments = +m[1]; });
  if (!installments) cut(/\bky\s*(\d{1,2})\b/, m => { installment_no = +m[1]; });

  // --- ngày ---
  let date = null, weekdayHint = null, dayOfMonth = null;
  cut(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, m => {
    const d = +m[1], mo = +m[2];
    if (m[3]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const s = `${y}-${pad(mo)}-${pad(d)}`; if (fe.isValidDate(s)) date = s; }
    else date = nearestYear(today, mo, d);
  });
  if (!date) cut(/\b(hom nay|bua nay)\b/, () => { date = today; });
  if (!date) cut(/\bhom qua\b/, () => { date = fe.addDays(today, -1); });
  if (!date) cut(/\bhom kia\b/, () => { date = fe.addDays(today, -2); });
  if (!date) cut(/\bngay mai\b|^mai\b/, () => { date = fe.addDays(today, 1); });  // "Mai" giữa câu có thể là tên người
  if (!date) cut(/\bngay mot\b|^mot\b/, () => { date = fe.addDays(today, 2); });
  if (!date) cut(/\b(thu [2-7]|thu (hai|ba|tu|nam|sau|bay)|t[2-7]|cn|chu nhat)\b/, m => { weekdayHint = WD[m[1]]; });
  if (!date) cut(/\b(?:ngay|mung|mong)\s+(\d{1,2})\b/, m => { dayOfMonth = +m[1]; });

  // --- giờ: 6h, 6h30, 06:30, 6-12h, 6h-12h30 ---
  let start_time = null, end_time = null;
  const hm = (h, m) => (h >= 0 && h < 24 ? `${pad(h)}:${pad(m || 0)}` : null);
  cut(/\b(\d{1,2})(?:[h:g](\d{2})?)?\s*(?:-|den|toi)\s*(\d{1,2})[h:g](\d{2})?\b/, m => { start_time = hm(+m[1], +m[2]); end_time = hm(+m[3], +m[4]); });
  if (!start_time) cut(/\b(\d{1,2})[h:g](\d{2})?\b/, m => { start_time = hm(+m[1], +m[2]); });
  if (start_time && end_time && end_time <= start_time) end_time = null;

  // --- tiền (cọc riêng) ---
  const moneys = [];
  const MONEY = /(\d+(?:[.,]\d+)*)\s*(k|nghin|ngan|ng|trieu|tr|cu|m|ty)?(\d{1,3})?\b/g;
  let mm;
  const work = f;
  while ((mm = MONEY.exec(work))) {
    const [all, num, unit, tail] = mm;
    if (tail && !unit) continue;
    const v = moneyValue(num, unit, tail);
    if (!unit && v < 10000) continue;  // số nhỏ không đơn vị (năm 2026, số lượng…): không phải tiền
    const before = work.slice(Math.max(0, mm.index - 14), mm.index);
    moneys.push({ v, deposit: /\b(coc|dat coc|ung truoc|tam ung)\s*$/.test(before), i: mm.index, n: all.length });
  }
  for (const m of moneys) f = blank(f, m.i, m.n);
  f = f.replace(/\b(dat coc|coc|tam ung|ung truoc)\b/g, s => ' '.repeat(s.length));
  const deposit = moneys.find(m => m.deposit)?.v || 0;
  const amount = moneys.find(m => !m.deposit)?.v ?? null;

  // --- tài khoản ---
  const accounts = (ctx.accounts || []).filter(a => !a.archived);
  let account = null;
  for (const a of accounts) {
    const n = fold(a.name.toLowerCase());
    if (n.length >= 2 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(f)) { account = a; f = f.replace(n, ' '.repeat(n.length)); break; }
  }
  if (!account) for (const [kind, re] of ACC_WORDS) {
    const m = re.exec(f);
    if (m) { account = accounts.find(a => a.kind === kind) || null; f = blank(f, m.index, m[0].length); break; }
  }

  const text = f.replace(/\s+/g, ' ').trim();  // phần chữ còn lại (không dấu)
  const words = (s => s.replace(/\s+/g, ' ').trim())(clean(orig, f));  // phần chữ còn lại (có dấu)
  const resolveDate = future => {
    if (date) return date;
    if (weekdayHint !== null) {
      const wd = fe.weekday(today);
      const delta = future ? (weekdayHint - wd + 7) % 7 : -((wd - weekdayHint + 7) % 7);
      return fe.addDays(today, delta);
    }
    if (dayOfMonth) {
      const [y, m] = today.split('-').map(Number);
      const s = `${y}-${pad(m)}-${pad(Math.min(dayOfMonth, fe.lastDay(y, m)))}`;
      if (!future || s >= today) return s;
      const [ny, nm] = fe.addMonths(`${y}-${pad(m)}-01`, 1).split('-').map(Number);
      return `${ny}-${pad(nm)}-${pad(Math.min(dayOfMonth, fe.lastDay(ny, nm)))}`;
    }
    return today;
  };
  const base = { line: orig, warnings };
  const fmt = n => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
  const accName = a => (a ? a.name : (accounts[0]?.name || ''));
  const defaultAcc = kind => account || (kind && accounts.find(a => a.kind === kind)) || accounts[0] || null;

  // --- 1. khoản phải trả: chi cố định / trả sau / trả góp ---
  const provider = PROVIDERS.find(([, re]) => re.test(fold(orig.toLowerCase())))?.[0] || null;
  const isDebt = DEBT.test(fold(orig.toLowerCase())) || installments || installment_no;
  const isMonthly = RECUR_MONTH.test(text), isYearly = RECUR_YEAR.test(text);
  if (amount && (isDebt || isMonthly || isYearly || /\bgia han\b/.test(text))) {
    let name = strip(words, /\b(hàng tháng|hang thang|mỗi tháng|moi thang|hàng năm|hang nam|mỗi năm|moi nam|trả góp|tra gop|trả sau|tra sau|gia hạn|gia han|tháng nào cũng|thang nao cung|năm nào cũng|nam nao cung|gói năm|goi nam)\b/gi);
    name = cap(name || provider || 'Khoản phải trả');
    const due = resolveDate(true);
    if (isDebt) {
      const data = { kind: 'debt', provider: provider || name, name: provider || name,
        amount, due_date: due, installments: installments || 1, installment_no: installment_no || 1 };
      if (data.installment_no > data.installments) { data.installments = data.installment_no; warnings.push('Kỳ hiện tại lớn hơn tổng số kỳ, đã lấy tổng số kỳ bằng kỳ hiện tại.'); }
      const cat = (ctx.categories || []).find(c => c.kind === 'expense' && c.name === 'Khác');
      if (cat) data.category_id = cat.id;
      return { ...base, type: 'obligation', ok: true, data,
        summary: `Trả ${data.installments > 1 ? `góp kỳ ${data.installment_no}/${data.installments}` : 'sau'}: ${data.name}, ${fmt(amount)}${data.installments > 1 ? '/kỳ' : ''}, hạn ${dmy(due)}` };
    }
    const data = { kind: 'bill', name, amount, due_date: due, recurrence: isYearly ? 'yearly' : 'monthly' };
    const cat = guessCategory(text, ctx.categories, 'expense');
    if (cat) data.category_id = cat.id;
    return { ...base, type: 'obligation', ok: true, data,
      summary: `Chi cố định ${isYearly ? 'hằng năm' : 'hằng tháng'}: ${name}, ${fmt(amount)}, kỳ tới ${dmy(due)}` };
  }

  // --- 2. khách trả tiền cho show đã có ---
  const owing = (ctx.jobs || []).filter(j => j.outstanding > 0 && j.work_status !== 'cancelled');
  const lf = f0(orig);
  if (amount && PAY_VERB.test(lf) && !EXPENSE_START.test(text)) {
    const scored = owing.map(j => ({ j, s: Math.max(matchLen(f0(orig), j.client_name), matchLen(f0(orig), j.title)) }))
      .filter(x => x.s >= 3).sort((a, b) => b.s - a.s || (b.j.money_stage === 'receivable') - (a.j.money_stage === 'receivable') || a.j.work_date.localeCompare(b.j.work_date));
    if (scored.length) {
      const j = scored[0].j;
      const acc = defaultAcc(/\b(ck|chuyen)\b/.test(lf) ? 'bank' : null);
      const d = resolveDate(false);
      if (amount > j.outstanding) warnings.push(`Số tiền lớn hơn phần còn thiếu của show (${fmt(j.outstanding)}).`);
      return { ...base, type: 'payment', ok: amount <= j.outstanding && !!acc,
        data: { job_id: j.id, amount, account_id: acc?.id, date: d },
        summary: `Khách trả tiền: ${j.title}${j.client_name ? ` (${j.client_name})` : ''}, ${fmt(amount)} vào ${accName(acc)}, ngày ${dmy(d)}` };
    }
  }

  // --- 3. show mới ---
  const isExpenseVerb = EXPENSE_START.test(text);
  if (JOB_WORDS.test(text) && !isExpenseVerb && !INCOME_START.test(text) && !GIFT_OUT.test(text)) {
    const d = resolveDate(true);
    const client = findClient(orig, ctx.clients) || pickClient(words);
    let title = strip(words, /\b(khách|khach|kh|cho|của|cua)\s+[^,]+/gi);
    let location = null;
    const loc = /\b(?:tại|tai|ở|o)\s+([^,]+)/i.exec(title);
    if (loc) { location = cap(loc[1].trim()); title = title.replace(loc[0], ' '); }
    if (client && title.toLowerCase().includes(client.toLowerCase())) title = title.replace(new RegExp(escapeRe(client), 'i'), ' ');
    title = cap(title.replace(/\s+/g, ' ').replace(/^[,\s-]+|[,\s-]+$/g, '').trim()) || 'Show';
    const work_type = guessType(text);
    const data = { title, client_name: client, work_type, work_date: d, total_fee: amount || 0, start_time, end_time, location,
      work_status: d < today ? 'done' : 'booked' };
    if (deposit) {
      const acc = defaultAcc(null);
      Object.assign(data, { deposit, deposit_account_id: acc?.id, deposit_date: today });
      if (deposit > (amount || 0)) warnings.push('Tiền cọc lớn hơn tiền công.');
    }
    if (!amount) warnings.push('Chưa có tiền công: sẽ lưu 0đ, nhớ sửa lại.');
    if (!date && weekdayHint === null && !dayOfMonth) warnings.push('Không thấy ngày làm, đang để hôm nay.');
    return { ...base, type: 'job', ok: !(deposit > (amount || 0)), data,
      summary: `Show mới: ${title}${client ? ` cho ${client}` : ''}, ${dmy(d)}${start_time ? ` ${start_time}${end_time ? `–${end_time}` : ''}` : ''}, ${WORK_LABEL[work_type]}, ${amount ? fmt(amount) : 'chưa có giá'}${deposit ? `, đã cọc ${fmt(deposit)}` : ''}${data.work_status === 'done' ? ' (ngày đã qua: ghi là đã làm xong)' : ''}` };
  }

  if (!amount) return { ...base, type: 'unknown', ok: false, data: null, summary: 'Chưa hiểu dòng này: không thấy số tiền. Ví dụ: "ăn trưa 45k", "15/12 quay cưới Linh 6tr5 cọc 2tr".' };

  // --- 4. thu khác ---
  if (INCOME_START.test(text)) {
    const d = resolveDate(false);
    const acc = defaultAcc(null);
    const cat = guessCategory(text, ctx.categories, 'income');
    const desc = cap(strip(words, /^(thu|được|duoc|nhận được|nhan duoc)\s+/i)) || 'Khoản thu';
    return { ...base, type: 'other_income', ok: !!acc,
      data: { kind: 'other_income', amount, account_id: acc?.id, date: d, description: desc, category_id: cat?.id },
      summary: `Thu khác: ${desc}, ${fmt(amount)} vào ${accName(acc)}, ${dmy(d)}${cat ? `, mục ${cat.name}` : ''}` };
  }

  // --- 5. khoản chi (mặc định) ---
  const d = resolveDate(false);
  const acc = defaultAcc(null);
  const cat = guessCategory(text, ctx.categories, 'expense');
  const desc = cap(words) || cat?.name || 'Khoản chi';
  return { ...base, type: 'expense', ok: !!acc,
    data: { kind: 'expense', amount, account_id: acc?.id, date: d, description: desc, category_id: cat?.id },
    summary: `Chi: ${desc}, ${fmt(amount)} từ ${accName(acc)}, ${dmy(d)}${cat ? `, mục ${cat.name}` : ''}` };
}

const WORK_LABEL = { video: 'quay phim', video_edit: 'quay + dựng', edit: 'dựng phim', photo: 'chụp ảnh', other: 'việc khác' };
function guessType(t) {
  const quay = /\b(quay|video|phim|livestream|tvc|mv|event|su kien|cuoi|hoi nghi|hoi thao|khai truong|recap)\b/.test(t);
  const dung = /\b(dung|edit|hau ky|cat ghep|highlight|teaser)\b/.test(t);
  const chup = /\b(chup|anh|photo|ky yeu|pre ?wedding)\b/.test(t);
  if (/\bquay\b/.test(t) && dung) return 'video_edit';
  if (chup && !/\bquay\b/.test(t)) return 'photo';
  if (dung && !quay) return 'edit';
  if (quay) return 'video';
  return chup ? 'photo' : 'other';
}
function guessCategory(t, cats = [], kind) {
  const list = cats.filter(c => c.kind === kind);
  const byName = n => list.find(c => c.name === n);
  for (const [n, re] of kind === 'income' ? INCOME_CAT : CAT_WORDS) if (re.test(t) && byName(n)) return byName(n);
  for (const c of list) { const n = fold(c.name.toLowerCase()); if (n.length >= 3 && t.includes(n)) return c; }  // danh mục bạn tự tạo
  return kind === 'income' ? list[0] || null : byName('Khác') || null;
}
const f0 = s => fold(String(s || '').toLowerCase());
/** Độ dài đoạn tên (không dấu) xuất hiện trong câu; 0 nếu không có. */
function matchLen(lineFolded, name) {
  const n = f0(name).trim();
  if (n.length < 3) return 0;
  if (lineFolded.includes(n)) return n.length;
  // khớp một phần: bỏ "anh/chị/em/studio" ở đầu tên
  const core = n.replace(/^(anh|chi|em|co|chu|bac|studio|cty|cong ty)\s+/, '');
  if (core.length >= 3 && lineFolded.includes(core)) return core.length;
  // tên show: bỏ các từ chung (quay, cưới, chụp…), so phần riêng như tên cô dâu chú rể
  const own = n.replace(/\b(quay|chup|dung|edit|show|su kien|cuoi|dam|hoi|ky yeu|phim|anh|clip|video|cho|va|&|\+|-)\b/g, ' ')
    .split(/\s+/).filter(w => w.length >= 3);
  const hit = own.filter(w => new RegExp(`\\b${w}\\b`).test(lineFolded));
  return hit.length ? hit.join('').length : 0;
}
function findClient(orig, clients = []) {
  const lf = f0(orig);
  const best = clients.map(c => ({ c, s: matchLen(lf, c.name) })).filter(x => x.s).sort((a, b) => b.s - a.s)[0];
  return best ? best.c.name : null;
}
function pickClient(words) {
  const m = /\b(?:khách|khach|kh|cho|của|cua)\s+([^,]+)/i.exec(words);
  if (!m) return null;
  return cap(m[1].replace(/\b(tại|tai|ở)\b.*$/i, '').trim()) || null;
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = s => { s = (s || '').replace(/\s+/g, ' ').replace(/^[,.;:\s-]+|[,.;:\s-]+$/g, '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
const strip = (s, re) => s.replace(re, ' ').replace(/\s+/g, ' ').trim();
/** Lấy lại chữ có dấu ở những vị trí còn giữ trong bản làm việc. */
function clean(orig, f) {
  let out = '';
  for (let i = 0; i < orig.length; i++) out += f[i] === ' ' && orig[i] !== ' ' ? ' ' : orig[i];
  return out;
}
const dmy = s => `${s.slice(8)}/${s.slice(5, 7)}`;

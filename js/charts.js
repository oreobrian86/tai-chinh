// Biểu đồ SVG tự vẽ (không phụ thuộc thư viện ngoài). Chỉ dùng thuộc tính SVG, không dùng style inline (CSP).
import { h, short } from './util.js';

export const C = { income: '#5F8370', expense: '#7E9DB2', revenue: '#B98A2E', ink: '#22302A', grid: '#E1E0D7' };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Cột nhóm: mỗi nhãn x có nhiều cột cạnh nhau. */
export function groupedBars({ labels, series, height = 220, width = 640 }) {
  const padL = 44, padB = 26, padT = 10, w = width - padL - 6, ch = height - padB - padT;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const gw = w / labels.length, bw = Math.min(22, (gw * 0.7) / series.length);
  let out = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ cột">`;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ch - (ch * i) / 4;
    out += `<line x1="${padL}" x2="${width - 6}" y1="${y}" y2="${y}" class="g" stroke="${C.grid}" stroke-width="1"/>`;
    out += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end">${short((max * i) / 4)}</text>`;
  }
  labels.forEach((lb, i) => {
    const gx = padL + gw * i + (gw - bw * series.length - 3 * (series.length - 1)) / 2;
    series.forEach((s, k) => {
      const v = s.values[i] || 0, bh = (ch * v) / max;
      const x = gx + k * (bw + 3), y = padT + ch - bh;
      out += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0, bh)}" rx="4" fill="${s.color}"><title>${h(s.name)} ${h(lb)}: ${h(short(v))}</title></rect>`;
    });
    out += `<text x="${padL + gw * i + gw / 2}" y="${height - 8}" text-anchor="middle" class="lbl">${h(lb)}</text>`;
  });
  return out + '</svg>';
}

/** Đường xu hướng + đường trung bình nét đứt. */
export function lineChart({ labels, values, color = C.expense, height = 200, width = 640, avgLabel = 'Trung bình' }) {
  const padL = 44, padB = 26, padT = 14, w = width - padL - 16, ch = height - padB - padT;
  const max = niceMax(Math.max(1, ...values));
  const x = i => padL + (labels.length === 1 ? w / 2 : (w * i) / (labels.length - 1));
  const y = v => padT + ch - (ch * v) / max;
  let out = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ xu hướng">`;
  for (let i = 0; i <= 4; i++) {
    const yy = padT + ch - (ch * i) / 4;
    out += `<line x1="${padL}" x2="${width - 6}" y1="${yy}" y2="${yy}" class="g" stroke="${C.grid}"/>`;
    out += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end">${short((max * i) / 4)}</text>`;
  }
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const area = `${x(0)},${padT + ch} ${pts} ${x(values.length - 1)},${padT + ch}`;
  out += `<polygon points="${area}" fill="${color}" fill-opacity="0.12"/>`;
  out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const nz = values.filter(v => v > 0);
  if (nz.length) {
    const avg = nz.reduce((a, b) => a + b, 0) / nz.length;
    out += `<line x1="${padL}" x2="${width - 6}" y1="${y(avg)}" y2="${y(avg)}" class="avg" stroke="${C.ink}" stroke-opacity=".45" stroke-dasharray="4 4"/>`;
    out += `<text x="${width - 8}" y="${y(avg) - 6}" text-anchor="end">${h(avgLabel)} ${short(avg)}</text>`;
  }
  values.forEach((v, i) => {
    out += `<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="4" fill="#fff" stroke="${color}" stroke-width="2"><title>${h(labels[i])}: ${h(short(v))}</title></circle>`;
    out += `<text x="${x(i)}" y="${height - 8}" text-anchor="middle" class="lbl">${h(labels[i])}</text>`;
  });
  return out + '</svg>';
}

/** Cột ngày nhỏ (chi tiêu từng ngày trong tháng). */
export function dailyBars({ days, values, height = 120, width = 640, color = C.expense, highlight }) {
  const padB = 18, ch = height - padB - 4;
  const max = niceMax(Math.max(1, ...values));
  const bw = width / days.length;
  let out = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Chi tiêu theo ngày">`;
  days.forEach((d, i) => {
    const v = values[i] || 0, bh = (ch * v) / max;
    const fill = d === highlight ? C.ink : color;
    const cls = d === highlight ? ' class="hl"' : '';
    out += `<rect${cls} x="${i * bw + bw * 0.15}" y="${4 + ch - bh}" width="${bw * 0.7}" height="${Math.max(v ? 2 : 0, bh)}" rx="2" fill="${fill}"><title>${h(d)}: ${h(short(v))}</title></rect>`;
    const dn = Number(d.slice(8));
    if (dn === 1 || dn % 5 === 0) out += `<text x="${i * bw + bw / 2}" y="${height - 4}" text-anchor="middle">${dn}</text>`;
  });
  return out + '</svg>';
}

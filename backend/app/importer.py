"""Nhập giao dịch từ CSV/Excel: xem trước → ghép cột → kiểm tra lỗi & trùng → xác nhận. Có thể hoàn tác theo lô."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import secrets
import threading
import time
import unicodedata
from datetime import date, datetime

from .db import audit, new_id, now_iso, transaction
from .schemas import AppError
from . import services as sv

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20000
_PENDING: dict[str, dict] = {}
_LOCK = threading.Lock()
TTL = 30 * 60


def _cleanup():
    now = time.time()
    for k in [k for k, v in _PENDING.items() if now - v["at"] > TTL]:
        _PENDING.pop(k, None)


def parse_file(filename: str, data: bytes) -> list[list[str]]:
    if len(data) > MAX_BYTES:
        raise AppError(413, "too_large", "File quá lớn (tối đa 5 MB).")
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)  # chỉ đọc giá trị, bỏ công thức
            ws = wb.worksheets[0]
            out = []
            for r in ws.iter_rows(values_only=True):
                if len(out) >= MAX_ROWS:
                    break
                cells = ["" if v is None else (v.date().isoformat() if isinstance(v, datetime) else
                                               v.isoformat() if isinstance(v, date) else str(v)) for v in r]
                if any(c.strip() for c in cells):
                    out.append(cells)
            wb.close()
            return out
        except AppError:
            raise
        except Exception:
            raise AppError(422, "bad_file", "Không đọc được file Excel. Hãy lưu lại dạng .xlsx hoặc .csv.")
    if name.endswith((".csv", ".txt")) or not name:
        text = None
        for enc in ("utf-8-sig", "cp1258", "cp1252"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise AppError(422, "bad_encoding", "Không nhận dạng được bảng mã của file CSV.")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
            delim = dialect.delimiter
        except csv.Error:
            delim = ";" if sample.count(";") > sample.count(",") else ","
        out = []
        for r in csv.reader(io.StringIO(text), delimiter=delim):
            if len(out) >= MAX_ROWS:
                break
            if any(c.strip() for c in r):
                out.append([c.strip() for c in r])
        return out
    raise AppError(415, "bad_type", "Chỉ hỗ trợ file .csv hoặc .xlsx.")


def store_pending(uid: str, filename: str, rows: list[list[str]]) -> str:
    token = secrets.token_urlsafe(16)
    with _LOCK:
        _cleanup()
        _PENDING[token] = {"uid": uid, "filename": filename, "rows": rows, "at": time.time()}
    return token


def get_pending(uid: str, token: str) -> dict:
    with _LOCK:
        p = _PENDING.get(token)
    if not p or p["uid"] != uid:
        raise AppError(410, "expired", "Phiên nhập file đã hết hạn, hãy tải file lên lại.")
    return p


def guess_mapping(header: list[str]) -> dict[str, int | None]:
    def norm(s):
        s = unicodedata.normalize("NFD", s.lower())
        return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").replace("đ", "d")
    keys = {
        "date": ("ngay", "date", "thoi gian", "ngay gd", "ngay giao dich"),
        "amount": ("so tien", "amount", "tien", "gia tri"),
        "debit": ("ghi no", "debit", "tien ra", "chi", "rut"),
        "credit": ("ghi co", "credit", "tien vao", "thu", "nap"),
        "description": ("noi dung", "mo ta", "dien giai", "description", "chi tiet", "ten"),
        "category": ("danh muc", "category", "loai", "nhom"),
        "note": ("ghi chu", "note"),
    }
    out: dict[str, int | None] = {k: None for k in keys}
    hn = [norm(h) for h in header]
    for field, cands in keys.items():
        for i, h in enumerate(hn):
            if any(h == c or h.startswith(c) for c in cands) and i not in out.values():
                out[field] = i
                break
    return out


def parse_amount(s: str) -> int | None:
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")"))
    s = re.sub(r"[^\d,.\-]", "", s).strip("-")
    if not s:
        return None
    # "1.500.000" hoặc "1,500,000" → bỏ phân cách nghìn. "45000.0" (Excel) → phần thập phân.
    if re.fullmatch(r"\d+[.,]\d{1,2}", s):
        s = s.replace(",", ".")
        val = round(float(s))
    else:
        val = int(re.sub(r"[.,]", "", s) or "0")
    return -val if neg else val


def parse_date(s: str, fmt: str) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    s = s.split(" ")[0].split("T")[0]
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    try:
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
        if m:
            a, b, y = int(m[1]), int(m[2]), int(m[3])
            if y < 100:
                y += 2000
            if fmt == "mdy":
                a, b = b, a
            return date(y, b, a).isoformat()  # mặc định ngày/tháng/năm (VN)
    except ValueError:
        return None
    return None


def _norm_desc(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def analyze(conn, uid: str, req: dict) -> dict:
    p = get_pending(uid, req["token"])
    sv.owned(conn, "accounts", uid, req["account_id"], "tài khoản")
    rows_ = p["rows"][1:] if req.get("skip_header", True) else p["rows"]
    mp = req["mapping"]
    mode = req.get("amount_mode", "expense_positive")
    cats = {c["name"].lower(): c for c in sv.list_categories(conn, uid)}

    def cell(r, f):
        i = mp.get(f)
        return r[i] if i is not None and 0 <= i < len(r) else ""

    out, occurrences = [], {}
    for idx, r in enumerate(rows_):
        errors = []
        d = parse_date(cell(r, "date"), req.get("date_format", "auto"))
        if not d:
            errors.append("Ngày không hợp lệ")
        if mode == "debit_credit":
            debit, credit = parse_amount(cell(r, "debit")) or 0, parse_amount(cell(r, "credit")) or 0
            signed = abs(credit) - abs(debit)
        else:
            a = parse_amount(cell(r, "amount"))
            if a is None:
                signed = None
            elif mode == "expense_positive":
                signed = -abs(a) if a > 0 else abs(a)  # số dương = khoản chi; số âm = khoản thu
            else:
                signed = a
        if not signed:
            errors.append("Số tiền trống hoặc bằng 0")
        elif abs(signed) > 100_000_000_000:
            errors.append("Số tiền quá lớn")
        desc = cell(r, "description")[:300]
        cat_name = cell(r, "category").strip().lower()
        kind = "expense" if (signed or 0) < 0 else "other_income"
        cat = cats.get(cat_name)
        if cat and cat["kind"] != ("expense" if kind == "expense" else "income"):
            cat = None
        status = "error" if errors else "ok"
        h = None
        if not errors:
            base = f"{d}|{signed}|{_norm_desc(desc)}|{req['account_id']}"
            occurrences[base] = occurrences.get(base, 0) + 1
            h = hashlib.sha256(f"{base}|{occurrences[base]}".encode()).hexdigest()
            if conn.execute("SELECT 1 FROM transactions WHERE user_id=? AND import_hash=? AND deleted_at IS NULL", (uid, h)).fetchone():
                status = "duplicate"
            else:
                # nghi trùng với giao dịch nhập tay: cùng ngày, cùng số tiền, cùng tài khoản
                dup = conn.execute(
                    """SELECT t.id FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id
                       WHERE t.user_id=? AND t.deleted_at IS NULL AND t.date=? AND l.account_id=? AND l.amount=?
                       AND t.import_hash IS NULL LIMIT 1""", (uid, d, req["account_id"], signed)).fetchone()
                if dup:
                    status = "suspect"
        out.append({"index": idx, "date": d, "amount": signed, "kind": kind, "description": desc,
                    "category_id": cat["id"] if cat else None, "category_name": cat["name"] if cat else None,
                    "note": cell(r, "note")[:500], "status": status, "errors": errors, "hash": h, "raw": r[:12]})
    counts = {s: sum(1 for x in out if x["status"] == s) for s in ("ok", "error", "duplicate", "suspect")}
    return {"rows": out, "counts": counts, "filename": p["filename"]}


def commit(conn, uid: str, req: dict) -> dict:
    res = analyze(conn, uid, req)
    include = set(req.get("include_duplicates") or [])
    to_import = [r for r in res["rows"] if r["status"] == "ok" or (r["status"] == "suspect" and r["index"] in include)]
    with transaction(conn):
        bid = new_id()
        n = now_iso()
        conn.execute("""INSERT INTO import_batches(id,user_id,filename,row_count,imported_count,skipped_count,status,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                     (bid, uid, res["filename"], len(res["rows"]), len(to_import), len(res["rows"]) - len(to_import), "committed", n, n))
        exp_default = sv.system_category(conn, uid, "expense")
        inc_default = sv.system_category(conn, uid, "income")
        for r in to_import:
            sv._insert_tx(conn, uid, r["kind"], r["date"], [(req["account_id"], r["amount"])],
                          description=r["description"] or None, note=r["note"] or None,
                          category_id=r["category_id"] or (exp_default if r["kind"] == "expense" else inc_default),
                          import_batch_id=bid, import_hash=r["hash"])
        audit(conn, uid, "import_batch", bid, "commit", {"imported": len(to_import), "file": res["filename"]})
    with _LOCK:
        _PENDING.pop(req["token"], None)
    return {"batch_id": bid, "imported": len(to_import), "skipped": len(res["rows"]) - len(to_import), "counts": res["counts"]}


def undo(conn, uid: str, bid: str) -> dict:
    with transaction(conn):
        b = conn.execute("SELECT * FROM import_batches WHERE id=? AND user_id=?", (bid, uid)).fetchone()
        if not b:
            raise AppError(404, "not_found", "Không tìm thấy lô nhập.")
        if b["status"] == "undone":
            raise AppError(409, "already_undone", "Lô này đã được hoàn tác.")
        n = now_iso()
        cur = conn.execute("UPDATE transactions SET deleted_at=?, updated_at=? WHERE import_batch_id=? AND user_id=? AND deleted_at IS NULL",
                           (n, n, bid, uid))
        conn.execute("UPDATE import_batches SET status='undone', updated_at=? WHERE id=?", (n, bid))
        audit(conn, uid, "import_batch", bid, "undo", {"removed": cur.rowcount})
    return {"removed": cur.rowcount}

"""Nghiệp vụ ghi dữ liệu. Mọi hàm ghi đều chạy trong transaction và kiểm tra quyền sở hữu."""
from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

from . import finance as fe
from .db import audit, new_id, now_iso, row, rows, transaction
from .schemas import AppError, not_found
from .security import hash_secret, password_problems

DEFAULT_EXPENSE_CATEGORIES = [
    ("Ăn uống", "🍜", "#C9875B"), ("Cà phê, nước uống", "☕", "#A47551"),
    ("Đi chơi, hẹn hò", "🎈", "#C77D8E"), ("Đi lại, xăng xe", "⛽", "#7C8FA6"),
    ("Mua sắm", "🛍", "#B48BBE"), ("Thiết bị quay, chụp", "🎥", "#5F8B7A"),
    ("Phần mềm, dịch vụ", "💻", "#6E8FB5"), ("Sinh hoạt", "🏠", "#8EA27A"),
    ("Gia đình", "👪", "#D19A66"), ("Sức khỏe", "💊", "#7FA9A3"), ("Khác", "•", "#9A968E"),
]
DEFAULT_INCOME_CATEGORIES = [("Thu nhập khác", "💰", "#7C9A85"), ("Quà tặng", "🎁", "#C77D8E"),
                             ("Hoàn tiền", "↩", "#7C8FA6")]
DEFAULT_SETTINGS = {"lock_minutes": 10, "exclude_one_off": False}

TS = "created_at, updated_at"


def _ts() -> tuple[str, str]:
    n = now_iso()
    return n, n


# ---------- người dùng ----------

def user_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def setup_user(conn, username: str, password: str, display_name: str | None) -> dict:
    prob = password_problems(password)
    if prob:
        raise AppError(422, "weak_password", prob, {"password": prob})
    with transaction(conn):
        if user_count(conn) > 0:
            raise AppError(409, "already_setup", "Ứng dụng đã được thiết lập.")
        uid = new_id()
        c, u = _ts()
        conn.execute("INSERT INTO users(id, username, display_name, password_hash, settings_json, created_at, updated_at)"
                     " VALUES (?,?,?,?,?,?,?)",
                     (uid, username, display_name or username, hash_secret(password), json.dumps(DEFAULT_SETTINGS), c, u))
        for i, (n, ic, col) in enumerate(DEFAULT_EXPENSE_CATEGORIES):
            conn.execute(f"INSERT INTO categories(id,user_id,name,kind,icon,color,sort,is_system,{TS}) VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (new_id(), uid, n, "expense", ic, col, i, 1 if n == "Khác" else 0, c, u))
        for i, (n, ic, col) in enumerate(DEFAULT_INCOME_CATEGORIES):
            conn.execute(f"INSERT INTO categories(id,user_id,name,kind,icon,color,sort,is_system,{TS}) VALUES (?,?,?,?,?,?,?,?,?,?)",
                         (new_id(), uid, n, "income", ic, col, i, 1 if i == 0 else 0, c, u))
        for i, (n, k) in enumerate([("Tiền mặt", "cash"), ("Ngân hàng", "bank")]):
            conn.execute(f"INSERT INTO accounts(id,user_id,name,kind,sort,{TS}) VALUES (?,?,?,?,?,?,?)",
                         (new_id(), uid, n, k, i, c, u))
        audit(conn, uid, "user", uid, "setup")
    return {"id": uid, "username": username}


def get_settings(conn, uid) -> dict:
    r = conn.execute("SELECT settings_json FROM users WHERE id=?", (uid,)).fetchone()
    s = dict(DEFAULT_SETTINGS)
    if r:
        s.update(json.loads(r[0] or "{}"))
    return s


def update_settings(conn, uid, patch: dict) -> dict:
    with transaction(conn):
        s = get_settings(conn, uid)
        dn = patch.pop("display_name", None)
        s.update({k: v for k, v in patch.items() if v is not None})
        conn.execute("UPDATE users SET settings_json=?, updated_at=? WHERE id=?", (json.dumps(s), now_iso(), uid))
        if dn:
            conn.execute("UPDATE users SET display_name=? WHERE id=?", (dn, uid))
    return s


# ---------- tra cứu có kiểm tra quyền ----------

def owned(conn, table: str, uid: str, obj_id: str | None, what: str = "dữ liệu") -> dict:
    if not obj_id:
        raise not_found(f"Không tìm thấy {what}")
    r = conn.execute(f"SELECT * FROM {table} WHERE id=? AND user_id=? AND deleted_at IS NULL", (obj_id, uid)).fetchone()
    if r is None:
        raise not_found(f"Không tìm thấy {what}")
    return dict(r)


def _account(conn, uid, aid) -> dict:
    a = owned(conn, "accounts", uid, aid, "tài khoản")
    return a


def _category(conn, uid, cid, kind: str | None = None) -> dict | None:
    if not cid:
        return None
    c = owned(conn, "categories", uid, cid, "danh mục")
    if kind and c["kind"] != kind:
        raise AppError(422, "bad_category", "Danh mục không đúng loại.", {"category_id": "Sai loại danh mục"})
    return c


def system_category(conn, uid, kind: str) -> str | None:
    r = conn.execute("SELECT id FROM categories WHERE user_id=? AND kind=? AND deleted_at IS NULL"
                     " ORDER BY is_system DESC, sort LIMIT 1", (uid, kind)).fetchone()
    return r[0] if r else None


# ---------- giao dịch (lõi) ----------

def _insert_tx(conn, uid, kind, d, lines: list[tuple[str, int]], **fields) -> str:
    if not lines:
        raise AppError(422, "no_lines", "Giao dịch không có dòng tiền.")
    if any(amt == 0 for _, amt in lines):
        raise AppError(422, "zero_amount", "Số tiền phải khác 0.", {"amount": "Số tiền phải khác 0"})
    if kind == "transfer":
        if len(lines) != 2 or sum(a for _, a in lines) != 0 or lines[0][0] == lines[1][0]:
            raise AppError(422, "bad_transfer", "Chuyển khoản phải gồm 2 tài khoản khác nhau và tổng bằng 0.")
    tid = new_id()
    c, u = _ts()
    conn.execute(
        f"""INSERT INTO transactions(id,user_id,kind,date,description,category_id,job_id,obligation_id,is_one_off,
            import_batch_id,import_hash,note,{TS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (tid, uid, kind, d, fields.get("description"), fields.get("category_id"), fields.get("job_id"),
         fields.get("obligation_id"), 1 if fields.get("is_one_off") else 0, fields.get("import_batch_id"),
         fields.get("import_hash"), fields.get("note"), c, u))
    for aid, amt in lines:
        conn.execute("INSERT INTO transaction_lines(id, transaction_id, account_id, amount) VALUES (?,?,?,?)",
                     (new_id(), tid, aid, int(amt)))
    return tid


def get_tx(conn, uid, tid) -> dict:
    t = owned(conn, "transactions", uid, tid, "giao dịch")
    t["lines"] = rows(conn.execute("SELECT l.account_id, l.amount, a.name AS account_name FROM transaction_lines l"
                                   " JOIN accounts a ON a.id=l.account_id WHERE l.transaction_id=? ORDER BY l.amount",
                                   (tid,)))
    t["amount"] = _display_amount(t["kind"], t["lines"])
    return t


def _display_amount(kind, lines) -> int:
    if kind == "transfer":
        return sum(l["amount"] for l in lines if l["amount"] > 0)
    total = sum(l["amount"] for l in lines)
    return -total if kind == "expense" else total


def create_tx(conn, uid, data: dict, today: date) -> dict:
    kind = data["kind"]
    d = data.get("date") or today.isoformat()
    amount = int(data["amount"])
    with transaction(conn):
        acc = _account(conn, uid, data["account_id"])
        if acc["archived"]:
            raise AppError(422, "archived_account", "Tài khoản đã lưu trữ.")
        job_id = None
        if data.get("job_id"):
            job_id = owned(conn, "jobs", uid, data["job_id"], "show")["id"]
        if kind == "expense":
            if amount <= 0:
                raise AppError(422, "bad_amount", "Số tiền chi phải lớn hơn 0.", {"amount": "Phải lớn hơn 0"})
            cat = _category(conn, uid, data.get("category_id"), "expense")
            tid = _insert_tx(conn, uid, kind, d, [(acc["id"], -amount)],
                             category_id=cat["id"] if cat else system_category(conn, uid, "expense"),
                             description=data.get("description"), note=data.get("note"),
                             is_one_off=data.get("is_one_off"), job_id=job_id)
        elif kind == "other_income":
            if amount <= 0:
                raise AppError(422, "bad_amount", "Số tiền thu phải lớn hơn 0.", {"amount": "Phải lớn hơn 0"})
            cat = _category(conn, uid, data.get("category_id"), "income")
            tid = _insert_tx(conn, uid, kind, d, [(acc["id"], amount)],
                             category_id=cat["id"] if cat else system_category(conn, uid, "income"),
                             description=data.get("description"), note=data.get("note"))
        elif kind == "transfer":
            if amount <= 0:
                raise AppError(422, "bad_amount", "Số tiền chuyển phải lớn hơn 0.", {"amount": "Phải lớn hơn 0"})
            to = _account(conn, uid, data.get("to_account_id"))
            if to["id"] == acc["id"]:
                raise AppError(422, "same_account", "Tài khoản nguồn và đích phải khác nhau.",
                               {"to_account_id": "Phải khác tài khoản nguồn"})
            tid = _insert_tx(conn, uid, kind, d, [(acc["id"], -amount), (to["id"], amount)],
                             description=data.get("description") or f"Chuyển {acc['name']} → {to['name']}",
                             note=data.get("note"))
            fee = int(data.get("fee") or 0)
            if fee > 0:
                _insert_tx(conn, uid, "expense", d, [(acc["id"], -fee)], category_id=system_category(conn, uid, "expense"),
                           description="Phí chuyển khoản", note=f"Phí của giao dịch {tid}")
        elif kind == "adjustment":
            tid = _insert_tx(conn, uid, kind, d, [(acc["id"], amount)],
                             description=data.get("description") or "Điều chỉnh số dư", note=data.get("note"))
        else:
            raise AppError(422, "bad_kind", "Loại giao dịch không hợp lệ.")
        audit(conn, uid, "transaction", tid, "create", data)
        return get_tx(conn, uid, tid)


def update_tx(conn, uid, tid, patch: dict, today: date) -> dict:
    with transaction(conn):
        t = get_tx(conn, uid, tid)
        kind = t["kind"]
        if kind == "job_refund" and (patch.get("amount") is not None or patch.get("account_id")):
            raise AppError(409, "refund_locked", "Khoản hoàn cọc chỉ sửa được ngày và ghi chú.")
        if kind == "job_refund":
            amount = -t["amount"]  # giữ nguyên
        elif patch.get("amount") is not None:
            amount = int(patch["amount"])
        else:
            amount = t["amount"]
        if kind not in ("adjustment",) and amount <= 0:
            raise AppError(422, "bad_amount", "Số tiền phải lớn hơn 0.", {"amount": "Phải lớn hơn 0"})
        if kind == "adjustment" and amount == 0:
            raise AppError(422, "bad_amount", "Số tiền phải khác 0.", {"amount": "Khác 0"})
        sets, params = [], []
        for f in ("date", "description", "note"):
            if f in patch and patch[f] is not None:
                sets.append(f"{f}=?"); params.append(patch[f])
        if patch.get("is_one_off") is not None:
            sets.append("is_one_off=?"); params.append(1 if patch["is_one_off"] else 0)
        if patch.get("category_id"):
            ck = "income" if kind == "other_income" else "expense"
            _category(conn, uid, patch["category_id"], ck)
            sets.append("category_id=?"); params.append(patch["category_id"])
        # dòng tiền
        if kind == "transfer":
            src = next(l for l in t["lines"] if l["amount"] < 0)["account_id"]
            dst = next(l for l in t["lines"] if l["amount"] > 0)["account_id"]
            src = _account(conn, uid, patch.get("account_id") or src)["id"]
            dst = _account(conn, uid, patch.get("to_account_id") or dst)["id"]
            if src == dst:
                raise AppError(422, "same_account", "Tài khoản nguồn và đích phải khác nhau.")
            new_lines = [(src, -amount), (dst, amount)]
        else:
            aid = _account(conn, uid, patch.get("account_id") or t["lines"][0]["account_id"])["id"]
            if kind in ("expense", "job_refund"):
                new_lines = [(aid, -amount)]
            else:  # job_payment, other_income, adjustment
                new_lines = [(aid, amount)]
        if kind == "job_payment" and t["job_id"]:
            job = owned(conn, "jobs", uid, t["job_id"], "show")
            received_other = fe.job_received(conn, job["id"]) - sum(l["amount"] for l in t["lines"])
            if job["work_status"] != "cancelled" and received_other + amount > job["total_fee"] and not patch.get("allow_overpay"):
                raise AppError(409, "overpay", "Số tiền vượt quá tổng tiền công của show.")
        conn.execute("DELETE FROM transaction_lines WHERE transaction_id=?", (tid,))
        for aid, amt in new_lines:
            conn.execute("INSERT INTO transaction_lines(id, transaction_id, account_id, amount) VALUES (?,?,?,?)",
                         (new_id(), tid, aid, amt))
        sets += ["updated_at=?", "version=version+1"]
        params += [now_iso()]
        conn.execute(f"UPDATE transactions SET {', '.join(sets)} WHERE id=?", (*params, tid))
        audit(conn, uid, "transaction", tid, "update", {"before": t, "patch": patch})
        return get_tx(conn, uid, tid)


def delete_tx(conn, uid, tid) -> None:
    with transaction(conn):
        t = get_tx(conn, uid, tid)
        conn.execute("UPDATE transactions SET deleted_at=?, updated_at=?, version=version+1 WHERE id=?",
                     (now_iso(), now_iso(), tid))
        if t["obligation_id"]:
            conn.execute("UPDATE obligations SET paid_transaction_id=NULL WHERE id=? AND paid_transaction_id=?",
                         (t["obligation_id"], tid))
        audit(conn, uid, "transaction", tid, "delete", t)


def list_tx(conn, uid, q: dict) -> dict:
    where, params = ["t.user_id=?", "t.deleted_at IS NULL"], [uid]
    if q.get("from"):
        where.append("t.date>=?"); params.append(q["from"])
    if q.get("to"):
        where.append("t.date<=?"); params.append(q["to"])
    if q.get("kind"):
        kinds = q["kind"].split(",")
        where.append(f"t.kind IN ({','.join('?' * len(kinds))})"); params += kinds
    if q.get("category_id"):
        where.append("t.category_id=?"); params.append(q["category_id"])
    if q.get("account_id"):
        where.append("EXISTS (SELECT 1 FROM transaction_lines x WHERE x.transaction_id=t.id AND x.account_id=?)")
        params.append(q["account_id"])
    if q.get("job_id"):
        where.append("t.job_id=?"); params.append(q["job_id"])
    if q.get("q"):
        where.append("(t.description LIKE ? OR t.note LIKE ?)"); params += [f"%{q['q']}%"] * 2
    limit = min(int(q.get("limit") or 200), 1000)
    offset = max(int(q.get("offset") or 0), 0)
    sql = f"""SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
                     j.title AS job_title
              FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN jobs j ON j.id=t.job_id
              WHERE {' AND '.join(where)} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?"""
    items = rows(conn.execute(sql, (*params, limit, offset)))
    ids = [t["id"] for t in items]
    lines: dict[str, list] = {}
    if ids:
        for l in conn.execute(f"""SELECT l.transaction_id, l.account_id, l.amount, a.name AS account_name
                                  FROM transaction_lines l JOIN accounts a ON a.id=l.account_id
                                  WHERE l.transaction_id IN ({','.join('?' * len(ids))}) ORDER BY l.amount""", ids):
            lines.setdefault(l["transaction_id"], []).append(dict(l))
    for t in items:
        t["lines"] = lines.get(t["id"], [])
        t["amount"] = _display_amount(t["kind"], t["lines"])
    total = conn.execute(f"SELECT COUNT(*) FROM transactions t WHERE {' AND '.join(where)}", params).fetchone()[0]
    return {"items": items, "total": total}


def expense_summary(conn, uid, start: str, end: str, group: str) -> list[dict]:
    fmt = {"day": "%Y-%m-%d", "month": "%Y-%m", "week": "%Y-W%W"}[group]
    return rows(conn.execute(
        f"""SELECT strftime('{fmt}', t.date) AS period, -SUM(l.amount) AS total, COUNT(DISTINCT t.id) AS count
            FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id
            WHERE t.user_id=? AND t.deleted_at IS NULL AND t.kind='expense' AND t.date BETWEEN ? AND ?
            GROUP BY period ORDER BY period""", (uid, start, end)))


# ---------- tài khoản ----------

def create_account(conn, uid, data: dict, today: date) -> dict:
    with transaction(conn):
        aid = new_id()
        c, u = _ts()
        sort = conn.execute("SELECT COALESCE(MAX(sort),0)+1 FROM accounts WHERE user_id=?", (uid,)).fetchone()[0]
        conn.execute(f"INSERT INTO accounts(id,user_id,name,kind,sort,{TS}) VALUES (?,?,?,?,?,?,?)",
                     (aid, uid, data["name"], data["kind"], sort, c, u))
        ob = int(data.get("opening_balance") or 0)
        if ob:
            _insert_tx(conn, uid, "adjustment", data.get("opening_date") or today.isoformat(), [(aid, ob)],
                       description="Số dư đầu kỳ")
        audit(conn, uid, "account", aid, "create", data)
    return owned(conn, "accounts", uid, aid)


def update_account(conn, uid, aid, patch: dict) -> dict:
    with transaction(conn):
        owned(conn, "accounts", uid, aid, "tài khoản")
        sets, params = [], []
        for f in ("name", "kind", "sort"):
            if patch.get(f) is not None:
                sets.append(f"{f}=?"); params.append(patch[f])
        if patch.get("archived") is not None:
            sets.append("archived=?"); params.append(1 if patch["archived"] else 0)
        if sets:
            conn.execute(f"UPDATE accounts SET {', '.join(sets)}, updated_at=?, version=version+1 WHERE id=?",
                         (*params, now_iso(), aid))
        audit(conn, uid, "account", aid, "update", patch)
    return owned(conn, "accounts", uid, aid)


def delete_account(conn, uid, aid) -> dict:
    with transaction(conn):
        owned(conn, "accounts", uid, aid, "tài khoản")
        used = conn.execute("""SELECT COUNT(*) FROM transaction_lines l JOIN transactions t ON t.id=l.transaction_id
                               WHERE l.account_id=? AND t.deleted_at IS NULL""", (aid,)).fetchone()[0]
        if used:
            conn.execute("UPDATE accounts SET archived=1, updated_at=? WHERE id=?", (now_iso(), aid))
            audit(conn, uid, "account", aid, "archive")
            return {"archived": True}
        conn.execute("UPDATE accounts SET deleted_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), aid))
        audit(conn, uid, "account", aid, "delete")
        return {"deleted": True}


# ---------- danh mục ----------

def list_categories(conn, uid) -> list[dict]:
    return rows(conn.execute("""SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id=c.id
                                AND t.deleted_at IS NULL) AS usage
                                FROM categories c WHERE c.user_id=? AND c.deleted_at IS NULL
                                ORDER BY c.kind, c.sort, c.name""", (uid,)))


def create_category(conn, uid, data: dict) -> dict:
    with transaction(conn):
        dup = conn.execute("SELECT 1 FROM categories WHERE user_id=? AND kind=? AND name=? COLLATE NOCASE AND deleted_at IS NULL",
                           (uid, data["kind"], data["name"])).fetchone()
        if dup:
            raise AppError(409, "duplicate", "Danh mục đã tồn tại.", {"name": "Đã tồn tại"})
        cid = new_id()
        c, u = _ts()
        sort = data.get("sort")
        if sort is None:
            sort = conn.execute("SELECT COALESCE(MAX(sort),0)+1 FROM categories WHERE user_id=? AND kind=?",
                                (uid, data["kind"])).fetchone()[0]
        conn.execute(f"INSERT INTO categories(id,user_id,name,kind,icon,color,sort,{TS}) VALUES (?,?,?,?,?,?,?,?,?)",
                     (cid, uid, data["name"], data["kind"], data.get("icon"), data.get("color") or "#9A968E", sort, c, u))
        audit(conn, uid, "category", cid, "create", data)
    return owned(conn, "categories", uid, cid)


def update_category(conn, uid, cid, patch: dict) -> dict:
    with transaction(conn):
        owned(conn, "categories", uid, cid, "danh mục")
        sets, params = [], []
        for f in ("name", "icon", "color", "sort"):
            if patch.get(f) is not None:
                sets.append(f"{f}=?"); params.append(patch[f])
        if sets:
            conn.execute(f"UPDATE categories SET {', '.join(sets)}, updated_at=?, version=version+1 WHERE id=?",
                         (*params, now_iso(), cid))
        audit(conn, uid, "category", cid, "update", patch)
    return owned(conn, "categories", uid, cid)


def delete_category(conn, uid, cid, reassign_to: str | None) -> dict:
    with transaction(conn):
        cat = owned(conn, "categories", uid, cid, "danh mục")
        if cat["is_system"]:
            raise AppError(409, "system_category", "Không thể xóa danh mục mặc định cuối cùng (Khác).")
        used = conn.execute("SELECT COUNT(*) FROM transactions WHERE category_id=? AND deleted_at IS NULL", (cid,)).fetchone()[0]
        target = reassign_to or system_category(conn, uid, cat["kind"])
        if used:
            tgt = _category(conn, uid, target, cat["kind"])
            if tgt["id"] == cid:
                raise AppError(422, "bad_reassign", "Chọn danh mục khác để chuyển giao dịch sang.")
            conn.execute("UPDATE transactions SET category_id=?, updated_at=? WHERE category_id=?", (tgt["id"], now_iso(), cid))
            conn.execute("UPDATE obligations SET category_id=? WHERE category_id=?", (tgt["id"], cid))
        conn.execute("UPDATE categories SET deleted_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), cid))
        audit(conn, uid, "category", cid, "delete", {"moved": used, "to": target})
        return {"deleted": True, "moved": used}


# ---------- khách hàng ----------

def resolve_client(conn, uid, client_id: str | None, client_name: str | None) -> str | None:
    if client_id:
        return owned(conn, "clients", uid, client_id, "khách hàng")["id"]
    if client_name:
        r = conn.execute("SELECT id FROM clients WHERE user_id=? AND name=? COLLATE NOCASE AND deleted_at IS NULL",
                         (uid, client_name)).fetchone()
        if r:
            return r[0]
        cid = new_id()
        c, u = _ts()
        conn.execute(f"INSERT INTO clients(id,user_id,name,{TS}) VALUES (?,?,?,?,?)", (cid, uid, client_name, c, u))
        return cid
    return None


def save_client(conn, uid, data: dict, cid: str | None = None) -> dict:
    with transaction(conn):
        c, u = _ts()
        if cid:
            owned(conn, "clients", uid, cid, "khách hàng")
            conn.execute("UPDATE clients SET name=?, phone=?, note=?, updated_at=?, version=version+1 WHERE id=?",
                         (data["name"], data.get("phone"), data.get("note"), u, cid))
        else:
            cid = new_id()
            conn.execute(f"INSERT INTO clients(id,user_id,name,phone,note,{TS}) VALUES (?,?,?,?,?,?,?)",
                         (cid, uid, data["name"], data.get("phone"), data.get("note"), c, u))
        audit(conn, uid, "client", cid, "save", data)
    return owned(conn, "clients", uid, cid)


def delete_client(conn, uid, cid) -> None:
    with transaction(conn):
        owned(conn, "clients", uid, cid, "khách hàng")
        conn.execute("UPDATE clients SET deleted_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), cid))
        audit(conn, uid, "client", cid, "delete")


# ---------- show ----------

DEFAULT_SESSION_KIND = {"video": "shoot", "photo": "photo", "edit": "edit", "other": "other"}


def _save_sessions(conn, uid, job_id, sessions: list[dict]) -> None:
    keep = []
    c, u = _ts()
    for s in sessions:
        if s.get("start_time") and s.get("end_time") and s["end_time"] <= s["start_time"]:
            raise AppError(422, "bad_time", "Giờ kết thúc phải sau giờ bắt đầu.", {"sessions": "Giờ không hợp lệ"})
        sid = s.get("id")
        if sid and conn.execute("SELECT 1 FROM job_sessions WHERE id=? AND job_id=? AND user_id=?", (sid, job_id, uid)).fetchone():
            conn.execute("""UPDATE job_sessions SET kind=?, date=?, start_time=?, end_time=?, location=?, note=?,
                            deleted_at=NULL, updated_at=?, version=version+1 WHERE id=?""",
                         (s["kind"], s["date"], s.get("start_time"), s.get("end_time"), s.get("location"), s.get("note"), u, sid))
        else:
            sid = new_id()
            conn.execute(f"""INSERT INTO job_sessions(id,user_id,job_id,kind,date,start_time,end_time,location,note,{TS})
                             VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                         (sid, uid, job_id, s["kind"], s["date"], s.get("start_time"), s.get("end_time"),
                          s.get("location"), s.get("note"), c, u))
        keep.append(sid)
    q = "UPDATE job_sessions SET deleted_at=? WHERE job_id=? AND deleted_at IS NULL"
    params: list = [now_iso(), job_id]
    if keep:
        q += f" AND id NOT IN ({','.join('?' * len(keep))})"
        params += keep
    conn.execute(q, params)


def get_job(conn, uid, jid, today: date) -> dict:
    jobs = fe.jobs_with_money(conn, uid, today, "AND j.id=?", (jid,))
    if not jobs:
        raise not_found("Không tìm thấy show")
    j = jobs[0]
    j["sessions"] = rows(conn.execute("SELECT * FROM job_sessions WHERE job_id=? AND deleted_at IS NULL ORDER BY date, start_time",
                                      (jid,)))
    j["payments"] = rows(conn.execute(
        """SELECT t.id, t.kind, t.date, t.note, t.created_at, l.amount, a.name AS account_name, l.account_id
           FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id JOIN accounts a ON a.id=l.account_id
           WHERE t.job_id=? AND t.deleted_at IS NULL AND t.kind IN ('job_payment','job_refund')
           ORDER BY t.date, t.created_at""", (jid,)))
    j["conflicts"] = session_conflicts(conn, uid, [s["id"] for s in j["sessions"]])
    return j


def create_job(conn, uid, data: dict, today: date) -> dict:
    with transaction(conn):
        jid = new_id()
        c, u = _ts()
        client_id = resolve_client(conn, uid, data.get("client_id"), data.get("client_name"))
        conn.execute(f"""INSERT INTO jobs(id,user_id,title,client_id,work_type,work_date,total_fee,due_date,work_status,
                         location,description,note,{TS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (jid, uid, data["title"], client_id, data["work_type"], data["work_date"], data["total_fee"],
                      data.get("due_date"), data.get("work_status") or "booked", data.get("location"),
                      data.get("description"), data.get("note"), c, u))
        sessions = data.get("sessions")
        if not sessions:
            sessions = [{"kind": DEFAULT_SESSION_KIND[data["work_type"]], "date": data["work_date"],
                         "start_time": data.get("start_time"), "end_time": data.get("end_time"),
                         "location": data.get("location")}]
        _save_sessions(conn, uid, jid, sessions)
        dep = int(data.get("deposit") or 0)
        if dep > 0:
            if dep > data["total_fee"]:
                raise AppError(422, "deposit_too_big", "Tiền cọc không được lớn hơn tổng tiền công.", {"deposit": "Lớn hơn tổng công"})
            acc = _account(conn, uid, data.get("deposit_account_id"))
            _insert_tx(conn, uid, "job_payment", data.get("deposit_date") or today.isoformat(), [(acc["id"], dep)],
                       job_id=jid, description=f"Cọc: {data['title']}", note="Tiền cọc")
        audit(conn, uid, "job", jid, "create", data)
    return get_job(conn, uid, jid, today)


def update_job(conn, uid, jid, patch: dict, today: date) -> dict:
    with transaction(conn):
        job = owned(conn, "jobs", uid, jid, "show")
        if job["work_status"] == "cancelled" and any(patch.get(k) is not None for k in ("total_fee", "work_status")):
            raise AppError(409, "cancelled", "Show đã hủy, không thể đổi tiền công hoặc trạng thái.")
        sets, params = [], []
        for f in ("title", "work_type", "work_date", "total_fee", "work_status"):
            if patch.get(f) is not None:
                sets.append(f"{f}=?"); params.append(patch[f])
        for f in ("due_date", "location", "description", "note"):  # cho phép xóa trắng (null)
            if f in patch:
                sets.append(f"{f}=?"); params.append(patch[f])
        if "client_id" in patch or "client_name" in patch:
            sets.append("client_id=?"); params.append(resolve_client(conn, uid, patch.get("client_id"), patch.get("client_name")))
        if sets:
            conn.execute(f"UPDATE jobs SET {', '.join(sets)}, updated_at=?, version=version+1 WHERE id=?",
                         (*params, now_iso(), jid))
        if patch.get("sessions") is not None:
            _save_sessions(conn, uid, jid, patch["sessions"])
        audit(conn, uid, "job", jid, "update", patch)
    return get_job(conn, uid, jid, today)


def delete_job(conn, uid, jid) -> None:
    with transaction(conn):
        owned(conn, "jobs", uid, jid, "show")
        if fe.job_received(conn, jid) != 0 or conn.execute(
                "SELECT 1 FROM transactions WHERE job_id=? AND deleted_at IS NULL AND kind IN ('job_payment','job_refund')", (jid,)).fetchone():
            raise AppError(409, "has_payments", "Show đã có tiền nhận. Hãy dùng 'Hủy show' để xử lý tiền cọc, hoặc xóa các khoản thanh toán trước.")
        conn.execute("UPDATE jobs SET deleted_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), jid))
        conn.execute("UPDATE job_sessions SET deleted_at=? WHERE job_id=?", (now_iso(), jid))
        audit(conn, uid, "job", jid, "delete")


def add_payment(conn, uid, jid, data: dict, today: date) -> dict:
    with transaction(conn):
        job = owned(conn, "jobs", uid, jid, "show")
        if job["work_status"] == "cancelled":
            raise AppError(409, "cancelled", "Show đã hủy, không thể nhận thêm tiền.")
        acc = _account(conn, uid, data["account_id"])
        received = fe.job_received(conn, jid)
        amount = int(data["amount"])
        if received + amount > job["total_fee"] and not data.get("allow_overpay"):
            remain = max(0, job["total_fee"] - received)
            raise AppError(409, "overpay", f"Số tiền vượt công nợ còn lại ({remain:,}đ).".replace(",", "."),
                           {"amount": "Vượt công nợ còn lại"})
        tid = _insert_tx(conn, uid, "job_payment", data.get("date") or today.isoformat(), [(acc["id"], amount)],
                         job_id=jid, description=f"Thanh toán: {job['title']}", note=data.get("note"))
        audit(conn, uid, "job_payment", tid, "create", data)
    return get_job(conn, uid, jid, today)


def cancel_job(conn, uid, jid, data: dict, today: date) -> dict:
    with transaction(conn):
        job = owned(conn, "jobs", uid, jid, "show")
        if job["work_status"] == "cancelled":
            raise AppError(409, "cancelled", "Show đã được hủy trước đó.")
        received = fe.job_received(conn, jid)
        if data["policy"] == "refund" and received > 0:
            acc = _account(conn, uid, data.get("account_id"))
            _insert_tx(conn, uid, "job_refund", data.get("date") or today.isoformat(), [(acc["id"], -received)],
                       job_id=jid, description=f"Hoàn cọc: {job['title']}", note=data.get("note"))
        conn.execute("UPDATE jobs SET work_status='cancelled', cancel_policy=?, updated_at=?, version=version+1 WHERE id=?",
                     (data["policy"], now_iso(), jid))
        audit(conn, uid, "job", jid, "cancel", {"policy": data["policy"], "received": received})
    return get_job(conn, uid, jid, today)


# ---------- lịch ----------

def session_conflicts(conn, uid, session_ids: list[str] | None = None, start: str | None = None,
                      end: str | None = None) -> list[dict]:
    """Các cặp buổi làm trùng giờ (cùng ngày, khoảng giờ giao nhau, show chưa hủy)."""
    where, params = ["a.user_id=?"], [uid]
    if session_ids is not None:
        if not session_ids:
            return []
        where.append(f"a.id IN ({','.join('?' * len(session_ids))})"); params += session_ids
    if start:
        where.append("a.date>=?"); params.append(start)
    if end:
        where.append("a.date<=?"); params.append(end)
    rs = conn.execute(
        f"""SELECT a.id AS a_id, b.id AS b_id, a.date, a.start_time AS a_start, a.end_time AS a_end,
                   b.start_time AS b_start, b.end_time AS b_end, ja.title AS a_title, jb.title AS b_title,
                   a.job_id AS a_job, b.job_id AS b_job
            FROM job_sessions a JOIN job_sessions b ON a.date=b.date AND a.id<>b.id AND a.user_id=b.user_id
            JOIN jobs ja ON ja.id=a.job_id JOIN jobs jb ON jb.id=b.job_id
            WHERE {' AND '.join(where)} AND a.deleted_at IS NULL AND b.deleted_at IS NULL
              AND ja.deleted_at IS NULL AND jb.deleted_at IS NULL
              AND ja.work_status!='cancelled' AND jb.work_status!='cancelled'
              AND a.kind!='deadline' AND b.kind!='deadline'
              AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
              AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
              AND a.start_time < b.end_time AND b.start_time < a.end_time""", params).fetchall()
    seen, out = set(), []
    for r in rs:
        key = tuple(sorted((r["a_id"], r["b_id"])))
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(r))
    return out


def calendar_range(conn, uid, start: str, end: str, today: date) -> dict:
    sessions = rows(conn.execute(
        """SELECT s.*, j.title, j.work_type, j.work_status, j.total_fee, c.name AS client_name
           FROM job_sessions s JOIN jobs j ON j.id=s.job_id LEFT JOIN clients c ON c.id=j.client_id
           WHERE s.user_id=? AND s.deleted_at IS NULL AND j.deleted_at IS NULL AND s.date BETWEEN ? AND ?
           ORDER BY s.date, COALESCE(s.start_time,'99')""", (uid, start, end)))
    jobs = {j["id"]: j for j in fe.jobs_with_money(conn, uid, today, "AND j.id IN (SELECT job_id FROM job_sessions WHERE user_id=? AND date BETWEEN ? AND ? AND deleted_at IS NULL)", (uid, start, end))}
    for s in sessions:
        j = jobs.get(s["job_id"])
        if j:
            s["pay_status"] = j["pay_status"]
            s["outstanding"] = j["outstanding"]
    day_offs = rows(conn.execute("SELECT * FROM day_offs WHERE user_id=? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date",
                                 (uid, start, end)))
    conflicts = session_conflicts(conn, uid, start=start, end=end)
    return {"sessions": sessions, "day_offs": day_offs, "conflicts": conflicts}


def _minutes(t1: str | None, t2: str | None) -> int:
    if not t1 or not t2:
        return 0
    h1, m1 = map(int, t1.split(":")); h2, m2 = map(int, t2.split(":"))
    return max(0, (h2 * 60 + m2) - (h1 * 60 + m1))


def work_stats(conn, uid, start: str, end: str, today: date) -> dict:
    ss = rows(conn.execute(
        """SELECT s.date, s.kind, s.start_time, s.end_time FROM job_sessions s JOIN jobs j ON j.id=s.job_id
           WHERE s.user_id=? AND s.deleted_at IS NULL AND j.deleted_at IS NULL AND j.work_status!='cancelled'
           AND s.kind!='deadline' AND s.date BETWEEN ? AND ?""", (uid, start, end)))
    days = len({s["date"] for s in ss})
    minutes = sum(_minutes(s["start_time"], s["end_time"]) for s in ss)
    jobs = fe.jobs_with_money(conn, uid, today, "AND j.work_date BETWEEN ? AND ? AND j.work_status!='cancelled'", (start, end))
    upcoming = fe.jobs_with_money(conn, uid, today, "AND j.work_status IN ('booked','in_progress')")
    return {"work_days": days, "hours": round(minutes / 60, 1), "sessions": len(ss),
            "fee_total": sum(j["total_fee"] for j in jobs), "jobs": len(jobs),
            "expected_from_booked": sum(j["outstanding"] for j in upcoming),
            "booked_jobs": len(upcoming)}


def save_day_off(conn, uid, data: dict) -> dict:
    with transaction(conn):
        did = new_id()
        c, u = _ts()
        conn.execute(f"INSERT INTO day_offs(id,user_id,date,note,{TS}) VALUES (?,?,?,?,?,?)", (did, uid, data["date"], data.get("note"), c, u))
    return owned(conn, "day_offs", uid, did)


def delete_day_off(conn, uid, did) -> None:
    with transaction(conn):
        owned(conn, "day_offs", uid, did, "ngày nghỉ")
        conn.execute("UPDATE day_offs SET deleted_at=? WHERE id=?", (now_iso(), did))


# ---------- mục tiêu tiết kiệm ----------

def create_goal(conn, uid, data: dict, today: date) -> dict:
    with transaction(conn):
        gid = new_id()
        c, u = _ts()
        conn.execute(f"""INSERT INTO goals(id,user_id,name,target_amount,target_date,monthly_plan,is_emergency,note,{TS})
                         VALUES (?,?,?,?,?,?,?,?,?,?)""",
                     (gid, uid, data["name"], data["target_amount"], data.get("target_date"), data.get("monthly_plan"),
                      1 if data.get("is_emergency") else 0, data.get("note"), c, u))
        if data.get("initial_amount"):
            _alloc(conn, uid, gid, int(data["initial_amount"]), today.isoformat(), "Số đã có ban đầu")
        audit(conn, uid, "goal", gid, "create", data)
    return gid


def update_goal(conn, uid, gid, patch: dict) -> None:
    with transaction(conn):
        owned(conn, "goals", uid, gid, "mục tiêu")
        sets, params = [], []
        for f in ("name", "target_amount", "target_date", "monthly_plan", "note"):
            if patch.get(f) is not None:
                sets.append(f"{f}=?"); params.append(patch[f])
        for f in ("is_emergency", "archived"):
            if patch.get(f) is not None:
                sets.append(f"{f}=?"); params.append(1 if patch[f] else 0)
        if sets:
            conn.execute(f"UPDATE goals SET {', '.join(sets)}, updated_at=?, version=version+1 WHERE id=?", (*params, now_iso(), gid))
        audit(conn, uid, "goal", gid, "update", patch)


def delete_goal(conn, uid, gid) -> None:
    """Xóa mục tiêu = giải phóng tiền đã dành về tiền khả dụng (không phải thu nhập)."""
    with transaction(conn):
        owned(conn, "goals", uid, gid, "mục tiêu")
        n = now_iso()
        conn.execute("UPDATE goal_allocations SET deleted_at=? WHERE goal_id=? AND deleted_at IS NULL", (n, gid))
        conn.execute("UPDATE goals SET deleted_at=?, updated_at=? WHERE id=?", (n, n, gid))
        audit(conn, uid, "goal", gid, "delete")


def _alloc(conn, uid, gid, amount: int, d: str, note: str | None) -> str:
    aid = new_id()
    c, u = _ts()
    conn.execute(f"INSERT INTO goal_allocations(id,user_id,goal_id,date,amount,note,{TS}) VALUES (?,?,?,?,?,?,?,?)",
                 (aid, uid, gid, d, amount, note, c, u))
    return aid


def allocate(conn, uid, gid, data: dict, today: date) -> dict:
    amount = int(data["amount"])
    if amount == 0:
        raise AppError(422, "zero_amount", "Số tiền phải khác 0.", {"amount": "Khác 0"})
    with transaction(conn):
        owned(conn, "goals", uid, gid, "mục tiêu")
        saved = conn.execute("SELECT COALESCE(SUM(amount),0) FROM goal_allocations WHERE goal_id=? AND deleted_at IS NULL",
                             (gid,)).fetchone()[0]
        if amount < 0 and saved + amount < 0:
            raise AppError(422, "insufficient", "Không thể rút nhiều hơn số đã dành cho mục tiêu.", {"amount": "Vượt số đã dành"})
        if amount > 0:
            pos = fe.cash_position(conn, uid, today)
            if amount > pos["available"]:
                raise AppError(409, "not_enough_available",
                               f"Tiền khả dụng chỉ còn {max(0, pos['available']):,}đ, không đủ để dành thêm.".replace(",", "."),
                               {"amount": "Vượt tiền khả dụng"})
        aid = _alloc(conn, uid, gid, amount, data.get("date") or today.isoformat(), data.get("note"))
        audit(conn, uid, "goal_allocation", aid, "create", data)
    return {"id": aid}


def delete_allocation(conn, uid, aid) -> None:
    with transaction(conn):
        a = owned(conn, "goal_allocations", uid, aid, "lần phân bổ")
        if a["amount"] > 0:
            saved = conn.execute("SELECT COALESCE(SUM(amount),0) FROM goal_allocations WHERE goal_id=? AND deleted_at IS NULL",
                                 (a["goal_id"],)).fetchone()[0]
            if saved - a["amount"] < 0:
                raise AppError(409, "would_go_negative", "Xóa lần dành tiền này sẽ làm mục tiêu âm. Hãy xóa lần rút tiền trước.")
        conn.execute("UPDATE goal_allocations SET deleted_at=? WHERE id=?", (now_iso(), aid))
        audit(conn, uid, "goal_allocation", aid, "delete", a)


def goals_overview(conn, uid, today: date) -> dict:
    cap = fe.monthly_capacity(conn, uid, today)
    goals = fe.goal_balances(conn, uid)
    need_total = 0
    for g in goals:
        g["plan"] = fe.goal_plan(g, today, cap)
        g["allocations"] = rows(conn.execute("SELECT * FROM goal_allocations WHERE goal_id=? AND deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT 50", (g["id"],)))
        if not g["archived"] and g["plan"]["remaining"] > 0:
            need_total += g["plan"]["required_monthly"] or (g["monthly_plan"] or 0)
    overall = fe.feasibility(need_total, cap) if (need_total and cap is not None) else None
    return {"goals": goals, "monthly_capacity": cap, "monthly_need_total": need_total, "overall_feasibility": overall}


# ---------- khoản phải trả ----------

def save_obligation(conn, uid, data: dict, oid: str | None = None) -> dict:
    with transaction(conn):
        if data.get("category_id"):
            _category(conn, uid, data["category_id"], "expense")
        c, u = _ts()
        if oid:
            owned(conn, "obligations", uid, oid, "khoản phải trả")
            sets, params = [], []
            for f in ("name", "amount", "due_date", "recurrence", "category_id", "note"):
                if data.get(f) is not None:
                    sets.append(f"{f}=?"); params.append(data[f])
            if sets:
                conn.execute(f"UPDATE obligations SET {', '.join(sets)}, updated_at=?, version=version+1 WHERE id=?", (*params, u, oid))
        else:
            oid = new_id()
            conn.execute(f"""INSERT INTO obligations(id,user_id,name,amount,due_date,recurrence,category_id,note,{TS})
                             VALUES (?,?,?,?,?,?,?,?,?,?)""",
                         (oid, uid, data["name"], data["amount"], data["due_date"], data.get("recurrence") or "none",
                          data.get("category_id"), data.get("note"), c, u))
        audit(conn, uid, "obligation", oid, "save", data)
    return owned(conn, "obligations", uid, oid)


def delete_obligation(conn, uid, oid) -> None:
    with transaction(conn):
        owned(conn, "obligations", uid, oid, "khoản phải trả")
        conn.execute("UPDATE obligations SET deleted_at=? WHERE id=?", (now_iso(), oid))
        audit(conn, uid, "obligation", oid, "delete")


def pay_obligation(conn, uid, oid, data: dict, today: date) -> dict:
    with transaction(conn):
        o = owned(conn, "obligations", uid, oid, "khoản phải trả")
        if o["paid_transaction_id"]:
            raise AppError(409, "already_paid", "Khoản này đã được trả.")
        acc = _account(conn, uid, data["account_id"])
        amount = int(data.get("amount") or o["amount"])
        d = data.get("date") or today.isoformat()
        tid = _insert_tx(conn, uid, "expense", d, [(acc["id"], -amount)],
                         category_id=o["category_id"] or system_category(conn, uid, "expense"),
                         description=o["name"], obligation_id=oid)
        conn.execute("UPDATE obligations SET paid_transaction_id=?, updated_at=? WHERE id=?", (tid, now_iso(), oid))
        next_id = None
        if o["recurrence"] == "monthly":
            next_due = fe.add_months(date.fromisoformat(o["due_date"]), 1).isoformat()
            next_id = new_id()
            c, u = _ts()
            conn.execute(f"""INSERT INTO obligations(id,user_id,name,amount,due_date,recurrence,category_id,note,{TS})
                             VALUES (?,?,?,?,?,?,?,?,?,?)""",
                         (next_id, uid, o["name"], o["amount"], next_due, "monthly", o["category_id"], o["note"], c, u))
        audit(conn, uid, "obligation", oid, "pay", {"tx": tid, "next": next_id})
    return {"transaction_id": tid, "next_id": next_id}


def list_obligations(conn, uid, include_paid: bool = False) -> list[dict]:
    q = """SELECT o.*, c.name AS category_name, c.icon AS category_icon FROM obligations o
           LEFT JOIN categories c ON c.id=o.category_id WHERE o.user_id=? AND o.deleted_at IS NULL"""
    if not include_paid:
        q += " AND o.paid_transaction_id IS NULL"
    return rows(conn.execute(q + " ORDER BY o.paid_transaction_id IS NOT NULL, o.due_date", (uid,)))

"""Báo cáo, xuất CSV/Excel, xuất toàn bộ dữ liệu, sao lưu & khôi phục."""
from __future__ import annotations

import csv
import io
import json
import shutil
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from . import finance as fe
from .db import connect, now_iso, rows
from .schemas import AppError

WORK_TYPES = {"video": "Quay phim", "edit": "Dựng phim", "photo": "Chụp ảnh", "other": "Khác"}
KIND_LABEL = {"job_payment": "Tiền show", "job_refund": "Hoàn cọc", "other_income": "Thu khác",
              "expense": "Chi", "transfer": "Chuyển khoản", "adjustment": "Điều chỉnh"}


def monthly_report(conn, uid, months: list[str], today: date) -> list[dict]:
    out = []
    for m in months:
        ms = date.fromisoformat(m + "-01")
        _, me = fe.month_bounds(ms)
        inc = fe.income_between(conn, uid, ms, me)
        exp, cnt = fe.expenses_between(conn, uid, ms, me)
        rev = fe.revenue_between(conn, uid, ms, me, today)
        stats_end = min(me, today) if ms <= today else me
        days_in = (stats_end - ms).days + 1 if ms <= today else 0
        sessions = conn.execute(
            """SELECT COUNT(DISTINCT s.date) FROM job_sessions s JOIN jobs j ON j.id=s.job_id
               WHERE s.user_id=? AND s.deleted_at IS NULL AND j.deleted_at IS NULL AND j.work_status!='cancelled'
               AND s.kind!='deadline' AND s.date BETWEEN ? AND ?""", (uid, ms.isoformat(), me.isoformat())).fetchone()[0]
        alloc = conn.execute("""SELECT COALESCE(SUM(amount),0) FROM goal_allocations WHERE user_id=? AND deleted_at IS NULL
                                AND date BETWEEN ? AND ?""", (uid, ms.isoformat(), me.isoformat())).fetchone()[0]
        receivable_jobs = fe.jobs_with_money(conn, uid, today, "AND j.work_date BETWEEN ? AND ? AND j.work_status!='cancelled'",
                                             (ms.isoformat(), me.isoformat()))
        out.append({
            "month": m,
            "revenue": rev["earned"], "revenue_by_type": rev["by_type"], "jobs_done": rev["jobs_done"],
            "cash_in": inc["total"], "job_cash": inc["job_cash"], "other_income": inc["other"],
            "expense": exp, "expense_count": cnt,
            "net_cashflow": inc["total"] - exp,
            "receivable_from_month": sum(j["outstanding"] for j in receivable_jobs),
            "work_days": sessions,
            "avg_per_job": round(rev["earned"] / rev["jobs_done"]) if rev["jobs_done"] else 0,
            "avg_daily_expense": round(exp / days_in) if days_in else 0,
            "saved": alloc,
            "savings_rate": round(alloc / inc["total"], 4) if inc["total"] > 0 else None,
        })
    return out


def months_back(today: date, n: int) -> list[str]:
    start, _ = fe.month_bounds(today)
    return [fe.add_months(start, -i).strftime("%Y-%m") for i in range(n - 1, -1, -1)]


def receivables_report(conn, uid, today: date) -> dict:
    jobs = [j for j in fe.jobs_with_money(conn, uid, today, "AND j.work_status!='cancelled'") if j["outstanding"] > 0]
    by_client: dict[str, dict] = {}
    for j in jobs:
        key = j["client_id"] or "_none"
        c = by_client.setdefault(key, {"client_id": j["client_id"], "client_name": j["client_name"] or "(Chưa có tên khách)",
                                       "total": 0, "jobs": [], "max_overdue": 0})
        c["total"] += j["outstanding"]
        c["max_overdue"] = max(c["max_overdue"], j["overdue_days"])
        pays = rows(conn.execute(
            """SELECT t.id, t.date, t.kind, l.amount, a.name AS account_name, t.note FROM transactions t
               JOIN transaction_lines l ON l.transaction_id=t.id JOIN accounts a ON a.id=l.account_id
               WHERE t.job_id=? AND t.deleted_at IS NULL AND t.kind IN ('job_payment','job_refund') ORDER BY t.date""",
            (j["id"],)))
        c["jobs"].append({**j, "payments": pays})
    clients = sorted(by_client.values(), key=lambda c: (-c["max_overdue"], -c["total"]))
    return {"total": sum(c["total"] for c in clients), "overdue_total": sum(j["outstanding"] for j in jobs if j["overdue_days"] > 0),
            "clients": clients, "job_count": len(jobs)}


# ---------- xuất ----------

def _safe_cell(v):
    """Chống CSV/Formula injection khi mở bằng Excel."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") and not _looks_number(v):
        return "'" + v
    return v


def _looks_number(v: str) -> bool:
    try:
        float(v.replace(".", "").replace(",", ""))
        return True
    except ValueError:
        return False


def transactions_for_export(conn, uid, start: str | None, end: str | None) -> list[list]:
    q = """SELECT t.date, t.kind, t.description, c.name, a.name, l.amount, j.title, t.note
           FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id JOIN accounts a ON a.id=l.account_id
           LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN jobs j ON j.id=t.job_id
           WHERE t.user_id=? AND t.deleted_at IS NULL"""
    params: list = [uid]
    if start:
        q += " AND t.date>=?"; params.append(start)
    if end:
        q += " AND t.date<=?"; params.append(end)
    q += " ORDER BY t.date, t.created_at"
    out = [["Ngày", "Loại", "Nội dung", "Danh mục", "Tài khoản", "Số tiền (+vào/-ra)", "Show", "Ghi chú"]]
    for r in conn.execute(q, params):
        out.append([r[0], KIND_LABEL.get(r[1], r[1]), r[2] or "", r[3] or "", r[4], r[5], r[6] or "", r[7] or ""])
    return out


def to_csv(table: list[list]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in table:
        w.writerow([_safe_cell(v) for v in r])
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM để Excel đọc đúng tiếng Việt


def to_xlsx(sheets: dict[str, list[list]]) -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, table in sheets.items():
        ws = wb.create_sheet(name[:31])
        for r in table:
            ws.append([_safe_cell(v) for v in r])
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill("solid", fgColor="E7EFE9")
        for col in ws.columns:
            width = max(len(str(c.value or "")) for c in col)
            ws.column_dimensions[col[0].column_letter].width = min(max(10, width + 2), 50)
            for c in col[1:]:
                if isinstance(c.value, int):
                    c.number_format = "#,##0"
        ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def report_table(rep: list[dict]) -> list[list]:
    head = ["Tháng", "Doanh thu (đã làm)", "Tiền về", "Chi tiêu", "Dòng tiền ròng", "Công nợ từ tháng",
            "Số ngày làm", "Show hoàn thành", "TB mỗi show", "Chi TB/ngày", "Đã để dành", "Tỷ lệ tiết kiệm"]
    out = [head]
    for r in rep:
        out.append([r["month"], r["revenue"], r["cash_in"], r["expense"], r["net_cashflow"], r["receivable_from_month"],
                    r["work_days"], r["jobs_done"], r["avg_per_job"], r["avg_daily_expense"], r["saved"],
                    f"{r['savings_rate'] * 100:.1f}%" if r["savings_rate"] is not None else ""])
    return out


EXPORT_TABLES = ["accounts", "clients", "categories", "jobs", "job_sessions", "day_offs", "transactions",
                 "transaction_lines", "goals", "goal_allocations", "obligations", "import_batches"]


def export_all(conn, uid) -> dict:
    data = {"format": "finance-app-export", "version": 1, "exported_at": now_iso()}
    u = conn.execute("SELECT id, username, display_name, settings_json, created_at FROM users WHERE id=?", (uid,)).fetchone()
    data["user"] = dict(u)
    for t in EXPORT_TABLES:
        if t == "transaction_lines":
            data[t] = rows(conn.execute("SELECT l.* FROM transaction_lines l JOIN transactions t ON t.id=l.transaction_id WHERE t.user_id=?", (uid,)))
        else:
            data[t] = rows(conn.execute(f"SELECT * FROM {t} WHERE user_id=?", (uid,)))
    return data


# ---------- sao lưu ----------

def make_backup(conn: sqlite3.Connection, backup_dir: Path, keep: int, label: str = "manual") -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = backup_dir / f"finance-{stamp}-{label}.db"
    i = 1
    while path.exists():
        path = backup_dir / f"finance-{stamp}-{label}-{i}.db"
        i += 1
    dst = sqlite3.connect(str(path))
    try:
        conn.backup(dst)  # backup trực tuyến, an toàn khi app đang chạy
    finally:
        dst.close()
    prune_backups(backup_dir, keep)
    return path


def prune_backups(backup_dir: Path, keep: int) -> None:
    files = sorted(backup_dir.glob("finance-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for f in files[keep:]:
        try:
            f.unlink()
        except OSError:
            pass


def list_backups(backup_dir: Path) -> list[dict]:
    if not backup_dir.exists():
        return []
    out = []
    for f in sorted(backup_dir.glob("finance-*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = f.stat()
        out.append({"name": f.name, "size": st.st_size,
                    "created_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).replace(microsecond=0).isoformat()})
    return out


def validate_backup_file(path: Path) -> None:
    try:
        c = connect(path)
        try:
            ok = c.execute("PRAGMA integrity_check").fetchone()[0]
            if ok != "ok":
                raise AppError(422, "corrupt", "File sao lưu bị hỏng.")
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            need = {"schema_migrations", "users", "transactions", "transaction_lines", "jobs"}
            if not need <= tables:
                raise AppError(422, "not_backup", "Đây không phải file sao lưu của ứng dụng.")
        finally:
            c.close()
    except sqlite3.DatabaseError:
        raise AppError(422, "not_sqlite", "File không phải cơ sở dữ liệu hợp lệ.")


def restore_from(conn: sqlite3.Connection, src_path: Path) -> None:
    """Ghi đè DB đang chạy bằng nội dung file sao lưu (dùng backup API, không cần tắt app)."""
    validate_backup_file(src_path)
    src = sqlite3.connect(str(src_path))
    try:
        src.backup(conn)
    finally:
        src.close()


def latest_backup_age_hours(backup_dir: Path) -> float | None:
    files = list(backup_dir.glob("finance-*-auto*.db")) if backup_dir.exists() else []
    if not files:
        return None
    newest = max(f.stat().st_mtime for f in files)
    return (datetime.now(timezone.utc).timestamp() - newest) / 3600

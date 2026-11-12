"""finance_engine: NƠI DUY NHẤT chứa công thức tiền.

Nguyên tắc:
- Số dư = tổng các dòng giao dịch (transaction_lines) chưa xóa. Không lưu số dư.
- Doanh thu đến từ bảng jobs; tiền về (dòng tiền) đến từ transactions. Không cộng hai nguồn.
- Công nợ = tổng công − đã nhận (tính lại mỗi lần). Show hủy → công nợ 0.
- Chuyển khoản (transfer) và điều chỉnh (adjustment) không phải thu/chi.
- Tiết kiệm là "phong bì ảo": khóa tiền, không làm giảm số dư, không phải chi tiêu.
- Công nợ chưa thu KHÔNG BAO GIỜ nằm trong tiền khả dụng.
"""
from __future__ import annotations

import calendar
import math
import sqlite3
from datetime import date, timedelta

INCOME_KINDS = ("job_payment", "job_refund", "other_income")
MIN_HISTORY_DAYS = 14
MIN_EXPENSE_COUNT = 10


def _d(s: str) -> date:
    return date.fromisoformat(s)


def month_bounds(d: date) -> tuple[date, date]:
    last = calendar.monthrange(d.year, d.month)[1]
    return d.replace(day=1), d.replace(day=last)


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


# ---------------- số dư ----------------

def account_balances(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rs = conn.execute(
        """
        SELECT a.id, a.name, a.kind, a.archived, a.sort,
               COALESCE((SELECT SUM(l.amount) FROM transaction_lines l
                         JOIN transactions t ON t.id = l.transaction_id
                         WHERE l.account_id = a.id AND t.deleted_at IS NULL), 0) AS balance
        FROM accounts a
        WHERE a.user_id = ? AND a.deleted_at IS NULL
        ORDER BY a.archived, a.sort, a.created_at
        """, (user_id,)).fetchall()
    return [dict(r) for r in rs]


def total_balance(conn: sqlite3.Connection, user_id: str) -> int:
    r = conn.execute(
        """SELECT COALESCE(SUM(l.amount),0) FROM transaction_lines l
           JOIN transactions t ON t.id = l.transaction_id
           JOIN accounts a ON a.id = l.account_id
           WHERE t.user_id = ? AND t.deleted_at IS NULL AND a.deleted_at IS NULL""", (user_id,)).fetchone()
    return int(r[0])


# ---------------- show & công nợ ----------------

def job_received(conn: sqlite3.Connection, job_id: str) -> int:
    r = conn.execute(
        """SELECT COALESCE(SUM(l.amount),0) FROM transaction_lines l
           JOIN transactions t ON t.id = l.transaction_id
           WHERE t.job_id = ? AND t.deleted_at IS NULL AND t.kind IN ('job_payment','job_refund')""",
        (job_id,)).fetchone()
    return int(r[0])


def enrich_job(job: dict, received: int, today: date) -> dict:
    fee = int(job["total_fee"])
    cancelled = job["work_status"] == "cancelled"
    outstanding = 0 if cancelled else max(0, fee - received)
    if received <= 0:
        pay_status = "unpaid"
    elif received < fee and not cancelled:
        pay_status = "partial"
    else:
        pay_status = "paid"
    overdue_days = 0
    if outstanding > 0 and job.get("due_date"):
        overdue_days = max(0, (today - _d(job["due_date"])).days)
    if cancelled:
        revenue = max(0, received)          # giữ cọc → doanh thu = số đã giữ; hoàn cọc → 0
    elif job["work_status"] == "done":
        revenue = fee
    else:
        revenue = 0                         # chưa làm xong: chỉ là doanh thu dự kiến
    expected = 0 if cancelled else fee
    return {**job, "received": received, "outstanding": outstanding, "pay_status": pay_status,
            "overdue_days": overdue_days, "revenue": revenue, "expected_revenue": expected,
            "overpaid": max(0, received - fee) if not cancelled else 0}


def jobs_with_money(conn: sqlite3.Connection, user_id: str, today: date, where: str = "",
                    params: tuple = ()) -> list[dict]:
    rs = conn.execute(
        f"""
        SELECT j.*, c.name AS client_name,
          COALESCE((SELECT SUM(l.amount) FROM transaction_lines l JOIN transactions t ON t.id=l.transaction_id
                    WHERE t.job_id=j.id AND t.deleted_at IS NULL AND t.kind IN ('job_payment','job_refund')),0) AS _received
        FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        WHERE j.user_id = ? AND j.deleted_at IS NULL {where}
        ORDER BY j.work_date DESC, j.created_at DESC
        """, (user_id, *params)).fetchall()
    out = []
    for r in rs:
        d = dict(r)
        rec = int(d.pop("_received"))
        out.append(enrich_job(d, rec, today))
    return out


def receivables_total(conn: sqlite3.Connection, user_id: str, today: date) -> int:
    return sum(j["outstanding"] for j in jobs_with_money(conn, user_id, today, "AND j.work_status != 'cancelled'"))


# ---------------- tiết kiệm ----------------

def goal_balances(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rs = conn.execute(
        """SELECT g.*, COALESCE((SELECT SUM(a.amount) FROM goal_allocations a
                  WHERE a.goal_id=g.id AND a.deleted_at IS NULL),0) AS saved
           FROM goals g WHERE g.user_id=? AND g.deleted_at IS NULL
           ORDER BY g.archived, g.is_emergency DESC, g.created_at""", (user_id,)).fetchall()
    return [dict(r) for r in rs]


def goal_plan(goal: dict, today: date, monthly_capacity: int | None) -> dict:
    target = int(goal["target_amount"])
    saved = int(goal["saved"])
    remaining = max(0, target - saved)
    out = {"remaining": remaining, "progress": min(1.0, saved / target) if target else 0.0,
           "months_at_plan": None, "eta_at_plan": None, "required_monthly": None,
           "months_left": None, "feasibility": None}
    plan = goal.get("monthly_plan") or 0
    if remaining == 0:
        out["months_at_plan"] = 0
    elif plan > 0:
        m = math.ceil(remaining / plan)
        out["months_at_plan"] = m
        out["eta_at_plan"] = add_months(today, m).isoformat()
    if goal.get("target_date") and remaining > 0:
        td = _d(goal["target_date"])
        months_left = max(1, (td.year - today.year) * 12 + (td.month - today.month))
        out["months_left"] = months_left
        out["required_monthly"] = math.ceil(remaining / months_left)
    need = out["required_monthly"] if out["required_monthly"] is not None else (plan if remaining else 0)
    if need and monthly_capacity is not None:
        out["feasibility"] = feasibility(need, monthly_capacity)
    return out


def feasibility(need_per_month: int, capacity_per_month: int) -> str:
    if capacity_per_month <= 0:
        return "not_feasible"
    ratio = need_per_month / capacity_per_month
    if ratio > 1:
        return "not_feasible"
    if ratio >= 0.7:
        return "tight"
    return "ok"


def reserved_total(conn: sqlite3.Connection, user_id: str) -> tuple[int, int]:
    """(tổng đã dành cho mục tiêu thường, quỹ dự phòng). Mỗi đồng chỉ được trừ MỘT lần."""
    regular = emergency = 0
    for g in goal_balances(conn, user_id):
        if g["archived"]:
            continue
        saved = max(0, int(g["saved"]))
        if g["is_emergency"]:
            emergency += saved
        else:
            regular += saved
    return regular, emergency


# ---------------- khoản phải trả ----------------

def obligations_due(conn: sqlite3.Connection, user_id: str, until: date) -> list[dict]:
    rs = conn.execute(
        """SELECT * FROM obligations WHERE user_id=? AND deleted_at IS NULL AND paid_transaction_id IS NULL
           AND due_date <= ? ORDER BY due_date""", (user_id, until.isoformat())).fetchall()
    return [dict(r) for r in rs]


# ---------------- thu / chi ----------------

def expenses_between(conn: sqlite3.Connection, user_id: str, start: date, end: date,
                     exclude_one_off: bool = False) -> tuple[int, int]:
    """(tổng chi dương, số khoản chi) trong [start, end]."""
    extra = "AND t.is_one_off = 0" if exclude_one_off else ""
    r = conn.execute(
        f"""SELECT COALESCE(-SUM(l.amount),0), COUNT(DISTINCT t.id) FROM transaction_lines l
            JOIN transactions t ON t.id=l.transaction_id
            WHERE t.user_id=? AND t.deleted_at IS NULL AND t.kind='expense'
            AND t.date BETWEEN ? AND ? {extra}""",
        (user_id, start.isoformat(), end.isoformat())).fetchone()
    return int(r[0]), int(r[1])


def income_between(conn: sqlite3.Connection, user_id: str, start: date, end: date) -> dict:
    """Tiền thực về (dòng tiền), tách theo loại."""
    rs = conn.execute(
        """SELECT t.kind, COALESCE(SUM(l.amount),0) FROM transaction_lines l
           JOIN transactions t ON t.id=l.transaction_id
           WHERE t.user_id=? AND t.deleted_at IS NULL AND t.kind IN ('job_payment','job_refund','other_income')
           AND t.date BETWEEN ? AND ? GROUP BY t.kind""",
        (user_id, start.isoformat(), end.isoformat())).fetchall()
    by = {k: 0 for k in INCOME_KINDS}
    for k, v in rs:
        by[k] = int(v)
    jobs_net = by["job_payment"] + by["job_refund"]
    return {"job_cash": jobs_net, "other": by["other_income"], "total": jobs_net + by["other_income"]}


def revenue_between(conn: sqlite3.Connection, user_id: str, start: date, end: date, today: date) -> dict:
    """Doanh thu (tiền công đã kiếm) theo ngày thực hiện show."""
    jobs = jobs_with_money(conn, user_id, today, "AND j.work_date BETWEEN ? AND ?",
                           (start.isoformat(), end.isoformat()))
    earned = sum(j["revenue"] for j in jobs)
    expected = sum(j["expected_revenue"] for j in jobs if j["work_status"] in ("booked", "in_progress"))
    by_type: dict[str, int] = {}
    for j in jobs:
        if j["revenue"]:
            by_type[j["work_type"]] = by_type.get(j["work_type"], 0) + j["revenue"]
    done = [j for j in jobs if j["work_status"] == "done"]
    return {"earned": earned, "expected": expected, "by_type": by_type, "jobs_done": len(done),
            "jobs_count": len([j for j in jobs if j["work_status"] != "cancelled"])}


def first_activity_date(conn: sqlite3.Connection, user_id: str) -> date | None:
    r = conn.execute("""SELECT MIN(date) FROM transactions WHERE user_id=? AND deleted_at IS NULL
                        AND kind != 'adjustment'""", (user_id,)).fetchone()
    return _d(r[0]) if r and r[0] else None


# ---------------- tiền khả dụng & dự báo ----------------

def cash_position(conn: sqlite3.Connection, user_id: str, today: date, horizon: str = "month_end") -> dict:
    balance = total_balance(conn, user_id)
    regular, emergency = reserved_total(conn, user_id)
    _, mend = month_bounds(today)
    until = mend if horizon == "month_end" else today + timedelta(days=29)
    obligations = obligations_due(conn, user_id, until)
    obligations_sum = sum(int(o["amount"]) for o in obligations)
    available = balance - regular - emergency - obligations_sum
    return {
        "balance": balance,
        "reserved_goals": regular,
        "emergency_fund": emergency,
        "obligations_due": obligations_sum,
        "obligations_until": until.isoformat(),
        "obligations": obligations,
        "receivables": receivables_total(conn, user_id, today),  # chỉ để hiển thị, KHÔNG cộng
        "available": available,
        "over_committed": available < 0,
        "reserved_exceeds_balance": (regular + emergency) > balance,
    }


def spending_stats(conn: sqlite3.Connection, user_id: str, today: date, exclude_one_off: bool = False) -> dict:
    first = first_activity_date(conn, user_id)
    history_days = (today - first).days + 1 if first else 0

    def avg_window(n: int) -> tuple[int, int, int]:
        spent, count = expenses_between(conn, user_id, today - timedelta(days=n - 1), today, exclude_one_off)
        days = min(n, history_days) if history_days else 0
        return spent, count, (round(spent / days) if days else 0)

    s30, c30, a30 = avg_window(30)
    s90, c90, a90 = avg_window(90)
    # Trung bình 3 tháng lịch đã trọn (không tính tháng hiện tại)
    months = []
    cur_start, _ = month_bounds(today)
    for i in range(1, 4):
        ms = add_months(cur_start, -i)
        _, me = month_bounds(ms)
        if first and me >= first:
            months.append(expenses_between(conn, user_id, ms, me, exclude_one_off)[0])
    avg3m = round(sum(months) / len(months)) if months else None
    insufficient = history_days < MIN_HISTORY_DAYS or c90 < MIN_EXPENSE_COUNT
    return {"history_days": history_days, "spent_30": s30, "count_30": c30, "avg_daily_30": a30,
            "spent_90": s90, "avg_daily_90": a90, "avg_monthly_3m": avg3m, "months_in_3m_avg": len(months),
            "avg_monthly_from_30": a30 * 30, "insufficient_data": insufficient}


def forecast(conn: sqlite3.Connection, user_id: str, today: date, exclude_one_off: bool = False) -> dict:
    pos = cash_position(conn, user_id, today)
    st = spending_stats(conn, user_id, today, exclude_one_off)
    avg = st["avg_daily_30"] or st["avg_daily_90"]
    available = pos["available"]
    if available <= 0:
        runway = 0
    elif avg > 0:
        runway = available // avg
    else:
        runway = None  # chưa có chi tiêu → không chia
    out_of_money = (today + timedelta(days=runway)).isoformat() if runway is not None else None

    mstart, mend = month_bounds(today)
    days_left_month = (mend - today).days + 1                  # kể cả hôm nay
    safe_daily = max(0, available) // days_left_month
    week_end = today + timedelta(days=6 - today.weekday())     # Chủ nhật
    days_left_week = (week_end - today).days + 1               # kể cả hôm nay
    week_start = today - timedelta(days=today.weekday())
    spent_week, _ = expenses_between(conn, user_id, week_start, today)
    spent_today, _ = expenses_between(conn, user_id, today, today)
    weekly_allowance = safe_daily * days_left_week

    remaining_after_today = (mend - today).days
    receivable_this_month = sum(
        j["outstanding"] for j in jobs_with_money(conn, user_id, today,
                                                  "AND j.work_status != 'cancelled' AND j.due_date IS NOT NULL AND j.due_date <= ?",
                                                  (mend.isoformat(),)))
    projected_eom = pos["balance"] - avg * remaining_after_today - pos["obligations_due"]
    return {
        **pos, **st,
        "avg_daily_used": avg,
        "runway_days": runway,
        "out_of_money_date": out_of_money,
        "days_left_month": days_left_month,
        "safe_daily": safe_daily,
        "weekly_allowance": weekly_allowance,
        "days_left_week": days_left_week,
        "spent_this_week": spent_week,
        "spent_today": spent_today,
        "projected_eom_balance": projected_eom,
        "projected_eom_optimistic": projected_eom + receivable_this_month,
        "receivable_due_this_month": receivable_this_month,
        "month_start": mstart.isoformat(), "month_end": mend.isoformat(),
    }


def monthly_capacity(conn: sqlite3.Connection, user_id: str, today: date) -> int | None:
    """Khả năng để dành mỗi tháng = TB tiền về 3 tháng − TB chi 3 tháng (tháng đã trọn).
    Nếu chưa có tháng trọn nào thì dùng 90 ngày gần nhất quy đổi."""
    first = first_activity_date(conn, user_id)
    if not first:
        return None
    cur_start, _ = month_bounds(today)
    incs, exps = [], []
    for i in range(1, 4):
        ms = add_months(cur_start, -i)
        _, me = month_bounds(ms)
        if me >= first:
            incs.append(income_between(conn, user_id, ms, me)["total"])
            exps.append(expenses_between(conn, user_id, ms, me)[0])
    if incs:
        return round((sum(incs) - sum(exps)) / len(incs))
    days = (today - first).days + 1
    inc = income_between(conn, user_id, first, today)["total"]
    exp = expenses_between(conn, user_id, first, today)[0]
    return round((inc - exp) / days * 30)


def month_series(conn: sqlite3.Connection, user_id: str, today: date, months: int = 6) -> list[dict]:
    cur_start, _ = month_bounds(today)
    out = []
    for i in range(months - 1, -1, -1):
        ms = add_months(cur_start, -i)
        _, me = month_bounds(ms)
        inc = income_between(conn, user_id, ms, me)
        exp, cnt = expenses_between(conn, user_id, ms, me)
        rev = revenue_between(conn, user_id, ms, me, today)
        out.append({"month": ms.strftime("%Y-%m"), "income": inc["total"], "job_cash": inc["job_cash"],
                    "expense": exp, "expense_count": cnt, "revenue": rev["earned"],
                    "revenue_by_type": rev["by_type"], "net": inc["total"] - exp})
    return out


def expense_by_category(conn: sqlite3.Connection, user_id: str, start: date, end: date) -> list[dict]:
    rs = conn.execute(
        """SELECT COALESCE(c.id,'') AS category_id, COALESCE(c.name,'Chưa phân loại') AS name, c.color, c.icon,
                  -SUM(l.amount) AS total
           FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id
           LEFT JOIN categories c ON c.id=t.category_id
           WHERE t.user_id=? AND t.deleted_at IS NULL AND t.kind='expense' AND t.date BETWEEN ? AND ?
           GROUP BY c.id ORDER BY total DESC""", (user_id, start.isoformat(), end.isoformat())).fetchall()
    return [dict(r) for r in rs]

"""Ứng dụng web: API + phục vụ giao diện. Chạy: python -m app (xem run.bat)."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import tempfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from pydantic import BaseModel, ValidationError
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import finance as fe
from . import importer, reports, schemas as S, services as sv
from .config import Settings, load_settings
from .db import connect, migrate, rows, set_tz_offset, today_local, transaction
from .logging_setup import setup_logging
from .schemas import AppError
from .security import (RateLimiter, create_session, csrf_ok, dummy_verify, hash_secret, load_session,
                       login_blocked, password_problems, record_login, touch_session, verify_secret)

log = logging.getLogger("finance")
COOKIE = "fm_session"
UNAUTH_HEADER = "X-Requested-With"
UNAUTH_VALUE = "finance-app"


@dataclass
class Ctx:
    request: Request
    conn: Any
    settings: Settings
    sess: dict | None = None
    uid: str | None = None
    today: date = field(default_factory=today_local)
    cookies: list = field(default_factory=list)

    @property
    def q(self) -> dict:
        return dict(self.request.query_params)

    def p(self, name: str) -> str:
        return self.request.path_params[name]


def client_ip(request: Request, settings: Settings) -> str:
    direct = request.client.host if request.client else "unknown"
    xff = request.headers.get("x-forwarded-for")
    if xff and direct in settings.trusted_proxies:
        return xff.split(",")[0].strip()[:64]
    return direct


def is_https(request: Request, settings: Settings) -> bool:
    if settings.cookie_secure in ("true", "1"):
        return True
    if settings.cookie_secure in ("false", "0"):
        return False
    if request.url.scheme == "https":
        return True
    direct = request.client.host if request.client else ""
    return direct in settings.trusted_proxies and request.headers.get("x-forwarded-proto", "") == "https"


def origin_ok(request: Request, settings: Settings) -> bool:
    origin = request.headers.get("origin")
    if not origin or origin == "null":
        return origin is None
    host = urlparse(origin).netloc.lower()
    allowed = {request.headers.get("host", "").lower(), request.headers.get("x-forwarded-host", "").lower()}
    allowed |= {h.lower() for h in settings.allowed_hosts}
    return host in allowed


def err(status: int, code: str, message: str, fields: dict | None = None, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "fields": fields or {}}}, status_code=status,
                        headers=headers)


def make_app(settings: Settings | None = None) -> Starlette:
    settings = settings or load_settings()
    set_tz_offset(settings.tz_offset_hours)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    setup_logging(settings.data_dir / "logs")
    limiter = RateLimiter(settings.rate_limit_per_minute)
    auth_limiter = RateLimiter(20)

    def db():
        return connect(settings.db_path)

    def api(handler: Callable, *, auth: bool = True, csrf: bool = True, allow_locked: bool = False,
            model: type[BaseModel] | None = None, multipart: bool = False, strict_limit: bool = False):
        async def endpoint(request: Request) -> Response:
            ip = client_ip(request, settings)
            if not limiter.allow(ip) or (strict_limit and not auth_limiter.allow(ip)):
                return err(429, "rate_limited", "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.", headers={"Retry-After": "60"})
            if request.method not in ("GET", "HEAD") and not origin_ok(request, settings):
                log.warning("Chặn request khác nguồn: Origin=%s Host=%s", request.headers.get("origin"), request.headers.get("host"))
                return err(403, "bad_origin", "Yêu cầu bị chặn vì địa chỉ truy cập chưa được cho phép. Nếu bạn đang dùng Tailscale, thêm tên .ts.net vào FINANCE_ALLOWED_HOSTS trong file .env.")
            conn = db()
            try:
                ctx = Ctx(request=request, conn=conn, settings=settings)
                if auth:
                    sess = load_session(conn, request.cookies.get(COOKIE), settings.session_idle_days)
                    if not sess:
                        return err(401, "unauthenticated", "Vui lòng đăng nhập.")
                    lock_minutes = int(sv.get_settings(conn, sess["user_id"]).get("lock_minutes") or 0)
                    sess = touch_session(conn, sess, lock_minutes)
                    ctx.sess, ctx.uid = sess, sess["user_id"]
                    if sess["locked"] and not allow_locked:
                        return err(423, "locked", "Ứng dụng đang khóa.")
                    if csrf and request.method not in ("GET", "HEAD") and not csrf_ok(sess, request.headers.get("x-csrf-token")):
                        return err(403, "csrf", "Phiên làm việc không hợp lệ, hãy tải lại trang.")
                elif request.method not in ("GET", "HEAD") and request.headers.get(UNAUTH_HEADER) != UNAUTH_VALUE:
                    return err(403, "csrf", "Yêu cầu không hợp lệ.")
                body: Any = None
                if model is not None:
                    try:
                        raw = await request.body()
                        if len(raw) > 1_000_000:
                            return err(413, "too_large", "Dữ liệu gửi lên quá lớn.")
                        payload = json.loads(raw or b"{}")
                    except json.JSONDecodeError:
                        return err(400, "bad_json", "Dữ liệu gửi lên không hợp lệ.")
                    try:
                        body = model.model_validate(payload).model_dump(exclude_unset=True)
                    except ValidationError as e:
                        fields = {}
                        for x in e.errors():
                            loc = ".".join(str(p) for p in x["loc"]) or "_"
                            fields[loc] = x["msg"].replace("Value error, ", "")
                        first = next(iter(fields.values()), "Dữ liệu không hợp lệ")
                        return err(422, "validation", first, fields)
                elif multipart:
                    form = await request.form(max_files=1, max_fields=10, max_part_size=200 * 1024 * 1024)
                    f = form.get("file")
                    body = {k: v for k, v in form.items() if isinstance(v, str)}
                    if f is not None and not isinstance(f, str):
                        data = await f.read(importer.MAX_BYTES * 20 + 1)
                        body["file"] = {"filename": f.filename or "", "data": data}
                    await form.close()
                result = await run_in_threadpool(handler, ctx, body)
                resp = result if isinstance(result, Response) else JSONResponse(result)
                for c in ctx.cookies:
                    if c[0] == "set":
                        resp.set_cookie(COOKIE, c[1], max_age=settings.session_days * 86400, httponly=True,
                                        secure=is_https(request, settings), samesite="strict", path="/")
                    else:
                        resp.delete_cookie(COOKIE, path="/")
                return resp
            except AppError as e:
                return err(e.status, e.code, e.message, e.fields)
            except Exception:
                log.exception("Lỗi không mong muốn tại %s %s", request.method, request.url.path)
                return err(500, "server_error", "Có lỗi xảy ra phía máy chủ. Chi tiết đã được ghi vào log.")
            finally:
                conn.close()
        return endpoint

    # ======================= AUTH =======================

    def auth_state(ctx: Ctx, _):
        need = sv.user_count(ctx.conn) == 0
        sess = load_session(ctx.conn, ctx.request.cookies.get(COOKIE), settings.session_idle_days)
        out = {"setup_needed": need, "authenticated": False}
        if sess:
            lock_minutes = int(sv.get_settings(ctx.conn, sess["user_id"]).get("lock_minutes") or 0)
            sess = touch_session(ctx.conn, sess, lock_minutes)
            u = ctx.conn.execute("SELECT id, username, display_name, pin_hash IS NOT NULL AS has_pin FROM users WHERE id=?",
                                 (sess["user_id"],)).fetchone()
            out.update({"authenticated": True, "locked": bool(sess["locked"]), "csrf": sess["csrf_token"],
                        "user": {"id": u["id"], "username": u["username"], "display_name": u["display_name"],
                                 "has_pin": bool(u["has_pin"])},
                        "settings": sv.get_settings(ctx.conn, sess["user_id"])})
        return out

    def auth_setup(ctx: Ctx, b):
        direct = ctx.request.client.host if ctx.request.client else ""
        if direct not in ("127.0.0.1", "::1", "testclient") or ctx.request.headers.get("x-forwarded-for"):
            raise AppError(403, "setup_local_only", "Lần thiết lập đầu tiên phải thực hiện ngay trên máy tính chạy ứng dụng.")
        u = sv.setup_user(ctx.conn, b["username"], b["password"], b.get("display_name"))
        with transaction(ctx.conn):
            token, _ = create_session(ctx.conn, u["id"], client_ip(ctx.request, settings),
                                      ctx.request.headers.get("user-agent"), settings.session_days)
        ctx.cookies.append(("set", token))
        log.info("Đã thiết lập tài khoản đầu tiên")
        return {"ok": True}

    def auth_login(ctx: Ctx, b):
        ip = client_ip(ctx.request, settings)
        username = b["username"].strip()
        wait = login_blocked(ctx.conn, username, ip, settings.login_max_failures, settings.login_window_minutes)
        if wait:
            raise AppError(429, "too_many_attempts", f"Sai quá nhiều lần. Thử lại sau {max(1, wait // 60)} phút.")
        u = ctx.conn.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
        if u is None:
            dummy_verify(b["password"])
            ok = False
        else:
            ok = verify_secret(b["password"], u["password_hash"])
        with transaction(ctx.conn):
            record_login(ctx.conn, username, ip, ok)
            if not ok:
                log.warning("Đăng nhập thất bại từ %s", ip)
                raise_later = True
            else:
                raise_later = False
                token, _ = create_session(ctx.conn, u["id"], ip, ctx.request.headers.get("user-agent"), settings.session_days)
        if raise_later:
            raise AppError(401, "bad_credentials", "Sai tên đăng nhập hoặc mật khẩu.")
        ctx.cookies.append(("set", token))
        log.info("Đăng nhập thành công từ %s", ip)
        return {"ok": True}

    def auth_logout(ctx: Ctx, _):
        ctx.conn.execute("DELETE FROM sessions WHERE id=?", (ctx.sess["id"],))
        ctx.cookies.append(("delete",))
        return {"ok": True}

    def auth_lock(ctx: Ctx, _):
        ctx.conn.execute("UPDATE sessions SET locked=1 WHERE id=?", (ctx.sess["id"],))
        return {"locked": True}

    def auth_unlock(ctx: Ctx, b):
        u = ctx.conn.execute("SELECT * FROM users WHERE id=?", (ctx.uid,)).fetchone()
        ok = False
        if b.get("pin") and u["pin_hash"]:
            ok = verify_secret(b["pin"], u["pin_hash"])
        elif b.get("password"):
            ok = verify_secret(b["password"], u["password_hash"])
        if ok:
            ctx.conn.execute("UPDATE sessions SET locked=0, pin_failures=0, last_seen_at=? WHERE id=?",
                             (sv.now_iso(), ctx.sess["id"]))
            return {"locked": False}
        fails = ctx.sess["pin_failures"] + 1
        if fails >= 5:
            ctx.conn.execute("DELETE FROM sessions WHERE id=?", (ctx.sess["id"],))
            ctx.cookies.append(("delete",))
            raise AppError(401, "unauthenticated", "Sai quá 5 lần. Vui lòng đăng nhập lại bằng mật khẩu.")
        ctx.conn.execute("UPDATE sessions SET pin_failures=? WHERE id=?", (fails, ctx.sess["id"]))
        raise AppError(401, "bad_pin", f"Sai mã. Còn {5 - fails} lần thử.")

    def auth_pin(ctx: Ctx, b):
        u = ctx.conn.execute("SELECT * FROM users WHERE id=?", (ctx.uid,)).fetchone()
        if not verify_secret(b["password"], u["password_hash"]):
            raise AppError(401, "bad_password", "Mật khẩu hiện tại không đúng.", {"password": "Không đúng"})
        ph = hash_secret(b["pin"]) if b.get("pin") else None
        ctx.conn.execute("UPDATE users SET pin_hash=?, updated_at=? WHERE id=?", (ph, sv.now_iso(), ctx.uid))
        return {"has_pin": ph is not None}

    def auth_password(ctx: Ctx, b):
        u = ctx.conn.execute("SELECT * FROM users WHERE id=?", (ctx.uid,)).fetchone()
        if not verify_secret(b["current_password"], u["password_hash"]):
            raise AppError(401, "bad_password", "Mật khẩu hiện tại không đúng.", {"current_password": "Không đúng"})
        prob = password_problems(b["new_password"])
        if prob:
            raise AppError(422, "weak_password", prob, {"new_password": prob})
        with transaction(ctx.conn):
            ctx.conn.execute("UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
                             (hash_secret(b["new_password"]), sv.now_iso(), ctx.uid))
            ctx.conn.execute("DELETE FROM sessions WHERE user_id=? AND id!=?", (ctx.uid, ctx.sess["id"]))
        log.info("Đã đổi mật khẩu; đăng xuất các phiên khác")
        return {"ok": True}

    def sessions_list(ctx: Ctx, _):
        rs = rows(ctx.conn.execute("SELECT id, created_at, last_seen_at, ip, user_agent, locked FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC", (ctx.uid,)))
        for r in rs:
            r["current"] = r["id"] == ctx.sess["id"]
        return rs

    def session_revoke(ctx: Ctx, _):
        ctx.conn.execute("DELETE FROM sessions WHERE id=? AND user_id=?", (ctx.p("id"), ctx.uid))
        return {"ok": True}

    def sessions_revoke_others(ctx: Ctx, _):
        n = ctx.conn.execute("DELETE FROM sessions WHERE user_id=? AND id!=?", (ctx.uid, ctx.sess["id"])).rowcount
        return {"revoked": n}

    def settings_get(ctx: Ctx, _):
        return sv.get_settings(ctx.conn, ctx.uid)

    def settings_put(ctx: Ctx, b):
        return sv.update_settings(ctx.conn, ctx.uid, b)

    # ======================= DASHBOARD & DỰ BÁO =======================

    def dashboard(ctx: Ctx, _):
        st = sv.get_settings(ctx.conn, ctx.uid)
        today = ctx.today
        fc = fe.forecast(ctx.conn, ctx.uid, today, bool(st.get("exclude_one_off")))
        ms, me = fe.month_bounds(today)
        inc = fe.income_between(ctx.conn, ctx.uid, ms, me)
        exp, cnt = fe.expenses_between(ctx.conn, ctx.uid, ms, me)
        rev = fe.revenue_between(ctx.conn, ctx.uid, ms, me, today)
        series = fe.month_series(ctx.conn, ctx.uid, today, 6)
        by_type: dict[str, int] = {}
        for m in series:
            for k, v in m["revenue_by_type"].items():
                by_type[k] = by_type.get(k, 0) + v
        upcoming = rows(ctx.conn.execute(
            """SELECT s.*, j.title, j.work_type, c.name AS client_name FROM job_sessions s JOIN jobs j ON j.id=s.job_id
               LEFT JOIN clients c ON c.id=j.client_id WHERE s.user_id=? AND s.deleted_at IS NULL AND j.deleted_at IS NULL
               AND j.work_status!='cancelled' AND s.date BETWEEN ? AND ? ORDER BY s.date, COALESCE(s.start_time,'99') LIMIT 8""",
            (ctx.uid, today.isoformat(), (today + timedelta(days=14)).isoformat())))
        rec = reports.receivables_report(ctx.conn, ctx.uid, today)
        warnings = []
        if fc["insufficient_data"]:
            warnings.append({"level": "info", "text": "Dữ liệu chi tiêu còn ít (dưới 14 ngày hoặc dưới 10 khoản chi) nên dự báo chưa chính xác."})
        if fc["over_committed"]:
            warnings.append({"level": "danger", "text": "Tiền đã dành và các khoản phải trả đang nhiều hơn số tiền bạn có."})
        if rec["overdue_total"] > 0:
            warnings.append({"level": "warn", "text": f"Có {rec['overdue_total']:,}đ công nợ đã quá hạn.".replace(",", ".")})
        return {
            "today": today.isoformat(), "forecast": fc,
            "month": {"income": inc["total"], "job_cash": inc["job_cash"], "other_income": inc["other"], "expense": exp,
                      "expense_count": cnt, "revenue": rev["earned"], "expected_revenue": rev["expected"]},
            "series": series, "expense_by_category": fe.expense_by_category(ctx.conn, ctx.uid, ms, me),
            "revenue_by_type": by_type, "upcoming": upcoming,
            "receivables": {"total": rec["total"], "overdue_total": rec["overdue_total"], "job_count": rec["job_count"],
                            "top": [{"client_name": c["client_name"], "total": c["total"], "max_overdue": c["max_overdue"]}
                                    for c in rec["clients"][:5]]},
            "accounts": fe.account_balances(ctx.conn, ctx.uid), "warnings": warnings,
        }

    def forecast(ctx: Ctx, _):
        st = sv.get_settings(ctx.conn, ctx.uid)
        return fe.forecast(ctx.conn, ctx.uid, ctx.today, bool(st.get("exclude_one_off")))

    # ======================= TÀI KHOẢN / DANH MỤC / KHÁCH =======================

    def accounts_list(ctx, _): return fe.account_balances(ctx.conn, ctx.uid)
    def accounts_create(ctx, b): return sv.create_account(ctx.conn, ctx.uid, b, ctx.today)
    def accounts_patch(ctx, b): return sv.update_account(ctx.conn, ctx.uid, ctx.p("id"), b)
    def accounts_delete(ctx, _): return sv.delete_account(ctx.conn, ctx.uid, ctx.p("id"))
    def categories_list(ctx, _): return sv.list_categories(ctx.conn, ctx.uid)
    def categories_create(ctx, b): return sv.create_category(ctx.conn, ctx.uid, b)
    def categories_patch(ctx, b): return sv.update_category(ctx.conn, ctx.uid, ctx.p("id"), b)
    def categories_delete(ctx, _): return sv.delete_category(ctx.conn, ctx.uid, ctx.p("id"), ctx.q.get("reassign_to"))

    def clients_list(ctx, _):
        return rows(ctx.conn.execute("SELECT * FROM clients WHERE user_id=? AND deleted_at IS NULL ORDER BY name", (ctx.uid,)))
    def clients_create(ctx, b): return sv.save_client(ctx.conn, ctx.uid, b)
    def clients_put(ctx, b): return sv.save_client(ctx.conn, ctx.uid, b, ctx.p("id"))
    def clients_delete(ctx, _): sv.delete_client(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}

    # ======================= SHOW / CÔNG NỢ =======================

    def jobs_list(ctx: Ctx, _):
        where, params = [], []
        q = ctx.q
        if q.get("status"):
            sts = q["status"].split(",")
            where.append(f"AND j.work_status IN ({','.join('?' * len(sts))})"); params += sts
        if q.get("from"):
            where.append("AND j.work_date>=?"); params.append(q["from"])
        if q.get("to"):
            where.append("AND j.work_date<=?"); params.append(q["to"])
        if q.get("type"):
            where.append("AND j.work_type=?"); params.append(q["type"])
        if q.get("q"):
            where.append("AND (j.title LIKE ? OR c.name LIKE ?)"); params += [f"%{q['q']}%"] * 2
        items = fe.jobs_with_money(ctx.conn, ctx.uid, ctx.today, " ".join(where), tuple(params))
        if q.get("pay") == "unpaid":
            items = [j for j in items if j["outstanding"] > 0]
        return {"items": items, "totals": {"fee": sum(j["expected_revenue"] for j in items),
                                           "received": sum(j["received"] for j in items),
                                           "outstanding": sum(j["outstanding"] for j in items)}}

    def jobs_create(ctx, b): return sv.create_job(ctx.conn, ctx.uid, b, ctx.today)
    def jobs_get(ctx, _): return sv.get_job(ctx.conn, ctx.uid, ctx.p("id"), ctx.today)
    def jobs_patch(ctx, b): return sv.update_job(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)
    def jobs_delete(ctx, _): sv.delete_job(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}
    def jobs_pay(ctx, b): return sv.add_payment(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)
    def jobs_cancel(ctx, b): return sv.cancel_job(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)
    def receivables(ctx, _): return reports.receivables_report(ctx.conn, ctx.uid, ctx.today)

    # ======================= GIAO DỊCH =======================

    def tx_list(ctx, _): return sv.list_tx(ctx.conn, ctx.uid, ctx.q)
    def tx_create(ctx, b): return sv.create_tx(ctx.conn, ctx.uid, b, ctx.today)
    def tx_patch(ctx, b): return sv.update_tx(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)
    def tx_delete(ctx, _): sv.delete_tx(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}

    def tx_summary(ctx: Ctx, _):
        q = ctx.q
        group = q.get("group", "day")
        if group not in ("day", "week", "month"):
            raise AppError(422, "bad_group", "group phải là day/week/month")
        end = q.get("to") or ctx.today.isoformat()
        start = q.get("from") or (ctx.today - timedelta(days=29)).isoformat()
        _check_dates(start, end)
        return sv.expense_summary(ctx.conn, ctx.uid, start, end, group)

    # ======================= LỊCH =======================

    def _range(ctx):
        q = ctx.q
        start = q.get("from") or fe.month_bounds(ctx.today)[0].isoformat()
        end = q.get("to") or fe.month_bounds(ctx.today)[1].isoformat()
        _check_dates(start, end)
        return start, end

    def calendar(ctx, _):
        s, e = _range(ctx)
        return sv.calendar_range(ctx.conn, ctx.uid, s, e, ctx.today)

    def calendar_stats(ctx, _):
        s, e = _range(ctx)
        return sv.work_stats(ctx.conn, ctx.uid, s, e, ctx.today)

    def dayoff_create(ctx, b): return sv.save_day_off(ctx.conn, ctx.uid, b)
    def dayoff_delete(ctx, _): sv.delete_day_off(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}

    # ======================= TIẾT KIỆM / KHOẢN PHẢI TRẢ =======================

    def goals_list(ctx, _): return sv.goals_overview(ctx.conn, ctx.uid, ctx.today)
    def goals_create(ctx, b): return {"id": sv.create_goal(ctx.conn, ctx.uid, b, ctx.today)}
    def goals_patch(ctx, b): sv.update_goal(ctx.conn, ctx.uid, ctx.p("id"), b); return {"ok": True}
    def goals_delete(ctx, _): sv.delete_goal(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}
    def goals_alloc(ctx, b): return sv.allocate(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)
    def alloc_delete(ctx, _): sv.delete_allocation(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}

    def obl_list(ctx, _): return sv.list_obligations(ctx.conn, ctx.uid, ctx.q.get("all") == "1")
    def obl_create(ctx, b): return sv.save_obligation(ctx.conn, ctx.uid, b)
    def obl_patch(ctx, b): return sv.save_obligation(ctx.conn, ctx.uid, b, ctx.p("id"))
    def obl_delete(ctx, _): sv.delete_obligation(ctx.conn, ctx.uid, ctx.p("id")); return {"ok": True}
    def obl_pay(ctx, b): return sv.pay_obligation(ctx.conn, ctx.uid, ctx.p("id"), b, ctx.today)

    # ======================= IMPORT =======================

    def import_upload(ctx: Ctx, b):
        f = (b or {}).get("file")
        if not f:
            raise AppError(422, "no_file", "Chưa chọn file.")
        table = importer.parse_file(f["filename"], f["data"])
        if not table:
            raise AppError(422, "empty", "File không có dữ liệu.")
        token = importer.store_pending(ctx.uid, f["filename"], table)
        width = max(len(r) for r in table[:50])
        return {"token": token, "header": table[0], "preview": table[1:21], "total_rows": len(table) - 1,
                "columns": width, "guess": importer.guess_mapping(table[0])}

    def import_analyze(ctx, b): return importer.analyze(ctx.conn, ctx.uid, b)
    def import_commit(ctx, b): return importer.commit(ctx.conn, ctx.uid, b)
    def import_undo(ctx, _): return importer.undo(ctx.conn, ctx.uid, ctx.p("id"))

    def import_batches(ctx, _):
        return rows(ctx.conn.execute("SELECT * FROM import_batches WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (ctx.uid,)))

    # ======================= BÁO CÁO / XUẤT =======================

    def _months(ctx) -> list[str]:
        q = ctx.q
        if q.get("from") and q.get("to"):
            if not re.fullmatch(r"\d{4}-\d{2}", q["from"]) or not re.fullmatch(r"\d{4}-\d{2}", q["to"]):
                raise AppError(422, "bad_month", "Tháng phải có dạng YYYY-MM")
            a, b = date.fromisoformat(q["from"] + "-01"), date.fromisoformat(q["to"] + "-01")
            out = []
            while a <= b and len(out) < 60:
                out.append(a.strftime("%Y-%m")); a = fe.add_months(a, 1)
            return out
        n = max(1, min(int(q.get("months") or 6), 36))
        return reports.months_back(ctx.today, n)

    def report_monthly(ctx, _):
        months = _months(ctx)
        rep = reports.monthly_report(ctx.conn, ctx.uid, months, ctx.today)
        tot = {k: sum(r[k] for r in rep) for k in ("revenue", "cash_in", "expense", "net_cashflow", "work_days", "jobs_done", "saved")}
        tot["savings_rate"] = round(tot["saved"] / tot["cash_in"], 4) if tot["cash_in"] > 0 else None
        tot["avg_per_job"] = round(tot["revenue"] / tot["jobs_done"]) if tot["jobs_done"] else 0
        return {"months": rep, "totals": tot, "receivables": reports.receivables_report(ctx.conn, ctx.uid, ctx.today)["total"]}

    def export_tx_csv(ctx: Ctx, _):
        q = ctx.q
        data = reports.to_csv(reports.transactions_for_export(ctx.conn, ctx.uid, q.get("from"), q.get("to")))
        return Response(data, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="giao-dich-{ctx.today}.csv"'})

    def export_report_xlsx(ctx: Ctx, _):
        months = _months(ctx)
        rep = reports.monthly_report(ctx.conn, ctx.uid, months, ctx.today)
        rec = reports.receivables_report(ctx.conn, ctx.uid, ctx.today)
        debts = [["Khách hàng", "Show", "Ngày làm", "Tổng công", "Đã nhận", "Còn nợ", "Hạn", "Quá hạn (ngày)"]]
        for c in rec["clients"]:
            for j in c["jobs"]:
                debts.append([c["client_name"], j["title"], j["work_date"], j["total_fee"], j["received"], j["outstanding"],
                              j["due_date"] or "", j["overdue_days"]])
        data = reports.to_xlsx({"Báo cáo tháng": reports.report_table(rep), "Công nợ": debts,
                                "Giao dịch": reports.transactions_for_export(ctx.conn, ctx.uid, months[0] + "-01", None)})
        return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="bao-cao-{ctx.today}.xlsx"'})

    def export_all(ctx: Ctx, _):
        data = json.dumps(reports.export_all(ctx.conn, ctx.uid), ensure_ascii=False, indent=1).encode("utf-8")
        return Response(data, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="toan-bo-du-lieu-{ctx.today}.json"'})

    # ======================= SAO LƯU =======================

    def _reauth(ctx: Ctx, password: str | None):
        u = ctx.conn.execute("SELECT password_hash FROM users WHERE id=?", (ctx.uid,)).fetchone()
        if not password or not verify_secret(password, u["password_hash"]):
            raise AppError(401, "bad_password", "Mật khẩu không đúng.", {"password": "Không đúng"})

    def backups_list(ctx, _): return reports.list_backups(settings.backup_dir)

    def backups_create(ctx, _):
        p = reports.make_backup(ctx.conn, settings.backup_dir, settings.backup_keep, "manual")
        return {"name": p.name}

    def _backup_path(name: str) -> Path:
        if not re.fullmatch(r"finance-[\w\-]+\.db", name):
            raise AppError(400, "bad_name", "Tên file không hợp lệ.")
        p = settings.backup_dir / name
        if not p.exists():
            raise AppError(404, "not_found", "Không tìm thấy bản sao lưu.")
        return p

    def backups_download(ctx: Ctx, _):
        p = _backup_path(ctx.p("name"))
        return FileResponse(p, filename=p.name, media_type="application/octet-stream")

    def backups_restore(ctx: Ctx, b):
        b = b or {}
        _reauth(ctx, b.get("password"))
        if b.get("file"):
            with tempfile.NamedTemporaryFile(delete=False, suffix=".db", dir=settings.data_dir) as tf:
                tf.write(b["file"]["data"])
                src = Path(tf.name)
            cleanup = True
        else:
            src = _backup_path(b.get("name", ""))
            cleanup = False
        try:
            reports.validate_backup_file(src)
            safety = reports.make_backup(ctx.conn, settings.backup_dir, settings.backup_keep + 5, "before-restore")
            reports.restore_from(ctx.conn, src)
            migrate(ctx.conn)  # nâng cấp schema nếu backup cũ hơn
            log.warning("Đã khôi phục dữ liệu từ bản sao lưu; bản an toàn: %s", safety.name)
        finally:
            if cleanup:
                with contextlib.suppress(OSError):
                    src.unlink()
        ctx.cookies.append(("delete",))
        return {"ok": True, "safety_backup": safety.name}

    # ======================= ROUTES =======================

    A = api
    routes = [
        Route("/api/auth/state", A(auth_state, auth=False), methods=["GET"]),
        Route("/api/auth/setup", A(auth_setup, auth=False, model=S.SetupIn, strict_limit=True), methods=["POST"]),
        Route("/api/auth/login", A(auth_login, auth=False, model=S.LoginIn, strict_limit=True), methods=["POST"]),
        Route("/api/auth/logout", A(auth_logout, allow_locked=True), methods=["POST"]),
        Route("/api/auth/lock", A(auth_lock, allow_locked=True), methods=["POST"]),
        Route("/api/auth/unlock", A(auth_unlock, allow_locked=True, model=S.UnlockIn, strict_limit=True), methods=["POST"]),
        Route("/api/auth/pin", A(auth_pin, model=S.PinIn, strict_limit=True), methods=["POST"]),
        Route("/api/auth/password", A(auth_password, model=S.PasswordChangeIn, strict_limit=True), methods=["POST"]),
        Route("/api/auth/sessions", A(sessions_list), methods=["GET"]),
        Route("/api/auth/sessions/revoke-others", A(sessions_revoke_others), methods=["POST"]),
        Route("/api/auth/sessions/{id}", A(session_revoke), methods=["DELETE"]),
        Route("/api/settings", A(settings_get), methods=["GET"]),
        Route("/api/settings", A(settings_put, model=S.SettingsIn), methods=["PUT"]),
        Route("/api/dashboard", A(dashboard), methods=["GET"]),
        Route("/api/forecast", A(forecast), methods=["GET"]),
        Route("/api/accounts", A(accounts_list), methods=["GET"]),
        Route("/api/accounts", A(accounts_create, model=S.AccountIn), methods=["POST"]),
        Route("/api/accounts/{id}", A(accounts_patch, model=S.AccountPatch), methods=["PATCH"]),
        Route("/api/accounts/{id}", A(accounts_delete), methods=["DELETE"]),
        Route("/api/categories", A(categories_list), methods=["GET"]),
        Route("/api/categories", A(categories_create, model=S.CategoryIn), methods=["POST"]),
        Route("/api/categories/{id}", A(categories_patch, model=S.CategoryPatch), methods=["PATCH"]),
        Route("/api/categories/{id}", A(categories_delete), methods=["DELETE"]),
        Route("/api/clients", A(clients_list), methods=["GET"]),
        Route("/api/clients", A(clients_create, model=S.ClientIn), methods=["POST"]),
        Route("/api/clients/{id}", A(clients_put, model=S.ClientIn), methods=["PUT"]),
        Route("/api/clients/{id}", A(clients_delete), methods=["DELETE"]),
        Route("/api/jobs", A(jobs_list), methods=["GET"]),
        Route("/api/jobs", A(jobs_create, model=S.JobIn), methods=["POST"]),
        Route("/api/jobs/{id}", A(jobs_get), methods=["GET"]),
        Route("/api/jobs/{id}", A(jobs_patch, model=S.JobPatch), methods=["PATCH"]),
        Route("/api/jobs/{id}", A(jobs_delete), methods=["DELETE"]),
        Route("/api/jobs/{id}/payments", A(jobs_pay, model=S.PaymentIn), methods=["POST"]),
        Route("/api/jobs/{id}/cancel", A(jobs_cancel, model=S.CancelIn), methods=["POST"]),
        Route("/api/receivables", A(receivables), methods=["GET"]),
        Route("/api/transactions", A(tx_list), methods=["GET"]),
        Route("/api/transactions", A(tx_create, model=S.TxIn), methods=["POST"]),
        Route("/api/transactions/summary", A(tx_summary), methods=["GET"]),
        Route("/api/transactions/{id}", A(tx_patch, model=S.TxPatch), methods=["PATCH"]),
        Route("/api/transactions/{id}", A(tx_delete), methods=["DELETE"]),
        Route("/api/calendar", A(calendar), methods=["GET"]),
        Route("/api/calendar/stats", A(calendar_stats), methods=["GET"]),
        Route("/api/day-offs", A(dayoff_create, model=S.DayOffIn), methods=["POST"]),
        Route("/api/day-offs/{id}", A(dayoff_delete), methods=["DELETE"]),
        Route("/api/goals", A(goals_list), methods=["GET"]),
        Route("/api/goals", A(goals_create, model=S.GoalIn), methods=["POST"]),
        Route("/api/goals/{id}", A(goals_patch, model=S.GoalPatch), methods=["PATCH"]),
        Route("/api/goals/{id}", A(goals_delete), methods=["DELETE"]),
        Route("/api/goals/{id}/allocations", A(goals_alloc, model=S.AllocationIn), methods=["POST"]),
        Route("/api/allocations/{id}", A(alloc_delete), methods=["DELETE"]),
        Route("/api/obligations", A(obl_list), methods=["GET"]),
        Route("/api/obligations", A(obl_create, model=S.ObligationIn), methods=["POST"]),
        Route("/api/obligations/{id}", A(obl_patch, model=S.ObligationPatch), methods=["PATCH"]),
        Route("/api/obligations/{id}", A(obl_delete), methods=["DELETE"]),
        Route("/api/obligations/{id}/pay", A(obl_pay, model=S.PayObligationIn), methods=["POST"]),
        Route("/api/import/upload", A(import_upload, multipart=True), methods=["POST"]),
        Route("/api/import/analyze", A(import_analyze, model=S.ImportMapIn), methods=["POST"]),
        Route("/api/import/commit", A(import_commit, model=S.ImportMapIn), methods=["POST"]),
        Route("/api/import/batches", A(import_batches), methods=["GET"]),
        Route("/api/import/batches/{id}/undo", A(import_undo), methods=["POST"]),
        Route("/api/reports/monthly", A(report_monthly), methods=["GET"]),
        Route("/api/export/transactions.csv", A(export_tx_csv), methods=["GET"]),
        Route("/api/export/report.xlsx", A(export_report_xlsx), methods=["GET"]),
        Route("/api/export/all.json", A(export_all), methods=["GET"]),
        Route("/api/backups", A(backups_list), methods=["GET"]),
        Route("/api/backups", A(backups_create), methods=["POST"]),
        Route("/api/backups/restore", A(backups_restore, multipart=True, strict_limit=True), methods=["POST"]),
        Route("/api/backups/{name}", A(backups_download), methods=["GET"]),
        Route("/api/{rest:path}", lambda r: err(404, "not_found", "API không tồn tại."), methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
        Mount("/", app=StaticFiles(directory=str(settings.frontend_dir), html=True), name="static"),
    ]

    async def backup_loop():
        while True:
            try:
                age = reports.latest_backup_age_hours(settings.backup_dir)
                if age is None or age >= 24:
                    def _do():
                        c = db()
                        try:
                            if sv.user_count(c) > 0:
                                reports.make_backup(c, settings.backup_dir, settings.backup_keep, "auto")
                                log.info("Đã tạo bản sao lưu tự động")
                        finally:
                            c.close()
                    await run_in_threadpool(_do)
            except Exception:
                log.exception("Sao lưu tự động thất bại")
            await asyncio.sleep(3600)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        c = db()
        try:
            applied = migrate(c)
            if applied:
                log.info("Đã chạy migration: %s", applied)
        finally:
            c.close()
        task = None if settings.testing else asyncio.create_task(backup_loop())
        yield
        if task:
            task.cancel()

    app = Starlette(routes=routes, lifespan=lifespan)
    return SecurityHeaders(app, settings)


CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; "
       "manifest-src 'self'; worker-src 'self'")


class SecurityHeaders:
    """ASGI middleware: thêm header bảo mật, kiểm tra Host, chặn cache dữ liệu API."""

    def __init__(self, app, settings: Settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if self.settings.allowed_hosts:
            host = dict(scope["headers"]).get(b"host", b"").decode("latin-1").lower()
            allowed = {h.lower() for h in self.settings.allowed_hosts} | {f"127.0.0.1:{self.settings.port}", f"localhost:{self.settings.port}"}
            if host not in allowed:
                resp = Response("Host không được phép", status_code=400)
                return await resp(scope, receive, send)
        path = scope.get("path", "")

        async def _send(message):
            if message["type"] == "http.response.start":
                h = message.setdefault("headers", [])
                extra = {
                    b"x-content-type-options": b"nosniff", b"x-frame-options": b"DENY",
                    b"referrer-policy": b"no-referrer", b"content-security-policy": CSP.encode(),
                    b"permissions-policy": b"camera=(), microphone=(), geolocation=()",
                    b"cross-origin-opener-policy": b"same-origin",
                }
                if path.startswith("/api/"):
                    extra[b"cache-control"] = b"no-store"
                elif path in ("/", "/index.html", "/sw.js") or path.endswith((".js", ".css", ".webmanifest")):
                    extra[b"cache-control"] = b"no-cache"
                existing = {k.lower() for k, _ in h}
                for k, v in extra.items():
                    if k not in existing:
                        h.append((k, v))
            await send(message)

        return await self.app(scope, receive, _send)


def _check_dates(*ds):
    for d in ds:
        try:
            date.fromisoformat(d)
        except (TypeError, ValueError):
            raise AppError(422, "bad_date", "Ngày không hợp lệ (YYYY-MM-DD).")

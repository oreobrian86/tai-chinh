"""Kiểm thử các tính năng còn lại: danh mục, giao dịch, lịch, tiết kiệm, báo cáo, xuất file, sao lưu."""
import io
from datetime import date, timedelta

import openpyxl

from app import finance as fe
from app.importer import parse_amount, parse_date

from .conftest import PASSWORD


def test_categories_crud_and_reassign(app_):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    new = c.post("/api/categories", {"name": "Thuê phụ quay", "kind": "expense", "icon": "🎬"}, expect=200)
    c.post("/api/categories", {"name": "thuê phụ quay", "kind": "expense"}, expect=409)  # trùng tên
    c.patch(f"/api/categories/{new['id']}", {"name": "Thuê phụ quay/trợ lý"}, expect=200)
    t = c.post("/api/transactions", {"kind": "expense", "amount": 300_000, "account_id": cash, "category_id": new["id"]}, expect=200)
    food = c.cat("Ăn uống")["id"]
    r = c.delete(f"/api/categories/{new['id']}?reassign_to={food}", expect=200)
    assert r["moved"] == 1
    tx = c.get(f"/api/transactions?category_id={food}")["items"]
    assert [x["id"] for x in tx] == [t["id"]]
    c.delete(f"/api/categories/{c.cat('Khác')['id']}", expect=409)  # danh mục hệ thống


def test_transaction_edit_delete_and_filters(app_, today):
    c = app_
    acc = c.accounts()
    t = c.post("/api/transactions", {"kind": "expense", "amount": 50_000, "account_id": acc["Tiền mặt"]["id"],
                                     "category_id": c.cat("Ăn uống")["id"], "description": "Phở"}, expect=200)
    t = c.patch(f"/api/transactions/{t['id']}", {"amount": 65_000, "account_id": acc["Ngân hàng"]["id"]}, expect=200)
    assert t["amount"] == 65_000
    a = c.accounts()
    assert (a["Tiền mặt"]["balance"], a["Ngân hàng"]["balance"]) == (0, -65_000)
    assert c.get("/api/transactions?q=Phở")["total"] == 1
    assert c.get(f"/api/transactions?from={today}&to={today}&kind=expense")["total"] == 1
    c.delete(f"/api/transactions/{t['id']}", expect=200)
    assert c.fc()["balance"] == 0
    assert c.db().execute("SELECT deleted_at IS NOT NULL FROM transactions WHERE id=?", (t["id"],)).fetchone()[0] == 1  # xóa mềm
    assert c.db().execute("SELECT COUNT(*) FROM audit_log WHERE entity='transaction'").fetchone()[0] >= 3


def test_expense_validation(app_):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    r = c.post("/api/transactions", {"kind": "expense", "amount": 0, "account_id": cash}, expect=422)
    assert "amount" in r["error"]["fields"]
    c.post("/api/transactions", {"kind": "expense", "amount": -5, "account_id": cash}, expect=422)
    c.post("/api/transactions", {"kind": "expense", "amount": 10**12, "account_id": cash}, expect=422)
    c.post("/api/transactions", {"kind": "expense", "amount": 1000, "account_id": cash, "date": "2026-02-30"}, expect=422)
    c.post("/api/transactions", {"kind": "expense", "amount": 1000, "account_id": "khong-co"}, expect=404)
    c.post("/api/transactions", {"kind": "job_payment", "amount": 1000, "account_id": cash}, expect=422)  # phải qua show


def test_expense_summary_day_week_month(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    for i, amt in enumerate([10_000, 20_000, 30_000]):
        c.post("/api/transactions", {"kind": "expense", "amount": amt, "account_id": cash,
                                     "date": (today - timedelta(days=i)).isoformat()}, expect=200)
    days = c.get(f"/api/transactions/summary?group=day&from={today - timedelta(days=5)}&to={today}")
    assert sum(d["total"] for d in days) == 60_000 and len(days) == 3
    months = c.get(f"/api/transactions/summary?group=month&from={today - timedelta(days=5)}&to={today}")
    assert sum(m["total"] for m in months) == 60_000


def test_account_with_history_is_archived_not_deleted(app_):
    c = app_
    a = c.post("/api/accounts", {"name": "MoMo", "kind": "ewallet", "opening_balance": 200_000}, expect=200)
    assert c.accounts()["MoMo"]["balance"] == 200_000
    assert c.delete(f"/api/accounts/{a['id']}", expect=200) == {"archived": True}
    assert c.fc()["balance"] == 200_000  # tiền không biến mất
    b = c.post("/api/accounts", {"name": "Trống", "kind": "bank"}, expect=200)
    assert c.delete(f"/api/accounts/{b['id']}", expect=200) == {"deleted": True}


def test_multi_day_job_calendar_and_conflicts(app_, today):
    c = app_
    d0 = today + timedelta(days=3)
    j = c.post("/api/jobs", {
        "title": "Cưới Hoàng & Mai", "client_name": "Studio X", "work_type": "video", "work_date": d0.isoformat(),
        "total_fee": 6_000_000, "due_date": (d0 + timedelta(days=14)).isoformat(),
        "sessions": [
            {"kind": "shoot", "date": d0.isoformat(), "start_time": "06:00", "end_time": "12:00", "location": "Nhà gái"},
            {"kind": "shoot", "date": (d0 + timedelta(days=1)).isoformat(), "start_time": "16:00", "end_time": "22:00"},
            {"kind": "edit", "date": (d0 + timedelta(days=4)).isoformat(), "start_time": "09:00", "end_time": "17:00"},
            {"kind": "deadline", "date": (d0 + timedelta(days=10)).isoformat()},
        ]}, expect=200)
    assert len(j["sessions"]) == 4
    j2 = c.post("/api/jobs", {"title": "Chụp kỷ yếu", "work_type": "photo", "work_date": d0.isoformat(), "total_fee": 2_000_000,
                              "start_time": "10:00", "end_time": "13:00"}, expect=200)
    assert len(j2["conflicts"]) == 1                     # trùng giờ 10:00–12:00
    cal = c.get(f"/api/calendar?from={d0}&to={d0 + timedelta(days=10)}")
    assert len(cal["sessions"]) == 5 and len(cal["conflicts"]) == 1
    st = c.get(f"/api/calendar/stats?from={d0}&to={d0 + timedelta(days=10)}")
    assert st["work_days"] == 3                          # deadline không tính là ngày đi làm
    assert st["hours"] == 6 + 6 + 8 + 3
    assert st["fee_total"] == 8_000_000
    assert st["expected_from_booked"] == 8_000_000       # dự báo thu từ show đã nhận
    # sửa lịch: bỏ buổi dựng → còn 3 buổi
    keep = [s for s in j["sessions"] if s["kind"] != "edit"]
    j = c.patch(f"/api/jobs/{j['id']}", {"sessions": [{k: s[k] for k in ("id", "kind", "date", "start_time", "end_time")} for s in keep]},
                expect=200)
    assert len(j["sessions"]) == 3
    # hủy show kỷ yếu → hết trùng
    c.post(f"/api/jobs/{j2['id']}/cancel", {"policy": "keep"}, expect=200)
    assert c.get(f"/api/calendar?from={d0}&to={d0}")["conflicts"] == []
    # giờ kết thúc trước giờ bắt đầu bị chặn
    c.post("/api/jobs", {"title": "x", "work_type": "photo", "work_date": d0.isoformat(), "total_fee": 1,
                         "start_time": "13:00", "end_time": "10:00"}, expect=422)
    off = c.post("/api/day-offs", {"date": (d0 + timedelta(days=2)).isoformat(), "note": "Nghỉ"}, expect=200)
    assert len(c.get(f"/api/calendar?from={d0}&to={d0 + timedelta(days=5)}")["day_offs"]) == 1
    c.delete(f"/api/day-offs/{off['id']}", expect=200)


def test_receivables_page_overdue(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/jobs", {"title": "Dựng TVC", "client_name": "Chị Lan", "work_type": "edit",
                         "work_date": (today - timedelta(days=20)).isoformat(), "total_fee": 3_000_000,
                         "due_date": (today - timedelta(days=12)).isoformat(), "work_status": "done",
                         "deposit": 1_000_000, "deposit_account_id": cash}, expect=200)
    c.post("/api/jobs", {"title": "Chụp sản phẩm", "client_name": "Chị Lan", "work_type": "photo",
                         "work_date": today.isoformat(), "total_fee": 1_500_000}, expect=200)
    r = c.get("/api/receivables")
    assert r["total"] == 3_500_000 and r["overdue_total"] == 2_000_000
    lan = r["clients"][0]
    assert lan["client_name"] == "Chị Lan" and lan["total"] == 3_500_000 and lan["max_overdue"] == 12
    tvc = next(j for j in lan["jobs"] if j["title"] == "Dựng TVC")
    assert len(tvc["payments"]) == 1


def test_goal_plan_math(app_, today):
    c = app_
    td = fe.add_months(today, 10)
    g = c.post("/api/goals", {"name": "Máy ảnh", "target_amount": 30_000_000, "target_date": td.isoformat(),
                              "monthly_plan": 2_000_000, "initial_amount": 0}, expect=200)
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 10_000_000, "account_id": cash}, expect=200)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 10_000_000}, expect=200)
    goal = c.get("/api/goals")["goals"][0]
    p = goal["plan"]
    assert p["remaining"] == 20_000_000
    assert p["months_at_plan"] == 10                       # 20tr / 2tr
    assert p["months_left"] == 10 and p["required_monthly"] == 2_000_000
    assert round(p["progress"], 3) == 0.333


def test_goal_unit_math():
    t = date(2026, 1, 15)
    p = fe.goal_plan({"target_amount": 400_000_000, "saved": 0, "monthly_plan": 7_000_000, "target_date": "2030-01-15"}, t, 10_000_000)
    assert p["months_at_plan"] == 58 and p["months_left"] == 48 and p["required_monthly"] == 8_333_334
    assert p["feasibility"] == "tight"
    assert fe.feasibility(5, 0) == "not_feasible" and fe.feasibility(11, 10) == "not_feasible" and fe.feasibility(1, 10) == "ok"


def test_delete_goal_releases_money(app_):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 5_000_000, "account_id": cash}, expect=200)
    g = c.post("/api/goals", {"name": "Xe", "target_amount": 400_000_000}, expect=200)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 2_000_000}, expect=200)
    assert c.fc()["available"] == 3_000_000
    c.delete(f"/api/goals/{g['id']}", expect=200)
    f = c.fc()
    assert f["available"] == 5_000_000 and f["balance"] == 5_000_000


def test_monthly_report_and_exports(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    j = c.post("/api/jobs", {"title": "Show", "work_type": "video", "work_date": today.isoformat(), "total_fee": 2_000_000,
                             "work_status": "done", "deposit": 2_000_000, "deposit_account_id": cash}, expect=200)
    c.post("/api/transactions", {"kind": "expense", "amount": 500_000, "account_id": cash,
                                 "description": "=HYPERLINK(\"http://x\")"}, expect=200)
    g = c.post("/api/goals", {"name": "Dự phòng", "target_amount": 15_000_000, "is_emergency": True}, expect=200)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 300_000}, expect=200)
    rep = c.get("/api/reports/monthly?months=3")
    m = rep["months"][-1]
    assert (m["revenue"], m["cash_in"], m["expense"], m["net_cashflow"]) == (2_000_000, 2_000_000, 500_000, 1_500_000)
    assert m["jobs_done"] == 1 and m["avg_per_job"] == 2_000_000 and m["work_days"] == 1
    assert m["saved"] == 300_000 and m["savings_rate"] == 0.15
    assert len(rep["months"]) == 3
    csv_r = c.get("/api/export/transactions.csv", raw=True)
    assert csv_r.status_code == 200
    body = csv_r.content.decode("utf-8-sig")
    assert "'=HYPERLINK" in body               # chống chèn công thức khi mở bằng Excel
    x = c.get("/api/export/report.xlsx?months=3", raw=True)
    wb = openpyxl.load_workbook(io.BytesIO(x.content))
    assert wb.sheetnames == ["Báo cáo tháng", "Công nợ", "Giao dịch"]
    full = c.get("/api/export/all.json")
    assert full["format"] == "finance-app-export" and len(full["transactions"]) == 2 and len(full["jobs"]) == 1
    assert len(full["goal_allocations"]) == 1   # phân bổ tiết kiệm KHÔNG phải giao dịch
    assert "password_hash" not in str(full["user"])


def test_backup_and_restore_roundtrip(app_):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 1_000_000, "account_id": cash}, expect=200)
    name = c.post("/api/backups", expect=200)["name"]
    c.post("/api/transactions", {"kind": "expense", "amount": 999_000, "account_id": cash}, expect=200)
    assert c.fc()["balance"] == 1_000
    dl = c.get(f"/api/backups/{name}", raw=True)
    assert dl.status_code == 200 and dl.content[:15] == b"SQLite format 3"
    # khôi phục bằng file tải lên
    r = c.req("POST", "/api/backups/restore", data={"password": PASSWORD},
              files={"file": ("backup.db", dl.content, "application/octet-stream")}, expect=200)
    assert r["safety_backup"].endswith(".db")
    # sau khôi phục phải đăng nhập lại; số dư trở về 1.000.000
    c2 = type(c)(c.base, c.data_dir)
    c2.post("/api/auth/login", {"username": "phuc", "password": PASSWORD}, expect=200)
    c2.refresh()
    assert c2.fc()["balance"] == 1_000_000
    # file rác bị từ chối
    r = c2.req("POST", "/api/backups/restore", data={"password": PASSWORD},
               files={"file": ("x.db", b"not a database at all" * 100, "application/octet-stream")}, raw=True)
    assert r.status_code == 422
    assert c2.fc()["balance"] == 1_000_000


def test_import_xlsx_with_debit_credit(app_, today):
    c = app_
    bank = c.accounts()["Ngân hàng"]["id"]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Ngày giao dịch", "Diễn giải", "Ghi nợ", "Ghi có"])
    ws.append([today - timedelta(days=1), "Thanh toán Adobe", 560000, None])
    ws.append([today - timedelta(days=1), "Nhận tiền khách", None, 2000000])
    ws.append([today, "=1+1", 1000, None])  # công thức: chỉ đọc giá trị/chuỗi
    buf = io.BytesIO(); wb.save(buf)
    up = c.req("POST", "/api/import/upload", files={"file": ("vcb.xlsx", buf.getvalue(), "application/octet-stream")}, expect=200)
    g = up["guess"]
    assert g["date"] == 0 and g["description"] == 1 and g["debit"] == 2 and g["credit"] == 3
    req = {"token": up["token"], "mapping": g, "account_id": bank, "amount_mode": "debit_credit"}
    an = c.post("/api/import/analyze", req, expect=200)
    assert an["counts"]["ok"] == 3
    c.post("/api/import/commit", req, expect=200)
    assert c.accounts()["Ngân hàng"]["balance"] == 2_000_000 - 560_000 - 1_000
    m = c.get("/api/dashboard")["month"]
    if (today - timedelta(days=1)).month == today.month:
        assert m["other_income"] == 2_000_000


def test_import_rejects_bad_files(app_):
    c = app_
    r = c.req("POST", "/api/import/upload", files={"file": ("a.exe", b"MZ....", "application/octet-stream")}, raw=True)
    assert r.status_code == 415
    r = c.req("POST", "/api/import/upload", files={"file": ("a.xlsx", b"PK garbage", "application/octet-stream")}, raw=True)
    assert r.status_code == 422


def test_parsers():
    assert parse_amount("1.500.000") == 1_500_000
    assert parse_amount("1,500,000đ") == 1_500_000
    assert parse_amount("-45.000") == -45_000
    assert parse_amount("(70,000)") == -70_000
    assert parse_amount("45000.0") == 45_000
    assert parse_amount("") is None
    assert parse_date("05/11/2026", "auto") == "2026-11-05"
    assert parse_date("2026-11-05", "auto") == "2026-11-05"
    assert parse_date("11/05/2026", "mdy") == "2026-11-05"
    assert parse_date("31/02/2026", "auto") is None
    assert parse_date("5/11/26", "auto") == "2026-11-05"


def test_forecast_unit_runway_none_without_spending(app_):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 1_000_000, "account_id": cash}, expect=200)
    f = c.fc()
    assert f["runway_days"] is None and f["out_of_money_date"] is None  # không chia cho 0
    assert f["safe_daily"] == 1_000_000 // f["days_left_month"]


def test_static_and_unknown_api(client):
    assert client.get("/", raw=True).status_code == 200
    assert client.get("/api/khong-co", raw=True).status_code == 404

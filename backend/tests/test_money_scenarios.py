"""10 kịch bản tiền BẮT BUỘC trong yêu cầu (mục F). Mỗi test kiểm tra qua API thật và đối chiếu database."""
from datetime import timedelta


def make_show(c, fee=1_500_000, deposit=500_000, title="Quay sự kiện A", **kw):
    acc = c.accounts()["Tiền mặt"]["id"]
    body = {"title": title, "client_name": "Anh Minh", "work_type": "video", "work_date": kw.pop("work_date", None) or c._today,
            "total_fee": fee, "deposit": deposit, "deposit_account_id": acc, **kw}
    return c.post("/api/jobs", body, expect=200)


def test_1_2_3_payments_reduce_receivable(app_, today):
    c = app_; c._today = today.isoformat()
    cash = c.accounts()["Tiền mặt"]["id"]
    # 1. Tạo show 1.500.000, cọc 500.000 → còn nợ 1.000.000
    j = make_show(c)
    assert (j["total_fee"], j["received"], j["outstanding"], j["pay_status"]) == (1_500_000, 500_000, 1_000_000, "partial")
    assert c.get("/api/receivables")["total"] == 1_000_000
    # 2. Nhận thêm 500.000 → còn 500.000
    j = c.post(f"/api/jobs/{j['id']}/payments", {"amount": 500_000, "account_id": cash}, expect=200)
    assert (j["received"], j["outstanding"]) == (1_000_000, 500_000)
    assert c.get("/api/receivables")["total"] == 500_000
    # 3. Nhận nốt 500.000 → công nợ 0
    j = c.post(f"/api/jobs/{j['id']}/payments", {"amount": 500_000, "account_id": cash}, expect=200)
    assert (j["received"], j["outstanding"], j["pay_status"]) == (1_500_000, 0, "paid")
    assert c.get("/api/receivables")["total"] == 0
    assert len(j["payments"]) == 3  # lịch sử thanh toán từng lần
    # Trả thêm khi đã hết nợ → bị chặn
    r = c.post(f"/api/jobs/{j['id']}/payments", {"amount": 1, "account_id": cash}, expect=409)
    assert r["error"]["code"] == "overpay"


def test_4_no_double_counting(app_, today):
    c = app_; c._today = today.isoformat()
    cash = c.accounts()["Tiền mặt"]["id"]
    j = make_show(c)
    c.post(f"/api/jobs/{j['id']}/payments", {"amount": 500_000, "account_id": cash}, expect=200)
    c.post(f"/api/jobs/{j['id']}/payments", {"amount": 500_000, "account_id": cash}, expect=200)
    c.patch(f"/api/jobs/{j['id']}", {"work_status": "done"}, expect=200)
    d = c.get("/api/dashboard")
    assert d["month"]["income"] == 1_500_000          # tiền về: đúng 1 lần
    assert d["month"]["revenue"] == 1_500_000         # doanh thu: đúng 1 lần
    assert d["forecast"]["balance"] == 1_500_000      # số dư không bị nhân đôi
    rep = c.get("/api/reports/monthly?months=1")["months"][0]
    assert rep["revenue"] == 1_500_000 and rep["cash_in"] == 1_500_000
    # Ở database: chỉ có 3 giao dịch job_payment, tổng 1.500.000
    db = c.db()
    assert db.execute("SELECT COUNT(*), SUM(l.amount) FROM transactions t JOIN transaction_lines l ON l.transaction_id=t.id "
                      "WHERE t.kind='job_payment' AND t.deleted_at IS NULL").fetchone()[:] == (3, 1_500_000)


def test_5_expense_reduces_available_exactly(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 5_000_000, "account_id": cash}, expect=200)
    before = c.fc()["available"]
    c.post("/api/transactions", {"kind": "expense", "amount": 100_000, "account_id": cash,
                                 "category_id": c.cat("Ăn uống")["id"], "description": "Cơm trưa"}, expect=200)
    after = c.fc()
    assert before - after["available"] == 100_000
    assert after["balance"] == 4_900_000


def test_6_transfer_keeps_total_assets(app_, today):
    c = app_
    acc = c.accounts()
    c.post("/api/transactions", {"kind": "adjustment", "amount": 3_000_000, "account_id": acc["Ngân hàng"]["id"]}, expect=200)
    before = c.fc()
    c.post("/api/transactions", {"kind": "transfer", "amount": 2_000_000, "account_id": acc["Ngân hàng"]["id"],
                                 "to_account_id": acc["Tiền mặt"]["id"]}, expect=200)
    after = c.fc()
    acc2 = c.accounts()
    assert after["balance"] == before["balance"] == 3_000_000
    assert (acc2["Ngân hàng"]["balance"], acc2["Tiền mặt"]["balance"]) == (1_000_000, 2_000_000)
    d = c.get("/api/dashboard")["month"]
    assert d["income"] == 0 and d["expense"] == 0   # không phải thu, không phải chi
    # chuyển cùng tài khoản bị chặn
    c.post("/api/transactions", {"kind": "transfer", "amount": 1, "account_id": acc["Tiền mặt"]["id"],
                                 "to_account_id": acc["Tiền mặt"]["id"]}, expect=422)
    # phí chuyển khoản được tách thành 1 khoản chi riêng
    c.post("/api/transactions", {"kind": "transfer", "amount": 500_000, "fee": 3_300, "account_id": acc["Ngân hàng"]["id"],
                                 "to_account_id": acc["Tiền mặt"]["id"]}, expect=200)
    assert c.fc()["balance"] == 3_000_000 - 3_300
    assert c.get("/api/dashboard")["month"]["expense"] == 3_300


def test_7_savings_allocation_is_not_spending(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 10_000_000, "account_id": cash}, expect=200)
    g = c.post("/api/goals", {"name": "Mua máy ảnh mới", "target_amount": 30_000_000}, expect=200)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 3_000_000}, expect=200)
    f = c.fc()
    assert f["balance"] == 10_000_000                  # số dư không đổi
    assert f["reserved_goals"] == 3_000_000
    assert f["available"] == 7_000_000                 # chỉ khả dụng giảm
    assert c.get("/api/dashboard")["month"]["expense"] == 0
    assert c.get("/api/reports/monthly?months=1")["months"][0]["expense"] == 0
    # Không dành quá tiền khả dụng; không rút quá số đã dành
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 7_000_001}, expect=409)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": -3_000_001}, expect=422)
    # Rút 1tr khỏi mục tiêu → khả dụng tăng lại, vẫn không phải thu nhập
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": -1_000_000}, expect=200)
    f = c.fc()
    assert (f["available"], f["reserved_goals"], f["balance"]) == (8_000_000, 2_000_000, 10_000_000)
    assert c.get("/api/dashboard")["month"]["income"] == 0


def test_8_cancel_show_keep_and_refund(app_, today):
    c = app_; c._today = today.isoformat()
    cash = c.accounts()["Tiền mặt"]["id"]
    # (a) Hủy, giữ cọc
    a = make_show(c, title="Show A")
    a = c.post(f"/api/jobs/{a['id']}/cancel", {"policy": "keep"}, expect=200)
    assert (a["work_status"], a["outstanding"], a["revenue"], a["expected_revenue"]) == ("cancelled", 0, 500_000, 0)
    assert c.fc()["balance"] == 500_000
    # (b) Hủy, hoàn cọc
    b = make_show(c, title="Show B")
    assert c.fc()["balance"] == 1_000_000
    b = c.post(f"/api/jobs/{b['id']}/cancel", {"policy": "refund", "account_id": cash}, expect=200)
    assert (b["outstanding"], b["revenue"], b["received"]) == (0, 0, 0)
    assert c.fc()["balance"] == 500_000
    assert c.get("/api/receivables")["total"] == 0
    d = c.get("/api/dashboard")
    assert d["month"]["revenue"] == 500_000            # chỉ phần cọc giữ lại của show A
    assert d["month"]["income"] == 500_000             # 2 lần cọc − 1 lần hoàn
    assert d["month"]["expected_revenue"] == 0
    # Show đã hủy không nhận thêm tiền, không đổi tiền công
    c.post(f"/api/jobs/{a['id']}/payments", {"amount": 1, "account_id": cash}, expect=409)
    c.patch(f"/api/jobs/{a['id']}", {"total_fee": 9}, expect=409)
    # Show có tiền không xóa thẳng được (tránh mất dấu tiền cọc)
    s = make_show(c, title="Show C")
    c.delete(f"/api/jobs/{s['id']}", expect=409)


def test_9_import_never_duplicates(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    d1, d2 = (today - timedelta(days=2)).strftime("%d/%m/%Y"), (today - timedelta(days=1)).strftime("%d/%m/%Y")
    csv_text = ("Ngày,Nội dung,Số tiền,Danh mục\n"
                f"{d1},Cà phê,25.000,\"Cà phê, nước uống\"\n"
                f"{d1},Cà phê,25.000,\"Cà phê, nước uống\"\n"   # 2 ly giống hệt nhau trong cùng file: hợp lệ
                f"{d2},Đổ xăng,\"70,000\",\"Đi lại, xăng xe\"\n"
                f"sai-ngay,Lỗi,10.000,\n")
    up = c.req("POST", "/api/import/upload", files={"file": ("sao-ke.csv", csv_text.encode("utf-8"), "text/csv")}, expect=200)
    assert up["guess"]["date"] == 0 and up["guess"]["amount"] == 2 and up["guess"]["description"] == 1
    req = {"token": up["token"], "mapping": up["guess"], "account_id": cash, "amount_mode": "expense_positive"}
    an = c.post("/api/import/analyze", req, expect=200)
    assert an["counts"] == {"ok": 3, "error": 1, "duplicate": 0, "suspect": 0}
    res = c.post("/api/import/commit", req, expect=200)
    assert res["imported"] == 3
    assert c.fc()["balance"] == -120_000
    # Nhập lại CÙNG file → toàn bộ bị đánh dấu trùng, 0 dòng mới
    up2 = c.req("POST", "/api/import/upload", files={"file": ("sao-ke.csv", csv_text.encode("utf-8"), "text/csv")}, expect=200)
    req2 = {**req, "token": up2["token"]}
    an2 = c.post("/api/import/analyze", req2, expect=200)
    assert an2["counts"]["duplicate"] == 3 and an2["counts"]["ok"] == 0
    res2 = c.post("/api/import/commit", req2, expect=200)
    assert res2["imported"] == 0
    assert c.fc()["balance"] == -120_000
    assert c.db().execute("SELECT COUNT(*) FROM transactions WHERE import_hash IS NOT NULL AND deleted_at IS NULL").fetchone()[0] == 3
    # Hoàn tác lô đầu → số dư về 0
    c.post(f"/api/import/batches/{res['batch_id']}/undo", expect=200)
    assert c.fc()["balance"] == 0


def test_9b_import_flags_manual_duplicates(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "expense", "amount": 45_000, "account_id": cash, "date": today.isoformat()}, expect=200)
    csv_text = f"date,description,amount\n{today.isoformat()},Bún bò,45000\n"
    up = c.req("POST", "/api/import/upload", files={"file": ("a.csv", csv_text.encode(), "text/csv")}, expect=200)
    req = {"token": up["token"], "mapping": up["guess"], "account_id": cash}
    an = c.post("/api/import/analyze", req, expect=200)
    assert an["counts"]["suspect"] == 1
    assert c.post("/api/import/commit", req, expect=200)["imported"] == 0          # mặc định bỏ qua
    up = c.req("POST", "/api/import/upload", files={"file": ("a.csv", csv_text.encode(), "text/csv")}, expect=200)
    req = {"token": up["token"], "mapping": up["guess"], "account_id": cash, "include_duplicates": [0]}
    assert c.post("/api/import/commit", req, expect=200)["imported"] == 1          # người dùng chủ động chọn nhập


def test_10_runway_excludes_receivables_and_emergency(app_, today):
    c = app_; c._today = today.isoformat()
    cash = c.accounts()["Tiền mặt"]["id"]
    start = today - timedelta(days=29)
    c.post("/api/transactions", {"kind": "adjustment", "amount": 30_000_000, "account_id": cash,
                                 "date": (start - timedelta(days=1)).isoformat()}, expect=200)
    # 30 ngày, mỗi ngày chi 100.000 → TB 100.000/ngày
    for i in range(30):
        c.post("/api/transactions", {"kind": "expense", "amount": 100_000, "account_id": cash,
                                     "date": (start + timedelta(days=i)).isoformat()}, expect=200)
    # khách còn nợ 5tr (không được tính), quỹ dự phòng 15tr (phải loại trừ)
    make_show(c, fee=5_000_000, deposit=0, title="Show chưa trả")
    g = c.post("/api/goals", {"name": "Quỹ dự phòng", "target_amount": 15_000_000, "is_emergency": True}, expect=200)
    c.post(f"/api/goals/{g['id']}/allocations", {"amount": 15_000_000}, expect=200)
    f = c.fc()
    assert f["balance"] == 27_000_000
    assert f["receivables"] == 5_000_000
    assert f["emergency_fund"] == 15_000_000
    assert f["available"] == 12_000_000                 # 27tr − 15tr dự phòng, KHÔNG cộng 5tr công nợ
    assert f["avg_daily_30"] == 100_000
    assert f["runway_days"] == 120                      # 12tr / 100k
    assert f["insufficient_data"] is False
    assert f["out_of_money_date"] == (today + timedelta(days=120)).isoformat()


def test_10b_insufficient_history_is_flagged(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 1_000_000, "account_id": cash}, expect=200)
    c.post("/api/transactions", {"kind": "expense", "amount": 50_000, "account_id": cash}, expect=200)
    f = c.fc()
    assert f["insufficient_data"] is True
    d = c.get("/api/dashboard")
    assert any("chưa chính xác" in w["text"] for w in d["warnings"])


def test_obligations_reduce_available_once(app_, today):
    c = app_
    cash = c.accounts()["Tiền mặt"]["id"]
    c.post("/api/transactions", {"kind": "adjustment", "amount": 10_000_000, "account_id": cash}, expect=200)
    o = c.post("/api/obligations", {"name": "Tiền nhà", "amount": 4_000_000, "due_date": today.isoformat(),
                                    "recurrence": "monthly"}, expect=200)
    assert c.fc()["available"] == 6_000_000
    r = c.post(f"/api/obligations/{o['id']}/pay", {"account_id": cash}, expect=200)
    f = c.fc()
    assert f["balance"] == 6_000_000 and f["available"] == 6_000_000  # trả rồi: chỉ trừ 1 lần
    assert r["next_id"]                                                # tự tạo kỳ tháng sau
    nxt = next(x for x in c.get("/api/obligations") if x["id"] == r["next_id"])
    assert nxt["due_date"] > today.isoformat()
    c.post(f"/api/obligations/{o['id']}/pay", {"account_id": cash}, expect=409)  # không trả 2 lần

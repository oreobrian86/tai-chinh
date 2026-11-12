"""Kiểm thử giao diện bằng trình duyệt thật (Playwright). Tự bỏ qua nếu máy chưa cài Playwright/Chrome.
Chạy riêng: python -m pytest tests/test_ui_e2e.py -s   (ảnh chụp lưu vào thư mục SHOTS nếu đặt biến môi trường)."""
import os
import shutil
from datetime import timedelta
from pathlib import Path

import pytest

pw = pytest.importorskip("playwright.sync_api")

from app.db import today_local  # noqa: E402

from .conftest import PASSWORD  # noqa: E402

CHROME = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")
SHOTS = Path(os.environ.get("SHOTS", "")) if os.environ.get("SHOTS") else None


@pytest.fixture
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
        except Exception as e:  # pragma: no cover
            pytest.skip(f"Không mở được trình duyệt: {e}")
        yield b
        b.close()


def shot(page, name, full=True):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)


def watch(page, errors):
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))


def api(page, method, path, body=None):
    csrf = page.evaluate("fetch('/api/auth/state').then(r=>r.json()).then(j=>j.csrf)")
    origin = page.evaluate("location.origin")
    r = page.request.fetch(origin + path, method=method, data=body,
                           headers={"X-CSRF-Token": csrf or "", "X-Requested-With": "finance-app", "Content-Type": "application/json"})
    assert r.ok, f"{method} {path}: {r.status} {r.text()[:300]}"
    return r.json()


def seed(page):
    """Dữ liệu mẫu để các màn hình có nội dung khi chụp ảnh."""
    t = today_local()
    accs = {a["name"]: a["id"] for a in api(page, "GET", "/api/accounts")}
    cash, bank = accs["Tiền mặt"], accs["Ngân hàng"]
    cats = {c["name"]: c["id"] for c in api(page, "GET", "/api/categories")}
    api(page, "POST", "/api/transactions", {"kind": "adjustment", "amount": 3_500_000, "account_id": cash, "date": (t - timedelta(days=120)).isoformat()})
    api(page, "POST", "/api/transactions", {"kind": "adjustment", "amount": 21_000_000, "account_id": bank, "date": (t - timedelta(days=120)).isoformat()})
    import random
    random.seed(7)
    plan = [("Ăn uống", 35_000, 90_000), ("Cà phê, nước uống", 25_000, 55_000), ("Đi lại, xăng xe", 50_000, 80_000)]
    for i in range(100):
        d = t - timedelta(days=i)
        for name, lo, hi in plan:
            if random.random() < 0.55:
                api(page, "POST", "/api/transactions", {"kind": "expense", "amount": random.randrange(lo, hi, 5000), "account_id": cash,
                                                        "category_id": cats[name], "date": d.isoformat(), "description": name})
    api(page, "POST", "/api/transactions", {"kind": "expense", "amount": 1_290_000, "account_id": bank, "category_id": cats["Phần mềm, dịch vụ"],
                                            "date": (t - timedelta(days=9)).isoformat(), "description": "Adobe Premiere năm"})
    api(page, "POST", "/api/transactions", {"kind": "expense", "amount": 4_800_000, "account_id": bank, "category_id": cats["Thiết bị quay, chụp"],
                                            "date": (t - timedelta(days=40)).isoformat(), "description": "Gimbal mới", "is_one_off": True})
    jobs = [("Quay cưới Hoàng & Mai", "Studio Mây", "video", -50, 6_000_000, 6_000_000, "done", -36),
            ("Chụp kỷ yếu THPT Lê Lợi", "Chị Lan", "photo", -32, 3_500_000, 1_500_000, "done", -12),
            ("Dựng TVC quán cà phê", "Anh Minh", "edit", -15, 4_000_000, 1_000_000, "done", 5),
            ("Quay sự kiện ra mắt sản phẩm", "Anh Minh", "video", 4, 2_500_000, 500_000, "booked", 18),
            ("Chụp sản phẩm mỹ phẩm", "Studio Mây", "photo", 9, 1_800_000, 0, "booked", 25)]
    for title, client, wt, off, fee, dep, st, due in jobs:
        d = (t + timedelta(days=off)).isoformat()
        api(page, "POST", "/api/jobs", {"title": title, "client_name": client, "work_type": wt, "work_date": d, "total_fee": fee,
                                        "deposit": dep, "deposit_account_id": bank, "deposit_date": d, "work_status": st,
                                        "due_date": (t + timedelta(days=due)).isoformat(), "start_time": "08:00", "end_time": "12:00"})
    for m in range(1, 4):
        api(page, "POST", "/api/jobs", {"title": f"Show tháng trước {m}", "client_name": "Studio Mây", "work_type": "video",
                                        "work_date": (t - timedelta(days=30 * m + 5)).isoformat(), "total_fee": 3_000_000 + m * 500_000,
                                        "deposit": 3_000_000 + m * 500_000, "deposit_account_id": bank, "work_status": "done"})
    g = api(page, "POST", "/api/goals", {"name": "Quỹ dự phòng", "target_amount": 15_000_000, "is_emergency": True, "monthly_plan": 1_000_000})
    api(page, "POST", f"/api/goals/{g['id']}/allocations", {"amount": 6_000_000})
    g = api(page, "POST", "/api/goals", {"name": "Mua máy ảnh mới", "target_amount": 30_000_000,
                                         "target_date": (t + timedelta(days=330)).isoformat(), "monthly_plan": 2_000_000})
    api(page, "POST", f"/api/goals/{g['id']}/allocations", {"amount": 4_000_000})
    api(page, "POST", "/api/obligations", {"name": "Tiền nhà", "amount": 3_000_000, "due_date": (t + timedelta(days=6)).isoformat(), "recurrence": "monthly"})


@pytest.fixture
def server(tmp_path):
    """Server riêng cho test giao diện: nới giới hạn tốc độ vì bước tạo dữ liệu mẫu gửi hàng trăm request."""
    from .conftest import _server
    yield from _server(tmp_path, rate=100_000)


def test_full_ui_flow(server, browser):
    base = f"http://127.0.0.1:{server.port}"
    errors: list[str] = []
    ctx = browser.new_context(viewport={"width": 1366, "height": 900}, locale="vi-VN")
    page = ctx.new_page()
    watch(page, errors)
    page.goto(base + "/")
    # 1. thiết lập lần đầu
    page.get_by_role("heading", name="Chào mừng").wait_for()
    shot(page, "01-setup")
    page.fill("[name=username]", "phuc")
    page.fill("[name=display_name]", "Phúc")
    page.fill("[name=password]", PASSWORD)
    page.fill("[name=password2]", PASSWORD)
    page.click("button[type=submit]")
    page.get_by_text("Có thể tiêu", exact=True).wait_for()

    # 2. thêm khoản chi bằng nút Thêm nhanh
    page.click(".fab")
    page.fill(".sheet [name=amount]", "45k")
    page.click(".sheet [data-cat] >> text=Ăn uống")
    page.fill(".sheet [name=description]", "Bún bò")
    page.click(".sheet button[type=submit]")
    page.get_by_text("Đã lưu khoản chi 45.000đ").wait_for()
    st = api(page, "GET", "/api/forecast")
    assert st["balance"] == -45_000

    # 3. tạo show có cọc qua trang Thu nhập
    page.goto(base + "/#/income")
    page.get_by_role("button", name="Show mới").first.click()
    page.fill(".sheet [name=title]", "Quay sự kiện A")
    page.fill(".sheet [name=client_name]", "Anh Minh")
    page.fill(".sheet [name=total_fee]", "1tr5")
    page.fill(".sheet [name=deposit]", "500000")
    page.click(".sheet button[type=submit]")
    page.get_by_text("Đã tạo show").wait_for()
    page.get_by_text("Quay sự kiện A").first.wait_for()

    # 4. ghi nhận tiền về từ trang Công nợ
    page.goto(base + "/#/income/receivables")
    page.get_by_text("1.000.000đ").first.wait_for()
    page.click("[data-pay]")
    page.fill(".sheet [name=amount]", "500.000")
    page.click(".sheet button[type=submit]")
    page.get_by_text("Còn nợ 500.000đ").wait_for()
    r = api(page, "GET", "/api/receivables")
    assert r["total"] == 500_000

    # 5. dữ liệu mẫu rồi đi qua từng trang, chụp ảnh
    seed(page)
    for route, marker, name in [("#/", "Tình hình sử dụng tiền", "02-dashboard"), ("#/income", "Show và dự án", "03-income"),
                                ("#/income/receivables", "Công nợ cần thu", "04-receivables"), ("#/expenses", "Chi từng ngày", "05-expenses"),
                                ("#/calendar", "Tổng hợp tháng", "06-calendar"), ("#/savings", "Mua máy ảnh mới", "07-savings"),
                                ("#/reports", "So sánh hai tháng", "08-reports"), ("#/settings", "Sao lưu và dữ liệu", "09-settings"),
                                ("#/expenses/import", "Nhập từ file", "10-import"), ("#/expenses/obligations", "Tiền nhà", "11-obligations")]:
        page.goto(base + "/" + route)
        page.get_by_text(marker).first.wait_for()
        page.wait_for_timeout(700)
        shot(page, name)

    # chi tiết show
    page.goto(base + "/#/income")
    page.click("a.item >> text=Quay sự kiện A")
    page.get_by_text("Lịch sử thanh toán").wait_for()
    shot(page, "12-job-detail")
    # lịch tuần
    page.goto(base + "/#/calendar")
    page.click("[data-mode=week]")
    page.get_by_text("Tuần").first.wait_for()
    shot(page, "13-calendar-week")

    # 6. khóa và mở khóa bằng mật khẩu
    page.click(".side [data-lock]")
    page.get_by_role("heading", name="Đã khóa").wait_for()
    shot(page, "14-locked")
    assert page.request.get(base + "/api/dashboard").status == 423
    page.fill("[name=password]", PASSWORD)
    page.click("button[type=submit]")
    page.get_by_role("heading", name="Lịch làm việc").wait_for()   # mở khóa xong quay lại đúng trang đang xem

    # 7. điện thoại
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            storage_state=ctx.storage_state())
    mp = m.new_page()
    watch(mp, errors)
    mp.goto(base + "/")
    mp.get_by_text("Có thể tiêu", exact=True).wait_for()
    mp.wait_for_timeout(900)
    shot(mp, "20-mobile-dashboard", full=False)
    mp.click(".tab-add")
    mp.get_by_role("heading", name="Thêm nhanh").wait_for()
    mp.wait_for_timeout(400)
    shot(mp, "21-mobile-quickadd", full=False)
    mp.fill(".sheet [name=amount]", "30000")
    mp.click(".sheet [data-cat] >> nth=1")
    mp.click(".sheet button[type=submit]")
    mp.get_by_text("Đã lưu khoản chi 30.000đ").wait_for()
    # điện thoại vào được mọi mục qua nút "Thêm"
    mp.click("[data-more]")
    mp.click(".more-menu >> text=Tiết kiệm")
    mp.get_by_role("heading", name="Tiết kiệm").wait_for()
    for route, marker, name in [("#/calendar", "Tổng hợp tháng", "22-mobile-calendar"), ("#/income/receivables", "Công nợ cần thu", "23-mobile-receivables"),
                                ("#/savings", "Mua máy ảnh mới", "24-mobile-savings")]:
        mp.goto(base + "/" + route)
        mp.get_by_text(marker).first.wait_for()
        mp.wait_for_timeout(500)
        shot(mp, name)
    # bố cục không bị tràn ngang trên điện thoại, ở MỌI trang (khi đã có dữ liệu thật)
    for route in ["#/", "#/income", "#/income/receivables", "#/expenses", "#/expenses/obligations", "#/expenses/import",
                  "#/calendar", "#/savings", "#/reports", "#/settings"]:
        mp.goto(base + "/" + route)
        mp.wait_for_timeout(800)
        overflow = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 1, f"Trang {route} bị tràn ngang {overflow}px trên điện thoại"
    m.close()
    ctx.close()
    assert not errors, "Lỗi trên trình duyệt:\n" + "\n".join(errors)

"""Kiểm thử giao diện bằng Chrome thật (Playwright). Google được giả lập ngay trong trình duyệt
(đăng nhập + Sheets/Drive API từ tests/fake-google.mjs), nên chạy toàn bộ luồng thật mà không cần mạng.
Chạy: python3 tests/ui_e2e.py [thư_mục_ảnh]"""
import functools
import http.server
import re
import shutil
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
CHROME = shutil.which("google-chrome") or shutil.which("chromium")


def serve(directory):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def fake_google_script():
    src = (ROOT / "tests/fake-google.mjs").read_text(encoding="utf-8").replace("export function", "function")
    return src + """
;(() => {
  const g = fakeGoogle({ token: 'tok' });
  window.__fakeGoogle = g;
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://sheets.googleapis.com') || u.startsWith('https://www.googleapis.com')) return g.fetch(u, opts);
    return realFetch(url, opts);
  };
  window.google = { accounts: { oauth2: {
    initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok', expires_in: 3599, scope: cfg.scope }), 30) }),
    hasGrantedAllScopes: () => true, revoke: (t, cb) => cb && cb(),
  } } };
})();
"""


def main():
    tmp = Path(tempfile.mkdtemp())
    site = tmp / "tai-chinh"
    shutil.copytree(ROOT, site, ignore=shutil.ignore_patterns("tests", "node_modules", "*.zip"))
    cfg = site / "config.js"
    cfg.write_text(re.sub(r"CLIENT_ID: '[^']*'", "CLIENT_ID: 'test-123.apps.googleusercontent.com'", cfg.read_text(encoding="utf-8")), encoding="utf-8")
    httpd, base = serve(tmp)
    url = base + "/tai-chinh/"
    errors = []

    def watch(p):
        p.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    def shot(p, name, full=True):
        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
            p.screenshot(path=str(SHOTS / f"{name}.png"), full_page=full)

    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME) if CHROME else pw.chromium.launch()
        ctx = b.new_context(viewport={"width": 1366, "height": 900}, locale="vi-VN")
        ctx.add_init_script(fake_google_script())
        page = ctx.new_page()
        watch(page)
        page.goto(url)
        page.get_by_role("button", name="Đăng nhập bằng Google").click()
        page.get_by_text("Có thể tiêu", exact=True).wait_for()
        page.wait_for_timeout(500)
        kinds = page.evaluate("[...window.__fakeGoogle.files.values()].map(f => Object.keys(f.appProperties || {})[0])")
        assert kinds.count("finance_app_data") == 1, f"phải có đúng 1 file dữ liệu: {kinds}"
        assert kinds.count("finance_app_backup") == 1, f"phải có 1 bản sao lưu tự động: {kinds}"
        print("✓ đăng nhập Google (giả lập), tự tạo file dữ liệu + bản sao lưu tự động đầu tiên")

        # nhập số dư ban đầu qua Cài đặt
        page.goto(url + "#/settings")
        page.click(".item >> text=Ngân hàng")
        page.fill(".sheet [name=actual]", "5tr")
        page.click(".sheet button[type=submit]")
        page.get_by_text("5.000.000đ").first.wait_for()
        print("✓ điều chỉnh số dư tài khoản")

        # thêm chi nhanh
        page.click(".fab")
        page.fill(".sheet [name=amount]", "45k")
        page.click(".sheet [data-cat] >> text=Ăn uống")
        page.click(".sheet button[type=submit]")
        page.get_by_text("Đã lưu khoản chi 45.000đ").wait_for()
        print("✓ thêm khoản chi")

        # show có cọc → ghi nhận tiền về
        page.goto(url + "#/income")
        page.get_by_role("button", name="Show mới").first.click()
        page.fill(".sheet [name=title]", "Quay sự kiện A")
        page.fill(".sheet [name=client_name]", "Anh Minh")
        page.fill(".sheet [name=total_fee]", "1tr5")
        page.fill(".sheet [name=deposit]", "500000")
        page.click(".sheet button[type=submit]")
        page.get_by_text("Đã tạo show").wait_for()
        page.goto(url + "#/income/receivables")
        page.get_by_text("1.000.000đ").first.wait_for()
        page.click("[data-pay]")
        page.fill(".sheet [name=amount]", "500.000")
        page.click(".sheet button[type=submit]")
        page.get_by_text("Còn nợ 500.000đ").wait_for()
        print("✓ tạo show, ghi nhận tiền khách trả")

        # dữ liệu thật sự nằm trên "Google Sheet"
        rows = page.evaluate("""() => { const f=[...window.__fakeGoogle.files.values()][0];
          const g=f.sheets.get('transactions').grid; return g.length - 1; }""")
        assert rows == 4, f"Sheet phải có 4 giao dịch (điều chỉnh, chi, cọc, trả), có {rows}"
        print("✓ dữ liệu được ghi lên Google Sheet:", rows, "giao dịch")

        # đi qua mọi trang
        for route, marker in [("#/", "Tình hình sử dụng tiền"), ("#/expenses", "Chi từng ngày"), ("#/calendar", "Tổng hợp tháng"),
                              ("#/savings", "Tiết kiệm"), ("#/reports", "So sánh hai tháng"), ("#/settings", "Dữ liệu trên Google Drive"),
                              ("#/expenses/import", "Nhập từ file"), ("#/expenses/obligations", "Khoản phải trả")]:
            page.goto(url + route)
            page.get_by_text(marker).first.wait_for()
        print("✓ mở được mọi trang")

        # sao lưu
        page.goto(url + "#/settings")
        page.click("[data-backup]")
        page.get_by_text("Đã sao lưu").wait_for()
        assert page.evaluate("window.__fakeGoogle.files.size") >= 2
        print("✓ sao lưu ra Drive")

        # khóa → dữ liệu bị xóa khỏi bộ nhớ → mở khóa bằng Google
        page.click(".side [data-lock]")
        page.get_by_role("heading", name="Đã khóa").wait_for()
        assert "Quay sự kiện" not in page.content()
        page.get_by_role("button", name="Mở khóa bằng Google").click()
        page.get_by_text("Dữ liệu trên Google Drive").wait_for()
        print("✓ khóa và mở khóa")
        shot(page, "g-settings")

        # chế độ dùng thử (dữ liệu mẫu) — chụp ảnh + kiểm tra điện thoại
        demo = b.new_context(viewport={"width": 1366, "height": 900}, locale="vi-VN")
        dp = demo.new_page()
        watch(dp)
        dp.goto(url + "?demo")
        dp.get_by_text("Có thể tiêu", exact=True).wait_for(timeout=60000)
        dp.wait_for_timeout(800)
        shot(dp, "d-dashboard")
        for route, marker, name in [("#/income/receivables", "Công nợ cần thu", "d-receivables"), ("#/calendar", "Tổng hợp tháng", "d-calendar"),
                                    ("#/savings", "Mua máy ảnh mới", "d-savings"), ("#/reports", "So sánh hai tháng", "d-reports")]:
            dp.goto(url + "?demo" + route) if False else dp.evaluate(f"location.hash = '{route}'")
            dp.get_by_text(marker).first.wait_for()
            dp.wait_for_timeout(500)
            shot(dp, name)
        print("✓ chế độ dùng thử")

        m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = m.new_page()
        watch(mp)
        mp.goto(url + "?demo")
        mp.get_by_text("Có thể tiêu", exact=True).wait_for(timeout=60000)
        mp.wait_for_timeout(600)
        shot(mp, "m-dashboard", full=False)
        mp.click(".tab-add")
        mp.get_by_role("heading", name="Thêm nhanh").wait_for()
        mp.wait_for_timeout(300)
        shot(mp, "m-quickadd", full=False)
        mp.fill(".sheet [name=amount]", "30000")
        mp.click(".sheet [data-cat] >> nth=1")
        mp.click(".sheet button[type=submit]")
        mp.get_by_text("Đã lưu khoản chi 30.000đ").wait_for()
        mp.click("[data-more]")
        mp.click(".more-menu >> text=Tiết kiệm")
        mp.get_by_role("heading", name="Tiết kiệm").wait_for()
        for route in ["#/", "#/income", "#/income/receivables", "#/expenses", "#/expenses/obligations", "#/expenses/import",
                      "#/calendar", "#/savings", "#/reports", "#/settings"]:
            mp.evaluate(f"location.hash = '{route}'")
            mp.wait_for_timeout(700)
            over = mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert over <= 1, f"{route} tràn ngang {over}px trên điện thoại"
        print("✓ điện thoại: thêm chi, menu Thêm, không tràn ngang ở 10 trang")

        # chưa cấu hình Client ID → hướng dẫn rõ ràng
        raw = b.new_context()
        rp = raw.new_page()
        httpd2, base2 = serve(ROOT.parent)
        rp.goto(base2 + "/tai-chinh/")
        rp.get_by_role("heading", name="Chưa cấu hình").wait_for()
        print("✓ chưa dán Client ID thì hiện hướng dẫn")
        b.close()
    httpd.shutdown()
    assert not errors, "Lỗi trên trình duyệt:\n" + "\n".join(errors)
    print("TẤT CẢ ĐẠT, không có lỗi trên console")


if __name__ == "__main__":
    main()

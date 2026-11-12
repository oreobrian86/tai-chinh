"""Khởi chạy: python -m app   (chạy trong thư mục backend)."""
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

import uvicorn

from .config import load_settings
from .main import make_app


def _lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def _open_when_ready(url: str) -> None:
    """Mở trình duyệt khi máy chủ đã trả lời (tối đa 30 giây)."""
    for _ in range(60):
        try:
            urllib.request.urlopen(url + "/api/auth/state", timeout=1)
            webbrowser.open(url)
            return
        except Exception:
            time.sleep(0.5)


def main() -> None:
    if sys.version_info[:2] >= (3, 15) or sys.version_info[:2] < (3, 12):
        print(f"CẢNH BÁO: đang dùng Python {sys.version.split()[0]}. Ứng dụng được kiểm thử với Python 3.12–3.14.")
    s = load_settings()
    app = make_app(s)
    print("=" * 60)
    print(" Quản lý Tài chính & Lịch Freelance")
    print(f" Mở trên máy này:  http://127.0.0.1:{s.port}")
    if s.host in ("0.0.0.0", "::"):
        ip = _lan_ip()
        if ip:
            print(f" Mở trên điện thoại (cùng Wi-Fi): http://{ip}:{s.port}")
        print(" CẢNH BÁO: đang mở cho mạng nội bộ. Xem docs/SECURITY.md.")
    print(" Dữ liệu lưu tại:", s.data_dir)
    print(" Nhấn Ctrl+C để tắt.")
    print("=" * 60)
    if "--open" in sys.argv:
        threading.Thread(target=_open_when_ready, args=(f"http://127.0.0.1:{s.port}",), daemon=True).start()
    try:
        uvicorn.run(app, host=s.host, port=s.port, log_level="warning", proxy_headers=False,
                    server_header=False, date_header=False)
    except OSError as e:
        print(f"Không mở được cổng {s.port}: {e}. Có thể ứng dụng đang chạy ở cửa sổ khác.")
        sys.exit(1)


if __name__ == "__main__":
    main()

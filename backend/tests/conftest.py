"""Mỗi test chạy một server THẬT (uvicorn) trên cổng ngẫu nhiên với database riêng trong thư mục tạm."""
import os
import socket
import sqlite3
import threading
import time
from pathlib import Path

import pytest
import requests

os.environ["FINANCE_TESTING"] = "1"

import uvicorn  # noqa: E402

from app.config import Settings  # noqa: E402
from app.db import today_local  # noqa: E402
from app.main import make_app  # noqa: E402

PASSWORD = "matkhau-rat-dai-2026"
ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Client:
    def __init__(self, base: str, data_dir: Path):
        self.base, self.data_dir = base, data_dir
        self.s = requests.Session()
        self.csrf = None

    def req(self, method, path, json=None, files=None, data=None, csrf=True, headers=None, expect=None, raw=False):
        h = {"X-Requested-With": "finance-app"}
        if csrf and self.csrf:
            h["X-CSRF-Token"] = self.csrf
        h.update(headers or {})
        r = self.s.request(method, self.base + path, json=json, files=files, data=data, headers=h, timeout=30)
        if expect is not None:
            assert r.status_code == expect, f"{method} {path} → {r.status_code}: {r.text[:500]}"
        if raw:
            return r
        try:
            return r.json()
        except ValueError:
            return r

    get = lambda self, p, **k: self.req("GET", p, **k)
    post = lambda self, p, j=None, **k: self.req("POST", p, json=j, **k)
    patch = lambda self, p, j=None, **k: self.req("PATCH", p, json=j, **k)
    put = lambda self, p, j=None, **k: self.req("PUT", p, json=j, **k)
    delete = lambda self, p, **k: self.req("DELETE", p, **k)

    def refresh(self):
        st = self.get("/api/auth/state")
        self.csrf = st.get("csrf")
        return st

    def setup(self, username="phuc"):
        self.post("/api/auth/setup", {"username": username, "password": PASSWORD, "display_name": "Phúc"}, expect=200)
        self.refresh()
        return self

    def db(self) -> sqlite3.Connection:
        c = sqlite3.connect(str(self.data_dir / "finance.db"))
        c.row_factory = sqlite3.Row
        return c

    # tiện ích nghiệp vụ
    def accounts(self):
        return {a["name"]: a for a in self.get("/api/accounts")}

    def cat(self, name):
        return next(c for c in self.get("/api/categories") if c["name"] == name)

    def fc(self):
        return self.get("/api/forecast")


def _server(tmp_path, rate=1200):
    s = Settings()
    s.rate_limit_per_minute = rate
    s.data_dir = tmp_path / "data"
    s.frontend_dir = ROOT / "frontend"
    s.port = free_port()
    s.testing = True
    app = make_app(s)
    config = uvicorn.Config(app, host="127.0.0.1", port=s.port, log_level="error", lifespan="on")
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield s
    srv.should_exit = True
    t.join(timeout=5)


@pytest.fixture
def server(tmp_path):
    yield from _server(tmp_path)



@pytest.fixture
def client(server):
    return Client(f"http://127.0.0.1:{server.port}", server.data_dir)


@pytest.fixture
def app_(client):
    """Client đã thiết lập tài khoản và đăng nhập."""
    return client.setup()


@pytest.fixture
def today():
    return today_local()

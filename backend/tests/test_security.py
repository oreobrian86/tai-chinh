"""Kiểm thử bảo mật: băm mật khẩu, CSRF, brute-force, khóa app, phân quyền, log, header."""
import requests

from app import services as sv
from app.db import connect, transaction
from app.security import create_session

from .conftest import PASSWORD


def test_password_never_stored_plaintext(app_):
    db = app_.db()
    h = db.execute("SELECT password_hash FROM users").fetchone()[0]
    assert h.startswith("$argon2id$") and PASSWORD not in h
    # token session cũng chỉ lưu bản băm
    cookie = app_.s.cookies.get("fm_session")
    assert db.execute("SELECT COUNT(*) FROM sessions WHERE token_hash=?", (cookie,)).fetchone()[0] == 0


def test_weak_password_rejected(client):
    r = client.post("/api/auth/setup", {"username": "a_b", "password": "123"}, expect=422)
    assert r["error"]["code"] in ("weak_password", "validation")


def test_setup_only_once(app_):
    app_.post("/api/auth/setup", {"username": "khac", "password": PASSWORD}, expect=409)


def test_requires_auth(client):
    client.setup()
    anon = requests.get(client.base + "/api/dashboard")
    assert anon.status_code == 401
    assert requests.get(client.base + "/api/export/all.json").status_code == 401
    assert requests.get(client.base + "/api/backups").status_code == 401


def test_csrf_required_for_writes(app_):
    acc = app_.accounts()["Tiền mặt"]["id"]
    r = app_.req("POST", "/api/transactions", json={"kind": "expense", "amount": 1000, "account_id": acc}, csrf=False)
    assert r["error"]["code"] == "csrf"
    r = app_.req("POST", "/api/transactions", json={"kind": "expense", "amount": 1000, "account_id": acc},
                 headers={"X-CSRF-Token": "sai"})
    assert r["error"]["code"] == "csrf"
    # Origin lạ bị chặn ngay cả khi có token
    r = app_.req("POST", "/api/transactions", json={"kind": "expense", "amount": 1000, "account_id": acc},
                 headers={"Origin": "https://evil.example"}, raw=True)
    assert r.status_code == 403
    assert app_.fc()["balance"] == 0


def test_login_without_custom_header_blocked(client):
    client.setup()
    r = requests.post(client.base + "/api/auth/login", json={"username": "phuc", "password": PASSWORD})
    assert r.status_code == 403


def test_bruteforce_lockout(client):
    client.setup()
    c2 = type(client)(client.base, client.data_dir)
    for _ in range(5):
        r = c2.post("/api/auth/login", {"username": "phuc", "password": "sai-mat-khau-123"}, raw=True)
        assert r.status_code == 401
    r = c2.post("/api/auth/login", {"username": "phuc", "password": PASSWORD}, raw=True)
    assert r.status_code == 429  # bị khóa kể cả khi đúng mật khẩu
    # thông báo lỗi không tiết lộ username có tồn tại hay không
    r = c2.post("/api/auth/login", {"username": "khong-ton-tai", "password": "x"}, raw=True)
    assert r.json()["error"]["message"] == "Sai tên đăng nhập hoặc mật khẩu."


def test_login_logout_flow(client):
    client.setup()
    client.post("/api/auth/logout", expect=200)
    assert client.get("/api/dashboard", raw=True).status_code == 401
    c2 = type(client)(client.base, client.data_dir)
    c2.post("/api/auth/login", {"username": "PHUC", "password": PASSWORD}, expect=200)  # không phân biệt hoa thường
    c2.refresh()
    assert c2.get("/api/dashboard", raw=True).status_code == 200


def test_lock_blocks_api_and_pin_unlocks(app_):
    app_.post("/api/auth/pin", {"pin": "246810", "password": PASSWORD}, expect=200)
    app_.post("/api/auth/lock", expect=200)
    r = app_.get("/api/dashboard", raw=True)
    assert r.status_code == 423            # backend từ chối dữ liệu, không chỉ che màn hình
    assert app_.get("/api/export/all.json", raw=True).status_code == 423
    app_.post("/api/auth/unlock", {"pin": "000000"}, expect=401)
    app_.post("/api/auth/unlock", {"pin": "246810"}, expect=200)
    assert app_.get("/api/dashboard", raw=True).status_code == 200


def test_pin_failures_force_relogin(app_):
    app_.post("/api/auth/pin", {"pin": "246810", "password": PASSWORD}, expect=200)
    app_.post("/api/auth/lock", expect=200)
    for _ in range(4):
        app_.post("/api/auth/unlock", {"pin": "111111"}, expect=401)
    r = app_.post("/api/auth/unlock", {"pin": "111111"}, raw=True)
    assert r.json()["error"]["code"] == "unauthenticated"
    assert app_.get("/api/dashboard", raw=True).status_code == 401


def test_users_cannot_see_each_others_data(app_, server, today):
    """Chuẩn bị cho nhiều tài khoản: dữ liệu người A trả 404 với người B."""
    cash = app_.accounts()["Tiền mặt"]["id"]
    job = app_.post("/api/jobs", {"title": "Show riêng", "work_type": "photo", "work_date": today.isoformat(),
                                  "total_fee": 1_000_000}, expect=200)
    conn = connect(server.db_path)
    with transaction(conn):
        conn.execute("INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('u2','b',?, 'x','x')",
                     ("$argon2id$v=19$m=8,t=1,p=1$AAAA$AAAA",))
        token, sess = create_session(conn, "u2", "127.0.0.1", "t", 1)
    conn.close()
    other = type(app_)(app_.base, app_.data_dir)
    other.s.cookies.set("fm_session", token)
    other.csrf = sess["csrf_token"]
    assert other.get(f"/api/jobs/{job['id']}", raw=True).status_code == 404
    assert other.post(f"/api/jobs/{job['id']}/payments", {"amount": 1, "account_id": cash}, raw=True).status_code == 404
    assert other.get("/api/jobs")["items"] == []
    assert other.post("/api/transactions", {"kind": "expense", "amount": 1, "account_id": cash}, raw=True).status_code == 404


def test_password_change_revokes_other_sessions(client):
    client.setup()
    c2 = type(client)(client.base, client.data_dir)
    c2.post("/api/auth/login", {"username": "phuc", "password": PASSWORD}, expect=200)
    c2.refresh()
    client.post("/api/auth/password", {"current_password": PASSWORD, "new_password": "mat-khau-moi-2027!"}, expect=200)
    assert c2.get("/api/dashboard", raw=True).status_code == 401
    assert client.get("/api/dashboard", raw=True).status_code == 200


def test_security_headers(client):
    r = requests.get(client.base + "/")
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"
    client.setup()
    r = client.get("/api/dashboard", raw=True)
    assert r.headers["cache-control"] == "no-store"
    ck = [c for c in client.s.cookies if c.name == "fm_session"][0]
    assert ck.has_nonstandard_attr("HttpOnly") or "httponly" in str(ck._rest).lower()


def test_logs_do_not_contain_secrets(app_, server):
    app_.post("/api/auth/logout")
    c2 = type(app_)(app_.base, app_.data_dir)
    c2.post("/api/auth/login", {"username": "phuc", "password": "sai-nhung-bi-mat-xyz"})
    c2.post("/api/auth/login", {"username": "phuc", "password": PASSWORD})
    import logging
    from pathlib import Path
    files = []
    for h in logging.getLogger("finance").handlers:
        h.flush()
        if hasattr(h, "baseFilename"):
            files.append(Path(h.baseFilename))
    text = "".join(f.read_text(encoding="utf-8") for f in files)
    assert "Đăng nhập thất bại" in text   # log có ghi sự kiện, nhưng không ghi bí mật
    assert PASSWORD not in text and "sai-nhung-bi-mat-xyz" not in text
    assert "fm_session=" not in text or "fm_session=***" in text


def test_redact_filter():
    from app.logging_setup import redact
    s = redact('{"password": "abc123", "pin":"111111"} fm_session=xyz token=qq $argon2id$v=19$m=1$aa$bb')
    assert "abc123" not in s and "111111" not in s and "xyz" not in s and "qq" not in s and "$bb" not in s


def test_backup_restore_requires_password(app_):
    app_.post("/api/backups", expect=200)
    name = app_.get("/api/backups")[0]["name"]
    r = app_.req("POST", "/api/backups/restore", data={"name": name, "password": "sai"}, raw=True)
    assert r.status_code == 401
    r = app_.req("GET", "/api/backups/..%2Ffinance.db", raw=True)
    assert r.status_code in (400, 404)

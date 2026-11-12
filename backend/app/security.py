"""Băm mật khẩu (Argon2id), session, CSRF, rate limit."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

from .db import new_id, now_iso

# Tham số Argon2id: 64 MiB bộ nhớ, 3 vòng, 4 luồng (theo khuyến nghị OWASP / RFC 9106 mức "second choice").
ARGON_MEMORY_KIB = 64 * 1024
ARGON_ITERATIONS = 3
ARGON_LANES = 4
_TEST_FAST = os.environ.get("FINANCE_TESTING") == "1"


def _kdf(salt: bytes) -> Argon2id:
    if _TEST_FAST:  # chỉ dùng khi chạy test để test nhanh hơn
        return Argon2id(salt=salt, length=32, iterations=1, lanes=1, memory_cost=8 * 1024)
    return Argon2id(salt=salt, length=32, iterations=ARGON_ITERATIONS, lanes=ARGON_LANES,
                    memory_cost=ARGON_MEMORY_KIB)


def hash_secret(secret: str) -> str:
    """Trả về chuỗi PHC chuẩn: $argon2id$v=19$m=...,t=...,p=...$salt$hash"""
    return _kdf(os.urandom(16)).derive_phc_encoded(secret.encode("utf-8"))


def verify_secret(secret: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        Argon2id.verify_phc_encoded(secret.encode("utf-8"), encoded)
        return True
    except (InvalidKey, ValueError, TypeError):
        return False


# Dùng khi username không tồn tại để thời gian phản hồi tương đương (chống dò username).
_DUMMY_HASH: str | None = None


def dummy_verify(secret: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_secret("dummy-password-for-timing")
    verify_secret(secret, _DUMMY_HASH)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def password_problems(pw: str) -> str | None:
    if len(pw) < 10:
        return "Mật khẩu cần ít nhất 10 ký tự."
    if len(pw) > 256:
        return "Mật khẩu quá dài."
    if pw.lower() in ("1234567890", "password123", "matkhau123", "0123456789", "qwertyuiop"):
        return "Mật khẩu quá dễ đoán."
    return None


# ---------- session ----------

def _utc(dt_str: str) -> datetime:
    return datetime.fromisoformat(dt_str)


def create_session(conn: sqlite3.Connection, user_id: str, ip: str | None, ua: str | None,
                   days: int) -> tuple[str, dict]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sess = {
        "id": new_id(), "user_id": user_id, "token_hash": token_hash(token),
        "csrf_token": secrets.token_urlsafe(32), "created_at": now.isoformat(),
        "last_seen_at": now.isoformat(), "expires_at": (now + timedelta(days=days)).isoformat(),
        "locked": 0, "pin_failures": 0, "ip": ip, "user_agent": (ua or "")[:300],
    }
    conn.execute(
        "INSERT INTO sessions(id,user_id,token_hash,csrf_token,created_at,last_seen_at,expires_at,locked,pin_failures,ip,user_agent)"
        " VALUES (:id,:user_id,:token_hash,:csrf_token,:created_at,:last_seen_at,:expires_at,:locked,:pin_failures,:ip,:user_agent)",
        sess,
    )
    return token, sess


def load_session(conn: sqlite3.Connection, token: str | None, idle_days: int) -> dict | None:
    if not token or len(token) > 200:
        return None
    r = conn.execute("SELECT * FROM sessions WHERE token_hash=?", (token_hash(token),)).fetchone()
    if r is None:
        return None
    s = dict(r)
    now = datetime.now(timezone.utc)
    if _utc(s["expires_at"]) < now or _utc(s["last_seen_at"]) < now - timedelta(days=idle_days):
        conn.execute("DELETE FROM sessions WHERE id=?", (s["id"],))
        return None
    return s


def touch_session(conn: sqlite3.Connection, sess: dict, lock_minutes: int) -> dict:
    """Cập nhật last_seen; tự khóa nếu không thao tác quá lock_minutes."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    last = _utc(sess["last_seen_at"])
    if lock_minutes > 0 and not sess["locked"] and now - last > timedelta(minutes=lock_minutes):
        sess["locked"] = 1
    if now - last > timedelta(seconds=30) or sess["locked"]:
        conn.execute("UPDATE sessions SET last_seen_at=?, locked=? WHERE id=?",
                     (now.isoformat(), sess["locked"], sess["id"]))
        sess["last_seen_at"] = now.isoformat()
    return sess


def csrf_ok(sess: dict, header_value: str | None) -> bool:
    return bool(header_value) and hmac.compare_digest(sess["csrf_token"], header_value)


# ---------- chống brute-force ----------

def login_blocked(conn: sqlite3.Connection, username: str, ip: str, max_failures: int,
                  window_minutes: int) -> int:
    """Trả về số giây phải chờ (0 = được thử)."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=window_minutes)).isoformat()
    by_user = conn.execute(
        "SELECT COUNT(*), MAX(at) FROM login_attempts WHERE username=? COLLATE NOCASE AND success=0 AND at>=?",
        (username, since)).fetchone()
    by_ip = conn.execute(
        "SELECT COUNT(*), MAX(at) FROM login_attempts WHERE ip=? AND success=0 AND at>=?",
        (ip, since)).fetchone()
    for count, last, limit in ((by_user[0], by_user[1], max_failures), (by_ip[0], by_ip[1], max_failures * 4)):
        if count >= limit and last:
            # Khóa tăng dần: mỗi lần sai thêm sau ngưỡng tăng gấp đôi thời gian chờ (tối đa 1 giờ).
            extra = count - limit
            wait = min(window_minutes * 60 * (2 ** extra), 3600)
            remaining = int((_utc(last) + timedelta(seconds=wait) - datetime.now(timezone.utc)).total_seconds())
            if remaining > 0:
                return remaining
    return 0


def record_login(conn: sqlite3.Connection, username: str, ip: str, success: bool) -> None:
    conn.execute("INSERT INTO login_attempts(username, ip, success, at) VALUES (?,?,?,?)",
                 (username[:100], ip, 1 if success else 0, now_iso()))
    if success:
        conn.execute("DELETE FROM login_attempts WHERE username=? COLLATE NOCASE AND success=0", (username,))
    # dọn bản ghi cũ
    old = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    conn.execute("DELETE FROM login_attempts WHERE at < ?", (old,))


class RateLimiter:
    """Giới hạn số request/phút theo IP (trong bộ nhớ)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            if len(self.hits) > 5000:
                self.hits.clear()
            return True

"""Kết nối SQLite, migration và tiện ích chung."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def connect(path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Mọi thao tác ghi tiền chạy trong một transaction: hoặc tất cả, hoặc không gì cả."""
    if conn.in_transaction:  # lồng nhau: dùng savepoint
        sp = "sp_" + uuid.uuid4().hex[:8]
        conn.execute(f"SAVEPOINT {sp}")
        try:
            yield conn
            conn.execute(f"RELEASE {sp}")
        except BaseException:
            conn.execute(f"ROLLBACK TO {sp}")
            conn.execute(f"RELEASE {sp}")
            raise
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def migrate(conn: sqlite3.Connection) -> list[int]:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    done = {r[0] for r in conn.execute("SELECT version FROM schema_migrations")}
    applied = []
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version = int(f.name.split("_", 1)[0])
        if version in done:
            continue
        sql = f.read_text(encoding="utf-8")
        try:
            conn.executescript(
                "BEGIN;\n" + sql +
                f"\nINSERT INTO schema_migrations(version, applied_at) VALUES ({version}, '{now_iso()}');\nCOMMIT;"
            )
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        applied.append(version)
    return applied


# ---------- tiện ích ----------

def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


_TZ_OFFSET = 7


def set_tz_offset(hours: int) -> None:
    global _TZ_OFFSET
    _TZ_OFFSET = hours


def today_local() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=_TZ_OFFSET)).date()


def row(r: sqlite3.Row | None) -> dict | None:
    return dict(r) if r is not None else None


def rows(rs) -> list[dict]:
    return [dict(r) for r in rs]


def audit(conn: sqlite3.Connection, user_id: str | None, entity: str, entity_id: str | None,
          action: str, data: Any = None) -> None:
    conn.execute(
        "INSERT INTO audit_log(user_id, entity, entity_id, action, data_json, at) VALUES (?,?,?,?,?,?)",
        (user_id, entity, entity_id, action, json.dumps(data, ensure_ascii=False, default=str) if data is not None else None, now_iso()),
    )

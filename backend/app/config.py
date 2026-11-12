"""Cấu hình đọc từ biến môi trường hoặc file .env ở thư mục gốc dự án."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = ROOT_DIR / "data"
    frontend_dir: Path = ROOT_DIR / "frontend"
    # "auto": Secure khi request đi qua HTTPS (vd. tailscale serve). "true"/"false" để ép.
    cookie_secure: str = "auto"
    session_days: int = 14
    session_idle_days: int = 2
    tz_offset_hours: int = 7  # Việt Nam không có giờ mùa hè
    login_max_failures: int = 5
    login_window_minutes: int = 15
    backup_keep: int = 30
    rate_limit_per_minute: int = 1200
    trusted_proxies: tuple = ("127.0.0.1", "::1")
    allowed_hosts: list = field(default_factory=list)  # rỗng = không giới hạn Host
    testing: bool = False

    @property
    def db_path(self) -> Path:
        return self.data_dir / "finance.db"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backups"


def load_settings() -> Settings:
    _load_dotenv(ROOT_DIR / ".env")
    s = Settings()
    s.host = os.environ.get("FINANCE_HOST", s.host)
    s.port = int(os.environ.get("FINANCE_PORT", s.port))
    if os.environ.get("FINANCE_DATA_DIR"):
        s.data_dir = Path(os.environ["FINANCE_DATA_DIR"]).resolve()
    s.cookie_secure = os.environ.get("FINANCE_COOKIE_SECURE", s.cookie_secure).lower()
    s.session_days = int(os.environ.get("FINANCE_SESSION_DAYS", s.session_days))
    hosts = os.environ.get("FINANCE_ALLOWED_HOSTS", "").strip()
    s.allowed_hosts = [h.strip() for h in hosts.split(",") if h.strip()]
    s.testing = _bool("FINANCE_TESTING", False)
    s.rate_limit_per_minute = int(os.environ.get("FINANCE_RATE_LIMIT", s.rate_limit_per_minute))
    return s


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)

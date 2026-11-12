"""Log an toàn: ghi ra file xoay vòng, tự che mật khẩu/token/cookie nếu lỡ xuất hiện."""
from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

_PATTERNS = [
    (re.compile(r'(?i)("?(password|current_password|new_password|pin|token|csrf[_-]?token|secret)"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)'), r"\1***"),
    (re.compile(r"(?i)(fm_session=)[^;\s]+"), r"\1***"),
    (re.compile(r"(?i)(x-csrf-token:\s*)\S+"), r"\1***"),
    (re.compile(r"\$argon2id\$[^\s\"']+"), "$argon2id$***"),
]


def redact(text: str) -> str:
    for pat, rep in _PATTERNS:
        text = pat.sub(rep, text)
    return text


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        clean = redact(msg)
        if clean != msg:
            record.msg, record.args = clean, ()
        return True


_configured = False


def setup_logging(log_dir: Path, level: int = logging.INFO) -> None:
    global _configured
    if _configured:
        return
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = RotatingFileHandler(log_dir / "app.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.addFilter(RedactFilter())
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    sh.addFilter(RedactFilter())
    for name in ("finance", "uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.setLevel(level)
        lg.addHandler(fh)
        if name == "finance":
            lg.addHandler(sh)
        lg.propagate = name != "finance"
    _configured = True

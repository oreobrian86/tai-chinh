"""Validation dữ liệu đầu vào (Pydantic). Tiền luôn là số nguyên VNĐ."""
from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_MONEY = 100_000_000_000  # 100 tỷ — chặn nhập nhầm thừa số 0
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.fields = status, code, message, fields or {}


def not_found(what: str = "Không tìm thấy dữ liệu") -> AppError:
    return AppError(404, "not_found", what)


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


Money = Field(ge=0, le=MAX_MONEY)
PosMoney = Field(gt=0, le=MAX_MONEY)
Text = Field(default=None, max_length=2000)
Name = Field(min_length=1, max_length=200)


def _date(v):
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v.isoformat()
    try:
        return date.fromisoformat(str(v)).isoformat()
    except ValueError:
        raise ValueError("Ngày không hợp lệ (định dạng YYYY-MM-DD)")


def _time(v):
    if v in (None, ""):
        return None
    if not TIME_RE.match(str(v)):
        raise ValueError("Giờ không hợp lệ (HH:MM)")
    return str(v)


# ---------- auth ----------
class SetupIn(Base):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.\-]+$")
    display_name: Optional[str] = Field(default=None, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class LoginIn(Base):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


class UnlockIn(Base):
    pin: Optional[str] = Field(default=None, max_length=20)
    password: Optional[str] = Field(default=None, max_length=256)


class PinIn(Base):
    pin: Optional[str] = Field(default=None, pattern=r"^\d{6}$")
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(Base):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class SettingsIn(Base):
    lock_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    exclude_one_off: Optional[bool] = None
    display_name: Optional[str] = Field(default=None, max_length=100)


# ---------- danh mục, tài khoản, khách ----------
class AccountIn(Base):
    name: str = Name
    kind: Literal["cash", "bank", "ewallet", "savings", "other"] = "cash"
    opening_balance: int = Field(default=0, ge=-MAX_MONEY, le=MAX_MONEY)
    opening_date: Optional[str] = None
    archived: Optional[bool] = None
    _v = field_validator("opening_date", mode="before")(_date)


class AccountPatch(Base):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    kind: Optional[Literal["cash", "bank", "ewallet", "savings", "other"]] = None
    archived: Optional[bool] = None
    sort: Optional[int] = None


class CategoryIn(Base):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["expense", "income"] = "expense"
    icon: Optional[str] = Field(default=None, max_length=8)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    sort: Optional[int] = None


class CategoryPatch(Base):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    icon: Optional[str] = Field(default=None, max_length=8)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    sort: Optional[int] = None


class ClientIn(Base):
    name: str = Name
    phone: Optional[str] = Field(default=None, max_length=30)
    note: Optional[str] = Text


# ---------- show ----------
class SessionIn(Base):
    id: Optional[str] = None
    kind: Literal["shoot", "photo", "edit", "deadline", "other"]
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Text
    _vd = field_validator("date", mode="before")(_date)
    _vt = field_validator("start_time", "end_time", mode="before")(_time)


class JobIn(Base):
    title: str = Name
    client_id: Optional[str] = None
    client_name: Optional[str] = Field(default=None, max_length=200)  # tạo khách mới nhanh
    work_type: Literal["video", "edit", "photo", "other"] = "video"
    work_date: str
    total_fee: int = Money
    due_date: Optional[str] = None
    work_status: Literal["booked", "in_progress", "done"] = "booked"
    location: Optional[str] = Field(default=None, max_length=300)
    description: Optional[str] = Text
    note: Optional[str] = Text
    deposit: int = Field(default=0, ge=0, le=MAX_MONEY)       # tiền cọc nhận ngay khi tạo
    deposit_account_id: Optional[str] = None
    deposit_date: Optional[str] = None
    sessions: Optional[list[SessionIn]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    _vd = field_validator("work_date", "due_date", "deposit_date", mode="before")(_date)
    _vt = field_validator("start_time", "end_time", mode="before")(_time)


class JobPatch(Base):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    client_id: Optional[str] = None
    client_name: Optional[str] = Field(default=None, max_length=200)
    work_type: Optional[Literal["video", "edit", "photo", "other"]] = None
    work_date: Optional[str] = None
    total_fee: Optional[int] = Field(default=None, ge=0, le=MAX_MONEY)
    due_date: Optional[str] = None
    work_status: Optional[Literal["booked", "in_progress", "done"]] = None
    location: Optional[str] = Field(default=None, max_length=300)
    description: Optional[str] = Text
    note: Optional[str] = Text
    sessions: Optional[list[SessionIn]] = None
    _vd = field_validator("work_date", "due_date", mode="before")(_date)


class PaymentIn(Base):
    amount: int = PosMoney
    date: Optional[str] = None
    account_id: str
    note: Optional[str] = Text
    allow_overpay: bool = False
    _vd = field_validator("date", mode="before")(_date)


class CancelIn(Base):
    policy: Literal["keep", "refund"]
    account_id: Optional[str] = None
    date: Optional[str] = None
    note: Optional[str] = Text
    _vd = field_validator("date", mode="before")(_date)


# ---------- giao dịch ----------
class TxIn(Base):
    kind: Literal["expense", "other_income", "transfer", "adjustment"]
    amount: int = Field(le=MAX_MONEY, ge=-MAX_MONEY)
    date: Optional[str] = None
    account_id: str
    to_account_id: Optional[str] = None
    category_id: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Text
    is_one_off: bool = False
    job_id: Optional[str] = None
    fee: int = Field(default=0, ge=0, le=MAX_MONEY)  # phí chuyển khoản → tách thành 1 khoản chi
    _vd = field_validator("date", mode="before")(_date)


class TxPatch(Base):
    amount: Optional[int] = Field(default=None, le=MAX_MONEY, ge=-MAX_MONEY)
    date: Optional[str] = None
    account_id: Optional[str] = None
    to_account_id: Optional[str] = None
    category_id: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Text
    is_one_off: Optional[bool] = None
    _vd = field_validator("date", mode="before")(_date)


# ---------- tiết kiệm, khoản phải trả, lịch ----------
class GoalIn(Base):
    name: str = Name
    target_amount: int = PosMoney
    target_date: Optional[str] = None
    monthly_plan: Optional[int] = Field(default=None, ge=0, le=MAX_MONEY)
    is_emergency: bool = False
    note: Optional[str] = Text
    initial_amount: int = Field(default=0, ge=0, le=MAX_MONEY)
    _vd = field_validator("target_date", mode="before")(_date)


class GoalPatch(Base):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    target_amount: Optional[int] = Field(default=None, gt=0, le=MAX_MONEY)
    target_date: Optional[str] = None
    monthly_plan: Optional[int] = Field(default=None, ge=0, le=MAX_MONEY)
    is_emergency: Optional[bool] = None
    archived: Optional[bool] = None
    note: Optional[str] = Text
    _vd = field_validator("target_date", mode="before")(_date)


class AllocationIn(Base):
    amount: int = Field(le=MAX_MONEY, ge=-MAX_MONEY)
    date: Optional[str] = None
    note: Optional[str] = Text
    _vd = field_validator("date", mode="before")(_date)


class ObligationIn(Base):
    name: str = Name
    amount: int = PosMoney
    due_date: str
    recurrence: Literal["none", "monthly"] = "none"
    category_id: Optional[str] = None
    note: Optional[str] = Text
    _vd = field_validator("due_date", mode="before")(_date)


class ObligationPatch(Base):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[int] = Field(default=None, gt=0, le=MAX_MONEY)
    due_date: Optional[str] = None
    recurrence: Optional[Literal["none", "monthly"]] = None
    category_id: Optional[str] = None
    note: Optional[str] = Text
    _vd = field_validator("due_date", mode="before")(_date)


class PayObligationIn(Base):
    account_id: str
    date: Optional[str] = None
    amount: Optional[int] = Field(default=None, gt=0, le=MAX_MONEY)
    _vd = field_validator("date", mode="before")(_date)


class DayOffIn(Base):
    date: str
    note: Optional[str] = Field(default=None, max_length=300)
    _vd = field_validator("date", mode="before")(_date)


class ImportMapIn(Base):
    token: str = Field(max_length=100)
    mapping: dict[str, Optional[int]]  # field -> column index
    account_id: str
    date_format: Literal["auto", "dmy", "ymd", "mdy"] = "auto"
    amount_mode: Literal["expense_positive", "signed", "debit_credit"] = "expense_positive"
    skip_header: bool = True
    include_duplicates: list[int] = Field(default_factory=list)  # chỉ số dòng người dùng vẫn muốn nhập dù nghi trùng


class ReauthIn(Base):
    password: str = Field(min_length=1, max_length=256)

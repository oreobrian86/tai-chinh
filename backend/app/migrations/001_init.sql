-- 001: Khởi tạo schema. Tiền lưu bằng INTEGER (VNĐ). Ngày: 'YYYY-MM-DD' giờ VN. Thời điểm: ISO UTC.
-- Mọi bảng nghiệp vụ có user_id, id UUID, created_at/updated_at/deleted_at/version để mở rộng đa người dùng & đồng bộ.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    pin_hash TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    pin_failures INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    user_agent TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    ip TEXT,
    success INTEGER NOT NULL,
    at TEXT NOT NULL
);
CREATE INDEX ix_login_attempts_at ON login_attempts(at);

CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cash','bank','ewallet','savings','other')),
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    phone TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
    icon TEXT, color TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    client_id TEXT REFERENCES clients(id),
    work_type TEXT NOT NULL CHECK (work_type IN ('video','edit','photo','other')),
    work_date TEXT NOT NULL,
    total_fee INTEGER NOT NULL CHECK (total_fee >= 0),
    due_date TEXT,
    work_status TEXT NOT NULL DEFAULT 'booked' CHECK (work_status IN ('booked','in_progress','done','cancelled')),
    cancel_policy TEXT CHECK (cancel_policy IN ('keep','refund')),
    location TEXT, description TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_jobs_user ON jobs(user_id, work_status);
CREATE INDEX ix_jobs_date ON jobs(user_id, work_date);

CREATE TABLE job_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    job_id TEXT NOT NULL REFERENCES jobs(id),
    kind TEXT NOT NULL CHECK (kind IN ('shoot','photo','edit','deadline','other')),
    date TEXT NOT NULL,
    start_time TEXT, end_time TEXT,
    location TEXT, note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_job_sessions_date ON job_sessions(user_id, date);

CREATE TABLE day_offs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE import_batches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    filename TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','undone')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE obligations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    due_date TEXT NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly')),
    category_id TEXT REFERENCES categories(id),
    paid_transaction_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('job_payment','job_refund','other_income','expense','transfer','adjustment')),
    date TEXT NOT NULL,
    description TEXT,
    category_id TEXT REFERENCES categories(id),
    job_id TEXT REFERENCES jobs(id),
    obligation_id TEXT REFERENCES obligations(id),
    is_one_off INTEGER NOT NULL DEFAULT 0,
    import_batch_id TEXT REFERENCES import_batches(id),
    import_hash TEXT,
    note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1,
    CHECK (kind NOT IN ('job_payment','job_refund') OR job_id IS NOT NULL)
);
CREATE INDEX ix_tx_user_date ON transactions(user_id, date);
CREATE INDEX ix_tx_job ON transactions(job_id);
-- Lớp chặn trùng cuối cùng cho dữ liệu import.
CREATE UNIQUE INDEX ux_tx_import_hash ON transactions(user_id, import_hash)
    WHERE import_hash IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE transaction_lines (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount INTEGER NOT NULL CHECK (amount <> 0)
);
CREATE INDEX ix_lines_tx ON transaction_lines(transaction_id);
CREATE INDEX ix_lines_account ON transaction_lines(account_id);

CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL CHECK (target_amount > 0),
    target_date TEXT,
    monthly_plan INTEGER CHECK (monthly_plan IS NULL OR monthly_plan >= 0),
    is_emergency INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE goal_allocations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    goal_id TEXT NOT NULL REFERENCES goals(id),
    date TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount <> 0),
    note TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_alloc_goal ON goal_allocations(goal_id);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    entity TEXT NOT NULL,
    entity_id TEXT,
    action TEXT NOT NULL,
    data_json TEXT,
    at TEXT NOT NULL
);

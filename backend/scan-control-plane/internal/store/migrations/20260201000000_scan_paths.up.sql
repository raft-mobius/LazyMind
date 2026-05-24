CREATE TABLE IF NOT EXISTS scan_paths (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    file_count INTEGER NOT NULL DEFAULT 0,
    last_scan_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_paths_user_id ON scan_paths(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_paths_user_path ON scan_paths(user_id, path);

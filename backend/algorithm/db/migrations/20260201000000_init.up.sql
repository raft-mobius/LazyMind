-- Algorithm service database schema (algo.db)
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS parse_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_parse_tasks_user_id ON parse_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_parse_tasks_status ON parse_tasks(status);

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    parse_task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parse_task_id) REFERENCES parse_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_parse_task ON document_chunks(parse_task_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_doc ON document_chunks(user_id, doc_id);

CREATE TABLE IF NOT EXISTS embedding_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    model_name TEXT NOT NULL DEFAULT '',
    vector_dim INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (chunk_id) REFERENCES document_chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embedding_tasks_user_id ON embedding_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_embedding_tasks_status ON embedding_tasks(status);
CREATE INDEX IF NOT EXISTS idx_embedding_tasks_chunk ON embedding_tasks(chunk_id);

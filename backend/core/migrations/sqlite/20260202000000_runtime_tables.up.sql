CREATE TABLE IF NOT EXISTS runtime_chat_status (
    conversation_id TEXT NOT NULL,
    history_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_result TEXT NOT NULL DEFAULT '',
    total_chunks INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, history_id)
);

CREATE TABLE IF NOT EXISTS runtime_multi_answer (
    conversation_id TEXT NOT NULL,
    primary_history_id TEXT NOT NULL,
    secondary_history_id TEXT NOT NULL DEFAULT '',
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, primary_history_id)
);

CREATE TABLE IF NOT EXISTS runtime_chat_input (
    conversation_id TEXT NOT NULL,
    history_id TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, history_id)
);

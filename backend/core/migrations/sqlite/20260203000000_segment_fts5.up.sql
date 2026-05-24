CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    content TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_user_id ON segments(user_id);
CREATE INDEX IF NOT EXISTS idx_segments_user_doc ON segments(user_id, doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
    content,
    title,
    content='segments',
    content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, content, title) VALUES (new.rowid, new.content, new.title);
END;

CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, content, title) VALUES ('delete', old.rowid, old.content, old.title);
END;

CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, content, title) VALUES ('delete', old.rowid, old.content, old.title);
    INSERT INTO segments_fts(rowid, content, title) VALUES (new.rowid, new.content, new.title);
END;

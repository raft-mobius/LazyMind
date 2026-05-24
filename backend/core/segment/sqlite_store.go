package segment

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/glebarez/go-sqlite"
)

type SQLiteSegmentStore struct {
	db *sql.DB
}

func NewSQLiteSegmentStore(dbPath string) (*SQLiteSegmentStore, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open segment db: %w", err)
	}

	db.Exec("PRAGMA journal_mode=WAL")
	db.Exec("PRAGMA busy_timeout=5000")

	if err := initSegmentTables(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("init segment tables: %w", err)
	}

	return &SQLiteSegmentStore{db: db}, nil
}

func initSegmentTables(db *sql.DB) error {
	_, err := db.Exec(`
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
	`)
	return err
}

func (s *SQLiteSegmentStore) Insert(ctx context.Context, seg *Segment) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT OR REPLACE INTO segments (id, user_id, doc_id, chunk_id, content, title, source)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, seg.ID, seg.UserID, seg.DocID, seg.ChunkID, seg.Content, seg.Title, seg.Source)
	return err
}

func (s *SQLiteSegmentStore) InsertBatch(ctx context.Context, segments []*Segment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT OR REPLACE INTO segments (id, user_id, doc_id, chunk_id, content, title, source)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, seg := range segments {
		if _, err := stmt.ExecContext(ctx, seg.ID, seg.UserID, seg.DocID, seg.ChunkID, seg.Content, seg.Title, seg.Source); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLiteSegmentStore) Search(ctx context.Context, userID, query string, limit int) ([]*SearchResult, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.user_id, s.doc_id, s.chunk_id, s.content, s.title, s.source, s.created_at,
		       bm25(segments_fts, 1.0, 0.5) as score
		FROM segments s
		JOIN segments_fts ON segments_fts.rowid = s.rowid
		WHERE segments_fts MATCH ? AND s.user_id = ?
		ORDER BY score
		LIMIT ?
	`, query, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("fts search: %w", err)
	}
	defer rows.Close()

	var results []*SearchResult
	rank := 1
	for rows.Next() {
		var r SearchResult
		if err := rows.Scan(&r.ID, &r.UserID, &r.DocID, &r.ChunkID, &r.Content, &r.Title, &r.Source, &r.CreatedAt, &r.Score); err != nil {
			return nil, err
		}
		r.Rank = rank
		rank++
		results = append(results, &r)
	}
	return results, rows.Err()
}

func (s *SQLiteSegmentStore) DeleteByDoc(ctx context.Context, userID, docID string) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM segments WHERE user_id = ? AND doc_id = ?`, userID, docID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *SQLiteSegmentStore) DeleteByUser(ctx context.Context, userID string) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM segments WHERE user_id = ?`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *SQLiteSegmentStore) Count(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM segments WHERE user_id = ?`, userID).Scan(&count)
	return count, err
}

func (s *SQLiteSegmentStore) Close() error {
	return s.db.Close()
}

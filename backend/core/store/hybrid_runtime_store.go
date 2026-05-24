package store

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "github.com/glebarez/go-sqlite"

	"lazymind/core/log"
)

const (
	hybridCleanupInterval = 6 * time.Hour
	hybridRetentionDays   = 7
)

// HybridRuntimeStore combines SQLite for durable state with MemoryRuntimeStore for ephemeral state.
// Durable: ChatStatus, MultiAnswerInfo, ChatInput.
// Ephemeral: ChatChunks, CancelSignals.
type HybridRuntimeStore struct {
	db  *sql.DB
	mem *MemoryRuntimeStore

	stopOnce sync.Once
	done     chan struct{}
}

// NewHybridRuntimeStore creates a hybrid store backed by SQLite (durable) + in-memory (ephemeral).
// dsn is the SQLite database path (e.g. "./runtime.db" or the ACL_DB_DSN value).
func NewHybridRuntimeStore(dsn string) (*HybridRuntimeStore, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("hybrid store: open sqlite: %w", err)
	}

	// Set pragmas for performance and reliability.
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("hybrid store: set WAL mode: %w", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		db.Close()
		return nil, fmt.Errorf("hybrid store: set busy_timeout: %w", err)
	}

	// Create tables if not exist.
	if err := createRuntimeTables(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("hybrid store: create tables: %w", err)
	}

	// Mark any "generating" status as "interrupted" (crash recovery).
	if _, err := db.Exec(`UPDATE runtime_chat_status SET status = 'interrupted', updated_at = datetime('now') WHERE status = 'generating'`); err != nil {
		db.Close()
		return nil, fmt.Errorf("hybrid store: mark interrupted: %w", err)
	}

	s := &HybridRuntimeStore{
		db:   db,
		mem:  NewMemoryRuntimeStore(),
		done: make(chan struct{}),
	}

	go s.cleanupLoop()

	return s, nil
}

func createRuntimeTables(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS runtime_chat_status (
			conversation_id TEXT NOT NULL,
			history_id TEXT NOT NULL,
			status TEXT NOT NULL,
			current_result TEXT NOT NULL DEFAULT '',
			total_chunks INTEGER NOT NULL DEFAULT 0,
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (conversation_id, history_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_multi_answer (
			conversation_id TEXT NOT NULL,
			primary_history_id TEXT NOT NULL,
			secondary_history_id TEXT NOT NULL DEFAULT '',
			seq INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (conversation_id, primary_history_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_chat_input (
			conversation_id TEXT NOT NULL,
			history_id TEXT NOT NULL,
			raw_content TEXT NOT NULL,
			seq INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (conversation_id, history_id)
		)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// --- Durable operations (SQLite + memory cache) ---

func (s *HybridRuntimeStore) SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error {
	// Write to memory for fast reads by active sessions.
	if err := s.mem.SetChatStatus(ctx, conversationID, historyID, status, currentResult); err != nil {
		return err
	}

	// Get total_chunks from memory.
	chunks, _ := s.mem.GetChatChunks(ctx, conversationID, historyID)
	totalChunks := int32(len(chunks))

	// Persist to SQLite.
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO runtime_chat_status (conversation_id, history_id, status, current_result, total_chunks, updated_at)
		 VALUES (?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(conversation_id, history_id) DO UPDATE SET
		   status = excluded.status,
		   current_result = excluded.current_result,
		   total_chunks = excluded.total_chunks,
		   updated_at = excluded.updated_at`,
		conversationID, historyID, status, currentResult, totalChunks,
	)
	return err
}

func (s *HybridRuntimeStore) GetChatStatus(ctx context.Context, conversationID, historyID string) (*ChatStatus, error) {
	// Try memory first (active sessions).
	st, err := s.mem.GetChatStatus(ctx, conversationID, historyID)
	if err == nil {
		return st, nil
	}

	// Fall back to SQLite.
	var status, currentResult string
	var totalChunks int32
	var updatedAt string
	err = s.db.QueryRowContext(ctx,
		`SELECT status, current_result, total_chunks, updated_at FROM runtime_chat_status WHERE conversation_id = ? AND history_id = ?`,
		conversationID, historyID,
	).Scan(&status, &currentResult, &totalChunks, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("not found")
		}
		return nil, err
	}

	var lastUpdate int64
	if t, parseErr := time.Parse("2006-01-02 15:04:05", updatedAt); parseErr == nil {
		lastUpdate = t.Unix()
	}

	return &ChatStatus{
		Status:        status,
		CurrentResult: currentResult,
		LastUpdate:    lastUpdate,
		TotalChunks:   totalChunks,
	}, nil
}

func (s *HybridRuntimeStore) GetGeneratingHistoryIDs(ctx context.Context, conversationID string) ([]string, error) {
	// Check memory first.
	memIDs, _ := s.mem.GetGeneratingHistoryIDs(ctx, conversationID)

	// Also check SQLite for durable generating records.
	rows, err := s.db.QueryContext(ctx,
		`SELECT history_id FROM runtime_chat_status WHERE conversation_id = ? AND status = 'generating'`,
		conversationID,
	)
	if err != nil {
		// If SQLite fails, return memory results.
		return memIDs, nil
	}
	defer rows.Close()

	idSet := make(map[string]struct{})
	for _, id := range memIDs {
		idSet[id] = struct{}{}
	}
	for rows.Next() {
		var hid string
		if rows.Scan(&hid) == nil {
			idSet[hid] = struct{}{}
		}
	}

	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *HybridRuntimeStore) SetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error {
	// Write to memory.
	if err := s.mem.SetMultiAnswerInfo(ctx, conversationID, primaryHistoryID, secondaryHistoryID, seq); err != nil {
		return err
	}

	// Persist to SQLite.
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO runtime_multi_answer (conversation_id, primary_history_id, secondary_history_id, seq, created_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(conversation_id, primary_history_id) DO UPDATE SET
		   secondary_history_id = excluded.secondary_history_id,
		   seq = excluded.seq,
		   created_at = excluded.created_at`,
		conversationID, primaryHistoryID, secondaryHistoryID, seq,
	)
	return err
}

func (s *HybridRuntimeStore) GetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error) {
	// Try memory first.
	info, err := s.mem.GetMultiAnswerInfo(ctx, conversationID, primaryHistoryID)
	if err == nil {
		return info, nil
	}

	// Fall back to SQLite.
	var secondaryHistoryID string
	var seq int
	var createdAt string
	err = s.db.QueryRowContext(ctx,
		`SELECT secondary_history_id, seq, created_at FROM runtime_multi_answer WHERE conversation_id = ? AND primary_history_id = ?`,
		conversationID, primaryHistoryID,
	).Scan(&secondaryHistoryID, &seq, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("not found")
		}
		return nil, err
	}

	var created int64
	if t, parseErr := time.Parse("2006-01-02 15:04:05", createdAt); parseErr == nil {
		created = t.Unix()
	}

	return &MultiAnswerInfo{
		PrimaryHistoryID:   primaryHistoryID,
		SecondaryHistoryID: secondaryHistoryID,
		Seq:                seq,
		CreatedAt:          created,
	}, nil
}

func (s *HybridRuntimeStore) SetChatInput(ctx context.Context, conversationID, historyID, rawContent string, seq int) error {
	// Write to memory.
	if err := s.mem.SetChatInput(ctx, conversationID, historyID, rawContent, seq); err != nil {
		return err
	}

	// Persist to SQLite.
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO runtime_chat_input (conversation_id, history_id, raw_content, seq, created_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(conversation_id, history_id) DO UPDATE SET
		   raw_content = excluded.raw_content,
		   seq = excluded.seq,
		   created_at = excluded.created_at`,
		conversationID, historyID, rawContent, seq,
	)
	return err
}

func (s *HybridRuntimeStore) GetChatInput(ctx context.Context, conversationID, historyID string) (*ChatInput, error) {
	// Try memory first.
	input, err := s.mem.GetChatInput(ctx, conversationID, historyID)
	if err == nil {
		return input, nil
	}

	// Fall back to SQLite.
	var rawContent string
	var seq int
	var createdAt string
	err = s.db.QueryRowContext(ctx,
		`SELECT raw_content, seq, created_at FROM runtime_chat_input WHERE conversation_id = ? AND history_id = ?`,
		conversationID, historyID,
	).Scan(&rawContent, &seq, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("not found")
		}
		return nil, err
	}

	var created int64
	if t, parseErr := time.Parse("2006-01-02 15:04:05", createdAt); parseErr == nil {
		created = t.UnixMilli()
	}

	return &ChatInput{
		RawContent: rawContent,
		Seq:        seq,
		CreatedAt:  created,
	}, nil
}

// --- Ephemeral operations (delegated to MemoryRuntimeStore) ---

func (s *HybridRuntimeStore) AppendChatChunk(ctx context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error {
	return s.mem.AppendChatChunk(ctx, conversationID, historyID, chunk)
}

func (s *HybridRuntimeStore) GetChatChunks(ctx context.Context, conversationID, historyID string) ([]*ChatChunkResponse, error) {
	return s.mem.GetChatChunks(ctx, conversationID, historyID)
}

func (s *HybridRuntimeStore) GetChatChunksFrom(ctx context.Context, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error) {
	return s.mem.GetChatChunksFrom(ctx, conversationID, historyID, from)
}

func (s *HybridRuntimeStore) WatchChatChunks(ctx context.Context, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error {
	return s.mem.WatchChatChunks(ctx, conversationID, historyID, lastIndex, callback)
}

func (s *HybridRuntimeStore) SetChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
	return s.mem.SetChatCancelSignal(ctx, conversationID, historyID)
}

func (s *HybridRuntimeStore) WatchChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
	return s.mem.WatchChatCancelSignal(ctx, conversationID, historyID)
}

// --- ClearChatData clears both durable and ephemeral state ---

func (s *HybridRuntimeStore) ClearChatData(ctx context.Context, conversationID, historyID string) error {
	// Clear memory.
	if err := s.mem.ClearChatData(ctx, conversationID, historyID); err != nil {
		return err
	}

	// Clear SQLite.
	_, err := s.db.ExecContext(ctx, `DELETE FROM runtime_chat_status WHERE conversation_id = ? AND history_id = ?`, conversationID, historyID)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM runtime_chat_input WHERE conversation_id = ? AND history_id = ?`, conversationID, historyID)
	if err != nil {
		return err
	}
	return nil
}

// --- Lifecycle ---

func (s *HybridRuntimeStore) Close() error {
	s.stopOnce.Do(func() {
		close(s.done)
	})
	s.mem.Close()
	return s.db.Close()
}

func (s *HybridRuntimeStore) cleanupLoop() {
	ticker := time.NewTicker(hybridCleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.done:
			return
		case <-ticker.C:
			s.cleanupOldRecords()
		}
	}
}

func (s *HybridRuntimeStore) cleanupOldRecords() {
	cutoff := time.Now().AddDate(0, 0, -hybridRetentionDays).Format("2006-01-02 15:04:05")

	if _, err := s.db.Exec(`DELETE FROM runtime_chat_status WHERE updated_at < ?`, cutoff); err != nil {
		log.Logger.Warn().Err(err).Msg("hybrid store: cleanup chat_status failed")
	}
	if _, err := s.db.Exec(`DELETE FROM runtime_multi_answer WHERE created_at < ?`, cutoff); err != nil {
		log.Logger.Warn().Err(err).Msg("hybrid store: cleanup multi_answer failed")
	}
	if _, err := s.db.Exec(`DELETE FROM runtime_chat_input WHERE created_at < ?`, cutoff); err != nil {
		log.Logger.Warn().Err(err).Msg("hybrid store: cleanup chat_input failed")
	}
}

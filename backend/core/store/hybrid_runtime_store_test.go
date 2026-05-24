package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func tempDBPath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "test_runtime.db")
}

func TestHybridRuntimeStore_SetGetChatStatus(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	// Set a status.
	if err := s.SetChatStatus(ctx, "conv1", "hist1", "generating", "partial result"); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}

	// Get from memory (fast path).
	st, err := s.GetChatStatus(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatStatus: %v", err)
	}
	if st.Status != "generating" {
		t.Errorf("status = %q, want %q", st.Status, "generating")
	}
	if st.CurrentResult != "partial result" {
		t.Errorf("current_result = %q, want %q", st.CurrentResult, "partial result")
	}
}

func TestHybridRuntimeStore_GeneratingBecomesInterrupted(t *testing.T) {
	dbPath := tempDBPath(t)

	// First store: set a generating status.
	s1, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new store 1: %v", err)
	}
	ctx := context.Background()
	if err := s1.SetChatStatus(ctx, "conv1", "hist1", "generating", ""); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}
	s1.Close()

	// Second store: "generating" should become "interrupted".
	s2, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new store 2: %v", err)
	}
	defer s2.Close()

	st, err := s2.GetChatStatus(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatStatus after reopen: %v", err)
	}
	if st.Status != "interrupted" {
		t.Errorf("status = %q, want %q", st.Status, "interrupted")
	}
}

func TestHybridRuntimeStore_EphemeralChunksNotPersisted(t *testing.T) {
	dbPath := tempDBPath(t)

	// First store: append chunks.
	s1, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new store 1: %v", err)
	}
	ctx := context.Background()
	chunk := &ChatChunkResponse{ConversationID: "conv1", HistoryID: "hist1", Seq: 1, Delta: "hello"}
	if err := s1.AppendChatChunk(ctx, "conv1", "hist1", chunk); err != nil {
		t.Fatalf("AppendChatChunk: %v", err)
	}

	// Verify chunks exist in memory.
	chunks, err := s1.GetChatChunks(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatChunks: %v", err)
	}
	if len(chunks) != 1 {
		t.Fatalf("chunks len = %d, want 1", len(chunks))
	}
	s1.Close()

	// Second store: chunks should be gone (ephemeral).
	s2, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new store 2: %v", err)
	}
	defer s2.Close()

	chunks, err = s2.GetChatChunks(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatChunks after reopen: %v", err)
	}
	if len(chunks) != 0 {
		t.Errorf("chunks len = %d, want 0 (ephemeral should not persist)", len(chunks))
	}
}

func TestHybridRuntimeStore_MultiAnswerInfoRoundTrip(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	if err := s.SetMultiAnswerInfo(ctx, "conv1", "primary1", "secondary1", 42); err != nil {
		t.Fatalf("SetMultiAnswerInfo: %v", err)
	}

	info, err := s.GetMultiAnswerInfo(ctx, "conv1", "primary1")
	if err != nil {
		t.Fatalf("GetMultiAnswerInfo: %v", err)
	}
	if info.PrimaryHistoryID != "primary1" {
		t.Errorf("PrimaryHistoryID = %q, want %q", info.PrimaryHistoryID, "primary1")
	}
	if info.SecondaryHistoryID != "secondary1" {
		t.Errorf("SecondaryHistoryID = %q, want %q", info.SecondaryHistoryID, "secondary1")
	}
	if info.Seq != 42 {
		t.Errorf("Seq = %d, want %d", info.Seq, 42)
	}

	// Verify persistence after reopen.
	s.Close()
	s2, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()

	info2, err := s2.GetMultiAnswerInfo(ctx, "conv1", "primary1")
	if err != nil {
		t.Fatalf("GetMultiAnswerInfo after reopen: %v", err)
	}
	if info2.SecondaryHistoryID != "secondary1" || info2.Seq != 42 {
		t.Errorf("after reopen: SecondaryHistoryID=%q Seq=%d, want secondary1/42", info2.SecondaryHistoryID, info2.Seq)
	}
}

func TestHybridRuntimeStore_ChatInputRoundTrip(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	if err := s.SetChatInput(ctx, "conv1", "hist1", "hello world", 7); err != nil {
		t.Fatalf("SetChatInput: %v", err)
	}

	input, err := s.GetChatInput(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatInput: %v", err)
	}
	if input.RawContent != "hello world" {
		t.Errorf("RawContent = %q, want %q", input.RawContent, "hello world")
	}
	if input.Seq != 7 {
		t.Errorf("Seq = %d, want %d", input.Seq, 7)
	}

	// Verify persistence after reopen.
	s.Close()
	s2, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()

	input2, err := s2.GetChatInput(ctx, "conv1", "hist1")
	if err != nil {
		t.Fatalf("GetChatInput after reopen: %v", err)
	}
	if input2.RawContent != "hello world" || input2.Seq != 7 {
		t.Errorf("after reopen: RawContent=%q Seq=%d, want 'hello world'/7", input2.RawContent, input2.Seq)
	}
}

func TestHybridRuntimeStore_CleanupOldRecords(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	// Insert a record with an old timestamp (10 days ago).
	oldTime := time.Now().AddDate(0, 0, -10).Format("2006-01-02 15:04:05")
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO runtime_chat_status (conversation_id, history_id, status, current_result, total_chunks, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		"old_conv", "old_hist", "completed", "", 0, oldTime,
	)
	if err != nil {
		t.Fatalf("insert old record: %v", err)
	}

	// Insert a recent record.
	if err := s.SetChatStatus(ctx, "new_conv", "new_hist", "completed", ""); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}

	// Run cleanup.
	s.cleanupOldRecords()

	// Old record should be gone.
	_, err = s.GetChatStatus(ctx, "old_conv", "old_hist")
	if err == nil {
		t.Error("expected old record to be cleaned up, but it still exists")
	}

	// New record should still be there.
	st, err := s.GetChatStatus(ctx, "new_conv", "new_hist")
	if err != nil {
		t.Fatalf("GetChatStatus for new record: %v", err)
	}
	if st.Status != "completed" {
		t.Errorf("new record status = %q, want %q", st.Status, "completed")
	}
}

func TestHybridRuntimeStore_ClearChatData(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	// Set status and input.
	if err := s.SetChatStatus(ctx, "conv1", "hist1", "completed", "result"); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}
	if err := s.SetChatInput(ctx, "conv1", "hist1", "input text", 1); err != nil {
		t.Fatalf("SetChatInput: %v", err)
	}

	// Clear.
	if err := s.ClearChatData(ctx, "conv1", "hist1"); err != nil {
		t.Fatalf("ClearChatData: %v", err)
	}

	// Both should be gone.
	_, err = s.GetChatStatus(ctx, "conv1", "hist1")
	if err == nil {
		t.Error("expected GetChatStatus to fail after ClearChatData")
	}
	_, err = s.GetChatInput(ctx, "conv1", "hist1")
	if err == nil {
		t.Error("expected GetChatInput to fail after ClearChatData")
	}
}

func TestHybridRuntimeStore_GetGeneratingHistoryIDs(t *testing.T) {
	dbPath := tempDBPath(t)
	s, err := NewHybridRuntimeStore(dbPath)
	if err != nil {
		t.Fatalf("new hybrid store: %v", err)
	}
	defer s.Close()

	ctx := context.Background()

	// Create some statuses.
	if err := s.SetChatStatus(ctx, "conv1", "hist1", "generating", ""); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}
	if err := s.SetChatStatus(ctx, "conv1", "hist2", "completed", ""); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}
	if err := s.SetChatStatus(ctx, "conv1", "hist3", "generating", ""); err != nil {
		t.Fatalf("SetChatStatus: %v", err)
	}

	ids, err := s.GetGeneratingHistoryIDs(ctx, "conv1")
	if err != nil {
		t.Fatalf("GetGeneratingHistoryIDs: %v", err)
	}

	if len(ids) != 2 {
		t.Fatalf("ids len = %d, want 2", len(ids))
	}

	idSet := map[string]bool{}
	for _, id := range ids {
		idSet[id] = true
	}
	if !idSet["hist1"] || !idSet["hist3"] {
		t.Errorf("ids = %v, want hist1 and hist3", ids)
	}
}


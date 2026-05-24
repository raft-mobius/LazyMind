package segment

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func tempDB(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "segment_test.db")
}

func TestInsertAndSearch(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	seg := &Segment{
		ID:      "seg1",
		UserID:  "user1",
		DocID:   "doc1",
		ChunkID: "chunk1",
		Content: "Go is a statically typed compiled programming language",
		Title:   "About Go",
		Source:  "/docs/go.md",
	}

	if err := store.Insert(ctx, seg); err != nil {
		t.Fatal(err)
	}

	results, err := store.Search(ctx, "user1", "programming language", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].ID != "seg1" {
		t.Errorf("expected seg1, got %s", results[0].ID)
	}
}

func TestInsertBatch(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	segments := []*Segment{
		{ID: "s1", UserID: "u1", DocID: "d1", ChunkID: "c1", Content: "alpha beta gamma"},
		{ID: "s2", UserID: "u1", DocID: "d1", ChunkID: "c2", Content: "delta epsilon zeta"},
		{ID: "s3", UserID: "u1", DocID: "d2", ChunkID: "c3", Content: "alpha omega"},
	}

	if err := store.InsertBatch(ctx, segments); err != nil {
		t.Fatal(err)
	}

	count, err := store.Count(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("expected 3, got %d", count)
	}
}

func TestDeleteByDoc(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	segments := []*Segment{
		{ID: "s1", UserID: "u1", DocID: "d1", ChunkID: "c1", Content: "hello world"},
		{ID: "s2", UserID: "u1", DocID: "d1", ChunkID: "c2", Content: "hello again"},
		{ID: "s3", UserID: "u1", DocID: "d2", ChunkID: "c3", Content: "different doc"},
	}
	store.InsertBatch(ctx, segments)

	n, err := store.DeleteByDoc(ctx, "u1", "d1")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("expected 2 deleted, got %d", n)
	}

	count, _ := store.Count(ctx, "u1")
	if count != 1 {
		t.Fatalf("expected 1 remaining, got %d", count)
	}
}

func TestUserIsolation(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	store.Insert(ctx, &Segment{ID: "s1", UserID: "u1", DocID: "d1", ChunkID: "c1", Content: "secret data for user1"})
	store.Insert(ctx, &Segment{ID: "s2", UserID: "u2", DocID: "d1", ChunkID: "c1", Content: "secret data for user2"})

	results, err := store.Search(ctx, "u1", "secret data", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for u1, got %d", len(results))
	}
	if results[0].UserID != "u1" {
		t.Error("wrong user in results")
	}
}

func TestDeleteByUser(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	store.Insert(ctx, &Segment{ID: "s1", UserID: "u1", DocID: "d1", ChunkID: "c1", Content: "data1"})
	store.Insert(ctx, &Segment{ID: "s2", UserID: "u1", DocID: "d2", ChunkID: "c2", Content: "data2"})
	store.Insert(ctx, &Segment{ID: "s3", UserID: "u2", DocID: "d1", ChunkID: "c1", Content: "other"})

	n, err := store.DeleteByUser(ctx, "u1")
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("expected 2 deleted, got %d", n)
	}

	count, _ := store.Count(ctx, "u2")
	if count != 1 {
		t.Fatalf("expected 1 for u2, got %d", count)
	}
}

func TestSearchNoResults(t *testing.T) {
	store, err := NewSQLiteSegmentStore(tempDB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	results, err := store.Search(context.Background(), "nobody", "anything", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("expected 0, got %d", len(results))
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}

package segment

import (
	"context"
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"
)

func BenchmarkSearch10K(b *testing.B) {
	dbPath := filepath.Join(b.TempDir(), "bench_segment.db")
	store, err := NewSQLiteSegmentStore(dbPath)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	userID := "bench_user"

	// Insert 10K segments
	b.Log("Inserting 10K segments...")
	batch := make([]*Segment, 0, 1000)
	for i := 0; i < 10000; i++ {
		batch = append(batch, &Segment{
			ID:      fmt.Sprintf("seg_%d", i),
			UserID:  userID,
			DocID:   fmt.Sprintf("doc_%d", i/100),
			ChunkID: fmt.Sprintf("chunk_%d", i),
			Content: generateContent(i),
			Title:   fmt.Sprintf("Document Section %d", i),
			Source:  fmt.Sprintf("/docs/file_%d.md", i/100),
		})
		if len(batch) == 1000 {
			if err := store.InsertBatch(ctx, batch); err != nil {
				b.Fatal(err)
			}
			batch = batch[:0]
		}
	}

	queries := []string{
		"machine learning",
		"software engineering",
		"data processing",
		"neural network",
		"database optimization",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		query := queries[rand.Intn(len(queries))]
		results, err := store.Search(ctx, userID, query, 10)
		if err != nil {
			b.Fatal(err)
		}
		_ = results
	}
}

func generateContent(i int) string {
	topics := []string{
		"machine learning and artificial intelligence",
		"software engineering and system design",
		"data processing and analytics",
		"neural network architecture",
		"database optimization and indexing",
		"cloud computing infrastructure",
		"natural language processing",
		"computer vision applications",
		"distributed systems",
		"microservice architecture",
	}
	topic := topics[i%len(topics)]
	return fmt.Sprintf("This section covers %s. In detail, it explores concept %d "+
		"with practical examples and implementation guidelines. The approach involves "+
		"multiple techniques that have been proven effective in production environments.", topic, i)
}

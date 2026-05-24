package segment

import "context"

type Segment struct {
	ID        string
	UserID    string
	DocID     string
	ChunkID   string
	Content   string
	Title     string
	Source    string
	CreatedAt string
}

type SearchResult struct {
	Segment
	Score float64
	Rank  int
}

type SegmentStore interface {
	Insert(ctx context.Context, seg *Segment) error
	InsertBatch(ctx context.Context, segments []*Segment) error
	Search(ctx context.Context, userID, query string, limit int) ([]*SearchResult, error)
	DeleteByDoc(ctx context.Context, userID, docID string) (int64, error)
	DeleteByUser(ctx context.Context, userID string) (int64, error)
	Count(ctx context.Context, userID string) (int64, error)
	Close() error
}

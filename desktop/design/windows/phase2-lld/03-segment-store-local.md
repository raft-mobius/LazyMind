# LLD-03: SegmentStore Local Implementation

## 1. Module Overview

### 1.1 Goal

Implement a local SegmentStore backend for Desktop Mode that replaces OpenSearch. Uses SQLite FTS5 (Full-Text Search) to provide keyword-based document segment retrieval. Integrates into the existing SegmentStore interface so that Cloud mode continues using OpenSearch unchanged.

### 1.2 Scope

**Included:**
- SQLite FTS5-based full-text search implementation.
- Index creation and management for document segments.
- Keyword search with relevance scoring.
- Metadata filtering (user_id, document_id, segment type).
- Segment CRUD (index, update, delete).
- Chinese text tokenization support (using SQLite simple tokenizer or jieba via application-side).
- Integration with existing SegmentStore interface.
- Identification and convergence of direct OpenSearch API calls.

**Not Included:**
- Vector similarity search (see LLD-02 Milvus Lite).
- Document parsing logic (see LLD-04).
- OpenSearch removal from Cloud mode.

---

## 2. Interface Contracts

### 2.1 SegmentStore Interface (existing, extended)

```go
// backend/core/segment/store.go
package segment

type Segment struct {
    ID          string            `json:"id"`
    DocumentID  string            `json:"document_id"`
    UserID      string            `json:"user_id"`
    ChunkIndex  int               `json:"chunk_index"`
    Content     string            `json:"content"`
    Title       string            `json:"title"`
    SegmentType string            `json:"segment_type"`
    Metadata    map[string]string `json:"metadata"`
    CreatedAt   string            `json:"created_at"`
    UpdatedAt   string            `json:"updated_at"`
}

type SearchResult struct {
    Segment Segment `json:"segment"`
    Score   float64 `json:"score"`
}

type SearchQuery struct {
    Keywords   string   `json:"keywords"`
    UserID     string   `json:"user_id"`
    DocumentIDs []string `json:"document_ids,omitempty"`
    TopK       int      `json:"top_k"`
    Offset     int      `json:"offset"`
}

type SegmentStore interface {
    Index(ctx context.Context, segments []Segment) error
    Search(ctx context.Context, query SearchQuery) ([]SearchResult, error)
    Delete(ctx context.Context, documentID string) error
    DeleteByIDs(ctx context.Context, ids []string) error
    Count(ctx context.Context, userID string) (int64, error)
    Rebuild(ctx context.Context, userID string) error
    Close() error
}
```

### 2.2 Factory

```go
// backend/core/segment/factory.go
func NewSegmentStore(mode string, dataDir string) (SegmentStore, error) {
    switch mode {
    case "desktop":
        return NewSQLiteSegmentStore(filepath.Join(dataDir, "segment", "fts.db"))
    default:
        return NewOpenSearchSegmentStore(...)
    }
}
```

---

## 3. Dependencies

**Requires:**
- Phase 1: Data directory structure (`getDataDir().segment`).
- Existing SegmentStore interface definition (or we define it here if none exists formally).

**Depended on by:**
- LLD-04 Algorithm Pipeline (uses SegmentStore for hybrid retrieval).

---

## 4. Technical Design

### 4.1 SQLite FTS5 Schema

```sql
-- segment/fts.db

-- Main segment metadata table
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    segment_type TEXT NOT NULL DEFAULT 'text',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_segments_user ON segments(user_id);
CREATE INDEX IF NOT EXISTS idx_segments_document ON segments(document_id);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
    content,
    title,
    content='segments',
    content_rowid='rowid',
    tokenize='unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts(rowid, content, title)
    VALUES (new.rowid, new.content, new.title);
END;

CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, content, title)
    VALUES ('delete', old.rowid, old.content, old.title);
END;

CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
    INSERT INTO segments_fts(segments_fts, rowid, content, title)
    VALUES ('delete', old.rowid, old.content, old.title);
    INSERT INTO segments_fts(rowid, content, title)
    VALUES (new.rowid, new.content, new.title);
END;
```

### 4.2 SQLiteSegmentStore Implementation

```go
package segment

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "path/filepath"
    "strings"

    _ "github.com/glebarez/go-sqlite"
)

type SQLiteSegmentStore struct {
    db *sql.DB
}

func NewSQLiteSegmentStore(dbPath string) (*SQLiteSegmentStore, error) {
    db, err := sql.Open("sqlite", dbPath)
    if err != nil {
        return nil, err
    }

    // Pragmas
    db.Exec("PRAGMA journal_mode=WAL")
    db.Exec("PRAGMA busy_timeout=5000")
    db.Exec("PRAGMA foreign_keys=ON")

    // Create schema
    if err := initSchema(db); err != nil {
        return nil, err
    }

    return &SQLiteSegmentStore{db: db}, nil
}
```

### 4.3 Search Implementation

```go
func (s *SQLiteSegmentStore) Search(ctx context.Context, query SearchQuery) ([]SearchResult, error) {
    // FTS5 match query with BM25 ranking
    sqlQuery := `
        SELECT s.id, s.document_id, s.user_id, s.chunk_index,
               s.content, s.title, s.segment_type, s.metadata,
               s.created_at, s.updated_at,
               bm25(segments_fts) as score
        FROM segments_fts
        JOIN segments s ON segments_fts.rowid = s.rowid
        WHERE segments_fts MATCH ?
          AND s.user_id = ?
    `
    args := []any{buildFTSQuery(query.Keywords), query.UserID}

    if len(query.DocumentIDs) > 0 {
        placeholders := strings.Repeat("?,", len(query.DocumentIDs))
        placeholders = placeholders[:len(placeholders)-1]
        sqlQuery += fmt.Sprintf(" AND s.document_id IN (%s)", placeholders)
        for _, did := range query.DocumentIDs {
            args = append(args, did)
        }
    }

    sqlQuery += " ORDER BY score LIMIT ? OFFSET ?"
    args = append(args, query.TopK, query.Offset)

    rows, err := s.db.QueryContext(ctx, sqlQuery, args...)
    // ... parse rows into SearchResult
}

func buildFTSQuery(keywords string) string {
    // Tokenize and build FTS5 query
    // Handle Chinese: split into individual characters or use phrase matching
    words := strings.Fields(keywords)
    if len(words) == 0 {
        return ""
    }
    // Use OR between words for broad matching
    parts := make([]string, len(words))
    for i, w := range words {
        parts[i] = fmt.Sprintf(`"%s"`, strings.ReplaceAll(w, `"`, `""`))
    }
    return strings.Join(parts, " OR ")
}
```

### 4.4 Chinese Text Search Strategy

FTS5 `unicode61` tokenizer handles CJK characters by treating each character as a token. This provides character-level matching which works adequately for Chinese:

- Query "太阳系" matches any content containing 太, 阳, 系.
- For better phrase matching, use FTS5 phrase queries: `"太阳系"`.
- Application-side: if query contains CJK, wrap in quotes for phrase match.

For improved Chinese tokenization (optional enhancement):
- Use jieba segmentation at index time to add space-separated tokens.
- Store segmented content in FTS table alongside original.
- This is an optimization, not MVP-blocking.

### 4.5 Index Operation

```go
func (s *SQLiteSegmentStore) Index(ctx context.Context, segments []Segment) error {
    tx, err := s.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    stmt, err := tx.PrepareContext(ctx, `
        INSERT OR REPLACE INTO segments
        (id, document_id, user_id, chunk_index, content, title, segment_type, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    if err != nil {
        return err
    }
    defer stmt.Close()

    for _, seg := range segments {
        metaJSON, _ := json.Marshal(seg.Metadata)
        _, err := stmt.ExecContext(ctx, seg.ID, seg.DocumentID, seg.UserID,
            seg.ChunkIndex, seg.Content, seg.Title, seg.SegmentType,
            string(metaJSON), seg.CreatedAt)
        if err != nil {
            return err
        }
    }

    return tx.Commit()
}
```

### 4.6 Rebuild Operation

```go
func (s *SQLiteSegmentStore) Rebuild(ctx context.Context, userID string) error {
    // Delete all segments for user
    _, err := s.db.ExecContext(ctx, "DELETE FROM segments WHERE user_id = ?", userID)
    if err != nil {
        return err
    }
    // FTS triggers handle cleanup automatically
    // Caller must re-index all documents for this user
    return nil
}
```

### 4.7 Convergence of Direct OpenSearch Calls

Identify and wrap all direct OpenSearch API calls in existing codebase:

1. Grep for `opensearch`, `elasticsearch` client usage.
2. Each call site should go through `SegmentStore` interface.
3. If call requires capabilities not in interface, extend interface.
4. Tag non-converged call sites with `// TODO: converge to SegmentStore`.

---

## 5. File Manifest

### New Files
- `backend/core/segment/store.go` — Interface definition
- `backend/core/segment/sqlite_store.go` — SQLite FTS5 implementation
- `backend/core/segment/opensearch_store.go` — Wrapper around existing OpenSearch code
- `backend/core/segment/factory.go` — Mode-based factory
- `backend/core/segment/schema.sql` — FTS5 schema
- `tests/backend/core/segment/sqlite_store_test.go`

### Modified Files
- `backend/core/main.go` — Initialize SegmentStore from factory
- `backend/core/store/store.go` — Add SegmentStore to global store
- Existing code calling OpenSearch directly → route through SegmentStore

---

## 6. Configuration & Environment Variables

| Variable | Service | Value |
|----------|---------|-------|
| `LAZYMIND_SEGMENT_BACKEND` | core | `sqlite` (Desktop) / `opensearch` (Cloud) |
| `LAZYMIND_SEGMENT_DB_PATH` | core | `{dataDir}/segment/fts.db` |
| `OPENSEARCH_URL` | core (Cloud only) | existing OpenSearch URL |

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| FTS5 not available in SQLite build | Fatal error on startup (should never happen with bundled sqlite) |
| FTS index corruption | Rebuild FTS table using `INSERT INTO segments_fts(segments_fts) VALUES('rebuild')` |
| Search query syntax error | Escape special FTS characters, return empty results |
| DB file locked | busy_timeout handles; if persistent, log warning |

---

## 8. Security Considerations

- FTS database file has same access restrictions as other data dir files.
- Search queries are parameterized (no SQL injection).
- Content stored in FTS is document text — same sensitivity as original documents.
- FTS DB excluded from diagnostics export by default.

---

## 9. Testing Strategy

### Unit Tests
- Index 10 segments → search by keyword → verify correct results returned.
- Delete by document_id → verify segments removed from search.
- User isolation: user A's segments not found by user B's search.
- BM25 scoring: more relevant results ranked higher.
- Chinese text search: character-level matching works.
- Empty query returns empty results (no crash).

### Integration Tests
- Parse document → segment → index → search → verify full chain.
- Rebuild: delete all user segments → re-index → search works.
- Multiple documents: search returns results from correct documents only.
- Large corpus: 10,000 segments, search still fast (<500ms).

### Behavioral Comparison Tests
- Define a set of queries and expected results.
- Run against both SQLite FTS5 and OpenSearch implementations.
- Results don't need to be identical but should overlap significantly (>70% top-10 overlap).

---

## 10. Cloud Mode Compatibility

- OpenSearch implementation wraps existing code, no behavior change.
- Factory selects based on `LAZYMIND_SEGMENT_BACKEND` env var.
- Default (no env var) = OpenSearch (Cloud behavior unchanged).
- No new dependencies for Cloud builds.

---

## 11. Acceptance Criteria

- [ ] SQLiteSegmentStore implements full SegmentStore interface.
- [ ] FTS5 search returns relevant results for keyword queries.
- [ ] Chinese text search works (character-level at minimum).
- [ ] User data isolation: search scoped by user_id.
- [ ] Document deletion removes all associated segments from FTS.
- [ ] Rebuild operation works and re-indexing restores search.
- [ ] Performance: search <500ms for 10K segments.
- [ ] Data persists across application restart.
- [ ] Cloud OpenSearch mode unchanged.
- [ ] Direct OpenSearch calls identified and documented (convergence plan).

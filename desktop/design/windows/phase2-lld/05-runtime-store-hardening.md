# LLD-05: Runtime Store Hardening

## 1. Module Overview

### 1.1 Goal

Harden the Phase 1 in-memory RuntimeStore by persisting critical state to SQLite (`main.db`), ensuring chat sessions survive application restart. Maintain the existing `RuntimeStore` interface while adding durability for state that users expect to be preserved.

### 1.2 Scope

**Included:**
- Persist chat status (generating/completed/failed) to survive restart.
- Persist chat history association (which history_id belongs to which conversation).
- Keep streaming chunks in-memory only (ephemeral, not worth persisting).
- Keep cancel signals in-memory only (ephemeral).
- Define clear boundary: what must survive restart vs. what is ephemeral.
- Implement hybrid store: SQLite for durable state + memory for ephemeral state.
- Recovery on restart: detect interrupted chats, mark as failed.

**Not Included:**
- Redis behavior changes (Cloud mode unchanged).
- Token store for auth-service (Desktop is token-free by design).
- Milvus Lite persistence (handled by LLD-02).

---

## 2. Interface Contracts

### 2.1 RuntimeStore Interface (unchanged from Phase 1)

```go
type RuntimeStore interface {
    SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error
    GetChatStatus(ctx context.Context, conversationID, historyID string) (*ChatStatus, error)
    GetGeneratingHistoryIDs(ctx context.Context, conversationID string) ([]string, error)
    ClearChatData(ctx context.Context, conversationID, historyID string) error

    AppendChatChunk(ctx context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error
    GetChatChunks(ctx context.Context, conversationID, historyID string) ([]*ChatChunkResponse, error)
    GetChatChunksFrom(ctx context.Context, conversationID, historyID string, from int64) ([]*ChatChunkResponse, error)
    WatchChatChunks(ctx context.Context, conversationID, historyID string, lastIndex int64, callback func(*ChatChunkResponse) error) error

    SetChatCancelSignal(ctx context.Context, conversationID, historyID string) error
    WatchChatCancelSignal(ctx context.Context, conversationID, historyID string) error

    SetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID, secondaryHistoryID string, seq int) error
    GetMultiAnswerInfo(ctx context.Context, conversationID, primaryHistoryID string) (*MultiAnswerInfo, error)

    SetChatInput(ctx context.Context, conversationID, historyID, rawContent string, seq int) error
    GetChatInput(ctx context.Context, conversationID, historyID string) (*ChatInput, error)

    Close() error
}
```

### 2.2 Durability Classification

| Operation | Phase 1 | Phase 2 | Reason |
|-----------|---------|---------|--------|
| SetChatStatus | Memory | **SQLite** | Users expect to see if a chat completed/failed after restart |
| GetChatStatus | Memory | **SQLite** | Read durable state |
| AppendChatChunk | Memory | Memory | Ephemeral streaming data, too high write volume |
| GetChatChunks | Memory | Memory | Only useful during active stream |
| WatchChatChunks | Memory | Memory | Real-time only |
| SetChatCancelSignal | Memory | Memory | Ephemeral signal |
| WatchChatCancelSignal | Memory | Memory | Ephemeral signal |
| SetMultiAnswerInfo | Memory | **SQLite** | Association should survive restart |
| GetMultiAnswerInfo | Memory | **SQLite** | Read durable state |
| SetChatInput | Memory | **SQLite** | Retry requires knowing original input |
| GetChatInput | Memory | **SQLite** | Read durable state |

---

## 3. Dependencies

**Requires:**
- Phase 1: `MemoryRuntimeStore` and `RuntimeStore` interface.
- LLD-01: `main.db` available with WAL mode.

**Depended on by:**
- LLD-04 Algorithm Pipeline (chat state persistence).

---

## 4. Technical Design

### 4.1 HybridRuntimeStore

```go
// backend/core/store/hybrid_runtime_store.go
type HybridRuntimeStore struct {
    mem   *MemoryRuntimeStore  // ephemeral: chunks, signals
    db    *sql.DB              // durable: status, multi-answer, input
}

func NewHybridRuntimeStore(dbPath string) (*HybridRuntimeStore, error) {
    db, err := sql.Open("sqlite", dbPath)
    if err != nil {
        return nil, err
    }
    db.Exec("PRAGMA journal_mode=WAL")
    db.Exec("PRAGMA busy_timeout=5000")

    if err := initRuntimeTables(db); err != nil {
        return nil, err
    }

    // Recover: mark any "generating" status as "interrupted"
    db.Exec(`UPDATE runtime_chat_status SET status='interrupted' WHERE status='generating'`)

    return &HybridRuntimeStore{
        mem: NewMemoryRuntimeStore(),
        db:  db,
    }, nil
}
```

### 4.2 SQLite Schema for Runtime State

```sql
-- Stored in main.db (core's DB)

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

-- Auto-cleanup: delete records older than 7 days on startup
-- (prevents unbounded growth)
```

### 4.3 Durable Operations Implementation

```go
func (h *HybridRuntimeStore) SetChatStatus(ctx context.Context, conversationID, historyID, status, currentResult string) error {
    // Also write to memory for fast reads during active streaming
    h.mem.SetChatStatus(ctx, conversationID, historyID, status, currentResult)

    // Persist to SQLite
    _, err := h.db.ExecContext(ctx, `
        INSERT OR REPLACE INTO runtime_chat_status
        (conversation_id, history_id, status, current_result, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
    `, conversationID, historyID, status, currentResult)
    return err
}

func (h *HybridRuntimeStore) GetChatStatus(ctx context.Context, conversationID, historyID string) (*ChatStatus, error) {
    // Try memory first (active sessions)
    st, err := h.mem.GetChatStatus(ctx, conversationID, historyID)
    if err == nil {
        return st, nil
    }

    // Fall back to SQLite (recovered sessions)
    var status ChatStatus
    err = h.db.QueryRowContext(ctx, `
        SELECT status, current_result, total_chunks
        FROM runtime_chat_status
        WHERE conversation_id = ? AND history_id = ?
    `, conversationID, historyID).Scan(&status.Status, &status.CurrentResult, &status.TotalChunks)
    if err != nil {
        return nil, err
    }
    return &status, nil
}
```

### 4.4 Ephemeral Operations (Delegate to Memory)

```go
func (h *HybridRuntimeStore) AppendChatChunk(ctx context.Context, conversationID, historyID string, chunk *ChatChunkResponse) error {
    return h.mem.AppendChatChunk(ctx, conversationID, historyID, chunk)
}

func (h *HybridRuntimeStore) SetChatCancelSignal(ctx context.Context, conversationID, historyID string) error {
    return h.mem.SetChatCancelSignal(ctx, conversationID, historyID)
}
```

### 4.5 Startup Recovery

On application startup:
1. Mark all "generating" records as "interrupted".
2. Frontend detects "interrupted" status and shows message: "该对话因应用重启中断。"
3. User can retry the interrupted message.

### 4.6 Cleanup Strategy

```go
func (h *HybridRuntimeStore) cleanup() {
    // Delete records older than 7 days
    h.db.Exec(`DELETE FROM runtime_chat_status WHERE updated_at < datetime('now', '-7 days')`)
    h.db.Exec(`DELETE FROM runtime_multi_answer WHERE created_at < datetime('now', '-7 days')`)
    h.db.Exec(`DELETE FROM runtime_chat_input WHERE created_at < datetime('now', '-7 days')`)
}
```

Run cleanup once on startup and periodically (every 6 hours).

### 4.7 Factory Update

```go
// backend/core/store/runtime_store_factory.go
func NewRuntimeStore(redisClient *redis.Client) RuntimeStore {
    backend := os.Getenv("LAZYMIND_STATE_BACKEND")
    switch backend {
    case "hybrid":
        dbPath := os.Getenv("ACL_DB_DSN") // reuse main.db
        store, err := NewHybridRuntimeStore(dbPath)
        if err != nil {
            log.Logger.Warn().Err(err).Msg("HybridRuntimeStore init failed, falling back to memory")
            return NewMemoryRuntimeStore()
        }
        return store
    case "memory":
        return NewMemoryRuntimeStore()
    default:
        // Redis (Cloud mode)
        ...
    }
}
```

Phase 2 Desktop default: `LAZYMIND_STATE_BACKEND=hybrid`.

---

## 5. File Manifest

### New Files
- `backend/core/store/hybrid_runtime_store.go`
- `backend/core/store/hybrid_runtime_store_test.go`
- `backend/core/migrations/sqlite/20260202000000_runtime_tables.up.sql`
- `backend/core/migrations/sqlite/20260202000000_runtime_tables.down.sql`

### Modified Files
- `backend/core/store/runtime_store_factory.go` — Add "hybrid" case
- `desktop/src/main/process-manager/configs.ts` — Change `LAZYMIND_STATE_BACKEND` from "memory" to "hybrid"

---

## 6. Configuration & Environment Variables

| Variable | Service | Phase 1 Value | Phase 2 Value |
|----------|---------|---------------|---------------|
| `LAZYMIND_STATE_BACKEND` | core | `memory` | `hybrid` |

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| SQLite write fails during SetChatStatus | Log error, fall back to memory-only (degrade gracefully) |
| Startup recovery finds "generating" records | Mark as "interrupted", log count |
| Cleanup fails | Log warning, retry next cycle |
| main.db locked during runtime write | busy_timeout handles; if persistent, log warning |

---

## 8. Security Considerations

- Runtime state in main.db has same access protections.
- Chat input content (raw_content) stored in DB — same sensitivity as chat history.
- No secrets stored in runtime tables.
- Cleanup prevents unbounded data accumulation.

---

## 9. Testing Strategy

### Unit Tests
- SetChatStatus → restart → GetChatStatus returns persisted value.
- "generating" on restart → becomes "interrupted".
- AppendChatChunk → restart → GetChatChunks returns empty (not persisted).
- Cleanup removes records older than 7 days.
- Concurrent SetChatStatus calls don't deadlock.

### Integration Tests
- Chat flow: start → stream chunks → complete → restart → status = "completed".
- Interrupted flow: start → kill process → restart → status = "interrupted".
- Multi-answer: set info → restart → get info returns correct data.
- Memory operations: cancel signal, chunks → ephemeral, gone after restart.

---

## 10. Cloud Mode Compatibility

- Cloud continues using `LAZYMIND_STATE_BACKEND=redis` (or empty = redis).
- No changes to `RedisRuntimeStore`.
- `HybridRuntimeStore` only instantiated when backend=hybrid.

---

## 11. Acceptance Criteria

- [ ] Chat status persists across application restart.
- [ ] "generating" status becomes "interrupted" on recovery.
- [ ] Multi-answer info persists across restart.
- [ ] Chat input persists across restart (for retry).
- [ ] Streaming chunks are NOT persisted (memory only).
- [ ] Cancel signals are NOT persisted (memory only).
- [ ] Cleanup removes stale records (>7 days).
- [ ] No performance regression vs Phase 1 memory-only store.
- [ ] Cloud Redis mode unchanged.

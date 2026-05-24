# LLD-01: SQLite Complete Migration

## 1. Module Overview

### 1.1 Goal

Complete the SQLite migration for all backend services so that Desktop Mode runs entirely on SQLite with zero PostgreSQL dependency. Phase 1 delivered minimum viable tables for core and auth-service. Phase 2 migrates every remaining table, handles all PG-specific SQL, verifies ORM compatibility, and establishes the multi-DB-file ownership model.

### 1.2 Scope

**Included:**
- Complete core SQLite migrations (all tables including conversations, chat_history, skills, memory, preferences, documents, model configs).
- Complete auth-service Alembic migrations (all versions, batch mode, type adaptations).
- Complete scan-control-plane migrations (all task/document/source tables).
- Algorithm service database tables (algo.db: parsing tasks, document tasks, algorithm management).
- WAL configuration, busy_timeout, foreign key enforcement across all DB files.
- Migration version management and upgrade path.
- Backup and restore boundary definition.
- Concurrent access testing within ownership boundaries.

**Not Included:**
- Milvus Lite vector storage (see LLD-02).
- SegmentStore FTS implementation (see LLD-03).
- Runtime Store persistence (see LLD-05).

---

## 2. Interface Contracts

### 2.1 Database File Ownership (from HLD 3.10.1)

```
%APPDATA%\LazyMind\data\
  main.db      — core exclusive write
  auth.db      — auth-service exclusive write
  scan.db      — scan-control-plane / file-watcher exclusive write
  algo.db      — algorithm / parsing / processor / doc-service exclusive write
```

### 2.2 Go Core Database Interface

```go
// backend/core/common/orm/db.go — already exists, extended
package orm

func Connect(driver, dsn string) (*DB, error)
func configureSQLite(db *gorm.DB)

// New: ensure all GORM models are AutoMigrate-safe on SQLite
func AutoMigrateDesktop(db *gorm.DB) error
```

### 2.3 Python Service Database Configuration

```python
# All Python services use this pattern:
# Environment: LAZYMIND_DATABASE_URL=sqlite:///path/to/file.db
# SQLAlchemy engine with:
#   - pool_size=1 (single writer)
#   - connect_args={"check_same_thread": False}
#   - event listener for PRAGMA setup
```

### 2.4 Migration Runner Interface

```go
// backend/core/migrate/run.go — already exists
// Selects migrations/sqlite/ directory when driver=sqlite
func RunUp() error
```

---

## 3. Dependencies

**Requires:**
- Phase 1 delivered: orm.Connect with SQLite, migration runner with SQLite support.
- Phase 1 delivered: `getDataDir().data` path.

**Depended on by:**
- LLD-04 Algorithm Pipeline (needs algo.db tables).
- LLD-05 Runtime Store Hardening (may persist to main.db).

---

## 4. Technical Design

### 4.1 Core SQLite Migration Completion

#### 4.1.1 Table Inventory

Phase 1 created `20260101000000_init.up.sql` with minimum tables. Phase 2 must include all remaining:

| Table | Purpose | PG-specific issues |
|-------|---------|-------------------|
| conversations | Chat sessions | UUID default, TIMESTAMPTZ |
| chat_histories | Message history | JSONB columns, array types |
| skills | Skill definitions | JSONB for config |
| skill_items | Skill entries | - |
| memories | Long-term memory | JSONB, text search helpers |
| preferences | User preferences | JSONB values |
| documents | Document metadata | UUID, TIMESTAMPTZ |
| document_versions | Version tracking | - |
| model_configs | Model provider config | JSONB |
| word_groups | Vocabulary groups | - |
| word_items | Vocabulary entries | - |
| agents | Agent definitions | JSONB for config |
| prompts | Prompt templates | TEXT, large content |

#### 4.1.2 PG → SQLite Type Mapping

| PostgreSQL | SQLite | Notes |
|-----------|--------|-------|
| `UUID` | `TEXT` | Store as hex string with dashes |
| `SERIAL` / `BIGSERIAL` | `INTEGER PRIMARY KEY` | SQLite auto-increment |
| `TIMESTAMPTZ` | `TEXT` | ISO 8601 format (UTC) |
| `JSONB` | `TEXT` | Store as JSON string, parse in application |
| `BOOLEAN` | `INTEGER` | 0/1 |
| `TEXT[]` / arrays | `TEXT` | JSON-encoded array |
| `gen_random_uuid()` | application-generated | Use Go `uuid.New()` |
| `NOW()` | `datetime('now')` | SQLite datetime function |
| `CREATE INDEX CONCURRENTLY` | `CREATE INDEX` | No CONCURRENTLY in SQLite |
| `ENUM` | `TEXT CHECK(...)` | Check constraint |

#### 4.1.3 Migration File Strategy

```
backend/core/migrations/sqlite/
  20260101000000_init.up.sql          — Phase 1 (exists)
  20260101000000_init.down.sql        — Phase 1 (exists)
  20260201000000_complete_schema.up.sql   — Phase 2: all remaining tables
  20260201000000_complete_schema.down.sql — Phase 2: drop added tables
```

Single consolidated migration for Phase 2 additions. Not splitting per-table because Desktop has no existing production data to migrate incrementally.

#### 4.1.4 GORM Model Audit

Every GORM model in core must be verified:
- No `gorm:"type:uuid"` that generates PG-specific DDL.
- No `gorm:"type:jsonb"` — use `gorm:"type:text"` with JSON serialization.
- Timestamps use `time.Time` (GORM handles this correctly for SQLite).
- Default values use GORM tags, not raw SQL defaults.

### 4.2 Auth-Service SQLite Completion

#### 4.2.1 Alembic Adaptation

```python
# backend/auth-service/alembic/env.py
def run_migrations_online():
    ...
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # Required for SQLite ALTER TABLE
        compare_type=True,
    )
```

#### 4.2.2 Type Adaptations

- Replace `sa.Enum` with `sa.String` + `CheckConstraint`.
- Replace `UUID()` column type with `String(36)`.
- Replace `ARRAY(String)` with `Text` (JSON-encoded).
- Replace `server_default=func.gen_random_uuid()` with application-side UUID generation.

#### 4.2.3 SQLite Pragma Event Listener

```python
# backend/auth-service/core/database.py
from sqlalchemy import event

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()
```

### 4.3 Scan-Control-Plane SQLite Completion

Scan-control-plane already uses GORM with sqlite driver (Phase 1). Phase 2:
- Verify all tables (sources, documents, tasks, mutations, leases) create correctly.
- Verify scheduled task queries work with SQLite datetime functions.
- Verify task claiming with row locking uses `busy_timeout` instead of PG advisory locks.

### 4.4 Algorithm DB (algo.db)

New SQLite database owned exclusively by Python algorithm services:

```sql
-- Tables for parsing tasks, document processing state, algorithm metadata
CREATE TABLE IF NOT EXISTS parse_tasks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_path TEXT,
    result_path TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS doc_segments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,  -- JSON
    embedding_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parse_tasks_status ON parse_tasks(status);
CREATE INDEX IF NOT EXISTS idx_doc_segments_document ON doc_segments(document_id);
```

### 4.5 Backup and Restore

- Backup = copy all `.db` files + `.db-wal` + `.db-shm` while all services are stopped.
- Electron's `diagnostics:export` extended to optionally include DB backup.
- Restore = stop services → replace DB files → restart.
- Corruption detection: `PRAGMA integrity_check` on startup, report to diagnostics if fails.

---

## 5. File Manifest

### New Files
- `backend/core/migrations/sqlite/20260201000000_complete_schema.up.sql`
- `backend/core/migrations/sqlite/20260201000000_complete_schema.down.sql`
- `backend/auth-service/migrations/sqlite_compat.py` (Alembic helper)
- `backend/algorithm/db/schema.sql` (algo.db schema)
- `backend/algorithm/db/init.py` (algo.db initialization)

### Modified Files
- `backend/core/common/orm/db.go` — Add type mapping helpers
- `backend/core/models/*.go` — Audit and fix GORM tags
- `backend/auth-service/alembic/env.py` — Add `render_as_batch`
- `backend/auth-service/core/database.py` — Add SQLite pragma listener
- `backend/auth-service/models/*.py` — Fix Enum/UUID/Array types
- `backend/scan-control-plane/internal/store/store.go` — Verify datetime queries
- `desktop/src/main/process-manager/configs.ts` — Add algo.db DSN to Python service env

---

## 6. Configuration & Environment Variables

| Variable | Service | Value |
|----------|---------|-------|
| `ACL_DB_DRIVER` | core | `sqlite` |
| `ACL_DB_DSN` | core | `{dataDir}/data/main.db` |
| `LAZYMIND_DATABASE_URL` | auth-service | `sqlite:///{dataDir}/data/auth.db` |
| `DATABASE_DRIVER` | scan-control-plane | `sqlite` |
| `DATABASE_DSN` | scan-control-plane | `{dataDir}/data/scan.db` |
| `ALGO_DATABASE_URL` | algorithm services | `sqlite:///{dataDir}/data/algo.db` |

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| Migration fails on existing DB | Mark dirty, log error, show startup failure in UI |
| SQLite file locked | busy_timeout=5000ms; if still fails, log + retry once |
| Disk full | Catch write errors, show UI warning |
| DB corruption | `PRAGMA integrity_check` on startup; if fails, offer backup restore or reset |
| Concurrent write from wrong service | By design impossible (single-writer ownership); if detected, fatal log |

---

## 8. Security Considerations

- Database files should have restrictive permissions (owner-only read/write).
- Database paths must not be user-controllable (derived from data dir).
- SQL injection: all queries use parameterized statements (GORM / SQLAlchemy).
- Backup files inherit same protection as source DB files.

---

## 9. Testing Strategy

### Unit Tests
- Each migration file applies and rolls back cleanly on in-memory SQLite.
- GORM model CRUD: create, read, update, delete for every table.
- Type mapping: UUID round-trip, JSONB round-trip, timestamp round-trip.
- Concurrent read while single writer holds transaction.

### Integration Tests
- Core starts with SQLite, creates conversation, adds messages, reads back.
- Auth-service starts with SQLite, creates users, assigns roles, queries.
- Scan-control-plane starts with SQLite, creates source, enqueues task, claims.
- Algorithm service starts with SQLite, creates parse task, updates status.

### Regression Tests
- All existing core API tests pass with `ACL_DB_DRIVER=sqlite`.
- All existing auth-service tests pass with SQLite URL.
- PostgreSQL mode remains unchanged (run same tests with PG).

---

## 10. Cloud Mode Compatibility

- Migration runner selects directory by driver: `migrations/` for PG, `migrations/sqlite/` for SQLite.
- No schema changes to PostgreSQL migrations.
- No new dependencies added to Cloud Docker builds.
- Environment variable absence = Cloud behavior unchanged.

---

## 11. Acceptance Criteria

- [ ] Core starts with SQLite and all tables exist.
- [ ] Auth-service starts with SQLite and all Alembic migrations pass.
- [ ] Scan-control-plane starts with SQLite and all tables exist.
- [ ] Algorithm services start with algo.db and schema is initialized.
- [ ] CRUD operations work for all tables on SQLite.
- [ ] JSON/UUID/timestamp fields round-trip correctly.
- [ ] Application restart preserves all data.
- [ ] `busy_timeout` prevents "database locked" under normal load.
- [ ] PostgreSQL mode still works (Cloud regression).
- [ ] `PRAGMA integrity_check` runs on startup without error.
- [ ] Backup (copy DB files) and restore works.

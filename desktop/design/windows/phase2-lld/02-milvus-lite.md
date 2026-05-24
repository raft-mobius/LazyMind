# LLD-02: Milvus Lite Full Integration

## 1. Module Overview

### 1.1 Goal

Integrate Milvus Lite as the production vector store for Desktop Mode. Phase 1 validated installation and basic CRUD. Phase 2 connects Milvus Lite to the real document vectorization and RAG query pipelines, handles collection lifecycle, supports index rebuild, and ensures data persistence across application restarts.

### 1.2 Scope

**Included:**
- Milvus Lite initialization with user data directory.
- Collection creation per knowledge base or assistant.
- Vector insertion from document parsing pipeline.
- Top-k similarity search for RAG retrieval.
- Vector deletion when documents are removed.
- Index rebuild / collection recreation.
- Data directory management (location, cleanup, migration).
- Integration with LazyLLM embedding calls.
- Performance baseline (P95 < 1s, P99 < 2s for top-k query per HLD).

**Not Included:**
- Document parsing itself (see LLD-04).
- Embedding model selection/configuration (see LLD-04).
- SegmentStore full-text search (see LLD-03).

---

## 2. Interface Contracts

### 2.1 VectorStore Protocol

```python
# backend/algorithm/vector/protocol.py
from typing import Protocol, Optional

class VectorStore(Protocol):
    """Abstract vector store interface for Desktop/Cloud mode switching."""

    def ensure_collection(self, collection_name: str, dimension: int) -> None:
        """Create collection if not exists."""
        ...

    def insert(self, collection_name: str, ids: list[str], vectors: list[list[float]], metadata: list[dict]) -> None:
        """Insert vectors with metadata."""
        ...

    def search(self, collection_name: str, query_vector: list[float], top_k: int = 10, filter_expr: Optional[str] = None) -> list[dict]:
        """Search for similar vectors. Returns list of {id, score, metadata}."""
        ...

    def delete(self, collection_name: str, ids: list[str]) -> None:
        """Delete vectors by ID."""
        ...

    def drop_collection(self, collection_name: str) -> None:
        """Drop entire collection."""
        ...

    def collection_exists(self, collection_name: str) -> bool:
        """Check if collection exists."""
        ...

    def count(self, collection_name: str) -> int:
        """Return number of vectors in collection."""
        ...

    def flush(self, collection_name: str) -> None:
        """Flush pending writes to disk."""
        ...
```

### 2.2 MilvusLiteStore Implementation

```python
# backend/algorithm/vector/milvus_lite_store.py
class MilvusLiteStore:
    """Milvus Lite implementation of VectorStore for Desktop Mode."""

    def __init__(self, data_dir: str):
        """
        Args:
            data_dir: Path to %APPDATA%/LazyMind/vector/milvus-lite/
        """
        ...
```

### 2.3 Cloud Milvus Implementation (unchanged)

```python
# backend/algorithm/vector/milvus_cloud_store.py
class MilvusCloudStore:
    """Standard Milvus implementation for Cloud/Server Mode (existing code wrapped)."""
    ...
```

### 2.4 Factory

```python
# backend/algorithm/vector/factory.py
def create_vector_store() -> VectorStore:
    """Create appropriate VectorStore based on LAZYMIND_MODE."""
    mode = os.environ.get("LAZYMIND_MODE", "cloud")
    if mode == "desktop":
        data_dir = os.environ.get("LAZYMIND_VECTOR_DIR", "./vector/milvus-lite")
        return MilvusLiteStore(data_dir)
    else:
        return MilvusCloudStore(...)
```

---

## 3. Dependencies

**Requires:**
- Phase 1: Milvus Lite installable on Windows (validated).
- Phase 1: Data directory structure (`getDataDir().vector`).
- LLD-04: Embedding model produces vectors (but interface is defined here).

**Depended on by:**
- LLD-04 Algorithm Pipeline (uses VectorStore for indexing and retrieval).

---

## 4. Technical Design

### 4.1 Milvus Lite Initialization

```python
from pymilvus import MilvusClient

class MilvusLiteStore:
    def __init__(self, data_dir: str):
        os.makedirs(data_dir, exist_ok=True)
        db_path = os.path.join(data_dir, "milvus.db")
        self._client = MilvusClient(uri=db_path)
```

Key decisions:
- Single `milvus.db` file in `%APPDATA%/LazyMind/vector/milvus-lite/`.
- `MilvusClient` with local file URI (Milvus Lite mode).
- No separate Milvus server process — runs in-process with Python.

### 4.2 Collection Schema

```python
from pymilvus import CollectionSchema, FieldSchema, DataType

def _build_schema(self, dimension: int) -> CollectionSchema:
    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, is_primary=True, max_length=64),
        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=dimension),
        FieldSchema(name="document_id", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="chunk_index", dtype=DataType.INT32),
        FieldSchema(name="user_id", dtype=DataType.VARCHAR, max_length=64),
        FieldSchema(name="content_preview", dtype=DataType.VARCHAR, max_length=512),
    ]
    return CollectionSchema(fields=fields, enable_dynamic_field=True)
```

### 4.3 Collection Naming Convention

```
lazymind_{user_id}_{knowledge_base_id}
```

- One collection per knowledge base per assistant.
- Ensures data isolation between assistants.
- Collection name sanitized: only alphanumeric + underscore.

### 4.4 Insert Flow

```python
def insert(self, collection_name: str, ids: list[str], vectors: list[list[float]], metadata: list[dict]) -> None:
    data = []
    for i, (id_, vec, meta) in enumerate(zip(ids, vectors, metadata)):
        row = {
            "id": id_,
            "vector": vec,
            "document_id": meta.get("document_id", ""),
            "chunk_index": meta.get("chunk_index", 0),
            "user_id": meta.get("user_id", ""),
            "content_preview": meta.get("content_preview", "")[:512],
        }
        data.append(row)
    self._client.insert(collection_name=collection_name, data=data)
```

### 4.5 Search Flow

```python
def search(self, collection_name: str, query_vector: list[float], top_k: int = 10, filter_expr: str | None = None) -> list[dict]:
    results = self._client.search(
        collection_name=collection_name,
        data=[query_vector],
        limit=top_k,
        filter=filter_expr,
        output_fields=["document_id", "chunk_index", "user_id", "content_preview"],
    )
    return [
        {"id": hit["id"], "score": hit["distance"], **hit["entity"]}
        for hit in results[0]
    ]
```

### 4.6 Rebuild / Recreation

```python
def rebuild_collection(self, collection_name: str, dimension: int) -> None:
    """Drop and recreate collection. Caller must re-insert all vectors."""
    if self.collection_exists(collection_name):
        self.drop_collection(collection_name)
    self.ensure_collection(collection_name, dimension)
```

### 4.7 Graceful Shutdown

```python
def close(self) -> None:
    """Flush and close. Called on application shutdown."""
    self._client.close()
```

### 4.8 Error Recovery

- If Milvus Lite DB file is corrupted: detect on startup, offer rebuild option.
- If collection schema mismatch (dimension change): drop + recreate + trigger re-index.
- If disk full during insert: catch exception, report to frontend via service status.

---

## 5. File Manifest

### New Files
- `backend/algorithm/vector/__init__.py`
- `backend/algorithm/vector/protocol.py`
- `backend/algorithm/vector/milvus_lite_store.py`
- `backend/algorithm/vector/milvus_cloud_store.py`
- `backend/algorithm/vector/factory.py`
- `backend/algorithm/vector/exceptions.py`
- `tests/algorithm/vector/test_milvus_lite_store.py`
- `tests/algorithm/vector/test_vector_protocol.py`

### Modified Files
- `backend/algorithm/chat/rag/retriever.py` — Use VectorStore protocol
- `backend/algorithm/requirements.txt` — Pin `pymilvus` version
- `desktop/src/main/process-manager/configs.ts` — Add `LAZYMIND_VECTOR_DIR` env var

---

## 6. Configuration & Environment Variables

| Variable | Service | Value |
|----------|---------|-------|
| `LAZYMIND_VECTOR_DIR` | algorithm services | `{dataDir}/vector/milvus-lite` |
| `LAZYMIND_VECTOR_BACKEND` | algorithm services | `milvus-lite` (Desktop) / `milvus` (Cloud) |
| `LAZYMIND_EMBEDDING_DIM` | algorithm services | `1024` (default, model-dependent) |
| `LAZYMIND_MODE` | algorithm services | `desktop` |

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| Milvus Lite import fails | Fatal startup error with clear message |
| DB file corrupted | Log error, offer rebuild via API |
| Collection not found | Auto-create on first insert |
| Dimension mismatch | Drop + recreate collection, trigger re-index |
| Disk full | Raise exception, propagate to service status |
| Search timeout (>2s) | Log warning, return partial results if possible |

---

## 8. Security Considerations

- Vector data directory inherits OS file permissions from data dir.
- No network access — Milvus Lite runs purely in-process.
- `content_preview` field limited to 512 chars to avoid storing full documents in vector DB.
- Vector DB file excluded from diagnostics export (may contain document embeddings).

---

## 9. Testing Strategy

### Unit Tests
- `MilvusLiteStore` CRUD: ensure_collection, insert, search, delete, drop.
- Search returns correct top-k ordering by distance.
- Filter expressions work (filter by user_id, document_id).
- Collection isolation: data in collection A not visible in collection B.
- Restart persistence: insert → close → reopen → search finds data.

### Integration Tests
- End-to-end: parse document → embed → insert → search → verify results.
- Multiple collections (multiple assistants) with isolated data.
- Rebuild: drop collection → re-insert → verify search works.
- Large batch insert (1000+ vectors) completes within acceptable time.

### Performance Tests
- Top-k search P95 < 1s with 10,000 vectors (HLD requirement).
- Top-k search P99 < 2s with 10,000 vectors.
- Insert throughput: 100 vectors/second minimum.
- Memory usage: record baseline with 10K/50K/100K vectors.

---

## 10. Cloud Mode Compatibility

- `MilvusCloudStore` wraps existing Milvus client code (no behavior change).
- Factory selects implementation based on `LAZYMIND_MODE`.
- No new dependencies added to Cloud Docker builds (pymilvus already present).
- Milvus Lite specific imports guarded by mode check.

---

## 11. Acceptance Criteria

- [ ] MilvusLiteStore passes all VectorStore protocol tests.
- [ ] Data persists across process restart.
- [ ] Multiple collections (per-assistant) are isolated.
- [ ] Top-k search P95 < 1s with MVP target dataset.
- [ ] Insert + search end-to-end works with real embeddings.
- [ ] Rebuild/recreation works without data loss in other collections.
- [ ] Disk usage is reasonable (record baseline).
- [ ] Cloud mode Milvus integration unchanged.
- [ ] Windows path handling works (spaces, Chinese characters in data dir).

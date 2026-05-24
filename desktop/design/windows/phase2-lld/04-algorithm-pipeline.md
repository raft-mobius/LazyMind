# LLD-04: Algorithm & Parsing Pipeline

## 1. Module Overview

### 1.1 Goal

Connect the real document parsing, embedding, indexing, and RAG query pipeline for Desktop Mode. Replace the Phase 1 mock algorithm server with consolidated real Python services. Evaluate and execute Python service consolidation from 4-5 processes to 1-2 processes.

### 1.2 Scope

**Included:**
- Python service consolidation strategy (auth-service + parsing + processor + doc-service → 1-2 processes).
- Document parsing pipeline: file → parse → segment → embed → index.
- RAG query pipeline: query → embed → vector search → segment search → rerank → generate.
- Integration with Milvus Lite (LLD-02) for vector operations.
- Integration with SegmentStore (LLD-03) for keyword search.
- Integration with algo.db (LLD-01) for task state.
- Model configuration interface (user-configurable LLM/embedding endpoints).
- Office/OCR degradation: clear error messages when capabilities unavailable.
- Chat SSE streaming through core proxy.

**Not Included:**
- Milvus Lite internals (see LLD-02).
- SegmentStore internals (see LLD-03).
- SQLite schema details (see LLD-01).
- Electron process manager changes (uses existing Phase 1 infrastructure).
- Evo module (excluded per HLD).

---

## 2. Interface Contracts

### 2.1 Parsing Service API

```python
# POST /api/parse/documents
# Request:
{
    "document_id": "uuid",
    "source_path": "/path/to/file.md",
    "user_id": "uuid",
    "parse_options": {"format": "markdown"}
}
# Response:
{
    "task_id": "uuid",
    "status": "queued"
}

# GET /api/parse/tasks/{task_id}
# Response:
{
    "task_id": "uuid",
    "status": "completed|processing|failed",
    "segments_count": 42,
    "error": null
}
```

### 2.2 Chat Service API (existing, adapted)

```python
# POST /api/chat/stream
# Request:
{
    "conversation_id": "uuid",
    "message": "What planets are in the solar system?",
    "user_id": "uuid",
    "model_config": {"provider": "dashscope", "model": "qwen-plus"},
    "rag_enabled": true
}
# Response: SSE stream
# data: {"delta": "The", "seq": 1, "history_id": "uuid"}
# data: {"delta": " solar", "seq": 2, "history_id": "uuid"}
# ...
# data: {"finish_reason": "stop", "sources": [...]}
```

### 2.3 Model Configuration API

```python
# GET /api/core/model-configs
# Response:
[
    {
        "id": "uuid",
        "provider": "dashscope",
        "model_name": "qwen-plus",
        "api_key": "sk-***",  # masked in response
        "endpoint": "https://dashscope.aliyuncs.com/...",
        "is_default": true,
        "capabilities": ["chat", "embedding"]
    }
]

# POST /api/core/model-configs
# PUT /api/core/model-configs/{id}
```

---

## 3. Dependencies

**Requires:**
- LLD-01 SQLite Complete (algo.db for task state).
- LLD-02 Milvus Lite (VectorStore for embedding storage/retrieval).
- LLD-03 SegmentStore Local (keyword search for hybrid retrieval).
- Phase 1: Process Manager, Local Proxy, auth-service.

**Depended on by:**
- LLD-06 Frontend Complete (API responses for status/chat/parsing).

---

## 4. Technical Design

### 4.1 Python Service Consolidation

#### Current State (Phase 1)
```
auth-service      (port 8002) — standalone FastAPI
algorithm-mock    (port 8046) — mock responses
```

#### Phase 2 Target
```
auth-service      (port 8002) — standalone FastAPI (unchanged)
algorithm-service (port 8046) — consolidated FastAPI:
    ├─ /api/chat/*       — chat/RAG endpoints
    ├─ /api/parse/*      — parsing endpoints
    ├─ /api/processor/*  — processing status
    └─ /api/doc/*        — document service
```

#### Consolidation Rationale
- auth-service stays independent (different DB, different lifecycle, security boundary).
- All algorithm-related services share: algo.db, Milvus Lite client, SegmentStore client, model configs.
- Consolidation reduces: process count (4→1), memory overhead, port usage, startup time.
- Chat service may have long-running SSE streams — handled via async within same process.

#### Consolidated Service Structure
```
backend/algorithm/
    main.py              — FastAPI app with all routers
    config.py            — Service configuration
    db/
        init.py          — algo.db initialization
        models.py        — SQLAlchemy models
    chat/
        router.py        — Chat/RAG endpoints
        rag_pipeline.py  — Retrieve-augment-generate
        stream.py        — SSE streaming
    parse/
        router.py        — Parse task endpoints
        parser.py        — Document parsing logic
        segmenter.py     — Text chunking
    vector/
        protocol.py      — VectorStore interface
        milvus_lite_store.py
        factory.py
    embedding/
        router.py        — (optional) embedding endpoints
        embedder.py      — Embedding model calls
    models/
        config.py        — Model config management
        provider.py      — LLM provider abstraction
```

### 4.2 Document Parsing Pipeline

```
User uploads file / scan detects file
    │
    ▼
scan-control-plane enqueues task
    │
    ▼
algorithm-service picks up parse task
    │
    ├── 1. Read file from source_path
    ├── 2. Detect format (md, txt, pdf, docx)
    ├── 3. Parse to plain text segments
    │       ├── Markdown: split by headers
    │       ├── Plain text: split by paragraphs / fixed size
    │       ├── PDF: (future) text extraction
    │       └── Office: (future) online API or degradation
    ├── 4. Store segments in algo.db (doc_segments table)
    ├── 5. Generate embeddings via configured model
    ├── 6. Insert vectors into Milvus Lite
    ├── 7. Index segments into SegmentStore (FTS)
    └── 8. Update task status → completed
```

### 4.3 RAG Query Pipeline

```
User sends message
    │
    ▼
core receives request, forwards to algorithm-service /api/chat/stream
    │
    ▼
algorithm-service RAG pipeline:
    │
    ├── 1. Embed query using same embedding model
    ├── 2. Vector search (Milvus Lite) → top-K candidates
    ├── 3. Keyword search (SegmentStore) → top-K candidates
    ├── 4. Merge & rerank (reciprocal rank fusion)
    ├── 5. Build prompt with retrieved context
    ├── 6. Call LLM (streaming)
    └── 7. Stream response back as SSE
```

### 4.4 Text Chunking Strategy

```python
class TextSegmenter:
    def __init__(self, max_chunk_size: int = 1000, overlap: int = 200):
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap

    def segment_markdown(self, content: str) -> list[dict]:
        """Split by headers, then by size if needed."""
        ...

    def segment_plain(self, content: str) -> list[dict]:
        """Split by paragraphs, merge small ones, split large ones."""
        ...
```

### 4.5 Embedding Integration

```python
class Embedder:
    def __init__(self, model_config: dict):
        self.provider = model_config["provider"]
        self.model = model_config["model_name"]
        self.api_key = model_config["api_key"]
        self.endpoint = model_config.get("endpoint")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Call embedding model API. Batch supported."""
        ...

    async def embed_query(self, query: str) -> list[float]:
        """Embed a single query. May use different model/prompt."""
        return (await self.embed([query]))[0]
```

### 4.6 Model Configuration

Model configs stored in `main.db` (core owns), exposed via core API:
- Frontend model config page writes/reads via core API.
- Algorithm service reads model config from core API on startup and caches.
- When no real model is configured, chat returns a clear message:
  "当前未配置模型，请在设置 > 模型配置中添加模型 API。"

### 4.7 SSE Streaming Architecture

```
Renderer → Local Proxy → core (/api/chat/stream) → algorithm-service
                                                          │
                                                    SSE stream
                                                          │
Renderer ← Local Proxy ← core (passthrough) ←────────────┘
```

Core acts as SSE passthrough. Algorithm-service generates SSE events. Local Proxy passes through without buffering (already using http-proxy with streaming support).

### 4.8 Office/OCR Degradation

When a file format is not locally parseable:
1. Check if online API is configured for that capability.
2. If yes: send to online API, receive parsed text.
3. If no: mark parse task as `degraded`, store error message:
   "该文件格式需要配置在线解析 API。请在设置 > 模型配置中添加文档解析服务。"
4. Frontend shows degraded status with actionable guidance.

---

## 5. File Manifest

### New Files
- `backend/algorithm/main.py` — Consolidated FastAPI app
- `backend/algorithm/config.py`
- `backend/algorithm/db/init.py`
- `backend/algorithm/db/models.py`
- `backend/algorithm/chat/router.py`
- `backend/algorithm/chat/rag_pipeline.py`
- `backend/algorithm/chat/stream.py`
- `backend/algorithm/parse/router.py`
- `backend/algorithm/parse/parser.py`
- `backend/algorithm/parse/segmenter.py`
- `backend/algorithm/embedding/embedder.py`
- `backend/algorithm/models/config.py`
- `backend/algorithm/models/provider.py`
- `backend/algorithm/requirements.txt`

### Modified Files
- `desktop/src/main/process-manager/configs.ts` — Replace algorithm-mock with algorithm-service
- `desktop/src/main/proxy/routes.ts` — Update routing if ports change
- `backend/core/chat/handler.go` — SSE passthrough to algorithm-service

---

## 6. Configuration & Environment Variables

| Variable | Service | Value |
|----------|---------|-------|
| `ALGO_DATABASE_URL` | algorithm-service | `sqlite:///{dataDir}/data/algo.db` |
| `LAZYMIND_VECTOR_DIR` | algorithm-service | `{dataDir}/vector/milvus-lite` |
| `LAZYMIND_VECTOR_BACKEND` | algorithm-service | `milvus-lite` |
| `LAZYMIND_SEGMENT_URL` | algorithm-service | `http://127.0.0.1:8001` (core's segment API) |
| `LAZYMIND_CORE_URL` | algorithm-service | `http://127.0.0.1:8001` (for model config) |
| `LAZYMIND_MODE` | algorithm-service | `desktop` |
| `LAZYMIND_LOCAL_SECRET` | algorithm-service | (injected by process manager) |
| `LAZYMIND_EMBEDDING_DIM` | algorithm-service | `1024` |

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| No model configured | Return clear message in chat response, not an error |
| Embedding API fails | Retry once, then fail parse task with message |
| LLM streaming error | Send SSE error event, mark chat as failed |
| Unsupported file format | Mark task as degraded with guidance message |
| Milvus Lite unavailable | Mark vector indexing as failed, allow keyword-only search |
| Parse task timeout | Mark as failed after 5 minutes, allow retry |

---

## 8. Security Considerations

- Model API keys stored in main.db, read by algorithm-service at startup.
- API keys never logged (sanitizer already handles this).
- Algorithm-service validates `X-Desktop-Secret` on all requests.
- Parsed content stays local — not sent to external services unless user configures online model.
- File paths from scan-control-plane are validated before reading.

---

## 9. Testing Strategy

### Unit Tests
- TextSegmenter: markdown splitting, plain text splitting, size limits.
- Embedder: mock API call, batch handling, error retry.
- RAG pipeline: mock vector results + segment results → correct context building.
- Model config: CRUD, validation, default selection.

### Integration Tests
- End-to-end parse: upload markdown file → parse → segments in algo.db + vectors in Milvus + FTS indexed.
- End-to-end chat: send question → RAG retrieves relevant context → LLM generates answer.
- Degradation: attempt unsupported format → correct error message returned.
- Multiple assistants: assistant A's documents not retrieved for assistant B's queries.

### Performance Tests
- Parse 100KB markdown document: < 30 seconds total (segment + embed + index).
- Chat query with RAG (10K segments in corpus): first token < 3s.
- Concurrent: 2 parallel chat requests don't block each other.

---

## 10. Cloud Mode Compatibility

- Consolidated algorithm-service is Desktop-only; Cloud continues with existing service topology.
- VectorStore factory selects Milvus Cloud in Cloud mode.
- SegmentStore factory selects OpenSearch in Cloud mode.
- No changes to Cloud Docker Compose or deployment.

---

## 11. Acceptance Criteria

- [ ] Consolidated algorithm-service starts and passes health check.
- [ ] Document parsing: markdown file → segments stored in algo.db.
- [ ] Embedding: segments vectorized and stored in Milvus Lite.
- [ ] FTS indexing: segments indexed in SegmentStore.
- [ ] RAG chat: question retrieves relevant context and generates answer.
- [ ] SSE streaming works end-to-end (Renderer → core → algorithm → back).
- [ ] No model configured: clear guidance message in chat.
- [ ] Unsupported format: degraded status with guidance.
- [ ] Assistant isolation: A's docs not in B's RAG results.
- [ ] Process manager starts algorithm-service (replaces mock).
- [ ] Cold start: algorithm-service healthy within 30s.
- [ ] Memory: algorithm-service < 500MB baseline (without model loaded).

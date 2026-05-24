# LLD-08: Integration Test & Performance Plan

## 1. Module Overview

### 1.1 Goal

Define the comprehensive testing strategy for Phase 2 Desktop Mode. Cover integration tests that validate cross-module behavior, performance benchmarks against HLD targets, and the 50-assistant isolation verification. Ensure all Phase 2 acceptance criteria are testable and tested.

### 1.2 Scope

**Included:**
- Integration test architecture and tooling.
- End-to-end test scenarios (parse → index → RAG → chat).
- Performance benchmarks (cold start, search latency, memory usage).
- 50-assistant data isolation test.
- Service health and recovery tests.
- Test environment setup (fixtures, test data, teardown).
- CI integration strategy for Desktop tests.

**Not Included:**
- Individual unit test details (covered in each LLD module).
- Cloud mode test regression (existing CI covers).
- Manual QA test scripts.

---

## 2. Test Architecture

### 2.1 Test Layers

```
┌─────────────────────────────────────────────┐
│ E2E Tests (Playwright + Electron)           │  ← Full app, real services
├─────────────────────────────────────────────┤
│ Integration Tests (Go test + Python pytest) │  ← Real DBs, mock external APIs
├─────────────────────────────────────────────┤
│ Component Tests (Vitest + React Testing Lib)│  ← Frontend components, mock API
├─────────────────────────────────────────────┤
│ Unit Tests (go test / pytest / vitest)      │  ← Pure logic, no I/O
└─────────────────────────────────────────────┘
```

### 2.2 Tooling

| Layer | Language | Tool | Runner |
|-------|----------|------|--------|
| E2E | TypeScript | Playwright + electron-playwright | CI (Windows) |
| Integration (Backend) | Go | `go test -tags=integration` | CI (Windows/Linux) |
| Integration (Algorithm) | Python | `pytest -m integration` | CI (Windows/Linux) |
| Component (Frontend) | TypeScript | Vitest + @testing-library/react | CI (any) |
| Unit | Go/Python/TS | go test / pytest / vitest | CI (any) |
| Performance | Go/Python | Custom benchmark harness | CI (Windows) |

### 2.3 Test Data Fixtures

```
tests/
├── fixtures/
│   ├── documents/
│   │   ├── sample-markdown.md          (3KB, Chinese + English)
│   │   ├── sample-large.md             (100KB, stress test)
│   │   ├── sample-plain.txt            (1KB)
│   │   └── sample-unsupported.docx     (degradation test)
│   ├── embeddings/
│   │   └── mock-embeddings.json        (pre-computed for deterministic tests)
│   └── configs/
│       ├── model-config-dashscope.json
│       └── model-config-openai.json
├── integration/
│   ├── backend/                         (Go integration tests)
│   ├── algorithm/                       (Python integration tests)
│   └── e2e/                             (Playwright tests)
└── benchmarks/
    ├── cold-start/
    ├── search-latency/
    └── memory-usage/
```

---

## 3. Integration Test Scenarios

### 3.1 Document Pipeline (Parse → Index → Search)

```python
# tests/integration/algorithm/test_document_pipeline.py

class TestDocumentPipeline:
    """End-to-end document processing pipeline."""

    def test_markdown_parse_and_index(self, algorithm_service, test_user):
        """Parse markdown → segments in DB → vectors in Milvus → FTS indexed."""
        # 1. Submit parse task
        resp = algorithm_service.post("/api/parse/documents", json={
            "document_id": "doc-001",
            "source_path": FIXTURES / "sample-markdown.md",
            "user_id": test_user.id,
        })
        task_id = resp.json()["task_id"]

        # 2. Wait for completion (poll with timeout)
        status = wait_for_task(algorithm_service, task_id, timeout=30)
        assert status["status"] == "completed"
        assert status["segments_count"] > 0

        # 3. Verify vector store has entries
        vectors = milvus_count(collection=f"lazymind_{test_user.id}_default")
        assert vectors == status["segments_count"]

        # 4. Verify FTS has entries
        fts_count = segment_store_count(user_id=test_user.id)
        assert fts_count == status["segments_count"]

    def test_search_returns_relevant_results(self, algorithm_service, indexed_user):
        """After indexing, RAG search returns relevant segments."""
        resp = algorithm_service.post("/api/chat/stream", json={
            "conversation_id": "conv-001",
            "message": "太阳系有哪些行星",
            "user_id": indexed_user.id,
            "rag_enabled": True,
        })
        # Parse SSE stream
        events = collect_sse_events(resp)
        final = events[-1]
        assert final["finish_reason"] == "stop"
        assert len(final["sources"]) > 0

    def test_document_delete_removes_from_all_stores(self, algorithm_service, indexed_user):
        """Deleting a document removes segments from FTS and vectors from Milvus."""
        algorithm_service.delete(f"/api/documents/doc-001?user_id={indexed_user.id}")

        # Verify gone from vector store
        vectors = milvus_count(collection=f"lazymind_{indexed_user.id}_default")
        assert vectors == 0

        # Verify gone from FTS
        fts_count = segment_store_count(user_id=indexed_user.id)
        assert fts_count == 0
```

### 3.2 Chat with RAG (Full Chain)

```python
# tests/integration/algorithm/test_chat_rag.py

class TestChatRAG:
    """Chat with retrieval-augmented generation."""

    def test_rag_returns_sources(self, chat_service, indexed_corpus):
        """Chat response includes source references."""
        events = chat_stream(chat_service, "什么是黑洞", user_id=indexed_corpus.user_id)
        final = events[-1]
        assert "sources" in final
        assert any("黑洞" in s["content_preview"] for s in final["sources"])

    def test_no_model_configured_returns_guidance(self, chat_service, user_no_model):
        """When no model configured, return guidance message."""
        events = chat_stream(chat_service, "hello", user_id=user_no_model.id)
        text = "".join(e.get("delta", "") for e in events)
        assert "配置模型" in text or "模型" in text

    def test_streaming_chunks_arrive_sequentially(self, chat_service, indexed_corpus):
        """SSE events arrive in order with incrementing seq."""
        events = chat_stream(chat_service, "测试", user_id=indexed_corpus.user_id)
        seqs = [e["seq"] for e in events if "seq" in e]
        assert seqs == sorted(seqs)
        assert len(seqs) > 1
```

### 3.3 Runtime Store Recovery

```go
// tests/integration/backend/runtime_recovery_test.go

func TestChatStatusSurvivesRestart(t *testing.T) {
    store := createHybridStore(t)

    // Set a chat as completed
    store.SetChatStatus(ctx, "conv1", "hist1", "completed", "Hello world")
    store.Close()

    // Reopen — simulates restart
    store2 := createHybridStore(t)
    defer store2.Close()

    status, err := store2.GetChatStatus(ctx, "conv1", "hist1")
    require.NoError(t, err)
    assert.Equal(t, "completed", status.Status)
    assert.Equal(t, "Hello world", status.CurrentResult)
}

func TestGeneratingBecomesInterruptedOnRestart(t *testing.T) {
    store := createHybridStore(t)
    store.SetChatStatus(ctx, "conv1", "hist1", "generating", "partial...")
    store.Close()

    store2 := createHybridStore(t)
    defer store2.Close()

    status, _ := store2.GetChatStatus(ctx, "conv1", "hist1")
    assert.Equal(t, "interrupted", status.Status)
}
```

### 3.4 50-Assistant Data Isolation

```python
# tests/integration/algorithm/test_assistant_isolation.py

class TestAssistantIsolation:
    """Verify complete data isolation between 50 assistants."""

    NUM_ASSISTANTS = 50

    @pytest.fixture(scope="class")
    def assistants(self, auth_service):
        """Create 50 assistants, each with unique documents."""
        users = []
        for i in range(self.NUM_ASSISTANTS):
            user = auth_service.create_assistant(
                username=f"assistant_{i:03d}",
                display_name=f"Assistant {i}",
            )
            users.append(user)
        return users

    @pytest.fixture(scope="class")
    def indexed_assistants(self, assistants, algorithm_service):
        """Index a unique document per assistant."""
        for i, user in enumerate(assistants):
            content = f"# Document for assistant {i}\n\nUnique keyword: MARKER_{i:03d}"
            doc_path = write_temp_file(content)
            parse_and_wait(algorithm_service, doc_path, user.id)
        return assistants

    def test_search_isolation(self, indexed_assistants, algorithm_service):
        """Each assistant's search only returns their own documents."""
        for i, user in enumerate(indexed_assistants):
            results = search(algorithm_service, f"MARKER_{i:03d}", user_id=user.id)
            # Should find own marker
            assert len(results) > 0
            assert all(r["user_id"] == user.id for r in results)

            # Should NOT find adjacent assistant's marker
            other_marker = f"MARKER_{(i+1) % self.NUM_ASSISTANTS:03d}"
            results = search(algorithm_service, other_marker, user_id=user.id)
            assert len(results) == 0

    def test_chat_isolation(self, indexed_assistants, algorithm_service):
        """RAG chat for one assistant doesn't leak other assistants' data."""
        user_0 = indexed_assistants[0]
        events = chat_stream(algorithm_service, "MARKER_001", user_id=user_0.id)
        text = "".join(e.get("delta", "") for e in events)
        # Should not contain other assistant's unique content
        assert "MARKER_001" not in text  # This is assistant_1's marker, not assistant_0's

    def test_delete_isolation(self, indexed_assistants, algorithm_service):
        """Deleting one assistant's data doesn't affect others."""
        # Delete assistant_49's data
        delete_all_docs(algorithm_service, indexed_assistants[49].id)

        # Assistant_0's data still intact
        results = search(algorithm_service, "MARKER_000", user_id=indexed_assistants[0].id)
        assert len(results) > 0
```

### 3.5 Service Health & Startup

```typescript
// tests/integration/e2e/service-health.spec.ts

test.describe('Service Health', () => {
  test('all services healthy within 60s of launch', async ({ electronApp }) => {
    const start = Date.now();
    let allHealthy = false;

    while (Date.now() - start < 60_000) {
      const statuses = await electronApp.evaluate(async () => {
        return window.lazymind.getServiceStatuses();
      });
      if (Object.values(statuses).every(s => s === 'healthy')) {
        allHealthy = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    expect(allHealthy).toBe(true);
  });

  test('service restart recovers automatically', async ({ electronApp }) => {
    // Kill core service
    await electronApp.evaluate(async () => {
      // Simulate crash
    });

    // Wait for auto-restart
    await expect(async () => {
      const status = await electronApp.evaluate(() =>
        window.lazymind.getServiceStatuses()
      );
      expect(status.core).toBe('healthy');
    }).toPass({ timeout: 30_000 });
  });
});
```

---

## 4. Performance Benchmarks

### 4.1 Cold Start Time

**HLD Target:** All services healthy within 60s.

```go
// tests/benchmarks/cold_start_test.go

func BenchmarkColdStart(b *testing.B) {
    // Measure time from process launch to all health checks passing
    for i := 0; i < b.N; i++ {
        start := time.Now()
        launchDesktopServices()
        waitAllHealthy()
        elapsed := time.Since(start)
        b.ReportMetric(float64(elapsed.Milliseconds()), "ms/start")
    }
}
```

| Metric | Target | Method |
|--------|--------|--------|
| First health check (any service) | < 10s | Timer from process spawn |
| All services healthy | < 60s | Timer until all pass |
| Electron window visible | < 5s | Timer from exe launch |
| Algorithm service ready | < 30s | Timer from spawn to health pass |

### 4.2 Search Latency

**HLD Target:** Vector search P95 < 1s, P99 < 2s with 10K vectors.

```python
# tests/benchmarks/search_latency.py

class SearchLatencyBenchmark:
    """Measure RAG search latency with varying corpus sizes."""

    CORPUS_SIZES = [1_000, 5_000, 10_000, 50_000]
    QUERIES_PER_SIZE = 100

    def run(self):
        for size in self.CORPUS_SIZES:
            setup_corpus(size)  # Insert N vectors + FTS segments
            latencies = []

            for _ in range(self.QUERIES_PER_SIZE):
                query = random_query()
                start = time.perf_counter()
                search(query)
                latencies.append(time.perf_counter() - start)

            p50 = percentile(latencies, 50)
            p95 = percentile(latencies, 95)
            p99 = percentile(latencies, 99)

            report(f"corpus_{size}", p50=p50, p95=p95, p99=p99)

            # Assert HLD targets at 10K
            if size == 10_000:
                assert p95 < 1.0, f"P95 {p95:.3f}s exceeds 1s target"
                assert p99 < 2.0, f"P99 {p99:.3f}s exceeds 2s target"
```

### 4.3 Memory Usage

**HLD Target:** Algorithm service < 500MB baseline.

```python
# tests/benchmarks/memory_usage.py

class MemoryBenchmark:
    """Track memory usage at various load levels."""

    def measure_baseline(self):
        """Memory after startup with empty corpus."""
        pid = get_algorithm_service_pid()
        mem = get_rss_mb(pid)
        assert mem < 500, f"Baseline {mem}MB exceeds 500MB limit"
        return mem

    def measure_with_corpus(self, size: int):
        """Memory after indexing N documents."""
        index_documents(size)
        pid = get_algorithm_service_pid()
        mem = get_rss_mb(pid)
        return mem

    def run(self):
        baseline = self.measure_baseline()
        report("baseline_mb", baseline)

        for size in [100, 1000, 5000]:
            mem = self.measure_with_corpus(size)
            report(f"corpus_{size}_mb", mem)
            per_doc = (mem - baseline) / size
            report(f"per_doc_mb_{size}", per_doc)
```

### 4.4 Parse Throughput

**HLD Target:** 100KB markdown < 30s total pipeline time.

```python
# tests/benchmarks/parse_throughput.py

class ParseBenchmark:
    def test_100kb_markdown(self):
        """Parse 100KB markdown: segment + embed + index within 30s."""
        doc_path = FIXTURES / "sample-large.md"
        assert doc_path.stat().st_size >= 100_000

        start = time.perf_counter()
        task_id = submit_parse(doc_path)
        wait_for_task(task_id, timeout=30)
        elapsed = time.perf_counter() - start

        assert elapsed < 30.0, f"Parse took {elapsed:.1f}s, exceeds 30s target"
        report("parse_100kb_seconds", elapsed)
```

### 4.5 Concurrent Operations

```python
# tests/benchmarks/concurrency.py

class ConcurrencyBenchmark:
    def test_parallel_chat_requests(self):
        """2 parallel chat requests don't block each other."""
        import asyncio

        async def chat_request(user_id, message):
            start = time.perf_counter()
            events = await async_chat_stream(message, user_id)
            return time.perf_counter() - start

        loop = asyncio.get_event_loop()
        t1, t2 = loop.run_until_complete(asyncio.gather(
            chat_request("user_a", "question 1"),
            chat_request("user_b", "question 2"),
        ))

        # Neither should take significantly longer than solo
        solo = measure_solo_chat()
        assert max(t1, t2) < solo * 2.0
```

---

## 5. Test Environment

### 5.1 Local Test Setup

```bash
# tests/setup.sh — prepares local test environment
export LAZYMIND_MODE=desktop
export LAZYMIND_DATA_DIR=$(mktemp -d)
export LAZYMIND_STATE_BACKEND=hybrid
export LAZYMIND_VECTOR_BACKEND=milvus-lite
export LAZYMIND_SEGMENT_BACKEND=sqlite

# Start services in test mode
./scripts/start-test-services.sh
```

### 5.2 CI Configuration

```yaml
# .github/workflows/desktop-tests.yml
name: Desktop Integration Tests
on: [push, pull_request]

jobs:
  integration:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Install dependencies
        run: |
          pip install -r backend/algorithm/requirements.txt
          pip install pytest pytest-asyncio
          cd desktop && npm ci

      - name: Run Go integration tests
        run: go test -tags=integration ./backend/core/...

      - name: Run Python integration tests
        run: pytest tests/integration/algorithm/ -m integration

      - name: Run E2E tests
        run: npx playwright test tests/integration/e2e/

  performance:
    runs-on: windows-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Run benchmarks
        run: python tests/benchmarks/run_all.py
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: tests/benchmarks/results/
```

### 5.3 Test Isolation

Each test suite:
- Creates its own temporary data directory.
- Starts fresh SQLite databases (no shared state).
- Uses unique user_ids to prevent cross-test contamination.
- Cleans up after completion (or on timeout).

---

## 6. Test Coverage Matrix

### 6.1 Module Coverage

| Module | Unit | Integration | E2E | Performance |
|--------|------|-------------|-----|-------------|
| LLD-01 SQLite | ✅ | ✅ | — | — |
| LLD-02 Milvus Lite | ✅ | ✅ | — | ✅ |
| LLD-03 SegmentStore | ✅ | ✅ | — | ✅ |
| LLD-04 Algorithm Pipeline | ✅ | ✅ | ✅ | ✅ |
| LLD-05 Runtime Store | ✅ | ✅ | — | — |
| LLD-06 Frontend | ✅ (Vitest) | — | ✅ | — |
| LLD-07 Credentials | ✅ | ✅ | ✅ | — |

### 6.2 Cross-Cutting Concerns

| Concern | Test Type | Scenario |
|---------|-----------|----------|
| Data isolation | Integration | 50 assistants, no leakage |
| Restart recovery | Integration | Kill → restart → state preserved |
| Error propagation | Integration | Backend error → frontend display |
| Chinese text | Integration | Parse/search Chinese documents |
| Large files | Performance | 100KB document pipeline |
| Concurrent users | Performance | Parallel chat requests |
| Cold start | Performance | Measure startup time |
| Memory bounds | Performance | Track RSS at load levels |

---

## 7. Acceptance Test Mapping

Each Phase 2 acceptance criterion mapped to a specific test:

| Criterion | Test File | Test Name |
|-----------|-----------|-----------|
| Document parsing works | `test_document_pipeline.py` | `test_markdown_parse_and_index` |
| Vectors stored in Milvus | `test_document_pipeline.py` | `test_markdown_parse_and_index` (assert vectors) |
| FTS indexed | `test_document_pipeline.py` | `test_markdown_parse_and_index` (assert FTS) |
| RAG chat returns sources | `test_chat_rag.py` | `test_rag_returns_sources` |
| No model → guidance | `test_chat_rag.py` | `test_no_model_configured_returns_guidance` |
| SSE streaming works | `test_chat_rag.py` | `test_streaming_chunks_arrive_sequentially` |
| Chat status persists | `runtime_recovery_test.go` | `TestChatStatusSurvivesRestart` |
| Interrupted detection | `runtime_recovery_test.go` | `TestGeneratingBecomesInterruptedOnRestart` |
| 50-assistant isolation | `test_assistant_isolation.py` | `test_search_isolation` |
| Search P95 < 1s | `search_latency.py` | `SearchLatencyBenchmark.run` |
| Memory < 500MB | `memory_usage.py` | `MemoryBenchmark.measure_baseline` |
| Parse 100KB < 30s | `parse_throughput.py` | `test_100kb_markdown` |
| Cold start < 60s | `cold_start_test.go` | `BenchmarkColdStart` |
| Secrets not in plaintext | `test_credentials.py` | `test_no_plaintext_secrets_in_logs` |
| Cloud mode unchanged | Existing CI | Regression suite (no changes to Cloud tests) |

---

## 8. Test Data Management

### 8.1 Fixture Generation

```python
# tests/fixtures/generate.py
"""Generate test fixtures for consistent, reproducible tests."""

def generate_markdown_corpus(num_docs: int, output_dir: Path):
    """Generate N markdown documents with known content for search testing."""
    topics = load_topics()  # Pre-defined topic list
    for i in range(num_docs):
        content = generate_document(topics[i % len(topics)], seed=i)
        (output_dir / f"doc_{i:04d}.md").write_text(content, encoding='utf-8')

def generate_mock_embeddings(num_vectors: int, dim: int, output_path: Path):
    """Generate deterministic embeddings for tests that bypass real model."""
    import numpy as np
    np.random.seed(42)
    embeddings = np.random.randn(num_vectors, dim).astype(np.float32)
    # Normalize
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    embeddings = embeddings / norms
    np.save(output_path, embeddings)
```

### 8.2 Mock Model Server

For tests that need model responses without real API:

```python
# tests/mocks/model_server.py
"""FastAPI mock that mimics DashScope/OpenAI embedding + chat API."""

@app.post("/v1/embeddings")
async def mock_embeddings(request: EmbeddingRequest):
    """Return deterministic embeddings based on input hash."""
    embeddings = [hash_to_vector(text, dim=1024) for text in request.input]
    return {"data": [{"embedding": e, "index": i} for i, e in enumerate(embeddings)]}

@app.post("/v1/chat/completions")
async def mock_chat(request: ChatRequest):
    """Return streamed response with mock content."""
    # ... SSE streaming mock
```

---

## 9. Regression Prevention

### 9.1 Snapshot Tests

- Model config API response shape → JSON schema snapshot.
- Parse task status response → JSON schema snapshot.
- SSE event format → event schema snapshot.

### 9.2 Golden File Tests

- FTS5 search results for known corpus + query → expected document IDs.
- Vector search results for known embeddings + query → expected ordering.

### 9.3 Breaking Change Detection

```go
// tests/api_compat_test.go
func TestAPICompatibility(t *testing.T) {
    // Load saved API response schemas
    // Make requests to current implementation
    // Verify response matches schema (no removed fields, no type changes)
}
```

---

## 10. Acceptance Criteria (for this LLD)

- [ ] Integration test framework set up and runnable locally.
- [ ] Document pipeline E2E test passes (parse → index → search).
- [ ] Chat RAG E2E test passes (question → sources in response).
- [ ] 50-assistant isolation test passes.
- [ ] Runtime store recovery test passes.
- [ ] Cold start benchmark < 60s on CI runner.
- [ ] Search latency P95 < 1s at 10K vectors on CI runner.
- [ ] Memory baseline < 500MB on CI runner.
- [ ] Parse throughput < 30s for 100KB on CI runner.
- [ ] CI workflow configured and green on main branch.
- [ ] Test fixtures committed and documented.

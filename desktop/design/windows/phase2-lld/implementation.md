# Phase 2 Implementation Plan

## Purpose

This document is a machine-readable implementation plan for Claude Code agents. It drives TDD development of LazyMind Desktop Mode Phase 2, following the dependency order defined in the Phase 2 LLD and validated by `08-test-plan.md`. Each step specifies:

- What to build
- What tests to write first (TDD red-green-refactor)
- Which acceptance criteria to validate
- Whether it can run in parallel with other steps

---

## Conventions

- `[PARALLEL]` — This step can be spawned as a subagent concurrently with other `[PARALLEL]` steps in the same wave.
- `[SEQUENTIAL]` — This step must wait for its stated prerequisites to complete.
- `[TEST-FIRST]` — Write the test before the implementation (strict TDD).
- `[VERIFY]` — Run the specified tests after implementation to confirm correctness.
- File paths are relative to the repository root unless stated otherwise.

---

## Wave 0: Foundation — SQLite Full Migration & Credential Service (No Phase 2 Dependencies)

### Step 0.1 [PARALLEL] — SQLite Complete: algo.db schema (LLD-01)

**Goal:** Create the `algo.db` schema for algorithm services — task state, document metadata, segment references.

**Test-first:**
- Test `algo.db` creates all tables without error.
- Test CRUD: insert parse task → query status → update status → verify.
- Test document metadata: insert → query by user_id → verify isolation.
- Test WAL mode and busy_timeout pragmas applied.

**Actions:**
1. Create `backend/algorithm/db/migrations/001_init.sql` with tables:
   - `parse_tasks` (id, document_id, user_id, status, segments_count, error, created_at, updated_at)
   - `documents` (id, user_id, source_path, filename, file_size, format, status, created_at)
   - `doc_segments` (id, document_id, user_id, chunk_index, content, title, segment_type, metadata, created_at)
2. Create `backend/algorithm/db/init.py` — SQLite initialization with pragmas.
3. Create `backend/algorithm/db/models.py` — SQLAlchemy models for all tables.
4. Write tests in `tests/algorithm/db/test_algo_db.py`.

**Verify:** algo.db unit tests pass. Schema matches LLD-01 §4.3.

---

### Step 0.2 [PARALLEL] — SQLite Complete: scan.db enhancements (LLD-01)

**Goal:** Enhance scan-control-plane SQLite schema for Phase 2 scan path management.

**Test-first:**
- Test scan_paths table CRUD (add path, list paths, remove path).
- Test scan_status tracking (idle, scanning, completed, error).
- Test file_count and last_scan_time persistence.

**Actions:**
1. Add migration `backend/scan-control-plane/migrations/sqlite/002_scan_paths.up.sql`:
   - `scan_paths` (id, path, user_id, status, file_count, last_scan_at, created_at)
2. Test with existing scan-control-plane startup flow.

**Verify:** scan.db migration applies cleanly. CRUD works.

---

### Step 0.3 [PARALLEL] — Credential Service: Keytar backend (LLD-07)

**Goal:** Implement Windows Credential Manager integration via keytar.

**Test-first:**
- Test `set → get` round-trip returns correct value.
- Test `delete` removes credential.
- Test `list` returns all accounts for a service.
- Test `isAvailable()` returns true on Windows with Credential Manager.
- Test validation rejects invalid service/account names.

**Actions:**
1. Add `keytar` to `desktop/package.json`.
2. Create `desktop/src/main/credentials/service.ts` — interface definition.
3. Create `desktop/src/main/credentials/backend.ts` — Keytar implementation.
4. Create `desktop/src/main/credentials/file-backend.ts` — AES-256-GCM encrypted file fallback.
5. Create `desktop/src/main/credentials/factory.ts` — backend selection.
6. Create `desktop/src/main/credentials/local-secret.ts` — persistent local secret.
7. Write tests in `desktop/tests/credentials/`.

**Verify:** Credential store round-trip tests pass. Fallback activates when keytar unavailable.

---

### Step 0.4 [PARALLEL] — Credential Service: IPC and bridge (LLD-07)

**Goal:** Expose credential service to renderer (IPC) and backend services (HTTP bridge).

**Prereqs:** Step 0.3 (credential service exists)

**Note:** Can start with interface definition while 0.3 completes implementation.

**Test-first:**
- Test IPC `credential:set` stores value retrievable via `credential:get`.
- Test IPC rejects invalid service names (validation).
- Test credential bridge route requires X-Desktop-Secret.
- Test credential bridge returns 401 without valid secret.
- Test credential bridge returns credential value for valid request.

**Actions:**
1. Create `desktop/src/main/ipc/credential-handlers.ts` per LLD-07 §4.4.
2. Create `desktop/src/main/proxy/credential-bridge.ts` per LLD-07 §4.7.
3. Add credential IPC channels to `SECURITY_CONFIG.allowedChannels`.
4. Update `desktop/src/preload/index.ts` — expose credential API methods.
5. Create `desktop/src/main/credentials/migration.ts` — plaintext migration utility.

**Verify:** IPC tests pass. Bridge returns credentials to authenticated backend requests.

---

### Step 0.5 [PARALLEL] — HybridRuntimeStore (LLD-05)

**Goal:** Implement SQLite-backed durable state for RuntimeStore (chat status, multi-answer, chat input).

**Test-first:**
- Test `SetChatStatus → restart → GetChatStatus` returns persisted value.
- Test "generating" on restart → becomes "interrupted".
- Test `AppendChatChunk → restart → GetChatChunks` returns empty (not persisted).
- Test `SetMultiAnswerInfo → restart → GetMultiAnswerInfo` returns correct data.
- Test `SetChatInput → restart → GetChatInput` returns correct data.
- Test cleanup removes records older than 7 days.
- Test concurrent SetChatStatus calls don't deadlock.

**Actions:**
1. Create `backend/core/store/hybrid_runtime_store.go` per LLD-05 §4.1.
2. Create `backend/core/migrations/sqlite/20260202000000_runtime_tables.up.sql` per LLD-05 §4.2.
3. Create `backend/core/migrations/sqlite/20260202000000_runtime_tables.down.sql`.
4. Modify `backend/core/store/runtime_store_factory.go` — add "hybrid" case.
5. Write tests in `backend/core/store/hybrid_runtime_store_test.go`.

**Verify:** Unit tests pass. Status survives simulated restart. Cloud Redis path unchanged.

---

## Wave 1: Vector & Segment Stores (Depends on Wave 0.1 for algo.db patterns)

### Step 1.1 [PARALLEL] — Milvus Lite VectorStore (LLD-02)

**Goal:** Implement `MilvusLiteStore` with full VectorStore protocol.

**Test-first:**
- Test `ensure_collection` creates collection with correct schema.
- Test `insert → search` returns correct top-k ordering.
- Test filter expressions work (filter by user_id, document_id).
- Test `delete` removes vectors (search no longer returns them).
- Test `drop_collection` removes all data.
- Test collection isolation: data in collection A not visible in collection B.
- Test persistence: insert → close → reopen → search finds data.
- Test Windows paths with spaces and Chinese characters.

**Actions:**
1. Create `backend/algorithm/vector/__init__.py`.
2. Create `backend/algorithm/vector/protocol.py` per LLD-02 §2.1.
3. Create `backend/algorithm/vector/milvus_lite_store.py` per LLD-02 §4.
4. Create `backend/algorithm/vector/milvus_cloud_store.py` — wrapper around existing code.
5. Create `backend/algorithm/vector/factory.py` per LLD-02 §2.4.
6. Create `backend/algorithm/vector/exceptions.py`.
7. Write tests in `tests/algorithm/vector/test_milvus_lite_store.py`.
8. Pin `pymilvus` version in `backend/algorithm/requirements.txt`.

**Verify:** All VectorStore protocol tests pass. P95 < 1s search with 10K vectors.

---

### Step 1.2 [PARALLEL] — SQLite FTS5 SegmentStore (LLD-03)

**Goal:** Implement `SQLiteSegmentStore` with FTS5 full-text search.

**Test-first:**
- Test Index 10 segments → Search by keyword → correct results returned.
- Test Delete by document_id → segments removed from search.
- Test user isolation: user A's segments not found by user B's search.
- Test BM25 scoring: more relevant results ranked higher.
- Test Chinese text search: character-level matching works.
- Test empty query returns empty results (no crash).
- Test Rebuild: delete all user segments → re-index → search works.
- Test persistence across process restart.

**Actions:**
1. Create `backend/core/segment/store.go` — interface definition per LLD-03 §2.1.
2. Create `backend/core/segment/sqlite_store.go` — FTS5 implementation per LLD-03 §4.
3. Create `backend/core/segment/opensearch_store.go` — wrapper around existing OpenSearch code.
4. Create `backend/core/segment/factory.go` — mode-based factory per LLD-03 §2.2.
5. Create `backend/core/segment/schema.sql` — FTS5 schema.
6. Write tests in `tests/backend/core/segment/sqlite_store_test.go`.
7. Modify `backend/core/main.go` — initialize SegmentStore from factory.

**Verify:** All SegmentStore interface tests pass. Search < 500ms for 10K segments. Cloud OpenSearch path unchanged.

---

## Wave 2: Algorithm Pipeline (Depends on Wave 0.1, Wave 1.1, Wave 1.2)

### Step 2.1 [SEQUENTIAL] — Consolidated algorithm-service skeleton (LLD-04)

**Goal:** Create the consolidated FastAPI application that replaces algorithm-mock.

**Test-first:**
- Test health check endpoint responds 200.
- Test all routers registered (chat, parse, processor, doc).
- Test service starts on port 8046.
- Test `LAZYMIND_MODE=desktop` activates local backends.

**Actions:**
1. Create `backend/algorithm/main.py` — FastAPI app with all routers.
2. Create `backend/algorithm/config.py` — service configuration.
3. Create `backend/algorithm/requirements.txt` — all Python dependencies.
4. Register routers: `/api/chat`, `/api/parse`, `/api/processor`, `/api/doc`.
5. Add health check at `/health`.
6. Configure CORS and middleware.

**Verify:** Service starts and passes health check.

---

### Step 2.2 [SEQUENTIAL] — Document parsing pipeline (LLD-04)

**Goal:** Implement parse task submission, text segmentation, and segment storage.

**Prereqs:** Step 2.1 (service skeleton), Step 0.1 (algo.db)

**Test-first:**
- Test markdown parsing splits by headers correctly.
- Test plain text parsing splits by paragraphs and respects max_chunk_size.
- Test Chinese markdown content segments correctly.
- Test segment overlap (200 chars) applied.
- Test parse task status transitions: queued → processing → completed.
- Test failed parse records error message.
- Test unsupported format returns degraded status with guidance.

**Actions:**
1. Create `backend/algorithm/parse/router.py` — parse task endpoints.
2. Create `backend/algorithm/parse/parser.py` — format detection and text extraction.
3. Create `backend/algorithm/parse/segmenter.py` — TextSegmenter per LLD-04 §4.4.
4. Create `backend/algorithm/parse/task_runner.py` — async task execution.
5. Wire parse endpoint: submit → enqueue → process → store segments.

**Verify:** Parse markdown → segments stored in algo.db. Task status tracking works.

---

### Step 2.3 [SEQUENTIAL] — Embedding integration (LLD-04)

**Goal:** Implement embedding model calls for document vectors and query vectors.

**Prereqs:** Step 2.2 (segments to embed), Step 0.3/0.4 (credential access for API keys)

**Test-first:**
- Test embedder calls API with correct batch format.
- Test embed returns vectors of configured dimension.
- Test embed_query returns single vector.
- Test retry on transient failure (1 retry).
- Test clear error when no model configured.
- Test mock embedder works for testing (deterministic hash-based).

**Actions:**
1. Create `backend/algorithm/embedding/embedder.py` per LLD-04 §4.5.
2. Create `backend/algorithm/embedding/mock_embedder.py` — for testing without real API.
3. Create `backend/algorithm/models/config.py` — model config management.
4. Create `backend/algorithm/models/provider.py` — provider abstraction (DashScope, OpenAI, local).
5. Wire: parse complete → embed segments → insert vectors to Milvus Lite.

**Verify:** End-to-end: markdown → parse → embed → vectors in Milvus Lite.

---

### Step 2.4 [SEQUENTIAL] — RAG query pipeline (LLD-04)

**Goal:** Implement hybrid retrieval (vector + keyword) and LLM generation with streaming.

**Prereqs:** Steps 2.2, 2.3, 1.1 (Milvus Lite), 1.2 (SegmentStore)

**Test-first:**
- Test vector search returns top-k candidates.
- Test keyword search (FTS) returns top-k candidates.
- Test reciprocal rank fusion merges and reranks correctly.
- Test context building includes relevant segments.
- Test LLM streaming produces SSE events in order.
- Test "no model configured" returns guidance message (not error).
- Test sources included in final SSE event.

**Actions:**
1. Create `backend/algorithm/chat/router.py` — chat endpoints.
2. Create `backend/algorithm/chat/rag_pipeline.py` per LLD-04 §4.3.
3. Create `backend/algorithm/chat/stream.py` — SSE streaming.
4. Wire: query → embed → vector search + FTS search → merge → build prompt → LLM → SSE.

**Verify:** End-to-end RAG: question → retrieves context → generates answer with sources.

---

### Step 2.5 [SEQUENTIAL] — SSE passthrough in core (LLD-04)

**Goal:** Ensure core service passes through SSE streams from algorithm-service without buffering.

**Prereqs:** Step 2.4 (algorithm-service streams SSE)

**Test-first:**
- Test SSE events pass through core proxy in real-time (no buffering).
- Test content-type `text/event-stream` preserved.
- Test client disconnect propagates to algorithm-service.
- Test error events (model error) pass through correctly.

**Actions:**
1. Modify `backend/core/chat/handler.go` — implement SSE passthrough to algorithm-service.
2. Verify local proxy (Electron) also passes SSE without buffering (already designed for streaming).

**Verify:** Renderer → proxy → core → algorithm-service → SSE flows end-to-end.

---

## Wave 3: Model Configuration & Process Manager Update (Depends on Wave 0.3, 0.4)

### Step 3.1 [PARALLEL] — Model configuration CRUD (LLD-04 §4.6)

**Goal:** Implement model config storage and management API in core.

**Test-first:**
- Test create model config → stored in main.db.
- Test list model configs → returns all configured providers.
- Test update model config → changes persisted.
- Test delete model config → removed.
- Test API key stored via credential service (not in main.db).
- Test `test_connection` validates model endpoint reachability.
- Test default model selection (chat default, embedding default).

**Actions:**
1. Add model_configs table to core SQLite migration:
   - `model_configs` (id, provider, model_name, endpoint, is_default_chat, is_default_embedding, capabilities, created_at, updated_at)
2. Create core API endpoints: GET/POST/PUT/DELETE `/api/core/model-configs`.
3. Create `GET /api/core/model-configs/{id}/key` (internal, secret-protected) — retrieves key from credential bridge.
4. Create `POST /api/core/model-configs/{id}/test` — test connection.

**Verify:** Model config CRUD works. API key stored in credential store, not DB.

---

### Step 3.2 [PARALLEL] — Process manager update (LLD-04 §4.1)

**Goal:** Replace algorithm-mock with real algorithm-service in process manager configs.

**Test-first:**
- Test algorithm-service process config has correct env vars.
- Test algorithm-service starts and passes health check.
- Test LAZYMIND_STATE_BACKEND=hybrid in core config.
- Test all env vars injected correctly (ALGO_DATABASE_URL, LAZYMIND_VECTOR_DIR, etc.).

**Actions:**
1. Modify `desktop/src/main/process-manager/configs.ts`:
   - Replace `algorithm-mock` entry with `algorithm-service` (Python, port 8046).
   - Change core's `LAZYMIND_STATE_BACKEND` from "memory" to "hybrid".
   - Add all Phase 2 env vars per LLD-04 §6.
2. Update dependencies: algorithm-service depends on core (for model config API).

**Verify:** Process manager starts algorithm-service. Health check passes within 30s.

---

## Wave 4: Frontend Complete (Depends on Wave 2 for APIs, Wave 3.1 for model config)

### Step 4.1 [PARALLEL] — Desktop API layer (LLD-06 §2.1)

**Goal:** Create typed frontend API client for all Desktop-specific endpoints.

**Test-first:**
- Test API client methods call correct endpoints.
- Test error handling for 4xx/5xx responses.
- Test request includes correct headers.

**Actions:**
1. Create `frontend/src/api/desktop.ts` per LLD-06 §2.1 — DesktopAPI interface and implementation.
2. Create methods: listAssistants, createAssistant, updateAssistant, deleteAssistant, listScanPaths, addScanPath, removeScanPath, triggerScan, getIndexStatus, getParseTaskStatus, listModelConfigs, createModelConfig, updateModelConfig, deleteModelConfig, testModelConfig.

**Verify:** API client compiles. Methods match backend endpoint signatures.

---

### Step 4.2 [PARALLEL] — Assistant Management page (LLD-06 §4.1)

**Goal:** Full assistant CRUD UI at `/assistants`.

**Test-first:**
- Test AssistantManagement renders list of assistants.
- Test Create modal submits correct data.
- Test Edit inline saves changes.
- Test Delete shows confirmation dialog.
- Test current assistant highlighted.
- Test page only accessible in Desktop mode (route guard).

**Actions:**
1. Create `frontend/src/modules/assistants/AssistantManagement.tsx`.
2. Create `frontend/src/modules/assistants/AssistantCard.tsx`.
3. Create `frontend/src/modules/assistants/CreateAssistantModal.tsx`.
4. Create `frontend/src/router/guards.tsx` — DesktopOnlyRoute per LLD-06 §4.9.
5. Add `/assistants` route to router with DesktopOnlyRoute guard.

**Verify:** Create/edit/delete assistants works. Page hidden in Cloud mode.

---

### Step 4.3 [PARALLEL] — Enhanced AssistantSwitcher (LLD-06 §4.2)

**Goal:** Upgrade AssistantSwitcher with avatar, description, count badge, keyboard shortcut.

**Test-first:**
- Test shows avatar + displayName + description snippet.
- Test dropdown lists all assistants.
- Test badge shows total count.
- Test "Manage assistants" link navigates to /assistants.
- Test Ctrl+Shift+A opens switcher.

**Actions:**
1. Modify `frontend/src/components/AssistantSwitcher/index.tsx` per LLD-06 §4.2.
2. Add keyboard shortcut registration.
3. Add "Manage assistants" link.

**Verify:** Switcher shows full assistant info. Keyboard shortcut works.

---

### Step 4.4 [PARALLEL] — Scan Path Management UI (LLD-06 §4.3)

**Goal:** UI for managing document scan paths.

**Test-first:**
- Test renders list of configured scan paths.
- Test "Add folder" calls window.lazymind.pickFolder().
- Test per-path status displayed (idle/scanning/error).
- Test "Scan now" button triggers scan.
- Test "Remove" button with confirmation.
- Test file count and last scan time displayed.

**Actions:**
1. Create `frontend/src/modules/data-sources/ScanPathPanel.tsx` per LLD-06 §4.3.
2. Create `frontend/src/modules/data-sources/IndexStatus.tsx` per LLD-06 §4.4.
3. Integrate into existing Data Sources page.

**Verify:** Add/remove scan paths. Status updates reflected in UI.

---

### Step 4.5 [PARALLEL] — Model Configuration page (LLD-06 §4.5)

**Goal:** Desktop-specific model provider management UI.

**Test-first:**
- Test renders list of configured providers.
- Test Add provider form submits correctly.
- Test API key field masked (last 4 chars only).
- Test "Test connection" button calls API and shows result.
- Test status display: Connected / Failed / Not configured.
- Test no model → prominent setup banner.
- Test API key stored via IPC credential:set (not sent to backend in body).

**Actions:**
1. Create `frontend/src/modules/model-providers/ModelConfigDesktop.tsx` per LLD-06 §4.5.
2. Create `frontend/src/modules/model-providers/TestConnectionButton.tsx`.
3. Integrate credential IPC for API key storage.

**Verify:** Model CRUD works. API keys masked. Test connection functional.

---

### Step 4.6 [PARALLEL] — Chat UI enhancements (LLD-06 §4.6)

**Goal:** RAG sources display, interrupted message recovery, streaming indicator.

**Test-first:**
- Test SourcesList renders sources with title, preview, score.
- Test sources collapsible (click to expand).
- Test InterruptedMessage shows "该对话因应用重启中断" with retry button.
- Test MockModelWarning hidden when real model configured.
- Test streaming indicator shown during generation.

**Actions:**
1. Create `frontend/src/modules/chat/components/SourcesList.tsx` per LLD-06 §4.6.
2. Create `frontend/src/modules/chat/components/InterruptedMessage.tsx`.
3. Modify `frontend/src/modules/chat/components/MessageBubble.tsx` — show sources.
4. Update chat page: hide MockModelWarning when model configured.

**Verify:** Sources display in chat. Interrupted state shows retry. Streaming works.

---

### Step 4.7 [PARALLEL] — Service Status Differentiation (LLD-06 §4.7)

**Goal:** Actionable status messages in ServiceStatusBar.

**Test-first:**
- Test all healthy → green dot.
- Test service starting → yellow + "启动中...".
- Test service failed → red + service name + "查看日志" link.
- Test no model configured → orange banner + "配置模型" link.
- Test index empty → info banner + "添加文档" link.

**Actions:**
1. Modify `frontend/src/components/ServiceStatusBar/index.tsx` per LLD-06 §4.7.
2. Add actionable links (navigate to relevant settings page).
3. Add model/index status polling from desktop store.

**Verify:** All status states render correctly with appropriate actions.

---

### Step 4.8 [SEQUENTIAL] — Data isolation on assistant switch (LLD-06 §4.8)

**Goal:** Verify all pages refresh correctly when assistant changes.

**Prereqs:** Steps 4.2–4.7 (pages exist to verify)

**Test-first:**
- Test assistant switch updates desktop store.
- Test chat history sidebar refreshes (new assistant's conversations).
- Test knowledge base page refreshes.
- Test memory page refreshes.
- Test no manual refresh needed (reactive via Zustand).

**Actions:**
1. Modify `frontend/src/stores/desktop.ts` — add scan/parse/model state sections.
2. Ensure all data-fetching hooks subscribe to currentAssistant changes.
3. Verify `syncAuthState()` updates localStorage correctly on switch.

**Verify:** Switch assistant → all pages show correct data. No stale state.

---

## Wave 5: Integration Testing (Depends on Waves 0–4)

### Step 5.1 [PARALLEL] — Integration test framework setup

**Goal:** Set up test infrastructure for integration and E2E tests.

**Actions:**
1. Create `tests/integration/` directory structure per LLD-08.
2. Create `tests/fixtures/documents/` with test files (sample-markdown.md, sample-large.md, etc.).
3. Create `tests/mocks/model_server.py` — mock LLM/embedding server.
4. Create `tests/conftest.py` — shared fixtures (temp data dirs, service startup).
5. Create CI workflow `.github/workflows/desktop-tests.yml`.

**Verify:** Test framework runs. Mock model server starts.

---

### Step 5.2 [PARALLEL] — Document pipeline integration test

**Goal:** Validate parse → index → search end-to-end.

**Prereqs:** Wave 2 (algorithm pipeline), Step 5.1 (fixtures)

**Actions:**
1. Write `tests/integration/algorithm/test_document_pipeline.py` per LLD-08 §3.1.
2. Test: submit markdown → wait for parse complete → verify vectors in Milvus → verify FTS indexed.
3. Test: delete document → verify removed from all stores.

**Verify:** E2E document pipeline test passes.

---

### Step 5.3 [PARALLEL] — Chat RAG integration test

**Goal:** Validate question → retrieval → generation → sources.

**Prereqs:** Wave 2 (RAG pipeline), Step 5.1 (mock model)

**Actions:**
1. Write `tests/integration/algorithm/test_chat_rag.py` per LLD-08 §3.2.
2. Test: send question → SSE stream → sources in final event.
3. Test: no model → guidance message.

**Verify:** Chat RAG integration test passes with mock model.

---

### Step 5.4 [PARALLEL] — 50-assistant isolation test

**Goal:** Verify data isolation with 50 concurrent assistants.

**Prereqs:** Wave 2 (pipeline), Step 5.1 (framework)

**Actions:**
1. Write `tests/integration/algorithm/test_assistant_isolation.py` per LLD-08 §3.4.
2. Create 50 assistants, each with unique document.
3. Verify search isolation: each assistant only finds their own data.
4. Verify chat isolation: RAG doesn't leak cross-assistant.
5. Verify delete isolation: deleting one doesn't affect others.

**Verify:** 50-assistant isolation test passes.

---

### Step 5.5 [PARALLEL] — Runtime store recovery test

**Goal:** Verify chat state survives restart.

**Prereqs:** Step 0.5 (HybridRuntimeStore)

**Actions:**
1. Write `tests/integration/backend/runtime_recovery_test.go` per LLD-08 §3.3.
2. Test: set status → close → reopen → status persisted.
3. Test: "generating" on restart → "interrupted".
4. Test: ephemeral data (chunks, signals) NOT persisted.

**Verify:** Recovery tests pass.

---

## Wave 6: Performance Benchmarks (Depends on Waves 1–2)

### Step 6.1 [PARALLEL] — Cold start benchmark

**Goal:** Measure and validate startup time < 60s.

**Actions:**
1. Write `tests/benchmarks/cold_start_test.go` per LLD-08 §4.1.
2. Measure: process launch → all health checks passing.
3. Assert < 60s target.

**Verify:** Cold start < 60s on CI runner.

---

### Step 6.2 [PARALLEL] — Search latency benchmark

**Goal:** Validate vector search P95 < 1s at 10K vectors.

**Actions:**
1. Write `tests/benchmarks/search_latency.py` per LLD-08 §4.2.
2. Corpus sizes: 1K, 5K, 10K, 50K vectors.
3. 100 queries per size, measure P50/P95/P99.
4. Assert P95 < 1s and P99 < 2s at 10K.

**Verify:** Search latency meets HLD targets.

---

### Step 6.3 [PARALLEL] — Memory usage benchmark

**Goal:** Validate algorithm-service < 500MB baseline.

**Actions:**
1. Write `tests/benchmarks/memory_usage.py` per LLD-08 §4.3.
2. Measure baseline (empty corpus).
3. Measure at 100, 1000, 5000 documents.
4. Assert baseline < 500MB.

**Verify:** Memory within bounds.

---

### Step 6.4 [PARALLEL] — Parse throughput benchmark

**Goal:** Validate 100KB markdown < 30s total pipeline time.

**Actions:**
1. Write `tests/benchmarks/parse_throughput.py` per LLD-08 §4.4.
2. Use `sample-large.md` (100KB).
3. Measure total time: submit → completed (segment + embed + index).
4. Assert < 30s.

**Verify:** Parse throughput meets target.

---

## Wave 7: E2E and Cloud Regression (Final validation)

### Step 7.1 [SEQUENTIAL] — Full E2E flow

**Goal:** Validate complete user flow: create assistant → add docs → parse → ask question → get RAG answer.

**Prereqs:** All prior waves.

**Actions:**
1. Write Playwright E2E test:
   - Launch Electron app.
   - Create new assistant.
   - Add scan path (mock folder with test document).
   - Wait for parse to complete.
   - Switch to new assistant.
   - Ask question related to document content.
   - Verify answer includes relevant sources.
2. Validate service status bar shows all healthy.
3. Validate interrupted state recovery (kill mid-stream, restart, see interrupted UI).

**Verify:** Full E2E flow passes.

---

### Step 7.2 [PARALLEL] — Cloud mode regression: Go core

**Goal:** Verify Go core changes don't break Cloud mode.

**Actions:**
1. Run existing Go core tests with PostgreSQL driver.
2. Verify Redis RuntimeStore path still works.
3. Verify OpenSearch SegmentStore path still works.
4. Verify no new imports required for Cloud builds.

**Verify:** All existing Cloud tests pass.

---

### Step 7.3 [PARALLEL] — Cloud mode regression: Python services

**Goal:** Verify Python service changes don't break Cloud mode.

**Actions:**
1. Run auth-service tests with PostgreSQL + Redis.
2. Verify Desktop router NOT registered without `LAZYMIND_MODE=desktop`.
3. Verify algorithm services (Cloud topology) still work independently.

**Verify:** Cloud Python tests pass.

---

### Step 7.4 [PARALLEL] — Cloud mode regression: Frontend

**Goal:** Verify frontend Cloud build unaffected.

**Actions:**
1. Run `pnpm build` (Cloud mode, no VITE_LAZYMIND_MODE).
2. Verify Desktop-only pages not included in routing.
3. Verify no Desktop components render without `window.lazymind`.

**Verify:** Cloud frontend build succeeds. No Desktop leakage.

---

## Parallelism Summary

```
Wave 0: [PARALLEL x5]  0.1, 0.2, 0.3, 0.4, 0.5
Wave 1: [PARALLEL x2]  1.1, 1.2
Wave 2: [SEQUENTIAL]   2.1 → 2.2 → 2.3 → 2.4 → 2.5
Wave 3: [PARALLEL x2]  3.1, 3.2
Wave 4: [PARALLEL x7]  4.1–4.7  →  then [SEQ] 4.8
Wave 5: [PARALLEL x5]  5.1, 5.2, 5.3, 5.4, 5.5
Wave 6: [PARALLEL x4]  6.1, 6.2, 6.3, 6.4
Wave 7: [SEQUENTIAL]   7.1  →  [PARALLEL x3] 7.2, 7.3, 7.4
```

**Cross-wave parallelism:**
- Wave 0 completes → Wave 1, 3 can start.
- Wave 1 completes → Wave 2 can start.
- Wave 2+3 complete → Wave 4 can start.
- Wave 0–4 complete → Wave 5, 6 can start.
- Wave 5, 6 complete → Wave 7 starts.

**Maximum concurrent subagents at any point: 7** (Wave 4 steps 4.1–4.7).

**Critical path:** Wave 0 → Wave 1 → Wave 2 (2.1→2.2→2.3→2.4→2.5) → Wave 4 (4.8) → Wave 7

**Total estimated steps:** 33

---

## Agent Instructions

When executing this plan:

1. **Always write tests first** for steps marked `[TEST-FIRST]`. The test should fail initially (red), then implement until green.
2. **For `[PARALLEL]` steps within the same wave**, spawn separate subagents. Each subagent receives:
   - This implementation plan section for their step
   - The relevant LLD file(s)
   - The test plan file (08-test-plan.md)
3. **For `[SEQUENTIAL]` steps**, complete them in order within the same agent context.
4. **After each step**, run the specified `[VERIFY]` tests. If any fail, fix before proceeding.
5. **Never skip security requirements.** Model API keys must use credential store. Secrets must not appear in logs.
6. **Cloud mode must never break.** After modifying any shared backend code, run regression tests (Wave 7 steps).
7. **Commit after each completed wave** with a descriptive message summarizing what was implemented.
8. **Mock model server** — For integration tests that need LLM/embedding responses, use the mock model server (deterministic, hash-based embeddings). Never call real external APIs in CI tests.
9. **Windows paths** — All file path operations must handle Windows paths (backslashes, spaces, Chinese characters, long paths).
10. **If blocked**, check if the blocking dependency is available via its interface contract (Protocol/interface) rather than full implementation. Many steps can begin with mocked dependencies.

---

## File Reference

| Step | Primary Files Created/Modified |
|------|-------------------------------|
| 0.1 | `backend/algorithm/db/migrations/`, `backend/algorithm/db/*.py` |
| 0.2 | `backend/scan-control-plane/migrations/sqlite/002_*.sql` |
| 0.3 | `desktop/src/main/credentials/*.ts` |
| 0.4 | `desktop/src/main/ipc/credential-handlers.ts`, `desktop/src/main/proxy/credential-bridge.ts` |
| 0.5 | `backend/core/store/hybrid_runtime_store.go`, `backend/core/migrations/sqlite/` |
| 1.1 | `backend/algorithm/vector/*.py` |
| 1.2 | `backend/core/segment/*.go` |
| 2.1 | `backend/algorithm/main.py`, `backend/algorithm/config.py` |
| 2.2 | `backend/algorithm/parse/*.py` |
| 2.3 | `backend/algorithm/embedding/*.py`, `backend/algorithm/models/*.py` |
| 2.4 | `backend/algorithm/chat/*.py` |
| 2.5 | `backend/core/chat/handler.go` |
| 3.1 | `backend/core/` (model_configs table + API), credential bridge integration |
| 3.2 | `desktop/src/main/process-manager/configs.ts` |
| 4.1 | `frontend/src/api/desktop.ts` |
| 4.2 | `frontend/src/modules/assistants/*.tsx`, `frontend/src/router/guards.tsx` |
| 4.3 | `frontend/src/components/AssistantSwitcher/index.tsx` |
| 4.4 | `frontend/src/modules/data-sources/ScanPathPanel.tsx`, `IndexStatus.tsx` |
| 4.5 | `frontend/src/modules/model-providers/ModelConfigDesktop.tsx` |
| 4.6 | `frontend/src/modules/chat/components/SourcesList.tsx`, `InterruptedMessage.tsx` |
| 4.7 | `frontend/src/components/ServiceStatusBar/index.tsx` |
| 4.8 | `frontend/src/stores/desktop.ts` |
| 5.1–5.5 | `tests/integration/`, `tests/fixtures/`, `tests/mocks/` |
| 6.1–6.4 | `tests/benchmarks/` |
| 7.1 | `tests/integration/e2e/` |
| 7.2–7.4 | Existing test suites (verification only) |

---

## Acceptance Criteria Traceability

Every acceptance criterion from LLD modules 01–08 is covered by at least one step:

| LLD | Key Criteria | Covered In |
|-----|-------------|------------|
| 01 | algo.db schema works | Step 0.1 |
| 01 | scan.db scan path management | Step 0.2 |
| 02 | Milvus Lite protocol tests pass | Step 1.1 |
| 02 | Data persists across restart | Step 1.1 |
| 02 | Per-assistant collection isolation | Steps 1.1, 5.4 |
| 02 | P95 < 1s search | Steps 1.1, 6.2 |
| 03 | SQLiteSegmentStore implements interface | Step 1.2 |
| 03 | Chinese text search works | Step 1.2 |
| 03 | User data isolation | Steps 1.2, 5.4 |
| 03 | Search < 500ms for 10K segments | Steps 1.2, 6.2 |
| 04 | Consolidated service starts | Step 2.1 |
| 04 | Document parsing works | Steps 2.2, 5.2 |
| 04 | RAG chat works | Steps 2.4, 5.3 |
| 04 | SSE streaming end-to-end | Step 2.5 |
| 04 | No model → guidance message | Steps 2.4, 5.3 |
| 04 | Assistant isolation in RAG | Step 5.4 |
| 04 | Cold start < 30s | Steps 3.2, 6.1 |
| 04 | Memory < 500MB | Step 6.3 |
| 05 | Chat status persists | Steps 0.5, 5.5 |
| 05 | "generating" → "interrupted" | Steps 0.5, 5.5 |
| 05 | Ephemeral data not persisted | Steps 0.5, 5.5 |
| 05 | Cleanup removes stale records | Step 0.5 |
| 05 | Cloud Redis unchanged | Step 7.2 |
| 06 | Assistant management CRUD | Step 4.2 |
| 06 | Scan path management UI | Step 4.4 |
| 06 | Model config UI | Step 4.5 |
| 06 | Chat shows RAG sources | Step 4.6 |
| 06 | Interrupted state with retry | Step 4.6 |
| 06 | Service status differentiation | Step 4.7 |
| 06 | Assistant switch → all pages refresh | Step 4.8 |
| 06 | Desktop pages hidden in Cloud | Steps 4.2, 7.4 |
| 07 | API keys in Credential Manager | Steps 0.3, 0.4 |
| 07 | Local secret persists | Step 0.3 |
| 07 | Backend retrieves keys via bridge | Step 0.4 |
| 07 | Fallback to encrypted file | Step 0.3 |
| 07 | Migration from plaintext | Step 0.4 |
| 07 | No secrets in logs | Steps 0.3, 5.1 |
| 08 | Integration test framework | Step 5.1 |
| 08 | Document pipeline E2E | Step 5.2 |
| 08 | Chat RAG E2E | Step 5.3 |
| 08 | 50-assistant isolation | Step 5.4 |
| 08 | Cold start < 60s | Step 6.1 |
| 08 | Search P95 < 1s | Step 6.2 |
| 08 | Memory < 500MB | Step 6.3 |
| 08 | Parse 100KB < 30s | Step 6.4 |

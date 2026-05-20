# Phase 1 MVP Implementation Plan

## Purpose

This document is a machine-readable implementation plan for Claude Code agents. It drives TDD development of LazyMind Desktop Mode Phase 1 MVP, following the dependency order defined in the LLD and validated by `09-test-plan.md`. Each step specifies:

- What to build
- What tests to write first (TDD red-green-refactor)
- Which test IDs from `09-test-plan.md` to validate
- Whether it can run in parallel with other steps

---

## Conventions

- `[PARALLEL]` — This step can be spawned as a subagent concurrently with other `[PARALLEL]` steps in the same wave.
- `[SEQUENTIAL]` — This step must wait for its stated prerequisites to complete.
- `[TEST-FIRST]` — Write the test before the implementation (strict TDD).
- `[VERIFY]` — Run the specified test IDs after implementation to confirm correctness.
- File paths are relative to the repository root unless stated otherwise.

---

## Wave 0: Project Scaffolding (No Dependencies)

### Step 0.1 [PARALLEL] — Initialize Electron project structure

**Goal:** Create `desktop/` directory skeleton with package.json, tsconfig, and empty module directories.

**Actions:**
1. Create `desktop/package.json` with dependencies: `electron`, `electron-builder`, `http-proxy`, `archiver`, `yaml`.
2. Create `desktop/tsconfig.json` and `desktop/tsconfig.node.json`.
3. Create `desktop/electron-builder.yml` per LLD-01 §6.1.
4. Create directory structure:
   ```
   desktop/src/main/
   desktop/src/main/ipc/
   desktop/src/main/process-manager/
   desktop/src/main/proxy/
   desktop/src/main/logger/
   desktop/src/main/diagnostics/
   desktop/src/main/security/
   desktop/src/preload/
   desktop/src/shared/
   desktop/resources/icons/
   desktop/resources/default-docs/
   desktop/resources/templates/
   ```
5. Create `desktop/src/shared/types.ts` with all shared type definitions (DataDirPaths, ServiceStatus, ProcessState, AssistantInfo, etc.) from LLD-01 §2.
6. Create `desktop/src/shared/constants.ts` with port assignments, protocol scheme name.
7. Create `desktop/resources/templates/default_config.yaml` per LLD-01 §6.3.
8. Create `desktop/resources/default-docs/solar-system.md` — approx 100KB Markdown about the solar system.
9. Create `desktop/resources/splash.html` — minimal splash screen.
10. Create placeholder icon files.
11. Run `cd desktop && npm install` to verify dependency resolution.

**Validation:** `npm install` succeeds. Directory structure matches LLD-01 §4.1.

---

### Step 0.2 [PARALLEL] — Security config constants

**Goal:** Establish security configuration as the first thing, so all subsequent code references it.

**Actions:**
1. Create `desktop/src/main/security/config.ts` per LLD-08 §2.4. Contains:
   - `SECURITY_CONFIG.browserWindow` defaults
   - `SECURITY_CONFIG.csp` string
   - `SECURITY_CONFIG.allowedChannels` array (all 13 IPC channels)
   - `SECURITY_CONFIG.localBind`
   - `SECURITY_CONFIG.allowedOrigins`

**Validation:** File compiles. All constants are exported.

---

### Step 0.3 [PARALLEL] — IPC channel registry and security utilities

**Goal:** Define the IPC registry and security validation helpers before any handler implementation.

**Actions:**
1. Create `desktop/src/main/ipc/registry.ts` per LLD-01 §2.2.
2. Create `desktop/src/main/ipc/security.ts` per LLD-08 §4.8 with `secureHandle()` and `validatePath()`.

**Test-first:**
- Write unit tests for `validatePath()`:
  - Rejects `../../../etc` (path traversal)
  - Rejects paths outside allowed prefixes
  - Accepts paths within allowed prefixes
  - Handles Windows-style paths with backslashes
- Maps to test plan: **M1-X05**

**Validation:** Unit tests pass.

---

## Wave 1: Core Electron Modules (Depends on Wave 0)

### Step 1.1 [PARALLEL] — Data directory manager

**Goal:** Implement `data-dir.ts` that creates and returns the data directory structure.

**Prereqs:** Step 0.1

**Test-first:**
- Test `getDataDir()` returns correct structure with all expected keys.
- Test `ensureDataDir()` creates all directories.
- Test `copyDefaultDocs()` is idempotent (second call no-ops).
- Test default config is created on first run.

**Actions:**
1. Implement `desktop/src/main/data-dir.ts` per LLD-01 §4.5.
2. Wire up `LAZYMIND_DATA_DIR` env var override for testing.

**Verify:** **M1-S03**, **M1-S04**, **M1-C02**

---

### Step 1.2 [PARALLEL] — Custom protocol registration

**Goal:** Register `lazymind://` protocol to serve static frontend assets.

**Prereqs:** Step 0.1, Step 0.2

**Test-first:**
- Test protocol handler resolves file paths correctly.
- Test SPA fallback: unknown paths return `index.html`.
- Test CSP header is injected on responses.
- Test Windows path handling (leading slash removal).

**Actions:**
1. Implement `desktop/src/main/protocol.ts` per LLD-01 §4.3.
2. Add CSP header injection per LLD-08 §4.7.2.
3. Implement `getRendererURL()` that returns dev URL or protocol URL.

**Verify:** **M1-S02**, **M1-X02**

---

### Step 1.3 [PARALLEL] — Window manager

**Goal:** Create main window and splash window with secure defaults.

**Prereqs:** Step 0.2 (security config), Step 1.2 (protocol URL)

**Test-first:**
- Test BrowserWindow config matches SECURITY_CONFIG.browserWindow.
- Test navigation restriction blocks external URLs.
- Test `setWindowOpenHandler` denies new windows.
- Test single instance lock.

**Actions:**
1. Implement `desktop/src/main/window.ts` per LLD-01 §4.4.
2. Implement `desktop/src/main/lifecycle.ts` per LLD-01 §4.8.
3. Use `SECURITY_CONFIG` from Step 0.2 for all window preferences.

**Verify:** **M1-X01**, **M1-X03**, **M1-X04**, **M1-S05**

---

### Step 1.4 [PARALLEL] — Logger and sanitizer

**Goal:** Implement log collection infrastructure.

**Prereqs:** Step 1.1 (data dir for log paths)

**Test-first:**
- Test sanitizer redacts `sk-xxx...` patterns.
- Test sanitizer redacts `api_key=xxx` patterns.
- Test sanitizer redacts Bearer tokens.
- Test sanitizer redacts X-Desktop-Secret.
- Test RotatingFileWriter rotates at max size.
- Test RotatingFileWriter keeps max N files.
- Maps to: **M8-X01**, **M8-X02**, **M8-C01**, **M8-C02**

**Actions:**
1. Implement `desktop/src/main/logger/sanitizer.ts` per LLD-08 §4.4.
2. Implement `desktop/src/main/logger/file-writer.ts` per LLD-08 §4.3.
3. Implement `desktop/src/main/logger/index.ts` per LLD-08 §2.1.

**Verify:** **M8-S01**, **M8-C01**, **M8-C02**, **M8-X01**

---

### Step 1.5 [PARALLEL] — Diagnostics exporter

**Goal:** Implement diagnostics zip export.

**Prereqs:** Step 1.1 (data dir), Step 1.4 (sanitizer)

**Test-first:**
- Test diagnostics zip contains expected files (system-info.json, config-summary.json, service-status.json, logs/).
- Test zip does NOT contain SQLite files, user documents, vector data.
- Test config-summary.json has keys redacted.
- Maps to: **M8-S02**, **M8-C03**, **M8-C04**, **M8-X02**

**Actions:**
1. Implement `desktop/src/main/diagnostics/exporter.ts` per LLD-08 §4.5.
2. Implement `desktop/src/main/diagnostics/collectors.ts`.
3. Implement `desktop/src/main/diagnostics/index.ts`.

**Verify:** **M8-S02**, **M8-C03**, **M8-C04**, **M8-X02**

---

### Step 1.6 [PARALLEL] — Preload script and IPC handlers (shell)

**Goal:** Implement preload script exposing `window.lazymind` and basic IPC handlers (data dir, dialog, app info).

**Prereqs:** Step 0.3 (registry, security), Step 1.1 (data dir)

**Test-first:**
- Test `window.lazymind` object shape has all expected methods.
- Test `dialog:pickFolder` IPC handler is registered.
- Test `shell:openPath` rejects paths outside allowed dirs.
- Test `app:getVersion`, `app:isPackaged`, `app:getMode` handlers return correct types.
- Maps to: **M1-C01**, **M1-C02**, **M1-C03**, **M1-C04**, **M1-C05**, **M1-X05**, **M8-X03**

**Actions:**
1. Implement `desktop/src/preload/index.ts` per LLD-01 §4.6.
2. Implement `desktop/src/main/ipc/dialog.ts` per LLD-01 §4.7.
3. Implement `desktop/src/main/ipc/app-info.ts`.
4. Implement `desktop/src/main/ipc/diagnostics.ts` (wires to Step 1.5).
5. Implement `desktop/src/main/ipc/handlers.ts` that registers all handlers using `secureHandle()`.

**Verify:** **M1-C01** through **M1-C05**, **M1-X05**, **M8-X03**

---

### Step 1.7 [SEQUENTIAL] — Main process entry point (integrate Wave 1)

**Goal:** Wire up `desktop/src/main/index.ts` to integrate all Wave 1 outputs.

**Prereqs:** Steps 1.1–1.6 all complete.

**Actions:**
1. Implement `desktop/src/main/index.ts` per LLD-01 §4.2.
2. Connect: protocol registration → data dir init → IPC registration → splash → main window.
3. Add `npm run dev` script to `desktop/package.json` using electron.
4. Verify the app starts, shows splash, then main window.

**Verify:** **M1-S01** (dev mode startup, main window visible)

---

## Wave 2: Backend Adaptations (Can start parallel to Wave 1)

### Step 2.1 [PARALLEL] — SQLite migration: Go core

**Goal:** Create SQLite migration directory and configure Go core for SQLite.

**Prereqs:** None (pure backend work, only needs data dir path format knowledge from LLD-05 §2.3)

**Test-first:**
- Test Go core starts with `ACL_DB_DRIVER=sqlite` and `ACL_DB_DSN=:memory:` or temp file.
- Test migration files apply cleanly on SQLite.
- Test PRAGMA settings (WAL, busy_timeout, foreign_keys).
- Test basic CRUD (create user, create conversation, read back).
- Maps to: **M5-S01**, **M5-S04**, **M5-C01**, **M5-C02**, **M5-C03**, **M5-C04**, **M5-C05**

**Actions:**
1. Create `backend/core/migrations/sqlite/000001_init_schema.up.sql` — consolidated schema from all PG migrations, rewritten for SQLite.
2. Create `backend/core/migrations/sqlite/000001_init_schema.down.sql`.
3. Modify `backend/core/common/orm/db.go` to add `configureSQLite()` per LLD-05 §4.1.2.
4. Modify migration runner to select directory based on driver per LLD-05 §4.1.3.
5. Audit all migration SQL for PG-only syntax (UUID, SERIAL, JSONB, TIMESTAMPTZ, arrays, CONCURRENTLY).

**Verify:** **M5-S01**, **M5-S04**, **M5-C01**–**M5-C05**, **M5-R01** (PG still works)

---

### Step 2.2 [PARALLEL] — SQLite migration: Python auth-service

**Goal:** Ensure auth-service Alembic migrations work on SQLite.

**Prereqs:** None

**Test-first:**
- Test auth-service starts with `LAZYMIND_DATABASE_URL=sqlite:///test.db`.
- Test Alembic `upgrade head` completes without error on SQLite.
- Test user CRUD on SQLite.
- Test `render_as_batch` mode is enabled for SQLite.
- Maps to: **M5-S02**

**Actions:**
1. Modify `backend/auth-service/alembic/env.py` to set `render_as_batch=True` when SQLite detected per LLD-05 §4.2.2.
2. Modify `backend/auth-service/core/database.py` to add SQLite pragma event listener per LLD-05 §4.2.4.
3. Audit all Alembic versions for PG-only types (Enum, ARRAY, gen_random_uuid).
4. Fix any incompatible migrations.

**Verify:** **M5-S02**, **M5-P01**, **M5-P02**

---

### Step 2.3 [PARALLEL] — SQLite migration: scan-control-plane

**Goal:** Verify scan-control-plane works with SQLite.

**Prereqs:** None

**Test-first:**
- Test scan-control-plane starts with `DATABASE_DRIVER=sqlite`.
- Maps to: **M5-S03**

**Actions:**
1. Review scan-control-plane DB config and migrations for SQLite compatibility.
2. Add SQLite pragma setup if missing.
3. Test startup.

**Verify:** **M5-S03**

---

### Step 2.4 [PARALLEL] — Runtime Store: Go interface and memory implementation

**Goal:** Abstract Redis usage in Go core behind `RuntimeStore` interface, implement `MemoryRuntimeStore`.

**Prereqs:** None (pure Go backend refactor)

**Test-first:**
- Test `SetChatStatus` → `GetChatStatus` returns correct status.
- Test `AppendChatChunk` × N → `GetChatChunks(fromSeq)` returns subsequent chunks.
- Test `SendStopSignal` → `WaitForStopSignal` unblocks immediately.
- Test TTL expiry (use short TTL, sleep, verify gone).
- Test `SetMultiAnswerInfo` → `GetMultiAnswerInfo`.
- Test `SetChatInput` → `GetChatInput`.
- Test concurrent access safety.
- Maps to: **M6-C01**, **M6-C02**, **M6-C03**, **M6-C04**, **M6-C05**

**Actions:**
1. Create `backend/core/store/runtime_store.go` with interface per LLD-06 §2.1.
2. Create `backend/core/store/memory_runtime_store.go` per LLD-06 §4.2.
3. Create `backend/core/store/runtime_store_factory.go` per LLD-06 §2.2.
4. Refactor `backend/core/chat/redis_cache.go` → `backend/core/store/redis_runtime_store.go` implementing same interface.
5. Modify `backend/core/store/store.go` to initialize RuntimeStore based on `LAZYMIND_STATE_BACKEND` env var.
6. Update all callers of redis_cache functions to use RuntimeStore interface.

**Verify:** **M6-S01**, **M6-C01**–**M6-C05**, **M6-R01** (Redis still works)

---

### Step 2.5 [PARALLEL] — Runtime Store: Python auth-service adaptations

**Goal:** Make auth-service work without Redis in Desktop mode.

**Prereqs:** None

**Test-first:**
- Test auth-service starts with `LAZYMIND_DESKTOP_MODE=true` without Redis connection.
- Test `InMemoryTokenStore` save/get/expire/delete.
- Test `NoOpRateLimiter` always returns true.
- Maps to: **M6-S02**

**Actions:**
1. Create `backend/auth-service/core/token_store.py` Protocol per LLD-06 §2.3.
2. Create `backend/auth-service/core/memory_token_store.py` per LLD-06 §4.4.1.
3. Create `backend/auth-service/core/noop_rate_limiter.py` per LLD-06 §4.4.2.
4. Create factory in `backend/auth-service/core/dependencies.py` per LLD-06 §4.4.3.
5. Modify auth API to use injected token store and rate limiter instead of direct Redis.
6. Ensure `LAZYMIND_DESKTOP_MODE=true` disables Redis connection attempt.

**Verify:** **M6-S02**

---

### Step 2.6 [PARALLEL] — Desktop Auth Provider: auth-service API

**Goal:** Add Desktop-specific API endpoints to auth-service for assistant management.

**Prereqs:** Step 2.2 (SQLite works), Step 2.5 (no Redis dependency)

**Note:** Can start implementation once the interface is defined; actual integration testing needs Steps 2.2 and 2.5.

**Test-first:**
- Test `POST /desktop/bootstrap` creates default group, role, permissions, "astronomer" assistant. Idempotent.
- Test `GET /desktop/assistants` returns assistant list.
- Test `POST /desktop/assistants` creates new assistant with correct fields.
- Test `PATCH /desktop/assistants/:id` updates assistant.
- Test `DELETE /desktop/assistants/:id` soft deletes.
- Test `GET /desktop/identity` returns token and default assistant ID.
- Test Desktop router is NOT registered when `LAZYMIND_DESKTOP_MODE=false`.
- Maps to: **M4-S01**, **M4-S02**, **M4-S03**, **M4-C01**–**M4-C06**, **M4-R01**, **M4-R02**

**Actions:**
1. Create `backend/auth-service/desktop/__init__.py` with router.
2. Create `backend/auth-service/desktop/bootstrap.py` per LLD-04 §4.2.1.
3. Create `backend/auth-service/desktop/identity.py` per LLD-04 §4.2.3.
4. Create `backend/auth-service/desktop/assistants.py` with CRUD endpoints.
5. Create `backend/auth-service/desktop/schemas.py` with Pydantic models.
6. Modify `backend/auth-service/main.py` to conditionally register `desktop_router`.
7. Modify `backend/auth-service/core/config.py` to add `DESKTOP_MODE` flag.
8. Ensure `users` model has `avatar`, `description`, `source` fields.

**Verify:** **M4-S01**, **M4-S03**, **M4-C01**–**M4-C06**, **M4-R01**, **M4-R02**

---

## Wave 3: Electron Process Management and Proxy (Depends on Wave 1 Steps 1.1, 1.4)

### Step 3.1 [SEQUENTIAL] — Process Manager

**Goal:** Implement the full process lifecycle manager.

**Prereqs:** Step 1.1 (data dir), Step 1.4 (logger for process streams), Step 0.3 (IPC for broadcasting)

**Test-first:**
- Test `ManagedProcess` state machine transitions: pending → starting → healthy.
- Test port-in-use detection.
- Test process crash triggers auto-restart with exponential backoff.
- Test restart count exhaustion leads to `failed` state.
- Test topological sort of process configs.
- Test `stopAll()` kills all processes within 10s.
- Test environment variable whitelist (only allowed vars passed).
- Test `shell: false` is used for all spawns.
- Maps to: **M2-S01**–**M2-S04**, **M2-C01**–**M2-C04**, **M2-I01**–**M2-I04**, **M2-X01**–**M2-X03**

**Actions:**
1. Create `desktop/src/main/process-manager/types.ts` per LLD-02 §2.1.
2. Create `desktop/src/main/process-manager/managed-process.ts` per LLD-02 §4.3.
3. Create `desktop/src/main/process-manager/manager.ts` per LLD-02 §4.4.
4. Create `desktop/src/main/process-manager/configs.ts` per LLD-02 §4.1.
5. Create `desktop/src/main/process-manager/port-check.ts`.
6. Create `desktop/src/main/process-manager/index.ts`.
7. Wire IPC handlers for `service:getStatus`, `service:getAllStatus`.
8. Wire `service:status-changed` event broadcasting to Renderer.

**Verify:** **M2-S01**–**M2-S04**, **M2-C01**–**M2-C04**, **M2-I01**–**M2-I04**, **M2-X01**–**M2-X03**

---

### Step 3.2 [SEQUENTIAL] — Local Proxy

**Goal:** Implement HTTP reverse proxy with identity injection.

**Prereqs:** Step 3.1 (process manager for port info), Step 0.2 (security config for CORS origins)

**Test-first:**
- Test proxy starts on 127.0.0.1:5023.
- Test route matching: `/api/authservice/*` → port 8002, `/api/core/*` → port 8001 with strip.
- Test `X-User-Id`, `X-User-Name`, `X-Desktop-Secret`, `X-Request-Id` headers injected.
- Test frontend `Authorization` and `X-User-Id` headers are overwritten/removed.
- Test SSE passthrough (content-type: text/event-stream not buffered).
- Test multipart upload passthrough.
- Test 502 when backend down.
- Test CORS: `lazymind://app` allowed, `http://evil.com` rejected.
- Test external machine cannot connect.
- Maps to: **M3-S01**–**M3-S03**, **M3-C01**–**M3-C06**, **M3-X01**–**M3-X04**

**Actions:**
1. Create `desktop/src/main/proxy/types.ts` per LLD-03 §2.1.
2. Create `desktop/src/main/proxy/secret.ts` per LLD-03 §4.3.
3. Create `desktop/src/main/proxy/routes.ts` per LLD-03 §4.1.
4. Create `desktop/src/main/proxy/cors.ts`.
5. Create `desktop/src/main/proxy/server.ts` per LLD-03 §4.2.
6. Create `desktop/src/main/proxy/index.ts`.

**Verify:** **M3-S01**–**M3-S03**, **M3-C01**–**M3-C06**, **M3-X01**–**M3-X04**

---

### Step 3.3 [SEQUENTIAL] — Local secret injection to backend processes

**Goal:** Wire the local secret from proxy into process manager so backends receive it as env var.

**Prereqs:** Step 3.1 (process manager), Step 3.2 (proxy generates secret)

**Actions:**
1. In `desktop/src/main/index.ts`, generate local secret before starting processes.
2. Pass `LAZYMIND_LOCAL_SECRET` to all backend process configs.
3. Add secret validation middleware stub in auth-service (Desktop mode only).
4. Add secret validation middleware stub in core (Desktop mode only).

**Verify:** **M3-X04** (backend receives and validates X-Desktop-Secret)

---

## Wave 4: Frontend Desktop Mode (Can start early with mocks)

### Step 4.1 [PARALLEL] — Frontend build configuration and platform utils

**Goal:** Add Desktop Mode build target to frontend.

**Prereqs:** None (uses compile-time flag, can mock window.lazymind)

**Test-first:**
- Test `isDesktopMode()` returns true when `__DESKTOP_MODE__` is true.
- Test `isDesktopMode()` returns true when `window.lazymind` exists.
- Test `getAPIBaseURL()` returns `http://127.0.0.1:5023` in Desktop mode.
- Test `getAPIBaseURL()` returns empty string in Cloud mode.
- Maps to: **M7-S01**, **M7-S02**, **M7-C05**

**Actions:**
1. Create `frontend/src/utils/platform.ts` per LLD-07 §4.2.
2. Create `frontend/src/api/config.ts` per LLD-07 §4.10.
3. Modify `frontend/vite.config.ts` per LLD-07 §4.1.
4. Add `build:desktop` script to `frontend/package.json`.
5. Verify both `pnpm build` and `pnpm build:desktop` succeed.

**Verify:** **M7-S01**, **M7-S02**

---

### Step 4.2 [PARALLEL] — Desktop Store and Auth Facade

**Goal:** Implement Zustand store for Desktop state and auth bypass.

**Prereqs:** Step 4.1 (platform utils)

**Test-first:**
- Test `useDesktopStore.initialize()` with mocked `window.lazymind`.
- Test `setCurrentAssistant()` calls `window.lazymind.setCurrentAssistant()`.
- Test `syncAuthState()` writes to localStorage.
- Test Desktop mode skips login redirect.
- Maps to: **M7-S03**, **M7-C02**

**Actions:**
1. Create `frontend/src/stores/desktop.ts` per LLD-07 §4.4.
2. Modify `frontend/src/components/auth.ts` to add `isDesktopMode()` check.
3. Modify `frontend/src/router/index.tsx` per LLD-07 §4.3.
4. Modify `frontend/src/main.tsx` to call `useDesktopStore.initialize()` on app load.
5. Modify `frontend/src/components/request.ts` per LLD-07 §4.11.

**Verify:** **M7-S03**

---

### Step 4.3 [PARALLEL] — AssistantSwitcher component

**Goal:** Build the global assistant switcher UI component.

**Prereqs:** Step 4.2 (Desktop store)

**Test-first:**
- Test component renders current assistant name and avatar.
- Test dropdown shows all assistants.
- Test clicking an assistant calls `setCurrentAssistant`.
- Maps to: **M7-C01**, **M7-C02**

**Actions:**
1. Create `frontend/src/components/AssistantSwitcher/index.tsx` per LLD-07 §4.6.
2. Create `frontend/src/components/AssistantSwitcher/style.less`.
3. Modify `frontend/src/layouts/MainLayout.tsx` per LLD-07 §4.5 to include AssistantSwitcher.

**Verify:** **M7-C01**, **M7-C02**

---

### Step 4.4 [PARALLEL] — ServiceStatusBar component

**Goal:** Build service status indicator.

**Prereqs:** Step 4.2 (Desktop store)

**Test-first:**
- Test shows green when all healthy.
- Test shows red when any failed.
- Test shows yellow when starting.
- Test tooltip shows per-service detail.
- Maps to: **M7-C03**

**Actions:**
1. Create `frontend/src/components/ServiceStatusBar/index.tsx` per LLD-07 §4.7.
2. Add to MainLayout header.

**Verify:** **M7-C03**

---

### Step 4.5 [PARALLEL] — MockModelWarning and folder selection hook

**Goal:** Chat mock warning and Desktop folder selection integration.

**Prereqs:** Step 4.1 (platform utils)

**Test-first:**
- Test MockModelWarning renders in Desktop mode.
- Test MockModelWarning does NOT render in Cloud mode.
- Test `useDesktopFolder().pickFolder()` calls `window.lazymind.pickFolder()`.
- Maps to: **M7-C04**

**Actions:**
1. Create `frontend/src/modules/chat/components/MockModelWarning.tsx` per LLD-07 §4.8.
2. Create `frontend/src/hooks/useDesktopFolder.ts` per LLD-07 §4.9.
3. Integrate MockModelWarning into Chat page.

**Verify:** **M7-C04**

---

## Wave 5: Integration — Assistant Manager in Electron (Depends on Wave 2.6, Wave 3)

### Step 5.1 [SEQUENTIAL] — Electron Assistant Manager

**Goal:** Implement the Electron-side assistant manager that talks to auth-service API and controls the proxy.

**Prereqs:** Step 2.6 (auth-service Desktop API exists), Step 3.2 (proxy `setCurrentAssistant` exists), Step 1.6 (IPC handlers)

**Test-first:**
- Test `AssistantManager.initialize()` calls bootstrap API, gets identity, sets proxy identity.
- Test `setCurrent(id)` updates proxy, persists state, broadcasts to Renderer.
- Test state persists across restarts (reads `assistant-state.json`).
- Test falls back to default assistant if saved state is invalid.
- Maps to: **M4-I01**, **M4-I02**, **M4-I03**

**Actions:**
1. Create `desktop/src/main/assistant-manager.ts` per LLD-04 §4.4.
2. Create `desktop/src/main/ipc/assistant.ts` IPC handlers for `assistant:getCurrent`, `assistant:setCurrent`, `assistant:getList`.
3. Wire assistant manager initialization into `desktop/src/main/index.ts` after auth-service becomes healthy.

**Verify:** **M4-I01**, **M4-I02**, **M4-I03**

---

## Wave 6: Full Integration and E2E (Depends on all prior waves)

### Step 6.1 [SEQUENTIAL] — Wire main entry point completely

**Goal:** Complete `desktop/src/main/index.ts` with full startup sequence.

**Prereqs:** All Wave 1–5 steps complete.

**Actions:**
1. Update `desktop/src/main/index.ts` startup sequence:
   - Register protocol
   - Ensure data dir
   - Register IPC handlers
   - Show splash
   - Generate local secret
   - Start proxy
   - Start all backend processes (process manager)
   - Wait for auth-service healthy
   - Initialize assistant manager (bootstrap, identity, set proxy)
   - Create main window
   - Close splash when main window ready
   - Initialize lifecycle hooks (cleanup on quit)
2. Update `desktop/src/main/lifecycle.ts` to call `processManager.stopAll()` on quit.

**Verify:** **E2E-01** (first launch full flow)

---

### Step 6.2 [SEQUENTIAL] — E2E: First launch flow

**Goal:** Validate the complete first launch experience.

**Prereqs:** Step 6.1

**Test execution (manual or Playwright):**
- Double-click / `npm run dev` → splash appears → services start → main UI loads → default assistant "天文学家 🪐" selected.
- No login page shown.
- ServiceStatusBar shows all green once ready.
- AssistantSwitcher shows "天文学家".

**Verify:** **E2E-01**, **M4-S01**, **M4-S02**, **M7-S03**

---

### Step 6.3 [SEQUENTIAL] — E2E: Assistant CRUD and switching

**Goal:** Validate creating and switching assistants end-to-end.

**Prereqs:** Step 6.2

**Test execution:**
- Create new assistant "物理学家" via API or UI.
- Switch to "物理学家" via AssistantSwitcher.
- Send a Chat message → verify backend receives 物理学家's user_id in `X-User-Id`.
- Switch back to "天文学家" → verify session list changes.

**Verify:** **E2E-02**, **M4-C02**, **M4-C06**, **M7-I01**

---

### Step 6.4 [SEQUENTIAL] — E2E: Application close and restart

**Goal:** Validate clean shutdown and data persistence.

**Prereqs:** Step 6.3

**Test execution:**
- Close application → verify all backend processes exit within 10s (`tasklist` check).
- Restart application → verify last selected assistant is restored.
- Verify SQLite data persists (conversations still exist).

**Verify:** **E2E-04**, **E2E-05**, **M4-I03**

---

### Step 6.5 [SEQUENTIAL] — E2E: Backend crash recovery

**Goal:** Validate auto-restart on crash.

**Prereqs:** Step 6.2

**Test execution:**
- Kill core process (`taskkill /PID xxx`).
- Verify ProcessManager auto-restarts within backoff period.
- Verify ServiceStatusBar transitions: healthy → failed → starting → healthy.
- Verify API recovers after restart.

**Verify:** **E2E-06**, **M2-I02**, **M2-I03**

---

### Step 6.6 [SEQUENTIAL] — E2E: Diagnostics and logging

**Goal:** Validate diagnostics export and log integrity.

**Prereqs:** Step 6.2

**Test execution:**
- Configure a fake API key in config.yaml.
- Run the app, trigger some activity.
- Export diagnostics via `window.lazymind.exportDiagnostics()`.
- Open zip and verify:
  - `config-summary.json` has `***REDACTED***` for the API key.
  - Log files exist for each service.
  - No SQLite files included.
  - No user document content.
- Check log files in `%APPDATA%\LazyMind\logs\` — verify no plaintext API key.

**Verify:** **M8-S01**, **M8-S02**, **M8-X01**, **M8-X02**, **M8-X04**

---

### Step 6.7 [SEQUENTIAL] — E2E: Security verification

**Goal:** Validate all security baselines.

**Prereqs:** Step 6.2

**Test execution:**
- Open DevTools → verify CSP policy present, no violations.
- In DevTools console: `require('fs')` → should fail (no Node.js).
- In DevTools console: `window.require` → undefined.
- Run `netstat -an | findstr "8001 8002 5023 18080 18081 8046"` → all bound to `127.0.0.1` only.
- From another machine, attempt `curl http://<ip>:5023` → connection refused.
- In browser tab, navigate to `http://localhost:5023/api/core/health` → CORS rejection.

**Verify:** **M1-X01**–**M1-X04**, **M3-X01**–**M3-X04**, **M8-X03**, **M8-X04**

---

### Step 6.8 [SEQUENTIAL] — E2E: Platform-specific verification

**Goal:** Validate Windows-specific scenarios.

**Prereqs:** Step 6.2

**Test execution:**
- Test with Chinese username path (`C:\Users\张三\AppData\...`).
- Test with spaces in path.
- Test running as non-admin user.
- Test port conflict scenario (start another server on 5023 first).

**Verify:** **E2E-P01**–**E2E-P04**, **M5-P01**, **M5-P02**

---

## Wave 7: Cloud Regression (Can run parallel to Wave 6)

### Step 7.1 [PARALLEL] — Cloud mode regression: Go core

**Goal:** Verify Go core still works with PostgreSQL and Redis.

**Prereqs:** Steps 2.1, 2.4 complete (code changed)

**Actions:**
1. Run existing Go core tests with `ACL_DB_DRIVER=postgres`.
2. Verify Redis RuntimeStore path still works with `LAZYMIND_STATE_BACKEND=redis`.
3. Run migration on PostgreSQL — all pass.

**Verify:** **M5-R01**, **M5-R02**, **M6-R01**

---

### Step 7.2 [PARALLEL] — Cloud mode regression: auth-service

**Goal:** Verify auth-service Cloud mode unaffected.

**Prereqs:** Steps 2.2, 2.5, 2.6 complete

**Actions:**
1. Start auth-service with `LAZYMIND_DESKTOP_MODE=false` and PostgreSQL + Redis.
2. Verify login/register/token-refresh work.
3. Verify `/api/authservice/desktop/*` returns 404.
4. Verify rate limiting works (Redis).

**Verify:** **M4-R01**, **M4-R02**

---

### Step 7.3 [PARALLEL] — Cloud mode regression: Frontend

**Goal:** Verify `pnpm build` (Cloud mode) produces correct output.

**Prereqs:** Step 4.1 complete

**Actions:**
1. Run `pnpm build` (no VITE_LAZYMIND_MODE set).
2. Verify output includes login page routes.
3. Verify no Desktop-only components render without `window.lazymind`.

**Verify:** **M7-S02**

---

## Parallelism Summary

```
Wave 0: [PARALLEL x3]  0.1, 0.2, 0.3
Wave 1: [PARALLEL x6]  1.1, 1.2, 1.3, 1.4, 1.5, 1.6  →  then [SEQ] 1.7
Wave 2: [PARALLEL x6]  2.1, 2.2, 2.3, 2.4, 2.5, 2.6
Wave 3: [SEQUENTIAL]   3.1 → 3.2 → 3.3
Wave 4: [PARALLEL x5]  4.1, 4.2, 4.3, 4.4, 4.5
Wave 5: [SEQUENTIAL]   5.1
Wave 6: [SEQUENTIAL]   6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.6 → 6.7 → 6.8
Wave 7: [PARALLEL x3]  7.1, 7.2, 7.3  (can run alongside Wave 6)
```

**Maximum concurrent subagents at any point: 6** (Wave 1 or Wave 2).

**Critical path:** Wave 0 → Wave 1 (1.7) → Wave 3 (3.1→3.2→3.3) → Wave 5 → Wave 6

**Total estimated steps:** 31

---

## Agent Instructions

When executing this plan:

1. **Always write tests first** for steps marked `[TEST-FIRST]`. The test should fail initially (red), then implement until green.
2. **For `[PARALLEL]` steps within the same wave**, spawn separate subagents. Each subagent receives:
   - This implementation plan section for their step
   - The relevant LLD file(s)
   - The test plan section
3. **For `[SEQUENTIAL]` steps**, complete them in order within the same agent context.
4. **After each step**, run the specified `[VERIFY]` test IDs. If any fail, fix before proceeding.
5. **Never skip security requirements.** If a shortcut would violate LLD-08 security baselines, do not take it.
6. **Cloud mode must never break.** After modifying any shared backend code, run regression tests (Wave 7 steps).
7. **Commit after each completed wave** with a descriptive message summarizing what was implemented.
8. **If blocked**, check if the blocking dependency is available via its interface contract (types/schemas) rather than full implementation. Many steps can begin with mocked dependencies.

---

## File Reference

| Step | Primary Files Created/Modified |
|------|-------------------------------|
| 0.1 | `desktop/package.json`, `desktop/tsconfig.json`, `desktop/resources/**` |
| 0.2 | `desktop/src/main/security/config.ts` |
| 0.3 | `desktop/src/main/ipc/registry.ts`, `desktop/src/main/ipc/security.ts` |
| 1.1 | `desktop/src/main/data-dir.ts` |
| 1.2 | `desktop/src/main/protocol.ts` |
| 1.3 | `desktop/src/main/window.ts`, `desktop/src/main/lifecycle.ts` |
| 1.4 | `desktop/src/main/logger/**` |
| 1.5 | `desktop/src/main/diagnostics/**` |
| 1.6 | `desktop/src/preload/index.ts`, `desktop/src/main/ipc/*.ts` |
| 1.7 | `desktop/src/main/index.ts` |
| 2.1 | `backend/core/migrations/sqlite/**`, `backend/core/common/orm/db.go` |
| 2.2 | `backend/auth-service/alembic/env.py`, `backend/auth-service/core/database.py` |
| 2.3 | `backend/scan-control-plane/` (config/migrations) |
| 2.4 | `backend/core/store/runtime_store.go`, `backend/core/store/memory_runtime_store.go` |
| 2.5 | `backend/auth-service/core/memory_token_store.py`, `backend/auth-service/core/noop_rate_limiter.py` |
| 2.6 | `backend/auth-service/desktop/**`, `backend/auth-service/main.py` |
| 3.1 | `desktop/src/main/process-manager/**` |
| 3.2 | `desktop/src/main/proxy/**` |
| 3.3 | `desktop/src/main/index.ts` (secret wiring) |
| 4.1 | `frontend/src/utils/platform.ts`, `frontend/src/api/config.ts`, `frontend/vite.config.ts` |
| 4.2 | `frontend/src/stores/desktop.ts`, `frontend/src/components/auth.ts`, `frontend/src/router/index.tsx` |
| 4.3 | `frontend/src/components/AssistantSwitcher/**` |
| 4.4 | `frontend/src/components/ServiceStatusBar/**` |
| 4.5 | `frontend/src/modules/chat/components/MockModelWarning.tsx`, `frontend/src/hooks/useDesktopFolder.ts` |
| 5.1 | `desktop/src/main/assistant-manager.ts`, `desktop/src/main/ipc/assistant.ts` |
| 6.1 | `desktop/src/main/index.ts` (final wiring) |

---

## Test Coverage Mapping

Every test ID from `09-test-plan.md` is covered:

| Module | Test IDs | Covered In Step |
|--------|----------|-----------------|
| M1 (Electron Shell) | M1-S01–S05, M1-C01–C05, M1-X01–X05 | 1.1–1.7 |
| M2 (Process Manager) | M2-S01–S04, M2-C01–C04, M2-I01–I04, M2-X01–X03 | 3.1 |
| M3 (Local Proxy) | M3-S01–S03, M3-C01–C06, M3-X01–X04 | 3.2, 3.3 |
| M4 (Desktop Auth) | M4-S01–S03, M4-C01–C06, M4-I01–I03, M4-R01–R02 | 2.6, 5.1, 7.2 |
| M5 (SQLite) | M5-S01–S04, M5-C01–C05, M5-R01–R02, M5-P01–P02 | 2.1, 2.2, 2.3, 7.1 |
| M6 (Runtime Store) | M6-S01–S02, M6-C01–C05, M6-I01–I02, M6-R01 | 2.4, 2.5, 7.1 |
| M7 (Frontend) | M7-S01–S03, M7-C01–C05, M7-I01–I03 | 4.1–4.5, 6.3 |
| M8 (Logging/Security) | M8-S01–S02, M8-C01–C04, M8-X01–X04 | 1.4, 1.5, 6.6, 6.7 |
| E2E | E2E-01–06, E2E-P01–P05 | 6.1–6.8 |

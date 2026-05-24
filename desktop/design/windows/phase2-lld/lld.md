# Phase 2 Complete Features — Low-Level Design Overview

## 1. Background

This directory contains the Low-Level Design documents for LazyMind Desktop Mode Phase 2 (Complete Features). Based on `desktop/design/windows/hld.md` §4.2 and §5.2, this phase transitions from the Phase 1 MVP skeleton to a fully functional desktop application with real data flowing through the entire pipeline.

Phase 1 delivered: Electron shell, process manager, local proxy, desktop auth, SQLite minimum chain, memory runtime store, frontend desktop mode, logging/diagnostics/security baseline, and Go launcher.

Phase 2 delivers: complete SQLite migration, Milvus Lite full integration, local SegmentStore implementation, real algorithm/parsing/chat pipeline, complete frontend experience, and functional/performance/stability verification.

---

## 2. Design Goals

1. **Real data flow**: Every component processes real documents, vectors, and queries — no mock fallbacks on the critical path.
2. **Process consolidation**: Reduce Python service count from 4-5 separate processes to 1-2 consolidated FastAPI applications, based on Phase 1 startup/memory measurements.
3. **Data isolation verification**: 50+ assistants with verified session/skill/knowledge isolation.
4. **Performance baselines**: Establish cold start, query latency, and memory benchmarks.
5. **Cloud mode compatibility**: All changes remain behind `LAZYMIND_MODE=desktop` switches.

---

## 3. Module Split

### 3.1 Rationale

HLD §4.2.2 defines 7 task groups (A-G) for the complete features stage. We reorganize into 8 LLD modules:

- SQLite is complex enough for its own module (all services, all migrations).
- Milvus Lite integration is a dedicated module (vector pipeline end-to-end).
- SegmentStore local implementation is standalone (new code, clear interface).
- Algorithm/parsing pipeline consolidation is a large module.
- Runtime Store hardening (persist critical state) gets its own module.
- Frontend complete experience builds on Phase 1 skeleton.
- OS-level secret management (Credential Manager/DPAPI) is a focused security module.
- Integration testing and performance benchmarks are captured in the test plan.

### 3.2 Module List

| # | File | Module Name | HLD Task Mapping |
|---|------|-------------|-----------------|
| 01 | `01-sqlite-complete.md` | SQLite Complete Migration | A (全部 migration 兼容) |
| 02 | `02-milvus-lite.md` | Milvus Lite Full Integration | B (向量完整接入) |
| 03 | `03-segment-store-local.md` | SegmentStore Local Implementation | C (片段/全文本地实现) |
| 04 | `04-algorithm-pipeline.md` | Algorithm & Parsing Pipeline | D (算法解析真实链路) |
| 05 | `05-runtime-store-hardening.md` | Runtime Store Hardening | HLD 3.10.4 (持久化需求) |
| 06 | `06-frontend-complete.md` | Frontend Complete Experience | E (前端完整体验) |
| 07 | `07-credential-security.md` | OS Credential & Secret Management | HLD 3.15.6 (密钥安全存储) |
| 08 | `08-test-plan.md` | Integration Test & Performance Plan | G (功能/性能/稳定性验证) |

Additionally:
- `implementation.md` — Machine-readable implementation plan with TDD waves.

---

## 4. Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dependency direction: top → bottom        │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │  01 SQLite Complete    │  ← Foundation, unblocks most
                    └────────┬─────────────┘
                             │
              ┌──────────────┼──────────────────────┐
              │              │                      │
              ▼              ▼                      ▼
    ┌──────────────┐  ┌────────────────┐  ┌───────────────────────┐
    │ 02 Milvus    │  │ 03 Segment     │  │ 05 Runtime Store      │
    │    Lite      │  │    Store       │  │    Hardening          │
    └──────┬───────┘  └─────┬──────────┘  └───────────────────────┘
           │                │
           └────────┬───────┘
                    │
                    ▼
           ┌──────────────────┐
           │ 04 Algorithm     │  ← Depends on vector + segment
           │    Pipeline      │
           └────────┬─────────┘
                    │
              ┌─────┼──────────────────┐
              │     │                  │
              ▼     ▼                  ▼
    ┌──────────────┐  ┌────────────┐  ┌───────────────────────┐
    │ 06 Frontend  │  │ 07 Cred    │  │ 08 Test Plan          │
    │    Complete  │  │  Security  │  │                       │
    └──────────────┘  └────────────┘  └───────────────────────┘
```

---

## 5. Parallel Development Strategy

### Wave 1: Immediate Start (No Blockers from Phase 2 — depends on Phase 1 only)

| Module | Reason |
|--------|--------|
| **LLD-01** SQLite Complete | Pure backend migration work. Uses existing DB schemas. |
| **LLD-02** Milvus Lite | Python-only vector integration. Independent of SQL changes. |
| **LLD-03** SegmentStore Local | New Go module. Only needs interface definition from existing code. |
| **LLD-05** Runtime Store Hardening | Go refactor with clear interface boundary. |
| **LLD-07** Credential Security | OS API integration, independent of other modules. |

### Wave 2: After Vector + Segment + SQLite Ready

| Module | Unblocked by |
|--------|-------------|
| **LLD-04** Algorithm Pipeline | Needs Milvus Lite (02) + SegmentStore (03) + SQLite (01) |
| **LLD-06** Frontend Complete | Can start UI work immediately, full integration after 04 |

### Wave 3: Final Verification

| Module | Unblocked by |
|--------|-------------|
| **LLD-08** Test Plan execution | All modules integrated |

**Practical parallel capacity**: 5 modules can start simultaneously in Wave 1. LLD-06 frontend can also begin immediately (UI components don't need real backend), with integration deferred to Wave 2.

---

## 6. Interface Contracts Summary

| Producer | Consumer | Contract |
|----------|----------|----------|
| LLD-01 | LLD-04 | All SQLite tables fully migrated, algo.db ownership defined |
| LLD-02 | LLD-04 | `VectorStore` interface: create_collection, insert, search, delete |
| LLD-03 | LLD-04 | `SegmentStore` interface: index, search, delete with Desktop impl |
| LLD-04 | LLD-06 | API responses for parsing status, index status, chat with RAG |
| LLD-05 | LLD-04 | `RuntimeStore` with persistent chat state on restart |
| LLD-07 | LLD-01 | Secrets stored in Credential Manager, config no longer holds plaintext keys |

---

## 7. Standard LLD Document Structure

Each LLD document follows this structure:

1. **Module Overview** — Goal, scope (included/excluded)
2. **Interface Contracts** — TypeScript/Go/Python interface definitions
3. **Dependencies** — What this module requires, what depends on it
4. **Technical Design** — Detailed implementation, code structure, key decisions
5. **File Manifest** — New and modified files
6. **Configuration & Environment Variables** — All config items
7. **Error Handling** — Failure scenarios and recovery
8. **Security Considerations** — Module-specific security requirements
9. **Testing Strategy** — Unit/integration/E2E test approach
10. **Cloud Mode Compatibility** — Ensures no regression to existing deployment
11. **Acceptance Criteria** — Checkable completion conditions

---

## 8. Key Differences from Phase 1

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| Data | Mock/minimal | Real documents, vectors, indexes |
| Algorithm | Mock server | Real parsing + chat pipeline |
| Vector | Milvus Lite smoke test | Full collection lifecycle |
| SegmentStore | Mock/no-op | Real local FTS implementation |
| Python services | 1 mock process | 1-2 consolidated real processes |
| SQLite | Minimum tables | All tables, all services |
| Runtime Store | In-memory only | Critical state persisted to SQLite |
| Secrets | Plaintext in config | Windows Credential Manager |
| Performance | Record baselines | Meet target thresholds |
| Assistants | 1-3 test | 50+ isolation verification |

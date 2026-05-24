# LLD-06: Frontend Complete Experience

## 1. Module Overview

### 1.1 Goal

Complete the Desktop Mode frontend experience. Phase 1 delivered the skeleton (AssistantSwitcher, mock warning, service status bar, desktop store). Phase 2 delivers full AI assistant management UI, document scanning path management, parsing/indexing status visualization, model configuration interface, and complete data isolation per assistant.

### 1.2 Scope

**Included:**
- AI Assistant management page (create, edit, delete assistants).
- Assistant Switcher enhancements (avatar, description, count badge).
- Document scan path management UI (add/remove paths, scan status).
- Parsing and indexing progress visualization.
- Model configuration page (add/edit/test model providers).
- Knowledge base status per assistant.
- Service error differentiation (local service error vs. model error vs. index error).
- Chat UI integration with real RAG (sources display, reasoning display).
- "Interrupted" session recovery UI.
- Desktop-specific pages hidden in Cloud mode.

**Not Included:**
- Backend API implementation (see LLD-04).
- Electron IPC changes (Phase 1 sufficient).
- Milvus Lite or SegmentStore internals.

---

## 2. Interface Contracts

### 2.1 Frontend API Layer

```typescript
// frontend/src/api/desktop.ts
export interface DesktopAPI {
  // Assistants
  listAssistants(): Promise<Assistant[]>;
  createAssistant(data: CreateAssistantInput): Promise<Assistant>;
  updateAssistant(id: string, data: UpdateAssistantInput): Promise<Assistant>;
  deleteAssistant(id: string): Promise<void>;

  // Scan paths
  listScanPaths(): Promise<ScanPath[]>;
  addScanPath(path: string): Promise<ScanPath>;
  removeScanPath(id: string): Promise<void>;
  triggerScan(pathId: string): Promise<void>;

  // Parse/Index status
  getIndexStatus(userId: string): Promise<IndexStatus>;
  getParseTaskStatus(taskId: string): Promise<ParseTaskStatus>;

  // Model config
  listModelConfigs(): Promise<ModelConfig[]>;
  createModelConfig(data: CreateModelConfigInput): Promise<ModelConfig>;
  updateModelConfig(id: string, data: UpdateModelConfigInput): Promise<ModelConfig>;
  deleteModelConfig(id: string): Promise<void>;
  testModelConfig(id: string): Promise<TestResult>;
}
```

### 2.2 Component Hierarchy

```
MainLayout
├── AssistantSwitcher (global top bar)
│   ├── Current assistant display
│   ├── Quick switch dropdown
│   └── "Manage" link
├── Sidebar
│   ├── Chat history (filtered by current assistant)
│   ├── Resource navigation
│   └── Settings
└── Content Area
    ├── /agent/chat — Chat with RAG
    ├── /assistants — Assistant management (Desktop only)
    ├── /data-sources — Scan path management
    ├── /model-providers — Model configuration
    ├── /lib/knowledge — Knowledge base per assistant
    └── /memory-management — Memory per assistant
```

---

## 3. Dependencies

**Requires:**
- Phase 1: Desktop store, AssistantSwitcher, platform utils.
- LLD-04: Backend APIs for parsing status, chat with RAG, model config.
- Phase 1: Local Proxy routes for API access.

**Depended on by:**
- LLD-08 Test Plan (E2E testing).

---

## 4. Technical Design

### 4.1 Assistant Management Page

New page at `/assistants` (Desktop mode only):

```tsx
// frontend/src/modules/assistants/AssistantManagement.tsx
export default function AssistantManagement() {
  // List all assistants with cards
  // Create assistant modal (username, displayName, avatar emoji picker, description)
  // Edit assistant inline
  // Delete assistant with confirmation
  // Shows current assistant highlighted
}
```

Fields for create/edit (aligned with existing user fields per HLD):
- `username` (unique, alphanumeric)
- `displayName` (shown in UI)
- `avatar` (emoji or image URL)
- `description` (text, purpose of this assistant)

### 4.2 Enhanced AssistantSwitcher

```tsx
// frontend/src/components/AssistantSwitcher/index.tsx (enhanced)
export default function AssistantSwitcher() {
  // Show: avatar + displayName + description snippet
  // Dropdown with all assistants
  // Badge showing total count
  // "Manage assistants" link at bottom
  // Keyboard shortcut: Ctrl+Shift+A to open
}
```

### 4.3 Scan Path Management

Integrated into existing Data Sources page:

```tsx
// frontend/src/modules/data-sources/ScanPathPanel.tsx
export default function ScanPathPanel() {
  // List configured scan paths
  // "Add folder" button → calls window.lazymind.pickFolder()
  // Per-path status: idle / scanning / error
  // "Scan now" button per path
  // "Remove" button with confirmation
  // Shows file count and last scan time
}
```

### 4.4 Parsing & Indexing Status

```tsx
// frontend/src/modules/data-sources/IndexStatus.tsx
export default function IndexStatus() {
  // Overall status: segments indexed / vectors stored / last update
  // Active parse tasks with progress
  // Failed tasks with error messages and retry button
  // "Rebuild index" button (drops all, re-indexes)
}
```

### 4.5 Model Configuration Page

Enhanced model provider page for Desktop:

```tsx
// frontend/src/modules/model-providers/ModelConfigDesktop.tsx
export default function ModelConfigDesktop() {
  // List configured model providers
  // Add provider: name, type (dashscope/openai/local), API key, endpoint
  // Test connection button → calls testModelConfig API
  // Set default model for chat / embedding
  // Clear status: "✓ Connected" / "✗ Failed: ..." / "⚠ Not configured"
  // When no model configured: prominent banner with setup guide
}
```

### 4.6 Chat UI Enhancements

```tsx
// Enhancements to existing chat module

// 1. Remove MockModelWarning when real model is configured
// 2. Show RAG sources at the bottom of AI response
// 3. Show "thinking" duration for models that support it
// 4. Show "interrupted" state for sessions recovered after restart
// 5. Show "retry" button for interrupted messages
// 6. Show streaming indicator during generation
```

Source display component:
```tsx
// frontend/src/modules/chat/components/SourcesList.tsx
export default function SourcesList({ sources }: { sources: Source[] }) {
  // Collapsible list of document references
  // Each source: document title, chunk preview, relevance score
  // Click to expand full chunk content
}
```

### 4.7 Service Status Differentiation

Enhance ServiceStatusBar to show actionable messages:

| Status | Display | Action |
|--------|---------|--------|
| All healthy | Green dot | None |
| Service starting | Yellow dot + "启动中..." | Wait |
| Service failed | Red dot + service name | "查看日志" link |
| No model configured | Orange banner | "配置模型" link |
| Index empty | Info banner | "添加文档" link |
| Parse failed | Warning in data sources | Show error + retry |

### 4.8 Data Isolation in Frontend

When assistant switches:
1. Desktop store updates `currentAssistant`.
2. `syncAuthState()` updates localStorage with new user context.
3. All API calls automatically use new user_id (via proxy header injection).
4. Chat history sidebar refreshes (shows new assistant's conversations).
5. Knowledge base page refreshes (shows new assistant's documents).
6. Memory page refreshes (shows new assistant's memories).

No manual refresh needed — reactive via Zustand store subscription.

### 4.9 Route Guard for Desktop-Only Pages

```tsx
// frontend/src/router/guards.tsx
function DesktopOnlyRoute({ children }: { children: ReactNode }) {
  if (!isDesktopMode()) {
    return <Navigate to="/agent/chat" replace />;
  }
  return <>{children}</>;
}
```

Pages guarded: `/assistants`.

---

## 5. File Manifest

### New Files
- `frontend/src/modules/assistants/AssistantManagement.tsx`
- `frontend/src/modules/assistants/AssistantCard.tsx`
- `frontend/src/modules/assistants/CreateAssistantModal.tsx`
- `frontend/src/modules/data-sources/ScanPathPanel.tsx`
- `frontend/src/modules/data-sources/IndexStatus.tsx`
- `frontend/src/modules/model-providers/ModelConfigDesktop.tsx`
- `frontend/src/modules/model-providers/TestConnectionButton.tsx`
- `frontend/src/modules/chat/components/SourcesList.tsx`
- `frontend/src/modules/chat/components/InterruptedMessage.tsx`
- `frontend/src/api/desktop.ts`
- `frontend/src/router/guards.tsx`

### Modified Files
- `frontend/src/components/AssistantSwitcher/index.tsx` — Enhanced UI
- `frontend/src/components/ServiceStatusBar/index.tsx` — Actionable messages
- `frontend/src/layouts/MainLayout.tsx` — Add Desktop routes
- `frontend/src/stores/desktop.ts` — Add scan/parse/model state
- `frontend/src/modules/chat/components/MessageBubble.tsx` — Sources display
- `frontend/src/router/index.tsx` — Add new routes

---

## 6. Configuration & Environment Variables

| Variable | Context | Purpose |
|----------|---------|---------|
| `VITE_LAZYMIND_MODE` | Build time | Enable Desktop-specific components |

No runtime env changes — all Desktop detection via `window.lazymind` presence.

---

## 7. Error Handling

| Scenario | UI Behavior |
|----------|-------------|
| Backend service not ready | Service status bar shows loading, affected pages show "服务启动中" |
| Model not configured | Chat shows banner with setup link, responses show guidance |
| Parse task fails | Data sources page shows error + retry button |
| Scan path permission denied | Alert with path + "选择其他目录" button |
| Assistant delete with data | Confirm dialog explaining data will be removed |
| Network/proxy error | Toast notification + "查看诊断" link |

---

## 8. Security Considerations

- Model API keys displayed masked in UI (show only last 4 chars).
- Delete operations require confirmation dialog.
- Scan path selection only via native dialog (no manual text input for paths).
- Assistant switching doesn't expose other assistants' data in transition.

---

## 9. Testing Strategy

### Component Tests
- AssistantSwitcher: renders, switches, shows badge.
- ScanPathPanel: adds/removes paths, shows status.
- ModelConfigDesktop: CRUD, test connection, shows status.
- SourcesList: renders sources, collapses/expands.

### Integration Tests (with real backend)
- Create assistant → appears in switcher → switch → chat history empty.
- Add scan path → trigger scan → parsing starts → index status updates.
- Configure model → test connection → chat works with RAG.
- Delete assistant → removed from list → data isolated.

### E2E Tests
- Full flow: create assistant → add scan path → parse → ask question → get RAG answer with sources.
- 50 assistant isolation: create 50, verify each sees only own data.

---

## 10. Cloud Mode Compatibility

- Desktop-only pages (`/assistants`) guarded by `isDesktopMode()`.
- Desktop-only components render null in Cloud mode.
- No changes to existing Cloud UI behavior.
- Shared components (Chat, Knowledge Base) work in both modes.

---

## 11. Acceptance Criteria

- [ ] Assistant management: create, edit, delete, list all work.
- [ ] AssistantSwitcher shows all assistants with avatar/name.
- [ ] Scan path management: add via native dialog, remove, trigger scan.
- [ ] Parse/index status visible per assistant.
- [ ] Model config: add, edit, test connection, set default.
- [ ] Chat shows RAG sources when available.
- [ ] Chat shows "interrupted" state with retry for recovered sessions.
- [ ] No model configured → clear guidance in chat.
- [ ] Service status differentiation visible and actionable.
- [ ] Assistant switch → all pages reflect new assistant's data.
- [ ] 50 assistants: create and switch without data leakage.
- [ ] Desktop-only pages hidden in Cloud mode.

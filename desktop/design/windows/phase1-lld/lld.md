# Phase 1 MVP — Low-Level Design 总览

## 1. 背景

本目录包含 LazyMind Desktop Mode Phase 1 (MVP) 的 Low-Level Design 文档。基于 `desktop/design/windows/hld.md` 中定义的 MVP 需求和架构设计，将实现方案细化为 8 个独立模块，每个模块一份 LLD 文档，以便后续安排独立的 sub-agent 并行开发。

---

## 2. 设计目标

1. **模块独立性**：每个 LLD 可由独立开发者/agent 实现，无需深入阅读其他 LLD 的内部实现。
2. **接口契约驱动**：模块间通过明确的 TypeScript/Go/Python 接口交互，先定义契约再各自实现。
3. **最大化并行度**：通过分层依赖设计，使 3-4 个模块可同时启动开发。
4. **Cloud 模式不受影响**：所有改动通过显式模式开关隔离，现有 Docker 部署不受破坏。

---

## 3. 模块拆分

### 3.1 拆分思路

HLD 定义了 MVP 阶段 11 个任务组（A-K）。LLD 将其合并和重组为 8 个模块，原则是：

- 相同技术栈的工作合并（如 Electron 相关合为一个模块）。
- 跨多个后端服务的横切关注点独立成模块（如 SQLite 迁移、Redis 替换）。
- 安全基线与日志诊断合并（实现层面耦合度高）。
- 前端改造独立一个模块（与 Electron 主进程解耦）。

### 3.2 模块列表

| # | 文件名 | 模块名称 | HLD 任务映射 |
|---|--------|----------|-------------|
| 01 | `01-electron-shell.md` | Electron Shell & Data Directory | A (工程骨架) |
| 02 | `02-process-manager.md` | Local Process Manager | B (进程管理) |
| 03 | `03-local-proxy.md` | Local Proxy (Kong Replacement) | C (本地代理) |
| 04 | `04-desktop-auth.md` | Desktop Auth & AI Assistant Model | D (免登录+默认助手) |
| 05 | `05-sqlite-migration.md` | SQLite Migration | E (SQLite 最小链路) |
| 06 | `06-runtime-store.md` | Runtime Store (Redis Elimination) | 补充（HLD 3.10.4 Redis 语义替换） |
| 07 | `07-frontend-desktop-mode.md` | Frontend Desktop Mode | 前端 Desktop Mode + Assistant Switcher |
| 08 | `08-logging-diagnostics-security.md` | Logging, Diagnostics & Security | I (日志诊断) + J (安全基线) |

HLD 的 F (Milvus Lite)、G (SegmentStore)、H (扫盘复用)、K (启动 smoke) 在 MVP 中以验证和复用为主，其实现分散在对应模块中：

- Milvus Lite 验证 → 由 algorithm-mock 服务的启动配置覆盖（LLD-02 中配置，独立验证脚本）。
- SegmentStore → MVP 使用 mock 实现，不单独成模块。
- 扫盘复用 → 在 LLD-02（进程管理）和 LLD-07（前端文件夹选择）中覆盖。
- 启动 smoke → 在 LLD-02 的验收标准中覆盖。

---

## 4. 模块依赖图

```
┌─────────────────────────────────────────────────────────────────┐
│                        依赖方向: 上 → 下                          │
└─────────────────────────────────────────────────────────────────┘

                    ┌──────────────────┐
                    │  01 Electron Shell │  ← 基础，无依赖
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────────────┐
              │              │                      │
              ▼              ▼                      ▼
    ┌──────────────┐  ┌────────────┐  ┌───────────────────────┐
    │ 02 Process   │  │ 05 SQLite  │  │ 08 Logging/Security   │
    │    Manager   │  │  Migration │  └───────────────────────┘
    └──────┬───────┘  └─────┬──────┘
           │                │
           │                ▼
           │        ┌──────────────┐
           │        │ 06 Runtime   │
           │        │    Store     │
           │        └──────────────┘
           │
           ▼
    ┌──────────────┐
    │ 03 Local     │
    │    Proxy     │
    └──────┬───────┘
           │
           │        ┌──────────────┐
           ├───────►│ 07 Frontend  │
           │        │ Desktop Mode │
           │        └──────────────┘
           │
           ▼
    ┌──────────────┐
    │ 04 Desktop   │  ← 最后集成，依赖最多
    │    Auth      │
    └──────────────┘
```

---

## 5. 并行开发策略

### Wave 1：立即启动（无阻塞）

| 模块 | 原因 |
|------|------|
| **LLD-01** Electron Shell | 基础模块，无依赖。建立 Electron 工程骨架、自定义协议、数据目录。 |
| **LLD-05** SQLite Migration | 纯后端数据库改造，只需知道最终文件路径（可用占位符）。 |
| **LLD-08** Logging/Security | 安全规范和日志框架，主要是配置和工具代码。 |

### Wave 2：LLD-01 骨架就绪后

| 模块 | 解除阻塞条件 |
|------|-------------|
| **LLD-02** Process Manager | 需要 DataDir 路径和 IPC 基础设施。 |
| **LLD-06** Runtime Store | 需要 LLD-05 确定 schema，知道哪些数据走 SQLite。 |

### Wave 3：LLD-02 完成后

| 模块 | 解除阻塞条件 |
|------|-------------|
| **LLD-03** Local Proxy | 需要知道各服务端口分配。 |
| **LLD-07** Frontend Desktop Mode | 可以用 mock 数据先行开发 UI，后期接入真实 API。 |

### Wave 4：集成

| 模块 | 解除阻塞条件 |
|------|-------------|
| **LLD-04** Desktop Auth | 需要 Proxy 就绪（身份注入）、SQLite 就绪（用户存储）、前端就绪（Auth Facade）。 |

### 实际操作建议

虽然依赖图表达了理想的启动顺序，但在实际中：

- **Wave 1 的三个模块**可以由三个 agent 同时启动。
- **Wave 2 的 LLD-02** 可以在 LLD-01 产出 `DataDirPaths` 接口定义后就启动（不需要等 LLD-01 全部完成）。
- **LLD-07 前端**可以在 Wave 1 阶段就启动 UI 组件开发（用 mock 的 `window.lazymind`），后期再集成。
- **LLD-06 Runtime Store** 是纯 Go/Python 后端工作，与 Electron 无关，可以在 Wave 1 就开始。

因此，**实际可实现 5-6 个模块同时推进**，只有 LLD-04 (Desktop Auth) 是真正需要等待其他模块的集成模块。

---

## 6. 接口契约汇总

模块间的关键数据流和接口：

| 生产方 | 消费方 | 契约内容 |
|--------|--------|----------|
| LLD-01 | 所有 | `DataDirPaths` 路径定义、IPC Channel 白名单 |
| LLD-02 | LLD-03 | `ProcessManager.getPort(service): number`、健康事件 |
| LLD-02 | LLD-08 | `createProcessStream(name)` 日志流 |
| LLD-03 | LLD-04 | `ProxyServer.setCurrentAssistant(userId, userName)` |
| LLD-03 | LLD-07 | Proxy 监听端口 (`127.0.0.1:5023`) |
| LLD-04 | LLD-03 | `getDesktopIdentity()` 返回当前助手 ID |
| LLD-05 | LLD-02 | 环境变量格式（DSN 字符串） |
| LLD-05 | LLD-04 | auth-service 用户表 schema |
| LLD-06 | LLD-02 | `LAZYMIND_STATE_BACKEND=memory` 环境变量 |
| LLD-08 | LLD-01 | 安全配置常量（BrowserWindow defaults、CSP） |
| LLD-08 | LLD-02 | 日志文件路径 |

---

## 7. 每份 LLD 的统一结构

每份 LLD 文档均包含以下章节：

1. **模块概述** — 目标、范围（包含/不包含）
2. **接口契约** — TypeScript/Go/Python 接口定义
3. **依赖关系** — 依赖哪些模块、被哪些模块依赖
4. **技术设计** — 详细实现方案、核心代码结构、关键决策
5. **文件清单** — 新建文件和修改文件列表
6. **配置与环境变量** — 所有配置项
7. **错误处理** — 故障场景和处理方式
8. **安全考量** — 本模块相关的安全要求
9. **测试策略** — 单元/集成/E2E 测试方案
10. **Cloud 模式兼容** — 确保不破坏现有部署
11. **验收标准** — 可勾选的具体验收条件

---

## 8. 撰写过程

### 8.1 信息采集

撰写 LLD 前，对现有代码进行了深度分析：

**项目结构探索：**
- 确认顶层目录结构和 monorepo 组织方式。
- 确认 Go 后端（core、scan-control-plane、file-watcher）的入口和配置方式。
- 确认 Python 后端（auth-service、algorithm/chat、parsing、processor）的框架和依赖。
- 确认前端（React + Vite + pnpm + Ant Design + Zustand）的构建和状态管理方式。
- 确认现有 Docker Compose、Kong、PostgreSQL、Redis、Milvus、OpenSearch 的配置。

**关键源文件分析：**
- `kong.yml`：路由表定义（确定 Local Proxy 需要复制的路由规则）。
- `backend/core/main.go`：Go core 入口（确认已支持 SQLite driver 选择）。
- `backend/core/chat/redis_cache.go`：Redis 使用模式（确定 key pattern、TTL、数据结构）。
- `backend/core/common/orm/db.go`：数据库驱动配置（确认 GORM 多驱动支持）。
- `backend/core/store/store.go`：全局 store 初始化（确认 Redis client 注入方式）。
- `backend/auth-service/core/database.py`：SQLAlchemy 配置（确认已有 SQLite fallback）。
- `backend/auth-service/bootstrap.py`：初始化逻辑（确认角色/权限/管理员创建流程）。
- `backend/auth-service/main.py`：FastAPI 应用配置（确认路由和中间件结构）。
- `frontend/vite.config.ts`：Vite 配置（确认代理设置和端口）。
- `frontend/src/components/auth.ts`：前端认证模块（确认 JWT、localStorage、用户状态管理）。
- `frontend/src/router/index.tsx`：路由定义（确认哪些页面需要条件隐藏）。
- `frontend/src/layouts/MainLayout.tsx`：主布局（确认 header/sidebar 结构）。

### 8.2 设计决策

基于代码分析做出的关键设计决策：

1. **使用 Electron 自定义协议（lazymind://）加载前端**，而非 localhost Web 服务。原因：减少端口暴露面，与 HLD 决议一致。

2. **Local Proxy 内嵌在 Electron Main Process 中**（Node.js http-proxy），而非独立 Go sidecar。原因：减少进程数量，简化管理。

3. **Go core 已原生支持 SQLite driver**，不需要引入新 ORM 或重写数据层。只需维护一份独立的 SQLite migration 目录。

4. **RuntimeStore 抽象接口**替代直接 Redis 调用。将现有 `redis_cache.go` 重构为 `RedisRuntimeStore` 实现，新增 `MemoryRuntimeStore` 实现。

5. **auth-service 已有 SQLite fallback**（默认 DSN 为 `sqlite:///./app.db`），Desktop 模式主要需要禁用 Redis 依赖和添加助手管理 API。

6. **前端通过 `window.lazymind` 检测 Desktop 模式**，构建时通过 `VITE_LAZYMIND_MODE` 环境变量辅助。

7. **本地 secret 机制**：Proxy 启动时生成随机 token，注入给所有后端，防止其他本机程序绕过 Proxy 直接调用后端 API。

### 8.3 模块边界划分原则

- **按变更范围划分**：同一个服务的改动归入同一个 LLD（如 SQLite 迁移涉及 core + auth-service + scan，但都是"数据库驱动切换"这一主题）。
- **按技术栈划分**：Electron/Node.js 代码、Go 代码、Python 代码、React 代码尽量不混在同一个模块中（除非强耦合）。
- **按开发者可独立完成划分**：每个模块的实现者不需要等待其他模块完成即可开始工作（至少 80% 的工作量）。
- **接口先行**：所有模块在 §2 (接口契约) 中定义完整的 TypeScript/Go/Python 接口，其他模块只依赖接口定义，不依赖实现细节。

---

## 9. MVP 验收总览

Phase 1 MVP 的最终验收需要所有 8 个模块的验收标准全部通过。核心验收场景：

1. 双击启动 → Splash → 主界面（5s 内可见，10s 内可操作）。
2. 无需登录，直接看到"天文学家 🪐"助手。
3. 可创建新 AI 助手，可切换。
4. Chat 页面可发起对话（mock 模型回复），显示 mock 状态提示。
5. 切换助手后会话数据隔离。
6. 关闭应用 → 所有子进程退出 → 无残留。
7. 重启应用 → 上次选择的助手恢复 → 数据持久化。
8. 诊断包可导出 → 不含明文密钥。
9. 从外部无法访问本地 API 端口。
10. 不需要 Docker 或任何开发环境。

---

## 10. 文件索引

```
desktop/design/windows/phase1-lld/
├── lld.md                              ← 本文件（总览）
├── 01-electron-shell.md                ← Electron 工程骨架
├── 02-process-manager.md               ← 本地进程管理
├── 03-local-proxy.md                   ← HTTP 反向代理
├── 04-desktop-auth.md                  ← 免登录认证 & AI 助手
├── 05-sqlite-migration.md              ← SQLite 迁移
├── 06-runtime-store.md                 ← 运行时存储（替代 Redis）
├── 07-frontend-desktop-mode.md         ← 前端 Desktop Mode
└── 08-logging-diagnostics-security.md  ← 日志、诊断、安全基线
```

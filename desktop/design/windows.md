# LazyRAG Desktop Mode (Windows)

本文目标是将 LazyRAG 改造成 Windows 桌面端应用，同时在目录、进程、依赖和打包边界上预留 macOS 支持空间，避免后续 macOS 版本反向改动 Windows 主线。新版方案只描述步骤计划，不包含工时预估和时间计划。

落地分为三个阶段：

- MVP 阶段：验证 Desktop Mode 迁移可行性，优先跑通 Electron、前端、本地代理、后端进程编排、免登录、助手切换和 Python 算法模块启动链路；算法效果不是重点，检索和解析可使用 mock 或轻量实现。
- 完整功能阶段：在开发机上接入最终选型的本地关系库、运行时存储、检索存储、解析和算法能力，跑通完整功能，并完成初步功能、性能和稳定性测试。
- 安装包阶段：在完整功能可运行后做产品化打包、签名、升级、卸载、诊断包和干净环境验证。

## 1. 目标与边界

### 1.1 目标形态

Desktop Mode 的最终目标是一个 Windows 优先、可扩展到 macOS 的桌面应用：

```text
Electron Main Process
  -> Renderer: 前端静态资源
  -> Local Proxy: 统一 /api 路由与 header 注入
  -> Process Manager: 启动、监控、停止本地后端进程
       -> Go core / scan-control-plane / file-watcher
       -> Python auth-service
       -> Python algorithm / chat / parsing / doc-service
       -> Python evo
  -> Local Data Directory: SQLite、检索索引、上传文件、日志、配置
```

桌面端不依赖 Docker Compose，不要求用户安装开发环境，不暴露云端多租户部署复杂度。Electron 负责进程编排、端口分配、健康检查、日志采集、首次启动初始化和安装包生命周期。

跨平台预留原则：

- Windows 是首个交付平台，但所有平台相关路径、二进制名、签名、日志目录、子进程启动参数都必须通过平台适配层读取，不能散落在业务代码中。
- Windows 使用 `%APPDATA%\LazyRAG` 作为默认用户数据目录；macOS 后续使用 `~/Library/Application Support/LazyRAG`，两者内部目录结构保持一致。
- 后端服务不得依赖 Windows-only 路径分隔符、shell 命令、盘符语义或注册表；需要平台能力时由 Electron main process 统一封装。

### 1.2 用户与权限目标

Desktop Mode 仍保留“用户”概念，但产品语义改成“AI 助手”：

- 首次启动自动创建默认用户组、默认写权限和至少一个默认 AI 助手。
- 免登录，打开应用即进入排序后的首个用户，也就是首个 AI 助手。
- 可以新建 AI 助手；后台本质上仍创建用户。
- 新建 AI 助手自动加入默认用户组，并具备写权限。
- 所有用户在 Desktop Mode 中平级，不保留“主用户/子用户”层级概念。
- 助手切换复用 Cloud Mode 的“切换用户”语义：切换后当前请求、会话、技能、记忆、偏好都属于选中的用户。
- 技能页面可以切换 AI 助手，查看和维护该助手的技能、词汇、偏好。
- 问答页面可以切换 AI 助手，以该助手身份进行问答，会话、记忆、偏好按助手隔离。

### 1.3 核心原则

- 保留 Cloud/Server Mode 与 Desktop Mode 双模式，不把云端能力直接删掉。
- Desktop Mode 用配置开关和适配层实现，不通过大面积 fork 代码实现。
- 不在 MVP 阶段追求算法效果完整性；MVP 只验证桌面模式迁移、进程编排、前后端主流程和 Python 算法模块可打包运行。
- 最终完整功能阶段再接入真实检索、解析、向量库和全文检索。
- 所有外部依赖改动必须形成独立清单，便于提交给依赖维护者。

### 1.4 共存友好原则

Desktop Mode 的改造必须以“同一代码仓库同时产出 Cloud artifact 与 Desktop app”为硬约束。Desktop 不是 Cloud 的替代分支，也不能让云端构建链路被桌面依赖污染。

- Cloud Mode 仍以现有 `Makefile`、`docker-compose.yml`、各服务 `Dockerfile`、`.github/workflows/docker-release.yml` 为主线，默认构建、启动和发布行为不因 Desktop Mode 改变。
- Desktop Mode 新增独立构建入口，例如 `make desktop-build`、`desktop/package.json`、`desktop/electron-builder.yml`；不得复用或改写 Cloud Docker release 流程作为唯一入口。
- 所有 Desktop 差异必须由 `LAZYRAG_MODE=desktop`、`VITE_LAZYRAG_MODE=desktop` 或 Electron 注入配置显式启用；未设置时默认仍是 Cloud/Server 行为。
- 前端使用同一套源码构建 Cloud Web 静态资源和 Desktop Renderer 静态资源；差异通过 build mode、feature flag、auth facade 和路由策略实现，不复制一套前端。
- Go/Python 服务可以共享业务代码，但 Desktop-only 入口、mock backend、本地 store、Electron IPC 适配不得进入 Cloud 默认依赖链。
- Cloud 依赖和 Desktop 依赖分层管理；Desktop 引入的 Electron、electron-builder、PyInstaller/Nuitka、LanceDB/Qdrant local 等不能成为 Cloud Docker image 的必需依赖。
- 替换 PostgreSQL、Redis、Milvus、OpenSearch 的改造必须先抽象接口，再并存实现；不能删除 Cloud 实现，也不能把 Cloud 实现改成 Desktop 实现的别名。
- CI 必须形成双模式守护：Cloud lint/test/docker build 不回退，Desktop build/smoke test 独立失败、独立定位。

## 2. 当前代码审阅结论

### 2.1 SQLite 不是简单配置切换

`backend/core/main.go` 已有 `ACL_DB_DRIVER=sqlite` fallback，但 core 启动后仍调用 `store.MustRedisFromEnv()`，说明 SQLite 支持只覆盖了部分关系库连接。

实际执行 core 全量迁移时，SQLite 迁移失败：

```text
ERR up failed error="near \"打造的顶尖\": syntax error"
```

失败点来自 `backend/core/migrations/20260506120000_seed_default_model_providers.up.sql` 中 PostgreSQL 风格 SQL，例如 dollar-quoted string 和 `now()`。因此完整功能阶段必须做迁移脚本兼容治理，不能只设置 `ACL_DB_DRIVER=sqlite`。

### 2.2 Redis 不是普通缓存，不能直接用 `sync.Map` 替换

`backend/core/chat/redis_cache.go` 直接依赖 `*redis.Client`，并使用 `HSet`、`HGetAll`、`RPush`、`LRange`、`LPush`、`BLPop`、TTL 等语义。尤其 `BLPop` 涉及阻塞等待和取消信号，简单 `sync.Map` 不能等价替代。

结论：需要先抽象 `ChatRuntimeStore` 或类似接口，再实现 Redis 版和 Desktop 内存版。

### 2.3 算法模块当前强绑定 PostgreSQL、Milvus、OpenSearch

`algorithm/processor/db.py` 只接受 PostgreSQL URL，非 PostgreSQL scheme 会报错。`algorithm/parsing/build_document.py` 硬要求 `LAZYRAG_MILVUS_URI` 与 `LAZYRAG_OPENSEARCH_URI`，并写死 `vector_store.type = milvus`、`segment_store.type = opensearch`。

`algorithm/chat/tools/kb.py` 还直接向 OpenSearch `_search` HTTP API 发请求。这说明 OpenSearch 替换不是配置变更，而是检索抽象与 LazyLLM store 适配问题。

### 2.4 auth-service 不能只隐藏登录页

`backend/auth-service/bootstrap.py` 当前只自动创建角色和 bootstrap admin，没有自动创建默认用户组并把 admin 加进去。`backend/auth-service/core/deps.py` 在没有 Bearer token 时会返回未授权。前端 `frontend/src/components/auth.ts` 也依赖 localStorage 中的 token 判断登录状态。

结论：免登录需要后端 desktop auth provider、前端 desktop auth facade、Electron proxy header 注入一起完成。

### 2.5 “切换助手”不是纯前端 Select

`backend/core/chat/conversation.go` 使用请求中的 `X-User-Id` 作为会话创建者和资源上下文用户。前端当前 `AgentAppsAuth.getAuthHeaders()` 也把登录用户写入 `X-User-Id`。

Desktop Mode 不引入“主用户管理子用户”的层级。更合理的做法是沿用 Cloud Mode 切换用户的产品语义：当前选中的 AI 助手就是当前用户，前端请求中的 `X-User-Id` 直接表示当前助手。

需要注意的是，Electron 仍要有一个本地系统上下文来完成首次初始化、默认组创建、权限补齐和诊断导出，但该上下文不应暴露成产品里的主用户/子用户层级。这样既能复用现有用户模型，又避免在 Desktop Mode 中引入一套和 Cloud Mode 不一致的身份体系。

## 3. 总体架构

### 3.1 运行架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron                                                     │
│  ├─ Renderer: frontend build output                          │
│  ├─ Local Proxy: /api/* -> local backend ports                │
│  ├─ Process Manager: start / stop / health / logs            │
│  └─ Desktop Config: ports, paths, desktop mode env            │
└──────────────────────────────────────────────────────────────┘
        │
        ├─ Go backend
        │   ├─ core
        │   ├─ scan-control-plane
        │   └─ file-watcher
        │
        ├─ Python backend
        │   ├─ auth-service
        │   ├─ chat
        │   ├─ parsing / processor / doc-service
        │   └─ evo
        │
        └─ Local stores
            ├─ SQLite relational DB
            ├─ retrieval index or mock store
            ├─ uploaded files
            ├─ generated artifacts
            └─ logs
```

### 3.2 模式开关

新增统一环境变量：

```env
LAZYRAG_MODE=desktop
LAZYRAG_DESKTOP_DATA_DIR=%APPDATA%/LazyRAG
LAZYRAG_DESKTOP_DISABLE_LOGIN=1
LAZYRAG_DESKTOP_USER_HEADER=X-User-Id
LAZYRAG_DESKTOP_LOG_DIR=%APPDATA%/LazyRAG/logs
```

所有差异逻辑应通过 `LAZYRAG_MODE=desktop` 或更细粒度配置启用。Cloud/Server Mode 默认行为不变。

macOS 后续只替换平台默认值，不改变业务语义：

```env
LAZYRAG_DESKTOP_DATA_DIR=~/Library/Application Support/LazyRAG
LAZYRAG_DESKTOP_LOG_DIR=~/Library/Logs/LazyRAG
```

### 3.3 端口与代理

Electron 本地代理提供统一入口，前端只访问相对路径：

```text
/api/core/*        -> core
/api/authservice/* -> auth-service
/api/chat/*        -> chat
/api/scan/*        -> scan-control-plane
/api/file/*        -> file-watcher
/api/evo/*         -> evo
```

代理负责：

- 注入当前选中 AI 助手的 `X-User-Id`。
- 处理 CORS、SSE、上传大文件、下载文件。
- 收集后端健康状态并反馈给前端。

### 3.4 本地目录与日志

Desktop Mode 必须统一管理本地目录，避免每个模块自行决定写入位置。

Windows 默认目录：

```text
%APPDATA%\LazyRAG\
  config.yaml
  data\
  uploads\
  retrieval\
  cache\
  logs\
    electron-main.log
    proxy.log
    core.log
    auth-service.log
    algorithm-chat.log
    algorithm-parsing.log
    algorithm-processor.log
    scan-control-plane.log
    file-watcher.log
    evo.log
    crash\
    diagnostics\
  backups\
```

macOS 后续目录：

```text
~/Library/Application Support/LazyRAG/
  config.yaml
  data/
  uploads/
  retrieval/
  cache/
  backups/

~/Library/Logs/LazyRAG/
  electron-main.log
  proxy.log
  core.log
  auth-service.log
  algorithm-chat.log
  algorithm-parsing.log
  algorithm-processor.log
  scan-control-plane.log
  file-watcher.log
  evo.log
  crash/
  diagnostics/
```

日志要求：

- Electron process manager 必须把每个子进程的 stdout/stderr 按模块写入独立日志文件。
- 每条日志至少包含时间、level、module、pid、request_id 或 task_id、当前用户 ID、关键路径参数和错误堆栈。
- MVP 阶段日志应偏详细，默认记录进程启动参数、端口、数据目录、健康检查、代理转发、SQLite 路径、mock 算法调用、文件解析任务状态。
- 日志支持滚动、大小上限和诊断包导出；诊断包应能一键收集配置摘要、进程状态、最近日志和崩溃文件。
- 日志中不得记录明文 token、API key、模型密钥和用户上传文档正文。

## 4. 三阶段落地计划

### 4.1 阶段一：MVP

MVP 阶段的目的不是验证算法效果，而是验证 Desktop Mode 迁移路径是否成立：

- Electron 能加载现有前端构建产物。
- Electron 能启动 Go 和 Python 后端进程。
- 前端能通过本地代理完成免登录访问。
- 用户/AI 助手主流程能创建、排序、默认进入、切换、传递身份。
- Chat、技能、知识库等主入口能跑通最小闭环。
- Python 算法模块能以 Desktop Mode 启动、被调用、返回 mock 或降级结果。

#### 4.1.1 MVP 中间件调研与建议

MVP 默认不引入重型中间件。调研结论如下：

| 选项 | 适合 MVP | 结论 |
| --- | --- | --- |
| 纯内存 + 文件 mock | 是 | 最适合验证 Electron 迁移和进程编排，避免被检索质量与索引兼容拖住 |
| SQLite | 是 | 适合验证关系库迁移、默认用户、助手、会话和技能数据 |
| SQLite FTS5 | 可选 | 可验证全文检索接口，但中文效果和 OpenSearch 查询兼容不是 MVP 重点 |
| LanceDB | 可选 | 官方文档描述为进程内嵌入式库，支持本地路径，适合作为完整功能候选检索存储 |
| Qdrant local mode | 可选 | Python local mode 支持内存和磁盘，适合替代向量库服务，但需要适配 LazyLLM |
| Milvus Lite | 否 | Milvus 官方文档明确只列 Ubuntu/macOS 支持，未列 Windows；Windows Desktop 不采用 Milvus Lite |
| OpenSearch | 否 | 与 Desktop “无 Docker、少中间件”目标冲突 |
| Redis | 否 | MVP 应通过内存运行时存储验证，不启动 Redis |
| PostgreSQL | 否 | MVP 应强制暴露 SQLite 兼容问题 |

MVP 推荐决策：

```text
关系数据: SQLite
Chat runtime: 内存实现
检索: MockRetrievalStore + 文件/SQLite 中保存测试数据
向量: 不启用真实向量库，或只做 LanceDB/Qdrant 的独立 spike
全文: 不启用 OpenSearch，必要时用 SQLite FTS5 做最小验证
```

MVP 中算法模块仍要验证，但验证范围是“Python 服务能在 Desktop Mode 下运行和被调用”，不是完整 RAG：

- 提供 `LAZYRAG_ALGO_BACKEND=mock`。
- `chat` 返回可控 mock answer 或调用在线模型但使用 mock context。
- `parsing` 接收文件并生成 mock document/chunk metadata。
- `processor` 跑通任务提交、状态查询和回调，不要求真实解析质量。
- `doc-service` 提供最小文档列表和状态接口。
- `evo` 可先关闭或提供健康检查 mock。

在 LazyLLM 完成外部依赖改动之前，MVP 阶段仍然可以开发，但必须把边界切清楚：

- 可以开发 Electron shell、process manager、本地代理、日志目录、诊断包、前端 Desktop Mode 路由、免登录 facade、助手管理和助手切换。
- 可以开发 core/auth/scan/file-watcher 的 Desktop Mode 最小链路，使用 SQLite、内存 runtime 和本地文件目录。
- 可以开发 algorithm mock backend，并验证 Python 服务在 Desktop 环境变量、数据目录、日志目录、打包 smoke test 下能启动和被调用。
- 不应把完整文档解析、真实向量检索、OpenSearch DSL 迁移、LazyLLM SqlManager SQLite 支持作为 MVP 阻塞项。
- 需要预留接口契约：MVP 的 mock retrieval、mock parsing、mock doc-service 必须和未来 LazyLLM 真实实现使用同一层 LazyRAG 侧接口，避免后续推倒重写。
- MVP 验收报告要明确标记哪些链路是 mock，哪些链路是真实本地实现。

#### 4.1.2 MVP 后端步骤

1. 新增 Desktop Mode 配置读取层，统一解析 `LAZYRAG_MODE=desktop`、数据目录、端口、日志目录。
2. core 支持 SQLite 启动所需的最小迁移集合，先绕开或修复 PostgreSQL 专属 SQL。
3. 为 core chat runtime 抽象接口，保留 Redis 实现，新增 in-memory 实现。
4. auth-service 新增 desktop auth provider，启动时创建默认用户组、默认权限和默认 AI 助手用户。
5. auth-service 保留用户、角色、组、权限表结构，Desktop 只隐藏复杂权限配置，不删除模型。
6. scan-control-plane 使用 SQLite driver 启动最小服务。
7. file-watcher 以本地目录模式运行，不依赖云端对象存储。
8. algorithm 新增 mock backend，允许不配置 PostgreSQL、Milvus、OpenSearch 时启动。
9. chat API 使用当前 `X-User-Id` 作为助手用户，并在 mock 模式下返回可验证响应。
10. 所有后端提供 `/health` 或等价健康检查，供 Electron process manager 等待。
11. 所有模块统一读取 `LAZYRAG_DESKTOP_LOG_DIR`，详细输出启动、请求、任务、异常和降级原因。
12. Desktop MVP 的 mock backend、in-memory runtime、SQLite 配置只能在 `LAZYRAG_MODE=desktop` 下启用；未设置该模式时必须继续使用 Cloud 默认实现。

#### 4.1.3 MVP 前端步骤

1. 新增 `desktop` 构建开关或运行时开关。
2. 去掉 Desktop Mode 下的登录、注册、登录跳转入口。
3. `AgentAppsAuth` 在 Desktop Mode 下返回当前选中的 AI 助手用户身份。
4. “用户管理”在 Desktop Mode 下显示为“AI 助手管理”。
5. 新建 AI 助手时只输入助手名称和必要描述，后台仍调用用户创建 API。
6. 新建完成后自动加入默认用户组并授予写权限。
7. 新增全局或局部 Assistant Switcher，语义与 Cloud Mode 的切换用户一致。
8. 首次进入 Desktop Mode 时按排序规则选中首个 AI 助手。
9. 技能页面读取当前 `X-User-Id` 对应的助手。
10. Chat 页面读取当前 `X-User-Id` 对应的助手，并将会话列表按助手隔离。
11. 前端请求全部使用相对路径，由 Electron proxy 分发。
12. Cloud Mode 登录、注册、Kong 代理路径、RBAC 页面不得删除；Desktop Mode 只通过 mode 条件隐藏或替换入口。
13. 前端构建产物需要区分 Cloud Web 和 Desktop Renderer，二者共用源码但使用不同 build mode 和配置。

#### 4.1.4 MVP Electron 步骤

1. 新增 `desktop/` 项目。
2. 加载前端构建产物。
3. 实现 process manager，启动 core、auth-service、algorithm mock、可选 scan/file-watcher。
4. 实现本地代理，支持 REST、SSE、上传、下载。
5. 初始化 `%APPDATA%/LazyRAG` 数据目录。
6. macOS 路径通过平台适配层预留为 `~/Library/Application Support/LazyRAG` 和 `~/Library/Logs/LazyRAG`。
7. 写入桌面端环境变量。
8. 采集后端 stdout/stderr 到日志目录，并按模块拆分日志文件。
9. 前端展示本地服务健康状态和诊断日志入口。
10. 新增 Desktop 构建入口时必须使用独立目录和脚本，不改写现有 `make up`、`make build` 的语义。

#### 4.1.5 MVP 验收标准

- 全新数据目录首次启动成功。
- 不启动 Docker、Kong、PostgreSQL、Redis、OpenSearch、Milvus standalone。
- 打开应用直接进入主界面。
- 默认进入排序后的首个 AI 助手。
- 可以创建 AI 助手。
- 技能页面切换助手后，请求中带正确 `X-User-Id`。
- Chat 页面切换助手后，请求中带正确 `X-User-Id`，且 mock answer 正常返回。
- 关闭 Electron 后所有子进程退出。
- 后端异常退出时 Electron 能提示并收集日志。
- 诊断包能导出最近日志、进程状态和关键配置摘要。
- 新增 Desktop 代码后，Cloud artifact smoke test 通过：现有 `make build`、前端 `pnpm build`、Go/Python 现有测试不被破坏。
- `LAZYRAG_MODE` 未设置时，Cloud 默认配置、路由、登录、RBAC、Kong、PostgreSQL/Redis/Milvus/OpenSearch 依赖链路不变。

### 4.2 阶段二：完整功能

完整功能阶段的目标是在开发机上跑起完整 Desktop Mode，接入最终选型的本地存储和检索能力，并做功能与性能初步测试。

#### 4.2.1 最终存储选型建议

本文建议的完整功能默认选型：

```text
关系数据库: SQLite
Chat runtime: 内存实现，必要状态落 SQLite
检索存储: LanceDB 优先评估，Qdrant local 作为备选
全文检索: LanceDB full-text/hybrid 优先评估，SQLite FTS5 作为备选
Milvus Lite: Windows 平台不采用
```

理由：

- SQLite 是关系数据最小依赖方案，但必须完成迁移兼容与多进程写入治理。
- LanceDB 是嵌入式本地库，官方文档明确支持本地路径和进程内运行，产品形态更接近 Desktop。
- Qdrant local mode 支持内存和磁盘，适合作为 Python 生态向量检索备选。
- Milvus Lite 与现有 Milvus API 最接近，但官方文档的 prerequisites 只列 Ubuntu >= 20.04 和 macOS >= 11.0，没有 Windows；Windows Desktop 不能把不支持的平台依赖作为方案选型。
- Milvus Lite 官方文档还说明它只适合小规模向量检索，并且索引只支持 FLAT；即使后续 macOS 版本单独评估，也不能默认等价替代云端 Milvus。
- OpenSearch 是独立服务型中间件，不符合桌面端“少中间件、易安装”的默认目标。

最终选型前必须完成 spike：

1. 在 Windows 开发机验证 Python wheel 安装。
2. 验证 PyInstaller 或最终打包工具能包含依赖。
3. 验证新增、删除、更新、重建索引。
4. 验证中文检索、metadata filter、top-k、hybrid search。
5. 验证与 LazyLLM Document/Retriever 调用链集成。
6. 验证数据目录迁移和损坏恢复。
7. 在 macOS 开发机做同一套 smoke test，提前暴露路径、动态库、签名和子进程启动差异。

#### 4.2.2 关系库完整改造

1. 将 core migrations 拆成 PostgreSQL/SQLite 兼容层，或改写为 GORM/迁移 DSL。
2. 修复 PostgreSQL 专属 SQL：dollar-quoted string、`now()`、JSON/UUID 类型、索引语法、`ALTER TABLE` 差异。
3. auth-service alembic 在 SQLite 下跑通。
4. scan-control-plane 使用 SQLite 跑通完整 AutoMigrate 和业务查询。
5. algorithm LazyLLM 管理表支持 SQLite 或通过依赖侧 SqlManager 支持 SQLite。
6. 配置 SQLite WAL、busy timeout、foreign key、日志和备份策略。
7. 明确 DB 文件拆分，避免无意义的多进程写锁竞争。

建议 DB 文件：

```text
%APPDATA%/LazyRAG/data/main.db
  - auth-service 用户/角色/组/权限
  - core 业务表
  - scan-control-plane 表

%APPDATA%/LazyRAG/data/algo.db
  - lazyllm 文档解析与任务表
  - algorithm/doc-service 管理表
```

如果多进程共写 `main.db` 出现锁竞争，应优先通过单写进程或服务 API 收敛写入，而不是盲目增加重试。

#### 4.2.3 检索完整改造

1. 在 LazyRAG 侧定义统一接口：

```text
VectorStore
  - create_collection
  - upsert
  - delete
  - search
  - rebuild

SegmentStore
  - create_index
  - upsert_segments
  - delete_by_doc
  - keyword_search
  - hybrid_search
```

2. 保留 Cloud Mode 的 Milvus/OpenSearch 实现。
3. 新增 Desktop Mode 的 LanceDB 或 Qdrant/SQLite 实现。
4. 修改 `algorithm/parsing/build_document.py`，不再强制要求 `LAZYRAG_MILVUS_URI` 和 `LAZYRAG_OPENSEARCH_URI`。
5. 修改 `algorithm/chat/tools/kb.py`，不再直接拼 OpenSearch `_search` URL，改为调用 SegmentStore。
6. 对中文全文检索建立基准测试，至少覆盖关键词、短语、metadata filter、top-k 排序。
7. 建立索引重建命令和 UI 入口。

#### 4.2.4 算法模块完整改造

1. `algorithm/processor/db.py` 支持 SQLite URL。
2. DocumentProcessor、DocumentProcessorWorker 在 SQLite 下跑通。
3. parse-server、parse-worker 可在同一 Python 进程内运行，也可保留独立进程，由 Electron 管理。
4. doc-server 读取本地 algo DB。
5. chat service 支持 Desktop retrieval backend。
6. vocab、memory、skill 相关代码使用 SQLite 兼容 SQL。
7. OCR、Office 转换、MinerU、PaddleOCR 设为可选能力，缺失时有明确降级提示。
8. evo 默认作为可选模块启动，完整功能阶段验证基本自演化流程。

#### 4.2.5 Go 服务完整改造

1. core、scan-control-plane、file-watcher 先保持独立 exe，由 Electron 管理。
2. 不在完整功能阶段强制合并 Go 模块；当前三个模块有独立 `go.mod` 和 `internal` 包，直接合并会引入额外重构风险。
3. 如果后续确实需要单一 Go binary，再先重构公共库边界。
4. core 中所有 Redis 使用点改为接口注入。
5. ACL 用户组查询在 Desktop Mode 优先本地 DB，不依赖 auth-service 内部接口往返。
6. 保留 RBAC 数据结构，Desktop Mode 只使用默认角色、默认组、默认写权限。

#### 4.2.6 前端完整改造

1. 建立 Desktop Mode 路由策略，不删除 Cloud Mode 登录/注册路由。
2. Desktop Mode 默认进入 Chat 或首页。
3. 用户管理页在 Desktop Mode 显示为 AI 助手管理。
4. 用户组和权限高级页面默认隐藏，可通过开发者模式显示。
5. Assistant Switcher 统一封装，Chat、技能、偏好、词汇共用。
6. 请求层统一注入当前助手用户的 `X-User-Id`。
7. SSE、上传、下载走 Electron proxy。
8. 错误提示中区分“本地服务未启动”“索引未初始化”“模型未配置”“算法后端降级”。

#### 4.2.7 完整功能验证

共存验证：

- 建立双模式测试矩阵：Cloud 使用 PostgreSQL、Redis、Milvus、OpenSearch、Kong；Desktop 使用 SQLite、in-memory runtime、LanceDB 或 Qdrant local、Electron proxy。
- 对核心抽象增加双实现测试：`ChatRuntimeStore` 覆盖 Redis 与 in-memory，`VectorStore` 覆盖 Milvus 与 Desktop store，`SegmentStore` 覆盖 OpenSearch 与 Desktop store。
- 数据库迁移必须覆盖 PostgreSQL 与 SQLite；新增迁移不得只在 SQLite 通过而破坏 Cloud PostgreSQL。
- LazyLLM/submodule 改动必须保持 Milvus、OpenSearch、PostgreSQL 默认路径兼容，Desktop store 作为新增类型接入。

功能验证：

- 首次启动初始化。
- 模型配置。
- 创建 AI 助手。
- 创建知识库。
- 上传文档。
- 文档解析。
- 索引构建。
- Chat RAG 问答。
- 技能、词汇、偏好按助手隔离。
- 助手切换后会话隔离。
- 数据源扫描。
- 关闭与重启后数据仍可用。

性能与稳定性验证：

- 启动时长。
- 空数据与已有数据启动。
- 单文档、小批量、多批量导入。
- SQLite 写锁冲突。
- 索引重建。
- 大文件上传。
- SSE 长连接。
- 后端异常退出和恢复。
- 数据目录备份与恢复。

### 4.3 阶段三：安装包

安装包阶段只在完整功能已经能在开发机完整运行后开始。

#### 4.3.1 打包结构

```text
C:\Program Files\LazyRAG\
  LazyRAG.exe
  resources\
    app.asar
    renderer\
    bin\
      core.exe
      scan-control-plane.exe
      file-watcher.exe
      auth-service\
      algorithm\
      evo\
    templates\
      runtime_models.yaml
      default_config.yaml
```

用户数据目录：

```text
%APPDATA%\LazyRAG\
  config.yaml
  data\
    main.db
    algo.db
    retrieval\
  uploads\
  logs\
  cache\
  backups\
```

macOS 后续保持同构目录，只替换平台默认位置：

```text
/Applications/LazyRAG.app

~/Library/Application Support/LazyRAG/
  config.yaml
  data/
    main.db
    algo.db
    retrieval/
  uploads/
  cache/
  backups/

~/Library/Logs/LazyRAG/
  electron-main.log
  proxy.log
  core.log
  auth-service.log
  algorithm-chat.log
  algorithm-parsing.log
  algorithm-processor.log
  scan-control-plane.log
  file-watcher.log
  evo.log
```

#### 4.3.2 打包步骤

1. 前端构建产物复制到 Electron renderer。
2. Go 服务编译 Windows exe。
3. Python 服务用 PyInstaller、Nuitka 或其他最终工具打包成可执行目录。
4. 将 lazyllm、模型配置、模板文件、静态资源、证书等作为资源文件纳入包。
5. electron-builder 生成 Windows 安装包。
6. 安装后首次启动复制初始配置到 `%APPDATA%/LazyRAG`。
7. 卸载时默认保留用户数据，提供可选清理。
8. 添加崩溃日志、后端日志、诊断包导出能力。
9. 保持 electron-builder 配置可扩展到 macOS notarization、签名和 `.dmg`/`.pkg` 输出。
10. Cloud release 仍由 Docker workflow 产出 Linux 镜像；Desktop release 由 Electron workflow 产出 Windows 安装包，后续扩展 macOS。
11. Cloud 与 Desktop 的 artifact 命名、版本号、发布目录和 CI workflow 分离，避免 Docker image 与 Electron app 互相依赖。

#### 4.3.3 安装包验证

1. 干净 Windows 环境安装。
2. 无 Python、Go、Node、Docker 环境运行。
3. 普通用户权限运行。
4. 中文路径和空格路径运行。
5. Windows Defender 扫描与签名验证。
6. 离线启动和在线模型配置。
7. 升级安装不破坏 `%APPDATA%/LazyRAG` 数据。
8. 卸载后应用程序目录清理正确。
9. macOS 预留验证项包括 `.app` 沙箱外数据目录、签名/notarization、Gatekeeper、权限弹窗和子进程退出。
10. 发布前同时验收 Cloud artifact 和 Desktop app，防止桌面化改造引入云端回归。

## 5. 组件改造方案

### 5.1 Electron

新增 `desktop/`：

```text
desktop/
  package.json
  electron-builder.yml
  src/main/index.ts
  src/main/process-manager.ts
  src/main/proxy-server.ts
  src/main/config.ts
  src/main/health.ts
  src/preload/index.ts
```

职责：

- 管理子进程生命周期。
- 分配本地端口。
- 写入环境变量。
- 统一代理 API。
- 注入当前助手用户的 `X-User-Id`。
- 管理日志。
- 初始化和迁移本地数据目录。
- 暴露桌面端能力给 renderer，例如选择目录、打开日志、导出诊断包。

### 5.2 Auth 与 RBAC

Desktop Mode 不删除 RBAC，而是简化使用方式：

- 保留角色、权限、用户组表。
- 默认创建 `system-admin`、`user`、默认用户组和默认权限。
- 首次启动创建至少一个默认 AI 助手用户，并加入默认用户组。
- 新建 AI 助手自动加入默认用户组，授予写权限。
- 所有 AI 助手用户平级；Desktop Mode 不引入主用户/子用户层级。
- 前端隐藏复杂 RBAC 页面。
- 后端保留权限检查，Desktop 默认数据让检查自然通过。
- 需要快速推进 MVP 时，可在 Desktop Mode 提供临时 pass-through，但完整功能阶段必须回到真实数据模型。

### 5.3 Kong

Desktop Mode 去掉 Kong Gateway。原因是桌面端本地应用不需要独立 API Gateway，且 Kong 插件、Lua、容器化会显著增加安装复杂度。

替代方案：

- Electron local proxy 做路径分发。
- auth-service 保留认证/用户管理 API。
- core 等服务保留自己的路由。
- Cloud Mode 继续使用 Kong，不受影响。

### 5.4 PostgreSQL 到 SQLite

Desktop Mode 使用 SQLite，但不是一次性全量替换：

1. MVP 只跑通最小表集合。
2. 完整功能阶段修复所有迁移兼容性。
3. 对高并发写入点做 API 收敛或 DB 拆分。
4. 所有 SQL 需要测试 PostgreSQL 和 SQLite 双模式。

### 5.5 Redis 到 Desktop Runtime Store

新增接口，不直接把 Redis 调用替换成 map：

```text
ChatRuntimeStore
  - SetStatus
  - GetStatus
  - ListGenerating
  - AppendChunk
  - GetChunksFrom
  - SetInput
  - GetInput
  - SetCancelSignal
  - WatchCancelSignal
  - Clear
```

实现：

- Cloud Mode: Redis。
- Desktop MVP: in-memory。
- Desktop 完整功能: in-memory + 必要状态落 SQLite 或文件。

### 5.6 检索与算法

原始方案提出 `Milvus -> Milvus Lite`、`OpenSearch -> SQLite FTS5`。新版方案改成先抽象、再选型：

- Cloud Mode 继续 Milvus + OpenSearch。
- Desktop MVP 使用 mock retrieval。
- Desktop 完整功能优先验证 LanceDB。
- 如果 LanceDB 不满足 LazyLLM 集成或检索质量，再选择 Qdrant local + SQLite FTS5。
- Windows Desktop 不采用 Milvus Lite；如后续 macOS Desktop 需要，可基于官方支持范围单独评估，但不影响 Windows 主线选型。

### 5.7 Office/OCR/解析

Desktop Mode 默认不把 Office 转换、OCR、MinerU、PaddleOCR 作为 MVP 必需能力：

- MVP 允许 mock parse 或仅支持 txt/md/pdf 的轻量解析。
- 完整功能阶段按依赖可打包性逐项启用。
- 安装包阶段对大型 OCR/Office 依赖提供可选组件或降级提示。

### 5.8 Evo

Evo 在 MVP 可关闭或仅保留健康检查。完整功能阶段作为独立进程接入。安装包阶段再纳入完整打包和诊断。

原因是 Evo 依赖代码工作区、外部二进制、模型能力和文件权限，过早纳入 MVP 会干扰 Desktop 迁移验证。

## 6. 外部依赖改动清单

本章专门列出需要提交给外部依赖维护者或 submodule 维护者的改动，尤其是 `algorithm/lazyllm`。

### 6.1 LazyLLM SqlManager / DocServer

需要支持：

- SQLite database URL。
- SQLite schema 初始化。
- SQLite 下任务队列表、文档表、KB 表的 CRUD。
- PostgreSQL 与 SQLite 双模式测试。
- database URL parser 不应只接受 PostgreSQL。
- 清理/重建表逻辑不能硬编码 PostgreSQL SQLAlchemy driver。

当前 LazyRAG 侧受影响路径：

- `algorithm/processor/db.py`
- `algorithm/processor/server.py`
- `algorithm/processor/worker.py`
- `backend/core/doc/doc_server.py`
- `backend/core/common/readonlyorm/*`

### 6.2 LazyLLM RAG Store

需要支持可插拔 store：

- `vector_store.type = milvus` 继续保留。
- 新增 `vector_store.type = lancedb` 或 `qdrant_local`。
- `segment_store.type = opensearch` 继续保留。
- 新增 `segment_store.type = lancedb`、`sqlite_fts` 或 `mock`。
- DocumentProcessor 不应在没有 Milvus/OpenSearch 配置时直接失败，而应按 store type 校验。
- Retriever 不应要求 OpenSearch HTTP `_search` API 语义。

当前 LazyRAG 侧受影响路径：

- `algorithm/parsing/build_document.py`
- `algorithm/chat/tools/kb.py`
- `algorithm/chat/components/agentic/config.py`
- `algorithm/chat/components/process/context_expansion.py`

### 6.3 LazyLLM Windows/macOS 与打包兼容

需要验证和修复：

- Windows 路径分隔符。
- `%APPDATA%` 数据目录。
- macOS `~/Library/Application Support` 与 `~/Library/Logs` 数据目录。
- PyInstaller/Nuitka 下资源文件定位。
- 动态 import 和 plugin discovery。
- FileSystemQueue 在 Windows 下的锁文件清理。
- macOS 签名/notarization 后的资源定位、动态库加载和子进程执行权限。
- tracing 本地 sink 在打包后可用。
- lazyllm CLI 或内部入口不依赖 Linux shell，也不依赖 Windows-only shell。

当前 LazyRAG 侧受影响路径：

- `algorithm/chat/pipelines/agentic.py`
- `algorithm/chat/app/core/trace_sink.py`
- `algorithm/chat/app/core/chat_service.py`
- `algorithm/Dockerfile` 中安装 lazyllm 的流程需要迁移为桌面构建流程。

### 6.4 Windows 平台不采用 Milvus Lite

Windows Desktop 明确不采用 Milvus Lite，不再把 Milvus Lite 作为 Windows 依赖改造目标。

原因：

- Milvus Lite 官方文档的 prerequisites 只列 Ubuntu >= 20.04 和 macOS >= 11.0，没有 Windows。
- Windows 桌面安装包需要默认依赖可安装、可打包、可升级，不能依赖官方未声明支持的平台。
- Milvus Lite 只适合小规模向量检索，且索引只支持 FLAT；这会限制完整功能阶段的性能和规模边界。

替代方向：

- LazyLLM 侧应优先支持 `vector_store.type = lancedb` 或 `qdrant_local`。
- LazyRAG Windows Desktop 的默认向量检索实现优先选择 LanceDB，Qdrant local 作为备选。
- macOS Desktop 后续可以单独评估 Milvus Lite，但必须作为 macOS 特定选项，不进入 Windows 主线。

## 7. 与原始方案不同的地方

### 7.1 不建议“去掉 RBAC”

原始方案：去掉 RBAC，单用户组，admin 直接进入。

新版方案：不删除 RBAC 数据模型和检查链路，只在 Desktop Mode 下自动创建默认角色、默认组、默认权限和默认 AI 助手用户，并隐藏高级权限 UI。

理由：

- 用户、组、权限已深度影响 core ACL、auth-service、前端 admin 页面。
- 直接删除 RBAC 容易破坏 Cloud Mode。
- Desktop 仍需要“多个 AI 助手用户都具备写权限”的一致数据边界，保留权限模型更安全。
- 保留 RBAC 能让 Desktop 数据未来迁移回 Server Mode。

### 7.2 不建议引入“主用户/子用户”层级

原始方案：进去就是 admin，可以新建用户，容易演化成 admin 管理其他用户的层级模型。

新版方案：Desktop Mode 中所有用户平级，产品上都显示为 AI 助手；打开程序默认进入排序后的首个用户，切换助手等价于 Cloud Mode 的切换用户。

理由：

- 现有 Cloud Mode 已有切换用户语义，Desktop 复用它比新增主从身份更稳。
- 主用户/子用户会让会话归属、技能归属、权限检查和数据导出变复杂。
- 平级用户更符合“多个 AI 助手”的产品心智，也便于后续 Windows/macOS 数据兼容。

### 7.3 Windows 平台不采用 Milvus Lite

原始方案：Milvus 替换为 Milvus Lite。

新版方案：Windows Desktop 明确不采用 Milvus Lite；完整功能优先评估 LanceDB，Qdrant local 作为备选。

理由：

- Milvus 官方文档当前列出的 Milvus Lite 支持环境是 Ubuntu 和 macOS，未列 Windows。
- Desktop 目标是 Windows 安装包，默认选型不能建立在未验证平台支持上。
- Milvus Lite 官方文档说明它只适合小规模向量检索，且索引只支持 FLAT；完整功能阶段需要为性能和规模留出空间。
- LanceDB 和 Qdrant local 更符合嵌入式/本地模式。

### 7.4 不建议把 OpenSearch 替换描述为“SQLite FTS5 适配层”即可

原始方案：OpenSearch 替换为 SQLite FTS5。

新版方案：先抽象 SegmentStore，再决定 LanceDB full-text/hybrid、SQLite FTS5 或其他实现。

理由：

- 当前代码直接发 OpenSearch `_search` 请求。
- LazyLLM Document store 也写死 `segment_store.type = opensearch`。
- OpenSearch 查询 DSL、中文分词、metadata filter、排序评分不能自动等价到 SQLite FTS5。
- 直接替换会影响检索质量和 Agentic KB 工具。

### 7.5 不建议 MVP 阶段追求完整算法能力

原始方案：较早完整替换 PostgreSQL、Redis、Milvus、OpenSearch。

新版方案：MVP 使用 mock retrieval、内存 runtime 和最小 SQLite，只验证 Desktop Mode 主链路。

理由：

- 当前算法模块同时受 PostgreSQL、LazyLLM、Milvus、OpenSearch、打包兼容影响。
- 如果 MVP 直接做完整算法，会把 Electron 迁移风险和算法存储替换风险混在一起。
- 先跑通模式迁移，可以尽早暴露进程管理、前端身份、路径、日志、Windows 权限问题。
- LazyLLM 依赖改动未完成前，MVP 仍可开展，但必须使用 mock retrieval/mock parsing 和稳定接口契约隔离外部依赖。

### 7.6 不建议早期合并 Go 服务为单一 binary

原始方案：可合并 core、scan-control-plane、file-watcher 为单进程。

新版方案：先保留独立 exe，由 Electron 管理；后续需要时再重构合并。

理由：

- 三个 Go 服务是独立 module，并存在 `internal` 包边界。
- 直接合并会引入模块重构，与 Desktop MVP 目标无关。
- Electron 管理多个本地进程与 Docker Compose 管理多个容器相比已经足够简化。

### 7.7 不建议只靠前端 localStorage 实现免登录

原始方案：前端预写 admin token 或 Electron 注入。

新版方案：auth-service、Electron proxy、前端 auth facade 三层共同实现。

理由：

- 后端依赖 Bearer token 和当前用户解析。
- 只改前端会在后端 API 调用时失败。
- Electron proxy 是统一注入当前助手用户和处理本地系统初始化上下文的自然位置。

### 7.8 不建议为“助手切换”新增 actor/effective 双身份

原始方案：切换用户后以该用户身份问答。

新版方案：助手切换直接复用 Cloud Mode 的切换用户，当前助手就是当前 `X-User-Id`；Electron 的本地系统上下文只用于初始化和诊断，不作为产品身份暴露。

理由：

- Desktop Mode 不需要多人审计和主从代理语义。
- 新增 actor/effective 双身份会偏离 Cloud Mode 切换用户模型。
- 复用 `X-User-Id` 可以减少后端改造面，也降低技能、会话、偏好串号风险。

### 7.9 不建议安装包阶段才发现依赖不可打包

原始方案：后端预编译成二进制后由 Electron 启动。

新版方案：MVP 和完整功能阶段都必须持续验证 Python 打包可行性，安装包阶段只做产品化安装器。

理由：

- Python 依赖、LazyLLM、向量库、OCR、Office 转换都可能有 Windows wheel 和动态库问题。
- 如果等到最后才打包，风险会集中爆发。

### 7.10 不建议只按 Windows 写死目录和进程逻辑

原始方案主要面向 Windows。

新版方案：Windows 优先交付，但目录、日志、子进程、二进制命名、签名和打包配置都通过平台适配层管理，预留 macOS 默认目录和打包验证项。

理由：

- 后期 macOS 计划已明确，当前写死 Windows 路径会导致返工。
- Electron 本身适合跨平台，平台差异应集中在 main process 和 build config。
- Windows/macOS 数据目录同构能降低迁移、备份和诊断成本。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| SQLite 迁移不兼容 | core/auth/algorithm 无法启动 | 建立双数据库迁移测试；拆分 PG/SQLite SQL |
| SQLite 多进程写锁 | 导入、任务、用户操作失败 | WAL、busy timeout、DB 拆分、写入收敛 |
| Redis 语义替换不完整 | Chat SSE、取消、状态恢复异常 | 先抽象接口，再分别实现 Redis 和 in-memory |
| LazyLLM 不支持 SQLite | parsing/doc-service 无法完整桌面化 | 向 LazyLLM 提交 SqlManager/DocServer SQLite 支持 |
| Windows 采用 Milvus Lite | 向量检索依赖官方未支持的平台，安装包不可控 | Windows 明确不采用 Milvus Lite，默认评估 LanceDB/Qdrant local |
| OpenSearch DSL 难以等价迁移 | 检索质量下降 | 抽象 SegmentStore，建立检索基准 |
| Python 打包失败 | 安装包不可用 | 从 MVP 开始做 PyInstaller/Nuitka smoke test |
| 助手身份混乱 | 数据串号或权限错误 | 复用 Cloud Mode 切换用户语义，当前 `X-User-Id` 即当前助手 |
| LazyLLM 依赖改造滞后 | 完整解析和真实检索无法接入 | MVP 用 mock backend 和稳定接口契约并行推进 |
| 日志不足 | Windows/macOS 桌面问题难以复现 | 统一日志目录、模块级日志、诊断包导出和敏感信息脱敏 |
| 平台路径写死 | macOS 后续返工 | 通过 Electron 平台适配层集中管理目录、二进制和启动参数 |
| Electron 子进程残留 | 用户关闭后后台进程占用端口 | process manager 统一进程组、健康检查、退出清理 |
| 大型 OCR/Office 依赖过重 | 安装包复杂、失败率高 | 可选组件与功能降级 |
| Desktop 改造污染 Cloud 构建 | Cloud Docker image 被迫安装 Electron、PyInstaller、本地向量库依赖 | 依赖分层、独立构建入口、CI 双矩阵 |
| 接口抽象只适配 Desktop | Cloud Milvus、OpenSearch、Redis 行为回归 | 接口双实现测试和 Cloud 回归用例 |
| 前端 mode 判断侵入过深 | Cloud 登录、RBAC、路由异常 | 集中封装 feature flag 与 auth facade，不在页面散落判断 |

## 9. 建议的近期决策点

以下决策会影响后续代码形态，应在 MVP 开始前确认：

| 决策 | 推荐 | 说明 |
| --- | --- | --- |
| MVP 检索 | MockRetrievalStore | 保证先验证 Desktop Mode |
| 完整功能向量/全文存储 | LanceDB 优先，Qdrant local 备选 | 更符合 Windows Desktop 嵌入式形态 |
| Milvus Lite | Windows 不采用 | 官方文档只列 Ubuntu/macOS 支持，未列 Windows |
| RBAC | 保留模型，隐藏复杂 UI | 降低 Cloud Mode 回归风险 |
| 用户/助手模型 | 平级用户，默认进入排序后的首个助手 | 复用 Cloud Mode 切换用户语义 |
| LazyLLM 依赖 | 不阻塞 MVP，但阻塞完整功能 | MVP 使用 mock backend 和稳定接口 |
| 日志目录 | Windows `%APPDATA%\LazyRAG\logs`，macOS `~/Library/Logs/LazyRAG` | 便于调试和诊断包导出 |
| Go 服务 | 先独立 exe | 避免过早模块重构 |
| Python 服务 | 先独立进程，后续再考虑合并 | 降低打包与调试复杂度 |
| Evo | MVP 可关闭 | 避免干扰主流程验证 |
| Office/OCR | MVP 降级 | 完整功能阶段逐项启用 |
| 共存策略 | 单仓库、双构建入口、双 CI 矩阵、默认 Cloud 不变 | 保证 Cloud artifact 与 Desktop app 可并行演进 |
| 依赖管理 | Cloud Docker 依赖与 Desktop 打包依赖分层 | 不互相提升为必需依赖 |
| 发布物 | Cloud 继续 Docker images，Desktop 独立 Electron installer | 避免两类 artifact 相互耦合 |

## 10. 参考依据

- GitHub Issue: <https://github.com/raft-mobius/LazyRAG/issues/1>
- Milvus Lite 官方文档：<https://milvus.io/docs/milvus_lite.md>。当前 prerequisites 只列 Ubuntu >= 20.04 和 macOS >= 11.0，未列 Windows；文档还说明 Milvus Lite 只适合小规模向量检索，索引只支持 FLAT。
- LanceDB 官方文档：LanceDB OSS 是进程内嵌入式库，可连接本地路径。
- Qdrant 官方文档：Python local mode 支持内存与磁盘存储。
- 本仓库代码审阅：
  - `backend/core/main.go`
  - `backend/core/chat/redis_cache.go`
  - `backend/auth-service/bootstrap.py`
  - `backend/auth-service/core/deps.py`
  - `frontend/src/components/auth.ts`
  - `backend/core/chat/conversation.go`
  - `algorithm/processor/db.py`
  - `algorithm/parsing/build_document.py`
  - `algorithm/chat/tools/kb.py`

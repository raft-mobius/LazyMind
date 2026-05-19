# LazyMind Windows Desktop HLD


## 0. 文档定位与命名约定

### 0.1 文档定位

本文描述 LazyMind Windows Desktop Mode 的高层设计，目标是在保留现有 Cloud/Server Mode 的前提下，把 LazyRAG/LazyMind 当前 Web + 后端服务形态改造成一个 Windows 优先的桌面应用。

本文覆盖：

- 原始需求与已对齐决议。
- 需求分析与需求细化。
- HLD 级总体架构与技术设计。
- MVP、完整功能、安装包三个阶段的任务拆分与依赖识别。
- 每个阶段的 HLD 方案设计。

本文不覆盖：

- 代码级 LLD。
- API 字段级定义。
- 数据库 migration 逐条改写方案。
- Electron、Go、Python、前端的具体代码 patch。
- 工作量、排期、人员分配。
- 算法与 RAG 本身的安全专题，例如 prompt injection、模型工具调用治理、RAG 数据投毒、模型输出安全等。这些问题后续单独设计；本文只关注 Cloud/Server 运行环境迁移到 Electron Desktop 运行环境时新增的安全边界。

### 0.2 命名约定

- **LazyMind**：面向用户的桌面产品名称。
- **LazyRAG**：现有代码仓库、后端服务、算法与 RAG 能力的基础工程形态。
- **Desktop Mode**：桌面运行模式。
- **Cloud/Server Mode**：现有云端/服务端部署模式。
- **AI 助手**：Desktop Mode 前台产品概念，后台本质仍复用现有用户模型。
- **当前助手**：当前前端选中的 AI 助手，也就是当前请求上下文中的用户。

命名原则：用户能在前端、安装包、窗口标题、菜单、提示文案、默认目录说明、诊断导出说明中看到的产品名称统一使用 **LazyMind**。用户看不见的内部实现部分尽量少改动；包名、环境变量前缀、内部目录、已有配置键、代码模块名在必要时可以继续沿用 **LazyRAG**，避免为了重命名引入额外迁移风险。

---

# 1. 整理原始需求

本章只整理需求，不展开方案。需求来自 Issue #1 原始描述及后续讨论对齐后的决议。

## 1.1 产品目标

新增一个 Windows Desktop Mode，使 LazyMind 能作为桌面应用运行。

桌面应用应具备以下产品特征：

- 用户安装后打开即可使用。
- 不要求用户安装 Docker、Node、Go、Python 等开发环境。
- 不暴露云端多租户部署复杂度。
- 不要求用户理解后端服务、端口、数据库、网关等基础设施概念。
- 桌面端仍保留多“用户”的底层能力，但产品上呈现为多个 AI 助手。
- Windows 是首个目标平台，也是本方案的交付重点；macOS 只做低成本预留，不进入 Windows MVP 的核心验收范围。

## 1.2 桌面运行形态需求

Desktop Mode 的桌面运行形态应满足：

- 使用 Electron 包装前端。
- 前端在 Electron Renderer 中运行。
- Go 后端和 Python 后端预编译或预打包后随桌面应用一起分发。
- Electron 在本地启动、监控、关闭 Go/Python 后端。
- 不使用 Docker Compose 作为桌面端运行依赖。
- 不要求终端启动，也不要求用户手工启动多个服务。
- 本地服务端口、日志、数据目录由桌面应用统一管理。

## 1.3 身份、用户与 AI 助手需求

Desktop Mode 仍保留后台“用户”概念，但前台产品语义改成“AI 助手”。

已对齐需求如下：

- 免登录，打开应用后直接进入主界面。
- 首次启动自动创建默认用户组、默认权限和默认 AI 助手。
- 默认首个 AI 助手名称为“天文学家”，头像使用 emoji 土星 `🪐`。
- 默认首个 AI 助手描述为：`天文学家是一位专注于太阳系、行星、卫星、小行星、彗星和基础天文知识的入门向导，擅长用清晰、耐心、富有画面感的方式解释宇宙中的常见现象，帮助用户从太阳系开始建立对天文学的整体认识。`
- 默认数据目录中内置一份约 100KB 的 Markdown 示例文档，内容为太阳系基础知识，用于首次启动后的知识库和问答演示。
- 前台不展示“管理员 / 普通用户”概念。
- 后台每个 AI 助手本质上是一个普通用户。
- 所有 AI 助手平级，不引入主用户 / 子用户层级。
- 可以新建 AI 助手。
- 新建 AI 助手所需字段与现有“新建用户”保持一致，不在 MVP 阶段新增一套独立字段模型。
- 新建 AI 助手时，后台创建一个用户。
- 新建的用户自动加入默认用户组。
- 新建的用户默认具备写权限。
- 当前选中的 AI 助手就是当前请求上下文中的用户。
- 技能页面可以切换 AI 助手，并查看该助手的技能。
- 问答页面可以切换 AI 助手，并以该助手身份问答。
- 会话、技能、记忆、偏好等数据需要按助手隔离。

## 1.4 权限与 RBAC 需求

原始需求中提到 Desktop Mode 去掉 RBAC。讨论后对齐为：

- Desktop Mode 去掉 RBAC 的产品复杂度。
- 不物理删除 RBAC 数据模型和底层权限检查链路。
- 默认角色、默认组、默认写权限由系统自动准备。
- 普通用户不需要在 Desktop UI 中理解或配置 RBAC。
- 保留底层模型以降低对 Cloud/Server Mode 的破坏风险。

## 1.5 网关需求

Desktop Mode 不使用 Kong Gateway。

需求侧表达为：

- 桌面应用内部不要求独立部署 API Gateway。
- 前端访问本地 API 时应使用桌面应用提供的统一入口。
- Cloud/Server Mode 继续保留现有 Kong 路线，不因 Desktop Mode 改造被删除。

## 1.6 本地存储与中间件需求

原始需求和后续决议对本地存储的要求如下：

- PostgreSQL 替换为 SQLite。
- OpenSearch 替换为本地轻量实现，原则上复用现有 SegmentStore 体系扩展，不重新发明新的抽象层。
- Milvus 替换为 Milvus Lite。
- Milvus Lite 在 MVP、完整功能、安装包三个阶段都暂定为默认方案。
- 暂不并行考虑 LanceDB、Qdrant 等其他方案。
- 如果 MVP 对 Milvus Lite 的验证结果不理想，再基于测试结果更新方案。
- Redis 不作为 Desktop Mode 必需中间件；但 Redis 当前承担的运行时语义不能被简单忽略。
- SQLite、Milvus Lite、本地文件、日志目录等数据都应由桌面应用统一管理。

## 1.7 文档扫描与文件权限需求

桌面应用需要支持用户把本机文件纳入知识库或扫描范围。

已对齐需求如下：

- 不采用默认全盘无脑扫描。
- 允许用户在前端界面指定要扫描的路径。
- MVP 阶段先复用现有扫盘逻辑和功能。
- 后续扫盘功能重写后再适配新的实现。
- 初始提供一个默认目录，例如用户目录下的 `LazyMind` 目录，并放入约 100KB 的太阳系知识 Markdown 示例文档。
- 用户访问额外目录时，按平台机制处理权限请求。
- Windows 上如访问系统目录或受保护目录，可能触发 UAC 或权限失败提示。
- macOS 后续需要处理更多文件访问权限弹窗和授权边界。

## 1.8 解析、OCR、Office 与在线 API 需求

Desktop Mode 不要求 MVP 阶段内置完整重型解析能力。

已对齐需求如下：

- Office 转换、OCR、MinerU、PaddleOCR 不作为 MVP 必需能力。
- Desktop Mode 可以使用线上 API 完成部分解析或模型能力。
- 使用线上 API 可以减少本地安装包体积和本地依赖复杂度。
- 缺少本地重型组件时，需要有明确降级或提示。
- MVP 阶段模型、Office/OCR 等能力默认走 mock server 或 mock 配置。
- 用户后续通过模型配置界面自行配置真实模型或线上 API key。

## 1.9 Evo 需求

已对齐需求：

- Desktop MVP 阶段可以剪掉 Evo。
- Evo 不作为桌面主链路验证的阻塞项。
- 后续如需要，可作为可选模块重新接入。

## 1.10 日志与可观测性需求

已对齐需求如下：

- 当前以现有 log 体系为主。
- OpenTelemetry 可以后续接入，不作为 Desktop MVP 的必需能力。
- Electron 需要负责日志采集、进程日志归档和诊断导出。
- 日志不能泄露 API key、token、用户文档正文等敏感信息。

## 1.11 P1 事件循环与外部渠道需求

原始需求中包含 P1 能力：

- 给每个用户 / AI 助手加一个事件循环，用于监听任务。
- 接入微信、飞书等外部渠道。

该需求属于 Desktop Mode 后续增强能力，不应阻塞 MVP 主链路，但需要在架构中避免与当前助手模型冲突。

## 1.12 Cloud/Server Mode 共存需求

Desktop Mode 不是 Cloud/Server Mode 的替代分支。

共存需求如下：

- 同一个代码仓库需要同时支持 Cloud/Server Mode 和 Desktop Mode。
- Desktop Mode 不应破坏现有 Docker、Kong、PostgreSQL、Redis、Milvus、OpenSearch 路线。
- Desktop 专属依赖不能污染 Cloud 构建链路。
- Cloud 默认行为不应因为 Desktop 代码引入而改变。
- 所有 Desktop 差异应由显式模式开关启用。

## 1.13 运行环境迁移安全需求

本次改造的安全关注点放在“云端 Web/服务端运行环境迁移到 Electron 桌面运行环境”所新增的安全边界上。

需要覆盖的安全需求包括：

- Electron Renderer 不能因为桌面化获得不必要的 Node.js、文件系统或系统命令能力。
- Renderer 与 Electron Main Process 之间的 Preload / IPC 必须是最小能力白名单。
- Local Proxy 和本地后端 API 必须被视为新的本地信任边界，不能因为监听 localhost 就默认可信。
- 本地后端服务端口默认只能绑定 localhost，不对局域网暴露。
- 当前助手身份不能由普通前端代码随意伪造。
- 本地文件扫描、目录选择、日志打开、诊断包导出等桌面能力必须限制范围并校验参数。
- 用户密钥、在线 API key、本地服务 secret、配置文件和诊断包必须避免明文泄露。
- 子进程启动、后端二进制路径、命令行参数和环境变量必须避免命令注入和路径劫持。
- 安装包、升级包、后端二进制、Python 打包产物需要考虑签名、完整性和供应链风险。
- 日志和诊断包不能包含用户文档正文、明文 token、API key 或其他敏感配置。

不在本次 HLD 中展开的安全需求包括：

- prompt injection。
- RAG 数据投毒。
- 模型输出内容安全。
- 模型工具调用策略。
- 多租户云端隔离增强。
- 企业级合规审计。

这些属于算法、RAG 或企业安全专题，后续单独设计。

---

# 2. 需求分析和细化

本章聚焦需求本身，尽量不引入具体技术方案。技术设计从第 3 章开始。

## 2.1 核心用户场景

### 2.1.1 首次安装与启动

用户安装桌面应用后，首次打开应看到可用的主界面，而不是部署说明、登录页或服务启动失败页面。

首次启动需要完成：

- 初始化本地应用数据目录。
- 准备默认配置。
- 准备默认 AI 助手。
- 准备默认权限边界。
- 准备必要的本地服务。
- 进入可操作 UI。

用户不应感知这些初始化细节。

### 2.1.2 多 AI 助手使用

用户可以创建多个 AI 助手，用于不同知识库、技能、会话、偏好或工作场景。

用户关心的是：

- 当前我正在和哪个 AI 助手交互。
- 这个助手有哪些技能和知识。
- 切换助手后，会话和技能是否会隔离。
- 新建助手是否简单直接。

用户不关心：

- 后台是否创建了一个 user row。
- user 是否属于某个 group。
- 角色权限如何表达。
- 当前请求里注入了什么 header。

### 2.1.3 本地文档纳入知识库

用户希望把本地文件加入知识库或扫描范围。

需求关键点：

- 用户应主动选择路径。
- 系统不应默认扫描整个磁盘。
- 对无权限目录要给出可理解提示。
- 对已选择路径要能持续扫描或重新扫描。
- 对扫描、解析、索引状态要有可见反馈。

### 2.1.4 问答与技能使用

用户希望在桌面应用里完成：

- 选择 AI 助手。
- 选择或使用该助手的知识库、技能、词汇、偏好。
- 发起问答。
- 看到与当前助手关联的会话。
- 切换助手后看到另一个助手自己的上下文。

### 2.1.5 本地故障诊断

桌面应用运行在用户本机，故障类型会比云端更多。

用户或开发者需要能够定位：

- 哪个本地服务没有启动。
- 哪个端口或进程异常。
- 哪个数据目录不可写。
- 哪个文件解析失败。
- 哪个模型或在线 API 配置不可用。
- 哪些日志可用于反馈问题。

## 2.2 功能需求细化

### 2.2.1 桌面壳能力

桌面壳需要提供：

- 主窗口。
- 前端资源通过 Electron 自定义协议加载。
- 本地后端进程启动。
- 本地后端进程停止。
- 本地 API 统一入口。
- 本地配置读写。
- 本地日志归档。
- 本地诊断导出。
- 文件夹选择等桌面能力。

### 2.2.2 AI 助手管理

AI 助手管理需要提供：

- 默认助手初始化。
- 默认首个助手为“天文学家 🪐”。
- 助手列表展示。
- 新建助手。
- 新建助手字段与现有新建用户字段保持一致。
- 切换当前助手。
- Assistant Switcher 作为全局顶部组件出现，而不是只在 Chat、技能、知识库页面局部出现。
- 助手名称、头像、描述等基础信息维护。
- 与技能、问答、知识库等页面联动。

### 2.2.3 身份上下文传播

Desktop Mode 必须有稳定机制表达“当前助手是谁”。

需求上需要保证：

- 前端看到的当前助手与后端收到的当前用户一致。
- 技能、问答、记忆、会话、知识库访问不会串助手。
- 首次启动、重启应用、切换助手后，当前助手状态可预测。
- 新建助手后能立即作为当前助手使用或被选择。

### 2.2.4 本地数据管理

本地数据管理需要覆盖：

- 关系数据。
- 向量数据。
- 全文/片段索引数据。
- 上传文件。
- 扫描文件元数据。
- 缓存。
- 日志。
- 诊断包。
- 备份与恢复所需的基本边界。

### 2.2.5 文档扫描与索引

文档扫描与索引需求包括：

- 用户选择扫描路径。
- 记录扫描路径。
- 扫描文件变化。
- 提交解析任务。
- 构建或更新索引。
- 展示扫描、解析、索引状态。
- 支持后续重扫、重建或清理。

MVP 阶段允许复用现有扫盘逻辑，不要求一次性重写。

### 2.2.6 在线 API 与本地能力边界

Desktop Mode 可以使用线上 API。

需求上需要明确：

- 哪些能力必须本地可运行。
- 哪些能力允许走线上 API。
- 哪些能力缺失时允许降级。
- 用户如何配置在线 API key 或模型服务。
- 离线场景下哪些功能不可用。
- MVP 默认使用 mock server / mock 配置，Chat 时需要明确提示用户当前模型配置处于 mock 状态，并引导用户到模型配置界面配置真实模型。

### 2.2.7 事件循环与外部渠道

每个 AI 助手未来需要独立事件循环，以支持：

- 周期性任务。
- 外部消息监听。
- 微信、飞书等渠道接入。
- 以某个助手身份处理任务。

该需求依赖当前助手 / 用户模型稳定，因此不应在 MVP 之前改变身份模型。

## 2.3 非功能需求细化

### 2.3.1 易安装

用户不应安装开发环境，也不应理解 Docker 或后端服务拓扑。

### 2.3.2 易启动

打开桌面应用后，本地服务应自动启动。启动失败时，用户应看到明确提示，而不是空白页或浏览器级错误。

### 2.3.3 易诊断

桌面端必须从早期就具备日志和诊断能力，否则 Windows 用户环境差异会导致问题难以复现。

### 2.3.4 数据隔离

不同 AI 助手之间需要数据隔离。至少会话、技能、记忆、偏好、知识库访问上下文不能混淆。

### 2.3.5 Cloud 共存

Desktop Mode 的新增代码不能破坏现有云端部署。任何模式差异都必须有明确边界。

### 2.3.6 本地安全

本阶段的本地安全重点是运行环境迁移安全，即从云端 Web/服务端形态变成 Electron 桌面形态后新增的攻击面。算法和 RAG 本身的安全问题不在本次计划中展开。

桌面应用至少需要满足：

- Renderer 不直接获得 Node.js、文件系统、shell、任意 IPC 等高权限能力。
- Preload 只暴露白名单 API，不把 `ipcRenderer`、Electron 原生 API 或通用 command executor 暴露给前端。
- IPC handler 必须校验调用来源、参数 schema、路径范围和操作权限。
- Local Proxy 与本地后端之间需要有本地信任边界，不能只依赖“请求来自 localhost”。
- 本地服务端口默认只监听 `127.0.0.1`，不监听 `0.0.0.0`。
- 不把密钥写入普通日志。
- 不把用户文档正文写入诊断包。
- 不默认扫描全盘。
- 对受保护目录访问失败给出提示。
- 对本地端口暴露范围做控制。
- 子进程启动不得拼接 shell 命令，不得让用户输入直接变成命令行。
- 安装包、升级包和本地后端二进制需要考虑签名、完整性和依赖供应链风险。

### 2.3.7 跨平台预留

Windows 是首个交付平台，也是本方案重点。macOS 不进入 Windows MVP 的核心验收范围。路径、日志、子进程、资源定位、签名、权限请求等仍应避免散落写死在业务代码中，但 macOS 只做低成本架构预留，不要求在本方案中完成 macOS 级别的详细设计或验证。

## 2.4 需求优先级理解

### 2.4.1 MVP 必须满足

MVP 必须验证：

- Electron 桌面壳可运行。
- 本地后端可由 Electron 启动和关闭。
- 免登录进入主界面。
- 默认 AI 助手初始化。
- 新建 AI 助手。
- 切换 AI 助手。
- 当前助手身份能传到后端。
- 技能和问答主入口能围绕当前助手工作。
- SQLite、Milvus Lite、本地进程、日志等桌面核心依赖方向可验证。
- 扫盘先复用现有逻辑。

### 2.4.2 MVP 可以降级

MVP 可以降级或后置：

- 完整 RAG 效果。
- 完整 Office 转换。
- 本地 OCR。
- MinerU。
- PaddleOCR。
- Evo。
- 微信 / 飞书接入。
- OpenTelemetry。
- 产品化安装包。

### 2.4.3 完整功能阶段必须满足

完整功能阶段应满足：

- 真实关系数据落 SQLite。
- 真实向量能力使用 Milvus Lite。
- OpenSearch 替代能力通过现有 SegmentStore 体系接入本地实现。
- Chat、知识库、解析、索引、问答形成完整闭环。
- 文件扫描与知识库构建形成真实流程。
- 线上 API 与本地能力边界清晰。
- 关键功能、性能、稳定性验证通过。

### 2.4.4 安装包阶段必须满足

安装包阶段应满足：

- 无开发环境运行。
- 无 Docker 运行。
- 后端二进制或可执行目录随包分发。
- 干净 Windows 环境可安装、启动、升级、卸载。
- 用户数据目录与应用安装目录分离。
- 诊断包可导出。

## 2.5 关键依赖识别

### 2.5.1 身份模型依赖

AI 助手切换依赖后台用户模型、前端 auth facade、本地代理、后端请求上下文一致。如果这一层不稳定，技能、问答、知识库、事件循环都会受影响。

### 2.5.2 SQLite 迁移依赖

PostgreSQL 到 SQLite 不只是连接串变化，还依赖 migration、seed SQL、ORM、SQL 方言和多进程写入策略。

### 2.5.3 Milvus Lite 验证依赖

Milvus Lite 是三个阶段暂定默认方案，因此 MVP 必须尽早验证：

- Windows 环境能安装。
- 能随 Python 打包或桌面应用分发。
- 能在用户数据目录下创建、读写、重建数据。
- 与现有向量检索调用链能接上。
- 性能、稳定性、数据损坏恢复没有明显阻塞问题。

如果 MVP 验证不理想，才进入方案更新，不在本文预设其他并行主线。

### 2.5.4 SegmentStore 依赖

OpenSearch 替换应复用现有 SegmentStore 体系。需要识别现有代码中绕过 SegmentStore、直接调用 OpenSearch API 的位置，并在后续阶段收敛。

### 2.5.5 Python 打包依赖

Python 算法模块、LazyLLM、Milvus Lite、解析工具、在线 API SDK 等需要从 MVP 起持续验证打包可行性，不能等到安装包阶段才发现依赖无法分发。

### 2.5.6 扫盘逻辑依赖

MVP 复用现有扫盘逻辑，因此 Desktop 主链路不能依赖未来扫盘重写。后续扫盘重写完成后，再做适配。

### 2.5.7 外部渠道依赖

微信、飞书等外部渠道依赖事件循环、身份上下文、凭据管理和后台任务机制，应在主链路稳定后接入。

---

# 3. 总体架构和技术设计

本章是 HLD 级技术方案，不展开到函数、表结构、接口字段级别。

## 3.1 总体架构目标

Desktop Mode 的总体架构目标是：

- 用 Electron 承担桌面壳、本地进程管理、本地代理、本地配置、本地日志和诊断能力。
- 复用现有前端源码，使用 Desktop Mode 构建或运行开关隐藏登录和高级权限 UI。
- 复用现有 Go/Python 后端业务能力，新增 Desktop Mode 配置和适配层。
- 用 SQLite、Milvus Lite、本地文件系统替代桌面端不适合直接部署的云端中间件。
- Cloud/Server Mode 与 Desktop Mode 在同一仓库中共存，通过显式模式开关隔离。

## 3.2 HLD 架构图

```text
┌─────────────────────────────────────────────────────────────────────┐
│ LazyMind Desktop App                                                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Electron Main Process                                          │  │
│  │                                                               │  │
│  │  ├─ Window Manager                                             │  │
│  │  ├─ Local Proxy                                                │  │
│  │  ├─ Process Manager                                            │  │
│  │  ├─ Desktop Config Manager                                     │  │
│  │  ├─ Data Directory Manager                                     │  │
│  │  ├─ Log Collector / Diagnostics Exporter                       │  │
│  │  └─ Native Capability Adapter                                  │  │
│  │       ├─ choose folder                                         │  │
│  │       ├─ open log folder                                       │  │
│  │       └─ platform permission handling                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Electron Renderer                                              │  │
│  │                                                               │  │
│  │  ├─ Existing Frontend App                                      │  │
│  │  ├─ Desktop Auth Facade                                        │  │
│  │  ├─ Assistant Switcher                                         │  │
│  │  ├─ AI Assistant Management                                    │  │
│  │  ├─ Chat / Q&A                                                 │  │
│  │  ├─ Skills                                                     │  │
│  │  ├─ Knowledge Base / Document Scan UI                          │  │
│  │  └─ Diagnostics UI                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Local Proxy                                                        │
│    ├─ /api/auth/*  ───────────────> auth-service                    │
│    ├─ /api/core/*  ───────────────> core                            │
│    ├─ /api/chat/*  ───────────────> algorithm/chat                  │
│    ├─ /api/parse/* ───────────────> algorithm/parsing               │
│    ├─ /api/scan/*  ───────────────> scan-control-plane              │
│    └─ /api/file/*  ───────────────> file-watcher / file service     │
│                                                                     │
│  Local Processes                                                    │
│    ├─ Go core                                                       │
│    ├─ Go scan-control-plane                                        │
│    ├─ Go file-watcher                                               │
│    ├─ Python auth-service                                           │
│    ├─ Python algorithm/chat                                         │
│    ├─ Python algorithm/parsing / processor / doc-service            │
│    └─ Optional later modules                                        │
│                                                                     │
│  Local Data Directory                                               │
│    ├─ SQLite DB files                                               │
│    ├─ Milvus Lite data                                              │
│    ├─ SegmentStore local index                                      │
│    ├─ uploads / scanned file metadata                               │
│    ├─ cache                                                         │
│    ├─ logs                                                          │
│    └─ diagnostics / backups                                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 3.3 模式边界设计

新增或复用统一模式开关。用户可见文案统一使用 LazyMind；用户不可见的内部环境变量和配置键尽量少改动，必要时可以沿用既有 LazyRAG 前缀，例如：

```text
APP_MODE=desktop
LAZYRAG_MODE=desktop
VITE_LAZYRAG_MODE=desktop
```

具体命名可在 LLD 中确定，但 HLD 原则如下：

- 未显式启用 Desktop Mode 时，默认仍为 Cloud/Server Mode。
- Desktop Mode 差异必须集中在适配层、配置层、构建入口、feature flag、auth facade 和 store implementation 中。
- 不允许用大面积 fork 方式复制前端或后端代码。
- 不允许把 Desktop 依赖变成 Cloud Docker 镜像必需依赖。
- CI 需要分别验证 Cloud artifact 和 Desktop app。

## 3.4 Electron 职责边界

Electron Main Process 负责桌面应用层能力：

- 窗口生命周期。
- 本地数据目录初始化。
- 本地端口分配。
- 子进程启动、健康检查、停止和异常处理。
- 本地 API 代理。
- 当前助手身份 header 注入。
- stdout/stderr 日志采集。
- 诊断包导出。
- 文件夹选择等 native 能力。
- 安装包生命周期相关行为。

Electron 不负责：

- 业务数据权限判断。
- 具体 RAG 算法逻辑。
- 具体文档解析逻辑。
- 替代后端服务的业务实现。

## 3.5 前端职责边界

前端保持同一套源码，按模式显示不同产品体验。

Desktop Mode 前端负责：

- 隐藏登录、注册、复杂 RBAC 页面。
- 展示 AI 助手管理，而不是传统用户管理。
- 提供全局顶部 Assistant Switcher。
- 在技能、问答、知识库等页面使用当前助手上下文。
- 显示本地服务状态、索引状态、扫描状态、模型配置状态。
- 当 MVP 默认 mock 模型配置生效时，在 Chat 中明确提示用户当前处于 mock 状态，并引导到模型配置界面配置真实模型。
- 调用 Electron 暴露的选择目录、打开日志、导出诊断等能力。

前端不应负责：

- 伪造后端权限模型。
- 只靠 localStorage 绕过认证。
- 自己维护一套与后端不一致的助手身份。

## 3.6 Local Proxy 设计

Local Proxy 是 Desktop Mode 中替代 Kong 的本地代理层。

职责：

- 接收 Renderer 的相对路径 API 请求。
- 转发到本机对应后端服务端口。
- 注入当前助手对应的用户上下文。
- 处理 CORS、SSE、上传、下载。
- 对本地服务不可用、启动中、异常退出提供统一错误表达。
- 可选地对本地端口访问范围做限制。

HLD 路由示例：

```text
/api/auth/*       -> auth-service
/api/core/*       -> core
/api/chat/*       -> algorithm chat service
/api/parse/*      -> parsing service
/api/processor/*  -> processor service
/api/doc/*        -> doc-service
/api/scan/*       -> scan-control-plane
/api/file/*       -> file-watcher / file service
```

具体路径兼容现有前端和后端，不在 HLD 中强制重命名。

## 3.7 AI 助手与身份设计

### 3.7.1 产品模型

Desktop Mode 前台只有“AI 助手”概念。

- 默认创建一个 AI 助手。
- 默认首个 AI 助手名称为“天文学家”。
- 默认首个 AI 助手头像为 `🪐`。
- 默认首个 AI 助手描述为：`天文学家是一位专注于太阳系、行星、卫星、小行星、彗星和基础天文知识的入门向导，擅长用清晰、耐心、富有画面感的方式解释宇宙中的常见现象，帮助用户从太阳系开始建立对天文学的整体认识。`
- 默认数据目录内置约 100KB 的太阳系知识 Markdown 示例文档，作为首次启动演示内容。
- 用户可以创建多个 AI 助手。
- 新建 AI 助手字段与现有新建用户字段保持一致。
- 用户可以通过全局顶部 Assistant Switcher 切换当前 AI 助手。
- 每个助手有自己的技能、知识、会话、偏好。

### 3.7.2 后台模型

后台复用现有用户模型。

- 每个 AI 助手对应一个后台用户。
- 所有助手用户平级。
- 新建助手就是创建用户。
- 默认组和默认写权限自动绑定。
- 不引入主用户 / 子用户。
- 不引入 actor / effective user 双身份模型。

### 3.7.3 请求上下文

当前助手就是当前请求用户。

- 前端当前助手 ID 与后端 `X-User-Id` 对齐。
- 技能、问答、会话、记忆、偏好使用同一当前用户上下文。
- Electron 的系统上下文仅用于本地初始化、健康检查、诊断等内部动作，不作为产品身份暴露。

## 3.8 RBAC 设计

Desktop Mode 不删除 RBAC。

HLD 决策：

- 保留角色、权限、用户组、用户表结构。
- 保留后端权限检查链路。
- 首次启动创建默认角色、默认组、默认写权限。
- 新建 AI 助手自动加入默认组。
- 前端隐藏复杂 RBAC 配置入口。
- Desktop Mode 不提供开发者模式入口查看隐藏 RBAC 或服务状态；服务状态和诊断能力通过面向普通用户的状态提示、日志入口和诊断包导出能力提供。

这样可以：

- 降低 Cloud/Server Mode 回归风险。
- 避免大面积删除权限逻辑。
- 保证多个助手之间仍有一致的访问边界。

## 3.9 本地数据目录设计

Windows 默认用户数据目录建议：

```text
%APPDATA%\LazyMind\
  config.yaml
  data\
    main.db
    algo.db
  vector\
    milvus-lite\
  segment\
  uploads\
  scanned\
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
    crash\
    diagnostics\
  backups\
```

macOS 后续低成本预留，不作为 Windows MVP 验收重点：

```text
~/Library/Application Support/LazyMind/
  config.yaml
  data/
    main.db
    algo.db
  vector/
    milvus-lite/
  segment/
  uploads/
  scanned/
  cache/
  backups/

~/Library/Logs/LazyMind/
  electron-main.log
  proxy.log
  core.log
  auth-service.log
  algorithm-chat.log
  algorithm-parsing.log
  algorithm-processor.log
  scan-control-plane.log
  file-watcher.log
  crash/
  diagnostics/
```

用户可见的数据目录、安装包、菜单和界面文案使用 LazyMind。用户不可见的内部配置键、环境变量前缀或已有代码路径可以尽量沿用 LazyRAG，避免为了重命名引入额外风险。HLD 原则是：应用安装目录与用户数据目录分离。

## 3.10 本地存储设计

### 3.10.1 关系数据

Desktop Mode 使用 SQLite 承载关系数据。

范围包括：

- 用户 / AI 助手。
- 默认组和权限数据。
- 会话与业务数据。
- 扫描控制相关数据。
- 算法管理表或文档任务表。

关键设计要求：

- 不能只改连接串。
- migration / seed SQL 要兼容 SQLite。
- 需要治理 PostgreSQL 特有语法。
- 需要考虑多进程写锁。
- 必要时拆分 DB 文件或收敛写入服务。

### 3.10.2 向量数据

三个阶段都暂定使用 Milvus Lite。

HLD 原则：

- MVP 阶段即验证 Milvus Lite 在 Windows Desktop 下的可行性。
- 完整功能阶段继续以 Milvus Lite 作为默认向量存储。
- 安装包阶段继续以 Milvus Lite 作为默认打包目标。
- 暂不把 LanceDB、Qdrant 等作为并行方案纳入主线设计。
- 如果 MVP 验证发现 Milvus Lite 在 Windows 安装、打包、稳定性、性能、数据目录、依赖冲突等方面不理想，再根据测试结果更新方案。

### 3.10.3 片段 / 全文检索数据

OpenSearch 不进入 Desktop Mode。

HLD 原则：

- 复用现有 SegmentStore 体系。
- 不重新设计一层新的 SegmentStore 抽象。
- 新增 Desktop 本地 SegmentStore 实现。
- 本地实现可基于 SQLite/FTS 或其他轻量方式，但具体实现细节放入 LLD。
- 现有绕过 SegmentStore 直接访问 OpenSearch 的代码需要逐步收敛。

### 3.10.4 Runtime Store

Redis 不进入 Desktop Mode 的必需中间件。

HLD 原则：

- Redis 当前承担的状态、队列、TTL、阻塞等待等语义需要被识别。
- 不应简单用 `sync.Map` 替换。
- 应通过运行时存储接口隔离 Cloud Redis 与 Desktop 本地实现。
- Desktop MVP 可用内存实现，完整功能阶段根据持久化需求再落 SQLite 或文件。

## 3.11 算法与解析设计

Desktop Mode 算法设计分层：

- MVP：内置一套 mock server / mock backend，并作为默认配置；验证 Python 算法模块能启动、被调用、返回可控结果；不追求完整算法效果。
- MVP Chat：当 mock 配置生效时，回答中或 Chat UI 中需要提示用户“当前模型配置处于 mock 状态，请到模型配置界面配置真实模型”。
- 完整功能：接入真实解析、索引、检索和问答闭环。
- 安装包：验证 Python 依赖、Milvus Lite、解析依赖可随应用分发。

解析能力分级：

- 基础文本 / Markdown / 可轻量处理文档：优先支持。
- Office 转换：MVP 默认走 mock server；后续用户可在模型配置界面配置线上 API 或本地组件。
- OCR / MinerU / PaddleOCR：MVP 默认走 mock server 或降级提示；后续按依赖可打包性逐项接入，并沿用模型配置界面让用户配置真实能力。

Evo：

- MVP 剪掉。
- 完整功能阶段可继续不作为主链路阻塞。
- 后续如要接入，作为可选模块，由 Electron 管理进程和日志。

## 3.12 扫盘与文件权限设计

HLD 设计原则：

- 用户通过前端显式添加扫描路径。
- 默认不全盘扫描。
- MVP 复用现有扫盘逻辑。
- 后续扫盘功能重写后，再对 Desktop 适配。
- Electron 提供选择目录能力。
- Windows 上按需处理访问失败、UAC 或权限提示。
- macOS 后续集中处理文件访问授权。

## 3.13 日志与诊断设计

MVP 起必须有日志。

HLD 要求：

- Electron 采集每个子进程 stdout/stderr。
- 每个模块单独日志文件。
- 支持日志滚动和大小上限。
- 支持一键导出诊断包。
- 诊断包包含配置摘要、服务状态、最近日志、崩溃信息。
- 日志脱敏，不记录明文密钥、模型 key、token、用户文档正文。
- OpenTelemetry 后续再接入，不阻塞 MVP。

## 3.14 构建与发布边界

Cloud/Server Mode 与 Desktop Mode 构建边界分离。

HLD 原则：

- Cloud 继续产出 Docker image 或现有 artifact。
- Desktop 产出 Electron 安装包。
- Desktop 构建入口独立。
- Desktop 引入的 Electron、electron-builder、Python 打包工具、Milvus Lite 打包逻辑不能成为 Cloud 构建必需依赖。
- CI 形成双模式矩阵。

## 3.15 运行环境迁移安全设计

本节只覆盖 Cloud/Server 运行环境迁移到 Electron Desktop 运行环境后的安全设计。算法和 RAG 安全专题不在本节展开。

### 3.15.1 信任边界变化

Cloud/Server Mode 的主要信任边界通常在浏览器、网关、服务端 API、云端网络和云端中间件之间。Desktop Mode 引入新的本地信任边界：

```text
Electron Renderer
  -> Preload / IPC
  -> Electron Main Process
  -> Local Proxy
  -> Local Backend Processes
  -> Local Data Directory / User File System
```

因此，Desktop Mode 的安全目标不是简单复用云端 Web 安全策略，而是确保前端页面、IPC、本地代理、本地后端、本地文件系统、子进程和安装包之间的权限边界清晰。

### 3.15.2 Electron Renderer 安全基线

Desktop Renderer 应遵循最小权限原则：

- 默认关闭 `nodeIntegration`。
- 启用 `contextIsolation`。
- 优先启用 renderer sandbox。
- 不关闭 `webSecurity`。
- 不允许加载不可信远程页面作为主应用 UI。
- 不使用远程脚本作为主 UI 运行依赖。
- 配置严格 CSP，默认只允许加载应用自身资源和明确允许的线上 API 域名。
- 限制页面跳转、新窗口、`webview` 和外部链接打开。
- 不使用 `file://` 直接承载主 UI。
- Desktop Renderer 主 UI 确定使用 Electron 自定义协议方案加载，不考虑受控本地服务方案。

#### Desktop Renderer 主 UI 加载方式决议

Desktop Renderer 主 UI 使用 **自定义协议方案**：Electron 注册类似 `lazymind://` 或 `app://` 的自定义协议，由 Main Process 从安装包资源目录中读取并返回前端静态资源。

采用该方案的理由：

- 不占用本地 HTTP 端口，减少端口冲突和 localhost 暴露面。
- 比 `file://` 更容易控制可访问资源范围。
- 更贴近桌面应用分发模型。
- 避免把主 UI 暴露成一个 localhost 网站。
- 能把“主 UI 资源加载”和“本地 API 代理”分成两个边界：Renderer 静态资源由自定义协议加载，API 请求仍通过 Local Proxy 转发到本地后端。

该方案需要在 LLD 中处理：

- 自定义协议名称，例如 `lazymind://` 或 `app://`。
- 静态资源路径解析。
- 前端 history fallback。
- CSP header 或等价策略。
- 静态资源 MIME type。
- 开发环境和生产环境差异。
- 自定义协议下的 API base URL 策略。
- 自定义协议 origin 与 Local Proxy CORS / 请求认证的关系。

### 3.15.3 Preload / IPC 安全基线

Preload 只作为安全网关暴露最小桌面能力。

原则：

- 不向 Renderer 暴露原始 `ipcRenderer`。
- 不向 Renderer 暴露 Electron 原生 API。
- 不提供通用 `executeCommand`、`readFile`、`writeFile`、`openPath` 等高风险泛化接口。
- 每个 IPC API 只对应一个明确业务动作，例如选择目录、导出诊断包、打开日志目录。
- Main Process 的 IPC handler 必须校验 sender 来源、参数类型、路径范围和操作权限。
- 所有文件路径必须 canonicalize 后再校验，防止路径穿越、符号链接或 junction 绕过。

### 3.15.4 Local Proxy 与本地 API 安全基线

Local Proxy 是 Desktop Mode 的本地信任边界，不只是路由层。

原则：

- 本地服务默认只监听 `127.0.0.1`。
- 禁止默认监听 `0.0.0.0` 或局域网地址。
- Local Proxy 与后端服务之间使用启动时生成的本地 secret / 随机 token，避免任意本机进程直接伪造受信请求。
- 后端不应无条件信任前端传入的 `X-User-Id`。
- 当前助手身份应由受控层注入，普通 Renderer 代码不能随意伪造身份上下文。
- CORS 只允许 Desktop Renderer 自定义协议 origin。
- 上传、下载、扫描、删除、重建索引、导出诊断等接口需要保留权限与参数校验。
- 本地 API 错误信息应能帮助诊断，但不泄露本地敏感路径、密钥或用户文档内容。

### 3.15.5 文件系统与扫描安全基线

桌面端新增访问用户文件系统的能力，需要最小化文件访问范围。

原则：

- 不默认全盘扫描。
- 用户显式选择扫描路径。
- 对用户选择路径进行 canonicalize 和权限检查。
- 处理 Windows shortcut、symlink、junction、hardlink 等路径绕过风险。
- 限制单文件大小、目录深度、扫描文件数量和临时文件空间。
- 对无权限目录、系统目录、隐藏目录、网络盘等情况给出明确提示。
- 文档解析失败不能导致主应用崩溃。
- 诊断包不包含用户文档正文；如需包含文件名或路径，应考虑脱敏或最小化。

### 3.15.6 密钥、配置与诊断包安全基线

Desktop Mode 可能保存模型 API key、线上解析 API key、外部渠道 token、本地服务 secret 等。

原则：

- 密钥不写入普通日志。
- 密钥不进入诊断包。
- 密钥不硬编码在前端 bundle 或安装包模板中。
- 本地配置文件如需保存 secret，应优先使用 OS 级安全存储，例如 Windows Credential Manager / DPAPI；macOS 后续使用 Keychain。
- 诊断包默认只包含配置摘要、服务状态、版本号、最近日志和崩溃信息。
- 诊断包导出前需要统一脱敏规则。
- 诊断包必须对模型 key 脱敏。
- MVP 阶段允许密钥明文写在配置文件中，但不得进入日志和诊断包。
- Windows Credential Manager / DPAPI 不作为 MVP 必需项，放到第二阶段完整功能设计中处理。

### 3.15.7 子进程与本地二进制安全基线

Electron 负责启动本地 Go/Python 后端，必须避免命令注入和路径劫持。

原则：

- 启动子进程时不使用 `shell: true`。
- 可执行文件路径从安装包资源目录或受控开发目录解析。
- 命令行参数使用数组传递，不拼接 shell 字符串。
- 用户输入不得直接进入命令行参数、环境变量或可执行路径。
- 环境变量采用白名单方式传递。
- 后端进程默认不以管理员权限运行。
- 安装目录和后端二进制需要防止被普通低权限进程替换。
- 子进程异常退出、残留、重复启动和端口占用要有明确处理策略。

### 3.15.8 安装包、升级与供应链安全基线

Desktop 安装包把可执行代码交付到用户机器，发布链路需要单独治理。

原则：

- MVP 阶段不要求安装包签名。
- Windows installer 签名放到第三阶段安装包阶段考虑。
- 后端 exe、Python 打包产物和更新包需要在第三阶段考虑完整性校验。
- 自动更新必须使用 HTTPS 和签名校验。
- 防止降级安装到已知不安全版本。
- Electron、Chromium、Node、npm、Python、Go、Milvus Lite 等依赖需要版本锁定和漏洞扫描。
- CI/CD 中的签名证书、发布 token 和更新密钥必须独立保护。
- Cloud artifact 与 Desktop installer 的供应链扫描分开执行，互不污染依赖集合。

### 3.15.9 本次不纳入的安全专题

以下内容不进入本次 HLD 的实施计划，只作为后续专题：

- prompt injection。
- RAG 数据投毒。
- 模型输出安全。
- 模型工具调用权限治理。
- 外部渠道消息安全策略。
- 企业合规、审计、远程擦除。

本次 MVP 优先确保桌面运行环境迁移不会把 Web 前端问题、本地 API 问题、IPC 问题或打包发布问题放大成本机权限问题。

---

# 4. 分三个阶段的落地计划

本章只做任务拆分和依赖识别，不做工作量预估。

## 4.1 阶段一：MVP

### 4.1.1 阶段目标

MVP 目标是验证 Desktop Mode 主链路可行性。

MVP 重点验证：

- Electron 桌面壳。
- 前端资源加载。
- 本地 Go/Python 后端启动。
- 本地 API 代理。
- 免登录。
- 默认 AI 助手初始化。
- 新建和切换 AI 助手。
- 当前助手身份传递。
- SQLite 基础可用性。
- Milvus Lite 在 Windows Desktop 下的初步可行性。
- 扫盘逻辑复用路径。
- 日志与诊断基础能力。

MVP 不以完整算法效果为目标。

### 4.1.2 MVP 任务拆分

#### A. Desktop 工程骨架

- 新增 Desktop 工程入口。
- 注册 Desktop Renderer 自定义协议。
- 通过自定义协议加载前端构建产物。
- 初始化本地数据目录。
- 管理本地配置。
- 建立本地日志目录。

依赖：

- 前端可构建为静态资源。
- Electron 自定义协议能正确加载静态资源、处理前端路由 fallback 和 MIME type。
- Electron 工程与现有 monorepo 构建不冲突。

#### B. 本地进程管理

- Electron 启动 Go core。
- Electron 启动 auth-service。
- Electron 启动必要 Python 算法服务或 mock 服务。
- Electron 可选启动 scan-control-plane、file-watcher。
- 统一健康检查。
- 关闭应用时清理子进程。

依赖：

- 各服务具备 Desktop Mode 启动参数。
- 各服务能输出健康状态。
- 各服务日志可重定向。

#### C. Local Proxy

- 建立本地 API 统一入口。
- 转发现有 API。
- 支持 REST、SSE、上传、下载中的 MVP 必需子集。
- 注入当前助手身份。
- 对后端未启动或异常退出返回可理解错误。

依赖：

- 后端服务端口可配置。
- 前端请求可切到相对路径或本地代理路径。

#### D. 免登录与默认助手

- 首次启动创建默认组、默认权限、默认 AI 助手。
- Desktop Mode 前端跳过登录页。
- 当前助手状态可读取、可切换。
- 新建 AI 助手时后台创建用户并绑定默认组和写权限。

依赖：

- auth-service 能提供 Desktop 初始化能力。
- 前端 auth facade 支持 Desktop Mode。
- core 接受当前用户上下文。

#### E. SQLite 最小链路

- core 最小表集合在 SQLite 下可启动。
- auth-service 最小用户/组/权限数据可落 SQLite。
- 必要 migration 或 seed SQL 修复到 MVP 可用范围。

依赖：

- 识别 PostgreSQL 专属 SQL。
- 确认哪些表是 MVP 必需。

#### F. Milvus Lite MVP 验证

- 验证 Windows 环境安装 Milvus Lite。
- 验证 Milvus Lite 数据目录可放在用户数据目录。
- 验证创建 collection、写入、查询、删除、重建的最小链路。
- 验证与 Python 服务同进程或本地调用的启动方式。
- 记录打包、依赖、性能、稳定性问题。

依赖：

- Python 环境和依赖管理可控。
- 算法模块能以最小方式调用向量存储。

#### G. SegmentStore MVP 边界

- 识别当前 OpenSearch 直接调用点。
- MVP 可使用 mock 或最小本地实现，不追求完整全文检索效果。
- 保证后续能接入现有 SegmentStore 体系，而不是在 MVP 写死临时路径。

依赖：

- 梳理现有 SegmentStore 接口和实现位置。
- 明确 MVP 哪些接口必须返回真实数据，哪些可以降级。

#### H. 扫盘复用

- 前端提供添加扫描路径入口或复用现有入口。
- Electron 提供选择目录能力。
- 后端复用现有扫盘逻辑。
- 扫描状态能在 UI 中展示基本反馈。

依赖：

- 现有扫盘逻辑可在本地路径下运行。
- 文件权限失败有基本错误处理。

#### I. 日志与诊断

- Electron 采集子进程日志。
- 按模块写日志文件。
- 前端提供打开日志目录或导出诊断包入口。
- 诊断包包含服务状态和最近日志。

依赖：

- 各服务 stdout/stderr 或 log 文件路径可控。
- 敏感信息脱敏规则明确。

#### J. 运行环境迁移安全基线

- 建立 Electron BrowserWindow 安全默认配置。
- 建立 Preload / IPC 白名单。
- Local Proxy 和本地后端只监听 localhost。
- Local Proxy 与本地后端之间建立本地请求认证机制或等价防伪造机制。
- 当前助手身份由受控层注入，避免普通前端代码随意伪造。
- 选择目录、打开日志、导出诊断包等 native 能力需要参数校验和范围限制。
- 子进程启动不使用 shell 拼接命令。
- 日志和诊断包脱敏。
- MVP 安装或开发包阶段即验证基本安全基线，不等到安装包阶段再补。

依赖：

- Electron 工程骨架已建立。
- Local Proxy 和 Process Manager 的职责边界已确定。
- 日志目录、数据目录和诊断包范围已确定。

### 4.1.3 MVP 阶段依赖顺序

建议依赖顺序：

1. Desktop 工程骨架。
2. 本地数据目录与日志目录。
3. 本地进程管理。
4. Local Proxy。
5. 运行环境迁移安全基线。
6. 免登录与默认助手初始化。
7. 前端 Desktop Mode 与 Assistant Switcher。
8. SQLite 最小链路。
9. Chat / 技能主入口最小闭环。
10. Milvus Lite MVP 验证。
11. 扫盘复用验证。
12. 诊断包与稳定性修正。

## 4.2 阶段二：完整功能

### 4.2.1 阶段目标

完整功能阶段目标是在开发机上跑通真实 Desktop 功能闭环。

重点包括：

- SQLite 关系库完整可用。
- Milvus Lite 作为默认向量存储完整接入。
- SegmentStore 本地实现完整接入。
- 文档扫描、解析、索引、问答形成真实流程。
- AI 助手的数据隔离完整验证。
- 线上 API 与本地能力降级策略清晰。
- 功能、性能、稳定性初步验证。

### 4.2.2 完整功能任务拆分

#### A. SQLite 完整改造

- 完成 core migration SQLite 兼容。
- 完成 auth-service SQLite 兼容。
- 完成 scan-control-plane SQLite 兼容。
- 完成算法管理表或文档任务表 SQLite 兼容。
- 处理 PostgreSQL 专属语法。
- 处理 SQLite WAL、busy timeout、foreign key。
- 处理多进程写入边界。

依赖：

- MVP 已识别最小 SQL 差异。
- 已确定 ORM 化或 migration 分支策略。

#### B. Milvus Lite 完整接入

- 将 MVP 验证通过的 Milvus Lite 路线接入真实向量检索链路。
- 支持 collection 生命周期。
- 支持向量写入、删除、更新、查询。
- 支持索引重建。
- 支持数据目录迁移和清理。
- 支持故障恢复或重建提示。

依赖：

- MVP Milvus Lite 验证结果可接受。
- Python 打包和依赖冲突没有阻塞问题。
- 算法模块调用链已能配置 Desktop 向量后端。

#### C. SegmentStore 本地实现

- 复用现有 SegmentStore 体系。
- 增加 Desktop 本地实现。
- 收敛直接访问 OpenSearch 的代码路径。
- 支持关键词检索、片段 metadata、top-k 和必要过滤条件。
- 建立与 Cloud OpenSearch 路线的行为对照测试。

依赖：

- 已梳理现有 SegmentStore 接口。
- 已识别绕过 SegmentStore 的 OpenSearch 调用点。

#### D. 算法与解析真实链路

- parsing 接收本地文件并生成真实文档结构。
- processor 处理解析任务和状态。
- doc-service 读取本地文档与任务数据。
- chat service 使用 Desktop 向量和片段检索结果。
- Office/OCR/MinerU/PaddleOCR 按线上 API 或降级方式接入。
- Evo 继续不作为主链路阻塞，除非另行提高优先级。

依赖：

- SQLite、Milvus Lite、SegmentStore 本地实现可用。
- LazyLLM 相关依赖支持 Desktop 运行形态。

#### E. 前端完整体验

- AI 助手管理完整可用。
- Assistant Switcher 在 Chat、技能、知识库、偏好、词汇等页面统一生效。
- 文档扫描路径管理可用。
- 文档解析和索引状态可见。
- 模型 / 在线 API 配置可见。
- 本地服务错误、索引错误、模型错误可区分展示。

依赖：

- 后端提供稳定状态接口。
- Electron 提供 native 能力接口。

#### F. 事件循环预留

- 确认每个 AI 助手未来事件循环的归属模型。
- 确认任务监听、外部渠道凭据、消息处理的用户上下文边界。
- 不必在完整功能阶段完成微信/飞书接入，但不能让当前架构阻塞后续接入。

依赖：

- 当前助手模型稳定。
- 本地任务存储和服务生命周期稳定。

#### G. 功能、性能、稳定性验证

- 首次启动。
- 重启恢复。
- 创建多个 AI 助手。
- 切换助手隔离验证。
- 添加扫描路径。
- 默认示例文档为约 100KB 的太阳系知识 Markdown。
- 上传或扫描文档。
- 文档解析。
- Milvus Lite 向量写入和查询。
- SegmentStore 片段检索。
- RAG 问答。
- 大文件与批量文件。
- SQLite 锁竞争。
- 后端异常退出恢复。
- 日志和诊断包完整性。

## 4.3 阶段三：安装包

### 4.3.1 阶段目标

安装包阶段目标是在完整功能可运行的基础上完成产品化分发。

重点包括：

- Windows 安装包。
- 无开发环境运行。
- 后端可执行文件随包分发。
- Python 依赖和 Milvus Lite 可随包运行。
- 用户数据目录与安装目录分离。
- 升级、卸载、诊断能力可用。
- Cloud artifact 不受 Desktop 发布链路影响。

### 4.3.2 安装包任务拆分

#### A. 前端与 Electron 打包

- 构建 Desktop Renderer。
- 打包 Electron Main/Preload。
- 配置应用图标、名称、版本号。
- 生成 Windows installer。

依赖：

- Desktop 工程骨架稳定。
- 前端 Desktop Mode 构建稳定。

#### B. Go 后端打包

- 编译 Windows exe。
- 放入安装包资源目录。
- Electron 启动时定位 exe。
- 处理 stdout/stderr 和退出码。

依赖：

- Go 服务 Desktop Mode 配置稳定。
- 独立 exe 运行通过。

#### C. Python 后端打包

- 选择 PyInstaller、Nuitka 或其他打包方式。
- 打包 auth-service、algorithm/chat、parsing、processor、doc-service 等。
- 打包 LazyLLM 相关依赖。
- 打包 Milvus Lite 运行依赖。
- 验证资源文件定位、动态 import、模型配置、证书等。

依赖：

- 完整功能阶段 Python 依赖已验证。
- Milvus Lite MVP 与完整功能验证可接受。

#### D. 用户数据与升级

- 首次启动复制默认配置到用户数据目录。
- 升级时保留用户数据。
- 升级时执行必要 migration。
- 卸载时默认保留用户数据，可提供清理选项。

依赖：

- 本地数据目录结构稳定。
- migration 策略稳定。

#### E. 诊断与崩溃处理

- 安装包环境下日志路径正确。
- 崩溃文件可收集。
- 诊断包可导出。
- 后端异常退出可展示给用户。

依赖：

- MVP/完整功能阶段日志体系已建立。

#### F. 干净环境验证

- 干净 Windows 环境安装。
- 无 Docker 环境运行。
- 无 Python/Go/Node 环境运行。
- 普通用户权限运行。
- 中文路径、空格路径运行。
- Windows Defender / 签名相关验证。
- 升级安装验证。
- 卸载验证。

依赖：

- 安装包生成稳定。
- 后端资源定位稳定。

---

# 5. 每个阶段的方案设计

## 5.1 阶段一 MVP 方案设计

### 5.1.1 MVP 架构

```text
Electron
  ├─ Renderer: Desktop Mode 前端
  ├─ Local Proxy
  ├─ Process Manager
  ├─ Log Collector
  └─ Data Directory Manager

Local Processes
  ├─ core: SQLite 最小链路
  ├─ auth-service: desktop auth provider + 默认助手初始化
  ├─ algorithm service: mock / minimal backend
  ├─ scan-control-plane: 复用现有扫盘逻辑的最小启动
  └─ file-watcher: 可选最小启动

Local Stores
  ├─ SQLite: MVP 必需关系数据
  ├─ Milvus Lite: Windows 可行性验证
  ├─ SegmentStore: mock 或最小本地实现
  ├─ local files
  └─ logs
```

### 5.1.2 MVP 技术设计要点

#### Electron

- 新增 Desktop 工程。
- 启动主窗口。
- 通过 Electron 自定义协议加载 Desktop Renderer 主 UI。
- 启动后端进程。
- 等待健康检查。
- 提供本地代理。
- 维护当前助手 ID。
- 采集日志。
- 初始化用户数据目录。

#### 前端

- Desktop Mode 下跳过登录页。
- 显示 AI 助手管理入口。
- 提供全局顶部 Assistant Switcher。
- Chat 页面使用当前助手。
- 技能页面使用当前助手。
- 请求统一走 Local Proxy。
- 提供最小本地服务状态展示。

#### auth-service

- Desktop Mode 下支持免登录。
- 首次启动创建默认 AI 助手。
- 创建默认组和默认写权限。
- 新建 AI 助手时创建后台用户，字段与现有新建用户保持一致。
- 保留 RBAC 表和权限检查所需数据。

#### core

- 支持 SQLite 最小启动。
- 使用当前 `X-User-Id` 表示当前助手。
- 支持 Chat / 技能主入口所需最小 API。
- Redis 相关能力在 Desktop MVP 下使用本地运行时实现或降级。

#### algorithm

- 提供 mock server / mock backend，并作为 MVP 默认配置。
- 不要求完整 RAG 效果。
- Chat 时提示用户当前模型配置处于 mock 状态，并引导用户到模型配置界面配置真实模型。
- Office/OCR 默认走 mock server；用户后续沿用模型配置界面自行配置真实线上 API 或本地能力。
- Milvus Lite 验证可以作为独立 smoke 或最小链路接入。

#### Milvus Lite

MVP 对 Milvus Lite 的目标是“验证是否能作为三阶段默认方案继续推进”。

验证内容包括：

- Windows 安装。
- Python 依赖解析。
- 本地数据目录读写。
- collection 创建和删除。
- 向量写入和查询。
- 进程退出与重启后的数据可用性。
- 初步打包可行性。
- 与现有算法调用链的接口适配成本。

MVP 暂不设计其他向量方案。如果验证不理想，再根据实测问题更新 HLD。

#### SegmentStore

MVP 不追求完整 OpenSearch 替代效果。

目标是：

- 明确现有 SegmentStore 可复用边界。
- 不新增不必要的新抽象。
- 不把临时 mock 写死到未来无法替换的位置。
- 识别直接 OpenSearch 调用点。

#### 扫盘

- 复用现有扫盘逻辑。
- Electron 提供选择目录。
- 前端让用户显式添加扫描路径。
- 不默认全盘扫描。

#### MVP 安全基线

MVP 阶段安全目标聚焦运行环境迁移，不处理算法/RAG 安全专题。

MVP 必须建立以下安全基线：

- BrowserWindow 使用安全默认配置：关闭 Node.js integration，启用 context isolation，不关闭 webSecurity。
- Preload 只暴露最小白名单 API。
- IPC handler 校验 sender、参数 schema 和路径范围。
- Local Proxy 与后端服务只监听 localhost。
- Desktop Renderer 主 UI 通过自定义协议加载，不通过 localhost Web 服务承载。
- 本地后端 API 不直接暴露给局域网。
- 当前助手身份由 Local Proxy 或受控请求层注入。
- 本地后端对关键请求校验启动时生成的 secret / 随机 token。
- 选择目录、打开日志、导出诊断包等能力不接受任意未校验路径。
- 子进程启动不使用 shell 拼接命令。
- 日志和诊断包默认脱敏，尤其必须脱敏模型 key。
- MVP 阶段密钥允许明文写在配置文件中，但不得进入日志和诊断包；Credential Manager / DPAPI 放到第二阶段。

### 5.1.3 MVP 验收口径

MVP 可接受：

- RAG 结果是 mock 或弱效果。
- 模型配置默认是 mock server / mock backend。
- Chat 中提示用户当前处于 mock 状态，并引导用户到模型配置界面配置真实模型。
- Office/OCR 能力缺失、走 mock server 或走用户后续配置的线上 API。
- Evo 缺失。
- SegmentStore 只是最小实现。
- MVP 阶段安装包或开发包不签名。
- MVP 阶段密钥明文写在配置文件中，但日志和诊断包必须脱敏。

MVP 不可接受：

- 需要 Docker 才能启动桌面端。
- 需要用户手工启动后端服务。
- 打开应用仍要求登录。
- 无法创建或切换 AI 助手。
- 当前助手身份无法传到后端。
- 关闭应用后子进程残留。
- 没有日志可诊断。
- Milvus Lite 没有任何 Windows 可行性结论。
- Renderer 获得不必要的 Node.js、shell 或文件系统能力。
- Local Proxy 或本地后端默认暴露到局域网。
- 关键本地 API 只靠可伪造的前端 header 判断身份。
- 诊断包包含明文密钥、模型 key、token 或用户文档正文。

## 5.2 阶段二完整功能方案设计

### 5.2.1 完整功能架构

```text
Electron Desktop App
  ├─ Renderer: 完整 Desktop UI
  ├─ Local Proxy: 完整 REST/SSE/upload/download 支持
  ├─ Process Manager: 管理全部必需本地服务
  └─ Diagnostics: 完整诊断包

Backend Services
  ├─ auth-service: 默认权限 + AI 助手管理
  ├─ core: Chat / 技能 / 会话 / 业务 API
  ├─ scan-control-plane: 路径扫描和任务控制
  ├─ file-watcher: 文件变化监听
  ├─ parsing / processor / doc-service: 文档解析与任务状态
  └─ chat service: RAG 问答

Local Stores
  ├─ SQLite: 关系数据
  ├─ Milvus Lite: 向量数据
  ├─ Desktop SegmentStore: 片段 / 全文索引
  ├─ local file storage
  └─ logs / diagnostics
```

### 5.2.2 完整功能技术设计要点

#### SQLite

- 完成所有必需 migration 兼容。
- 优先通过 ORM 或统一 migration 策略减少 PostgreSQL / SQLite 分叉。
- 对无法统一的 SQL 明确数据库方言边界。
- 对多进程写入进行治理。
- 设计备份、恢复和损坏提示。

#### Milvus Lite

- 作为完整功能默认向量存储。
- 接入真实文档向量化流程。
- 接入真实问答检索流程。
- 支持索引重建。
- 支持应用重启后的数据恢复。
- 验证批量导入和常见知识库规模。

如果完整功能阶段发现 MVP 未覆盖的重大问题，应形成测试报告，并触发方案更新，而不是在没有证据的情况下预设替代路线。

#### SegmentStore

- 复用现有 SegmentStore。
- 新增 Desktop 本地实现。
- 收敛 OpenSearch 直接调用。
- 支持 Chat/RAG 所需片段检索。
- 建立与 Cloud OpenSearch 实现的功能对照。

#### Runtime Store

- Cloud 使用 Redis。
- Desktop 使用本地 Runtime Store。
- 对状态、取消、流式输出、任务进度等能力逐项验证。
- 必要状态按需持久化。

#### 解析与文档处理

- 文档扫描、解析、索引、问答形成闭环。
- Office/OCR 沿用模型配置界面，由用户自行配置真实线上 API 或本地组件；默认选项仍可保留 mock server。
- 缺失能力时 UI 给出明确提示。
- 解析任务状态可追踪。

#### AI 助手隔离

完整验证：

- 助手 A 和助手 B 的会话隔离。
- 助手 A 和助手 B 的技能隔离。
- 助手 A 和助手 B 的知识库上下文隔离。
- 切换助手后前端状态和后端请求一致。

#### 事件循环预留

完整功能阶段应至少完成设计预留：

- 事件循环归属于 AI 助手。
- 事件处理时使用对应助手的用户上下文。
- 外部渠道凭据按助手隔离或按全局配置授权后绑定助手。
- 微信/飞书接入不应要求重做身份模型。

### 5.2.3 完整功能验收口径

完整功能阶段应能在开发机上完成：

- 首次启动。
- 创建多个 AI 助手。
- 添加扫描路径。
- 扫描文件。
- 解析文档。
- 写入 SQLite。
- 写入 Milvus Lite。
- 写入本地 SegmentStore。
- 发起 RAG 问答。
- 切换助手后数据隔离。
- 重启应用后数据仍可用。
- 后端异常退出后有提示和日志。

## 5.3 阶段三安装包方案设计

### 5.3.1 安装包架构

```text
C:\Program Files\LazyMind\
  LazyMind.exe
  resources\
    app.asar
    renderer\
    bin\
      core.exe
      scan-control-plane.exe
      file-watcher.exe
      auth-service\
      algorithm-chat\
      algorithm-parsing\
      algorithm-processor\
      doc-service\
    templates\
      default_config.yaml
      runtime_models.yaml

%APPDATA%\LazyMind\
  config.yaml
  data\
  vector\
    milvus-lite\
  segment\
  uploads\
  scanned\
  cache\
  logs\
  backups\
```

### 5.3.2 安装包技术设计要点

#### 应用目录与用户数据目录分离

- 安装目录只放应用程序和只读资源。
- 用户数据目录放配置、数据库、向量数据、索引、上传文件、日志、缓存。
- 升级应用不覆盖用户数据。
- 卸载默认保留用户数据，提供可选清理。

#### 后端分发

- Go 服务以 exe 分发。
- Python 服务以可执行目录或单文件形式分发。
- Milvus Lite 依赖随 Python 服务一起验证和分发。
- Electron 根据相对资源路径定位后端。

#### 运行环境

安装包必须能在以下环境运行：

- 无 Docker。
- 无 Node。
- 无 Go。
- 无 Python。
- 普通用户权限。
- 中文路径。
- 空格路径。

#### 签名与安全

- MVP 阶段不要求签名；Windows installer 签名放到第三阶段安装包阶段考虑。
- 后端 exe 和 Python 打包产物需要考虑安全软件误报。
- 本地端口默认只监听 localhost。
- 日志和诊断包脱敏。

#### 升级与 migration

- 应用升级时检测数据版本。
- 执行必要 migration。
- migration 失败时保留日志和恢复提示。
- 用户数据应可备份。

### 5.3.3 安装包验收口径

安装包阶段应验证：

- 干净 Windows 安装。
- 首次启动初始化。
- 创建助手。
- 添加文档路径。
- 构建知识库。
- 发起问答。
- 关闭应用后子进程退出。
- 重启后数据保留。
- 升级安装数据不丢失。
- 卸载行为符合预期。
- 诊断包可导出。
- Cloud/Server Mode 构建不受影响。

---

# 6. 关键设计决议汇总

## 6.1 产品与身份

- 用户可见产品名、窗口标题、安装包、菜单、提示文案统一使用 LazyMind。
- 用户不可见的内部实现尽量少改动，必要时可沿用 LazyRAG 命名。
- Desktop Mode 前台展示 AI 助手，不展示管理员 / 普通用户。
- 默认首个 AI 助手为“天文学家 🪐”。
- 默认提供约 100KB 的太阳系知识 Markdown 示例文档。
- 后台每个 AI 助手仍是普通用户。
- 新建 AI 助手字段与现有新建用户保持一致。
- Assistant Switcher 是全局顶部组件。
- 所有 AI 助手平级。
- 当前助手就是当前请求用户。
- 不引入主用户 / 子用户。
- 不引入 actor / effective user 双身份模型。

## 6.2 权限

- 不删除 RBAC。
- 隐藏复杂 RBAC UI。
- 自动创建默认组、默认角色、默认写权限。
- 新建助手自动加入默认组并具备写权限。

## 6.3 网关

- Desktop Mode 不使用 Kong。
- Electron Local Proxy 替代桌面端 API Gateway 职责。
- Cloud/Server Mode 继续保留 Kong。

## 6.4 数据与中间件

- PostgreSQL -> SQLite。
- Redis -> Desktop Runtime Store，本地实现不能简单等同于 `sync.Map`。
- Milvus -> Milvus Lite，三个阶段都暂定默认使用。
- OpenSearch -> 现有 SegmentStore 体系下的 Desktop 本地实现。
- 暂不并行设计 LanceDB/Qdrant 等替代方案；只有 Milvus Lite MVP 验证不理想时再更新方案。

## 6.5 解析与算法

- MVP 不追求完整算法效果。
- MVP 默认使用 mock server / mock backend。
- Chat 在 mock 状态下提示用户到模型配置界面配置真实模型。
- MVP 不强制内置 Office/OCR/MinerU/PaddleOCR。
- Office/OCR 默认走 mock server，后续沿用模型配置界面由用户配置真实 API 或本地能力。
- Desktop 可使用线上 API 降低本地依赖和包体。
- Evo MVP 剪掉。

## 6.6 扫盘

- 用户前端指定扫描路径。
- 不默认全盘扫描。
- MVP 复用现有扫盘逻辑。
- 后续扫盘功能重写后再适配。

## 6.7 日志与可观测性

- MVP 使用现有 log 体系。
- OpenTelemetry 后续再接入。
- Electron 负责收集子进程日志和导出诊断包。
- 诊断包必须脱敏模型 key。

## 6.8 共存

- 单仓库双模式。
- Desktop Mode 通过显式开关启用。
- Cloud 默认行为不变。
- Desktop 构建和依赖不污染 Cloud 构建。
- macOS 不是本方案重点，只做低成本预留，不进入 Windows MVP 核心验收。

---

# 7. 风险与验证点

## 7.1 Milvus Lite Windows 验证风险

虽然当前决议是三个阶段都暂定 Milvus Lite，但它仍是最关键的早期验证点。

必须验证：

- Windows 安装可行性。
- Python 打包可行性。
- 用户数据目录读写可行性。
- collection 生命周期。
- 重启恢复。
- 性能和稳定性。
- 与现有 LazyRAG/LazyLLM 调用链的适配成本。

如果 MVP 验证不理想，应基于具体失败原因更新方案，而不是在 HLD 中提前分散主线；本方案不要求预先定义额外的决策流程或测试报告模板。

## 7.2 SQLite 迁移风险

风险：

- PostgreSQL 专属 SQL 导致 SQLite migration 失败。
- 多进程写入导致锁冲突。
- ORM 和手写 SQL 混用导致双数据库行为不一致。

缓解：

- MVP 先跑最小表集合。
- 完整功能阶段统一 migration 策略。
- 双模式测试 PostgreSQL 和 SQLite。

## 7.3 Runtime Store 语义缺失风险

风险：

- Redis 的 TTL、List、阻塞等待、取消信号等语义被低估。
- Chat 流式输出、取消、状态恢复异常。

缓解：

- 抽象 Runtime Store。
- 对每个语义单独列测试。
- Desktop MVP 可以内存实现，但不能把语义删除。

## 7.4 身份串号风险

风险：

- 切换助手后前端显示和后端请求不一致。
- 会话、技能、知识库串助手。

缓解：

- 当前助手就是当前用户。
- 统一 Assistant Switcher。
- 统一请求上下文注入。
- 建立助手隔离测试。

## 7.5 Python 打包风险

风险：

- LazyLLM、Milvus Lite、OCR、Office 转换依赖打包失败。
- 动态 import、资源文件、证书路径在安装包中失效。

缓解：

- MVP 起做打包 smoke。
- 重型依赖分级接入。
- Office/OCR 可走线上 API 或降级。

## 7.6 Cloud 回归风险

风险：

- Desktop 改造破坏 Cloud 登录、Kong、RBAC、PostgreSQL、Redis、Milvus、OpenSearch 路线。

缓解：

- 显式模式开关。
- 双构建入口。
- 双 CI 矩阵。
- Cloud 默认行为不变。

## 7.7 扫盘权限风险

风险：

- 用户选择无权限目录。
- 扫描过多文件导致性能问题。
- Windows/macOS 权限语义不同。

缓解：

- 用户显式选择路径。
- MVP 复用现有逻辑。
- 权限失败可见。
- 后续扫盘重写再优化。

## 7.8 Renderer 权限扩大风险

风险：

- 云端前端代码迁移到 Electron 后，如果 Renderer 获得 Node.js、shell、文件系统或原始 IPC 能力，普通 XSS 或前端漏洞可能升级成本机权限问题。

缓解：

- 关闭 Node.js integration。
- 启用 context isolation 和 sandbox。
- Preload 只暴露白名单 API。
- 不加载不可信远程页面作为主 UI。
- 配置 CSP 并限制 navigation、new window 和外部链接。

## 7.9 IPC 越权风险

风险：

- Renderer 通过 IPC 调用 Main Process 执行高权限动作，例如任意读写文件、打开任意路径、导出敏感数据或控制本地服务。

缓解：

- IPC API 业务语义化、白名单化。
- IPC handler 校验 sender、参数 schema、路径范围和操作权限。
- 不暴露原始 `ipcRenderer` 和通用命令执行能力。

## 7.10 Localhost API 被伪造调用风险

风险：

- 其他本机程序或浏览器网页直接请求 localhost API，伪造 `X-User-Id` 或触发扫描、删除、导出等操作。

缓解：

- 本地服务只监听 `127.0.0.1`。
- Local Proxy 与后端服务之间使用启动时生成的本地 secret 或等价机制。
- CORS 限制为 Desktop Renderer 自定义协议 origin。
- 当前助手身份由受控层注入，后端不无条件信任前端 header。

## 7.11 子进程与路径劫持风险

风险：

- Electron 启动后端进程时被命令注入，或后端二进制路径被替换，导致执行非预期程序。

缓解：

- 启动子进程不使用 `shell: true`。
- 使用固定资源目录解析可执行文件。
- 命令行参数数组化，不拼接 shell 字符串。
- 环境变量白名单化。
- 安装包阶段考虑二进制完整性校验和安装目录权限。

## 7.12 密钥与诊断包泄露风险

风险：

- 在线 API key、本地服务 secret、token、用户文档正文或敏感路径进入日志和诊断包。

缓解：

- 日志和诊断包统一脱敏。
- MVP 阶段密钥允许明文写在配置文件中，但必须确保不进入日志和诊断包。
- 第二阶段再接入 Windows Credential Manager / DPAPI 等 OS 级安全存储方案。
- 诊断包只包含配置摘要、服务状态、版本号、最近日志和崩溃信息。
- 诊断包必须脱敏模型 key。
- 用户文档正文默认不进入诊断包。

## 7.13 安装包与供应链风险

风险：

- Electron、Node、Python、Go、Milvus Lite、npm/pip/go module 依赖或自动更新链路引入供应链风险。

缓解：

- 依赖锁定版本。
- 建立 Desktop 独立依赖扫描。
- MVP 阶段不要求安装包签名。
- 第三阶段安装包阶段再考虑 Windows installer 和更新包签名与完整性校验。
- 自动更新使用 HTTPS 和签名校验。
- 签名证书和发布 token 独立保护。

---

# 8. 后续 LLD 拆分建议

本文之后建议拆成以下 LLD：

1. Electron Desktop Shell LLD，包含 Desktop Renderer 自定义协议加载方案。
2. 运行环境迁移安全 LLD。
3. Local Proxy 与当前助手身份注入 LLD。
4. Desktop Auth Provider 与 AI 助手模型 LLD。
5. SQLite migration / ORM 兼容 LLD。
6. Runtime Store LLD。
7. Milvus Lite Windows 验证与接入 LLD。
8. SegmentStore Desktop 本地实现 LLD。
9. Python 算法服务 Desktop Mode 与打包 LLD。
10. 前端 Desktop Mode / Assistant Switcher LLD。
11. 扫盘路径选择与权限处理 LLD。
12. 日志、诊断包、崩溃收集 LLD。
13. Windows 安装包与升级 LLD。
14. Cloud/Desktop 双模式 CI LLD。

---


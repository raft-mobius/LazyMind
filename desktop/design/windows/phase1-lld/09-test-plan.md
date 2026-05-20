# Phase 1 MVP 测试计划

## Context

本测试计划服务于 LazyMind Cloud→Desktop 迁移开发过程。目的不是完整产品 QA，而是：
- 验证每个 LLD 模块的迁移正确性
- 驱动开发按依赖顺序推进
- 尽早暴露技术风险（Milvus Lite、SQLite、进程模型）
- 保护 Cloud 模式不被 Desktop 改造破坏

## 测试类型定义

| 层级 | 类型 | 目的 | 执行时机 |
|------|------|------|----------|
| L0 | Smoke Test | 模块能启动、基本功能不崩溃 | 每个模块开发完成后立即执行 |
| L1 | Contract Test | IPC/API/Proxy 接口契约符合 LLD 规范 | 接口实现完成后 |
| L2 | Integration Test | 跨模块流程贯通 | 相关模块联调时 |
| L3 | Regression Test | Cloud 模式行为不变 | 每次影响共享代码的改动后 |
| L4 | Security Baseline Test | 新增信任边界正确建立 | 安全相关模块完成后 |
| L5 | Platform/Environment Test | Windows 特定环境问题 | 里程碑节点集中验证 |

## 测试计划按开发依赖顺序展开

---

### M1: Electron Shell & Data Directory (LLD-01)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M1-S01 | `npm run dev` 启动 Electron | 主窗口可见，DevTools 可打开 |
| M1-S02 | 生产构建后双击启动 | `lazymind://` 协议加载前端 SPA |
| M1-S03 | 首次启动 | `%APPDATA%\LazyMind\` 目录结构自动创建 |
| M1-S04 | 默认文档 | 太阳系 Markdown 示例文档存在于 defaultDocs 目录 |
| M1-S05 | 重复启动 | 第二个实例不创建新窗口，聚焦已有窗口 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M1-C01 | `window.lazymind` 存在性 | Renderer 中 `window.lazymind` 对象存在且包含规定方法 |
| M1-C02 | `window.lazymind.getDataDir()` | 返回正确的 DataDirPaths 结构 |
| M1-C03 | `window.lazymind.pickFolder()` | 调用后弹出系统目录选择对话框，返回路径或 null |
| M1-C04 | `window.lazymind.getAppInfo()` | 返回包含 version、platform、arch 的对象 |
| M1-C05 | IPC channel 白名单 | 只有 LLD 定义的 17 个 channel 可调用，其他 channel 拒绝 |

**L4 Security Baseline**
| ID | 场景 | 预期 |
|----|------|------|
| M1-X01 | BrowserWindow 配置 | nodeIntegration=false, contextIsolation=true, sandbox=true |
| M1-X02 | CSP 策略 | Response header 包含严格 CSP，DevTools 中无 CSP 违规警告 |
| M1-X03 | 导航限制 | Renderer 中 `window.location = 'https://evil.com'` 被阻止 |
| M1-X04 | 新窗口限制 | `window.open()` 被拦截，不产生新窗口 |
| M1-X05 | 路径穿越 | IPC `openPath('../../../etc')` 被拒绝 |

---

### M2: Process Manager (LLD-02)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M2-S01 | 启动 auth-service | 进程启动，健康检查通过，状态变为 healthy |
| M2-S02 | 启动 core | 在 auth-service healthy 之后启动，健康检查通过 |
| M2-S03 | 启动全部服务 | 按依赖顺序启动，所有服务达到 healthy |
| M2-S04 | 关闭应用 | 所有子进程在 10s 内退出，无残留进程 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M2-C01 | `getInfo(name)` | 返回 ProcessInfo 结构（state, port, pid, memory, restartCount） |
| M2-C02 | `getAllInfo()` | 返回所有已注册服务的状态 map |
| M2-C03 | ProcessEvent 广播 | 状态变化时 Renderer 收到 `service:status-change` 事件 |
| M2-C04 | 启动顺序 | Layer 1 (auth, algorithm-mock) → Layer 2 (core) → Layer 3 (scan) → Layer 4 (file-watcher) |

**L2 Integration**
| ID | 场景 | 预期 |
|----|------|------|
| M2-I01 | 端口冲突 | 目标端口被占用时，报告明确错误，不 crash |
| M2-I02 | 进程崩溃恢复 | 手动 kill auth-service 进程 → 自动重启 → 健康检查恢复 healthy |
| M2-I03 | 重启超限 | 连续 crash 3 次后状态变为 failed，不再重启 |
| M2-I04 | stdout/stderr 采集 | 子进程输出可在对应日志文件中找到 |

**L4 Security**
| ID | 场景 | 预期 |
|----|------|------|
| M2-X01 | spawn 参数 | 所有 spawn 调用使用 `shell: false`，参数为数组 |
| M2-X02 | 环境变量 | 子进程只继承白名单环境变量 |
| M2-X03 | 可执行路径 | exe 路径从应用资源目录解析，非用户输入 |

---

### M3: Local Proxy (LLD-03)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M3-S01 | Proxy 启动 | 127.0.0.1:5023 监听成功 |
| M3-S02 | 基本转发 | GET `/api/authservice/auth/health` → 200 |
| M3-S03 | SSE 流式 | Chat SSE 响应实时流式传递，无缓冲延迟 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M3-C01 | 路径映射 | `/api/authservice/*` → port 8002, `/api/core/*` → port 8001 (strip prefix) |
| M3-C02 | Header 注入 | 请求到后端时携带 `X-User-Id`, `X-User-Name`, `X-Desktop-Secret`, `X-Request-Id` |
| M3-C03 | Header 覆盖 | 前端传入的 `X-User-Id` 和 `Authorization` 被 Proxy 覆盖/移除 |
| M3-C04 | `setCurrentAssistant(id, name)` | 调用后后续请求注入新的 X-User-Id |
| M3-C05 | 后端不可用 | 目标服务未启动时返回 502 JSON 错误 |
| M3-C06 | 文件上传 | multipart/form-data 正确透传到后端 |

**L4 Security**
| ID | 场景 | 预期 |
|----|------|------|
| M3-X01 | 绑定地址 | Proxy 只监听 127.0.0.1，外部机器无法连接 |
| M3-X02 | CORS | 只允许 `lazymind://app` 和 dev `http://localhost:5173`，其他 origin 被拒 |
| M3-X03 | 身份不可伪造 | 前端设置的 `X-User-Id` header 不传递到后端（被覆盖） |
| M3-X04 | Desktop-Secret | 后端收到的请求必须包含正确的 `X-Desktop-Secret` |

---

### M4: Desktop Auth & AI Assistant (LLD-04)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M4-S01 | Bootstrap | 首次启动自动创建默认组、默认角色、默认权限、"天文学家 🪐" 助手 |
| M4-S02 | 免登录 | 应用启动直接进入主界面，无登录页 |
| M4-S03 | 助手列表 | `GET /api/authservice/desktop/assistants` 返回至少一个助手 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M4-C01 | Bootstrap 幂等 | 多次调用 `POST /desktop/bootstrap` 结果一致，不重复创建 |
| M4-C02 | 创建助手 | `POST /desktop/assistants` 创建新助手，返回 AssistantInfo |
| M4-C03 | 更新助手 | `PATCH /desktop/assistants/:id` 更新名称/头像/描述 |
| M4-C04 | 删除助手 | `DELETE /desktop/assistants/:id` 软删除 |
| M4-C05 | 获取身份 | `GET /desktop/identity` 返回 Desktop token 和当前默认助手 ID |
| M4-C06 | 切换助手 | 切换后 Proxy 注入新 X-User-Id，后端收到新身份 |

**L2 Integration**
| ID | 场景 | 预期 |
|----|------|------|
| M4-I01 | 启动→身份→Proxy 贯通 | 启动 → bootstrap → 获取默认助手 → Proxy 设置身份 → 请求携带正确 X-User-Id |
| M4-I02 | 新建助手→切换→请求 | 新建 → 切换 → 发起 API 请求 → 后端看到新助手 ID |
| M4-I03 | 重启恢复 | 关闭重启后，上次选中的助手仍为当前助手 |

**L3 Regression**
| ID | 场景 | 预期 |
|----|------|------|
| M4-R01 | Cloud 模式不暴露 Desktop API | Cloud 模式下 `/api/authservice/desktop/*` 返回 404 或 403 |
| M4-R02 | Cloud 登录不受影响 | Desktop 代码不影响现有登录/注册/token 刷新流程 |

---

### M5: SQLite Migration (LLD-05)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M5-S01 | core SQLite 启动 | `ACL_DB_DRIVER=sqlite` 启动 core，migration 通过 |
| M5-S02 | auth-service SQLite 启动 | Alembic migration 在 SQLite 下通过 |
| M5-S03 | scan-control-plane SQLite 启动 | SQLite 配置下启动正常 |
| M5-S04 | WAL 模式 | `PRAGMA journal_mode` 返回 `wal` |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M5-C01 | 用户 CRUD | 创建/读取/更新/删除用户在 SQLite 下正常 |
| M5-C02 | 会话 CRUD | 创建/读取会话和历史记录正常 |
| M5-C03 | 技能 CRUD | 创建/读取/更新技能正常 |
| M5-C04 | busy_timeout | 短时间并发写不报 "database is locked" |
| M5-C05 | 重启数据持久 | 服务重启后数据仍在 |

**L3 Regression**
| ID | 场景 | 预期 |
|----|------|------|
| M5-R01 | PostgreSQL 模式 | Cloud 模式下 PostgreSQL migration 仍通过 |
| M5-R02 | 双数据库行为一致 | 同一组 CRUD 操作在 PostgreSQL 和 SQLite 下结果一致 |

**L5 Platform**
| ID | 场景 | 预期 |
|----|------|------|
| M5-P01 | 中文路径 | SQLite DB 文件位于含中文的目录下可正常读写 |
| M5-P02 | 空格路径 | 路径含空格时 DSN 正确处理 |

---

### M6: Runtime Store (LLD-06)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M6-S01 | Memory backend 启动 | `LAZYMIND_STATE_BACKEND=memory` core 启动不依赖 Redis |
| M6-S02 | auth-service 无 Redis | Desktop 模式 auth-service 启动不连接 Redis |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M6-C01 | Chat 状态 | SetChatStatus → GetChatStatus 返回正确状态 |
| M6-C02 | 流式 chunk | AppendChatChunk × N → GetChatChunks(fromSeq) 返回后续 chunk |
| M6-C03 | 取消信号 | SendStopSignal → WaitForStopSignal 立即返回 |
| M6-C04 | TTL 过期 | 设置 2h TTL 的数据在过期后被清理（可用短 TTL 测试） |
| M6-C05 | 多回答关联 | SetMultiAnswerInfo → GetMultiAnswerInfo 关联正确 |

**L2 Integration**
| ID | 场景 | 预期 |
|----|------|------|
| M6-I01 | Chat 全流程 | 发起问答 → 流式 chunk 到达前端 → 状态 complete |
| M6-I02 | Chat 取消 | 发起问答 → 前端取消 → 后端收到 stop signal → 状态 stopped |

**L3 Regression**
| ID | 场景 | 预期 |
|----|------|------|
| M6-R01 | Redis backend | Cloud 模式下 `LAZYMIND_STATE_BACKEND=redis` 行为不变 |

---

### M7: Frontend Desktop Mode (LLD-07)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M7-S01 | Desktop 构建 | `pnpm build:desktop` 成功，产物不含登录页路由 |
| M7-S02 | Cloud 构建 | `pnpm build` 成功，产物包含登录页路由 |
| M7-S03 | Desktop 启动界面 | 打开即主界面，无登录/注册入口 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M7-C01 | AssistantSwitcher 渲染 | 顶部全局显示当前助手名称 + avatar |
| M7-C02 | 切换助手 | 点击切换 → `window.lazymind.setCurrentAssistant(id)` 被调用 |
| M7-C03 | ServiceStatusBar | 显示各服务状态（healthy=绿, failed=红, starting=黄） |
| M7-C04 | Mock 模型警告 | Chat 页面显示 mock 状态提示 + 模型配置入口链接 |
| M7-C05 | API BaseURL | Desktop 请求发往 `http://127.0.0.1:5023`，无 Authorization header |

**L2 Integration**
| ID | 场景 | 预期 |
|----|------|------|
| M7-I01 | 助手切换→会话刷新 | 切换助手 → 会话列表刷新为新助手的会话 |
| M7-I02 | 目录选择 | 点击"添加扫描路径" → 系统对话框弹出 → 选择后路径显示在 UI |
| M7-I03 | 服务异常展示 | kill 一个后端进程 → ServiceStatusBar 变红 → 功能入口显示不可用状态 |

---

### M8: Logging, Diagnostics & Security (LLD-08)

**L0 Smoke**
| ID | 场景 | 预期 |
|----|------|------|
| M8-S01 | 日志生成 | 启动后 `%APPDATA%\LazyMind\logs\` 下有各服务日志文件 |
| M8-S02 | 诊断包导出 | 调用 `window.lazymind.exportDiagnostics()` → 生成 zip 文件 |

**L1 Contract**
| ID | 场景 | 预期 |
|----|------|------|
| M8-C01 | 日志格式 | 格式为 `[ISO timestamp] [LEVEL] [source] message` |
| M8-C02 | 日志轮转 | 单文件超过 10MB 后自动轮转，保留 5 个历史文件 |
| M8-C03 | 诊断包内容 | 包含 system-info.json, config-summary.json, service-status.json, logs/*.log |
| M8-C04 | 诊断包排除 | 不包含 SQLite 文件、用户文档、vector 数据、uploads |

**L4 Security**
| ID | 场景 | 预期 |
|----|------|------|
| M8-X01 | 日志脱敏 | 配置含 API key (sk-xxx) 后，日志中搜索不到明文 key |
| M8-X02 | 诊断包脱敏 | config-summary.json 中 key/token/secret 字段为 `***REDACTED***` |
| M8-X03 | openPath 范围限制 | `shell:openPath` 只能打开 dataDir 和 logs 下的路径 |
| M8-X04 | 所有端口本地绑定 | `netstat -an` 验证所有 LazyMind 相关端口只绑定 127.0.0.1 |

---

### E2E: End-to-End 集成流程（跨全部模块）

**L2 Integration - 主链路验证**
| ID | 场景 | 预期 |
|----|------|------|
| E2E-01 | 首次启动全流程 | 双击 → splash → 服务启动 → 主界面 → 默认助手已选中 |
| E2E-02 | 新建助手→切换→Chat | 新建"物理学家" → 切换 → 发起 Chat → 后端收到物理学家的 user_id |
| E2E-03 | 添加扫描路径 | 选择目录 → 后端收到路径 → 扫描任务创建 |
| E2E-04 | 应用关闭全流程 | 点击关闭 → 所有后端进程退出 → 无残留 → 数据持久 |
| E2E-05 | 重启恢复 | 重启 → 上次助手恢复 → 上次会话可见 → 数据完整 |
| E2E-06 | 后端崩溃恢复 | kill core 进程 → 自动重启 → 健康恢复 → 功能可用 |

**L5 Platform - Windows 环境验证**
| ID | 场景 | 预期 |
|----|------|------|
| E2E-P01 | 中文用户名路径 | Windows 用户名为中文时，数据目录创建和读写正常 |
| E2E-P02 | 路径含空格 | `C:\Program Files\LazyMind\` 安装路径下正常运行 |
| E2E-P03 | 普通用户权限 | 非管理员运行，全部功能正常（不触发 UAC） |
| E2E-P04 | 端口冲突 | 5023/8001/8002 被占用时，给出明确错误提示 |
| E2E-P05 | Windows Defender | 启动后端 exe 不被杀毒软件拦截（或有明确处理） |

---

## 执行策略

### 优先级矩阵

```
            紧急（阻塞开发）    重要（验证迁移）     低优（后续补充）
L0 Smoke     M1-S01~S03        M2-S01~S04          -
             M5-S01~S03        M3-S01~S03
L1 Contract  M3-C01~C04        M4-C01~C06          M1-C03~C05
             M6-C01~C03        M5-C01~C05
L2 Integration E2E-01~02       E2E-03~06           M7-I02~I03
L3 Regression  M4-R01~R02      M5-R01~R02          M6-R01
L4 Security    M3-X01~X04      M1-X01~X05          M8-X01~X04
L5 Platform    -                E2E-P01~P03         E2E-P04~P05
```

### 执行节奏

1. **每个 LLD 模块开发完成**：执行该模块的 L0 Smoke + L1 Contract
2. **两个以上模块联调**：执行相关 L2 Integration
3. **影响共享代码时**：执行 L3 Regression
4. **安全相关模块完成**：执行 L4 Security Baseline
5. **MVP 里程碑前**：执行全部 E2E + L5 Platform

### 工具建议

| 测试类型 | 建议工具 |
|----------|----------|
| L0 Smoke (Electron) | Electron 启动脚本 + 简单断言 |
| L1 Contract (API) | Jest/Vitest + supertest 或 httpx/pytest |
| L1 Contract (IPC) | Electron test utilities / Playwright |
| L2 Integration | Playwright (E2E browser) + 后端 health check |
| L3 Regression | 现有 CI test suite + Docker Compose |
| L4 Security | 手动 checklist + 自动化 netstat/CSP 检查脚本 |
| L5 Platform | Windows VM / GitHub Actions Windows runner |

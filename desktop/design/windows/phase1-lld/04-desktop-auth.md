# LLD-04: Desktop Auth & AI Assistant Model

## 1. 模块概述

### 1.1 目标

实现 Desktop Mode 的免登录认证和 AI 助手管理：

- 首次启动自动创建默认用户组、权限和默认 AI 助手。
- 免登录直接进入主界面。
- AI 助手的新建、列表、切换。
- 当前助手身份在前端、Proxy、后端之间一致传播。
- auth-service 的 Desktop 模式适配（禁用 Redis、禁用限流、简化 token）。

### 1.2 范围

**包含：**
- auth-service Desktop Mode 行为定义。
- 默认 AI 助手（天文学家 🪐）初始化。
- AI 助手 CRUD API 定义。
- 前端 Auth Facade（跳过登录、自动认证）。
- Assistant Switcher 组件交互设计。
- 当前助手状态管理和持久化。
- 身份上下文在请求链路中的传播方式。

**不包含：**
- auth-service SQLite 迁移细节（见 LLD-05）。
- Redis 替换细节（见 LLD-06）。
- Local Proxy 实现细节（见 LLD-03）。
- 前端组件完整 UI 实现（见 LLD-07）。

---

## 2. 接口契约

### 2.1 AI 助手数据模型

```typescript
// 与后端 User 模型对齐的 AI 助手接口
export interface AssistantInfo {
  id: string;           // user_id (UUID)
  username: string;     // 唯一标识
  displayName: string;  // 展示名称
  avatar: string;       // emoji 或图片 URL
  description: string;  // 助手描述
  createdAt: string;    // ISO timestamp
}
```

### 2.2 Desktop Auth Provider API（auth-service 新增）

```
# Desktop 模式专用 API（在现有 /api/authservice 前缀下）

POST /api/authservice/desktop/bootstrap
  - 首次启动初始化：创建默认组、权限、默认助手
  - 幂等操作，重复调用不产生副作用
  - Response: { code: 0, data: { defaultAssistant: AssistantInfo } }

GET /api/authservice/desktop/assistants
  - 获取所有 AI 助手列表
  - Response: { code: 0, data: { assistants: AssistantInfo[] } }

POST /api/authservice/desktop/assistants
  - 创建新 AI 助手
  - Body: { username, displayName, avatar, description }
  - 后台自动创建用户、加入默认组、绑定写权限
  - Response: { code: 0, data: { assistant: AssistantInfo } }

GET /api/authservice/desktop/assistants/:id
  - 获取单个助手信息
  - Response: { code: 0, data: { assistant: AssistantInfo } }

PATCH /api/authservice/desktop/assistants/:id
  - 更新助手信息（displayName, avatar, description）
  - Response: { code: 0, data: { assistant: AssistantInfo } }

DELETE /api/authservice/desktop/assistants/:id
  - 删除助手（软删除或标记停用）
  - Response: { code: 0, data: null }

GET /api/authservice/desktop/identity
  - 获取 Desktop 模式的认证信息（无需 token）
  - Response: { code: 0, data: { token: string, defaultAssistantId: string } }
```

### 2.3 Electron Main 助手管理接口

```typescript
// desktop/src/main/assistant-manager.ts

export interface AssistantManager {
  initialize(): Promise<void>;          // 调用 bootstrap API，获取默认助手
  getCurrent(): AssistantInfo | null;
  setCurrent(id: string): Promise<void>;
  getList(): Promise<AssistantInfo[]>;
  create(data: CreateAssistantData): Promise<AssistantInfo>;
  onCurrentChange(callback: (assistant: AssistantInfo) => void): () => void;
}

export interface CreateAssistantData {
  username: string;
  displayName: string;
  avatar: string;
  description: string;
}
```

### 2.4 Preload API（补充 LLD-01 定义）

```typescript
// 在 window.lazymind 上暴露
getCurrentAssistant(): Promise<AssistantInfo | null>;
setCurrentAssistant(id: string): Promise<void>;
getAssistantList(): Promise<AssistantInfo[]>;
onAssistantChange(callback: (assistant: AssistantInfo) => void): () => void;
```

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-05**：auth-service 使用 SQLite 存储用户/组/权限数据。
- **LLD-03**：通过 Local Proxy 的 `setCurrentAssistant()` 接口注入身份。
- **LLD-01**：IPC 通道与 Renderer 通信。
- **LLD-06**：auth-service Desktop 模式下不依赖 Redis。

### 3.2 被依赖

- **LLD-07**：前端使用 Auth Facade 和 Assistant Switcher 组件。
- **LLD-03**：Proxy 从本模块获取当前助手 ID/Name 来注入 header。

---

## 4. 技术设计

### 4.1 Desktop Auth 流程

```
应用启动
  │
  ▼
Electron Main: 启动 auth-service（LLD-02）
  │
  ▼
Electron Main: 等待 auth-service 健康
  │
  ▼
AssistantManager.initialize()
  │
  ├─ POST /api/authservice/desktop/bootstrap
  │    └─ auth-service 创建默认组、权限、默认 AI 助手（幂等）
  │
  ├─ GET /api/authservice/desktop/identity
  │    └─ 返回 Desktop token 和默认助手 ID
  │
  ├─ 读取持久化的 "上次选择的助手 ID"（从 config 或 localStorage）
  │    └─ 如果有效，设置为当前助手；否则使用默认助手
  │
  ├─ proxyServer.setCurrentAssistant(userId, userName)
  │    └─ 通知 Proxy 注入身份 header
  │
  └─ 广播 'assistant:changed' 给 Renderer
       └─ 前端更新 UI

前端加载
  │
  ├─ 检测 window.lazymind 存在 → Desktop Mode
  ├─ 跳过登录页，直接进入主界面
  ├─ 调用 window.lazymind.getCurrentAssistant() 获取当前助手
  └─ 设置 auth state（mock token + 当前用户 ID）
```

### 4.2 auth-service Desktop 模式改造

```python
# backend/auth-service/desktop/__init__.py

# 新增 Desktop 模式路由
from fastapi import APIRouter

desktop_router = APIRouter(prefix="/api/authservice/desktop", tags=["desktop"])
```

#### 4.2.1 Bootstrap 逻辑

```python
# backend/auth-service/desktop/bootstrap.py

DEFAULT_ASSISTANT = {
    "username": "astronomer",
    "display_name": "天文学家",
    "avatar": "🪐",
    "description": "天文学家是一位专注于太阳系、行星、卫星、小行星、彗星和基础天文知识的入门向导，擅长用清晰、耐心、富有画面感的方式解释宇宙中的常见现象，帮助用户从太阳系开始建立对天文学的整体认识。",
}

DEFAULT_GROUP = "desktop-default"
DEFAULT_ROLE = "user"

async def bootstrap_desktop(db: Session):
    """幂等初始化 Desktop 模式所需数据"""

    # 1. 确保默认角色存在（复用现有 bootstrap 逻辑）
    ensure_roles(db)

    # 2. 确保默认组存在
    group = ensure_group(db, DEFAULT_GROUP)

    # 3. 确保默认权限绑定
    ensure_default_permissions(db, group)

    # 4. 确保默认 AI 助手存在
    assistant = ensure_assistant(db, DEFAULT_ASSISTANT, group)

    return assistant
```

#### 4.2.2 Desktop 模式标志

```python
# backend/auth-service/core/config.py

import os

DESKTOP_MODE = os.getenv("LAZYMIND_DESKTOP_MODE", "false").lower() == "true"
```

Desktop 模式下的行为变化：

| 功能 | Cloud 模式 | Desktop 模式 |
|------|-----------|-------------|
| 登录 | JWT + password | 跳过，直接返回 token |
| refresh token | Redis TTL | 不使用 |
| 限流 | Redis ZSET | 不启用 |
| bootstrap | 手动触发 | 自动 + 幂等 |
| 用户创建 | 管理员创建 | Desktop API 创建 |
| 权限检查 | RBAC 完整链路 | 保留，自动分配写权限 |

#### 4.2.3 Desktop Identity 端点

```python
# backend/auth-service/desktop/identity.py

@desktop_router.get("/identity")
async def get_desktop_identity(db: Session = Depends(get_db)):
    """返回 Desktop 模式的认证信息，无需传统登录"""
    # 获取默认助手
    default_assistant = get_default_assistant(db)

    # 生成 Desktop token（长有效期，固定 payload）
    token = create_desktop_token(
        user_id=str(default_assistant.id),
        username=default_assistant.username,
        role="user"
    )

    return {
        "token": token,
        "default_assistant_id": str(default_assistant.id),
    }
```

### 4.3 AI 助手与后台用户映射

| 前台概念 | 后台实现 |
|----------|----------|
| AI 助手 | `users` 表中一行，`source='desktop-assistant'` |
| 助手名称 | `users.display_name` |
| 助手头像 | `users.avatar`（存 emoji 或 URL） |
| 助手描述 | `users.description`（新增字段或复用 bio） |
| 创建助手 | 创建 user + 加入默认组 + 绑定 user 角色 |
| 切换助手 | 修改 Proxy 注入的 `X-User-Id` |
| 删除助手 | 软删除 user（`is_active=false`） |

### 4.4 当前助手状态管理

Electron Main Process 维护当前助手状态：

```typescript
// desktop/src/main/assistant-manager.ts

import { getDataDir } from './data-dir';
import path from 'node:path';
import fs from 'node:fs/promises';

const STATE_FILE = 'assistant-state.json';

interface AssistantState {
  currentId: string;
  lastUpdated: string;
}

export class AssistantManagerImpl implements AssistantManager {
  private current: AssistantInfo | null = null;
  private listeners: ((a: AssistantInfo) => void)[] = [];
  private proxyServer: ProxyServer;

  constructor(proxyServer: ProxyServer) {
    this.proxyServer = proxyServer;
  }

  async initialize(): Promise<void> {
    // 1. 调用 bootstrap API
    const bootstrapRes = await this.callAuthAPI('POST', '/desktop/bootstrap');

    // 2. 获取 identity
    const identityRes = await this.callAuthAPI('GET', '/desktop/identity');

    // 3. 读取上次选择的助手
    const savedState = await this.loadState();
    const targetId = savedState?.currentId || identityRes.data.default_assistant_id;

    // 4. 获取助手信息并设置为当前
    const assistants = await this.getList();
    const target = assistants.find((a) => a.id === targetId) || assistants[0];

    if (target) {
      await this.setCurrent(target.id);
    }
  }

  async setCurrent(id: string): Promise<void> {
    const assistants = await this.getList();
    const assistant = assistants.find((a) => a.id === id);
    if (!assistant) throw new Error(`Assistant not found: ${id}`);

    this.current = assistant;

    // 通知 Proxy 更新身份注入
    this.proxyServer.setCurrentAssistant(assistant.id, assistant.username);

    // 持久化选择
    await this.saveState({ currentId: id, lastUpdated: new Date().toISOString() });

    // 广播给 Renderer
    this.listeners.forEach((cb) => cb(assistant));
  }

  // ... 其他方法实现
}
```

### 4.5 前端 Auth Facade

```typescript
// 前端 Desktop Mode 认证适配
// 在 frontend/src/components/auth.ts 基础上扩展

export function isDesktopMode(): boolean {
  return typeof window !== 'undefined' && 'lazymind' in window;
}

export async function initDesktopAuth(): Promise<void> {
  if (!isDesktopMode()) return;

  // 从 Electron 获取当前助手信息
  const assistant = await window.lazymind.getCurrentAssistant();
  if (!assistant) return;

  // 设置 localStorage 中的用户信息（兼容现有 auth 逻辑）
  const userInfo: UserInfo = {
    token: 'desktop-mode-token',  // placeholder，实际请求由 Proxy 处理
    username: assistant.username,
    userId: assistant.id,
    role: 'user',
    displayName: assistant.displayName,
  };

  localStorage.setItem('lazymind:user', JSON.stringify(userInfo));
}
```

### 4.6 身份传播链路

```
[前端] Assistant Switcher 选择助手 B
   │
   ▼
[前端] 调用 window.lazymind.setCurrentAssistant(assistantB.id)
   │
   ▼
[Preload/IPC] → Electron Main Process
   │
   ▼
[Main] AssistantManager.setCurrent(id)
   ├─ proxyServer.setCurrentAssistant(userId, userName)
   ├─ 持久化 assistant-state.json
   └─ BrowserWindow.send('assistant:changed', assistantB)
   │
   ▼
[前端] 收到 onAssistantChange 回调
   ├─ 更新全局状态 (zustand store)
   ├─ 更新 localStorage 中的 userId
   └─ 触发当前页面数据刷新（会话列表、技能列表等）
   │
   ▼
[后续请求] 前端发起 API 请求
   │
   ▼
[Proxy] 注入新的 X-User-Id: assistantB.id
   │
   ▼
[后端] 使用 assistantB.id 作为当前用户上下文
```

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `desktop/src/main/assistant-manager.ts` | 助手管理器实现 |
| `desktop/src/main/ipc/assistant.ts` | 助手相关 IPC handlers |
| `backend/auth-service/desktop/__init__.py` | Desktop 路由模块 |
| `backend/auth-service/desktop/bootstrap.py` | Desktop 初始化逻辑 |
| `backend/auth-service/desktop/identity.py` | Desktop 认证端点 |
| `backend/auth-service/desktop/assistants.py` | 助手 CRUD API |
| `backend/auth-service/desktop/schemas.py` | Pydantic schemas |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `backend/auth-service/main.py` | 添加 `desktop_router` 到 app |
| `backend/auth-service/core/config.py` | 添加 `DESKTOP_MODE` 配置 |
| `backend/auth-service/core/database.py` | Desktop 模式下 Redis 相关逻辑降级 |
| `backend/auth-service/models/user.py` | 确保有 `avatar`、`description`、`source` 字段 |
| `frontend/src/components/auth.ts` | 添加 `isDesktopMode()` 和 `initDesktopAuth()` |
| `frontend/src/router/index.tsx` | Desktop 模式下跳过登录路由保护 |

---

## 6. 配置与环境变量

| 变量名 | 接收方 | 说明 |
|--------|--------|------|
| `LAZYMIND_DESKTOP_MODE` | auth-service | `true` 启用 Desktop 模式 |
| `LAZYMIND_BOOTSTRAP_ADMIN_USERNAME` | auth-service | 系统管理员用户名 |
| `LAZYMIND_BOOTSTRAP_ADMIN_PASSWORD` | auth-service | 系统管理员密码 |
| `LAZYMIND_LOCAL_SECRET` | auth-service | Local Proxy 认证 secret |

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| Bootstrap 失败（DB 异常） | Electron 显示错误提示，提供重试和诊断入口 |
| 默认助手被删除 | 重新调用 bootstrap 创建 |
| 切换到不存在的助手 ID | 回退到默认助手 |
| auth-service 未就绪时调用 | 等待健康检查通过后重试 |
| 助手 username 重复 | API 返回 409，前端提示用户修改 |

---

## 8. 安全考量

- Desktop token 是本地使用的占位 token，不用于网络传输。实际身份由 Proxy 通过 `X-User-Id` 注入。
- 前端 `localStorage` 中的 token 仅用于兼容现有 auth 模块的检查逻辑，不作为真实认证凭据。
- 只有 Local Proxy 能注入 `X-User-Id`，后端通过 `X-Desktop-Secret` 校验请求来源。
- 助手 CRUD API 在 Desktop 模式下不需要 admin 权限（所有操作都是本地操作）。
- 不暴露系统管理员密码到前端或日志。

---

## 9. 测试策略

### 9.1 单元测试

- Bootstrap 幂等性：多次调用不创建重复数据。
- 助手 CRUD：创建、查询、更新、删除。
- 身份传播：切换助手后 Proxy header 更新。

### 9.2 集成测试

- 全流程：启动 → bootstrap → 获取助手列表 → 切换助手 → 验证后端收到正确 `X-User-Id`。
- 前端 auth facade：Desktop 模式下不显示登录页。
- 持久化：重启应用后恢复上次选择的助手。

### 9.3 数据隔离测试

- 助手 A 创建会话 → 切换到助手 B → 看不到 A 的会话。
- 助手 A 的技能列表 ≠ 助手 B 的技能列表。

---

## 10. Cloud 模式兼容

- `desktop_router` 仅在 `LAZYMIND_DESKTOP_MODE=true` 时注册。
- Cloud 模式下 `/api/authservice/desktop/*` 路径不存在。
- 现有登录、JWT、Redis refresh token、限流逻辑在 Cloud 模式下完全不变。
- `users` 表新增字段（如 `source='desktop-assistant'`）对 Cloud 无副作用。
- 前端 `isDesktopMode()` 检测 `window.lazymind`，Cloud 模式下不存在该对象。

---

## 11. 验收标准

- [ ] 首次启动自动创建默认 AI 助手"天文学家 🪐"。
- [ ] 应用启动后直接进入主界面，无登录页。
- [ ] 可通过 API 创建新 AI 助手。
- [ ] 可切换当前 AI 助手。
- [ ] 切换后，后端收到的 `X-User-Id` 对应新助手。
- [ ] 重启应用后恢复上次选择的助手。
- [ ] Cloud 模式下 `/api/authservice/desktop/*` 不可访问。
- [ ] Bootstrap 多次调用幂等。
- [ ] 前端 Desktop 模式下不显示登录/注册入口。

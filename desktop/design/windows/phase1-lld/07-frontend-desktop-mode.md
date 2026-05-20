# LLD-07: Frontend Desktop Mode & Assistant Switcher

## 1. 模块概述

### 1.1 目标

改造前端以支持 Desktop Mode，同时保持 Cloud Mode 功能不变：

- 构建时 Desktop Mode 标志。
- 条件隐藏登录/注册/RBAC 管理页面。
- Assistant Switcher 全局组件。
- API 请求走 Local Proxy。
- 服务状态指示器。
- Mock 模型状态提示。
- 文件夹选择集成。

### 1.2 范围

**包含：**
- Vite 构建配置（Desktop Mode 环境变量）。
- 路由条件渲染。
- Assistant Switcher 组件设计和状态管理。
- Auth Facade（Desktop 模式下的认证适配）。
- 服务状态展示组件。
- Chat 中 Mock 模型提示。
- Electron IPC 集成层。

**不包含：**
- Electron 主进程实现（见 LLD-01）。
- IPC handler 具体实现（见 LLD-01）。
- auth-service 后端改造（见 LLD-04）。
- 完整的 UI 视觉设计（本模块定义交互和数据流）。

---

## 2. 接口契约

### 2.1 构建时环境变量

```typescript
// 在 Vite 中通过 import.meta.env 访问
interface ImportMetaEnv {
  VITE_LAZYMIND_MODE: 'desktop' | 'cloud';  // 运行模式
  VITE_PROXY_TARGET?: string;                 // Cloud 模式代理目标
}
```

### 2.2 运行时 Desktop API（由 Preload 注入）

```typescript
// 详见 LLD-01 定义的 window.lazymind
interface Window {
  lazymind?: LazyMindDesktopAPI;
}
```

### 2.3 前端状态 Store

```typescript
// frontend/src/stores/desktop.ts (新增)
import { create } from 'zustand';

interface AssistantInfo {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  description: string;
}

interface ServiceStatus {
  name: string;
  state: 'pending' | 'starting' | 'healthy' | 'stopping' | 'stopped' | 'failed';
  error?: string;
}

interface DesktopStore {
  // 模式
  isDesktop: boolean;

  // 当前助手
  currentAssistant: AssistantInfo | null;
  assistantList: AssistantInfo[];
  setCurrentAssistant: (id: string) => Promise<void>;
  refreshAssistantList: () => Promise<void>;

  // 服务状态
  serviceStatuses: Record<string, ServiceStatus>;

  // 初始化
  initialize: () => Promise<void>;
}
```

### 2.4 Assistant Switcher 组件接口

```typescript
// frontend/src/components/AssistantSwitcher/index.tsx
interface AssistantSwitcherProps {
  className?: string;
}

// 无需传入 props，内部通过 useDesktopStore 获取状态
```

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-01**：`window.lazymind` Preload API。
- **LLD-03**：API 请求目标（Local Proxy 端口）。
- **LLD-04**：auth-service 提供的 Desktop API（助手 CRUD）。

### 3.2 被依赖

- 无其他 LLD 模块依赖本模块。本模块是面向用户的最终层。

---

## 4. 技术设计

### 4.1 构建配置

```typescript
// frontend/vite.config.ts 修改

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const isDesktop = env.VITE_LAZYMIND_MODE === 'desktop';

  return {
    // ... 现有配置
    define: {
      __DESKTOP_MODE__: JSON.stringify(isDesktop),
    },
    server: {
      port: 5173,
      proxy: isDesktop ? undefined : {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:5023',
          changeOrigin: true,
          timeout: 3 * 60 * 1000,
        },
      },
    },
  };
});
```

Desktop 构建命令：
```bash
VITE_LAZYMIND_MODE=desktop pnpm build
```

### 4.2 模式检测

```typescript
// frontend/src/utils/platform.ts (新增)

export function isDesktopMode(): boolean {
  // 编译时常量
  if (typeof __DESKTOP_MODE__ !== 'undefined') {
    return __DESKTOP_MODE__;
  }
  // 运行时检测（兼容）
  return typeof window !== 'undefined' && 'lazymind' in window;
}

export function getDesktopAPI(): LazyMindDesktopAPI | null {
  if (isDesktopMode() && window.lazymind) {
    return window.lazymind;
  }
  return null;
}
```

### 4.3 路由条件渲染

```typescript
// frontend/src/router/index.tsx 修改

import { isDesktopMode } from '@/utils/platform';

function getRoutes() {
  const desktop = isDesktopMode();

  const publicRoutes = desktop ? [] : [
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/oauth/feishu/data-source/callback', element: <OAuthCallback /> },
  ];

  const adminRoutes = desktop ? [] : [
    { path: '/admin', element: <AdminPanel /> },
  ];

  const protectedRoutes = [
    { path: '/agent/chat', element: <ChatPage /> },
    { path: '/lib/knowledge', element: <KnowledgePage /> },
    { path: '/data-sources', element: <DataSourcePage /> },
    { path: '/model-providers', element: <ModelProvidersPage /> },
    { path: '/memory-management', element: <MemoryPage /> },
    // Desktop 模式新增：助手管理
    ...(desktop ? [{ path: '/assistants', element: <AssistantManagementPage /> }] : []),
    ...adminRoutes,
  ];

  return { publicRoutes, protectedRoutes };
}
```

### 4.4 Auth Facade

```typescript
// frontend/src/stores/desktop.ts

import { create } from 'zustand';
import { getDesktopAPI } from '@/utils/platform';

export const useDesktopStore = create<DesktopStore>((set, get) => ({
  isDesktop: isDesktopMode(),
  currentAssistant: null,
  assistantList: [],
  serviceStatuses: {},

  async initialize() {
    const api = getDesktopAPI();
    if (!api) return;

    // 获取当前助手
    const current = await api.getCurrentAssistant();
    set({ currentAssistant: current });

    // 获取助手列表
    const list = await api.getAssistantList();
    set({ assistantList: list });

    // 监听状态变化
    api.onAssistantChange((assistant) => {
      set({ currentAssistant: assistant });
      // 同步到 auth 模块
      syncAuthState(assistant);
    });

    api.onServiceStatusChange((statuses) => {
      set({ serviceStatuses: statuses });
    });

    // 初始化 auth 状态
    if (current) {
      syncAuthState(current);
    }
  },

  async setCurrentAssistant(id: string) {
    const api = getDesktopAPI();
    if (!api) return;
    await api.setCurrentAssistant(id);
    // onAssistantChange 回调会更新状态
  },

  async refreshAssistantList() {
    const api = getDesktopAPI();
    if (!api) return;
    const list = await api.getAssistantList();
    set({ assistantList: list });
  },
}));

function syncAuthState(assistant: AssistantInfo) {
  // 兼容现有 auth 模块：设置 localStorage
  const userInfo = {
    token: 'desktop-local-token',
    username: assistant.username,
    userId: assistant.id,
    role: 'user',
    displayName: assistant.displayName,
  };
  localStorage.setItem('lazymind:user', JSON.stringify(userInfo));
  // 触发 auth change 事件
  window.dispatchEvent(new CustomEvent('lazymind:user-change'));
}
```

### 4.5 MainLayout 修改

```typescript
// frontend/src/layouts/MainLayout.tsx 修改要点

import { isDesktopMode } from '@/utils/platform';
import { AssistantSwitcher } from '@/components/AssistantSwitcher';
import { ServiceStatusBar } from '@/components/ServiceStatusBar';

export function MainLayout() {
  const desktop = isDesktopMode();

  // Desktop 模式不检查登录状态（由 Electron 管理）
  if (!desktop) {
    const isLoggedIn = AgentAppsAuth.isLoggedIn();
    if (!isLoggedIn) return <Navigate to="/login" />;
  }

  return (
    <div className="main-layout">
      <header className="main-header">
        {desktop && <AssistantSwitcher />}
        {desktop && <ServiceStatusBar />}
        {/* 现有 header 内容 */}
      </header>
      <aside className="main-sidebar">
        {/* 现有菜单，隐藏 Desktop 不需要的项 */}
        <SidebarMenu desktop={desktop} />
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
```

### 4.6 Assistant Switcher 组件

```typescript
// frontend/src/components/AssistantSwitcher/index.tsx

import { Dropdown, Avatar, Space, Typography } from 'antd';
import { useDesktopStore } from '@/stores/desktop';

export function AssistantSwitcher({ className }: { className?: string }) {
  const { currentAssistant, assistantList, setCurrentAssistant } = useDesktopStore();

  if (!currentAssistant) return null;

  const menuItems = assistantList.map((a) => ({
    key: a.id,
    label: (
      <Space>
        <span style={{ fontSize: 20 }}>{a.avatar}</span>
        <span>{a.displayName}</span>
      </Space>
    ),
    onClick: () => setCurrentAssistant(a.id),
  }));

  // 添加"新建助手"入口
  menuItems.push({
    key: 'create-new',
    label: <span>+ 新建 AI 助手</span>,
    onClick: () => { /* 导航到助手管理页或弹窗 */ },
  });

  return (
    <Dropdown menu={{ items: menuItems, selectedKeys: [currentAssistant.id] }} trigger={['click']}>
      <div className={`assistant-switcher ${className || ''}`}>
        <Space>
          <span style={{ fontSize: 24 }}>{currentAssistant.avatar}</span>
          <Typography.Text strong>{currentAssistant.displayName}</Typography.Text>
          <DownOutlined />
        </Space>
      </div>
    </Dropdown>
  );
}
```

### 4.7 服务状态指示器

```typescript
// frontend/src/components/ServiceStatusBar/index.tsx

import { Badge, Tooltip, Space } from 'antd';
import { useDesktopStore } from '@/stores/desktop';

const STATE_COLORS: Record<string, string> = {
  healthy: 'green',
  starting: 'gold',
  pending: 'default',
  failed: 'red',
  stopped: 'default',
  stopping: 'gold',
};

export function ServiceStatusBar() {
  const { serviceStatuses } = useDesktopStore();
  const services = Object.values(serviceStatuses);

  const allHealthy = services.every((s) => s.state === 'healthy');
  const anyFailed = services.some((s) => s.state === 'failed');
  const anyStarting = services.some((s) => s.state === 'starting' || s.state === 'pending');

  const overallColor = anyFailed ? 'red' : anyStarting ? 'gold' : 'green';
  const overallText = anyFailed ? '部分服务异常' : anyStarting ? '服务启动中...' : '就绪';

  return (
    <Tooltip title={
      <div>
        {services.map((s) => (
          <div key={s.name}>
            <Badge color={STATE_COLORS[s.state]} text={`${s.name}: ${s.state}`} />
            {s.error && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{s.error}</div>}
          </div>
        ))}
      </div>
    }>
      <Badge color={overallColor} text={overallText} />
    </Tooltip>
  );
}
```

### 4.8 Chat Mock 模型提示

```typescript
// frontend/src/modules/chat/components/MockModelWarning.tsx

import { Alert } from 'antd';
import { isDesktopMode } from '@/utils/platform';
import { useNavigate } from 'react-router-dom';

export function MockModelWarning() {
  const navigate = useNavigate();

  // 只在 Desktop 模式且模型配置为 mock 时显示
  // 通过后端 API 判断是否为 mock 配置
  if (!isDesktopMode()) return null;

  return (
    <Alert
      type="warning"
      showIcon
      message="当前模型配置处于 mock 状态"
      description={
        <span>
          回复为模拟结果。请到{' '}
          <a onClick={() => navigate('/model-providers')}>模型配置</a>{' '}
          页面配置真实模型 API Key。
        </span>
      }
      style={{ marginBottom: 16 }}
    />
  );
}
```

### 4.9 文件夹选择集成

```typescript
// frontend/src/hooks/useDesktopFolder.ts

import { getDesktopAPI } from '@/utils/platform';

export function useDesktopFolder() {
  const pickFolder = async (title?: string): Promise<string | null> => {
    const api = getDesktopAPI();
    if (!api) {
      // Cloud 模式 fallback: 使用浏览器 File System Access API 或不支持
      return null;
    }
    return api.pickFolder({ title });
  };

  return { pickFolder, isDesktop: !!getDesktopAPI() };
}
```

在扫描路径管理中使用：

```typescript
// 数据源页面或知识库页面中
const { pickFolder, isDesktop } = useDesktopFolder();

async function handleAddScanPath() {
  if (isDesktop) {
    const folder = await pickFolder('选择要扫描的文件夹');
    if (folder) {
      await scanAPI.addSource({ path: folder });
      refreshSources();
    }
  }
}
```

### 4.10 API Base URL 策略

Desktop 模式下，所有 API 请求走 Local Proxy：

```typescript
// frontend/src/api/config.ts

import { isDesktopMode } from '@/utils/platform';

export function getAPIBaseURL(): string {
  if (isDesktopMode()) {
    // Desktop: 请求走相对路径，由 Electron 自定义协议 or Vite proxy 转发
    // 生产模式：前端通过自定义协议加载，API 请求需要绝对路径到 proxy
    return 'http://127.0.0.1:5023';
  }
  // Cloud: 使用相对路径（由 Nginx/Vite proxy 处理）
  return '';
}
```

修改 axios 实例：

```typescript
// frontend/src/components/request.ts 修改
import { getAPIBaseURL } from '@/api/config';

const instance = axios.create({
  baseURL: getAPIBaseURL(),
  timeout: 30 * 1000,
});
```

### 4.11 请求认证改造

Desktop 模式下不需要 `Authorization` header（由 Proxy 注入身份）：

```typescript
// frontend/src/components/request.ts 修改

instance.interceptors.request.use((config) => {
  if (!isDesktopMode()) {
    // Cloud: 附加 JWT token
    const token = AgentAppsAuth.getAccessToken();
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
  }
  // Desktop: 不附加 token，由 Local Proxy 注入 X-User-Id
  return config;
});

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isDesktopMode()) {
      // Cloud: token 过期，尝试刷新
      return handleTokenRefresh(error);
    }
    // Desktop: 401 不应出现，可能是服务未就绪
    return Promise.reject(error);
  }
);
```

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `frontend/src/utils/platform.ts` | 平台/模式检测工具 |
| `frontend/src/stores/desktop.ts` | Desktop 状态 Store |
| `frontend/src/components/AssistantSwitcher/index.tsx` | 助手切换组件 |
| `frontend/src/components/AssistantSwitcher/style.less` | 样式 |
| `frontend/src/components/ServiceStatusBar/index.tsx` | 服务状态条 |
| `frontend/src/modules/chat/components/MockModelWarning.tsx` | Mock 提示 |
| `frontend/src/hooks/useDesktopFolder.ts` | 桌面文件夹选择 hook |
| `frontend/src/api/config.ts` | API 基础配置 |
| `frontend/src/pages/AssistantManagement/index.tsx` | 助手管理页 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `frontend/vite.config.ts` | 添加 Desktop Mode 构建配置 |
| `frontend/src/router/index.tsx` | 条件路由 |
| `frontend/src/layouts/MainLayout.tsx` | 添加 AssistantSwitcher、ServiceStatusBar |
| `frontend/src/components/request.ts` | API base URL 和认证策略修改 |
| `frontend/src/components/auth.ts` | 添加 `isDesktopMode()` 兼容 |
| `frontend/src/main.tsx` | 应用初始化时调用 Desktop Store initialize |
| `frontend/src/modules/chat/index.tsx` | 添加 MockModelWarning |
| `frontend/package.json` | 添加 desktop 相关 build script |

---

## 6. 配置与环境变量

| 变量名 | 说明 | Cloud 值 | Desktop 值 |
|--------|------|----------|-----------|
| `VITE_LAZYMIND_MODE` | 运行模式 | `cloud`（默认） | `desktop` |
| `VITE_PROXY_TARGET` | 开发代理目标 | `http://localhost:5023` | 不使用 |

### Build Scripts

```json
// frontend/package.json
{
  "scripts": {
    "dev": "vite",
    "dev:desktop": "VITE_LAZYMIND_MODE=desktop vite",
    "build": "vite build",
    "build:desktop": "VITE_LAZYMIND_MODE=desktop vite build"
  }
}
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| `window.lazymind` 未就绪 | 显示 loading 状态，等待 Electron Preload 注入 |
| 服务状态 = failed | 在 ServiceStatusBar 中红色标记，提供"查看日志"入口 |
| 切换助手失败 | 恢复为之前的助手，Toast 提示错误 |
| API 请求 502 | 显示"服务未就绪"提示，不触发登录流程 |
| Mock 模型响应 | Chat 中显示 MockModelWarning |

---

## 8. 安全考量

- Desktop 模式下前端不存储真实 token（只存 placeholder）。
- 不暴露 `window.lazymind` 的内部实现（由 contextBridge 隔离）。
- 不在前端代码中包含任何 secret 或 API key。
- `getAPIBaseURL()` 只返回 localhost 地址，不泄露外部服务信息。

---

## 9. 测试策略

### 9.1 单元测试

- `isDesktopMode()`：mock `__DESKTOP_MODE__` 和 `window.lazymind`。
- `useDesktopStore`：mock Desktop API，测试状态更新。
- `AssistantSwitcher`：渲染测试，切换选择。
- `ServiceStatusBar`：不同状态的显示。

### 9.2 集成测试

- Desktop 模式构建后，验证无登录页路由。
- Cloud 模式构建后，验证登录页存在。
- Desktop 模式下请求不携带 Authorization header。

### 9.3 E2E 测试（配合 Electron）

- 打开应用 → 看到 AssistantSwitcher → 显示"天文学家"。
- 切换助手 → AssistantSwitcher 更新 → 会话列表刷新。
- 服务启动中 → ServiceStatusBar 显示"启动中"→ 就绪后显示绿色。
- Chat 页面 → Mock 状态下显示警告 → 点击可跳转模型配置。

---

## 10. Cloud 模式兼容

- `VITE_LAZYMIND_MODE` 默认为 `cloud`，不设置时行为与现有完全一致。
- 所有 Desktop-only 组件（AssistantSwitcher、ServiceStatusBar）通过 `isDesktopMode()` 条件渲染。
- 现有 auth 流程（JWT、token refresh、登录页）在 Cloud 模式下不变。
- 现有路由和页面在 Cloud 模式下不受影响。
- `frontend/src/utils/platform.ts` 是新文件，不修改任何现有 util。

---

## 11. 验收标准

- [ ] `pnpm build:desktop` 成功产出不含登录页的构建产物。
- [ ] Desktop 模式下打开应用直接进入主界面。
- [ ] AssistantSwitcher 在全局 header 中显示当前助手名称和头像。
- [ ] 点击 AssistantSwitcher 可切换助手。
- [ ] 切换后 Chat 会话列表刷新为新助手的数据。
- [ ] ServiceStatusBar 正确显示各服务状态。
- [ ] Chat 页面在 Mock 配置下显示警告提示。
- [ ] 文件夹选择对话框可通过前端触发。
- [ ] Cloud 模式构建（`pnpm build`）回归测试通过。
- [ ] API 请求在 Desktop 模式下不携带 Authorization header。

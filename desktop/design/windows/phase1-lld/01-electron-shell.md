# LLD-01: Electron Shell & Data Directory

## 1. 模块概述

### 1.1 目标

建立 Desktop Mode 的 Electron 工程骨架，包括：

- Electron Main Process 启动和窗口管理。
- 自定义协议 `lazymind://` 注册，用于加载前端 SPA。
- 本地数据目录初始化和管理。
- Preload 脚本和 IPC 通道白名单。
- 开发模式和生产模式切换。
- 启动画面（Splash）和主窗口生命周期。

### 1.2 范围

**包含：**
- Electron 工程目录结构。
- `main.ts`（主进程入口）。
- `preload.ts`（预加载脚本）。
- 自定义协议注册和静态资源服务。
- BrowserWindow 创建和安全配置。
- 数据目录结构初始化。
- IPC 通道注册机制。
- 应用生命周期管理（启动、关闭、托盘）。

**不包含：**
- 子进程管理（见 LLD-02）。
- 路由代理逻辑（见 LLD-03）。
- 认证和身份逻辑（见 LLD-04）。
- 日志采集和诊断导出的具体实现（见 LLD-08）。

---

## 2. 接口契约

本模块向其他模块暴露以下接口：

### 2.1 DataDir API

```typescript
// desktop/src/main/data-dir.ts
export interface DataDirPaths {
  root: string;          // %APPDATA%\LazyMind
  config: string;        // root/config.yaml
  data: string;          // root/data/
  vector: string;        // root/vector/milvus-lite/
  segment: string;       // root/segment/
  uploads: string;       // root/uploads/
  scanned: string;       // root/scanned/
  cache: string;         // root/cache/
  logs: string;          // root/logs/
  diagnostics: string;   // root/logs/diagnostics/
  crash: string;         // root/logs/crash/
  backups: string;       // root/backups/
  defaultDocs: string;   // root/default-docs/
}

export function getDataDir(): DataDirPaths;
export function ensureDataDir(): Promise<void>;
```

### 2.2 IPC Channel Registry

```typescript
// desktop/src/main/ipc/registry.ts
export const IPC_CHANNELS = {
  // 数据目录
  'datadir:get': 'datadir:get',

  // 文件操作
  'dialog:pickFolder': 'dialog:pickFolder',
  'shell:openPath': 'shell:openPath',

  // 诊断
  'diagnostics:export': 'diagnostics:export',
  'diagnostics:openLogDir': 'diagnostics:openLogDir',

  // 服务状态
  'service:getStatus': 'service:getStatus',
  'service:getAllStatus': 'service:getAllStatus',

  // 助手身份
  'assistant:getCurrent': 'assistant:getCurrent',
  'assistant:setCurrent': 'assistant:setCurrent',
  'assistant:getList': 'assistant:getList',

  // 应用
  'app:getVersion': 'app:getVersion',
  'app:isPackaged': 'app:isPackaged',
  'app:getMode': 'app:getMode',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
```

### 2.3 Preload API（暴露给 Renderer）

```typescript
// desktop/src/preload/api.d.ts
export interface LazyMindDesktopAPI {
  // 数据目录
  getDataDir(): Promise<DataDirPaths>;

  // 文件操作
  pickFolder(options?: { title?: string }): Promise<string | null>;
  openPath(path: string): Promise<void>;

  // 诊断
  exportDiagnostics(): Promise<string>;
  openLogDir(): Promise<void>;

  // 服务状态
  getServiceStatus(name: string): Promise<ServiceStatus>;
  getAllServiceStatus(): Promise<Record<string, ServiceStatus>>;
  onServiceStatusChange(callback: (statuses: Record<string, ServiceStatus>) => void): () => void;

  // 助手
  getCurrentAssistant(): Promise<AssistantInfo | null>;
  setCurrentAssistant(id: string): Promise<void>;
  getAssistantList(): Promise<AssistantInfo[]>;
  onAssistantChange(callback: (assistant: AssistantInfo) => void): () => void;

  // 应用信息
  getVersion(): Promise<string>;
  isPackaged(): Promise<boolean>;
  getMode(): Promise<'desktop' | 'cloud'>;

  // 平台
  platform: 'win32' | 'darwin' | 'linux';
}

// 在 Renderer 中通过 window.lazymind 访问
declare global {
  interface Window {
    lazymind: LazyMindDesktopAPI;
  }
}
```

### 2.4 ServiceStatus 类型

```typescript
export type ServiceState = 'pending' | 'starting' | 'healthy' | 'stopping' | 'stopped' | 'failed';

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  port?: number;
  pid?: number;
  error?: string;
  startedAt?: number;
  healthCheckedAt?: number;
}
```

---

## 3. 依赖关系

本模块是基础模块，不依赖其他 LLD 模块。

其他模块对本模块的依赖：
- LLD-02：使用 `DataDirPaths` 确定日志和数据路径。
- LLD-03：使用 IPC 机制与 Renderer 通信。
- LLD-05：使用 `DataDirPaths.data` 确定 SQLite 文件位置。
- LLD-07：使用 Preload API 与 Electron 通信。
- LLD-08：使用 `DataDirPaths.logs` 确定日志存储位置。

---

## 4. 技术设计

### 4.1 工程目录结构

```
desktop/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts              # 主进程入口
│   │   ├── window.ts             # 窗口管理
│   │   ├── protocol.ts           # 自定义协议注册
│   │   ├── data-dir.ts           # 数据目录管理
│   │   ├── lifecycle.ts          # 应用生命周期
│   │   ├── tray.ts               # 系统托盘
│   │   ├── ipc/
│   │   │   ├── registry.ts       # IPC 通道注册
│   │   │   ├── handlers.ts       # IPC handler 汇总
│   │   │   ├── dialog.ts         # 文件对话框 handler
│   │   │   ├── diagnostics.ts    # 诊断 handler
│   │   │   ├── assistant.ts      # 助手身份 handler
│   │   │   └── app-info.ts       # 应用信息 handler
│   │   ├── process-manager/      # (LLD-02 实现)
│   │   ├── proxy/                # (LLD-03 实现)
│   │   └── logger/               # (LLD-08 实现)
│   ├── preload/
│   │   ├── index.ts              # preload 入口
│   │   └── api.ts                # contextBridge 暴露的 API
│   └── shared/
│       ├── types.ts              # 共享类型定义
│       ├── constants.ts          # 常量
│       └── config.ts             # 配置 schema
├── resources/
│   ├── icons/                    # 应用图标
│   ├── splash.html               # 启动画面
│   └── default-docs/             # 默认太阳系知识文档
└── dev/
    └── electron.env.development  # 开发环境配置
```

### 4.2 主进程入口

```typescript
// desktop/src/main/index.ts
import { app, BrowserWindow } from 'electron';
import { registerProtocol } from './protocol';
import { createMainWindow, createSplashWindow } from './window';
import { ensureDataDir } from './data-dir';
import { registerAllIPCHandlers } from './ipc/handlers';
import { initLifecycle } from './lifecycle';

app.whenReady().then(async () => {
  // 1. 注册自定义协议
  registerProtocol();

  // 2. 初始化数据目录
  await ensureDataDir();

  // 3. 注册 IPC handlers
  registerAllIPCHandlers();

  // 4. 显示 Splash 窗口
  const splash = createSplashWindow();

  // 5. 启动本地服务 (LLD-02)
  // await processManager.startAll();

  // 6. 创建主窗口
  const mainWindow = createMainWindow();
  mainWindow.once('ready-to-show', () => {
    splash.close();
    mainWindow.show();
  });

  // 7. 初始化应用生命周期
  initLifecycle(mainWindow);
});
```

### 4.3 自定义协议

```typescript
// desktop/src/main/protocol.ts
import { app, protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PROTOCOL_SCHEME = 'lazymind';
const RENDERER_DIR = path.join(__dirname, '../renderer');

// 必须在 app.whenReady() 之前注册 scheme
protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

export function registerProtocol(): void {
  protocol.handle(PROTOCOL_SCHEME, (request) => {
    const url = new URL(request.url);
    let filePath = url.pathname;

    // 去掉开头斜杠（Windows 路径）
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    // 默认 fallback 到 index.html（SPA history 路由支持）
    const resolvedPath = path.join(RENDERER_DIR, filePath);
    const fileUrl = pathToFileURL(resolvedPath).href;

    return net.fetch(fileUrl).catch(() => {
      // fallback to index.html for SPA routing
      const indexPath = pathToFileURL(path.join(RENDERER_DIR, 'index.html')).href;
      return net.fetch(indexPath);
    });
  });
}

export function getRendererURL(route: string = '/'): string {
  if (!app.isPackaged) {
    // 开发模式：使用 Vite dev server
    const devPort = process.env.VITE_DEV_PORT || '5173';
    return `http://localhost:${devPort}${route}`;
  }
  return `${PROTOCOL_SCHEME}://app${route}`;
}
```

### 4.4 BrowserWindow 配置

```typescript
// desktop/src/main/window.ts
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { getRendererURL } from './protocol';

const PRELOAD_PATH = path.join(__dirname, '../preload/index.js');

export function createMainWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'LazyMind',
    icon: path.join(__dirname, '../../resources/icons/icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    },
  });

  // 限制导航
  win.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'lazymind:' && parsed.origin !== `http://localhost:${process.env.VITE_DEV_PORT || '5173'}`) {
      event.preventDefault();
    }
  });

  // 禁止打开新窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadURL(getRendererURL());
  return win;
}

export function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  splash.loadFile(path.join(__dirname, '../../resources/splash.html'));
  splash.show();
  return splash;
}
```

### 4.5 数据目录管理

```typescript
// desktop/src/main/data-dir.ts
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface DataDirPaths {
  root: string;
  config: string;
  data: string;
  vector: string;
  segment: string;
  uploads: string;
  scanned: string;
  cache: string;
  logs: string;
  diagnostics: string;
  crash: string;
  backups: string;
  defaultDocs: string;
}

let cachedPaths: DataDirPaths | null = null;

export function getDataDir(): DataDirPaths {
  if (cachedPaths) return cachedPaths;

  const root = path.join(app.getPath('appData'), 'LazyMind');

  cachedPaths = {
    root,
    config: path.join(root, 'config.yaml'),
    data: path.join(root, 'data'),
    vector: path.join(root, 'vector', 'milvus-lite'),
    segment: path.join(root, 'segment'),
    uploads: path.join(root, 'uploads'),
    scanned: path.join(root, 'scanned'),
    cache: path.join(root, 'cache'),
    logs: path.join(root, 'logs'),
    diagnostics: path.join(root, 'logs', 'diagnostics'),
    crash: path.join(root, 'logs', 'crash'),
    backups: path.join(root, 'backups'),
    defaultDocs: path.join(root, 'default-docs'),
  };

  return cachedPaths;
}

export async function ensureDataDir(): Promise<void> {
  const paths = getDataDir();
  const dirs = [
    paths.root,
    paths.data,
    paths.vector,
    paths.segment,
    paths.uploads,
    paths.scanned,
    paths.cache,
    paths.logs,
    paths.diagnostics,
    paths.crash,
    paths.backups,
    paths.defaultDocs,
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  // 首次启动：复制默认文档
  await copyDefaultDocs(paths.defaultDocs);

  // 首次启动：生成默认配置
  await ensureDefaultConfig(paths.config);
}

async function copyDefaultDocs(targetDir: string): Promise<void> {
  const markerFile = path.join(targetDir, '.initialized');
  try {
    await fs.access(markerFile);
    return; // 已初始化
  } catch {
    // 未初始化，复制默认文档
  }

  const sourceDir = app.isPackaged
    ? path.join(process.resourcesPath, 'default-docs')
    : path.join(__dirname, '../../resources/default-docs');

  const files = await fs.readdir(sourceDir);
  for (const file of files) {
    await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }

  await fs.writeFile(markerFile, new Date().toISOString());
}

async function ensureDefaultConfig(configPath: string): Promise<void> {
  try {
    await fs.access(configPath);
  } catch {
    const templatePath = app.isPackaged
      ? path.join(process.resourcesPath, 'templates', 'default_config.yaml')
      : path.join(__dirname, '../../resources/templates/default_config.yaml');
    await fs.copyFile(templatePath, configPath);
  }
}
```

### 4.6 Preload 脚本

```typescript
// desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { LazyMindDesktopAPI } from './api';

const api: LazyMindDesktopAPI = {
  getDataDir: () => ipcRenderer.invoke('datadir:get'),

  pickFolder: (options) => ipcRenderer.invoke('dialog:pickFolder', options),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),

  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  openLogDir: () => ipcRenderer.invoke('diagnostics:openLogDir'),

  getServiceStatus: (name) => ipcRenderer.invoke('service:getStatus', name),
  getAllServiceStatus: () => ipcRenderer.invoke('service:getAllStatus'),
  onServiceStatusChange: (callback) => {
    const handler = (_: any, statuses: any) => callback(statuses);
    ipcRenderer.on('service:status-changed', handler);
    return () => ipcRenderer.removeListener('service:status-changed', handler);
  },

  getCurrentAssistant: () => ipcRenderer.invoke('assistant:getCurrent'),
  setCurrentAssistant: (id) => ipcRenderer.invoke('assistant:setCurrent', id),
  getAssistantList: () => ipcRenderer.invoke('assistant:getList'),
  onAssistantChange: (callback) => {
    const handler = (_: any, assistant: any) => callback(assistant);
    ipcRenderer.on('assistant:changed', handler);
    return () => ipcRenderer.removeListener('assistant:changed', handler);
  },

  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  getMode: () => ipcRenderer.invoke('app:getMode'),

  platform: process.platform as 'win32' | 'darwin' | 'linux',
};

contextBridge.exposeInMainWorld('lazymind', api);
```

### 4.7 IPC Handler 示例

```typescript
// desktop/src/main/ipc/dialog.ts
import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDataDir } from '../data-dir';

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:pickFolder', async (event, options?: { title?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      title: options?.title || '选择文件夹',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('shell:openPath', async (event, targetPath: string) => {
    // 安全校验：只允许打开数据目录下的路径或用户明确选择的路径
    const dataDir = getDataDir();
    const resolved = path.resolve(targetPath);
    const allowedPrefixes = [dataDir.root, dataDir.logs];

    const isAllowed = allowedPrefixes.some((prefix) =>
      resolved.startsWith(path.resolve(prefix))
    );

    if (!isAllowed) {
      throw new Error('Access denied: path is outside allowed directories');
    }

    await shell.openPath(resolved);
  });
}
```

### 4.8 应用生命周期

```typescript
// desktop/src/main/lifecycle.ts
import { app, BrowserWindow } from 'electron';

export function initLifecycle(mainWindow: BrowserWindow): void {
  // Windows：关闭窗口 = 退出应用
  mainWindow.on('close', () => {
    // 通知 ProcessManager 清理子进程 (LLD-02)
    app.quit();
  });

  app.on('before-quit', async () => {
    // ProcessManager.stopAll() 在此调用 (LLD-02)
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // 防止多实例
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
  }
}
```

### 4.9 开发模式 vs 生产模式

| 特性 | 开发模式 | 生产模式 |
|------|----------|----------|
| 前端加载 | `http://localhost:5173` (Vite dev server) | `lazymind://app/` (自定义协议) |
| 后端二进制 | 本地编译产物或开发服务 | `resources/bin/` 下的打包产物 |
| 数据目录 | 相同 (`%APPDATA%\LazyMind`) | 相同 |
| DevTools | 自动打开 | 不打开 |
| 资源路径 | `desktop/resources/` | `process.resourcesPath` |

判断方式：
```typescript
const isDev = !app.isPackaged;
```

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `desktop/package.json` | Electron 工程包配置 |
| `desktop/tsconfig.json` | TypeScript 配置 |
| `desktop/tsconfig.node.json` | Node.js 环境 TS 配置 |
| `desktop/electron-builder.yml` | 打包配置 |
| `desktop/src/main/index.ts` | 主进程入口 |
| `desktop/src/main/window.ts` | 窗口管理 |
| `desktop/src/main/protocol.ts` | 自定义协议 |
| `desktop/src/main/data-dir.ts` | 数据目录管理 |
| `desktop/src/main/lifecycle.ts` | 应用生命周期 |
| `desktop/src/main/tray.ts` | 系统托盘（可选） |
| `desktop/src/main/ipc/registry.ts` | IPC 通道注册 |
| `desktop/src/main/ipc/handlers.ts` | IPC handler 汇总 |
| `desktop/src/main/ipc/dialog.ts` | 文件对话框 |
| `desktop/src/main/ipc/app-info.ts` | 应用信息 |
| `desktop/src/preload/index.ts` | Preload 入口 |
| `desktop/src/preload/api.ts` | API 类型和实现 |
| `desktop/src/shared/types.ts` | 共享类型 |
| `desktop/src/shared/constants.ts` | 共享常量 |
| `desktop/resources/splash.html` | 启动画面 |
| `desktop/resources/icons/icon.png` | 应用图标 |
| `desktop/resources/icons/icon.ico` | Windows 图标 |
| `desktop/resources/default-docs/solar-system.md` | 默认太阳系文档 |
| `desktop/resources/templates/default_config.yaml` | 默认配置模板 |

### 5.2 修改文件

无。本模块不修改现有代码。

---

## 6. 配置与环境变量

### 6.1 Electron 构建配置

```yaml
# desktop/electron-builder.yml
appId: com.lazymind.desktop
productName: LazyMind
directories:
  output: dist-electron
  buildResources: resources
files:
  - src/main/**/*.js
  - src/preload/**/*.js
extraResources:
  - from: resources/default-docs
    to: default-docs
  - from: resources/templates
    to: templates
  - from: ../frontend/dist
    to: renderer
win:
  target: nsis
  icon: resources/icons/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
```

### 6.2 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `VITE_DEV_PORT` | 开发模式 Vite dev server 端口 | `5173` |
| `LAZYMIND_DATA_DIR` | 覆盖默认数据目录（调试用） | `%APPDATA%\LazyMind` |
| `LAZYMIND_LOG_LEVEL` | 日志级别 | `info` |

### 6.3 默认配置模板

```yaml
# resources/templates/default_config.yaml
app:
  mode: desktop
  version: "0.1.0"

proxy:
  port: 5023

services:
  core:
    port: 8001
  auth:
    port: 8002
  chat:
    port: 8046
  scan:
    port: 18080
  fileWatcher:
    port: 18081

model:
  provider: mock
  # 用户后续配置真实 API key
```

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 数据目录创建失败（权限不足） | 弹出系统对话框提示用户，退出应用 |
| 自定义协议注册失败 | 记录日志，fallback 到 file:// 加载（仅调试） |
| 多实例启动 | 聚焦已有窗口，新实例退出 |
| Renderer 导航到外部 URL | 阻止导航，保持当前页面 |
| 前端资源文件缺失 | 显示内置错误页面，引导用户重新安装 |

---

## 8. 安全考量

### 8.1 BrowserWindow 安全默认

- `nodeIntegration: false` — Renderer 无 Node.js 能力。
- `contextIsolation: true` — Preload 和 Renderer 在隔离上下文中运行。
- `sandbox: true` — Renderer 进程沙箱化。
- `webSecurity: true` — 不禁用同源策略。
- `allowRunningInsecureContent: false` — 不加载 HTTP 内容。
- `navigateOnDragDrop: false` — 拖放文件不触发导航。

### 8.2 CSP 策略

自定义协议响应头中注入：

```
Content-Security-Policy: default-src 'self' lazymind:; script-src 'self' lazymind:; style-src 'self' lazymind: 'unsafe-inline'; connect-src lazymind: http://127.0.0.1:* https:; img-src 'self' lazymind: data: blob:; font-src 'self' lazymind: data:;
```

- `connect-src` 允许连接 `127.0.0.1`（本地代理）和 `https:`（线上 API）。
- 不允许 `eval` 和内联脚本。
- 不允许加载外部脚本。

### 8.3 IPC 安全

- 不暴露原始 `ipcRenderer`。
- 每个 IPC handler 校验 `event.sender` 来源。
- 文件路径参数必须经过 `path.resolve` 规范化后校验范围。
- 不提供通用 `executeCommand`、`readFile`、`writeFile` 接口。

### 8.4 导航限制

- `will-navigate` 事件中只允许 `lazymind:` 协议和开发模式的 localhost。
- 禁止打开新窗口。
- 外部链接通过 `shell.openExternal` 在系统浏览器中打开（需用户确认）。

---

## 9. 测试策略

### 9.1 单元测试

- `data-dir.ts`：测试路径生成和目录创建。
- `protocol.ts`：测试 URL 解析和 fallback 逻辑。
- IPC handlers：测试参数校验和路径安全检查。

### 9.2 集成测试

- 使用 `@electron/test` 或 Playwright 验证：
  - 应用启动并显示主窗口。
  - 自定义协议能加载前端页面。
  - IPC 通道双向通信正常。
  - 单实例锁定生效。

### 9.3 手动验证

- Windows 10/11 环境启动验证。
- 中文路径用户名环境验证。
- 开发模式和生产模式分别验证。

---

## 10. Cloud 模式兼容

本模块完全独立于现有代码。`desktop/` 目录是新增目录，不修改任何现有文件。

前端构建产物通过 `frontend/dist` 路径引用，Desktop 构建流程为：
1. `cd frontend && pnpm build` 生成 `dist/`。
2. `cd desktop && npm run build` 构建 Electron。
3. Electron 加载 `frontend/dist` 作为 Renderer 资源。

Cloud 模式继续使用 Docker + Nginx 服务前端，不受影响。

---

## 11. 验收标准

- [ ] `desktop/` 目录结构建立完成。
- [ ] `npm run dev` 可启动 Electron 开发模式，加载前端 Vite dev server。
- [ ] 生产构建后，自定义协议 `lazymind://` 可加载前端 SPA。
- [ ] SPA 路由（history mode）在自定义协议下正常工作。
- [ ] 数据目录 `%APPDATA%\LazyMind` 在首次启动时自动创建。
- [ ] 默认太阳系文档在首次启动时复制到数据目录。
- [ ] 多实例启动时聚焦已有窗口。
- [ ] IPC 通道 `dialog:pickFolder` 可打开文件夹选择对话框。
- [ ] BrowserWindow 安全配置符合要求（DevTools 中验证 CSP、nodeIntegration 等）。
- [ ] 关闭主窗口时应用退出。

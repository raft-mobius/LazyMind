# LLD-08: Logging, Diagnostics & Security Baseline

## 1. 模块概述

### 1.1 目标

建立 Desktop Mode 的日志采集、诊断导出和安全基线：

- 统一日志采集和存储。
- 日志轮转和大小限制。
- 诊断包导出（一键收集日志、配置摘要、系统信息）。
- 日志和诊断包脱敏规则。
- Electron 安全配置基线。
- IPC 安全校验。
- 本地 API 安全边界。
- 子进程安全启动。

### 1.2 范围

**包含：**
- 日志采集器（Electron Main Process 收集子进程日志）。
- 日志文件管理（路径、轮转、大小上限）。
- 诊断包生成和导出。
- 脱敏规则定义和实现。
- Electron BrowserWindow 安全配置清单。
- CSP 策略定义。
- IPC handler 安全校验模式。
- 本地端口绑定安全。
- 子进程启动安全。
- Secret 管理策略。

**不包含：**
- 具体 IPC handler 的业务实现（见各模块 LLD）。
- OpenTelemetry 接入（后续阶段）。
- 安装包签名（第三阶段）。
- 算法/RAG 安全专题。

---

## 2. 接口契约

### 2.1 Logger API

```typescript
// desktop/src/main/logger/index.ts

export interface LoggerConfig {
  logDir: string;
  maxFileSize: number;      // 单文件大小上限（bytes），默认 10MB
  maxFiles: number;          // 每个服务保留文件数，默认 5
  level: 'debug' | 'info' | 'warn' | 'error';
}

export interface Logger {
  info(source: string, message: string, meta?: Record<string, unknown>): void;
  warn(source: string, message: string, meta?: Record<string, unknown>): void;
  error(source: string, message: string, meta?: Record<string, unknown>): void;
  debug(source: string, message: string, meta?: Record<string, unknown>): void;

  // 为子进程创建日志流
  createProcessStream(serviceName: string): {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  };

  getLogPath(serviceName: string): string;
  close(): void;
}

export function createLogger(config: LoggerConfig): Logger;
```

### 2.2 Diagnostics API

```typescript
// desktop/src/main/diagnostics/index.ts

export interface DiagnosticsInfo {
  timestamp: string;
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  memoryUsage: { total: number; free: number; appUsed: number };
  diskSpace: { total: number; free: number; dataDir: number };
  services: Record<string, ServiceDiagInfo>;
  config: SanitizedConfig;
}

export interface ServiceDiagInfo {
  name: string;
  state: string;
  pid?: number;
  port?: number;
  memoryMB?: number;
  startedAt?: string;
  lastHealthCheck?: string;
  error?: string;
}

export interface DiagnosticsExporter {
  export(): Promise<string>;  // 返回导出的 zip 文件路径
  getInfo(): Promise<DiagnosticsInfo>;
}

export function createDiagnosticsExporter(): DiagnosticsExporter;
```

### 2.3 Sanitizer API

```typescript
// desktop/src/main/logger/sanitizer.ts

export interface SanitizeRule {
  pattern: RegExp;
  replacement: string;
}

export function sanitize(text: string, rules?: SanitizeRule[]): string;
export function getSanitizedConfig(configPath: string): Promise<SanitizedConfig>;
```

### 2.4 Security Config Constants

```typescript
// desktop/src/main/security/config.ts

export const SECURITY_CONFIG = {
  // BrowserWindow 安全默认
  browserWindow: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,
  },

  // CSP 策略
  csp: "default-src 'self' lazymind:; script-src 'self' lazymind:; style-src 'self' lazymind: 'unsafe-inline'; connect-src lazymind: http://127.0.0.1:* https:; img-src 'self' lazymind: data: blob:; font-src 'self' lazymind: data:;",

  // 允许的 IPC channels
  allowedChannels: [
    'datadir:get',
    'dialog:pickFolder',
    'shell:openPath',
    'diagnostics:export',
    'diagnostics:openLogDir',
    'service:getStatus',
    'service:getAllStatus',
    'assistant:getCurrent',
    'assistant:setCurrent',
    'assistant:getList',
    'app:getVersion',
    'app:isPackaged',
    'app:getMode',
  ],

  // 本地服务绑定
  localBind: '127.0.0.1',

  // 允许的 CORS origin
  allowedOrigins: ['lazymind://app', 'http://localhost:5173'],
} as const;
```

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-01**：Electron BrowserWindow 配置、DataDir 路径、IPC 机制。
- **LLD-02**：子进程 stdout/stderr 流接入。

### 3.2 被依赖

- **LLD-02**：ProcessManager 使用 Logger 的 `createProcessStream` 采集子进程日志。
- **LLD-01**：IPC handler 使用安全校验工具。
- **LLD-03**：Local Proxy 使用脱敏规则记录请求日志。

---

## 4. 技术设计

### 4.1 日志采集架构

```
子进程 stdout/stderr
    │
    ▼
Logger.createProcessStream(name)
    │
    ├─ 逐行读取
    ├─ 添加时间戳和来源标记
    ├─ 脱敏处理
    └─ 写入文件: logs/{name}.log

Electron Main Process 自身日志
    │
    ├─ Logger.info/warn/error/debug
    ├─ 脱敏处理
    └─ 写入文件: logs/electron-main.log

Local Proxy 请求日志
    │
    ├─ Logger.info('proxy', ...)
    ├─ 脱敏处理
    └─ 写入文件: logs/proxy.log
```

### 4.2 日志格式

```
[2024-03-15T10:30:45.123+08:00] [INFO] [core] Server started on port 8001
[2024-03-15T10:30:45.456+08:00] [ERROR] [auth-service] Database connection failed: ...
[2024-03-15T10:30:46.789+08:00] [INFO] [proxy] POST /api/core/chat/stream 200 1523ms
```

格式：`[ISO时间戳] [级别] [来源] 消息`

### 4.3 日志轮转

```typescript
// desktop/src/main/logger/file-writer.ts

import fs from 'node:fs';
import path from 'node:path';

export class RotatingFileWriter {
  private stream: fs.WriteStream | null = null;
  private currentSize = 0;
  private fileIndex = 0;

  constructor(
    private basePath: string,
    private maxSize: number,     // 10MB
    private maxFiles: number,    // 5
  ) {}

  write(line: string): void {
    if (!this.stream || this.currentSize >= this.maxSize) {
      this.rotate();
    }
    const data = line + '\n';
    this.stream!.write(data);
    this.currentSize += Buffer.byteLength(data);
  }

  private rotate(): void {
    if (this.stream) {
      this.stream.end();
    }

    // 移除最旧的文件
    const oldest = `${this.basePath}.${this.maxFiles}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // 重命名: .4 → .5, .3 → .4, ...
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = i === 1 ? this.basePath : `${this.basePath}.${i}`;
      const to = `${this.basePath}.${i + 1}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, to);
      }
    }

    this.stream = fs.createWriteStream(this.basePath, { flags: 'a' });
    this.currentSize = 0;
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
```

### 4.4 脱敏规则

```typescript
// desktop/src/main/logger/sanitizer.ts

const DEFAULT_SANITIZE_RULES: SanitizeRule[] = [
  // API Key 模式
  { pattern: /(sk-[a-zA-Z0-9]{20,})/g, replacement: 'sk-***REDACTED***' },
  { pattern: /(api[_-]?key|apikey|api_secret)[=:]\s*["']?([^"'\s,;]+)/gi, replacement: '$1=***REDACTED***' },

  // Token / Secret
  { pattern: /(token|secret|password|passwd|credential)[=:]\s*["']?([^"'\s,;]{8,})/gi, replacement: '$1=***REDACTED***' },
  { pattern: /(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/g, replacement: '$1***REDACTED***' },

  // Desktop Secret
  { pattern: /(X-Desktop-Secret[=:]\s*)([a-f0-9]{16,})/gi, replacement: '$1***REDACTED***' },

  // 数据库 URL 中的密码
  { pattern: /(postgres|mysql|sqlite):\/\/[^:]+:([^@]+)@/g, replacement: '$1://***:***@' },

  // Redis URL 中的密码
  { pattern: /(redis:\/\/)([^@]+)@/g, replacement: '$1***@' },

  // 模型 API Key（DashScope, OpenAI 等）
  { pattern: /(DASHSCOPE_API_KEY|OPENAI_API_KEY|QWEN_API_KEY)[=:]\s*["']?([^"'\s,;]+)/gi, replacement: '$1=***REDACTED***' },
];

export function sanitize(text: string, rules: SanitizeRule[] = DEFAULT_SANITIZE_RULES): string {
  let result = text;
  for (const rule of rules) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
```

### 4.5 诊断包生成

```typescript
// desktop/src/main/diagnostics/exporter.ts

import { createWriteStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { getDataDir } from '../data-dir';
import { sanitize, getSanitizedConfig } from '../logger/sanitizer';

export async function exportDiagnostics(): Promise<string> {
  const dataDir = getDataDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(dataDir.diagnostics, `lazymind-diag-${timestamp}.zip`);

  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(output);

  // 1. 系统信息
  const sysInfo = await collectSystemInfo();
  archive.append(JSON.stringify(sysInfo, null, 2), { name: 'system-info.json' });

  // 2. 配置摘要（脱敏）
  const config = await getSanitizedConfig(dataDir.config);
  archive.append(JSON.stringify(config, null, 2), { name: 'config-summary.json' });

  // 3. 服务状态
  const serviceStatus = await collectServiceStatus();
  archive.append(JSON.stringify(serviceStatus, null, 2), { name: 'service-status.json' });

  // 4. 最近日志（每个文件最后 1000 行，脱敏）
  const logFiles = await readdir(dataDir.logs);
  for (const file of logFiles) {
    if (!file.endsWith('.log')) continue;
    const logPath = path.join(dataDir.logs, file);
    const content = await readTail(logPath, 1000);
    const sanitized = sanitize(content);
    archive.append(sanitized, { name: `logs/${file}` });
  }

  // 5. 崩溃文件
  try {
    const crashFiles = await readdir(dataDir.crash);
    for (const file of crashFiles.slice(-10)) {
      const crashPath = path.join(dataDir.crash, file);
      const content = await readFile(crashPath, 'utf-8');
      archive.append(sanitize(content), { name: `crash/${file}` });
    }
  } catch { /* no crash files */ }

  await archive.finalize();
  await new Promise((resolve) => output.on('close', resolve));

  return outputPath;
}

async function collectSystemInfo() {
  const os = require('node:os');
  return {
    timestamp: new Date().toISOString(),
    app: {
      version: require('electron').app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    os: {
      platform: process.platform,
      arch: process.arch,
      version: os.release(),
      hostname: os.hostname(),
    },
    memory: {
      totalMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMB: Math.round(os.freemem() / 1024 / 1024),
    },
    uptime: os.uptime(),
  };
}
```

### 4.6 诊断包内容

| 文件 | 内容 | 脱敏 |
|------|------|------|
| `system-info.json` | OS、版本、内存、磁盘 | 不含敏感信息 |
| `config-summary.json` | 配置文件摘要 | API key、password 全部替换 |
| `service-status.json` | 各服务运行状态 | 无敏感信息 |
| `logs/*.log` | 各服务最后 1000 行日志 | 脱敏 |
| `crash/*.log` | 崩溃转储（如有） | 脱敏 |

**不包含：**
- SQLite 数据库文件。
- 用户文档内容。
- 完整配置文件（仅摘要）。
- 向量数据。
- 上传文件。

### 4.7 Electron 安全配置

#### 4.7.1 BrowserWindow 安全清单

```typescript
// 所有 BrowserWindow 创建时必须包含：
const secureDefaults = {
  webPreferences: {
    nodeIntegration: false,        // 禁止 Renderer 访问 Node.js
    contextIsolation: true,        // Preload 与 Renderer 隔离
    sandbox: true,                 // 沙箱化 Renderer
    webSecurity: true,            // 不禁用同源策略
    allowRunningInsecureContent: false,
    navigateOnDragDrop: false,    // 拖放不触发导航
    webviewTag: false,             // 禁止 webview
  },
};
```

#### 4.7.2 CSP 配置

通过自定义协议 handler 的响应头注入：

```typescript
// 在 protocol.handle 中
const cspHeader = [
  "default-src 'self' lazymind:",
  "script-src 'self' lazymind:",
  "style-src 'self' lazymind: 'unsafe-inline'",  // Ant Design 需要 inline style
  "connect-src lazymind: http://127.0.0.1:* https:",
  "img-src 'self' lazymind: data: blob:",
  "font-src 'self' lazymind: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// 设置到 response headers
response.headers.set('Content-Security-Policy', cspHeader);
```

#### 4.7.3 导航和窗口限制

```typescript
// 限制导航
win.webContents.on('will-navigate', (event, url) => {
  const allowed = ['lazymind://app', `http://localhost:${DEV_PORT}`];
  const isAllowed = allowed.some((prefix) => url.startsWith(prefix));
  if (!isAllowed) event.preventDefault();
});

// 禁止新窗口
win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

// 外部链接通过系统浏览器打开（需要 IPC）
```

### 4.8 IPC 安全校验

```typescript
// desktop/src/main/ipc/security.ts

import { ipcMain, WebContents, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDataDir } from '../data-dir';

/**
 * 安全的 IPC handler 注册
 * - 校验 sender 来源
 * - 校验参数类型
 */
export function secureHandle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    // 校验 sender 来自主窗口
    if (!isValidSender(event.sender)) {
      throw new Error('IPC call from unauthorized sender');
    }
    return handler(event, ...args);
  });
}

function isValidSender(sender: WebContents): boolean {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win) return false;
  // 只接受来自主窗口的 IPC 调用
  const url = sender.getURL();
  return url.startsWith('lazymind://') || url.startsWith('http://localhost:');
}

/**
 * 路径安全校验：规范化 + 范围检查
 */
export function validatePath(targetPath: string, allowedPrefixes: string[]): string {
  // 规范化路径（解析 .., symlink 等）
  const resolved = path.resolve(targetPath);

  // 检查是否在允许的目录范围内
  const isAllowed = allowedPrefixes.some((prefix) =>
    resolved.startsWith(path.resolve(prefix))
  );

  if (!isAllowed) {
    throw new Error(`Path ${resolved} is outside allowed directories`);
  }

  return resolved;
}

/**
 * 路径校验用的允许前缀
 */
export function getAllowedPathPrefixes(): string[] {
  const dataDir = getDataDir();
  return [dataDir.root, dataDir.logs, dataDir.diagnostics];
}
```

### 4.9 Secret 管理

MVP 阶段：

```yaml
# config.yaml 中的 secret 存储（明文，但受文件系统权限保护）
model:
  provider: dashscope
  api_key: sk-xxxxxxxxxxxxxxxxx  # 明文存储

# 脱敏规则确保此 key 不进入日志和诊断包
```

后续阶段（完整功能）将引入 Windows Credential Manager：

```typescript
// 后续实现，MVP 不要求
import keytar from 'keytar';
await keytar.setPassword('LazyMind', 'model-api-key', apiKey);
const key = await keytar.getPassword('LazyMind', 'model-api-key');
```

### 4.10 子进程安全清单

| 要求 | 实现方式 |
|------|----------|
| 不使用 shell | `spawn(exe, args, { shell: false })` |
| 参数数组化 | `args: ['--port', '8001']`，不拼接字符串 |
| 环境变量白名单 | 只传递 PATH、TEMP 等系统必需变量 + 业务变量 |
| 二进制路径固定 | 从 `resources/bin/` 解析，不接受用户输入 |
| 不以管理员运行 | 不调用 `runas`，不请求 UAC 提升 |
| Windows 隐藏窗口 | `windowsHide: true` |

### 4.11 本地端口安全

所有本地服务绑定策略：

| 服务 | 绑定地址 | 配置方式 |
|------|----------|----------|
| Local Proxy | `127.0.0.1:5023` | 代码硬编码 + 配置文件可调 |
| core | `127.0.0.1:8001` | 环境变量 `SERVER_HOST=127.0.0.1` |
| auth-service | `127.0.0.1:8002` | 启动参数 `--host 127.0.0.1` |
| scan-control-plane | `127.0.0.1:18080` | 配置文件 `host: 127.0.0.1` |
| file-watcher | `127.0.0.1:18081` | 配置文件 |
| algorithm-mock | `127.0.0.1:8046` | 启动参数 |

不允许任何服务绑定 `0.0.0.0`。

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `desktop/src/main/logger/index.ts` | Logger 入口 |
| `desktop/src/main/logger/file-writer.ts` | 轮转文件写入器 |
| `desktop/src/main/logger/sanitizer.ts` | 脱敏规则和实现 |
| `desktop/src/main/diagnostics/index.ts` | 诊断导出入口 |
| `desktop/src/main/diagnostics/exporter.ts` | 诊断包生成 |
| `desktop/src/main/diagnostics/collectors.ts` | 信息采集器 |
| `desktop/src/main/security/config.ts` | 安全配置常量 |
| `desktop/src/main/ipc/security.ts` | IPC 安全校验工具 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `desktop/src/main/window.ts` | 使用安全默认配置创建 BrowserWindow |
| `desktop/src/main/protocol.ts` | 注入 CSP header |
| `desktop/src/main/ipc/handlers.ts` | 使用 `secureHandle` 注册所有 handler |
| `desktop/package.json` | 添加 `archiver` 依赖 |

---

## 6. 配置与环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LAZYMIND_LOG_LEVEL` | 日志级别 | `info` |
| `LAZYMIND_LOG_MAX_SIZE` | 单文件大小上限 | `10485760` (10MB) |
| `LAZYMIND_LOG_MAX_FILES` | 每服务保留文件数 | `5` |

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 日志目录不可写 | 回退到 console 输出，启动时提示用户 |
| 诊断包导出失败 | 返回错误信息给前端，提示手动查看日志目录 |
| 磁盘空间不足 | 日志写入失败时发出警告，不阻塞主进程 |
| 子进程崩溃 | 崩溃信息写入 crash/ 目录 |
| IPC 来源校验失败 | 拒绝请求，记录警告日志 |
| 路径校验失败 | 拒绝请求，记录安全事件 |

---

## 8. 安全考量

### 8.1 安全审计检查清单

MVP 阶段必须通过的安全检查：

- [ ] `nodeIntegration: false` 在所有 BrowserWindow 中。
- [ ] `contextIsolation: true` 在所有 BrowserWindow 中。
- [ ] `sandbox: true` 在所有 BrowserWindow 中。
- [ ] 不暴露原始 `ipcRenderer`。
- [ ] 不提供 `executeCommand`、`readFile`、`writeFile` 等泛化 IPC。
- [ ] 所有 IPC handler 校验 sender 来源。
- [ ] 文件路径参数经过 canonicalize 和范围检查。
- [ ] 本地服务只绑定 `127.0.0.1`。
- [ ] 子进程不使用 `shell: true`。
- [ ] 日志中无明文 API key/token/password。
- [ ] 诊断包中无明文 API key/token/password。
- [ ] 诊断包不包含用户文档内容。
- [ ] CSP 策略不允许 `unsafe-eval`。
- [ ] 不加载外部远程脚本作为主 UI。
- [ ] 导航被限制为 `lazymind://` 和开发 localhost。
- [ ] 新窗口创建被拒绝。

### 8.2 脱敏覆盖范围

| 来源 | 脱敏内容 |
|------|----------|
| 日志文件 | API key、token、password、secret |
| 诊断包配置摘要 | 同上 |
| 诊断包日志 | 同上 |
| 错误响应 | 不暴露内部路径、不暴露 secret |
| 前端展示 | 配置页面 key 输入框使用 password type |

---

## 9. 测试策略

### 9.1 单元测试

- 脱敏规则：各种格式的 API key、token、密码被正确替换。
- 日志轮转：文件达到大小上限后正确轮转。
- 路径校验：路径穿越（`../..`）被拒绝。
- IPC sender 校验：非法 sender 被拒绝。

### 9.2 安全测试

- Renderer 中尝试 `require('fs')` → 应失败。
- Renderer 中尝试访问 `window.lazymind` 以外的 Node API → 应无法访问。
- 从浏览器访问 `http://localhost:5023` → CORS 拒绝。
- 从外部机器访问本地端口 → 连接被拒。
- 在日志文件中搜索已配置的 API key → 应找不到明文。
- 导出诊断包后解压搜索 → 无明文 secret。

### 9.3 集成测试

- 启动所有服务 → 各服务日志文件生成 → 日志有内容。
- 日志文件达到 10MB → 自动轮转 → 旧文件重命名。
- 调用诊断导出 → zip 文件生成 → 包含预期内容。
- 子进程崩溃 → crash 日志生成 → 可在诊断包中找到。

---

## 10. Cloud 模式兼容

本模块完全新增于 `desktop/` 目录，不修改任何现有后端代码。

安全配置仅影响 Electron 运行环境，Cloud 模式（Docker + Nginx）不受影响。

脱敏规则可被后端复用（如有需要），但 MVP 阶段仅在 Electron 层应用。

---

## 11. 验收标准

- [ ] 各服务的日志文件在 `%APPDATA%\LazyMind\logs\` 下生成。
- [ ] 日志文件超过 10MB 后自动轮转。
- [ ] 日志中不含任何配置的 API key 明文。
- [ ] 诊断包 zip 可通过 IPC 一键导出。
- [ ] 诊断包包含系统信息、配置摘要（脱敏）、最近日志（脱敏）、服务状态。
- [ ] 诊断包不包含用户文档内容或 SQLite 文件。
- [ ] BrowserWindow 安全配置检查清单全部通过。
- [ ] IPC handler 拒绝非法 sender 的请求。
- [ ] `shell:openPath` 拒绝打开数据目录以外的路径。
- [ ] 所有本地服务仅监听 `127.0.0.1`（`netstat` 验证）。
- [ ] CSP 策略阻止内联脚本执行（DevTools Console 验证）。

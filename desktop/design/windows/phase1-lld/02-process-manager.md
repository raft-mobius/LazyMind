# LLD-02: Local Process Manager

## 1. 模块概述

### 1.1 目标

管理 Desktop Mode 下所有本地后端服务进程的完整生命周期：

- 启动、监控、重启和停止 Go 后端（core、scan-control-plane、file-watcher）。
- 启动、监控、重启和停止 Python 后端（auth-service、algorithm mock service）。
- 统一健康检查机制。
- 进程启动顺序和依赖管理。
- 端口分配和冲突检测。
- stdout/stderr 捕获并转发给日志系统。

### 1.2 范围

**包含：**
- 进程生命周期状态机。
- 进程启动参数、环境变量注入。
- 健康检查轮询策略。
- 启动顺序和优雅关闭顺序。
- 端口分配和占用检测。
- 子进程异常退出处理和自动重启策略。
- 进程信息事件广播给 Renderer。

**不包含：**
- 日志文件轮转和归档细节（见 LLD-08）。
- 代理路由逻辑（见 LLD-03）。
- 后端服务本身的代码修改（见 LLD-05、LLD-06）。

---

## 2. 接口契约

### 2.1 ProcessManager API

```typescript
// desktop/src/main/process-manager/index.ts

export interface ProcessConfig {
  name: string;
  executablePath: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  healthCheck: HealthCheckConfig;
  port: number;
  dependsOn?: string[];     // 依赖的服务名，必须先启动
  startupTimeout?: number;  // 启动超时（毫秒），默认 30000
  restartPolicy?: 'always' | 'on-failure' | 'never'; // 默认 'on-failure'
  maxRestarts?: number;     // 默认 3
}

export interface HealthCheckConfig {
  type: 'http' | 'tcp';
  endpoint?: string;       // HTTP 健康检查路径
  intervalMs?: number;     // 轮询间隔，默认 2000
  timeoutMs?: number;      // 单次超时，默认 5000
  retries?: number;        // 最大重试次数，默认 15
}

export type ProcessState = 'pending' | 'starting' | 'healthy' | 'stopping' | 'stopped' | 'failed';

export interface ProcessInfo {
  name: string;
  state: ProcessState;
  port: number;
  pid?: number;
  error?: string;
  startedAt?: number;
  healthCheckedAt?: number;
  restartCount: number;
  memoryUsageMB?: number;
}

export interface ProcessManager {
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  getInfo(name: string): ProcessInfo;
  getAllInfo(): Record<string, ProcessInfo>;
  onStateChange(callback: (name: string, info: ProcessInfo) => void): () => void;
}

export function createProcessManager(configs: ProcessConfig[]): ProcessManager;
```

### 2.2 事件接口

```typescript
// 通过 Electron IPC 广播给 Renderer
// Channel: 'service:status-changed'
// Payload: Record<string, ProcessInfo>

// 内部事件
export type ProcessEvent =
  | { type: 'state-change'; name: string; from: ProcessState; to: ProcessState }
  | { type: 'stdout'; name: string; data: string }
  | { type: 'stderr'; name: string; data: string }
  | { type: 'exit'; name: string; code: number | null; signal: string | null };
```

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-01**：使用 `DataDirPaths` 确定日志目录和工作目录。
- **LLD-01**：使用 IPC 机制向 Renderer 广播服务状态。

### 3.2 被依赖

- **LLD-03**：Local Proxy 需要知道各服务的端口和健康状态。
- **LLD-07**：前端需要展示服务状态。
- **LLD-08**：日志模块需要接收 stdout/stderr 输出流。

---

## 4. 技术设计

### 4.1 进程配置定义

```typescript
// desktop/src/main/process-manager/configs.ts
import path from 'node:path';
import { app } from 'electron';
import { getDataDir } from '../data-dir';
import type { ProcessConfig } from './types';

function getBinDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.resolve(__dirname, '../../../../backend');
}

export function getProcessConfigs(): ProcessConfig[] {
  const dataDir = getDataDir();
  const binDir = getBinDir();

  return [
    {
      name: 'auth-service',
      executablePath: getAuthServiceExecutable(binDir),
      args: getAuthServiceArgs(),
      env: {
        LAZYMIND_DATABASE_URL: `sqlite:///${path.join(dataDir.data, 'auth.db')}`,
        LAZYMIND_DESKTOP_MODE: 'true',
        LAZYMIND_BOOTSTRAP_ADMIN_USERNAME: 'system-admin',
        LAZYMIND_BOOTSTRAP_ADMIN_PASSWORD: 'desktop-local',
      },
      cwd: path.join(binDir, 'auth-service'),
      port: 8002,
      healthCheck: {
        type: 'http',
        endpoint: '/api/authservice/auth/health',
        intervalMs: 2000,
        timeoutMs: 5000,
        retries: 15,
      },
      dependsOn: [],
      startupTimeout: 30000,
      restartPolicy: 'on-failure',
      maxRestarts: 3,
    },
    {
      name: 'core',
      executablePath: getCoreExecutable(binDir),
      args: [],
      env: {
        ACL_DB_DRIVER: 'sqlite',
        ACL_DB_DSN: path.join(dataDir.data, 'main.db'),
        LAZYMIND_STATE_BACKEND: 'memory',
        SERVER_PORT: '8001',
      },
      cwd: path.join(binDir, 'core'),
      port: 8001,
      healthCheck: {
        type: 'http',
        endpoint: '/health',
        intervalMs: 2000,
        timeoutMs: 5000,
        retries: 15,
      },
      dependsOn: ['auth-service'],
      startupTimeout: 30000,
      restartPolicy: 'on-failure',
      maxRestarts: 3,
    },
    {
      name: 'scan-control-plane',
      executablePath: getScanExecutable(binDir),
      args: [],
      env: {
        DATABASE_DRIVER: 'sqlite',
        DATABASE_DSN: path.join(dataDir.data, 'scan.db'),
      },
      cwd: path.join(binDir, 'scan-control-plane'),
      port: 18080,
      healthCheck: {
        type: 'http',
        endpoint: '/healthz',
        intervalMs: 3000,
        timeoutMs: 5000,
        retries: 10,
      },
      dependsOn: ['core'],
      startupTimeout: 20000,
      restartPolicy: 'on-failure',
      maxRestarts: 3,
    },
    {
      name: 'file-watcher',
      executablePath: getFileWatcherExecutable(binDir),
      args: [],
      env: {},
      cwd: path.join(binDir, 'file-watcher'),
      port: 18081,
      healthCheck: {
        type: 'http',
        endpoint: '/healthz',
        intervalMs: 3000,
        timeoutMs: 5000,
        retries: 10,
      },
      dependsOn: ['scan-control-plane'],
      startupTimeout: 20000,
      restartPolicy: 'on-failure',
      maxRestarts: 3,
    },
    {
      name: 'algorithm-mock',
      executablePath: getAlgorithmMockExecutable(binDir),
      args: [],
      env: {
        LAZYMIND_DESKTOP_MODE: 'true',
      },
      cwd: path.join(binDir, 'algorithm'),
      port: 8046,
      healthCheck: {
        type: 'http',
        endpoint: '/health',
        intervalMs: 3000,
        timeoutMs: 5000,
        retries: 20,
      },
      dependsOn: [],
      startupTimeout: 60000, // Python 启动较慢
      restartPolicy: 'on-failure',
      maxRestarts: 3,
    },
  ];
}

function getCoreExecutable(binDir: string): string {
  if (app.isPackaged) return path.join(binDir, 'core.exe');
  // 开发模式：从编译产物启动
  return path.join(binDir, 'core', 'core.exe');
}

function getAuthServiceExecutable(binDir: string): string {
  if (app.isPackaged) return path.join(binDir, 'auth-service', 'auth-service.exe');
  // 开发模式：使用 Python 直接运行
  return 'python';
}

function getAuthServiceArgs(): string[] {
  if (app.isPackaged) return [];
  return ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8002'];
}

function getScanExecutable(binDir: string): string {
  if (app.isPackaged) return path.join(binDir, 'scan-control-plane.exe');
  return path.join(binDir, 'scan-control-plane', 'cmd', 'scan-control-plane.exe');
}

function getFileWatcherExecutable(binDir: string): string {
  if (app.isPackaged) return path.join(binDir, 'file-watcher.exe');
  return path.join(binDir, 'file-watcher', 'cmd', 'file-watcher.exe');
}

function getAlgorithmMockExecutable(binDir: string): string {
  if (app.isPackaged) return path.join(binDir, 'algorithm-chat', 'algorithm-chat.exe');
  return 'python';
}
```

### 4.2 进程生命周期状态机

```
          start()
pending ─────────► starting
                      │
                      │ health check passed
                      ▼
                   healthy ◄──── restart()
                      │              ▲
              stop()  │              │ auto-restart (on-failure)
                      ▼              │
                   stopping          │
                      │              │
                      ▼              │
                   stopped ──────────┘ (if restartPolicy allows)
                      
                   failed  (health check exhausted / crash without restart)
```

### 4.3 核心实现

```typescript
// desktop/src/main/process-manager/managed-process.ts
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ProcessConfig, ProcessState, ProcessInfo, ProcessEvent } from './types';

export class ManagedProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: ProcessState = 'pending';
  private restartCount = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private startedAt?: number;
  private healthCheckedAt?: number;
  private error?: string;

  constructor(private config: ProcessConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.state === 'starting' || this.state === 'healthy') return;
    this.setState('starting');
    this.error = undefined;

    // 端口占用检测
    if (await this.isPortInUse(this.config.port)) {
      this.error = `Port ${this.config.port} is already in use`;
      this.setState('failed');
      return;
    }

    this.spawnProcess();
    this.startHealthCheck();
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return;
    this.setState('stopping');
    this.stopHealthCheck();

    if (this.process && !this.process.killed) {
      // 优雅关闭：先发 SIGTERM，超时后 SIGKILL
      this.process.kill('SIGTERM');
      await this.waitForExit(5000);
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }
    }

    this.setState('stopped');
  }

  getInfo(): ProcessInfo {
    return {
      name: this.config.name,
      state: this.state,
      port: this.config.port,
      pid: this.process?.pid,
      error: this.error,
      startedAt: this.startedAt,
      healthCheckedAt: this.healthCheckedAt,
      restartCount: this.restartCount,
    };
  }

  private spawnProcess(): void {
    const env: Record<string, string> = {
      ...this.getBaseEnv(),
      ...this.config.env,
    };

    this.process = spawn(this.config.executablePath, this.config.args || [], {
      cwd: this.config.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,                    // 安全：不使用 shell
      windowsHide: true,              // Windows：隐藏控制台窗口
    });

    this.startedAt = Date.now();

    this.process.stdout?.on('data', (data: Buffer) => {
      this.emit('event', { type: 'stdout', name: this.config.name, data: data.toString() });
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('event', { type: 'stderr', name: this.config.name, data: data.toString() });
    });

    this.process.on('exit', (code, signal) => {
      this.emit('event', { type: 'exit', name: this.config.name, code, signal });
      this.handleExit(code, signal);
    });

    this.process.on('error', (err) => {
      this.error = err.message;
      this.setState('failed');
    });
  }

  private handleExit(code: number | null, signal: string | null): void {
    if (this.state === 'stopping' || this.state === 'stopped') return;

    const shouldRestart =
      this.config.restartPolicy === 'always' ||
      (this.config.restartPolicy === 'on-failure' && code !== 0);

    if (shouldRestart && this.restartCount < (this.config.maxRestarts || 3)) {
      this.restartCount++;
      const delay = Math.min(1000 * Math.pow(2, this.restartCount - 1), 10000);
      setTimeout(() => this.start(), delay);
    } else {
      this.error = `Process exited with code ${code}, signal ${signal}`;
      this.setState('failed');
    }
  }

  private startHealthCheck(): void {
    const { intervalMs = 2000, timeoutMs = 5000, retries = 15 } = this.config.healthCheck;
    let attempts = 0;

    this.healthCheckTimer = setInterval(async () => {
      const healthy = await this.checkHealth(timeoutMs);
      if (healthy) {
        this.healthCheckedAt = Date.now();
        this.setState('healthy');
        // 健康后继续检查，但间隔放长
        this.stopHealthCheck();
        this.healthCheckTimer = setInterval(async () => {
          const stillHealthy = await this.checkHealth(timeoutMs);
          if (!stillHealthy) {
            this.error = 'Health check failed after being healthy';
            this.setState('failed');
            this.stopHealthCheck();
          } else {
            this.healthCheckedAt = Date.now();
          }
        }, intervalMs * 5); // 健康后间隔 ×5
      } else {
        attempts++;
        if (attempts >= retries) {
          this.error = `Health check failed after ${retries} attempts`;
          this.setState('failed');
          this.stopHealthCheck();
        }
      }
    }, intervalMs);
  }

  private async checkHealth(timeoutMs: number): Promise<boolean> {
    if (this.config.healthCheck.type === 'http') {
      return this.httpHealthCheck(timeoutMs);
    }
    return this.tcpHealthCheck(timeoutMs);
  }

  private async httpHealthCheck(timeoutMs: number): Promise<boolean> {
    const url = `http://127.0.0.1:${this.config.port}${this.config.healthCheck.endpoint}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async tcpHealthCheck(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('node:net');
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.connect(this.config.port, '127.0.0.1');
    });
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private setState(state: ProcessState): void {
    const from = this.state;
    this.state = state;
    this.emit('event', { type: 'state-change', name: this.config.name, from, to: state });
  }

  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('node:net');
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => { server.close(); resolve(false); });
      server.listen(port, '127.0.0.1');
    });
  }

  private getBaseEnv(): Record<string, string> {
    // 白名单方式传递环境变量
    const allowed = ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME',
                     'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'COMSPEC'];
    const env: Record<string, string> = {};
    for (const key of allowed) {
      if (process.env[key]) env[key] = process.env[key]!;
    }
    return env;
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process || this.process.killed) { resolve(); return; }
      const timeout = setTimeout(resolve, timeoutMs);
      this.process.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
}
```

### 4.4 ProcessManager 实现

```typescript
// desktop/src/main/process-manager/manager.ts
import { BrowserWindow } from 'electron';
import { ManagedProcess } from './managed-process';
import type { ProcessConfig, ProcessInfo, ProcessManager } from './types';

export function createProcessManager(configs: ProcessConfig[]): ProcessManager {
  const processes = new Map<string, ManagedProcess>();
  const listeners: ((name: string, info: ProcessInfo) => void)[] = [];

  for (const config of configs) {
    const proc = new ManagedProcess(config);
    processes.set(config.name, proc);

    proc.on('event', (event) => {
      if (event.type === 'state-change') {
        const info = proc.getInfo();
        listeners.forEach((cb) => cb(event.name, info));
        broadcastToRenderer();
      }
    });
  }

  function broadcastToRenderer(): void {
    const statuses = getAllInfo();
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('service:status-changed', statuses);
    });
  }

  function getAllInfo(): Record<string, ProcessInfo> {
    const result: Record<string, ProcessInfo> = {};
    for (const [name, proc] of processes) {
      result[name] = proc.getInfo();
    }
    return result;
  }

  async function startAll(): Promise<void> {
    // 拓扑排序按依赖关系启动
    const sorted = topologicalSort(configs);
    for (const batch of sorted) {
      await Promise.all(batch.map((name) => start(name)));
    }
  }

  async function start(name: string): Promise<void> {
    const proc = processes.get(name);
    if (!proc) throw new Error(`Unknown service: ${name}`);

    // 检查依赖是否已健康
    const config = configs.find((c) => c.name === name)!;
    for (const dep of config.dependsOn || []) {
      const depProc = processes.get(dep);
      if (!depProc || depProc.getInfo().state !== 'healthy') {
        await start(dep);
        await waitForHealthy(dep, config.startupTimeout || 30000);
      }
    }

    await proc.start();
    await waitForHealthy(name, config.startupTimeout || 30000);
  }

  async function stop(name: string): Promise<void> {
    const proc = processes.get(name);
    if (proc) await proc.stop();
  }

  async function stopAll(): Promise<void> {
    // 反向顺序停止
    const sorted = topologicalSort(configs);
    const reversed = [...sorted].reverse();
    for (const batch of reversed) {
      await Promise.all(batch.map((name) => stop(name)));
    }
  }

  async function restart(name: string): Promise<void> {
    await stop(name);
    await start(name);
  }

  return { start, stop, restart, startAll, stopAll, getInfo: (name) => processes.get(name)!.getInfo(), getAllInfo, onStateChange: (cb) => { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; } };
}

function topologicalSort(configs: ProcessConfig[]): string[][] {
  // 返回分层的服务名数组，同一层可以并行启动
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const c of configs) {
    graph.set(c.name, c.dependsOn || []);
    inDegree.set(c.name, (c.dependsOn || []).length);
  }

  const result: string[][] = [];
  const remaining = new Set(configs.map((c) => c.name));

  while (remaining.size > 0) {
    const batch = [...remaining].filter((name) => inDegree.get(name) === 0);
    if (batch.length === 0) throw new Error('Circular dependency detected');
    result.push(batch);
    for (const name of batch) {
      remaining.delete(name);
      for (const [other, deps] of graph) {
        if (deps.includes(name)) {
          inDegree.set(other, (inDegree.get(other) || 0) - 1);
        }
      }
    }
  }

  return result;
}

function waitForHealthy(name: string, timeoutMs: number): Promise<void> {
  // 实际实现中轮询 ProcessInfo.state
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = setInterval(() => {
      // 在实际实现中检查进程状态
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        reject(new Error(`Service ${name} failed to become healthy within ${timeoutMs}ms`));
      }
    }, 500);
  });
}
```

### 4.5 启动顺序

根据服务依赖关系，启动分层为：

```
Layer 1 (并行): auth-service, algorithm-mock
Layer 2 (依赖 auth-service): core
Layer 3 (依赖 core): scan-control-plane
Layer 4 (依赖 scan-control-plane): file-watcher
```

关闭顺序为反向：file-watcher → scan-control-plane → core → auth-service, algorithm-mock。

### 4.6 端口分配

| 服务名 | 默认端口 | 说明 |
|--------|----------|------|
| auth-service | 8002 | Python FastAPI |
| core | 8001 | Go HTTP |
| scan-control-plane | 18080 | Go HTTP |
| file-watcher | 18081 | Go HTTP |
| algorithm-mock | 8046 | Python FastAPI |
| local-proxy | 5023 | Node.js (LLD-03) |

端口通过配置文件可调整。如果默认端口被占用，ProcessManager 会检测并报错，不自动换端口（避免前端和代理配置不一致）。

### 4.7 子进程安全

- `shell: false` — 不使用 shell 执行命令。
- `windowsHide: true` — Windows 下隐藏控制台窗口。
- 可执行文件路径从 `resources/bin/` 或受控开发目录解析，不接受用户输入。
- 环境变量使用白名单方式传递，不泄露完整 `process.env`。
- 参数使用数组形式，不拼接字符串。

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `desktop/src/main/process-manager/index.ts` | 模块入口和 exports |
| `desktop/src/main/process-manager/types.ts` | 类型定义 |
| `desktop/src/main/process-manager/managed-process.ts` | 单进程管理类 |
| `desktop/src/main/process-manager/manager.ts` | ProcessManager 实现 |
| `desktop/src/main/process-manager/configs.ts` | 各服务配置定义 |
| `desktop/src/main/process-manager/port-check.ts` | 端口检测工具 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `desktop/src/main/index.ts` | 引入并初始化 ProcessManager |
| `desktop/src/main/lifecycle.ts` | 应用关闭时调用 `stopAll()` |

---

## 6. 配置与环境变量

### 6.1 服务配置

通过 `desktop/resources/templates/default_config.yaml` 中的 `services` 段配置：

```yaml
services:
  core:
    port: 8001
    healthEndpoint: /health
    startupTimeout: 30000
    restartPolicy: on-failure
    maxRestarts: 3
  auth:
    port: 8002
    healthEndpoint: /api/authservice/auth/health
    startupTimeout: 30000
  scan:
    port: 18080
    healthEndpoint: /healthz
    startupTimeout: 20000
  fileWatcher:
    port: 18081
    healthEndpoint: /healthz
    startupTimeout: 20000
  algorithmMock:
    port: 8046
    healthEndpoint: /health
    startupTimeout: 60000
```

### 6.2 注入给后端的环境变量

| 服务 | 变量名 | 值 |
|------|--------|-----|
| core | `ACL_DB_DRIVER` | `sqlite` |
| core | `ACL_DB_DSN` | `<dataDir>/data/main.db` |
| core | `LAZYMIND_STATE_BACKEND` | `memory` |
| core | `SERVER_PORT` | `8001` |
| auth-service | `LAZYMIND_DATABASE_URL` | `sqlite:///<dataDir>/data/auth.db` |
| auth-service | `LAZYMIND_DESKTOP_MODE` | `true` |
| scan-control-plane | `DATABASE_DRIVER` | `sqlite` |
| scan-control-plane | `DATABASE_DSN` | `<dataDir>/data/scan.db` |

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 端口被占用 | 设置 `state=failed`，`error` 说明端口冲突，广播给前端 |
| 可执行文件不存在 | 设置 `state=failed`，记录路径到 error |
| 启动超时 | 设置 `state=failed`，kill 进程 |
| 进程异常退出（非正常关闭） | 按 restartPolicy 自动重启，指数退避延迟 |
| 重启次数耗尽 | 设置 `state=failed`，不再重启 |
| 依赖服务未健康 | 先启动依赖，等待依赖健康后再启动自身 |
| 健康检查持续失败（运行中） | 设置 `state=failed`，触发重启策略 |
| 关闭应用时进程未退出 | SIGTERM → 等待 5s → SIGKILL |

---

## 8. 安全考量

- 可执行文件路径硬编码或从受控配置读取，不接受用户输入。
- 不使用 `shell: true`。
- 环境变量白名单传递，不传递 `LAZYMIND_JWT_SECRET` 等生产密钥（Desktop 模式下这些密钥由 auth-service 内部处理）。
- 服务绑定 `127.0.0.1`，不绑定 `0.0.0.0`（由各服务 LLD 保证，本模块通过 env 注入 host 配置）。
- 进程 PID 和端口信息通过 IPC 暴露给 Renderer 仅用于状态展示，不暴露控制能力。

---

## 9. 测试策略

### 9.1 单元测试

- 拓扑排序算法：测试依赖关系排序、循环依赖检测。
- 端口检测：mock net.Socket 测试占用和空闲场景。
- 状态机转换：测试所有合法/非法状态转换。
- 自动重启：测试指数退避和最大重启次数。

### 9.2 集成测试

- 使用简单 HTTP server（如 `http-server`）作为 mock 后端，验证：
  - 启动和健康检查流程。
  - 异常退出后自动重启。
  - 优雅关闭流程。
  - 依赖顺序启动。

### 9.3 Smoke 测试

- 记录各服务冷启动耗时。
- 记录各服务内存占用。
- 记录健康检查首次通过耗时。
- 验证关闭应用后无残留进程（`tasklist` 验证）。

---

## 10. Cloud 模式兼容

本模块完全新增，不修改任何现有后端代码。

后端服务通过环境变量切换行为（`ACL_DB_DRIVER`、`LAZYMIND_DESKTOP_MODE` 等），这些变量在 Cloud/Docker 模式下不会被设置，因此不影响现有部署。

---

## 11. 验收标准

- [ ] ProcessManager 可成功启动 auth-service 并通过健康检查。
- [ ] ProcessManager 可成功启动 core 并通过健康检查。
- [ ] 启动顺序正确：auth-service 先于 core，core 先于 scan-control-plane。
- [ ] 关闭应用时所有子进程在 10 秒内退出。
- [ ] 子进程异常退出后可自动重启（最多 3 次）。
- [ ] 端口被占用时报告明确错误。
- [ ] 服务状态变化实时广播给 Renderer。
- [ ] stdout/stderr 输出被捕获并转发给日志系统。
- [ ] 无 shell 命令注入风险（不使用 shell: true）。
- [ ] 环境变量白名单传递，不泄露无关变量。
- [ ] `tasklist | findstr core.exe` 确认关闭后无残留。

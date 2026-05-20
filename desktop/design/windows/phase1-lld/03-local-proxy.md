# LLD-03: Local Proxy (Kong Replacement)

## 1. 模块概述

### 1.1 目标

在 Electron Main Process 中实现一个轻量级 HTTP 反向代理，替代 Desktop Mode 下 Kong Gateway 的职责：

- 统一 API 入口，前端只需请求一个端口。
- 路由转发到各本地后端服务。
- 注入当前 AI 助手身份 header。
- 处理 SSE（Server-Sent Events）流式响应。
- 处理文件上传和下载。
- 本地请求认证（防止其他程序伪造请求）。
- CORS 配置。
- 后端不可用时返回可理解的错误。

### 1.2 范围

**包含：**
- HTTP 反向代理实现。
- 路由表配置和匹配。
- 身份 header 注入。
- 本地 secret 机制（proxy → backend 认证）。
- CORS 处理。
- SSE/streaming 透传。
- 超时和错误处理。
- 请求/响应日志（脱敏）。

**不包含：**
- 后端服务进程管理（见 LLD-02）。
- 认证逻辑和用户管理（见 LLD-04）。
- 前端如何切换当前助手（见 LLD-07）。

---

## 2. 接口契约

### 2.1 ProxyServer API

```typescript
// desktop/src/main/proxy/index.ts

export interface ProxyRoute {
  prefix: string;        // URL 前缀，如 '/api/authservice'
  target: string;        // 目标地址，如 'http://127.0.0.1:8002'
  stripPrefix?: boolean; // 是否移除前缀，默认 false
  timeout?: number;      // 请求超时（ms），默认 30000
}

export interface ProxyConfig {
  port: number;                    // 代理监听端口，默认 5023
  host: string;                    // 监听地址，固定 '127.0.0.1'
  routes: ProxyRoute[];
  localSecret: string;             // 启动时随机生成
  allowedOrigins: string[];        // CORS 允许的 origin
}

export interface ProxyServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
  setCurrentAssistant(userId: string, userName: string): void;
  updateRoutes(routes: ProxyRoute[]): void;
  isRunning(): boolean;
}

export function createProxyServer(config: ProxyConfig): ProxyServer;
```

### 2.2 Identity Injection Interface

```typescript
// Local Proxy 向后端请求注入的 headers
export interface InjectedHeaders {
  'X-User-Id': string;          // 当前助手的 user_id
  'X-User-Name': string;        // 当前助手的 username
  'X-Desktop-Secret': string;   // 启动时生成的 local secret
  'X-Request-Id': string;       // 每次请求生成的唯一 ID
}
```

### 2.3 暴露给 LLD-04 的接口

```typescript
// LLD-04 通过此接口设置当前助手身份
export function setCurrentAssistant(userId: string, userName: string): void;
```

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-01**：IPC 机制（接收 Renderer 的助手切换指令）。
- **LLD-02**：获取各服务端口号和健康状态（决定路由是否可用）。

### 3.2 被依赖

- **LLD-04**：通过 `setCurrentAssistant()` 设置身份注入。
- **LLD-07**：前端通过 Local Proxy 端口发起所有 API 请求。
- **LLD-08**：请求日志记录。

---

## 4. 技术设计

### 4.1 路由表

基于现有 `kong.yml` 定义，Desktop Mode 路由表为：

| 前缀 | 目标 | strip_prefix | timeout |
|------|------|-------------|---------|
| `/api/authservice` | `http://127.0.0.1:8002` | `false` | 30s |
| `/api/core` | `http://127.0.0.1:8001` | `true` | 600s |
| `/api/chat` | `http://127.0.0.1:8046` | `false` | 600s |
| `/api/scan` | `http://127.0.0.1:18080` | `false` | 30s |
| `/api/file` | `http://127.0.0.1:18081` | `false` | 30s |

`/api/core` 的 `strip_prefix: true` 表示请求 `/api/core/chat/conversations` 转发为 `/chat/conversations`（与 Kong 行为一致）。

### 4.2 代理实现

使用 Node.js 内置 `http` 模块 + `http-proxy` 库实现：

```typescript
// desktop/src/main/proxy/server.ts
import http from 'node:http';
import httpProxy from 'http-proxy';
import { randomUUID, randomBytes } from 'node:crypto';
import type { ProxyConfig, ProxyRoute, ProxyServer } from './types';

export function createProxyServer(config: ProxyConfig): ProxyServer {
  const proxy = httpProxy.createProxyServer({
    xfwd: false,
    changeOrigin: false,
    followRedirects: false,
  });

  let currentUserId = '';
  let currentUserName = '';
  let server: http.Server | null = null;

  // 处理 SSE：不缓冲响应
  proxy.on('proxyRes', (proxyRes, req, res) => {
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/event-stream')) {
      // SSE: 禁用缓冲
      (res as any).flushHeaders?.();
    }
  });

  proxy.on('error', (err, req, res) => {
    if (!res.headersSent) {
      (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'application/json' });
      (res as http.ServerResponse).end(JSON.stringify({
        code: 502,
        message: 'Backend service unavailable',
        error: err.message,
      }));
    }
  });

  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';

    // CORS preflight
    if (req.method === 'OPTIONS') {
      handleCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    // 匹配路由
    const route = matchRoute(url, config.routes);
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 404, message: 'Route not found' }));
      return;
    }

    // 设置 CORS headers
    handleCors(req, res);

    // 注入身份 headers
    req.headers['x-user-id'] = currentUserId;
    req.headers['x-user-name'] = currentUserName;
    req.headers['x-desktop-secret'] = config.localSecret;
    req.headers['x-request-id'] = randomUUID();

    // 移除前端可能传入的认证 header（Desktop 模式由 proxy 统一注入）
    delete req.headers['authorization'];

    // 计算目标 URL
    let targetPath = url;
    if (route.stripPrefix) {
      targetPath = url.slice(route.prefix.length) || '/';
    }

    // 转发
    proxy.web(req, res, {
      target: route.target,
      timeout: route.timeout || 30000,
      proxyTimeout: route.timeout || 30000,
      headers: { host: new URL(route.target).host },
    }, (err) => {
      // error handler 已在 proxy.on('error') 中处理
    });

    // 重写路径
    req.url = targetPath;
  }

  function handleCors(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers['origin'] || '';
    if (config.allowedOrigins.includes(origin) || config.allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-User-Name, X-Request-Id');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }

  function matchRoute(url: string, routes: ProxyRoute[]): ProxyRoute | null {
    // 按前缀长度倒序匹配（最长匹配优先）
    const sorted = [...routes].sort((a, b) => b.prefix.length - a.prefix.length);
    for (const route of sorted) {
      if (url.startsWith(route.prefix)) {
        return route;
      }
    }
    return null;
  }

  return {
    async start() {
      server = http.createServer(handleRequest);
      // SSE: 支持 upgrade
      server.on('upgrade', (req, socket, head) => {
        const route = matchRoute(req.url || '/', config.routes);
        if (route) {
          proxy.ws(req, socket, head, { target: route.target });
        } else {
          socket.destroy();
        }
      });
      await new Promise<void>((resolve, reject) => {
        server!.listen(config.port, config.host, () => resolve());
        server!.once('error', reject);
      });
    },
    async stop() {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      proxy.close();
    },
    getPort: () => config.port,
    setCurrentAssistant(userId, userName) {
      currentUserId = userId;
      currentUserName = userName;
    },
    updateRoutes(routes) {
      config.routes = routes;
    },
    isRunning: () => server !== null && server.listening,
  };
}
```

### 4.3 Local Secret 机制

每次应用启动时生成一个随机 secret：

```typescript
// desktop/src/main/proxy/secret.ts
import { randomBytes } from 'node:crypto';

let localSecret: string | null = null;

export function generateLocalSecret(): string {
  localSecret = randomBytes(32).toString('hex');
  return localSecret;
}

export function getLocalSecret(): string {
  if (!localSecret) throw new Error('Local secret not generated');
  return localSecret;
}
```

**用途：**
- Local Proxy 在每个请求中注入 `X-Desktop-Secret` header。
- 后端服务在 Desktop Mode 下校验此 header，拒绝没有正确 secret 的请求。
- 防止本机其他程序直接访问后端绕过 Proxy 的身份注入。

**传递方式：**
- Proxy 生成 secret → 通过 ProcessManager 注入环境变量 `LAZYMIND_LOCAL_SECRET` 给各后端。
- 后端读取环境变量 → 校验请求中的 `X-Desktop-Secret`。

### 4.4 身份注入流程

```
Renderer 发起请求
   │
   ▼
Local Proxy (port 5023) 接收
   │
   ├─ 读取 currentUserId / currentUserName（由 LLD-04 设置）
   ├─ 注入 X-User-Id, X-User-Name, X-Desktop-Secret, X-Request-Id
   ├─ 删除前端传入的 Authorization header
   ├─ 匹配路由，决定目标后端
   │
   ▼
转发到后端 (127.0.0.1:8001/8002/...)
   │
   ▼
后端读取 X-User-Id 作为当前用户上下文
```

### 4.5 SSE/Streaming 处理

Chat 接口使用 SSE 返回流式响应。关键处理：

- `http-proxy` 默认支持 SSE 透传。
- 设置 `timeout: 600000`（10 分钟）防止长连接超时。
- 监听 `proxyRes` 的 `content-type: text/event-stream`，确保不缓冲。
- 如果连接中断（前端关闭），proxy 通知后端（依赖 TCP 连接关闭信号）。

### 4.6 文件上传处理

文件上传使用 `multipart/form-data`，proxy 需要：

- 不解析 body，直接透传。
- 不设置请求大小限制（大文件支持）。
- 保持 `Content-Type` header 中的 boundary。

### 4.7 CORS 配置

Desktop Mode 允许的 origin：

```typescript
const allowedOrigins = [
  'lazymind://app',           // 生产模式：自定义协议
  'http://localhost:5173',    // 开发模式：Vite dev server
];
```

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `desktop/src/main/proxy/index.ts` | 模块入口 |
| `desktop/src/main/proxy/types.ts` | 类型定义 |
| `desktop/src/main/proxy/server.ts` | 代理服务器实现 |
| `desktop/src/main/proxy/routes.ts` | 路由表配置 |
| `desktop/src/main/proxy/secret.ts` | Local Secret 管理 |
| `desktop/src/main/proxy/cors.ts` | CORS 处理 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `desktop/src/main/index.ts` | 引入并启动 ProxyServer |
| `desktop/package.json` | 添加 `http-proxy` 依赖 |

---

## 6. 配置与环境变量

### 6.1 Proxy 配置

```yaml
# config.yaml 中的 proxy 段
proxy:
  port: 5023
  host: 127.0.0.1
  routes:
    - prefix: /api/authservice
      target: http://127.0.0.1:8002
      stripPrefix: false
      timeout: 30000
    - prefix: /api/core
      target: http://127.0.0.1:8001
      stripPrefix: true
      timeout: 600000
    - prefix: /api/chat
      target: http://127.0.0.1:8046
      stripPrefix: false
      timeout: 600000
    - prefix: /api/scan
      target: http://127.0.0.1:18080
      stripPrefix: false
      timeout: 30000
    - prefix: /api/file
      target: http://127.0.0.1:18081
      stripPrefix: false
      timeout: 30000
```

### 6.2 环境变量

| 变量名 | 接收方 | 说明 |
|--------|--------|------|
| `LAZYMIND_LOCAL_SECRET` | 各后端服务 | 由 Proxy 生成，注入给后端校验 |
| `LAZYMIND_PROXY_PORT` | Electron 内部 | 覆盖默认代理端口（调试用） |

---

## 7. 错误处理

### 7.1 后端不可用

```json
// HTTP 502
{
  "code": 502,
  "message": "Backend service unavailable",
  "service": "core",
  "error": "ECONNREFUSED"
}
```

### 7.2 路由未匹配

```json
// HTTP 404
{
  "code": 404,
  "message": "Route not found",
  "path": "/api/unknown/endpoint"
}
```

### 7.3 请求超时

```json
// HTTP 504
{
  "code": 504,
  "message": "Backend request timeout",
  "service": "core",
  "timeout": 600000
}
```

### 7.4 代理端口被占用

启动失败，通知 Renderer 显示错误信息，建议用户检查端口占用或修改配置。

---

## 8. 安全考量

### 8.1 监听地址

- 固定监听 `127.0.0.1`，不允许配置为 `0.0.0.0`。
- 只接受本机请求。

### 8.2 CORS 限制

- 只允许 `lazymind://app`（生产）和 `http://localhost:5173`（开发）。
- 拒绝其他 origin 的跨域请求。

### 8.3 身份伪造防护

- Proxy 覆盖前端传入的任何 `X-User-Id`、`X-User-Name`、`Authorization` header。
- 后端不应信任前端直接传入的身份 header。
- 后端通过 `X-Desktop-Secret` 验证请求来自受信的 Local Proxy。

### 8.4 请求日志脱敏

- 日志记录请求路径、方法、状态码、耗时。
- 不记录请求 body。
- 不记录 `X-Desktop-Secret` 的完整值。
- 不记录 `Authorization` 值。

### 8.5 信息泄露防护

- 502/504 错误响应不包含后端内部错误栈。
- 不在响应中暴露后端服务内部端口号。

---

## 9. 测试策略

### 9.1 单元测试

- 路由匹配：测试最长匹配、前缀剥离、未匹配路由。
- CORS 处理：测试允许/拒绝的 origin。
- Header 注入：验证身份 header 正确注入、前端 header 被覆盖。
- Secret 生成：验证随机性和长度。

### 9.2 集成测试

- 启动 mock HTTP server 作为后端，验证：
  - GET/POST/PUT/DELETE 请求正确转发。
  - SSE 流式响应正确透传。
  - multipart 文件上传正确透传。
  - 后端关闭时返回 502。
  - 超时返回 504。

### 9.3 安全测试

- 从浏览器访问 `http://localhost:5023/api/core/...` 验证 CORS 拒绝。
- 直接访问后端端口（8001）不带 `X-Desktop-Secret` 验证被拒绝。
- 从外部机器访问 `http://<local-ip>:5023` 验证连接被拒绝。

---

## 10. Cloud 模式兼容

本模块完全新增代码，不修改现有后端。

后端侧需要新增 `X-Desktop-Secret` 校验逻辑（在 LLD-06/LLD-05 中处理），但该逻辑仅在 `LAZYMIND_DESKTOP_MODE=true` 时启用，Cloud 模式不受影响。

Cloud 模式继续使用 Kong Gateway，路由表和 RBAC 插件不变。

---

## 11. 验收标准

- [ ] Proxy 在 `127.0.0.1:5023` 启动成功。
- [ ] `/api/authservice/auth/health` 正确转发到 auth-service 并返回 200。
- [ ] `/api/core/chat/conversations` 正确转发到 core（path strip 后为 `/chat/conversations`）。
- [ ] Chat SSE 流式响应能实时透传给前端（无缓冲延迟）。
- [ ] 文件上传 (`multipart/form-data`) 正确透传。
- [ ] 请求中自动注入 `X-User-Id`、`X-User-Name`。
- [ ] 前端传入的 `Authorization` header 被覆盖删除。
- [ ] 后端不可用时返回 502 JSON 错误。
- [ ] 非允许 origin 的请求 CORS 被拒绝。
- [ ] 从外部机器无法连接代理端口。
- [ ] 日志中不包含 secret 或认证信息明文。

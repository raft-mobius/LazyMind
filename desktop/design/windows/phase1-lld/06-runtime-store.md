# LLD-06: Runtime Store (Redis Elimination)

## 1. 模块概述

### 1.1 目标

消除 Desktop Mode 对 Redis 的依赖，用本地内存实现替代 Redis 承担的运行时状态语义：

- Chat 状态管理（生成中/完成/失败）。
- Chat 流式片段追加和 replay。
- Chat 取消信号传播。
- 多回答关联信息。
- Chat 用户输入记录。
- auth-service 的 refresh token 存储（Desktop 模式下可选降级）。
- auth-service 的登录限流（Desktop 模式下禁用）。

### 1.2 范围

**包含：**
- Go core 的 `InMemoryStore` 实现（替代 `redis_cache.go`）。
- Python auth-service 的 `InMemoryTokenStore` 和 `NoOpRateLimiter`。
- 运行时存储接口抽象。
- TTL 过期和内存清理。
- 配置切换机制。

**不包含：**
- SQLite 迁移（见 LLD-05）。
- 具体 Chat SSE 转发架构（core 转发 vs 前端直连的决策在此定义方向，具体实现在 core 代码中）。
- Milvus Lite 或 SegmentStore（不在本模块范围）。

---

## 2. 接口契约

### 2.1 Go RuntimeStore 接口

```go
// backend/core/store/runtime_store.go

type RuntimeStore interface {
    // Chat 状态
    SetChatStatus(conversationID string, status *ChatStatus, ttl time.Duration) error
    GetChatStatus(conversationID string) (*ChatStatus, error)
    DeleteChatStatus(conversationID string) error

    // Chat 流式片段
    AppendChatChunk(conversationID, historyID string, chunk *ChatChunkResponse) error
    GetChatChunks(conversationID, historyID string, fromSeq int32) ([]*ChatChunkResponse, error)
    DeleteChatChunks(conversationID, historyID string) error

    // Chat 取消信号
    SendStopSignal(conversationID, historyID string) error
    WaitForStopSignal(ctx context.Context, conversationID, historyID string) error
    ConsumeStopSignal(conversationID, historyID string) (bool, error)

    // 多回答关联
    SetMultiAnswerInfo(conversationID, primaryHistoryID string, info *MultiAnswerInfo, ttl time.Duration) error
    GetMultiAnswerInfo(conversationID, primaryHistoryID string) (*MultiAnswerInfo, error)

    // Chat 输入
    SetChatInput(conversationID, historyID string, input *ChatInput, ttl time.Duration) error
    GetChatInput(conversationID, historyID string) (*ChatInput, error)

    // 生命周期
    Close() error
}
```

### 2.2 Go 实现选择

```go
// backend/core/store/runtime_store_factory.go

func NewRuntimeStore(backend string) RuntimeStore {
    switch backend {
    case "redis":
        return NewRedisRuntimeStore(MustRedisFromEnv())
    case "memory":
        return NewMemoryRuntimeStore()
    default:
        return NewMemoryRuntimeStore()
    }
}
```

### 2.3 Python auth-service 接口

```python
# backend/auth-service/core/token_store.py

class TokenStore(Protocol):
    def save_refresh_token(self, user_id: str, token: str, ttl_seconds: int) -> None: ...
    def get_refresh_token(self, user_id: str) -> Optional[str]: ...
    def delete_refresh_token(self, user_id: str) -> None: ...

class RateLimiter(Protocol):
    def check_rate_limit(self, key: str, max_requests: int, window_seconds: int) -> bool: ...
```

### 2.4 环境变量

| 变量名 | 服务 | 值 | 说明 |
|--------|------|-----|------|
| `LAZYMIND_STATE_BACKEND` | core | `memory` \| `redis` | 运行时存储后端 |
| `LAZYMIND_DESKTOP_MODE` | auth-service | `true` | 启用内存 token 和禁用限流 |

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-05**：如果某些状态需要持久化到 SQLite（MVP 阶段暂时全内存）。

### 3.2 被依赖

- **LLD-02**：ProcessManager 注入 `LAZYMIND_STATE_BACKEND=memory` 环境变量。
- **LLD-04**：auth-service Desktop 模式依赖本模块的 `NoOpRateLimiter`。

---

## 4. 技术设计

### 4.1 Redis 语义清单

基于 `backend/core/chat/redis_cache.go` 的分析：

| Redis Key Pattern | 操作 | TTL | Desktop 替代 |
|-------------------|------|-----|-------------|
| `rag/chat/status:{convID}` | Hash GET/SET | 2h | `sync.Map` + TTL goroutine |
| `rag/chat/stream:{convID}:{histID}` | List RPUSH/LRANGE | 2h | `[]ChatChunkResponse` + mutex |
| `rag/chat/stop:{convID}:{histID}` | List RPUSH + BLPOP | 15min | `chan struct{}` per key |
| `rag/chat/multi:{convID}:{primaryHistID}` | String GET/SET | 2h | `sync.Map` entry |
| `rag/chat/input:{convID}:{histID}` | String GET/SET | 2h | `sync.Map` entry |

### 4.2 Go InMemoryRuntimeStore 实现

```go
// backend/core/store/memory_runtime_store.go

package store

import (
    "context"
    "sync"
    "time"
)

type memoryEntry struct {
    value     interface{}
    expireAt  time.Time
}

type MemoryRuntimeStore struct {
    mu       sync.RWMutex
    data     map[string]*memoryEntry
    chunks   map[string][]*ChatChunkResponse // key: convID:histID
    stopChs  map[string]chan struct{}         // key: convID:histID
    ticker   *time.Ticker
    done     chan struct{}
}

func NewMemoryRuntimeStore() *MemoryRuntimeStore {
    s := &MemoryRuntimeStore{
        data:    make(map[string]*memoryEntry),
        chunks:  make(map[string][]*ChatChunkResponse),
        stopChs: make(map[string]chan struct{}),
        ticker:  time.NewTicker(30 * time.Second),
        done:    make(chan struct{}),
    }
    go s.cleanupLoop()
    return s
}

// --- Chat Status ---

func (s *MemoryRuntimeStore) SetChatStatus(conversationID string, status *ChatStatus, ttl time.Duration) error {
    key := "status:" + conversationID
    s.mu.Lock()
    defer s.mu.Unlock()
    s.data[key] = &memoryEntry{value: status, expireAt: time.Now().Add(ttl)}
    return nil
}

func (s *MemoryRuntimeStore) GetChatStatus(conversationID string) (*ChatStatus, error) {
    key := "status:" + conversationID
    s.mu.RLock()
    defer s.mu.RUnlock()
    entry, ok := s.data[key]
    if !ok || time.Now().After(entry.expireAt) {
        return nil, nil
    }
    return entry.value.(*ChatStatus), nil
}

func (s *MemoryRuntimeStore) DeleteChatStatus(conversationID string) error {
    key := "status:" + conversationID
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.data, key)
    return nil
}

// --- Chat Chunks (Streaming) ---

func (s *MemoryRuntimeStore) AppendChatChunk(conversationID, historyID string, chunk *ChatChunkResponse) error {
    key := conversationID + ":" + historyID
    s.mu.Lock()
    defer s.mu.Unlock()
    s.chunks[key] = append(s.chunks[key], chunk)
    // 设置过期时间标记
    s.data["chunks_expire:"+key] = &memoryEntry{
        value: nil, expireAt: time.Now().Add(2 * time.Hour),
    }
    return nil
}

func (s *MemoryRuntimeStore) GetChatChunks(conversationID, historyID string, fromSeq int32) ([]*ChatChunkResponse, error) {
    key := conversationID + ":" + historyID
    s.mu.RLock()
    defer s.mu.RUnlock()
    chunks := s.chunks[key]
    var result []*ChatChunkResponse
    for _, c := range chunks {
        if c.Seq >= fromSeq {
            result = append(result, c)
        }
    }
    return result, nil
}

func (s *MemoryRuntimeStore) DeleteChatChunks(conversationID, historyID string) error {
    key := conversationID + ":" + historyID
    s.mu.Lock()
    defer s.mu.Unlock()
    delete(s.chunks, key)
    delete(s.data, "chunks_expire:"+key)
    return nil
}

// --- Stop Signal ---

func (s *MemoryRuntimeStore) SendStopSignal(conversationID, historyID string) error {
    key := conversationID + ":" + historyID
    s.mu.Lock()
    ch, ok := s.stopChs[key]
    if !ok {
        ch = make(chan struct{}, 1)
        s.stopChs[key] = ch
    }
    s.mu.Unlock()
    select {
    case ch <- struct{}{}:
    default:
        // 已有信号，忽略
    }
    return nil
}

func (s *MemoryRuntimeStore) WaitForStopSignal(ctx context.Context, conversationID, historyID string) error {
    key := conversationID + ":" + historyID
    s.mu.Lock()
    ch, ok := s.stopChs[key]
    if !ok {
        ch = make(chan struct{}, 1)
        s.stopChs[key] = ch
    }
    s.mu.Unlock()

    select {
    case <-ch:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (s *MemoryRuntimeStore) ConsumeStopSignal(conversationID, historyID string) (bool, error) {
    key := conversationID + ":" + historyID
    s.mu.Lock()
    defer s.mu.Unlock()
    ch, ok := s.stopChs[key]
    if !ok {
        return false, nil
    }
    select {
    case <-ch:
        delete(s.stopChs, key)
        return true, nil
    default:
        return false, nil
    }
}

// --- Cleanup ---

func (s *MemoryRuntimeStore) cleanupLoop() {
    for {
        select {
        case <-s.ticker.C:
            s.cleanup()
        case <-s.done:
            return
        }
    }
}

func (s *MemoryRuntimeStore) cleanup() {
    now := time.Now()
    s.mu.Lock()
    defer s.mu.Unlock()

    for key, entry := range s.data {
        if now.After(entry.expireAt) {
            delete(s.data, key)
            // 如果是 chunks 的过期标记，同时清理 chunks
            if len(key) > 14 && key[:14] == "chunks_expire:" {
                chunkKey := key[14:]
                delete(s.chunks, chunkKey)
            }
        }
    }

    // 清理超时的 stop channels
    for key, ch := range s.stopChs {
        select {
        case <-ch:
            delete(s.stopChs, key)
        default:
        }
    }
}

func (s *MemoryRuntimeStore) Close() error {
    s.ticker.Stop()
    close(s.done)
    return nil
}
```

### 4.3 从现有 Redis 代码迁移

现有 `redis_cache.go` 中的函数需要改为调用 `RuntimeStore` 接口：

```go
// 改造前（直接调用 Redis）:
func SetChatStatus(rdb *redis.Client, convID string, status *ChatStatus) error {
    key := fmt.Sprintf(chatStatusKeyPrefix, convID)
    data, _ := json.Marshal(status)
    return rdb.Set(ctx, key, data, chatCacheExpireTime).Err()
}

// 改造后（调用 RuntimeStore 接口）:
func SetChatStatus(store RuntimeStore, convID string, status *ChatStatus) error {
    return store.SetChatStatus(convID, status, chatCacheExpireTime)
}
```

**改造步骤：**
1. 定义 `RuntimeStore` 接口。
2. 将 `redis_cache.go` 改为 `RedisRuntimeStore` 实现。
3. 新增 `MemoryRuntimeStore` 实现。
4. 修改 `store.Init()` 接受 `RuntimeStore` 而非 `*redis.Client`。
5. Chat handler 通过 `store.Runtime()` 获取实例。

### 4.4 Python auth-service 改造

#### 4.4.1 InMemoryTokenStore

```python
# backend/auth-service/core/memory_token_store.py

import time
from threading import Lock
from typing import Optional

class InMemoryTokenStore:
    def __init__(self):
        self._store: dict[str, tuple[str, float]] = {}  # user_id -> (token, expire_at)
        self._lock = Lock()

    def save_refresh_token(self, user_id: str, token: str, ttl_seconds: int) -> None:
        with self._lock:
            self._store[user_id] = (token, time.time() + ttl_seconds)

    def get_refresh_token(self, user_id: str) -> Optional[str]:
        with self._lock:
            entry = self._store.get(user_id)
            if entry is None:
                return None
            token, expire_at = entry
            if time.time() > expire_at:
                del self._store[user_id]
                return None
            return token

    def delete_refresh_token(self, user_id: str) -> None:
        with self._lock:
            self._store.pop(user_id, None)
```

#### 4.4.2 NoOpRateLimiter

```python
# backend/auth-service/core/noop_rate_limiter.py

class NoOpRateLimiter:
    def check_rate_limit(self, key: str, max_requests: int, window_seconds: int) -> bool:
        return True  # Desktop 模式下永远通过
```

#### 4.4.3 工厂选择

```python
# backend/auth-service/core/dependencies.py

from .config import DESKTOP_MODE

def get_token_store():
    if DESKTOP_MODE:
        from .memory_token_store import InMemoryTokenStore
        return InMemoryTokenStore()
    else:
        from .redis_token_store import RedisTokenStore
        return RedisTokenStore()

def get_rate_limiter():
    if DESKTOP_MODE:
        from .noop_rate_limiter import NoOpRateLimiter
        return NoOpRateLimiter()
    else:
        from .redis_rate_limiter import RedisRateLimiter
        return RedisRateLimiter()
```

### 4.5 Chat SSE 架构方向

Desktop Mode 的 Chat SSE 流程：

```
前端 → Local Proxy → core (Go) → Python chat service
                               ↕ RuntimeStore (内存)
前端 ← Local Proxy ← core (SSE stream)
```

- core 统一转发 Python chat service 的流式结果。
- 流式 chunk 通过 `MemoryRuntimeStore.AppendChatChunk` 存储。
- 前端断线重连时通过 `GetChatChunks(fromSeq)` replay。
- 取消信号通过 `SendStopSignal` → core 传播到 chat service。

### 4.6 内存使用预估

单个 Chat 会话峰值内存：
- ChatStatus: ~200 bytes
- ChatChunks (100 chunks × 1KB): ~100KB
- MultiAnswerInfo: ~200 bytes
- StopSignal channel: ~100 bytes

按 10 个并发会话估算：~1MB。TTL 2小时后自动清理。可接受。

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `backend/core/store/runtime_store.go` | RuntimeStore 接口定义 |
| `backend/core/store/memory_runtime_store.go` | 内存实现 |
| `backend/core/store/redis_runtime_store.go` | Redis 实现（从现有代码重构） |
| `backend/core/store/runtime_store_factory.go` | 工厂函数 |
| `backend/auth-service/core/token_store.py` | TokenStore Protocol |
| `backend/auth-service/core/memory_token_store.py` | 内存实现 |
| `backend/auth-service/core/noop_rate_limiter.py` | 无操作限流器 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `backend/core/store/store.go` | 添加 `RuntimeStore` 全局实例和 `Runtime()` 访问函数 |
| `backend/core/chat/redis_cache.go` | 重构为调用 `RuntimeStore` 接口 |
| `backend/core/main.go` | 初始化时选择 RuntimeStore 后端 |
| `backend/auth-service/core/dependencies.py` | 添加 token store 和 rate limiter 工厂 |
| `backend/auth-service/api/auth.py` | 使用注入的 TokenStore 而非直接调 Redis |

---

## 6. 配置与环境变量

| 变量名 | 默认值 | Cloud | Desktop |
|--------|--------|-------|---------|
| `LAZYMIND_STATE_BACKEND` | `redis` | `redis` | `memory` |
| `LAZYMIND_REDIS_URL` | - | `redis://redis:6379/0` | 不设置 |
| `LAZYMIND_DESKTOP_MODE` | `false` | `false` | `true` |

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 内存不足（大量 chunk 积累） | TTL 清理 + 上限检查（单 conversation 最多 5000 chunks） |
| 应用崩溃后状态丢失 | 可接受 —— Chat 状态为临时数据，崩溃后对话需重新发起 |
| 取消信号发送失败（channel 已关闭） | 忽略，Chat 对应的 goroutine 会因 context cancel 退出 |
| 多 goroutine 竞争 | 使用 `sync.RWMutex` 保证线程安全 |

### 7.1 内存 vs Redis 的行为差异

| 行为 | Redis | Memory | 影响 |
|------|-------|--------|------|
| 应用重启后状态 | 保留 | 丢失 | 进行中的 Chat 需重新发起 |
| 跨进程通信 | 支持 | 仅进程内 | Desktop 单实例，可接受 |
| 并发写入 | 原子操作 | mutex | Desktop 并发低，可接受 |
| TTL 精度 | 毫秒级 | 30s 清理周期 | 可接受 |
| 阻塞等待 (BLPOP) | 原生支持 | 用 channel 模拟 | 行为一致 |

---

## 8. 安全考量

- 内存中的 Chat 内容不写入磁盘（除非后续设计持久化）。
- Token 存储在内存中，应用退出即失效（Desktop 模式可接受）。
- 不在日志中打印 Chat 内容或 Token 值。

---

## 9. 测试策略

### 9.1 单元测试

- `MemoryRuntimeStore` 的每个方法测试：Set/Get/Delete、TTL 过期、并发安全。
- Stop signal 测试：发送 → 等待 → 消费。
- Chunk append/get 测试：fromSeq 过滤、过期清理。
- `InMemoryTokenStore` 测试：存/取/过期/删除。
- `NoOpRateLimiter` 测试：永远返回 true。

### 9.2 行为对照测试

编写统一测试套件，分别跑 `RedisRuntimeStore` 和 `MemoryRuntimeStore`，验证行为一致：

```go
func TestRuntimeStore(t *testing.T) {
    stores := map[string]RuntimeStore{
        "memory": NewMemoryRuntimeStore(),
        // "redis": NewRedisRuntimeStore(testRedisClient),
    }
    for name, store := range stores {
        t.Run(name, func(t *testing.T) {
            testChatStatusCRUD(t, store)
            testChatChunksAppendAndGet(t, store)
            testStopSignal(t, store)
            testTTLExpiry(t, store)
        })
    }
}
```

### 9.3 压力测试

- 模拟 10 个并发 Chat 会话，每个产生 200 chunks。
- 验证内存占用合理（< 50MB）。
- 验证 30s 清理周期后过期数据被回收。

---

## 10. Cloud 模式兼容

- `LAZYMIND_STATE_BACKEND=redis` 时使用 `RedisRuntimeStore`，行为与现有完全一致。
- `RedisRuntimeStore` 本质上是对现有 `redis_cache.go` 的接口化重构，不改变任何 Redis 操作逻辑。
- 新增 `RuntimeStore` 接口是纯加法改造，不删除现有 Redis 代码。
- `MemoryRuntimeStore` 不会在 Cloud 模式下被加载。

---

## 11. 验收标准

- [ ] `LAZYMIND_STATE_BACKEND=memory` 时 core 启动成功，不依赖 Redis。
- [ ] Chat 发起问答 → 流式返回 chunks → 状态正确更新为 completed。
- [ ] Chat 取消 → 停止信号正确传播 → 状态更新为 stopped。
- [ ] 2 小时后过期数据被清理（可设为短 TTL 验证）。
- [ ] auth-service Desktop 模式启动不连接 Redis。
- [ ] Cloud 模式使用 Redis 回归测试通过。
- [ ] 10 个并发 Chat 会话内存占用 < 50MB。
- [ ] 应用正常关闭时 `Close()` 被调用，goroutine 退出。

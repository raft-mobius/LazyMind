# LLD-05: SQLite Migration

## 1. 模块概述

### 1.1 目标

将 Desktop Mode 下所有后端服务的关系数据存储从 PostgreSQL 迁移到 SQLite：

- Go core 服务使用 SQLite。
- Python auth-service 使用 SQLite。
- Go scan-control-plane 使用 SQLite。
- 每个服务独占写一个 SQLite 文件，避免多进程写入冲突。
- 识别和修复 PostgreSQL 专有 SQL 语法。
- 建立 MVP 阶段最小可用表集合。

### 1.2 范围

**包含：**
- SQLite 文件分拆方案和命名。
- 各服务 SQLite 连接配置。
- Go core migration 文件的 SQLite 兼容改造。
- Python auth-service Alembic migration 的 SQLite 兼容改造。
- Go scan-control-plane SQLite 配置。
- WAL 模式和 pragma 设置。
- MVP 必需表的识别。
- Seed data（初始数据）策略。

**不包含：**
- Redis 替换（见 LLD-06）。
- 认证和身份逻辑（见 LLD-04）。
- 具体 ORM 业务代码修改（除非有 PG-only 语法）。

---

## 2. 接口契约

### 2.1 SQLite 配置接口

```typescript
// desktop/src/shared/types.ts 中补充
export interface SQLiteDBConfig {
  name: string;       // 文件名如 'main.db'
  owner: string;      // 拥有服务：'core' | 'auth-service' | 'scan-control-plane'
  path: string;       // 完整路径
  pragmas: string[];  // 初始化 pragma
}
```

### 2.2 数据库文件分配

| 文件名 | 拥有服务 | 内容 |
|--------|----------|------|
| `main.db` | core (Go) | 会话、技能、记忆、偏好、模型配置、文档数据集 |
| `auth.db` | auth-service (Python) | 用户/AI 助手、组、角色、权限、token |
| `scan.db` | scan-control-plane (Go) | 扫描源、文件状态、任务游标 |

### 2.3 环境变量接口

| 变量名 | 服务 | 格式 | 示例 |
|--------|------|------|------|
| `ACL_DB_DRIVER` | core | `sqlite` | `sqlite` |
| `ACL_DB_DSN` | core | 文件路径 | `C:\Users\xxx\AppData\Roaming\LazyMind\data\main.db` |
| `LAZYMIND_DATABASE_URL` | auth-service | SQLAlchemy URL | `sqlite:///C:\...\data\auth.db` |
| `DATABASE_DRIVER` | scan-control-plane | `sqlite` | `sqlite` |
| `DATABASE_DSN` | scan-control-plane | 文件路径 | `C:\...\data\scan.db` |

---

## 3. 依赖关系

### 3.1 本模块依赖

- **LLD-01**：使用 `DataDirPaths.data` 确定数据库文件存放位置。

### 3.2 被依赖

- **LLD-02**：ProcessManager 注入 SQLite DSN 环境变量给各服务。
- **LLD-04**：auth-service 需要 SQLite 存储用户/助手数据。
- **LLD-06**：Runtime Store 某些持久化数据可能落入 `main.db`。

---

## 4. 技术设计

### 4.1 Go Core SQLite 改造

#### 4.1.1 现有数据库配置

Go core 已支持 SQLite 驱动（`go.mod` 中有 `gorm.io/driver/sqlite`），通过环境变量切换：

```go
// backend/core/main.go 现有逻辑
driver := envOrDefault("ACL_DB_DRIVER", "sqlite")
dsn := envOrDefault("ACL_DB_DSN", "./acl.db")
db := orm.MustConnect(driver, dsn)
```

`orm.MustConnect` 已经支持 `DriverSQLite`，会使用 `gorm.io/driver/sqlite`。

#### 4.1.2 SQLite Pragma 设置

在连接建立后需要执行：

```go
// backend/core/common/orm/db.go 中添加 SQLite 初始化

func configureSQLite(db *gorm.DB) error {
    sqlDB, err := db.DB()
    if err != nil {
        return err
    }
    // WAL 模式：允许并发读
    _, err = sqlDB.Exec("PRAGMA journal_mode=WAL")
    if err != nil { return err }
    // 写锁超时：5 秒
    _, err = sqlDB.Exec("PRAGMA busy_timeout=5000")
    if err != nil { return err }
    // 启用外键约束
    _, err = sqlDB.Exec("PRAGMA foreign_keys=ON")
    if err != nil { return err }
    // 同步模式：NORMAL（WAL 模式下安全且性能好）
    _, err = sqlDB.Exec("PRAGMA synchronous=NORMAL")
    if err != nil { return err }
    return nil
}
```

#### 4.1.3 Migration 兼容改造

Go core 使用 `golang-migrate/migrate` 进行 migration。需要审计 `backend/core/migrations/` 下的 `.up.sql` 文件。

**常见 PostgreSQL → SQLite 不兼容语法：**

| PostgreSQL 语法 | SQLite 替代 | 说明 |
|----------------|-------------|------|
| `UUID` 类型 | `TEXT` | SQLite 无 UUID 类型 |
| `SERIAL` / `BIGSERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 自增主键 |
| `TIMESTAMP WITH TIME ZONE` | `TEXT` (ISO 8601) | SQLite 无原生时间类型 |
| `JSONB` | `TEXT` (JSON 字符串) | SQLite 3.38+ 有 JSON 函数 |
| `BOOLEAN` | `INTEGER` (0/1) | GORM 自动处理 |
| `TEXT[]` 数组 | `TEXT` (JSON array) | 需要代码适配 |
| `ON CONFLICT DO UPDATE` (UPSERT) | `ON CONFLICT ... DO UPDATE` | SQLite 3.24+ 支持 |
| `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | 需要检查后 ADD | SQLite 不支持 IF NOT EXISTS |
| `CREATE INDEX CONCURRENTLY` | `CREATE INDEX` | SQLite 无并发 DDL |
| `CASCADE` on FK | 需要 `PRAGMA foreign_keys=ON` | 默认关闭 |

**改造策略：**

为 Desktop Mode 维护一份独立的 SQLite migration 目录：

```
backend/core/migrations/
  ├── postgres/        # 现有 PostgreSQL migrations（不动）
  └── sqlite/          # Desktop Mode SQLite migrations（新增）
      ├── 000001_init_schema.up.sql
      ├── 000001_init_schema.down.sql
      └── ...
```

Migration 选择逻辑：

```go
func getMigrationDir(driver string) string {
    if driver == DriverSQLite {
        return "migrations/sqlite"
    }
    return "migrations/postgres"
}
```

#### 4.1.4 MVP 必需表（core）

| 表名 | 用途 | MVP 必需 |
|------|------|----------|
| `conversations` | 会话列表 | 是 |
| `histories` | 会话消息历史 | 是 |
| `skills` | 技能定义 | 是 |
| `skill_configs` | 技能配置 | 是 |
| `datasets` | 数据集/知识库 | 是 |
| `documents` | 文档列表 | 是 |
| `segments` | 文档分段 | 是 |
| `model_providers` | 模型提供商配置 | 是 |
| `model_configs` | 模型配置 | 是 |
| `preferences` | 用户偏好 | 是 |
| `word_groups` | 词汇组 | 后续 |
| `memories` | 记忆 | 后续 |
| `evolution_*` | 进化相关 | 不需要（MVP 剪掉 Evo） |

### 4.2 Python auth-service SQLite 改造

#### 4.2.1 现有数据库配置

```python
# backend/auth-service/core/database.py 现有逻辑
DATABASE_URL = os.getenv("LAZYMIND_DATABASE_URL", "sqlite:///./app.db")
```

auth-service 已默认 fallback 到 SQLite，需要确保：

1. Alembic migrations 兼容 SQLite。
2. `check_same_thread: False` 设置正确。
3. 无 PostgreSQL-only SQL。

#### 4.2.2 Alembic Migration 兼容

审计 `backend/auth-service/alembic/versions/` 中的 migration 文件：

**常见问题：**
- `sa.Enum` → SQLite 中需要使用 `sa.String` + check constraint 或直接 String。
- `sa.ARRAY` → 不支持，改用 JSON Text。
- `server_default=sa.text("gen_random_uuid()")` → SQLite 不支持，需要应用层生成。
- `autoincrement=True` 在非 INTEGER PRIMARY KEY 上不支持。

**改造策略：**

添加 migration 运行时检测：

```python
# backend/auth-service/alembic/env.py 中
from sqlalchemy import engine_from_config
from alembic import context

def run_migrations_online():
    connectable = engine_from_config(...)
    # 检测是否为 SQLite
    is_sqlite = 'sqlite' in str(connectable.url)
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=is_sqlite,  # SQLite 不支持 ALTER TABLE，使用 batch mode
    )
```

`render_as_batch=True` 使 Alembic 在 SQLite 上使用"重建表"策略代替 ALTER TABLE。

#### 4.2.3 MVP 必需表（auth-service）

| 表名 | 用途 | MVP 必需 |
|------|------|----------|
| `users` | 用户/AI 助手 | 是 |
| `roles` | 角色定义 | 是 |
| `groups` | 用户组 | 是 |
| `permissions` | 权限列表 | 是 |
| `user_roles` | 用户-角色关联 | 是 |
| `user_groups` | 用户-组关联 | 是 |
| `role_permissions` | 角色-权限关联 | 是 |
| `group_permissions` | 组-权限关联 | 是 |
| `refresh_tokens` | 刷新令牌 | Desktop 可选 |

#### 4.2.4 SQLite Pragma

```python
# backend/auth-service/core/database.py 中添加

from sqlalchemy import event

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if 'sqlite' in str(engine.url):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
```

### 4.3 Go scan-control-plane SQLite 改造

scan-control-plane 已支持 SQLite（配置中有 `database_driver: sqlite`）。

需要确认：
- Migration 文件兼容 SQLite。
- 使用 `scan.db` 作为数据文件路径。

### 4.4 多进程写入治理

**核心原则：一个 SQLite 文件只有一个写进程。**

| DB 文件 | 写进程 | 读进程 |
|---------|--------|--------|
| `main.db` | core | 无（其他服务通过 core API 读） |
| `auth.db` | auth-service | core（通过 auth-service API 读） |
| `scan.db` | scan-control-plane | file-watcher（如需写入，通过 scan API） |

如果发现跨服务直接读数据库的场景，改为调用对应服务的 API。

### 4.5 初始化和 Seed Data

首次启动数据初始化由各服务自行处理：

- **core**：migration 创建表结构。无需 seed data（会话等用户数据在使用中产生）。
- **auth-service**：migration 创建表结构 → bootstrap 创建默认角色/组/权限/助手（LLD-04）。
- **scan-control-plane**：migration 创建表结构。无需 seed data。

---

## 5. 文件清单

### 5.1 新建文件

| 文件路径 | 说明 |
|----------|------|
| `backend/core/migrations/sqlite/` | SQLite 专用 migration 目录 |
| `backend/core/migrations/sqlite/000001_init_schema.up.sql` | 合并的初始 schema |
| `backend/core/migrations/sqlite/000001_init_schema.down.sql` | 回滚 |

### 5.2 修改文件

| 文件路径 | 修改说明 |
|----------|----------|
| `backend/core/common/orm/db.go` | 添加 `configureSQLite()` pragma 设置 |
| `backend/core/migrations/run.go` | 添加 migration 目录选择逻辑 |
| `backend/auth-service/core/database.py` | 添加 SQLite pragma event listener |
| `backend/auth-service/alembic/env.py` | 添加 `render_as_batch` SQLite 支持 |
| `backend/auth-service/alembic/versions/*.py` | 修复 PG-only 语法 |

---

## 6. 配置与环境变量

| 变量名 | 服务 | Cloud 值 | Desktop 值 |
|--------|------|----------|-----------|
| `ACL_DB_DRIVER` | core | `postgres` | `sqlite` |
| `ACL_DB_DSN` | core | `postgres://...` | `/path/to/main.db` |
| `LAZYMIND_DATABASE_URL` | auth-service | `postgresql+psycopg://...` | `sqlite:///path/to/auth.db` |
| `DATABASE_DRIVER` | scan-control-plane | `postgres` | `sqlite` |
| `DATABASE_DSN` | scan-control-plane | `postgres://...` | `/path/to/scan.db` |

---

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| SQLite 文件权限不足 | 服务启动失败，日志记录路径和权限信息 |
| 数据库文件损坏 | 记录日志，提示用户使用备份恢复 |
| SQLITE_BUSY（写冲突） | busy_timeout=5000ms 等待；超时后返回错误 |
| Migration 失败 | 服务拒绝启动，记录失败的 migration 版本 |
| 磁盘空间不足 | SQLite 写入失败，记录错误并通知前端 |

---

## 8. 安全考量

- SQLite 文件存放在用户 `%APPDATA%` 目录下，受用户权限保护。
- 不在 SQLite 中存储明文密码（密码使用 bcrypt hash，与现有行为一致）。
- SQLite 文件不加密（MVP 阶段），后续可考虑 SQLCipher。
- 诊断包导出时不包含 SQLite 文件本身。
- 备份功能需要考虑原子性（WAL checkpoint 后复制）。

---

## 9. 测试策略

### 9.1 单元测试

- Go core：在 SQLite 上运行现有 store 层单元测试。
- Python auth-service：在 SQLite 上运行现有 repository 层测试。
- Migration：验证所有 up/down migration 可执行。

### 9.2 兼容性测试

- 对每个 migration 文件，分别在 PostgreSQL 和 SQLite 上执行，确认行为一致。
- 对 GORM 模型操作（CRUD），验证 PostgreSQL 和 SQLite 结果一致。
- 测试 `busy_timeout` 场景：模拟一个进程持锁时另一个进程写入。

### 9.3 数据完整性测试

- 创建数据 → 重启服务 → 数据仍在。
- 外键约束生效（删除被引用行报错）。
- WAL 模式下并发读不阻塞。

---

## 10. Cloud 模式兼容

- Cloud 模式继续使用 PostgreSQL，环境变量 `ACL_DB_DRIVER=postgres`。
- SQLite migration 目录是新增的，不影响 PostgreSQL migration。
- `configureSQLite()` 仅在 driver=sqlite 时调用。
- Alembic `render_as_batch=True` 仅在 SQLite 时启用，PostgreSQL 行为不变。
- 不删除任何 PostgreSQL-specific 代码，只添加 SQLite 分支。

---

## 11. 验收标准

- [ ] core 使用 SQLite 启动成功，migration 全部通过。
- [ ] auth-service 使用 SQLite 启动成功，Alembic migration 全部通过。
- [ ] scan-control-plane 使用 SQLite 启动成功。
- [ ] 创建用户、会话、技能等基础 CRUD 操作正常。
- [ ] 服务重启后数据持久化。
- [ ] 多个服务不写同一个 SQLite 文件。
- [ ] Cloud 模式（PostgreSQL）回归测试通过。
- [ ] WAL 模式启用（`PRAGMA journal_mode` 返回 `wal`）。
- [ ] `busy_timeout` 生效（短暂写冲突不报错）。

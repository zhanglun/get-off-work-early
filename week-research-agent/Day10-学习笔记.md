# AI Agent 从零实现 · 学习笔记（Day 10）

> 对应：单 Agent 打磨收尾（持久化 Memory + Token 成本统计）
> 核心升级：**Memory 从内存到 SQLite（重启不丢）+ 量化每次研究的 token 成本**

> 📂 **关联代码**
> - 持久化 Memory：`server/storage.py`（SQLite 封装，`get_history`/`append_message`/`get_or_create_session`）、`server/main.py`（用 storage 替换内存 dict，接口兼容）
> - Token 统计：`research_agent/state.py`（+`prompt_tokens`/`completion_tokens`/`total_tokens` + `add_usage`）、`researcher.py` + `reporter.py`（每次 LLM 调用后 `state.add_usage(response.usage)`）、`server/schemas.py`（响应含 `tokens`）
> - 数据：`data/sessions.db`（SQLite，运行时生成，gitignore）
> - 运行：`python -m server` → 重启服务，记忆不丢

---

## 〇、心智模型：从"能用"到"可用"

Day 8 做了 Session Memory，但有个硬伤——**存在内存里，服务重启就全忘**。

```
Day 8 的 Memory：
  服务运行中 → 记得对话 ✅
  服务重启   → SESSIONS 清空 → 全部遗忘 ❌
```

Day 10 解决这个问题：把 Memory 从内存搬到 SQLite（文件数据库），重启也不丢。

同时加了个生产必备能力：**Token 成本统计**——每次研究烧多少 token，心里有数。

> 🔑 一句话：**Day 8 造了"记忆"，Day 10 给记忆装了"硬盘"。**

---

## 一、持久化 Memory：内存 → SQLite

### 1.1 为什么用 SQLite

| 方案 | 特点 | 适合 |
|------|------|------|
| 内存 dict（Day 8） | 最快，但重启即丢 | 原型/学习 |
| **SQLite（Day 10）** | 文件存储，零配置，重启不丢 | **学习项目/单机** |
| Redis | 内存级速度，支持过期/集群 | 生产会话存储 |
| PostgreSQL | 扛并发，支持复杂查询 | 生产多用户 |

**选 SQLite 的理由**：零配置（Python 自带）、单文件、足够演示持久化原理。生产再升级到 Redis/PostgreSQL。

### 1.2 表设计

```sql
CREATE TABLE messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,      -- user / assistant
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_session ON messages(session_id);  -- 加速按会话查询
```

**为什么一行存一条消息**（而不是一个会话存一行 JSON）：
- 查询灵活（能按时间/会话/角色筛）
- 追加高效（不用读出整个 JSON 再写回）
- 符合关系数据库范式

### 1.3 核心接口（storage.py 封装）

```python
def get_history(session_id) -> List[Dict]:    # 取某会话全部历史
def append_message(session_id, role, content) # 追加一条
def session_exists(session_id) -> bool        # 检查会话是否存在
def get_or_create_session(session_id=None)    # 兼容 Day 8 签名
```

**关键设计**：`get_or_create_session` 的签名和 Day 8 内存版完全一致。这样 main.py 改动最小——只换 import，业务逻辑不动。**这就是"关注点分离"的价值。**

### 1.4 线程安全：SQLite 的写锁

```python
_db_lock = threading.Lock()

def append_message(...):
    with _db_lock:  # 串行化写操作
        with _get_conn() as conn:
            conn.execute(...)
```

SQLite 写操作会锁整个数据库文件。多线程并发写会报 `database is locked`。用全局锁串行化写操作——这是 SQLite 多线程的标准解法。

### 1.5 实测验证：重启不丢

```
第 1 次启动：研究"Rust 是什么" → 存进 SQLite（2 条消息）
服务重启（pkill + 重启）
第 2 次启动：问"它有什么特点"
  → 加载历史（2 条）
  → Agent 理解"它"=Rust ✅
  → 存回（共 4 条）
```

**这是持久化的核心证明：服务重启后，Agent 仍记得之前的对话。**

---

## 二、Token 成本统计：量化每次研究的开销

### 2.1 为什么需要

生产环境的三个现实问题：
1. **要算钱**：LLM 按 token 计费，不知道用量就是"闭眼花钱"
2. **要预警**：某次研究突然烧 10 万 token？可能是 bug
3. **要优化**：哪个阶段最烧 token？优化哪里效果最大

### 2.2 实现原理

智谱 SDK 的 response 自带 usage 字段：

```python
response = client.chat.completions.create(...)
response.usage
# CompletionUsage(prompt_tokens=8488, completion_tokens=985, total_tokens=9473)
```

- `prompt_tokens`：输入（发给 LLM 的，包括 system + 历史 + 问题）
- `completion_tokens`：输出（LLM 生成的）
- `total_tokens`：总和

### 2.3 代码实现

**State 加字段 + 累加方法**：

```python
@dataclass
class ResearchState(_BaseAgentState):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    def add_usage(self, usage):
        if usage:
            self.prompt_tokens += usage.prompt_tokens
            self.completion_tokens += usage.completion_tokens
            self.total_tokens += usage.total_tokens
```

**每次 LLM 调用后累加**（researcher 2 处 + reporter 1 处）：

```python
response = client.chat.completions.create(...)
state.add_usage(response.usage)  # ← 累加这一次的 token
```

### 2.4 实测数据

```
课题："Python 是什么"
Token: 输入 8488 + 输出 985 = 9473
估算成本: ¥0.0947（按 0.01元/千token）
```

**数据解读**：
- 输入是输出的 8.6 倍——因为要发 system prompt + 历史 + 工具 schema + 搜索结果
- 单次研究约 1 毛钱，免费额度（1 亿 token）能撑约 13000 次

---

## 三、踩坑记录

### 🕳️ 踩坑 1：僵尸进程导致"测试假通过"

**现象**：验证持久化时，服务重启后 Agent "记得"历史，但数据库是空的。

**原因**：之前调试启动了多个 server 进程没杀干净。`pkill -f "python -m server"` 杀不彻底（PID 文件和实际进程对不上）。curl 打到了一个旧进程（还在用内存 SESSIONS），它"记得"是因为内存里还有，但 SQLite 是空的。

**解决**：用 `lsof -ti :8000` 精确找到占用端口的进程，`kill -9` 彻底清理。

**教训**：**调试时启动的服务要记录 PID 并清理**。端口占用导致"请求打到旧代码"是调试 Web 服务的经典坑。验证持久化必须"真正重启"，不能有旧进程残留。

### 🕳️ 踩坑 2：SQLite 多线程并发写

**预见的问题**：FastAPI 的 StreamingResponse 用线程池，多个请求并发写 SQLite 会报 `database is locked`。

**预防**：用 `threading.Lock()` 串行化所有写操作。

**教训**：**SQLite 不是为高并发设计的**。学习项目加锁够用，生产必须换 Redis/PostgreSQL。

---

## 四、难点与思考

### 思考 1：现在的 Memory 算生产级吗？

**不算。** 还差三个关键能力：

| 缺什么 | 后果 | 生产方案 |
|--------|------|---------|
| **user_id 多用户隔离** | 任何人猜到 session_id 就能看到别人对话 | 加 user_id + 权限校验 |
| **并发能力** | SQLite 文件锁，高并发报错 | 换 Redis/PostgreSQL |
| **加载策略** | 对话一长，全量塞进 prompt 会撑爆上下文 | 最近N条/摘要/向量检索 |

**现状定位**：能用的 Memory（Level 1），不是生产级（Level 2-3）。对学习项目够，真上线要加固。

### 思考 2：成本意识是工程师的基本功

Day 10 加了 token 统计后，第一次知道"单次研究约 1 毛钱"。这个数据改变认知：

```
没统计前：随便跑，反正免费额度够
统计后：  带历史记忆后 token 会涨（历史拼进 prompt）
         → 长对话成本会指数增长
         → 必须做"摘要压缩"控制成本
```

**成本意识倒逼架构优化**——这是生产级 AI 系统的核心驱动力。

### 思考 3：关注点分离的回报

Day 10 换存储后端（内存→SQLite），main.py 几乎没改业务逻辑——只换 import 和调用。

```python
# Day 8
SESSIONS[session_id] = [...]           # 内存
history = SESSIONS.get(session_id, [])

# Day 10
storage.append_message(...)             # SQLite
history = storage.get_history(session_id)
```

**因为 storage 的接口和内存版兼容**，业务逻辑（取历史 → 调 Agent → 存回）一行没动。这就是 Day 8 把存储逻辑封装成函数的价值——**换后端不改业务**。

---

## 五、Day 8 vs Day 10 对比

| 维度 | Day 8（内存版） | Day 10（SQLite 版） |
|------|---------------|-------------------|
| 存储 | 内存 dict | SQLite 文件 |
| 重启 | 全部丢失 | 持久保留 |
| 并发 | 天然安全（无共享） | 需要锁 |
| 配置 | 零配置 | 零配置（Python 自带） |
| 升级路径 | — | → Redis/PostgreSQL |
| Token 统计 | ❌ | ✅ |

---

## 六、关键概念速查表

| 术语 | 含义 |
|------|------|
| **SQLite** | 文件型数据库，零配置，适合单机/学习 |
| **持久化** | 数据存到磁盘，重启不丢 |
| **user_id 隔离** | 生产级 Memory 必须按用户隔离数据 |
| **加载策略** | 历史很长时取哪些（最近N条/摘要/检索） |
| **prompt_tokens** | 发给 LLM 的 token（输入） |
| **completion_tokens** | LLM 生成的 token（输出） |
| **response.usage** | LLM API 返回的 token 用量字段 |

---

## 七、当前进度 & 下一步

```
✅ Day 1-7：能用的 Agent（从零到部署）
✅ Day 8 A：Session Memory（多轮对话）
✅ Day 8 B+C：Workflow（大课题拆解）
✅ Day 9：  Streaming（实时进度）
✅ Day 10： 持久化 Memory + Token 统计   ← 完成，单 Agent 打磨彻底闭环
⬜ RAG（Lesson 04）：让 Agent 读私有文档   ← 下一步
```

**单 Agent 打磨彻底完成。** 接下来进入 RAG——让 Agent 能读 PDF/文档/知识库，能力质变。

---

## 附：文件结构

```
server/
├── storage.py     ← Day 10 新增：SQLite 持久化封装
├── main.py        ← 改：用 storage 替换 SESSIONS
└── schemas.py     ← 改：ResearchMetadata 加 tokens 字段

research_agent/
├── state.py       ← 改：加 token 字段 + add_usage
├── researcher.py  ← 改：每次 LLM 调用后累加 usage
└── reporter.py    ← 改：同上

data/              ← 运行时生成（gitignore）
└── sessions.db    ← SQLite 数据库文件
```

# Agent 架构认知笔记

> 这份笔记记录 Day 7 完成后，在思考"产品化/生产化"过程中产生的架构认知。
> 和 Day 1-7 的学习笔记不同——那些记"怎么写 Agent"，这里记"怎么理解 Agent 在产品中的位置"。
>
> 所有认知都来自亲手实现的 Research Agent（Day 1-7），不是纸上谈兵。

---

## 一、什么才算 Agent？三要素是铁律

### 1.1 严格定义

> **Agent = LLM + Tool + Loop**，三要素缺一不可。

| 要素 | 作用 | 缺了会变成什么 |
|------|------|--------------|
| **LLM** | 大脑，做决策 | 普通程序（if/else 流程） |
| **Tool** | 双手，能操作外部世界 | 聊天机器人（只会说不会做） |
| **Loop** | 循环，能"看结果决定下一步" | 带工具的问答（单次调用） |

### 1.2 常见的"伪 Agent"

业界把"Agent"这个词用烂了。用三要素可以一眼识破：

| 产品宣称 | 实际是什么 | 三要素验证 | 是 Agent 吗 |
|---------|-----------|-----------|:-----------:|
| "GPT Store 里的 Agent" | 大部分是带 prompt 的聊天机器人 | 只有 LLM | ❌ |
| "AI 助手帮你查天气" | LLM + 单次 API 调用 | 缺 Loop | ❌ |
| ChatGPT 的 Web Search | LLM + 单次搜索 | 缺 Loop | ⚠️ 半个 |
| **我们的 Research Agent** | LLM + 多工具 + while 循环 | 三要素齐全 | ✅ |

### 1.3 判断 Agent 的三问

看到一个"AI 产品"，用这三问判断：

```
1. 它能调工具吗？      ❌ 聊天机器人    ✅ 继续
2. 它会循环多步吗？    ❌ 带工具的问答   ✅ 继续
3. 它会自己决定下一步吗？❌ 固定流水线    ✅ Agent
```

### 1.4 我们项目的分界线

```
Day 1：    一问一答（只有 LLM）              → 不是 Agent
Day 1-2：  加了 Tool Calling                  → 接近了
Day 3：    加了 while 循环（Loop）            → ✅ 是 Agent 了
            ↑ 这一行 while message.tool_calls: 是分界线
Day 4-7：  加健壮性 / 评估 / 部署             → 完整 Agent 产品
```

> 🔑 **Day 3 的 `while message.tool_calls:` 循环，是"聊天机器人"和"Agent"的分界线。**

---

## 二、Agent 的形态 vs 本质

### 2.1 核心认知

> **"一问一答"是用户交互的形态，"Agent"是内部实现的本质。两者不矛盾。**

一个 Agent 可以被包成任何形态：
- 一问一答（ChatGPT 风格）
- 多轮引导式对话
- 定时自动任务
- 群聊机器人

**判断是不是 Agent，看内部有没有三要素，不看外面长啥样。**

### 2.2 我们的 Day 7 就是"一问一答形态的 Agent"

```
用户视角（Day 7 网页）：
  你：输入 "LangChain 是什么"
  Agent：（等 30 秒）
  Agent：返回研究报告

  ← 这就是一问一答

内部实际（Day 5 两步法）：
  search_web → fetch_url → 综合 → 生成报告
  ← 这就是 Agent 的 Loop
```

### 2.3 好的产品设计原则

> **内部复杂，界面简单。** 把 Agent 的工具和循环藏起来，把简单留给用户。

| 如果让用户看到内部 | 后果 |
|------------------|------|
| "我要先调 search_web..." | 用户：说人话 |
| 每步都问"继续吗？" | 用户：烦死了 |
| 工具 trace 全暴露 | 用户：看不懂 |

**但有些场景需要把 Loop"露出来"**：
- 危险操作要用户确认（Human in the Loop）
- 多轮研究让用户选方向
- 流式输出展示思考过程（ChatGPT 的 thinking 展示）

---

## 三、接口的本质：函数的网络外壳

### 3.1 一句话本质

> **接口（API）的本质：通过网络调用一个函数。**

```
接口（HTTP）     =    函数（Python）
─────────────        ─────────────
URL 路径        ↔    函数名        /api/research ↔ def research
请求 body       ↔    函数参数      {"topic":"x"} ↔ req.topic
响应 body       ↔    返回值        return {...}  ↔ HTTP 响应
HTTP 方法       ↔    调用方式      POST          ↔ 创建/执行类操作
```

### 3.2 我们的 Day 7 代码实证

```python
@app.post("/api/research")          # ← 这是"接口"（外壳）
async def research(req):            # ← 这是"函数"（内核）
    state = run_research_agent(req.topic)
    return state.report
```

**装饰器 `@app.post(...)` 干的事**：把普通函数"注册"成网络可达的接口。

### 3.3 这就是 RPC（远程过程调用）

```
本地调用（Day 5 命令行）：
    result = run_research_agent("LangChain")     ← 内存里直接调

远程调用（Day 7 HTTP）：
    客户端 ──HTTP──→ 服务端 ──→ run_research_agent("LangChain")
                                 ↑ 实际跑的函数
```

REST、GraphQL、gRPC、WebSocket 都是 RPC 的变体，**本质都是"远程调函数"**。

### 3.4 框架做了什么

| 你写的 | 框架自动做的 |
|-------|------------|
| `def research(req):` | 监听端口、解析 HTTP |
| `return result` | dict → JSON 序列化 |
| `req: ResearchRequest` | 自动校验请求格式 |
| 函数体 | 异常处理、状态码 |
| — | 生成 API 文档（/docs） |
| — | 并发处理多请求 |

**框架 = 把"网络传输"包了，让你专注写函数。**

### 3.5 架构直觉

理解了"接口就是远程函数"，能看懂很多架构：

| 现象 | 本质 |
|------|------|
| 微服务 | 把大函数拆成小函数，独立部署 |
| API 网关 | 一个大函数，转发到小函数 |
| Serverless | 函数即服务，请求来才跑 |
| LangChain Tool | 工具是函数，LLM"调用"工具 = 远程过程调用 |

> 🔑 **整个分布式系统/微服务，都建立在"远程调函数"这个简单概念上。**

---

## 四、Agent 不是"驻留的服务"，而是"被触发的代码"

### 4.1 最大的认知误区

❌ **错误理解**：Agent 是一个持续运行的进程，用户"连接"到它，像连数据库。

✅ **正确理解**：Agent 是一段代码。请求来了跑一次，跑完就结束。

### 4.2 代码实证

```python
@app.post("/api/research")
async def research(req: ResearchRequest):
    state = run_research_agent(req.topic)  # ← state 是局部变量
    return state.report
```

**`state` 是函数内的局部变量**——每次请求创建一个新的，跑完销毁。

### 4.3 多用户同时访问的本质

```
用户 A 请求 → 创建 state_A → 跑完 → 销毁
用户 B 请求 → 创建 state_B → 跑完 → 销毁
用户 C 请求 → 创建 state_C → 跑完 → 销毁

state_A / state_B / state_C 互不可见 → 天然隔离
```

**Agent 代码只有一份，运行实例可以有 N 个**——就像一个菜谱（代码），三个厨师（请求）同时在炒不同的菜（实例）。

### 4.4 和普通 Web 接口的对比

| 方面 | 普通 Web 接口 | Agent 接口 |
|------|-------------|-----------|
| 请求处理 | 每个独立 | 每个独立 ✅ 一样 |
| 数据隔离 | 局部变量 / DB 行级 | 局部变量 ✅ 一样 |
| 并发机制 | 线程池 / 异步 | 线程池 ✅ 一样 |
| **唯一区别** | 快（毫秒） | **慢（30-60 秒）** |

> 🔑 **Agent 接口和普通接口的唯一本质区别是"慢"。** 这个"慢"带来超时、并发、资源占用问题，但架构模式没变。

---

## 五、用户数据隔离的三层

### 5.1 三层隔离（我们在最底层）

| 层次 | 隔离方式 | 数据存活 | 我们在哪 |
|------|---------|---------|---------|
| **请求级** | 局部变量 | 单次请求内 | ✅ Day 7 |
| **会话级** | session_id + 服务端存储 | 浏览器关闭前 | ⬜ |
| **用户级** | user_id + 数据库 | 永久 | ⬜ |

### 5.2 请求级（我们已有的）

每个请求独立，跑完即忘。天然隔离、天然可扩展。坏处是"Agent 不记得你上次问过什么"。

### 5.3 会话级（多轮对话需要）

```python
sessions = {
    "session_A": {"messages": [...], "topic": "..."},
    "session_B": {"messages": [...], "topic": "..."},
}

@app.post("/api/research")
async def research(req, session_id: str):
    state = sessions[session_id]  # 按 session_id 取各自的 state
```

ChatGPT 的"一个对话"就是一个 session。

### 5.4 用户级（生产标配）

```python
# 数据库表：每行带 user_id
research_history:
  id | user_id | topic | report | created_at

# 查询强制带 user_id（行级隔离）
SELECT * FROM research_history WHERE user_id = current_user.id
```

这才是真正的"按用户隔离数据"：
- **认证（AuthN）**：你是谁？（JWT / OAuth）
- **授权（AuthZ）**：你能看什么？（user_id 过滤）
- **存储**：每条数据带 user_id 标签

---

## 六、并发与扩展：能服务多少用户

### 6.1 并发的真正实现

FastAPI 把同步函数丢线程池跑：

```
FastAPI 主循环（单线程，处理 IO）
    ├── 请求 A → 线程池 Worker 1 → run_research_agent（阻塞 30s）
    ├── 请求 B → 线程池 Worker 2 → run_research_agent（阻塞 30s）
    └── 请求 C → 线程池 Worker 3 → run_research_agent（阻塞 30s）
```

### 6.2 三个真实瓶颈

| 瓶颈 | 说明 | 解法 |
|------|------|------|
| **LLM API 限速** | 免费档 QPS 低，100 用户同时研究会 429 | 付费升 QPS / 队列 / 缓存 |
| **线程池耗尽** | 默认约 40，超了排队 | 加大线程池 / 异步架构 |
| **请求超时** | 浏览器 30s 超时，Agent 要 30-60s | 异步任务队列 |

### 6.3 生产级架构：异步任务队列

AI 任务都慢，标准做法是异步：

```
现在（Day 7 同步）：
  POST → 等 30 秒 → 返回结果（可能超时）

生产（异步队列）：
  POST → 1 秒返回 task_id
  GET /task/{id} → 轮询状态（pending/running/done）
  后台 Worker 慢慢跑，跑完存结果
```

### 6.4 完整生产架构图

```
                    用户们
               A  B  C  ...  N
                │  │  │       │
                ▼  ▼  ▼       ▼
         ┌─────────────────────────┐
         │  负载均衡器（Nginx/LB）   │
         └─────────────────────────┘
                │
        ┌───────┼───────┐
        ▼       ▼       ▼
     ┌────┐ ┌────┐ ┌────┐
     │服务1│ │服务2│ │服务3│     ← 多个 FastAPI 实例（水平扩展）
     └────┘ └────┘ └────┘
        │       │       │
        └───────┼───────┘
                ▼
     ┌─────────────────────┐
     │  共享存储              │
     │  - PostgreSQL（用户数据）│  ← 按 user_id 隔离
     │  - Redis（会话/缓存）   │
     │  - 向量库（Memory）     │
     └─────────────────────┘
                │
                ▼
     ┌─────────────────────┐
     │  LLM API（智谱/OpenAI）│  ← 真正的瓶颈
     └─────────────────────┘
```

---

## 七、生产级 Agent 服务的完整能力清单

按成熟度对号入座，看清 Day 7 在哪、后面要加什么：

| 能力 | 生产级 | Day 7 现状 | 后续方向 |
|------|--------|-----------|---------|
| 请求级数据隔离 | ✅ | ✅ 已有 | — |
| 用户认证 | JWT/OAuth | ❌ | 加 Auth |
| 用户级数据隔离 | DB + user_id | ❌ | 加 PostgreSQL |
| 长任务处理 | 异步队列 | ❌ 同步阻塞 | Celery + Redis |
| 并发扩展 | 多进程/多机 | ⚠️ 单进程 | Docker + K8s |
| 跨会话记忆 | 向量库 | ❌ | Lesson 05 Memory |
| 监控告警 | Prometheus | ❌ | 加监控 |
| API 限流 | Rate Limiter | ❌ | 加限流中间件 |

---

## 八、三个生产级的核心模式

### 模式 1：无状态服务（Day 7 就是）

服务本身不存数据，每次请求独立。天然隔离、随便扩展。**主流选择。**

### 模式 2：异步任务队列（解决"慢"）

```python
@app.post("/api/research")
async def research(req):
    task_id = queue.enqueue(run_research_agent, req.topic)
    return {"task_id": task_id}  # 1 秒内返回

@app.get("/api/research/{task_id}")
async def get_result(task_id):
    return results.get(task_id)  # 客户端轮询
```

AI 服务的标准做法（因为 AI 任务都慢）。

### 模式 3：持久化 Agent（Lesson 05 Memory）

```python
@app.post("/api/research")
async def research(req, user_id):
    memory = load_user_memory(user_id)        # 加载这个用户的记忆
    state = ResearchState(topic=req.topic, memory=memory)
    state = run_research_agent(state)
    save_user_memory(user_id, state)          # 存回这个用户的记忆
    return state.report
```

让 Agent "记住"每个用户的历史和偏好。

---

## 九、关键认知总结（一句话系列）

| 认知 | 一句话 |
|------|--------|
| **Agent 的定义** | LLM + Tool + Loop，缺一不可 |
| **形态 vs 本质** | 形态是给用户看的（简单），本质是内部的（完整） |
| **接口的本质** | 接口 = 函数的网络外壳 |
| **Agent 的运行模型** | 不是驻留的进程，是被触发的代码 |
| **多用户隔离** | 靠局部变量（请求级）+ user_id（用户级） |
| **Agent 接口 vs 普通接口** | 唯一区别是"慢"，架构模式一样 |
| **能服务多少用户** | 不取决于 Agent 代码，取决于 LLM API + 服务器 + 任务架构 |
| **好的产品设计** | 内部复杂，界面简单 |

---

## 十、这些认知从哪来

所有认知都来自亲手实现的 Research Agent（Day 1-7），不是纸上谈兵：

| 认知 | 来自哪天的实践 |
|------|--------------|
| Agent 三要素 | Day 3 写出 `while message.tool_calls:` |
| 形态 vs 本质 | Day 7 把 Agent 包成一问一答 Web 服务 |
| 接口 = 远程函数 | Day 7 写 `@app.post` 把函数暴露成 HTTP |
| 请求级隔离 | Day 7 写 `state = run_research_agent(req.topic)` |
| Agent 慢带来问题 | Day 6 评估时发现单次要 30-60 秒 |
| 外部依赖不可靠 | Day 3/5/7 多次踩 DuckDuckGo 超时 |

> 🔑 **这些认知之所以深刻，是因为有代码实证。** 没有亲手写过，看再多文章也只是"知道"，不是"理解"。

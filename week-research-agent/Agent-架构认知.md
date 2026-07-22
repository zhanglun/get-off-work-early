# Agent 架构认知笔记

> 这份笔记记录 Day 7 完成后，在思考"产品化/生产化"过程中产生的架构认知。
> 和 Day 1-7 的学习笔记不同——那些记"怎么写 Agent"，这里记"怎么理解 Agent 在产品中的位置"。
>
> 所有认知都来自亲手实现的 Research Agent（Day 1-7），不是纸上谈兵。

> 📂 **关联代码**（这篇是架构思考，关联整个项目的关键位置）
> - Agent 三要素实证：`research_agent/researcher.py`（while 循环 = Loop）
> - 接口 = 远程函数：`server/main.py`（`@app.post` 把函数暴露成 HTTP）
> - 请求级隔离：`server/main.py`（每次请求独立 state）
> - messages 标准：`research_agent/researcher.py`（role/content 结构）
> - Session Memory：`server/main.py` + `server/storage.py`（SQLite 持久化）
> - 多用户/生产架构：尚未实现（笔记里标了 Level 1-4 路线）
> - 核心代码位置见第十二章"这些认知从哪来"的对照表

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

## 九、Agent vs Workflow：决策层 vs 执行层（核心架构认知）

### 9.1 最容易混淆的一对概念

学 Day 8 Workflow 时，很容易把 Agent 和 Workflow 理解成"二选一"的替代关系（"用 Workflow 就不用 Agent 了"）。**这是错的。**

更准确地说，它们通常处于不同抽象层级：**Workflow**封装可预测的步骤；**上层 Agent**可以根据目标和观察结果选择、组合或重试这些 Workflow。"Workflow 是手、Agent 是脑"是帮助理解的类比，不代表所有系统都必须采用这一层级。

### 9.2 分层模型

```
                 用户目标
                     │
                     ▼
              Agent（决策层 / 脑）
      ┌──────────────┴──────────────┐
      │                             │
  决定下一步                    判断是否结束
  （调哪个 Workflow）
      │
      ▼
 Workflow（执行层 / 手）
      │
      ├── 步骤 1（如：生成代码）
      ├── 步骤 2（如：编译）
      ├── 步骤 3（如：运行测试）
      └── 步骤 4（如：输出结果）
```

- **Workflow**：封装一组**可复用、可预测**的执行步骤（固定流水线）
- **上层 Agent**：根据当前目标和环境，**决定什么时候调用哪个 Workflow**，是否重试、是否换方案、是否继续探索

### 9.3 为什么是互补，不是二选一

| 层 | 职责 | 特点 |
|----|------|------|
| **上层 Agent（决策层）** | 决定"调哪个 Workflow""要不要换方案" | 自主决策、动态规划、灵活 |
| **Workflow（执行层）** | 封装"固定步骤"（如 plan→execute→synthesize） | 稳定、可靠、可预测 |

两者互补：
- **Workflow 提供稳定可靠的执行能力**
- **Agent 提供自主决策和动态规划能力**

> 🔑 **一个成熟的 AI 系统，会把复杂任务拆成多个 Workflow，再由 Agent 在运行时根据观察结果动态编排这些 Workflow**——既稳定又灵活。

### 9.4 用业界产品验证这个模型

**Cursor（AI 编程工具）**：

```
Agent（决策层）：
  "用户要加登录功能"
  → 调"代码分析 Workflow"（读文件→分析依赖→输出结构）
  → 观察结果
  → 调"代码生成 Workflow"（生成→格式化→写文件）
  → 观察结果（测试失败）
  → 调"调试 Workflow"（读错误→定位→修复→测试）
  → 观察结果（测试通过）
  → "任务完成"

Workflow（执行层，各自封装固定步骤）：
  代码分析 Workflow = 固定流水线
  代码生成 Workflow = 固定流水线
  调试 Workflow = 固定流水线
```

**Agent 在 Workflow 之间动态跳转**，Workflow 内部是固定步骤。

### 9.5 对我们项目的现状与启示

按这个模型，我们的项目现状和进化方向：

```
现状（已实现）：
  run_workflow_agent（固定 Workflow 编排）
    ├─ Planner：LLM 拆解子课题
    ├─ Executor：串行调用多个 run_research_agent
    │   └─ Research Agent：自主决定搜索 / 抓取 / 停止
    └─ Synthesizer：LLM 汇总子报告

  注：use_workflow 是调用方传入的开关；当前没有上层 Agent
      根据运行结果动态选择不同 Workflow。

进化方向（成熟形态）：
  Agent（决策层）
    ├─ 调"研究 Workflow"（现在的 run_workflow_agent）
    ├─ 调"对比 Workflow"（可加）
    ├─ 调"翻译 Workflow"（可加）
    └─ 根据观察结果动态决定下一个 Workflow
```

### 9.6 核心认知（一句话）

> **Agent 和 Workflow 不是"二选一"，可以组合在不同层级。** 当前项目是固定 Workflow 复用多个 Research Agent；成熟形态可再由上层 Agent 动态编排多个 Workflow。

---

## 十、messages 结构：LLM 对话的行业标准

### 9.1 这是事实标准（de facto standard）

`{"role": "...", "content": "..."}` 不是某家厂商发明的，而是 **OpenAI 先定义、全行业跟进**的事实标准：

```
2022.11  OpenAI 发布 ChatGPT API，定义 messages 结构
         ↓
2023     各厂商为兼容生态，纷纷采用相同结构
         ↓
现在     成为事实标准
```

**实证**：我们用的智谱 SDK 和 OpenAI SDK 几乎一模一样：

```python
# 智谱 GLM（我们用的）
client.chat.completions.create(
    model="glm-4-flash",
    messages=[{"role": "user", "content": "hello"}],
)

# OpenAI GPT
client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "hello"}],
)
# 结构完全一样！连方法名都一样
```

**意义**：这套结构是**通用技能**——换任何主流 LLM（智谱/Claude/Gemini/通义）都能用。

### 9.2 三种核心 role

| role | 含义 | 谁产生 | 数量 |
|------|------|--------|------|
| **system** | 身份/规则设定 | 开发者 | 0-1 个（放最前） |
| **user** | 用户说的话 | 用户 | 1+ 个 |
| **assistant** | AI 的回答 | AI（存历史时） | 0+ 个 |
| **tool** | 工具返回结果 | 程序 | 0+ 个（Tool Calling 时） |

**关键约定**：对话按时间顺序排列，user 和 assistant 交替出现。

### 9.3 为什么大家都跟 OpenAI 走

| 原因 | 说明 |
|------|------|
| 生态兼容 | 开发者代码能无缝切换厂商（换 model 参数就行） |
| 工具链复用 | LangChain/LlamaIndex 只需支持一套结构 |
| 迁移成本低 | 从 OpenAI 换智谱换 Claude，messages 结构不变 |

### 9.4 LLM "记忆"的真相

> **LLM 本身是无状态的，它没有记忆。** 它之所以"记得"对话，是因为你每次都把历史 messages 重新喂给它。

```python
# Day 7（无记忆）：每次只给 system + 本次提问
messages = [
    {"role": "system", "content": "你是研究助手"},
    {"role": "user", "content": "它和 AutoGen 比呢"},  # ← "它"是谁？LLM 不知道
]

# Day 8（有记忆）：把历史对话塞进去
messages = [
    {"role": "system", "content": "你是研究助手"},
    {"role": "user", "content": "LangChain 是什么"},           # 历史
    {"role": "assistant", "content": "LangChain 是开源框架..."}, # 历史
    {"role": "user", "content": "它和 AutoGen 比呢"},  # ← "它"=LangChain！
]
```

**没有黑魔法**——所谓"Agent 的记忆"，本质就是 messages 列表的拼接。ChatGPT/Claude 任何"记住对话"的功能，原理都是这个。

### 9.5 messages 顺序的讲究

```
正确顺序：[system] → [历史对话...] → [本次提问]

- system 必须在最前：LLM 对它有特殊处理（角色定位）
- 本次提问必须在最后：LLM 才知道"该回答什么"
- 历史插在中间：提供上下文
```

类比给新同事交代任务：先定身份（你是研究助手）→ 给上下文（昨天聊了 LangChain）→ 提需求（现在研究 AutoGen）。

---

## 十一、生产环境 Memory 怎么存、怎么加载

### 10.1 我们的 Day 8 现状（Level 0）

```python
# 内存字典——重启即丢、单机、无过期
SESSIONS = {"sess_001": [{"role": "user", "content": "..."}, ...]}
```

学习项目够用，生产环境完全不行。

### 10.2 生产环境的四种存储方案

#### 方案 1：Redis（会话级，最主流）

90% 的 Web 应用存会话数据的方式：

```python
import redis, json
r = redis.Redis(host='localhost', port=6379)

r.set("session:sess_001", json.dumps(messages))           # 存
data = json.loads(r.get("session:sess_001"))              # 取
r.setex("session:sess_001", 1800, json.dumps(messages))   # 30 分钟过期
```

| 特点 | 说明 |
|------|------|
| 极快 | 内存存储 |
| 自动过期 | 内置 TTL，不活动自动清理 |
| 多服务器共享 | 天然支持（解决单机问题） |
| 适合 | 临时会话数据 |

#### 方案 2：数据库（用户级，持久化）

长期保存对话历史（像 ChatGPT 翻历史记录）：

```sql
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64),
    user_id VARCHAR(64),
    role VARCHAR(16),
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 加载某会话历史
SELECT role, content FROM messages
WHERE session_id = 'sess_001' ORDER BY created_at ASC;
```

#### 方案 3：文档数据库（MongoDB）

一个会话存成一个文档，更自然：

```python
{
    "_id": "sess_001",
    "user_id": "user_A",
    "messages": [
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."},
    ]
}
```

#### 方案 4：向量数据库（智能检索）

对话太长时，只取**和当前问题相关的**几条：

```
当前问题向量化 → 在向量库找最相似的历史 → 只塞这几条进 prompt
```

这是 RAG（检索增强）在 Memory 上的应用。

### 10.3 加载策略：Memory 的真正技术含量

存 messages 不难，难的是"历史很长时加载哪些"：

| 策略 | 做法 | 优缺点 |
|------|------|--------|
| **最近 N 条** | 只取最近 20 条 | 简单，但早期对话全丢 |
| **摘要 + 最近** | 早期 50 条 LLM 摘成 1 条 + 最近 10 条原文 | ChatGPT 用的方案，省 token |
| **向量检索** | 当前问题向量化，找最相关的 3 条 | 最智能，只加载相关的 |

### 10.4 为什么不能全塞进 prompt

| 问题 | 原因 |
|------|------|
| 上下文窗口限制 | GLM-4-Flash ~128K token，超了报错 |
| 成本 | token 越多越贵 |
| 效果下降 | prompt 太长，LLM 注意力分散 |
| 延迟 | 输入越长，推理越慢 |

### 10.5 Memory 的成熟度层级

```
Level 0：内存 dict（Day 8 现状）  → 重启即丢、单机
Level 1：Redis                  → 生产标配，快、共享、过期
Level 2：+ PostgreSQL           → 持久历史、用户级隔离
Level 3：+ 向量库               → 智能检索相关记忆
Level 4：+ 摘要压缩             → 处理超长对话（ChatGPT 级）
```

**关键**：Day 8 写的 session_id 机制和 messages 拼接逻辑，在 Level 1-4 都不用改——只需把 SESSIONS 字典换成 Redis/DB 调用。**这就是关注点分离的价值。**

### 10.6 核心认知

> **Memory 的工程难度不在"存"，在"加载策略"。** 怎么平衡 token 成本和记忆质量、怎么在"记得住"和"不撑爆"之间权衡——这才是生产级 Memory 的真正技术含量。

---

## 十二、关键认知总结（一句话系列）

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
| **messages 结构** | OpenAI 定义的全行业标准，换厂商不用改代码 |
| **LLM 记忆的真相** | LLM 无记忆，"记忆"= 每次把历史 messages 重新喂给它 |
| **Memory 的难点** | 不在"存"，在"加载策略"（最近N条/摘要/向量检索） |
| **Agent vs Workflow** | 不是二选一，是不同层级：Agent 决策，Workflow 执行，成熟系统=Agent 编排多个 Workflow |

---

## 十三、这些认知从哪来

所有认知都来自亲手实现的 Research Agent（Day 1-8），不是纸上谈兵：

| 认知 | 来自哪天的实践 |
|------|--------------|
| Agent 三要素 | Day 3 写出 `while message.tool_calls:` |
| 形态 vs 本质 | Day 7 把 Agent 包成一问一答 Web 服务 |
| 接口 = 远程函数 | Day 7 写 `@app.post` 把函数暴露成 HTTP |
| 请求级隔离 | Day 7 写 `state = run_research_agent(req.topic)` |
| Agent 慢带来问题 | Day 6 评估时发现单次要 30-60 秒 |
| 外部依赖不可靠 | Day 3/5/7 多次踩 DuckDuckGo 超时 |
| messages 是记忆载体 | Day 8 Session Memory 拼接 history 到 messages |
| Memory 的加载策略 | Day 8 思考"历史长了怎么办"引出 Redis/向量库 |
| Agent vs Workflow 分层 | Day 8 Workflow 复用 Day 5 Agent + 讨论"两者关系"后的认知升级 |

> 🔑 **这些认知之所以深刻，是因为有代码实证。** 没有亲手写过，看再多文章也只是"知道"，不是"理解"。

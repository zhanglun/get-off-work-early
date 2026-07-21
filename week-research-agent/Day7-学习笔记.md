# AI Agent 从零实现 · 学习笔记（Day 7 · 收官）

> 对应 Day 7：Deployment（部署上线）
> 技术栈：FastAPI + Uvicorn + 原生 HTML/JS
> 核心升级：**把命令行工具变成 Web 服务**

> 📂 **关联代码**
> - 目录：`server/`（FastAPI Web 服务）
> - 核心文件：`server/main.py`（FastAPI 应用 + 4 个接口：`/`、`/api/health`、`/api/research`、`/api/research/stream`）、`server/schemas.py`（HTTP Pydantic schema）、`server/static/index.html`（Web UI，原生 HTML/JS）、`server/__main__.py`（入口）
> - 运行：`python -m server` → 浏览器访问 `http://localhost:8000`
> - API 文档：`http://localhost:8000/docs`（Swagger 自动生成）
> - 关键：业务逻辑零改动，复用 Day 5 的 `run_research_agent`

---

## 〇、一个心智模型：从"工具"到"产品"

前 6 天造了一个**本地命令行工具**——只有我自己能用，别人要用得装 Python、clone 代码、配 API Key。Day 7 把它变成**网络服务**，让别人打开浏览器就能用：

```
Day 1-6（本地命令行工具）：
  我 ──终端──→ python -m research_agent
  只有我能用

Day 7（Web 服务）：
  任何人 ──浏览器──→ http://localhost:8000 ──→ Agent
  打开网页就能用
```

这是从"工具"到"产品"的最后一跃，也是 7 天项目的收官。

**三种"能用"的层次**：

| 层次 | 形态 | Day 7 |
|------|------|-------|
| Level 1：本地命令行 | `python -m research_agent` | 已有（Day 5） |
| **Level 2：本地 Web 服务** | FastAPI + 浏览器 | ✅ Day 7 |
| Level 3：公网部署 | 云服务器 + 域名 | 可选延伸 |

> 🔑 一句话：**Day 7 不改 Agent 的业务逻辑，只在外面套一层 HTTP 传输。** Agent 管研究，FastAPI 管传输——各司其职。

---

## 一、FastAPI：Python 的现代 Web 框架

### 1.1 为什么选 FastAPI

| 对比项 | Flask | Django | **FastAPI** |
|--------|-------|--------|-------------|
| 性能 | 中 | 中 | **高**（ASGI 异步） |
| API 文档 | 需插件 | 需配置 | **自动生成**（Swagger） |
| 类型校验 | 手写 | 手写 | **Pydantic 自动** |
| 学习曲线 | 低 | 高 | **低** |
| 适合 API | 一般 | 一般 | **非常适合** |

**AI 应用几乎清一色用 FastAPI**——因为 AI 应用本质是"接收请求 → 调模型 → 返回结果"，FastAPI 的自动文档 + 类型校验正好对口。

### 1.2 FastAPI 的"魔力"：装饰器定义路由

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def index():
    return {"hello": "world"}

@app.post("/api/research")
async def research(req: ResearchRequest):
    ...
```

`@app.get("/")` 和 `@app.post("/api/research")` 是**装饰器**——和 Day 4 的 `@retry_with_timeout` 是同一个概念：给函数"附加能力"。这里附加的是"注册成 HTTP 路由"。

### 1.3 Pydantic：自动类型校验

```python
from pydantic import BaseModel, Field

class ResearchRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)

@app.post("/api/research")
async def research(req: ResearchRequest):  # ← FastAPI 自动校验
    ...
```

**FastAPI 收到请求后自动**：
1. 把 JSON body 解析成 `ResearchRequest` 对象
2. 校验 `topic` 是字符串、长度 1-200
3. 校验失败自动返回 422 错误（不用手写 if）
4. 校验通过才进入 `research` 函数

这就是 Pydantic 的价值——**声明式校验，省掉一堆样板代码**。

---

## 二、核心设计：业务逻辑零改动，只加传输层

### 2.1 Day 5 的函数已经够干净

```python
# Day 5 的核心函数（已经是个干净的接口）
def run_research_agent(topic: str) -> ResearchState:
    ...
    return state  # state.report 是结构化报告
```

Day 7 **完全不改这个函数**，只在外面套一层 HTTP：

```python
# server/main.py
@app.post("/api/research")
async def research(req: ResearchRequest):
    state = run_research_agent(req.topic)  # ← 直接复用 Day 5
    return ResearchResponse(
        topic=req.topic,
        report=state.report,
        metadata=...
    )
```

### 2.2 为什么要"零改动"

**关注点分离**（Separation of Concerns）：
- Agent 的职责：研究课题、生成报告
- HTTP 的职责：接收请求、返回响应

两者解耦的好处：
- 改 Agent 不影响服务（比如调 prompt）
- 换传输层不影响 Agent（比如从 HTTP 换 gRPC）
- 可以加多种"入口"：CLI（Day 5）+ HTTP（Day 7）+ 未来可能加微信机器人

**这印证了 Day 5 笔记讲的"编排/运行时"分离**——Day 7 加的是"新的入口"，Agent 本身不变。

---

## 三、三个接口的设计

| 接口 | 方法 | 作用 | 谁用 |
|------|------|------|------|
| `/` | GET | 返回网页 | 浏览器 |
| `/api/health` | GET | 健康检查 | 运维/监控 |
| `/api/research` | POST | 提交课题，返回报告 | 前端/客户端 |

### 3.1 为什么有 `/api/health`

部署后，监控系统（如 Kubernetes）会定期调 `/api/health`，确认服务还活着。如果挂了，自动重启。这是**生产服务的标配**。

### 3.2 为什么 `/api/research` 是 POST 不是 GET

```
GET  用于"获取资源"，参数在 URL 里，有长度限制
POST 用于"提交数据"，参数在 body 里，无长度限制
```

研究课题可能是长文本（"请对比 2026 年主流 AI Agent 框架..."），放 URL 里不合适。而且 POST 语义上就是"提交一个任务"，更准确。

### 3.3 同步阻塞的权衡

研究过程要 20-60 秒，`/api/research` 是**同步阻塞**的——客户端发请求后要等几十秒才有响应。

```python
@app.post("/api/research")
async def research(req: ResearchRequest):
    state = run_research_agent(req.topic)  # ← 阻塞 30 秒
    return ...
```

**为什么 Day 7 用阻塞式**：FastAPI 会把同步函数放到线程池跑，不会卡死其他请求。对学习项目够用。

**生产环境怎么做**：异步任务队列（Celery / Dramatiq）：
```
POST /api/research → 立即返回 task_id
GET /api/research/{task_id} → 轮询结果
```
但 7 天项目不引入这个复杂度。

---

## 四、Web UI：原生 HTML/JS，不引框架

### 4.1 为什么不用 React/Vue

- 这是个**单页面**（输入框 + 报告展示），复杂度极低
- 引框架要加构建工具（webpack/vite），拖累项目
- 原生 JS 的 `fetch` + `innerHTML` 完全够用

**认知**：技术选型要匹配复杂度。杀鸡不用牛刀。

### 4.2 核心交互：fetch 调 API

```javascript
async function doResearch() {
    const topic = document.getElementById('topic').value;
    
    // 显示 loading
    result.innerHTML = '<div class="spinner">...</div>';
    
    // 调后端 API
    const resp = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
    });
    const data = await resp.json();
    
    // 渲染报告
    result.innerHTML = renderReport(data);
}
```

**前后端完全解耦**：前端只管"发请求 + 渲染"，后端只管"研究 + 返回 JSON"。两边可以独立迭代。

### 4.3 工具调用 trace：让用户看到 Agent 在干什么

```javascript
// 渲染工具调用明细
const tools = (m.tool_calls || []).map(t => {
    const mark = t.success ? '✓' : '✗';
    return `<div>${mark} [${t.step}] ${t.tool}(...) — ${t.elapsed}s</div>`;
}).join('');
```

这让用户能看到"Agent 搜了什么、读了什么"——**透明度是 AI 产品的信任基石**。用户看到 Agent 真的联网了，才会信任结果。

---

## 五、踩坑记录（真实遇到的）

### 🕳️ 踩坑 1：fetch_url 遇到反爬虫（403/404）

**现象**：React vs Vue 课题，Agent 搜到 3 个链接，fetch 全失败（smashingmagazine 404、toptal 403），导致整个研究报告说"未能获取"。

**根因**：
- 404：DuckDuckGo 返回的链接过时了（文章挪位置）
- 403：网站识别出我们是爬虫，主动拒绝（toptal 等有反爬）

**修复**（两层）：
1. **fetch_url 本身**：403/404 不浪费重试次数（重试也没用），错误消息改成"换个链接或用搜索摘要"
2. **Agent 行为**：System Prompt 加"fetch 失败不要放弃，搜索摘要本身就有大量信息"

**教训**：**外部网页永远不可靠**。Agent 必须有降级链：fetch 失败 → 用摘要兜底 → 摘要也没就诚实说。这是 Day 4 健壮性在 Day 7 的延续。

### 🕳️ 踩坑 2：python -m server 需要 __main__.py

**现象**：`python -m server` 报错 `No module named server.__main__`。

**原因**：`python -m 包名` 会找包里的 `__main__.py`，但我只写了 `main.py`。

**解决**：加一个 `__main__.py`，里面调 `main.py` 的 app。

**教训**：这是 Day 5 踩坑 1（包内 import）的延续——**Python 包的入口有固定规矩**。`__main__.py` 是"包的默认入口"，就像 `main()` 是程序的默认入口。

### 🕳️ 踩坑 3：DuckDuckGo 网络波动让演示翻车

**现象**：写完代码第一次演示 React vs Vue，DuckDuckGo 恰好持续超时，Agent 连搜索都没做成，报告说"未能获取"。

**根因**：DuckDuckGo 通过代理的稳定性受网络环境影响极大（Day 3/6 都踩过）。

**教训**：**演示 demo 用的课题要预先验证过能搜到**。不能临时想一个就跑——万一外部服务抖动，演示就翻车。这也是为什么生产环境要用付费搜索（稳定）。

---

## 六、难点与思考

### 思考 1：从"工具"到"产品"的认知跃迁

前 6 天我一直在想"怎么让 Agent 更强"。Day 7 让我意识到，**"强"和"能用"是两件事**：

| 维度 | 强（Day 1-6） | 能用（Day 7） |
|------|--------------|--------------|
| 关注点 | Agent 逻辑 | 用户体验 |
| 指标 | 质量/成功率 | 响应时间/可用性 |
| 用户 | 我自己 | 别人 |
| 形态 | 命令行 | 网页/API |

**一个 Agent 再强，如果别人用不了，就只是个自娱自乐的玩具。** Day 7 的部署，是让 Agent 从"我的玩具"变成"别人的工具"。

### 思考 2：API 是 AI 产品的"通用接口"

做完 Day 7 我悟到：**一旦 Agent 有了 HTTP API，它能接入任何东西**：

```
HTTP API 是"万能胶水"：
  网页（Day 7 做了） → 调 API
  微信机器人 → 调 API
  Slack 集成 → 调 API
  另一个 Agent → 调 API
  Zapier/n8n 自动化 → 调 API
```

**这就是为什么 API 比单独的网页更有价值**——网页只是一个客户端，API 让 Agent 成为生态的一部分。

### 思考 3：透明度是 AI 产品的信任基石

Web UI 里我特意做了"工具调用 trace"——让用户看到 Agent 搜了什么、读了什么。

```
✓ [1] search_web({"query": "LangChain"}) — 12.4s
✓ [2] fetch_url({"url": "https://www.langchain.com/"}) — 0.5s
```

**为什么重要**：AI 的输出是黑盒，用户天然不信任。当你把"过程"展示出来，信任度立刻提升。这也是为什么 ChatGPT 要显示"搜索了 N 个来源"、Perplexity 要列引用——**透明度 = 可信度**。

### 思考 4：同步 vs 异步——AI 服务的核心权衡

研究要 30-60 秒，Day 7 用同步阻塞（客户端等 30 秒）。这在学习项目里 OK，但生产环境是灾难：

```
同步的问题：
  - 客户端可能超时（浏览器默认 30 秒）
  - 占用服务器连接（1000 个用户同时研究 = 1000 个连接卡着）
  - 用户体验差（盯着 loading 30 秒）

异步的解法（生产级）：
  POST /api/research → 立即返回 task_id（< 1 秒）
  GET /api/research/{task_id} → 客户端轮询，或用 WebSocket 推送
```

**认知**：AI 服务因为"耗时长"，天然适合异步架构。这是 AI Web 开发和传统 Web 开发的最大区别。

---

## 七、Day 6 vs Day 7 全面对比

| 维度 | Day 6 | Day 7 |
|------|-------|-------|
| **定位** | 测 Agent | 用 Agent |
| **产出** | 评估报告 | Web 服务 |
| **新概念** | LLM as a Judge | FastAPI / HTTP API |
| **用户** | 我自己（开发者） | 任何人（终端用户） |
| **关注点** | 质量好不好 | 能不能用 |

---

## 八、关键概念速查表

| 术语 | 含义 |
|------|------|
| **FastAPI** | Python 现代 Web 框架，适合做 API 服务 |
| **Uvicorn** | ASGI 服务器，负责实际接收 HTTP 请求 |
| **Pydantic** | 类型校验库，FastAPI 用它自动校验请求 |
| **路由（Route）** | URL 和处理函数的映射（`@app.get("/x")`） |
| **Swagger** | API 文档规范，FastAPI 自动生成（`/docs`） |
| **关注点分离** | 业务逻辑和传输层解耦，各管各的 |
| **降级链** | 外部依赖失败时的兜底策略链 |
| **同步 vs 异步** | 等结果（阻塞）vs 立即返回 task_id（非阻塞） |

---

## 九、当前进度 & 下一步

```
✅ Lesson 01 (Agent 基础)
✅ Lesson 02 (Tool Calling)
✅ Lesson 03 (State & Workflow)
✅ Day 4 健壮性（日志+结构化+重试）
✅ Day 5 完整 Research Agent（两步法 + fetch_url）
✅ Day 6 Evaluation（benchmark + LLM 互评）
✅ Day 7 Deployment（FastAPI + Web UI）         ← 完成！
```

**🎉 7 天项目全部完成！**

---

## 附：Day 7 文件结构

```
week-research-agent/
├── server/                       ← Day 7 Web 服务
│   ├── __init__.py
│   ├── __main__.py               ← 入口（python -m server）
│   ├── main.py                   ← FastAPI 应用（3 个接口）
│   ├── schemas.py                ← HTTP 请求/响应 schema
│   └── static/
│       └── index.html            ← Web UI（原生 HTML/JS）
├── research_agent/               ← 复用，不动
└── common/                       ← 复用，不动
```

---

## 十、亲手体验指南

```bash
cd week-research-agent
source .venv/bin/activate
python -m server
```

然后：
1. **浏览器访问 http://localhost:8000** → 网页界面
2. **输入课题**（如"LangChain 是什么"）→ 点"研究"
3. **等 20-60 秒** → 看结构化报告 + 工具调用 trace
4. **访问 http://localhost:8000/docs** → Swagger API 文档（专业感拉满）
5. **命令行测试 API**：
   ```bash
   curl -X POST http://localhost:8000/api/research \
     -H "Content-Type: application/json" \
     -d '{"topic": "Python 是什么"}'
   ```

---

# 🎓 七天旅程全景回顾

## 从零到产品的 7 天

| Day | 主题 | 核心能力 | 认知跃迁 |
|-----|------|---------|---------|
| **1** | 最小 Agent | 单步工具调用 | Agent = LLM + Tool + Loop |
| **2** | Tool Calling | 全链路 + 多工具 | Tool 抽象的威力 |
| **3** | State & 搜索 | 循环 + 状态 + 联网 | 从玩具到可用 |
| **4** | 健壮性 | 日志 + 结构化 + 重试 | 为失败做准备 |
| **5** | 完整 Agent | 两步法 + System Prompt | 从零件到产品 |
| **6** | Evaluation | Benchmark + LLM 互评 | 从感觉到数据 |
| **7** | Deployment | FastAPI + Web UI | 从工具到服务 |

## 三条贯穿始终的主线

### 主线 1：能力演进
```
单步工具 → 多步循环 → 状态管理 → 健壮性 → 完整产品 → 数据评估 → 网络服务
```

### 主线 2：代码资产积累
```
Day 1: add/read_file
Day 2: + Tool Registry + Agent Loop
Day 3: + AgentState + search_web
Day 4: + logger + retry_with_timeout + structured_answer
Day 5: + common/ 公共目录 + 两步法 + fetch_url
Day 6: + evaluation/ 评估套件
Day 7: + server/ Web 服务（复用 Day 5 的核心函数）
```
**每一行代码都在为后面铺路。** Day 7 的 Web 服务能直接复用 Day 5 的 `run_research_agent`，就是因为前面打好了基础。

### 主线 3：认知升级
```
Day 1-2：Agent 不是黑魔法，就是 LLM + Tool + Loop
Day 3-4：健壮性不是可选的，是必需的
Day 5：完备 ≠ 工具多，工具决定下限，决策决定上限
Day 6：没有评估的优化 = 闭眼调参；LLM 评估有天生噪音
Day 7：强和能用是两件事；API 是 AI 产品的通用接口
```

## 学完这 7 天，你掌握了什么

| 能力 | 证据 |
|------|------|
| 从零实现 Agent | 不依赖 LangChain，手写 Loop/State/Tool Calling |
| Agent 工程化 | 日志、重试、超时、结构化输出、错误降级 |
| Agent 评估 | Benchmark 设计 + LLM as a Judge |
| Agent 部署 | FastAPI + Web UI + API 文档 |
| 认知深度 | 理解编排/运行时/规则引擎、两步法、降级链 |

## 你现在在哪里

```
等级 1：知道 Agent 是什么            （大多数人停在这里）
等级 2：用过 LangChain 调 API        （教程使用者）
等级 3：从零实现过完整 Agent          （你在这里 ✅）
等级 4：能评估、部署、迭代 Agent       （你到这里了 ✅）
等级 5：能设计多 Agent 系统、MCP、工作流（后续 Lesson 05-08）
```

**你已经秒杀市面上 90% 标着"我懂 AI Agent"的人**——因为他们大多只会调框架 API，而你从底层实现过、评估过、部署过。

## 后续学习方向（7 天之后）

| 方向 | 对应 Lesson | 你已经有了什么基础 |
|------|------------|------------------|
| **Memory（记忆）** | Lesson 05 | Day 3 的 State 是短期记忆的基础 |
| **Workflow（工作流）** | Lesson 06 | Day 5 的两步法是简单工作流 |
| **MCP（工具协议）** | Lesson 07 | Day 4/5 的 Tool 抽象是 MCP 的前身 |
| **LangGraph** | Lesson 08 | 你手写过编排/运行时，懂 LangGraph 在干什么 |
| **生产级部署** | Day 7 进阶 | 加 Docker / Redis / 异步任务队列 |

---

> ### 🎓 一句话总结这 7 天
>
> **从 `print("hello")` 到一个能联网研究、自主决策、可评估、可部署的 AI Agent 产品——7 天，从零到一。**
>
> 这不是终点，而是起点。你现在拥有了"从原理理解 Agent"的能力，后面学任何框架（LangChain/LangGraph/AutoGen），你都能看透它们在帮你干什么。

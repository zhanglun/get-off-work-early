# AI Agent 从零实现 · 学习笔记（Day 9）

> 对应：打磨单 Agent（Streaming 流式输出）
> 技术栈：SSE + 观察者模式 + 线程/Queue 桥接 + EventSource
> 核心升级：**从"30 秒白屏"到"实时看到 Agent 每一步"**

---

## 〇、心智模型：从"黑盒等待"到"透明过程"

Day 7 部署了 Web 服务，但有个体验硬伤：

```
用户点"研究" → 30 秒白屏 loading → 突然出报告

问题：
  1. 30 秒不知道发生了什么（焦虑）
  2. 不知道卡在哪（搜索慢？还是 LLM 慢？）
  3. 看起来像"卡死了"
```

Day 9 用 **SSE 流式输出**解决——让用户实时看到 Agent 搜了什么、读了什么、报告生成到哪一步。这是 ChatGPT "思考过程展示"的同款技术。

> 🔑 一句话：**透明度 = 信任。** AI 输出是黑盒，把过程展示出来，用户才会信任结果。

---

## 一、核心技术：SSE（Server-Sent Events）

### 1.1 SSE 是什么

> **SSE = 服务器单向持续推送数据给浏览器。** 基于 HTTP，比 WebSocket 简单。

```
普通 HTTP（Day 7）：
  浏览器 → 请求 → 服务器（憋 30 秒）→ 一次性返回

SSE（Day 9）：
  浏览器 → 请求 → 服务器持续推送：
    data: {"event": "tool_start", "tool": "search_web"}\n\n
    data: {"event": "tool_end", ...}\n\n
    data: {"event": "done", "report": {...}}\n\n
  → 浏览器实时显示
```

### 1.2 SSE vs WebSocket

| 对比 | SSE | WebSocket |
|------|-----|-----------|
| 方向 | 服务器→浏览器（单向） | 双向 |
| 协议 | HTTP（简单） | 独立协议（复杂） |
| 适合 | Agent 进度推送（只需服务器推） | 聊天（双方都要发） |
| FastAPI | 内置 `StreamingResponse` | 需额外库 |

**Agent 场景只需服务器推进度**，用 SSE 最合适。这也是 OpenAI 流式 API 用的技术。

### 1.3 SSE 的数据格式

每条消息必须是这个格式（末尾两个换行）：

```
data: {"event": "tool_start", "query": "LangChain"}\n\n
```

- `data:` 前缀 + JSON 内容 + `\n\n` 结尾
- 以 `:` 开头的行是注释（用于心跳保活）

### 1.4 SSE 的限制：只支持 GET

`EventSource`（浏览器原生 SSE 客户端）**只支持 GET 请求**，不能 POST body。

**Day 9 的解法**：课题放 URL 参数（`/api/research/stream?topic=xxx`）。课题通常 <200 字，够用。

---

## 二、架构设计：三层改动

```
┌─────────────────────────────────────────┐
│ 层 3：前端 EventSource                   │
│   new EventSource(url)                   │
│   onmessage → 实时渲染进度                │
└──────────────┬──────────────────────────┘
               │ SSE 流
┌──────────────▼──────────────────────────┐
│ 层 2：server SSE 接口                    │
│   StreamingResponse + 同步 generator     │
│   线程跑 Agent + Queue 传事件            │
└──────────────┬──────────────────────────┘
               │ on_progress 回调
┌──────────────▼──────────────────────────┐
│ 层 1：Agent on_progress 回调              │
│   researcher/reporter 每步汇报事件        │
└─────────────────────────────────────────┘
```

---

## 三、层 1：观察者模式——Agent 边跑边报告

### 3.1 问题：Agent 是黑盒

改造前的 `run_research_agent`：

```python
def run_research_agent(topic):
    # ... 黑盒跑 30 秒 ...
    return state  # 最后才返回
```

跑的过程中，外面完全不知道发生了什么。

### 3.2 解法：on_progress 回调（观察者模式）

```python
def run_research_agent(topic, on_progress=None):
    # on_progress 是外部传入的回调函数
    # Agent 每做一步就调用它，通知外部

    on_progress({"event": "tool_start", "tool": "search_web", "query": "LangChain"})
    result = search_web("LangChain")
    on_progress({"event": "tool_end", "success": True, "count": 5})
```

**这是观察者模式（Observer Pattern）**：
- Agent 是"被观察者"（Subject）
- 外部传入的回调是"观察者"（Observer）
- Agent 每做一步就"通知"观察者

### 3.3 关键设计：回调不能影响主流程

```python
def _emit(event: dict):
    """安全地触发回调（没有回调时啥也不做）。"""
    if on_progress:
        try:
            on_progress(event)
        except Exception:
            pass  # 回调失败不能影响 Agent 主流程
```

**为什么 try/except**：回调可能出错（比如 SSE 连接断了），但 Agent 的研究不能因为"汇报失败"而中断。这是健壮性设计。

### 3.4 事件设计（7 种事件）

| 事件 | 触发时机 | 前端显示 |
|------|---------|---------|
| `phase` | 进入研究/报告阶段 | 🔍 开始研究 / 📊 生成报告 |
| `history` | 加载会话历史 | 📚 加载历史 N 条 |
| `step` | 每轮循环开始 | — 第 N 步 — |
| `tool_start` | 工具调用前 | 🔎 搜索：xxx / 📖 读全文：xxx |
| `tool_end` | 工具调用后 | ✓ N 条结果（Xs） |
| `phase_done` | 阶段完成 | 📝 研究完成 / ✓ 报告完成 |
| `done` | 全部完成 | 渲染最终报告 |

---

## 四、层 2：SSE 接口——同步 Agent + 异步流的桥接（最难的部分）

### 4.1 技术难点

这是整个 Day 9 最难的地方：

```
Agent：     同步阻塞函数（跑 30 秒，中间不 yield）
SSE：       需要持续 yield 的流
FastAPI：   async 环境（不能直接调阻塞函数）

怎么让"阻塞的 Agent"和"持续 yield 的 SSE"配合？
```

### 4.2 解法：线程 + Queue + 同步 generator

```python
@app.get("/api/research/stream")
def research_stream(topic, session_id):
    event_queue = queue.Queue()  # ① 事件队列（线程间通信）
    result_holder = {}           # ② 最终结果

    def on_progress(event):
        event_queue.put(event)   # ③ Agent 线程把事件塞进 Queue

    def run_agent_thread():
        # ④ 子线程跑 Agent
        state = run_research_agent(topic, on_progress=on_progress)
        result_holder["state"] = state
        event_queue.put(None)    # ⑤ 哨兵：告诉 generator 结束

    def event_generator():
        thread = Thread(target=run_agent_thread)
        thread.start()

        while True:
            try:
                event = event_queue.get(timeout=0.5)  # ⑥ 阻塞取
            except queue.Empty:
                yield ": heartbeat\n\n"  # ⑦ 没事件发心跳
                continue
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"  # ⑧ 推给前端

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**数据流**：

```
Agent 线程 ──put(event)──→ Queue ──get()──→ generator ──yield──→ 浏览器
```

### 4.3 为什么用同步 generator 不用 async

这是踩坑后的结论（详见第五章）：

| 方案 | 问题 |
|------|------|
| async generator + `run_in_executor` + `wait_for` | **超时取消会丢事件**（线程泄漏 + 事件卡在已取消的线程里） |
| **同步 generator**（FastAPI 自动放线程池跑） | **简单可靠**，直接用阻塞的 `queue.get(timeout=)` |

**教训**：FastAPI 的 `StreamingResponse` 支持同步 generator——它会自动放到线程池跑。别强行用 async，同步更可靠。

---

## 五、踩坑记录（真实遇到的）

### 🕳️ 踩坑 1：async run_in_executor + wait_for 会丢事件（最深的坑）

**现象**：SSE 流只收到第一个事件，Agent 后续的事件全丢了。服务端日志显示 Agent 完整跑完了。

**原因**：用 async generator 时这样写：

```python
async def event_generator():
    while True:
        try:
            event = await asyncio.wait_for(
                loop.run_in_executor(None, event_queue.get),  # ← 坑
                timeout=0.5,
            )
        except asyncio.TimeoutError:
            yield ": heartbeat\n\n"
            continue
```

**问题链条**：
1. `run_in_executor` 把 `queue.get()` 放到线程池跑
2. `wait_for(timeout=0.5)` 超时后**取消**这个 task
3. 但线程池里那个线程**还在阻塞** `queue.get()`，没被真正取消
4. Agent 的 `on_progress` 把事件 `put` 进 Queue
5. 事件被那个"僵尸线程"取走了（它还在等 get）
6. 主循环又新建一个 executor task，但事件已经被取走 → 永远拿不到

**解决**：改成同步 generator，直接用 `queue.get(timeout=0.5)`。简单，没有 executor 的坑。

**教训**：**Python 的 async 和线程混用要格外小心**。`run_in_executor` 的取消语义不直观，超时取消不会真正中断阻塞调用。能用同步就用同步。

### 🕳️ 踩坑 2：EventSource 只支持 GET

**现象**：想用 POST 传课题（因为课题可能较长），但 EventSource 不支持 POST。

**原因**：EventSource 标准设计为只支持 GET（简化协议）。

**解决**：课题放 URL 参数（`?topic=xxx`）。课题 <200 字，URL 长度够用。

**教训**：**Web 标准的约束要提前查清楚**，别假设"HTTP 方法都支持"。

### 🕳️ 踩坑 3：nginx 缓冲导致流式失效

**现象**：本地测试流式正常，部署到 nginx 后变成"最后一次性返回"。

**原因**：nginx 默认缓冲响应体，等攒够才发。

**解决**：响应头加 `X-Accel-Buffering: no`：

```python
return StreamingResponse(
    event_generator(),
    media_type="text/event-stream",
    headers={"X-Accel-Buffering": "no"},  # ← 禁用 nginx 缓冲
)
```

**教训**：**反向代理会改变 HTTP 行为**。流式服务部署时必须禁缓冲。

---

## 六、层 3：前端 EventSource

### 6.1 浏览器原生 SSE 客户端

```javascript
const eventSource = new EventSource(url);

eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.event === 'done') {
        eventSource.close();
        renderReport(data.report);
    } else {
        appendStreamEvent(data);  // 实时渲染进度
    }
};
```

**EventSource 的特点**：
- 浏览器原生支持，无需库
- 自动重连（连接断了会重试）
- 只需处理 `onmessage`

### 6.2 实时渲染进度

每收到一个事件，追加到进度日志区：

```javascript
function appendStreamEvent(data, container) {
    if (data.event === 'tool_start' && data.tool === 'search_web') {
        html = `<div class="stream-item">🔎 搜索：<b>${data.query}</b></div>`;
    } else if (data.event === 'tool_end') {
        const mark = data.success ? '✓' : '✗';
        html = `<div class="stream-item ok">   ${mark} ${data.count} 条（${data.elapsed}s）</div>`;
    }
    container.insertAdjacentHTML('beforeend', html);
}
```

**效果**：用户实时看到类似终端的进度流。

---

## 七、难点与思考

### 思考 1：观察者模式是 Agent 可观测性的基础

Day 4 的日志系统是"写到文件，事后看"。Day 9 的 `on_progress` 回调是"实时推送，当场看"。

**两者都是"可观测性"的实现**，区别在时机：

| 方式 | Day 4 日志 | Day 9 回调 |
|------|-----------|-----------|
| 时机 | 事后 | 实时 |
| 受众 | 开发者（调试） | 用户（体验） |
| 实现 | logger.info() | on_progress() |

**关键认知**：`on_progress` 回调本质就是"给 Agent 装了个对外广播通道"。这个通道可以接 SSE（Day 9），也可以接 WebSocket、接日志、接监控系统——**这就是解耦的价值**。

### 思考 2：同步 vs 异步——别教条

Python 圈子有"async 一定更好"的风气。但 Day 9 踩坑证明：**async 和阻塞 I/O 混用会出微妙 bug**。

| 场景 | 选什么 |
|------|--------|
| 纯 I/O 密集（HTTP 服务、纯异步） | async |
| 需要调阻塞库（LLM SDK、Queue） | 同步更可靠 |
| 混合 | 谨慎，用 anyio/线程池，别手动 run_in_executor |

**Day 9 的结论**：FastAPI 的 StreamingResponse 用同步 generator 完全 OK——它会自动放线程池跑。别为了 async 而 async。

### 思考 3：Streaming 是 AI 服务的标配

为什么 ChatGPT/Claude/智谱清言都有流式输出？因为 AI 任务**天然耗时长**：

```
传统 Web：50ms 返回 → 不需要流式
AI 服务：  10-60s 返回 → 必须流式

不流式 = 用户以为卡死了
```

**Day 9 让 Agent 具备了生产级 AI 服务的基本形态**。

---

## 八、Day 7 vs Day 9 对比

| 维度 | Day 7（同步） | Day 9（流式） |
|------|-------------|-------------|
| 用户体验 | 30s 白屏 | 实时进度 |
| 透明度 | 黑盒 | 全程可见 |
| 技术复杂度 | fetch | SSE + 回调 + 线程 |
| 接口 | POST /api/research | GET /api/research/stream |
| 前端 | fetch + await | EventSource + onmessage |

---

## 九、关键概念速查表

| 术语 | 含义 |
|------|------|
| **SSE** | Server-Sent Events，服务器单向持续推送 |
| **EventSource** | 浏览器原生 SSE 客户端（只支持 GET） |
| **StreamingResponse** | FastAPI 的流式响应类 |
| **观察者模式** | 被观察者通过回调通知观察者（on_progress） |
| **on_progress 回调** | Agent 的"进度广播通道" |
| **Queue + 线程** | 同步 Agent 和异步流的桥接方式 |
| **心跳** | 没事件时发的空消息，保持连接 |
| **X-Accel-Buffering** | 禁用 nginx 缓冲的响应头 |

---

## 十、当前进度 & 下一步

```
✅ Day 1-7：能用的 Agent（从零实现）
✅ Day 8 A：Session Memory
✅ Day 8 B+C：Workflow
✅ Day 9：Streaming 流式输出          ← 完成
⬜ 持久化 Memory（SESSIONS → SQLite）
⬜ Token 成本统计
```

**Day 9 完成"打磨单 Agent"的第一件**。接下来：
- 持久化 Memory：把内存 dict 换成 SQLite，服务重启不丢记忆
- Token 成本统计：每次研究烧多少钱，心里有数

---

## 附：实测验证

SSE 流完整推送 14 个事件：

```
data: {"event": "phase", "phase": "research"}
data: {"event": "step", "step": 1}
data: {"event": "tool_start", "tool": "search_web", "query": "Dart programming language"}
data: {"event": "tool_end", "success": true, "count": 5, "elapsed": 13.5}
data: {"event": "tool_start", "tool": "search_web", "query": "Dart language features"}
data: {"event": "tool_end", "success": true, "count": 5, "elapsed": 5.3}
...（共 4 轮搜索）
data: {"event": "phase_done", "phase": "research", "steps": 1}
data: {"event": "phase", "phase": "report"}
data: {"event": "phase_done", "phase": "report", "confidence": "high"}
data: {"event": "done", "report": {...}}
```

用户全程看到 Agent 的每一步——从"30 秒白屏"到"透明过程"。

# AI Agent 从零实现 · 学习笔记（Day 8 · 第二阶段起点）

> Day 8 不是"又做一天功能"，而是**第二阶段的起点**。
> Day 1-7 完成了"能用的 Agent"，Day 8 开始做"好用的 Agent"。
>
> 本篇记录从"能用"到"好用"的思考：为什么 Memory 和 Workflow 是下一步，以及路线图。

---

## 〇、起点：Day 7 完成后的反思

### 0.1 我们做出来的东西

Day 1-7，我们造了一个完整的 Research Agent：
- 能联网搜索 + 读全文（Day 3/5）
- 有健壮性（Day 4 日志/重试/超时）
- 两步法 + System Prompt（Day 5）
- 可评估（Day 6 Benchmark + LLM 互评）
- 可部署（Day 7 FastAPI + Web UI）

**这是一个"能用的 Agent"——但要承认，它还"不够好用"。**

### 0.2 暴露的真实短板

把 Agent 放到真实场景，立刻发现两个硬伤：

| 场景 | Agent 的反应 | 问题 |
|------|-------------|------|
| 用户："研究完 LangChain 了。那它和 AutoGen 比？" | ❌ "它"是谁？完全不记得刚才研究过 LangChain | **记不住（缺 Memory）** |
| 用户："帮我全面研究 AI Agent 全景" | ❌ 当一个课题搜，浅尝辄止 | **干不了大事（缺 Workflow）** |

### 0.3 一个关键认知："简单"是入门奖赏，不是全貌

Day 7 完成后，容易产生"做 Agent 很简单"的错觉。但真相是：

```
入门（Day 1-7）：理解原理 + 跑通骨架          ✅ 已完成
精通（Day 8+）： 稳定 + 好用 + 生产级          ⬜ 要做的事
```

"能用"和"好用"之间，差着 Memory、Workflow、MCP、生产工程化等多座大山。Day 8 是翻第一座山。

---

## 一、Memory：解决"记不住"

### 1.1 现状：金鱼记忆

Day 7 的 Agent 是**无状态**的——每次请求创建新 state，跑完销毁：

```python
@app.post("/api/research")
async def research(req):
    state = run_research_agent(req.topic)  # 全新的 state，什么历史都没有
    return state.report
```

连续对话会这样：
```
用户：研究 LangChain
Agent：（搜了一堆）这是 LangChain 的报告...

用户：那它和 AutoGen 比呢？
Agent：❌ "它"是谁？我不知道你之前研究过 LangChain
```

**这是所有"无状态架构"的通病**——隔离性好，但记不住任何东西。

### 1.2 Memory 的三个层次

| 层次 | 目标 | 存哪 | 难度 |
|------|------|------|------|
| **Session Memory** | 同一会话内连续 | 内存/Redis | ⭐ |
| **Long-term Memory** | 跨会话记住用户 | 数据库 | ⭐⭐⭐ |
| **Memory Retrieval** | 记忆太多只取相关的 | 向量库 | ⭐⭐⭐⭐ |

### 1.3 Session Memory 的核心思路

```python
# 按 session_id 存对话历史
sessions = {}  # 生产用 Redis

@app.post("/api/research")
async def research(req, session_id):
    history = sessions.get(session_id, [])   # 取历史
    state = ResearchState(topic=req.topic, messages=history)
    state = run_research_agent(state)
    sessions[session_id] = state.messages    # 存回去
    return state.report
```

**这就是 ChatGPT"一个对话窗口"的本质**——session_id 关联一组 messages。

### 1.4 Long-term Memory 的核心思路

```python
# 按 user_id 存长期偏好
@app.post("/api/research")
async def research(req, user_id):
    user_memory = db.load_memory(user_id)
    # 例：{"role": "前端工程师", "past_topics": ["LangChain"]}
    
    system_prompt = f"""你是研究助手。
    用户背景：{user_memory['role']}
    历史研究：{user_memory['past_topics']}
    回答时考虑这些背景。"""
    
    state = run_research_agent(req.topic, system_prompt=system_prompt)
    db.save_memory(user_id, extract_new_facts(state))
    return state.report
```

---

## 二、Workflow：解决"干不了大事"

### 2.1 现状：单线程浅研究

现在的 Agent 把任何课题都当"一个 topic"处理：

```
用户："全面研究 AI Agent 领域"
Agent：搜 "AI Agent" → 5 条摘要 → 浅报告
       ← 这个大课题被当一个关键词搜，根本不全面
```

### 2.2 Workflow 的三个角色

```
大课题 → [Planner 拆解] → 子课题们
                              ↓
         [Executor 执行] ← 每个子课题跑一次现有 Agent
                              ↓
         [Synthesizer 综合] → 完整报告
```

| 角色 | 职责 | 类比 |
|------|------|------|
| **Planner** | 把大任务拆成子任务 | 项目经理 |
| **Executor** | 对每个子任务执行（复用 Day 5 Agent） | 干活的人 |
| **Synthesizer** | 把多份子结果综合成总报告 | 总编 |

### 2.3 关键洞察：Executor 复用 Day 5

```python
def execute(subtopics):
    reports = []
    for sub in subtopics:
        state = run_research_agent(sub)  # ← 复用 Day 5！
        reports.append(state.report)
    return reports
```

**Day 1-7 写的 `run_research_agent`，成了 Workflow 的一个"积木"。** 这就是"代码资产积累"的回报——7 天的努力不是白费的，它是进阶的地基。

---

## 三、Memory + Workflow 结合

真正好用的 Agent 是两者结合：

```
用户："像上次研究 LangChain 那样，研究一下 AutoGen"
            │
     ┌──────▼──────┐
     │ Memory 检索  │ "上次" → 找到历史研究模式/偏好
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │ Planner     │ 拆成子课题（参考历史模式）
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │ Executor    │ 每个子课题跑 Day 5 Agent
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │ Synthesizer │ 综合成总报告
     └──────┬──────┘
            │
     ┌──────▼──────┐
     │ Memory 更新  │ 这次研究存入用户记忆
     └─────────────┘
```

---

## 四、第二阶段路线图

### 4.1 分阶段实现（一阶段一闭环）

| 阶段 | 做什么 | 改哪里 | 效果 | 难度 |
|------|--------|--------|------|------|
| **A** | Session Memory | `server/main.py` 加 session | Agent 记住同会话对话 | ⭐ |
| **B** | Workflow: Planner | 新建 `workflow/` 包 | 大课题自动拆解 | ⭐⭐ |
| **C** | Workflow: 执行+综合 | 扩展 `workflow/` | 大课题深度研究 | ⭐⭐ |
| **D** | Long-term Memory | 加数据库 | 跨会话记住用户 | ⭐⭐⭐ |
| **E** | Memory Retrieval | 加向量库 | 智能检索相关记忆 | ⭐⭐⭐⭐ |

### 4.2 每个阶段的代码改动量预估

| 阶段 | 改动量 | 复用现有代码 |
|------|--------|------------|
| A | ~50 行改 server | 95% 复用 Day 5/7 |
| B+C | ~300 行新代码 | 复用 Day 5 的 `run_research_agent` |
| D | ~200 行 + DB schema | 在 A 基础上扩展 |
| E | ~300 行 + 向量库 | 在 D 基础上扩展 |

### 4.3 节奏：一阶段一闭环

每个阶段都是完整闭环：
```
思考"为什么需要" → 设计 → 实现 → 实测 → 写笔记 → 提交
```

---

## 五、关键认知（本篇总结）

### 认知 1：从"能用"到"好用"是质变

| 维度 | 能用（Day 1-7） | 好用（Day 8+） |
|------|----------------|---------------|
| 记忆 | 无（金鱼） | 有（连续对话/跨会话） |
| 任务规模 | 单课题 | 大任务拆解 |
| 用户感知 | "工具" | "助手" |

### 认知 2：Day 1-7 是 Day 8+ 的地基

**每一行之前的代码都在为后面铺路**：
- Day 3 的 State → Memory 的基础（记忆就是"持久化的 State"）
- Day 5 的 `run_research_agent` → Workflow 的 Executor
- Day 7 的 FastAPI → 加 Memory/Workflow 的载体

### 认知 3：进阶不是推翻重来，是加积木

```
Day 8+ 不会重写 Day 1-7 的代码
而是在它们基础上加新能力：
  + Memory 层（让 Agent 记住）
  + Workflow 层（让 Agent 规划）
  + MCP 层（让 Agent 接更多工具）  ← Lesson 07
```

### 认知 4："简单"的真相

做完 Day 7 容易觉得"Agent 简单"。Day 8 的思考告诉我们：
- **"能 demo"简单**（7 天证明）
- **"好用"不简单**（要加 Memory/Workflow/工程化）
- **"生产级"很难**（认证/队列/监控/高可用）
- **"强 Agent"极难**（多 Agent 协作/长程规划）

意识到"不简单"，本身就是一种能力。

---

## 六、下一步行动

```
⬜ 阶段 A：Session Memory（改 server，加会话历史）
   → 体验"Agent 记住我了"
   → 写笔记 + 提交
   → 进入阶段 B

⬜ 阶段 B+C：Workflow（新建 workflow/，Planner+Executor+Synthesizer）
   → 体验"Agent 能干大事了"
   → 写笔记 + 提交
   → 进入阶段 D

⬜ 阶段 D：Long-term Memory（加数据库）
⬜ 阶段 E：Memory Retrieval（加向量库）
```

**先做阶段 A**——改动最小（~50 行），效果最直观（立刻能体验多轮对话），是 Memory 的最佳起点。

---

## 附：本篇讨论的来源

这篇笔记的内容来自 Day 7 完成后的反思对话，核心问题链：
1. "做一个 Agent 简单吗？" → 认清"能 demo ≠ 好用"
2. "怎么让它好用？" → 需要 Memory + Workflow
3. "Memory/Workflow 怎么做？" → 三层 Memory + 三角色 Workflow
4. "先做哪个？" → Session Memory 最小切入

> 这些思考比代码更值钱——它们决定了"往哪里走"。代码是执行，思考是方向。

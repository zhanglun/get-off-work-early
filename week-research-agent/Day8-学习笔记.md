# AI Agent 从零实现 · 学习笔记（Day 8 · 第二阶段起点）

> Day 8 不是"又做一天功能"，而是**第二阶段的起点**。
> Day 1-7 完成了"能用的 Agent"，Day 8 开始做"好用的 Agent"。
>
> 本篇记录从"能用"到"好用"的思考：为什么 Memory 和 Workflow 是下一步，以及路线图。

> 📂 **关联代码**
> - Session Memory：`server/main.py`（SESSIONS 会话存储）、`research_agent/agent.py`（+ `history` 参数）、`research_agent/researcher.py`（history 拼进 messages）
> - Workflow：`workflow/`（Planner + Executor + Synthesizer）
>   - `planner.py`（LLM 拆解大课题）、`executor.py`（复用 `run_research_agent`）、`synthesizer.py`（综合子报告）、`agent.py`（编排三步）、`__main__.py`（CLI）
> - 运行：`python -m workflow "全面研究 AI Agent 领域"`、Web 端自动带 session_id

---

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

### 2.1 现状：单课题研究的覆盖有限

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

### 2.3 当前实现：固定 Workflow 复用 Day 5 Agent

```python
def execute(subtopics):
    reports = []
    for sub in subtopics:
        state = run_research_agent(sub)  # ← 复用 Day 5！
        reports.append(state.report)
    return reports
```

**Day 1-7 写的 `run_research_agent`，成了 Workflow 的一个"积木"。** 这就是"代码资产积累"的回报——7 天的努力不是白费的，它是进阶的地基。

需要准确区分当前实现与未来形态：

```text
当前代码（固定编排）：
run_workflow_agent
  → Planner 拆题
  → Executor 串行调用多个 run_research_agent
  → Synthesizer 汇总

未来形态（动态编排）：
上层 Agent 根据目标与观察结果，决定调用研究 / 对比 / 翻译等不同 Workflow。
```

当前 `run_workflow_agent` 的步骤与顺序是写死的；`use_workflow` 由调用方传入，也没有自动判断课题是否需要 Workflow。因此，它是**包含多个 Agent 执行单元的固定 Workflow**，而不是负责选择多个 Workflow 的上层 Agent。

---

## 三、Memory + Workflow 结合

真正好用的系统可以把两者结合。下图描述的是**目标形态**，当前 HTTP 服务尚未把 Workflow 接入请求路由：

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

## 六、实现记录

### 6.1 阶段 A：Session Memory（已完成 ✅）

**做了什么**：让 Agent 能记住同一会话内的多轮对话。

**改动**：
- `run_research_agent` 新增 `history` 参数——Agent 可"带着记忆"研究
- `researcher` 把历史 messages 拼进对话，让 LLM 理解上下文指代
- `server` 使用 SQLite 会话存储 + `get_or_create_session`
- `/api/research` 接收 `session_id`，存取历史对话
- Web UI 生成/传递 session_id（localStorage）+ 历史对话展示区

**实测验证**：
```
第 1 轮："LangChain 是什么"
  → Agent 研究，摘要："LangChain 是开源框架..."
  → 存入 session

第 2 轮："它和 AutoGen 比呢"
  → 加载 session 历史
  → Agent 正确理解"它"=LangChain！
  → 摘要："LangChain 和 AutoGen 是构建 AI 代理系统的两个不同框架..."
  → 🎉 Session Memory 生效！
```

**关键认知**：Session Memory 的本质很简单——就是"把上次对话的 messages 带进这次的 prompt"。没有黑魔法，就是 messages 列表的拼接。

### 6.2 阶段 B+C：Workflow（已完成 ✅）

**做了什么**：把单课题浅研究升级为大课题深度研究。

**架构**：
```
大课题 → [Planner 拆解] → 子课题们
                              ↓
         [Executor 执行] ← 每个复用 Day 5 的 run_research_agent
                              ↓
         [Synthesizer 综合] → 完整总报告
```

**新增文件**：
- `workflow/planner.py`：LLM 把大课题拆成 3-6 个子课题
- `workflow/executor.py`：对每个子课题复用 `run_research_agent`（代码资产积累！）
- `workflow/synthesizer.py`：把多份子报告综合成总报告（去重/重组/提炼）
- `workflow/agent.py`：编排 Planner→Executor→Synthesizer 三步

**实测验证**：
```
课题："全面研究 AI Agent 领域"

Planner 拆出 4 个子课题：
  1. AI Agent 主流框架对比
  2. AI Agent 典型应用场景
  3. AI Agent 核心技术原理
  4. AI Agent 面临的挑战和局限

Executor：4 份子报告全部完成（confidence=high）
Synthesizer：综合成覆盖框架/场景/技术/挑战的总报告
→ 总耗时 252s，confidence=high
```

**关键认知**：Workflow 的 Executor 就是 **Day 5 的 `run_research_agent`**。7 天的代码成了 Workflow 的积木——这就是"代码资产积累"的回报。

### 6.3 两个阶段的核心洞察

| 洞察 | 说明 |
|------|------|
| Memory 不神秘 | 本质是"把历史 messages 带进 prompt"，没有黑魔法 |
| Workflow 不复杂 | 本质是"拆 → 做 → 合"三步，每步都是已有能力 |
| 进阶不是推翻重来 | Day 1-7 的代码是 Day 8 的地基，不是被丢弃的脚手架 |
| 复用是最大的回报 | Workflow 直接复用 Day 5 Agent，0 行重复代码 |

### 6.4 重要澄清：Agent 和 Workflow 不是"二选一"

学完 Workflow 后，容易产生一个误解："用了 Workflow 就不用 Agent 了"或"Workflow 是 Agent 的升级版"。**这是错的。**

正确的理解是**不同抽象层级**：

```
              Agent（决策层 / 脑）
              决定"调哪个 Workflow""要不要换方案"
                     │
                     ▼
              Workflow（执行层 / 手）
              封装"固定步骤"（如 plan→execute→synthesize）
```

- **Workflow 是 Agent 的"执行模块"**——封装一组可复用、可预测的固定步骤
- **Agent 是 Workflow 的"决策者"**——根据目标和观察结果，决定什么时候调用哪个 Workflow

**一个成熟的 AI 系统**会把复杂任务拆成多个 Workflow，再由 Agent 在运行时**动态编排**这些 Workflow：
- Workflow 提供稳定可靠的执行能力
- Agent 提供自主决策和动态规划能力

**我们的项目现状**：`run_workflow_agent` 内部是固定的 plan→execute→synthesize 流程（Workflow），它的 Executor 调用的 `run_research_agent` 是单课题 Agent。**未来进化方向**是让一个上层 Agent 根据观察结果，动态决定调"研究 Workflow""对比 Workflow""翻译 Workflow"等。

> 📖 详见 `Agent-架构认知.md` 第九章「Agent vs Workflow：决策层 vs 执行层」

---

## 七、踩坑记录

### 🕳️ 踩坑 1：session 存回时 KeyError

**现象**：第一次请求（客户端传了 session_id）报 `KeyError: 'test001'`。

**原因**：客户端传了 session_id，但服务端 SESSIONS 里还没有这个 key（还没创建）。直接 `SESSIONS[session_id].append(...)` 就报错。

**解决**：用 `get_or_create_session(session_id)` 确保存在再操作。

**教训**：**读写共享状态前，必须确保状态存在**。这是并发编程的基本功。

---

## 八、下一步（阶段 D/E）

```
✅ 阶段 A：Session Memory（同会话记忆）
✅ 阶段 B+C：Workflow（大课题拆解）
⬜ 阶段 D：Long-term Memory（跨会话记忆，加数据库）
⬜ 阶段 E：Memory Retrieval（智能检索，加向量库）
```

阶段 D/E 是 Memory 的进阶：
- D：用数据库存用户偏好，跨会话记住"这个用户是前端工程师"
- E：记忆太多时用向量检索，只取和当前问题相关的记忆

这两个阶段需要引入数据库/向量库，复杂度更高。但有了 A-C 的基础，它们是自然延伸。

---

## 附：本篇讨论的来源

这篇笔记的内容来自 Day 7 完成后的反思对话，核心问题链：
1. "做一个 Agent 简单吗？" → 认清"能 demo ≠ 好用"
2. "怎么让它好用？" → 需要 Memory + Workflow
3. "Memory/Workflow 怎么做？" → 三层 Memory + 三角色 Workflow
4. "先做哪个？" → Session Memory 最小切入

> 这些思考比代码更值钱——它们决定了"往哪里走"。代码是执行，思考是方向。

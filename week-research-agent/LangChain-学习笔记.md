# LangChain 学习笔记（用框架重写对比版）

> 学习方式：用 LangChain 重写手写版 Agent，对比看透框架在做什么。
> 核心认知：**你 10 天手写的代码，框架都有对应封装。先学原理的价值在这里兑现。**

> 📂 **关联代码**
> - 目录：`langchain_version/`（用框架重写的版本，和手写版做对比）
>   - `tools.py`（用 `@tool` 重写工具，对比手写 `TOOLS_SCHEMA`；含 `show_what_framework_generates` 演示自动生成 schema）
>   - `agent.py`（用 `ChatZhipuAI` + `bind_tools` 重写 Loop，对比手写 while；另含 `AgentExecutor` 一行版）
> - 对比的手写版：`research_agent/`、`common/tools.py`、`common/schemas.py`
> - 运行：`python langchain_version/tools.py`（看自动 schema）、`python langchain_version/agent.py`（跑 LangChain 版 Agent）
> - 依赖：`langchain` + `langchain-community` + `langchain-zhipuai`

---

## 〇、心智模型：LangChain = 你写的代码的封装

### 对比一秒懂

```python
# 你 Day 3 手写的（while 循环，~100 行）
while message.tool_calls:
    if not state.can_continue():
        break
    for tool_call in message.tool_calls:
        result = TOOL_REGISTRY[fn_name](**args)
        ...
    response = client.chat.completions.create(...)

# LangChain 的（5 行）
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)
result = executor.invoke({"input": "..."})
```

**`AgentExecutor` 就是你 Day 3 写的那个 while 循环**——只是它帮你封装了。

### "先学原理"的价值

如果没手写过，看到 `AgentExecutor` 会一头雾水："这是什么黑盒？"

但你手写过，所以看到它时会想：**"哦，这就是我 Day 3 写的 while 循环封装成类了。"**

**这种"看透"的能力，是没手写过的人永远没有的。**

---

## 一、五大核心概念（手写版对照）

### 概念 1：LLM 包装器（ChatModel）

| 手写版 | LangChain |
|--------|-----------|
| `ZhipuAI().chat.completions.create(...)` | `ChatZhipuAI().invoke(...)` |
| 手动拼 messages | 自动转 messages |
| 手动解析 response | 自动返回标准格式 |

```python
# 手写
from zhipuai import ZhipuAI
client = ZhipuAI(api_key=Config.API_KEY)
response = client.chat.completions.create(model="glm-4-flash", messages=[...])

# LangChain（统一接口，换模型只改类名）
from langchain_community.chat_models import ChatZhipuAI
llm = ChatZhipuAI(model="glm-4-flash")
response = llm.invoke("你好")
```

**价值**：换 LLM 厂商只改一个类名，其他代码不动。

### 概念 2：Tool（工具）—— @tool 装饰器

这是最直观的对比。**`@tool` 帮你省了手写 schema 的全部工作**：

```python
# 手写版（三件套）
def search_web(query: str) -> dict:        # ① 函数
    return {...}
SEARCH_SCHEMA = {"type":"function",...}     # ② 手写 JSON schema（10 行）
TOOL_REGISTRY = {"search_web": search_web}  # ③ 手写注册 dict

# LangChain 版（一个装饰器）
@tool
def search_web(query: str) -> str:
    """联网搜索互联网上的最新信息。"""   # ← docstring 自动变成 description
    return "..."
# schema 全自动生成，不用手写
```

**`@tool` 自动做了什么**：

| 信息 | 手写版你要做什么 | `@tool` 自动做了什么 |
|------|----------------|---------------------|
| `name` | 手动写 `"name": "add"` | 从函数名自动取 |
| `description` | 手动写 JSON 里的 | **从 docstring 自动取** |
| `args` 类型 | 手动写 `"type": "number"` | **从类型注解 `a: float` 自动取** |
| `required` | 手动写 `["a", "b"]` | 自动从参数推断 |

**实测验证**（`tools.py` 的 `show_what_framework_generates`）：
```
--- add ---
name: add                                    ← 自动从函数名
description: 计算两个数字的加法...            ← 自动从 docstring
args: {'properties': {'a': {'type': 'number'}, 'b': {'type': 'number'}},
       'required': ['a', 'b']}               ← 自动从类型注解
```

**认知**：`@tool` 不是魔法，它做的事就是你手写的 schema——只是用 Python 的反射机制（`inspect`）从函数签名和 docstring 自动提取。

### 概念 3：Prompt 模板

| 手写版 | LangChain |
|--------|-----------|
| `f"研究课题：{topic}"` 字符串拼接 | `ChatPromptTemplate` 变量占位 |

```python
# 手写
state.messages = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {"role": "user", "content": f"研究课题：{topic}"},
]

# LangChain
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个研究助手..."),
    ("user", "研究课题：{topic}"),
])
formatted = prompt.invoke({"topic": "LangChain"})
```

### 概念 4：Chain（链）—— LCEL 管道符

LangChain 最特色的语法：

```python
# | 管道符串联（就像 Unix 管道）
chain = prompt | llm | output_parser
result = chain.invoke({"topic": "LangChain"})
```

```
prompt | llm | output_parser
= prompt 的输出 → llm 的输入
= llm 的输出 → output_parser 的输入

类比 Unix：cat file | grep "xxx" | sort
```

### 概念 5：Agent + AgentExecutor

```python
# 你 Day 3 手写 Loop（~100 行）
while message.tool_calls:
    result = TOOL_REGISTRY[fn_name](**args)
    ...

# LangChain 的 AgentExecutor（5 行）
agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, max_iterations=8)
result = executor.invoke({"input": "..."})
```

**`AgentExecutor` 帮你封装了**：

| 你的手写 | AgentExecutor 的对应 |
|---------|---------------------|
| `while message.tool_calls:` | 内部循环 |
| `TOOL_REGISTRY[fn_name](**args)` | 自动调工具 |
| `state.can_continue()` (max_steps) | `max_iterations` 参数 |
| `state.add_tool_call(...)` | 自动记录 |
| `try/except` 错误处理 | `handle_parsing_errors` |

---

## 二、实测对比

### 测试 1：工具调用（query_docs）

```
问题："团队代码规范里 Git 提交信息怎么写"

LangChain 版 Agent 行为：
  第 1 步：🔧 调用工具 query_docs（查本地知识库）
          → 检索到 3 块文档
  第 2 步：💬 基于检索结果回答
          → 准确：type(scope): description 格式

对比手写版（Day 11）：
  行为完全一样（都调 query_docs 查私有文档）
  但 LangChain 版代码量少 60%
```

### 一个重要观察：LLM 的随机性

测试中发现：同样问"公司报销流程"，LangChain 版有时调 query_docs，有时不调（直接用旧知识答）。

**这正是 Day 6 评估笔记讲的"LLM 评估有天生噪音"**——同一个 Agent + 同一个问题，两次运行可能不同。这不是框架的问题，是 LLM 的本质特性。

---

## 三、你的手写经验 vs 框架概念（完整对照）

这是最有价值的表——**你 10 天写的每个东西，框架都有对应**：

| 你手写的 | 对应的框架概念 | 你的优势 |
|---------|--------------|---------|
| Day 1-2 工具 + Tool Registry | `@tool` + `tools` 列表 | 你懂工具调用全链路 |
| Day 3 while 循环 | `AgentExecutor` | 你懂循环内部机制 |
| Day 3 AgentState | LangGraph 的 `State` | 你懂状态管理 |
| Day 4 日志/重试/超时 | 框架的 callback + retry | 你懂为什么需要这些 |
| Day 5 两步法 | LangGraph 的多节点工作流 | 你懂编排原理 |
| Day 5 System Prompt | `ChatPromptTemplate` | 你懂 prompt 设计 |
| Day 8 Session Memory | `Memory` / `checkpointer` | 你懂记忆的本质 |
| Day 8 Workflow | LangGraph 的 `StateGraph` | 你懂工作流编排 |
| Day 9 Streaming | 框架的 `stream()` 方法 | 你懂流式原理 |
| Day 10 持久化 | `checkpointer` + 数据库 | 你懂持久化原理 |
| RAG（Lesson 04） | LangChain 的 `RetrievalChain` | 你懂 RAG 全流程 |

**你 10 天手写的东西，覆盖了 LangChain + LangGraph 90% 的核心概念。**

---

## 四、踩坑记录

### 🕳️ 踩坑 1：ChatZhipuAI 的导入路径

**现象**：`from langchain_zhipuai import ChatZhipuAI` 报 `ImportError`。

**原因**：`langchain_zhipuai` 包的导出为空（`dir() == []`），`ChatZhipuAI` 不在这个包里。

**解决**：从社区包导入——`from langchain_community.chat_models import ChatZhipuAI`。

**教训**：LangChain 的包结构很乱（核心包/社区包/官方集成包），导入路径经常对不上。**踩坑时先 `dir()` 看导出，或查文档确认路径。**

### 🕳️ 踩坑 2：langchain-community 的 DeprecationWarning

**现象**：导入 `ChatZhipuAI` 时有警告"langchain-community is being sunset"。

**原因**：LangChain 在拆分社区包，很多集成正在迁移到独立包。

**应对**：学习阶段忽略警告（能用就行）。生产时关注迁移动态。

---

## 五、难点与思考

### 思考 1：框架的价值 = 少写代码，但原理不变

```
手写版：~100 行 while 循环 + 工具注册 + 状态管理
框架版：~5 行 AgentExecutor

省了什么：样板代码（schema、循环、注册、错误处理）
没省什么：原理（你还是得懂 LLM + Tool + Loop）
```

**框架让你写得快，但不能让你不懂原理。** 不懂原理用框架，出问题时完全不会调试。

### 思考 2：框架的代价 = 黑盒 + 抽象泄漏

```python
# 框架版看起来简单
result = executor.invoke({"input": "..."})

# 但出问题时：
# - 工具调用失败？不知道在哪查（黑盒）
# - max_iterations 怎么生效的？要看源码
# - 想加自定义逻辑（如 token 统计）？要学 callback 机制
```

**手写版的优势**：每个细节你都懂，出问题能精确定位。框架版的优势是快，代价是不透明。

### 思考 3：什么时候用框架，什么时候手写

| 场景 | 选什么 |
|------|--------|
| 学习原理 | ✋ 手写（你已做完了） |
| 快速原型 | 📦 框架（省时间） |
| 生产简单应用 | 📦 框架（生态 + 维护） |
| 生产复杂定制 | ✋ 手写 + 框架混合 |
| 面试展示原理理解 | ✋ 手写（能讲清原理） |

**你已经完成了"手写学原理"这一关**。现在用框架是"提效工具"，不是"学习依赖"。

### 思考 4：@tool 装饰器背后的反射机制

`@tool` 不是魔法，它用的是 Python 的**反射**（reflection）：

```python
# @tool 等价于这样做（伪代码）
def tool(func):
    name = func.__name__                    # 反射：取函数名
    description = func.__doc__              # 反射：取 docstring
    args = inspect.signature(func)          # 反射：取参数签名
    schema = build_json_schema(args)        # 从签名生成 schema
    return Tool(func, name, description, schema)
```

**你在 Day 2 手写 schema 时做的事，`@tool` 用反射自动做了。** 理解这点，`@tool` 就不神秘了。

---

## 六、Agent 推理范式：ReAct / Plan-and-Solve / Function Calling（重要澄清）

### 6.1 ReAct 是什么

> **ReAct = Reasoning（推理）+ Acting（行动）的交替执行。** Agent 先"想"（Thought），再"做"（Action），看结果（Observation）再"想"，循环往复。

ReAct 是 2022 年 Yao 等人提出的，原始流程：

```
Thought: 用户问 LangChain 是什么，我需要搜索
Action: search("LangChain")
Observation: LangChain 是一个 AI 框架...
Thought: 搜到了，但需要更多细节
Action: fetch_url("...")
Observation: ...
Thought: 信息够了，可以回答了
Action: Finish("LangChain 是...")
```

**三个关键词的循环**：Thought → Action → Observation → Thought → ... 这就是 ReAct 名字的由来（Re(asoning) + Act(ing)）。

### 6.2 你的实现是 ReAct 吗

**严格说：不是经典 ReAct，是它的现代演进版——Function Calling Agent。**

看你的代码：

```python
# 你的 researcher.py（Day 3-5）
while message.tool_calls:        # ← LLM 直接返回 tool_calls
    result = TOOL_REGISTRY[fn_name](**args)
```

**你的 Agent 没有显式的 Thought 步骤**——LLM 直接返回 `tool_calls`（结构化 JSON），而不是用自然语言"思考"。

### 6.3 两种模式的对比

#### 经典 ReAct（2022，基于 prompt 文本解析）

```
LLM 输出（纯文本，要解析）：
  Thought: 我需要搜索 LangChain
  Action: search
  Action Input: LangChain

代码要解析这段文本，提取 Action 和 Input
```

```python
# 经典 ReAct 伪代码
response = llm(prompt)
# response 是文本："Thought: ...\nAction: search\nAction Input: LangChain"
thought, action, action_input = parse_react_text(response)  # ← 要自己解析！
result = TOOL_REGISTRY[action](action_input)
```

#### Function Calling Agent（2023+，你的实现）

```
LLM 输出（结构化 JSON，直接用）：
  {"tool_calls": [{"name": "search", "args": {"query": "LangChain"}}]}

代码直接用，不用解析文本
```

```python
# 你的实现
for tool_call in response.choices[0].message.tool_calls:  # ← 结构化
    result = TOOL_REGISTRY[tool_call.function.name](**args)
```

### 6.4 核心区别

| 维度 | 经典 ReAct | 你的实现（Function Calling） |
|------|-----------|---------------------------|
| **思考方式** | 自然语言 Thought（显式） | LLM 内部推理（隐式） |
| **工具调用** | 文本解析 `Action: xxx` | 结构化 `tool_calls` JSON |
| **解析难度** | 高（要正则解析文本） | 零（API 直接返回结构） |
| **可靠性** | 低（LLM 可能格式错） | 高（API 保证格式） |
| **时代** | 2022（LLM 不支持 function calling） | 2023+（原生 function calling） |

**为什么有这个区别**：2022 年 LLM 不支持 function calling，ReAct 用 prompt 让 LLM 输出文本，开发者解析。2023 年后 OpenAI/智谱原生支持 function calling，**LLM 内部做 Reasoning，直接返回结构化 tool_calls**。

### 6.5 ReAct 死了吗？没有，它演进了

**Function Calling Agent 是 ReAct 的现代化版本**：

```
ReAct（2022）：      Thought（显式文本）→ Action（要解析）→ Observation
                     三个步骤都在 prompt 里

Function Calling：   Reasoning（LLM 内部）→ tool_calls（结构化）→ Observation
                     Reasoning 隐式发生，Action 结构化返回
```

**ReAct 的思想没变**（推理+行动循环），**实现方式从"prompt 解析"进化到"原生 function calling"**。

### 6.6 LangChain 里的命名印证

| LangChain Agent 类型 | 对应什么 |
|---------------------|---------|
| `create_react_agent` | 经典 ReAct（文本解析，老式） |
| `create_tool_calling_agent` | Function Calling（你的实现，现代） |
| `create_json_agent` | JSON 格式的 ReAct |
| `create_structured_chat_agent` | 结构化输出的 ReAct |

**我们的 `agent.py` 用 `create_tool_calling_agent`（不是 `create_react_agent`）**——现代版"ReAct 思想 + function calling 实现"。

### 6.7 Thought 去哪了

**你的 Agent 其实有 Thought，只是看不到。**

调用 `client.chat.completions.create(tools=...)` 时，LLM 内部做的事：

```
LLM 收到：messages + tools 清单
LLM 内部推理（你看不到的 Thought）：
  "用户问 LangChain 是什么，我有 search_web 工具，应该先搜。"
LLM 输出（你看到的）：
  tool_calls: [{"name": "search_web", "args": {"query": "LangChain"}}]
```

**Thought 发生在 LLM 内部，输出时被"压缩"成 tool_calls。**

**新趋势（2024-2025）**：有些模型（Claude 3.5、DeepSeek-R1、o1/o3）支持**显式 reasoning**——把 Thought 也返回，让开发者能看到推理过程。这就是 ChatGPT o1 的"思考过程"展示。

### 6.8 ReAct 家族谱

```
ReAct（2022，原始论文）
  ├─ 经典 ReAct（prompt + 文本解析）      ← LangChain 的 create_react_agent
  ├─ Function Calling Agent（原生 API）   ← 你的实现 / create_tool_calling_agent
  └─ 推理模型 Agent（显式 Thought）       ← o1/o3/DeepSeek-R1（最新）

共同核心：Reasoning + Acting 循环
区别：Thought 怎么表达、Action 怎么调用
```

### 6.9 面试场景

如果被问"你的 Agent 是 ReAct 模式吗"：

> **"是 ReAct 思想的现代实现——Function Calling Agent。**
> 经典 ReAct 用 prompt 让 LLM 输出 Thought/Action 文本，开发者解析。我的实现用原生 function calling，LLM 内部做 Reasoning，直接返回结构化 tool_calls，更可靠。
> **核心思想一样**（推理+行动循环），**实现方式更现代**（function calling 替代文本解析）。"

这个回答展示你**既懂历史（ReAct 论文），又懂现代（function calling），还懂区别**。

### 6.10 关键澄清：这三个词不在同一个层次

讨论 Plan-and-Solve 前，先理清层次——**这三个词经常被混为一谈，但它们属于不同层次**：

```
层次 1：推理范式（Agent 怎么思考+行动）
  ├─ ReAct（边想边做，走一步看一步）
  └─ Plan-and-Solve（先规划全盘，再执行）

层次 2：实现手段（怎么调工具）
  └─ Function Calling（LLM 原生 API，结构化 tool_calls）

这两个层次是正交的（可以组合）：
  ReAct + Function Calling          ← 你的 Day 3-5
  Plan-and-Solve + Function Calling ← 你的 Day 8 Workflow
```

**Function Calling 不是 ReAct 的"替代品"或 Plan-and-Solve 的"竞争者"——它是横切的实现手段，和这两个范式正交。**

### 6.11 Plan-and-Solve：先想好再走

#### 定义

> **Plan-and-Solve = 先制定完整计划（Plan），再逐个执行（Solve）。** Agent 在行动前先全局规划，而不是走一步看一步。

#### 执行流程对比

**ReAct**（走一步看一步）：
```
Thought: 我先搜一下框架
Action: search_web("AI Agent framework")
Observation: LangChain, AutoGen...
Thought: 看到框架了，再搜应用
Action: search_web("AI Agent applications")
Observation: ...
Thought: 够了，回答
```

**Plan-and-Solve**（先规划全盘）：
```
===== Plan 阶段 =====
Planner: 拆成 4 个子课题：
  1. 主流框架对比
  2. 典型应用场景
  3. 核心技术原理
  4. 面临的挑战

===== Solve 阶段 =====
执行子课题 1 → 搜索框架
执行子课题 2 → 搜索应用
执行子课题 3 → 搜索技术
执行子课题 4 → 搜索挑战

===== 综合 =====
Synthesizer → 总报告
```

### 6.12 ReAct vs Plan-and-Solve 核心区别

| 维度 | ReAct | Plan-and-Solve |
|------|-------|----------------|
| **何时规划** | 边走边规划（每步重新决策） | 先规划全盘，再执行 |
| **规划粒度** | 一步（下一步干什么） | 全局（整个任务拆成几块） |
| **适应性** | 高（每步看结果调整） | 低（计划定了中途难改） |
| **适合任务** | 探索性、不确定的 | 复杂、可拆解的 |
| **风险** | 可能发散（走偏） | 计划错了全盘错 |
| **类比** | 探险家（走一步看一步） | 建筑师（先画图纸再施工） |

### 6.13 你的代码就是最好的对照

你同时实现了这两种范式——这是最精彩的发现：

**Day 3-5（ReAct）**：
```python
# researcher.py 的 while 循环 = ReAct
while message.tool_calls:       # 每步重新决策
    result = search_web(query)  # Action
    # Observation 传回 LLM → 决定下一步（Thought）
```

**Day 8 Workflow（Plan-and-Solve）**：
```python
# workflow/agent.py = Plan-and-Solve
subtopics = plan(topic)         # Plan：先拆解全盘
for sub in subtopics:
    run_research_agent(sub)     # Solve：逐个执行
synthesize(sub_reports)         # 综合
```

**两者在你项目里的配合**：
```
Day 8 Workflow（Plan-and-Solve 大框架）
  ├─ Planner：拆成 4 个子课题           ← Plan 阶段
  ├─ Executor：逐个执行                  ← Solve 阶段
  │   └─ 每个子课题调 run_research_agent
  │       └─ 里面是 ReAct 循环           ← 子任务内部走一步看一步
  └─ Synthesizer：综合                   ← 最终汇总
```

**你的项目天然就是"Plan-and-Solve 外壳 + ReAct 内核"的组合**：
- 大框架用 Plan-and-Solve（先拆解）
- 每个子任务用 ReAct（边搜边看）

这不是巧合，而是业界常见模式——LangChain 的 `create_plan_and_execute_agent` 就是这个结构。

### 6.14 三者关系的完整图

```
┌─────────────────────────────────────────────┐
│             推理范式（怎么思考）              │
│                                             │
│   ReAct              Plan-and-Solve         │
│   边想边做            先规划全盘             │
│   走一步看一步        先画图纸再施工         │
│                                             │
│   你的 Day 3-5       你的 Day 8 Workflow    │
└──────────────────┬──────────────────────────┘
                   │
                   │ 都可以搭配 ↓
                   ▼
┌─────────────────────────────────────────────┐
│          实现手段（怎么调工具）              │
│                                             │
│   Function Calling（原生 API，结构化）       │
│   你的两种范式都用它实现                      │
└─────────────────────────────────────────────┘
```

### 6.15 更新后的面试话术

如果被问"你的 Agent 用什么模式"：

> **"我的 Agent 是'Plan-and-Solve 外壳 + ReAct 内核 + Function Calling 手段'的组合。**
>
> - 单课题研究用 ReAct（Day 3-5）：LLM 边搜边看，每步根据结果决定下一步
> - 大课题研究用 Plan-and-Solve（Day 8 Workflow）：Planner 先拆成子课题，Executor 逐个执行
> - 两者都用 Function Calling 实现工具调用（不是文本解析的经典 ReAct）
>
> **这三个词在不同层次**：ReAct/Plan-and-Solve 是推理范式，Function Calling 是实现手段，它们正交可组合。"

这个回答展示你**懂范式、懂手段、懂层次关系、还有代码实证**。

---

## 七、关键概念速查表

| 术语 | 含义 | 对应你的手写 |
|------|------|------------|
| **ChatModel** | LLM 统一包装 | `ZhipuAI().chat.completions.create` |
| **@tool** | 自动生成 schema 的装饰器 | 手写 TOOLS_SCHEMA + TOOL_REGISTRY |
| **ChatPromptTemplate** | prompt 模板 | f-string 拼接 |
| **LCEL（`\|` 管道）** | 用管道串联组件 | 手动调函数串联 |
| **Agent** | LLM + 工具 + prompt 的组合 | 你的 researcher 配置 |
| **AgentExecutor** | 封装 while 循环 | 你的 while message.tool_calls |
| **max_iterations** | 最大循环次数 | 你的 max_steps |
| **Message** | 对话消息（Human/AI/System/Tool） | 你的 role/content dict |
| **LangGraph** | 工作流编排（图） | 你的 run_research_agent 编排 |
| **ReAct** | Reasoning+Acting 交替循环（2022 论文） | 你的 Loop 的思想源头 |
| **Thought/Action/Observation** | ReAct 的三要素 | 你的隐式推理+tool_calls+result |
| **Function Calling Agent** | ReAct 的现代版（原生 API） | 你的实现方式 |
| **create_react_agent** | 经典 ReAct（文本解析） | 你没用（老式） |
| **create_tool_calling_agent** | Function Calling（现代） | 你的实现 |
| **Plan-and-Solve** | 先规划全盘再逐个执行（推理范式） | 你的 Day 8 Workflow（Planner→Executor→Synthesizer） |
| **create_plan_and_execute_agent** | LangChain 的 Plan-and-Solve 实现 | 你的 workflow/ 的框架版 |
| **推理范式 vs 实现手段** | ReAct/PS 是范式，Function Calling 是手段，正交可组合 | 你的项目是三者组合 |

---

## 八、当前进度 & 下一步

```
✅ 手写版 Agent（Day 1-10 + RAG）           ← 你懂原理
✅ LangChain 对比学习（工具 + LLM + Loop）   ← 你看透框架封装
⬜ LangChain 进阶（Memory / Streaming）
⬜ LangGraph（用图重写两步法工作流）
⬜ 多 Agent 协作（LangGraph 多节点）
```

---

## 附：文件结构

```
langchain_version/
├── __init__.py
├── tools.py       ← @tool 重写工具（对比手写 schema）
└── agent.py       ← ChatZhipuAI + bind_tools 重写 Loop（对比手写 while）

运行方式：
  python langchain_version/tools.py    # 看自动生成的 schema
  python langchain_version/agent.py    # 跑 LangChain 版 Agent
```

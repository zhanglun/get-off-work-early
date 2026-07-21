# LangChain 学习笔记（用框架重写对比版）

> 学习方式：用 LangChain 重写手写版 Agent，对比看透框架在做什么。
> 核心认知：**你 10 天手写的代码，框架都有对应封装。先学原理的价值在这里兑现。**

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

## 六、关键概念速查表

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

---

## 七、当前进度 & 下一步

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

# Agent 学习上下文（Lesson 01\~02）

## 学习目标

-   理解 Agent 的底层原理，而不是先依赖框架。
-   最终能够独立开发、测试、部署可用于生产的 Agent。

------------------------------------------------------------------------

# Lesson 01：Agent 基础

## 核心公式

Agent = LLM + Tool + Loop

普通聊天：

User -\> LLM -\> Answer

Agent：

User -\> LLM -\> 判断是否需要 Tool -\> Python 执行 Tool -\> Observation
-\> LLM -\> Final Answer

## 四个角色

### 1. LLM

负责理解任务、决定是否调用 Tool、生成 Tool 参数。

### 2. Tool Schema

告诉模型有哪些工具、每个工具的用途和参数。

### 3. Python Tool

真正执行任务，本质就是普通 Python 函数。

### 4. Agent Loop

伪代码：

``` python
while True:
    response = LLM()

    if response wants tool:
        result = Tool()
        send result back to LLM
    else:
        break
```

------------------------------------------------------------------------

# Lesson 02：实现最小 Agent

项目结构：

``` text
agent-from-zero/
├── main.py
├── agent.py
├── tools.py
├── schemas.py
```

## Tool

示例：

-   add(a, b)
-   read_file(path)
-   search_web(query)

统一返回：

``` python
{
    "success": True,
    "result": ...
}
```

## Tool Registry

``` python
TOOLS = {
    "add": add,
    "read_file": read_file,
    "search_web": search_web,
}
```

作用：根据模型返回的工具名找到真正的 Python 函数。

## Tool Schema

发送给模型：

-   tool name
-   description
-   parameters

作用：告诉模型有哪些工具可选。

## Agent 流程

1.  User 输入
2.  responses.create(..., tools=TOOLS_SCHEMA)
3.  模型返回 function_call
4.  Python 从 TOOLS 找到函数并执行
5.  将 function_call_output 返回给模型
6.  模型生成最终答案

------------------------------------------------------------------------

# Tool Calling 的本质

模型不会执行 Tool。

模型只会输出：

-   Tool 名称
-   参数

Python 才是真正执行者。

流程：

User -\> LLM -\> "调用 add(a=1,b=2)" -\> Python 执行 add() -\> 返回结果
-\> LLM 输出自然语言答案

------------------------------------------------------------------------

# Tool 的本质

Tool 就是普通 Python 函数。

例如：

-   Web Search
-   GitHub API
-   数据库
-   文件读取
-   天气 API

模式一致：

输入 -\> Python -\> API / 文件 / 数据库 -\> 返回结构化数据

------------------------------------------------------------------------

# Tool Schema 与 Tool Registry 的区别

  名称            面向对象   作用
  --------------- ---------- ---------------------
  Tool Schema     LLM        告诉模型有哪些 Tool
  Tool Registry   Python     找到真正的函数

------------------------------------------------------------------------

# 当前掌握的知识

-   Tool Calling
-   Tool Schema
-   Tool Registry
-   Agent Loop
-   Observation
-   Function Call

------------------------------------------------------------------------

# 后续学习计划

Lesson 03： - 多步骤 Agent - State（状态管理） - 多 Tool 连续调用 -
日志 - max_steps - Retry - 真实 Web Search

Lesson 04： - RAG

Lesson 05： - Memory

Lesson 06： - Workflow

Lesson 07： - MCP

Lesson 08： - LangGraph

Lesson 09： - Evaluation

Lesson 10： - Deployment

------------------------------------------------------------------------

# 核心理念

不要先学框架。

先理解：

LLM ↓

Tool Calling ↓

Python Tool ↓

Observation ↓

Agent Loop

框架只是把这些能力封装起来。

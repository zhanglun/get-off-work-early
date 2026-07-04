# AI Agent 学习总计划（3\~4个月）

## 最终目标

成为能够独立设计、开发、测试、部署 AI Agent 的工程师，并具备应聘 AI
Agent / Applied AI Engineer 岗位的能力。

掌握： - LLM API - Tool Calling - Agent Loop - State Management -
Workflow - RAG - Memory - MCP - Evaluation - Deployment

------------------------------------------------------------------------

# 学习原则

1.  先学原理，再学框架。
2.  每个阶段都有一个可运行项目。
3.  每完成一个阶段提交 Git。
4.  作品集比 Demo 更重要。

------------------------------------------------------------------------

# Lesson 01：Agent 基础

目标： - 理解 Agent = LLM + Tool + Loop - 理解 Tool Schema、Tool
Registry、Observation - 实现最小 Agent Loop

项目： - Calculator Tool - Read File Tool - Mock Search Tool

产出： - Mini Agent

------------------------------------------------------------------------

# Lesson 02：Tool Calling

目标： - 实现自动 Tool Calling - 注册 Tool - Function Call -\> Python
-\> Function Output -\> Final Answer

项目： - Tool Registry - Agent Loop - 多 Tool 支持

产出： - 可自动调用工具的 Agent

------------------------------------------------------------------------

# Lesson 03：State & Workflow

目标： - 多步骤任务 - State 管理 - max_steps - Retry - 日志

项目： - Research Agent（真实 Web Search）

产出： - 支持连续多步执行的 Agent

------------------------------------------------------------------------

# Lesson 04：RAG

目标： - 文档解析 - Chunk - Embedding - Vector Database - Retrieval

项目： - Knowledge Agent

------------------------------------------------------------------------

# Lesson 05：Memory

目标： - Session Memory - Long-term Memory - Memory Retrieval

项目： - Personal Memory Agent

------------------------------------------------------------------------

# Lesson 06：Workflow

目标： - Planner - Executor - Task Queue - State Machine

项目： - Coding Workflow Agent

------------------------------------------------------------------------

# Lesson 07：MCP

目标： - MCP Client - MCP Server - Tool Registration - Resource

项目： - MCP Demo

------------------------------------------------------------------------

# Lesson 08：LangGraph

目标： - StateGraph - Checkpoint - Human in the Loop

项目： - 使用 LangGraph 重构 Workflow Agent

------------------------------------------------------------------------

# Lesson 09：Evaluation

目标： - Benchmark - Success Rate - Tool Accuracy - Token Cost - Latency

项目： - Agent 自动评测

------------------------------------------------------------------------

# Lesson 10：Deployment

目标： - FastAPI - Docker - Redis - PostgreSQL - API Service

项目： - 部署完整 Agent 服务

------------------------------------------------------------------------

# 推荐作品集结构

agent-learning/ ├── 01-mini-agent/ ├── 02-tool-calling/ ├──
03-research-agent/ ├── 04-rag/ ├── 05-memory/ ├── 06-workflow/ ├──
07-mcp/ ├── 08-langgraph/ ├── 09-evaluation/ └── 10-deployment/

------------------------------------------------------------------------

# 每个项目都要回答的问题

-   为什么这样设计？
-   State 放在哪里？
-   为什么需要 Tool？
-   如何避免无限循环？
-   如何做 Retry？
-   如何控制成本？
-   如何做 Evaluation？

------------------------------------------------------------------------

# 学习节奏

第1-2周：Lesson01-02（Agent 基础） 第3-4周：Lesson03（Research Agent）
第5-6周：Lesson04（RAG） 第7周：Lesson05（Memory）
第8-9周：Lesson06（Workflow） 第10周：Lesson07（MCP）
第11-12周：Lesson08（LangGraph） 第13周：Lesson09（Evaluation）
第14周：Lesson10（Deployment）

------------------------------------------------------------------------

# 最终成果

完成一个从零实现 Agent 的开源项目，包含： - 完整源码 - 文档 - 架构设计 -
测试 - 部署 - Git 历史 - 可作为求职作品集

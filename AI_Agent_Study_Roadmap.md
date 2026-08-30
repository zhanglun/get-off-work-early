# AI Agent 学习总计划（3\~4个月）

## 最终目标

成为能够独立设计、开发、测试、部署 AI Agent 的工程师，并具备应聘 AI
Agent / Applied AI Engineer 岗位的能力。

掌握： - LLM API - Tool Calling - Agent Loop - State Management -
Workflow - RAG - Memory - MCP - Evaluation - Deployment

------------------------------------------------------------------------

# 学习原则

1. 先学原理，再学框架。
2. 每个阶段都有一个可运行项目。
3. 每完成一个阶段提交 Git。
4. 作品集比 Demo 更重要。

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

- 为什么这样设计？
- State 放在哪里？
- 为什么需要 Tool？
- 如何避免无限循环？
- 如何做 Retry？
- 如何控制成本？
- 如何做 Evaluation？

------------------------------------------------------------------------

# 学习节奏

第1-2周：Lesson01-02（Agent 基础） 第3-4周：Lesson03（Research Agent）
第5-6周：Lesson04（RAG） 第7周：Lesson05（Memory）
第8-9周：Lesson06（Workflow） 第10周：Lesson07（MCP）
第11-12周：Lesson08（LangGraph） 第13周：Lesson09（Evaluation）
第14周：Lesson10（Deployment）

------------------------------------------------------------------------

# 实际进度对账（2026-08 校正）

> 依据：`week-research-agent/` 代码 + Day1-10 笔记 + git 提交记录。
> 实际路线偏离了原计划：没有按 10 个 Lesson 逐个推进，而是走了一条「7 天
> 冲刺 + Day8-10 第二阶段打磨」的路线，覆盖了原计划大部分内容。

| Lesson | 计划内容 | 状态 | 实际产出 |
| -------- | --------- | ------ | ---------- |
| 01 Agent 基础 | 最小 Agent Loop | ✅ 完成 | `day1/` + Lesson01-02 笔记 |
| 02 Tool Calling | Registry / Schema / 全链路 | ✅ 完成 | `day2/` + `common/` |
| 03 State & Workflow | State / max_steps / Retry / 日志 / 真实搜索 | ✅ 完成 | `day3/`、`day4/`、`research_agent/`（真实搜索 + 读全文） |
| 04 RAG | Chunk / Embedding / 检索 | ✅ 完成 | `rag/`（loader/embedder/store/chain）+ RAG 笔记 |
| 05 Memory | Session / Long-term / Retrieval | ◐ 大部分完成 | Session Memory（Day8）+ SQLite 持久化（Day10，`server/storage.py`）；缺跨会话 Long-term Memory |
| 06 Workflow | Planner / Executor / Task Queue | ✅ 基本完成 | `workflow/`（Planner + Executor + Synthesizer）；无显式状态机 |
| 07 MCP | Client / Server / Resource | ❌ 未开始 | —— |
| 08 LangGraph | StateGraph / Checkpoint / HITL | ◐ 学习中 | `langgraph_version/lesson01_minimal_graph.py`：最小 StateGraph + ToolNode + 条件路由已跑通；Checkpoint / HITL 未开始 |
| 09 Evaluation | Benchmark / 成功率 / Token 成本 | ✅ 完成 | `evaluation/`（metrics/judge）+ Day10 Token 成本统计 |
| 10 Deployment | FastAPI / Docker / Redis / PG | ◐ 部分完成 | `server/`（FastAPI + SSE 流式 + Web UI + SQLite）；缺 Docker/Redis/PostgreSQL |

## 超出原计划的产出

- Day9：SSE 流式输出（观察者模式 + 线程/Queue 桥接）
- Day5：两步法 + System Prompt + fetch_url 深度阅读
- Day10：Token 成本量化（state.add_usage）
- LangGraph Lesson 01：最小工具循环图（`StateGraph` / `ToolNode` / 条件路由），配套 `LangGraph-学习笔记.md`
- Mastra 框架实践：`mastra-playground/` 保留为通用 API 学习沙盒；`mastra-short-drama-agent/` 已成为唯一活跃短剧业务主线，完成 StoryBible、Scene Planning、Shot/Prompt/Review/Refine、确认门槛、PostgreSQL、异步 API、聊天入口和导出闭环

## 剩余缺口（按求职作品集优先级）

1. **MCP**（完全空白，2026 年岗位 JD 高频词）
2. **LangGraph**（StateGraph / Checkpoint / Human-in-the-Loop）
3. **Long-term Memory**（跨会话记忆 + 检索）
4. **容器化部署**（Docker；Redis/PG 可选——知识层已有 interview-handbook 第 07/08/12 章覆盖，缺项目落地）

## 并行路线提醒

Agent 路线最后提交 2026-07-22，此后重心转向：

- `embodied-data-loop/`（具身智能转型，进行中，至 2026-08-07）
- `ai-platform-interview-handbook/`（面试手册，13 章 ~2.9 万行，至 2026-07-14）

恢复 Agent 路线时，从 MCP（缺口 1）开始。

## 学习进度（会话接续用）

> 每次学习结束及时更新本节。

**当前状态**：▶ 学习与开发中——LangGraph Lesson 01 已完成；Mastra Lesson 01/02 已完成。短剧业务主线已收敛到 `mastra-short-drama-agent/`，并完成 Project/Episode、Markdown 解析、StoryBible、Scene Planning、分镜生产、提示词、审查修订、确认门槛、版本、PostgreSQL、异步 API、聊天路由、资产工作区和导出。Mock 全链路和 PostgreSQL 全链路均已验证；真实模型调用尚未执行，当前环境没有可用 Provider Key。

**下一步**：为 `mastra-short-drama-agent/` 补真实 Provider 验证、真实短剧样本和质量评估集；随后增强局部修改的实际资产应用、生产队列和下游图像/视频模型适配。Mastra 通用 Lesson 03、LangGraph 后续 Lesson 和 MCP 仍作为独立学习路线。

1. **11a 手写最小 MCP Server**：不用 SDK，stdio + JSON-RPC 2.0，实现 initialize / tools/list / tools/call，把现有 add / read_file 包成 server，理解协议本质
2. **11b 官方 SDK 重写 + 连真实生态**：mcp Python SDK（FastMCP 风格），连接 1-2 个社区 server（filesystem / fetch）验证 client 发现与调用
3. **11c MCP Client 接入现有 Agent**：写 mcp_client.py，把 tools/list 结果动态转成现有 Agent 的 Tool Schema，Research Agent 不改主循环即可热加载外部工具（对照 Day2 写死的 TOOLS_SCHEMA）

**产出目标**：`week-research-agent/mcp/`（server.py + client.py + 接入 demo）+ Day11-学习笔记.md

**待确认**：学习模式未定——用户自己写、AI 陪跑（答疑/改 bug/复核），还是 AI 搭骨架、用户逐行读懂

**接续约定**：见仓库根 [`README.md`](README.md)（先问线路、结束即更新、单一事实源）

------------------------------------------------------------------------

# 最终成果

完成一个从零实现 Agent 的开源项目，包含： - 完整源码 - 文档 - 架构设计 -
测试 - 部署 - Git 历史 - 可作为求职作品集

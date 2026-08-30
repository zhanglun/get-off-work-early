# Get Off Work Early — 多线路学习仓

> 这是一个多线路并行的整体学习项目，线路之间可随时按实际情况切换。
> **本文件是总索引 + 进度管理的唯一权威约定。**

## 接续约定（AI 会话必读）

1. **先问线路**：用户说「继续学习」时，AI 先问选择哪条线路（参照下表），确认后再开工，**不要默认进入某条线**。
2. **结束即更新**：每次学习结束，及时更新对应线路的进度文件（状态、完成内容、下一步、日期），并同步刷新本文件的「线路总览」表。
3. **单一事实源**：各线路的详细进度只在各自进度文件里维护；本文件只放一行摘要 + 链接。接续约定的正文以本文件为准，各线路文件里只留指向本文件的引用。

## 线路总览

| 线路 | 当前状态 | 下一步 | 进度文件 | 最后活动 |
| ------ | --------- | -------- | ---------- | ---------- |
| 🤖 AI Agent | ▶ 学习中 | Mastra 短剧 Agent：StoryBible → 场次 → 分镜 → 提示词 → 审查 → 导出 | [`AI_Agent_Study_Roadmap.md`](AI_Agent_Study_Roadmap.md) →「学习进度（会话接续用）」 | 2026-08-29 |
| 🦾 具身智能 | ⏸ 暂停 | 第 2 周 - 真实数据（遥操作 + Open X-Embodiment + RLDS） | [`embodied-data-loop/学习进度.md`](embodied-data-loop/学习进度.md) | 2026-08-07 |
| 🧱 Agent 底座 | ▶ 历史基线 | NestJS 分镜提示词优化基线已冻结；当前短剧主线转到 Mastra Short Drama Agent | [`agent-base/学习进度.md`](agent-base/学习进度.md) | 2026-08-29 |
| 📘 面试手册 | ⏸ 暂停 | 无独立进度文件（13 章已完成，约 2.9 万行） | [`ai-platform-interview-handbook/README.md`](ai-platform-interview-handbook/README.md) | 2026-07-14 |

## 目录结构

```
get-off-work-early/
├── README.md                        # 本文件（总索引 + 接续约定）
├── AI_Agent_Study_Roadmap.md        # Agent 线路：10 Lesson 计划 + 实际进度对账 + 学习进度
├── Agent_Learning_Context_Lesson01_02.md  # Agent 线路：Lesson 01-02 理论笔记
├── week-research-agent/             # Agent 线路：7 天冲刺 + Day8-10 打磨（代码 + 笔记）
├── embodied-data-loop/              # 具身线路：4 周转型计划（笔记 + 进度）
├── agent-base/                      # Agent 底座线路：NestJS storyboard-agent（架子已达成）
├── mastra-playground/               # Mastra 基础学习：最小 Agent + Tool
├── mastra-short-drama-agent/        # Mastra 主线：短剧制作协作 Agent
├── agent-tool-calls/                # Agent 线路专题：工具调用失败全生命周期（文章 + 交互图）
├── agent-activity-stream/           # Agent 线路专题：Codex 风格 Activity Stream（文章 + 三仓库实施计划）
├── coding-agent-ttft/               # Agent 线路调研：Coding Agent 首 Token 延迟优化（outline + fields）
└── ai-platform-interview-handbook/  # 面试手册：13 章推演文档
```

## 线路详情速览

- **Agent 线路**：手写 Research Agent 已完成核心能力（含 SSE、SQLite 持久化、Token 成本统计）；LangGraph Lesson 01 已跑通最小 StateGraph 工具循环；另建 `mastra-playground/` 独立 TypeScript 沙盒并完成框架概念与本地 API 阅读。MCP、Long-term Memory、容器化部署仍是作品集缺口。
- **具身线路**：第 1 周核心目标完成（具身智能全景 / 数据闭环 / ROS 概念 / 产业玩家）。背景：正在面试纽鼐机器人（杭州），此线为面试驱动。
- **Agent 底座**：目标短剧场景 Agent 能力。`agent-base/` 保留历史需求、架构决策和 NestJS 分镜提示词优化基线；当前唯一活跃业务主线是 [`mastra-short-drama-agent/`](mastra-short-drama-agent/README.md)，目标是从 StoryBible 扩展到场次、分镜、提示词、审查和导出。详见其进度文件。
- **面试手册**：内容层已完整（含 Redis / PostgreSQL / Docker & K8s 章节），若 Agent 线路做容器化部署可复用其知识层。

---

> 最后更新：2026-08-29

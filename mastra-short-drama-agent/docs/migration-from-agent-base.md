# 从 agent-base 分镜基线到 Mastra 短剧 Agent

## 定位

`agent-base/storyboard-agent` 是历史业务背景和“分镜提示词优化”基线；`mastra-short-drama-agent` 是当前唯一活跃的短剧业务主线。

新项目不复制旧项目整体边界，也不依赖 Legacy API 才能生产。

## 能力映射

| agent-base 能力 | Mastra 位置 | 状态 |
|---|---|---|
| Shot Loop | `workflows/storyboard-production-workflow.ts` | 已实现第一版 |
| Director | `agents/production-agents.ts` | 已注册，Mock/Real |
| Reviewer | `agents/production-agents.ts` | 已注册，Mock/Real |
| Refiner | `agents/production-agents.ts` | 已注册，Mock/Real |
| 角色卡 | `StoryBible.characters` + Prisma `Character` | 已实现 |
| 相邻镜头上下文 | StoryBible/Scene 生产上下文扩展点 | 第一版待增强 |
| review_log | Prisma `Review` + 生产结果 | 已实现 |
| needs_review | Shot/生产结果状态 | 已实现 |
| token 统计 | PromptVersion/Review 字段 | 已实现基础字段 |
| LegacyImporter | 可选 `Legacy Comparison` 适配器 | 未接真实接口 |
| blind pairs/scores | Feedback/Evaluation Workflow | 未迁移，P1 |
| Task Center/BullMQ | API 异步任务与 Workflow Runner | 当前进程 Job Map，待生产化 |

## 关键差异

旧项目主链路：

```text
旧系统分镜/提示词 → Shot Loop → 新提示词 → 新旧盲测
```

Mastra 主链路：

```text
原始剧本 → StoryBible → Scene → Shot → Prompt → Review → Export
```

Legacy 对比变为可选能力：

```text
新系统输出 + 旧系统输出 → Benchmark / Feedback
```

## 不直接迁移的内容

- NestJS 模块组织
- 旧任务中心适配细节
- BullMQ 具体实现
- Prisma 旧表命名和旧输入假设
- 旧系统是主流程前置依赖的设计

## 迁移原则

1. 先迁移业务规则，再决定 Mastra 原语。
2. Workflow 控制流程，Agent 负责判断，Tool 负责确定性写入。
3. 原始剧本、故事事实、Agent Memory、Workflow 快照分离。
4. 任何全局事实变更都要生成变更提议并保留版本。

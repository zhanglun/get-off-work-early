# 短剧制作协作 Agent：Workflow 设计

> 状态：v0.1 设计基线
> 最后更新：2026-08-29（产品决策已确认）

## 1. 总体原则

Mastra Workflow 负责业务流程和状态推进，Agent 负责理解、规划、生成和审查，Tool 负责确定性读取/写入。

```text
用户聊天意图
  → 意图路由
  → 创建或恢复 Workflow Run
  → Agent 生成结构化提议
  → 领域校验
  → 必要时请求用户确认
  → Tool 提交资产版本
  → 继续后续 Workflow
```

聊天是入口，Workflow 是过程，结构化资产是事实来源。

## 2. Workflow 总览

### 2.1 Script Ingestion Workflow

职责：接收和保存原始剧本。

第一版输入为约定式 Markdown，同时兼容基础场次格式和接近行业剧本的格式。

```text
validate-input
  → create-project-or-episode
  → save-script-version
  → create-ingestion-run
```

输入：

```text
projectId?
episodeNo
content
format: txt | markdown
sourceFileName?
```

输出：

```text
projectId
episodeId
scriptVersionId
status: draft
```

规则：原始内容不由 Agent 覆盖。

### 2.2 Story Understanding Workflow

> 产品决策：StoryBible 生成后必须经过用户确认，未确认的 StoryBible 不能进入场次和分镜生产。

职责：把剧本转成结构化故事资产。

```text
load-script
  → extract-story-elements
  → normalize-entities
  → detect-conflicts
  → save-proposed-story-bible
  → await-user-confirmation
  → confirm-story-bible
```

Agent 输出：

- 摘要
- 角色
- 场景
- 道具
- 关系
- 剧情事件
- 时间线
- 不确定项和冲突项

领域层负责：

- Schema 校验
- 重复实体合并规则
- 来源和置信度记录
- 不能静默覆盖用户已确认事实

### 2.3 Scene Planning Workflow

> 当前已实现第一版：只有 `confirmed` 的 StoryBible 才能进入规划；Scene 草稿生成后仍需单独确认。

职责：根据已确认的 StoryBible 生成场次结构。

```text
load-confirmed-story-bible
  → analyze-plot-and-beats
  → propose-scenes
  → validate-scene-continuity
  → await-user-confirmation
  → save-scene-versions
```

输出：

- 场次顺序
- 时间和地点
- 出场角色
- 剧情目标
- 冲突
- 情绪变化
- 事件节拍

### 2.4 Storyboard Production Workflow

> 当前已实现第一版：只有 `confirmed` 的 StoryBible 和 Scene 才能生产 Shot；支持整集生产和指定镜头局部重跑。

职责：为已确认场次生成分镜和提示词。

```text
load-scene-context
  → generate-shot-plan
  → generate-image-prompts
  → generate-video-prompts
  → review-shot-continuity
  → refine-failed-shots
  → save-shot-and-prompt-versions
  → produce-review-summary
```

它是 `agent-base/storyboard-agent` 中 Shot Loop 的业务继承位置，但不再依赖旧系统。

每个镜头的上下文包括：

```text
当前场次
+ 剧本片段
+ StoryBible
+ 当前事件
+ 前后镜头
+ 已确认的角色和场景约束
+ 用户偏好
```

镜头级处理可以并发，但保存版本和进度必须可追踪。

### 2.5 Continuity Review Workflow

职责：独立审查故事资产和生产资产的一致性。

```text
select-scope
  → load-related-assets
  → run-rule-checks
  → run-agent-review
  → classify-findings
  → create-review-record
  → auto-refine-low-risk
  → request-confirmation-for-global-change
```

审查范围：

- 角色外观
- 角色关系
- 场景空间
- 道具状态
- 时间线
- 光线和天气
- 动作因果
- 镜头语言
- 提示词可执行性

### 2.6 Export Workflow

> 当前导出通过 `export-service.ts` 完成，并持久化 `ExportPackage`。

职责：将已确认资产导出为生产资料包。

```text
load-confirmed-assets
  → validate-export-readiness
  → render-markdown
  → render-json
  → save-export-package
```

导出前检查：

- 是否存在未处理的 high severity 问题
- 是否有 needs_review 镜头
- 是否有待确认的全局变更
- 资产版本是否一致

### 2.7 Feedback & Evaluation Workflow

职责：记录用户反馈、运行回归评估、比较版本效果。

```text
collect-feedback
  → attach-to-asset-version
  → aggregate-quality-signals
  → run-evaluation-case
  → update-report
```

旧系统新旧盲测属于这里的一个可选分支：

```text
new prompt + legacy prompt
  → blind comparison
  → score
  → report
```

它不阻塞主生产流程。

## 3. 人工确认点

### 确认点 A：StoryBible

需要确认：

- 角色身份和外观
- 场景布局
- 关键道具
- 时间线冲突
- Agent 不确定项

### 确认点 B：场次和分镜

需要确认：

- 场次顺序
- 镜头数量
- 关键动作
- 景别和运镜方向
- 叙事重点

### 确认点 C：导出前

需要确认：

- high severity 问题是否处理
- 全局资产变更是否接受
- 导出包含哪些版本

## 4. 普通变更和关键变更

### 普通变更

影响范围局限于单个镜头且不会改变全局事实，例如：

- 近景改为中景
- 修改提示词措辞
- 补充动作起止状态
- 调整情绪描述

可以由 Agent 直接创建新版本，但必须记录 diff。

### 关键变更

可能影响多个场次或镜头，例如：

- 角色服装锚点变化
- 角色身份或关系变化
- 场景空间布局变化
- 时间线变化
- 道具归属或状态变化

必须：

```text
生成变更提议
  → 展示 before / after
  → 展示影响范围
  → 用户确认
  → 创建新版本
  → 标记受影响资产待重审
```

## 5. API、Studio 和聊天三种入口

### API 异步生产

业务 API 负责创建项目、提交剧本、启动 Workflow、查询状态和读取结构化资产。长任务采用异步模式，不能把完整一集的模型调用绑定在 HTTP 请求生命周期内。

### Mastra Studio 调试

Studio 用于开发阶段手动运行和观察单个 Workflow，检查每一步输入、输出、Schema 和失败原因。Studio 不是第一阶段面向内容团队的唯一产品入口。

### 聊天入口

聊天是面向用户的主要操作入口，支持生产指令和创作问答。聊天请求最终必须落到明确的 Workflow 或 Tool 上。

聊天 Agent 可以识别用户意图，例如：

```text
“分析这一集剧本”
“林小雨的服装是什么？”
“把第三场改得更紧张”
“只重新生成第五镜”
“为什么这一镜被判定为穿帮？”
“导出当前确认版本”
```

意图识别之后，应该调用明确的 Workflow 或 Tool，而不是仅在聊天中生成一段说明。

```text
聊天 Agent
  ├── startStoryUnderstandingWorkflow
  ├── startScenePlanningWorkflow
  ├── startStoryboardProductionWorkflow
  ├── requestAssetChange
  ├── getReviewDetails
  └── exportEpisode
```

## 7. 局部重跑策略

局部重跑需要根据变更影响范围决定：

| 变更 | 默认影响范围 |
|---|---|
| 单个镜头提示词措辞 | 当前 PromptVersion |
| 单个镜头景别/运镜 | 当前 Shot 及其 Review |
| 场次动作变化 | 当前场次的 Shots |
| 角色 canonical 变化 | 该角色出现的场次和镜头 |
| 场景布局变化 | 使用该场景的场次和镜头 |
| 剧本版本变化 | 重新解析受影响的 StoryBible/Scenes |

默认不自动删除旧版本，只创建新版本并标记需要重审的对象。

## 8. 失败处理

- 单个实体解析失败：保留其他已解析实体，记录局部错误
- 单个镜头生成失败：标记该镜头 failed，不阻塞其他镜头
- Agent 输出 Schema 失败：按配置重试，仍失败进入 needs_review
- 用户取消确认：Workflow 暂停，不删除已有草稿
- 外部模型不可用：任务失败并保留输入、步骤和错误信息
- Workflow 重启：从持久化快照恢复，不重复提交已确认版本

## 9. 第一阶段实施顺序

```text
1. 定义领域 Schema
2. 实现 Script Ingestion Workflow
3. 实现 Story Understanding Workflow
4. 实现 StoryBible 确认/版本
5. 实现 Scene Planning Workflow
6. 将现有 Shot Loop 拆入 Storyboard Production Workflow
7. 实现 Continuity Review
8. 实现 Markdown/JSON Export
9. 再接聊天入口
```

虽然产品交互选择 Chat-first，但底层不应先做聊天 UI。先把结构化 Workflow 和资产接口稳定下来，聊天才有可靠的工具可调用。

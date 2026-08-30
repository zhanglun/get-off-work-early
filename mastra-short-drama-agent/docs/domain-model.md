# 短剧制作协作 Agent：领域模型

> 状态：v0.1 设计基线
> 最后更新：2026-08-29（v1 实现已落地）

## 1. 领域中心

系统以“项目 + 剧集 + Story World Model + Production Assets”为中心，而不是以聊天消息为中心。

```text
Project
  └── Episode
       └── ScriptVersion
            ├── StoryBible
            │    ├── Character
            │    ├── Location
            │    ├── Prop
            │    ├── Relationship
            │    ├── TimelineEvent
            │    └── PlotBeat
            │
            ├── Scene
            │    └── Shot
            │         ├── PromptVersion
            │         ├── Review
            │         └── Feedback
            │
            └── ExportPackage
```

## 2. 核心实体

### 2.1 Project

一个短剧项目，承载项目级设定和多集扩展边界。

```text
id
name
description
status
createdAt
updatedAt
```

第一阶段虽只处理一集，也保留 Project 外壳，避免后续从 Episode 反向重构。

### 2.2 Episode

项目中的一集短剧。

```text
id
projectId
episodeNo
title
status
currentScriptVersionId
createdAt
updatedAt
```

### 2.3 ScriptVersion

用户导入的原始剧本版本。原文应该保留，不被 Agent 覆盖。

```text
id
episodeId
version
format
content
sourceFileName
createdBy
createdAt
```

### 2.4 StoryBible

根据某个剧本版本生成的故事世界模型快照。

```text
id
scriptVersionId
version
summary
status: draft | confirmed | superseded
createdBy
createdAt
```

StoryBible 不等于一段摘要，而是角色、场景、道具、关系、事件等结构化对象的集合。

### 2.5 Character

角色卡，是跨场次和跨镜头一致性的核心约束。

```text
id
storyBibleId
name
aliases
age
appearance
clothing
personality
speakingStyle
canonicalDescription
sourceSpans
confidence
status: proposed | confirmed | rejected
version
```

`canonicalDescription` 不是事实的唯一载体，但在生成提示词时作为稳定锚点。

### 2.6 Location

故事中的地点或空间。

```text
id
storyBibleId
name
layout
lighting
colorStyle
fixedProps
spatialConstraints
sourceSpans
confidence
status
version
```

### 2.7 Prop

影响剧情或画面连续性的道具。

```text
id
storyBibleId
name
appearance
owner
continuityRules
firstAppearance
sourceSpans
status
version
```

### 2.8 Relationship

角色之间或角色与道具/场景之间的关系。

```text
id
storyBibleId
fromEntityId
fromEntityType
toEntityId
toEntityType
relationType
attributes
sourceSpans
confidence
version
```

第一阶段可以先支持角色关系，不需要立即引入图数据库。

### 2.9 TimelineEvent

剧情中的有序事件，用于时间连续性和动作因果检查。

```text
id
storyBibleId
sceneId
sequence
timeLabel
participants
action
emotionalChange
dramaticPurpose
sourceSpans
```

### 2.10 Scene

一个具有相对完整时空和戏剧目的的场次。

```text
id
scriptVersionId
sceneNo
locationId
timeLabel
participants
objective
conflict
beats
scriptExcerpt
status: proposed | confirmed | superseded
version
```

### 2.11 Shot

可用于拍摄或生成的镜头资产。

```text
id
sceneId
sequence
durationSec
subjects
action
shotSize
cameraMove
composition
lighting
emotion
imagePrompt
videoPrompt
status: draft | reviewed | confirmed | needs_review | failed
sourceSpans
version
```

### 2.12 PromptVersion

提示词不能直接覆盖，要支持版本。

```text
id
shotId
kind: image | video
version
content
rationale
model
createdBy
createdAt
basedOnVersionId
```

### 2.13 Review

Agent 或人工对资产进行的审查记录。

```text
id
targetType
targetId
reviewerType: agent | human
reviewerId
passed
findings
confidence
createdAt
```

`targetType` 第一阶段主要支持 `shot` 和 `story-bible`。

### 2.14 Feedback

当前 API 已支持反馈写入；后续评估 Workflow 可基于这些记录统计用户采纳率和修改率。

用户对生成结果的反馈。

```text
id
targetType
targetId
rating
comment
action
createdBy
createdAt
```

旧系统新旧盲测可以作为 Feedback 的一种来源，而不是新系统的主数据模型。

### 2.15 ChangeProposal

关键变更提议，保存 before/after、风险等级、影响范围、审批状态和决策时间。

```text
id
targetType
targetId
changeType
riskLevel
before
after
reason
impactScope
status: pending | approved | rejected
decidedAt
```

### 2.16 ExportPackage

一次导出的生产资料快照。

```text
id
episodeId
version
format
includedAssets
content
createdAt
```

## 3. 来源和可信度

结构化字段需要尽量保存来源：

```text
sourceType: script | user | agent | derived | imported-legacy
sourceRef: 剧本版本、片段或用户操作 ID
confidence: 0..1
```

优先级建议：

```text
用户明确确认 > 剧本明确描述 > 已确认故事资产 > Agent 推断 > 旧系统导入 > 默认值
```

存在冲突时，Agent 不应静默覆盖高优先级事实，而应生成冲突报告或变更提议。

## 4. 版本原则

### 不覆盖原始剧本

原始剧本只读保存。用户重新导入或编辑时创建新的 ScriptVersion。

### 故事资产采用快照

StoryBible 与 ScriptVersion 绑定。重新解析新剧本版本时创建新快照，旧快照仍可回看。

### 生产资产独立版本化

Shot 和 PromptVersion 可以在同一个剧本版本下多次迭代。

### 变更要记录影响范围

例如修改 Character 的 canonicalDescription 时，需要标记：

```text
受影响场次
受影响镜头
需要重新审查的 PromptVersion
```

## 5. 与 Mastra Runtime 的关系

```text
业务领域数据：Project / Episode / Script / StoryBible / Scene / Shot / Review
  → 业务数据库

Agent 对话历史：用户与短剧 Agent 的聊天线程
  → Mastra Memory

Workflow 执行状态：解析中、等待确认、生成中、暂停、失败、完成
  → Mastra Workflow State + 持久化 Storage

Trace / Token / Eval
  → Mastra Observability / Scores / 业务汇总
```

三者不能混为一个 Memory。

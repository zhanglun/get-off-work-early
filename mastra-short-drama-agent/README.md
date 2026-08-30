# Mastra Short Drama Agent

面向短剧内容制作团队的 AI 制作协作系统。当前主线不是单纯的分镜提示词优化，而是：

```text
剧本 → StoryBible → Scene → Shot → Image/Video Prompt → Review → Refine → Export
```

## 项目定位

这是仓库中唯一活跃的短剧业务主线：

- `agent-base/`：历史工作背景、业务决策和 NestJS 分镜提示词优化基线，冻结参考，不并行扩展。
- `mastra-playground/`：Mastra 通用 API 学习实验，不新增短剧业务。
- `mastra-short-drama-agent/`：当前唯一主项目，使用 Mastra Workflow、Agent、Tool、Memory 和 PostgreSQL 业务存储。

产品形态：

```text
聊天入口 + 结构化资产工作区
                 ↓
        Story World Model / 生产资产
                 ↓
     Workflow + Agent + Tool + Review
```

结构化业务资产是事实来源；聊天记录只作为交互上下文和审计信息。

## 当前已实现

### 领域和解析

- Project / Episode / ScriptVersion
- StoryBible / Character / Location / Prop / Relationship / TimelineEvent
- Scene / Shot / PromptVersion / Review / Feedback / ExportPackage
- DomainTask 异步任务记录
- 约定式 Markdown 基础场次格式
- 接近行业剧本的 `INT./EXT.` 格式
- 确定性 Markdown 预解析 + Agent 补充分析
- sourceRef、confidence、version、status 基础字段
- 原始剧本追加版本，不覆盖历史内容

### Agent

- Script Analyst
- Scene Planner
- Storyboard Director
- Continuity Reviewer
- Prompt Refiner
- Short Drama Chat Agent

每个需要模型判断的环节使用结构化输出 Schema；确定性读写通过 Repository/Service 完成。

### Workflow

- `storyUnderstandingWorkflow`
- `scenePlanningWorkflow`
- `storyboardProductionWorkflow`
- 现有 `storyboardWorkflow` 作为历史分镜 Spike 保留

核心确认门槛：

```text
StoryBible 草稿 → 用户确认 → Scene 草稿 → 用户确认 → Shot 生产
```

高风险冲突阻断 StoryBible 确认；低置信度信息可以保留为待确认项。

### 业务 API

```text
POST /projects
POST /projects/:projectId/episodes
POST /story-understandings
GET  /story-understandings/:runId
GET  /episodes/:episodeId/story-bible
POST /episodes/:episodeId/story-bible/confirm
POST /episodes/:episodeId/scenes
GET  /scene-plannings/:runId
GET  /episodes/:episodeId/scenes
POST /episodes/:episodeId/scenes/confirm
POST /episodes/:episodeId/production
GET  /storyboard-productions/:runId
GET  /episodes/:episodeId/shots
POST /episodes/:episodeId/shots/:sceneNo/:sequence/regenerate
GET  /episodes/:episodeId/shots/:sceneNo/:sequence/versions
GET  /episodes/:episodeId/shots/:sceneNo/:sequence/reviews
POST /episodes/:episodeId/export
POST /change-proposals
GET  /change-proposals/:id
POST /change-proposals/:id/approve
POST /change-proposals/:id/reject
POST /feedback
POST /chat
```

长任务接口返回 `202` 和 `runId`，任务状态写入 `DomainTask`；PostgreSQL 模式下任务状态不会只依赖进程内 Map。

## 启动

### Mock 模式

无需 API Key，可验证完整业务链路：

```bash
cd mastra-short-drama-agent
pnpm install
pnpm run check
pnpm test
pnpm run run:full
```

### PostgreSQL 模式

```bash
cd mastra-short-drama-agent
cp .env.example .env
docker compose up -d
pnpm run db:deploy
STORAGE_MODE=postgres pnpm run run:full
```

默认数据库：

```text
postgresql://short_drama:short_drama@localhost:5434/short_drama
```

### Mastra Studio

```bash
pnpm run dev
```

访问 <http://localhost:4111>：

- `storyUnderstandingWorkflow`：调试剧本解析和 StoryBible
- `scenePlanningWorkflow`：调试场次规划
- `storyboardProductionWorkflow`：调试分镜生产

### 业务 API 和资产工作区

```bash
pnpm run api
```

默认地址：

```text
http://localhost:4120
```

浏览器打开 `http://localhost:4120/` 可以使用最小结构化资产工作区：导入剧本、确认 StoryBible/Scene、生成分镜、查看资产、发送聊天请求和导出 JSON。

提交 Story Understanding：

```bash
curl -X POST http://127.0.0.1:4120/story-understandings \
  -H 'content-type: application/json' \
  -d '{"projectName":"我的短剧","episodeNo":1,"scriptText":"## 第1场 夜 / 天台\n【人物】林小雨、陈默\n【动作】林小雨看向陈默。\n【对白】陈默：你终于来了。"}'
```

提交聊天请求：

```bash
curl -X POST http://127.0.0.1:4120/chat \
  -H 'content-type: application/json' \
  -d '{"message":"询问人物动机","episodeId":"episode-id"}'
```

## 模型配置

默认使用 Mock。Real 模式使用 Mastra model router 和结构化输出：

```env
LLM_MODE=real
LLM_MODEL=openai/gpt-5.6-sol
OPENAI_API_KEY=...
```

当前已验证 Mock 和构建链路；真实模型调用需要用户配置有效 Provider Key。模型名称应以当前 Mastra provider registry 为准，不能把 Mock 结果当成真实模型质量证明。

## 存储分层

```text
业务事实：PostgreSQL + Prisma
  Project / Episode / StoryBible / Scene / Shot / Version / Review

Agent 对话记忆：Mastra Memory
  Thread / Resource / Message

Workflow 和 Runtime 状态：Mastra PostgresStore
  Workflow snapshot / messages / traces / thread state
```

当前业务 Repository 支持 `memory` 和 `postgres` 两种模式；生产验收必须使用 PostgreSQL，不允许把内存降级误认为持久化成功。

## 目录

```text
src/
├── agents/
│   ├── chat-agent.ts
│   ├── script-analyst-agent.ts
│   ├── scene-planner-agent.ts
│   ├── production-agents.ts
│   └── storyboard-agents.ts          # 历史 Spike Agent
├── domain/
│   ├── markdown-script-parser.ts
│   ├── story-schemas.ts
│   ├── scene-schemas.ts
│   ├── production-schemas.ts
│   ├── chat-schemas.ts
│   ├── project-repository.ts
│   ├── story-repository.ts
│   ├── scene-repository.ts
│   ├── production-repository.ts
│   ├── task-repository.ts
│   ├── export-service.ts
│   └── chat-service.ts
├── workflows/
│   ├── story-understanding-workflow.ts
│   ├── scene-planning-workflow.ts
│   ├── storyboard-production-workflow.ts
│   └── storyboard-workflow.ts          # 历史 Spike
├── mastra/
│   ├── index.ts
│   └── runtime-storage.ts
├── api.ts
├── run-full-pipeline.ts
└── ...
prisma/schema.prisma
prisma/migrations/
test/
```

## 测试和验收

```bash
pnpm run check
pnpm test
pnpm run build
pnpm run db:validate
pnpm run db:generate
pnpm run run:full
```

API Smoke Test 需要先启动 API：

```bash
pnpm run api
node test/api-smoke.mjs
```

真实 PostgreSQL 验收：

```bash
docker compose up -d
pnpm run db:deploy
STORAGE_MODE=postgres pnpm run run:full
```

## 设计文档

- `CONTEXT.md`：下次会话必须优先读取的项目上下文和工作规则

### 已确认的产品方案草案（待评审）

- `docs/prd.md`：产品需求、范围、成功标准和验收原则
- `docs/user-flows.md`：用户主流程、生成流程、修改、重试、问题和导出流程
- `docs/information-architecture.md`：页面结构、导航和卡片工作区
- `docs/architecture.md`：Web/API/Worker/Workflow/Agent/数据层和部署架构
- `docs/state-machines.md`：任务、资产、问题、版本和导出状态机
- `docs/traceability-matrix.md`：需求 → 页面 → API → Workflow → 数据 → 测试
- `docs/deployment.md`：服务器部署、Worker、数据备份和恢复方案

### 原有设计和技术 Spike 文档

- `docs/product-brief.md`
- `docs/capability-map.md`
- `docs/domain-model.md`
- `docs/workflow-design.md`
- `docs/evaluation-plan.md`
- `docs/migration-from-agent-base.md`

> 现有 `src/` 代码和原有 Workflow 目前冻结为技术 Spike。产品方案评审通过后，将按 `traceability-matrix.md` 重新判断复用、重构和淘汰，不把既有代码自动视为最终产品实现。

## 当前明确出界

暂不实现：

- 真实图像/视频生成服务
- 配音、字幕、剪辑和发布
- 多租户和复杂权限
- 团队实时协作
- 插件市场和 MCP 平台

这些属于后续能力，不影响当前 v1 的“剧本 → 生产资产包”闭环。

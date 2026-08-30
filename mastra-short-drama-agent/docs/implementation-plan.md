# 实现规划（M0 产出）

> 2026-08-30，依据三基线（product-design / DESIGN / architecture）对 Spike 全量审查的结果。
> 本文是四张处置清单 + monorepo 重组方案；每个文件都有归属结论。

## 0. Spike 现状速览

- **代码量**：src/ 3112 行（30 文件）+ prisma（13 模型 4 迁移）+ test（5 文件）
- **可用资产**：Markdown 解析器（纯函数、有测试）、Zod 领域 Schema 全套、8 个 Mastra Agent（指令完备）、3 条正式 Workflow（理解/场次/生产，带 Mock 分支与结构化输出）、Prisma 双态 Repository（内存+PG）、版本 diff、导出渲染
- **核心偏差**（对新基线）：确认门槛贯穿全流程；api.ts 是裸 node:http + 内存 Job Map；无会话/事件/影响分析/项目级资产；无前端；导出是单集内联而非项目 ZIP

## 1. 复用清单（改动 ≤ 20%）

| Spike 文件 | 去向 | 说明 |
|---|---|---|
| `src/domain/markdown-script-parser.ts` | `apps/server/src/domain/` | 原样复用，测试跟随 |
| `src/domain/story-schemas.ts` `production-schemas.ts` `scene-schemas.ts` `schemas.ts` | 拆分：领域 schema → `apps/server/src/domain/`；跨端契约（任务/事件/SSE/DTO）→ `packages/shared/src/` | Zod 逻辑原样，按消费方拆包 |
| `src/agents/*.ts`（8 个） | `apps/server/src/agents/` | 指令与输出 schema 原样；模型接线改走新 Provider |
| `src/domain/{story,scene,production,project}-repository.ts` | `apps/server/src/domain/` | Prisma 路径复用；内存实现保留为测试替身 |
| `src/domain/version-diff.ts` | `apps/server/src/domain/` | collectDiff 原样，接入 5 版保留策略 |
| `prisma/schema.prisma` + migrations | `apps/server/prisma/` | 迁移链保留，追加新模型（见 §3） |
| workflow 内 Mock 函数（mockDraft/mockReview/mockRefine） | `apps/server/src/llm/mock-provider.ts` | 抽出为 MockProvider，保留可复现失败注入（MOCK_FAIL_SHOT） |
| `test/markdown-script-parser.spec.ts` `domain-schemas.spec.ts` | `apps/server/test/` | 原样 |

## 2. 重构清单（保留职责，重写实现）

| Spike 文件/机制 | 目标 | 关键变化 |
|---|---|---|
| `src/workflows/*.ts`（3 条正式管线） | `apps/server/src/workflows/production-pipeline.ts` | 拆确认门槛 → 自动连续；每阶段完成发事件；镜头级并发与失败隔离保留 |
| `src/domain/task-repository.ts` | `apps/server/src/domain/task-repository.ts` | PG-only；加 leaseOwner/leaseUntil/attempts/lastError；`SKIP LOCKED` 领取；项目互斥 |
| `src/api.ts`（345 行裸 http） | NestJS 模块组 | auth / projects / events / exports / admin / mastra 六模块（见 architecture §2） |
| `src/domain/chat-service.ts` | `apps/server/src/services/chat-router.ts` | 意图路由 + 依次补问状态机（项目名→集数→镜头数）+ 影响确认挂起态 |
| `src/domain/export-service.ts` | `apps/server/src/exports/` | 单集内联 → 整项目 ZIP（project-assets.md + 每集 5 文件 + manifest 含忽略穿帮） |
| LLM_MODE 环境双分支 | `apps/server/src/llm/provider.ts` | OpenAI 兼容 Real → 失败自动 Mock，结果标注 MOCK（对话/卡片/manifest 三处披露） |
| Prisma 模型状态机 | schema 扩展 | `status: confirmed` 门槛语义删除；新增自动流程状态 |

## 3. 新增清单

| 模块 | 内容 |
|---|---|
| `packages/shared/src/` | SSE 事件契约（schemaVersion/eventId/seq/conversationId/type/payload）、API DTO、阶段/状态枚举——前后端唯一类型源 |
| Prisma 新模型 | `User`（demo 种子）+ `Session`（7 天）；`Conversation`/`Message`（项目主对话，补问状态）；`ProjectAsset`（项目级资产+本集覆盖）；`AssetVersion`（5 版上限）；`Issue`（措辞/事实，可忽略）；`Event`（journal，projectId 内 seq 递增）；`DomainTask` 租约字段；`ExportPackage` 项目级 |
| NestJS 骨架 | `main.ts`（API 进程）+ `worker.ts`（Nest 独立应用，租约循环） |
| `apps/server/src/services/impact-analysis.ts` | 资产引用图 → 跨集影响清点（场次/镜头/Prompt 计数） |
| `apps/web/` | React 18 + Vite + TanStack Query：登录页/项目列表/工作区（对话列+编号边栏+图版列）；SSE 客户端（afterSeq 重连+快照恢复）；DESIGN.md 令牌全量落地；模拟帧标注组件 |
| 部署 | `Dockerfile` + `docker-compose.yml`（postgres/api/worker）+ `.dockerignore` + `.env.example` |
| 管理重置 | `admin` 模块：口令校验 → 清空 Demo 数据 |

## 4. 淘汰清单（git 历史可恢复）

| 文件 | 淘汰理由 |
|---|---|
| `src/domain/store.ts`（StoryboardStore 内存库） | 被 Prisma Repository 全面取代 |
| `src/domain/story-confirmation.ts` | 确认门槛机制整体废除 |
| `src/workflows/storyboard-workflow.ts` | 依赖 store.ts 的旧 Spike 环路，正式管线已覆盖 |
| `src/agents/storyboard-agents.ts`（director/reviewer/refiner 旧三件套） | 仅被淘汰 workflow 引用；production-agents 为正式版 |
| `src/api.ts` 整体 | 裸 http + 内存 Job Map + 确认端点，被 NestJS 模块组取代 |
| `src/run-sample.ts` `run-story-understanding.ts` `run-scene-planning.ts` `run-full-pipeline.ts` | Spike 验证脚本；worker 入口取代 |
| `test/api-smoke.mjs` `production-workflow.spec.ts` `story-understanding-and-scene-planning.spec.ts` | 面向旧 API/确认门槛；新测试随各里程碑补 |
| `LLM_MODE` 直读逻辑 | 并入 Provider 抽象 |

## 5. Monorepo 重组方案（一次 git mv，独立提交）

```text
mastra-short-drama-agent/
├── pnpm-workspace.yaml        # apps/* packages/*
├── package.json               # 根：私有、脚本委托（pnpm -r）
├── apps/
│   ├── server/                # git mv src test → server/src server/test
│   │   ├── package.json       # 现依赖 + nestjs*
│   │   ├── prisma/            # git mv prisma → 此处
│   │   └── tsconfig.json
│   └── web/                   # Vite 骨架（M1 起填充）
│       ├── package.json
│       └── index.html
└── packages/
    └── shared/                # Zod 契约包（M1 起填充）
        ├── package.json
        └── src/index.ts
```

重组验收：`pnpm install` 成功；`pnpm --filter server check`（tsc --noEmit）通过；旧路径无残留。

## 6. 里程碑对齐

M0 = 本文 + 重组提交；M1-M7 按 `docs/tech-roadmap.md` 执行，每步验收信号以该文档为准。

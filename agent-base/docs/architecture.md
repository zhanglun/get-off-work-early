# Storyboard Agent 架构设计 v1

> 状态：待评审（grilling 三轮共识 → 本文档为设计落实）
> 配图：[storyboard-arch.svg](./storyboard-arch.svg)（架构）· [storyboard-sequence.svg](./storyboard-sequence.svg)（时序）· [storyboard-er.svg](./storyboard-er.svg)（ER）
> 日期：2026-08-15

## 1. 背景与目标

替代原团队的「剧本 → 分镜提示词」能力。原系统是单次 LLM 调用，无自检无迭代，客户反馈提示词不好（镜头穿帮类问题）。本系统的核心升级：**单次调用 → 每镜独立的「生成→审查→改写」循环**，全程留痕，输出可解释（rationale + review_log）。

**v1 主链路关键决策（grilling 第三会话）：沿用旧切分**。分镜列表和旧提示词从原系统接口导入（结构化 JSON），本系统专注每镜提示词的 loop 优化。原因：① 逐镜盲测对比要求新旧同镜对齐，自切分无法配对；② 项目靶心是「单镜提示词优化」；③ Parser 是最不可控环节，移出主链路降低周五风险。Parser 保留为 demo 后的独立功能。

不做的事（v1 明确出界）：跨集长期记忆、下游视频生成对接、多租户、插件系统、实时看板（内测期间后台查库出报表）。架构留缝，不预建机器。

## 2. 三个决定架构的问题（设计推理）

**Q：loop 跑在哪？** HTTP 请求里跑不现实（一集几十镜 × 多轮调用 = 分钟级）。→ 异步任务式：接口只负责入队和查询，BullMQ worker 进程消费。**任务粒度 = 一集一个 job**，worker 内部按镜并发（并发度 P 可配，默认 4：几十镜串行太慢，全并发打爆 LLM 限流）。

**Q：输入从哪来？** worker 先调旧系统接口拿结构化分镜列表 + 旧提示词，落库为基线（OldShot 表），再逐镜优化。旧接口稳定（已确认），导入失败重试 2 次后任务标 failed。

**Q：穿帮怎么防？** 穿帮是画面逻辑错误，分两类：镜内错误（手穿模、光线矛盾、物理不可能）和镜间错误（角色外观跳变、位置时序不连续）。单镜自审查不出镜间问题。→ 审查分两级：**镜内规则**（Reviewer 检查本镜画面逻辑）+ **上下文注入**（Context Builder 把角色卡和相邻镜摘要塞进 Director/Reviewer 的输入，预防而非事后补救）。防穿帮是输入侧治理 + 审查侧拦截双管齐下。

**Q：队友怎么并行？** 验证页的人只需要接口契约 → DTO/zod 先定，他们不等后端。prompt 调优的人不该碰 TS → prompts 全部外置文件。→ **契约先行 + prompt 外置**是周一架子的强制要求。

## 3. 总体架构（四层）

（完整图见 storyboard-arch.svg）

```
01 客户端层：前端调用方 | 验证页(周五) | 原系统接口(旧输出,对比基线)
02 接口层(NestJS)：TaskController | ScoreController(pairs/scores/报表) | 模板/配置接口(二期) | API DTO+zod 契约
03 智能层(worker)：BullMQ Worker → LegacyImporter(旧切分+旧提示词导入) → Shot Loop(Director→Reviewer→Refiner)
                    Context Builder | prompts/ 外置 | parser.ts(占位·demo后启用)
04 基础设施层：LLM Client(OpenAI 兼容,可切换) | PostgreSQL+Prisma | Redis
               任务中心适配器(公司模块·任务数据/状态) | 可观测(横切)
```

主链路：`POST /tasks(剧本+配置) → 任务中心建档 → 入队 → LegacyImporter 旧切分导入 → 每镜 Shot Loop → 落库+状态回写任务中心 → 盲测打分页（pairs/scores）`

**任务中心集成原则**：任务的创建/状态/进度/查询由任务中心维护（单一事实源）；分镜领域数据（Shot/OldShot/ReviewLog/Score/CharacterCard）归本服务库，以任务中心的任务 ID 为外键关联。执行调度仍走 BullMQ（假设任务中心不做调度，见 §9）。

## 4. 数据模型（Prisma 草案）

```prisma
// 注：任务生命周期（创建/状态/进度）由公司任务中心维护，本服务不自持 Task 表。
// 分镜领域数据归本库，以任务中心的任务 ID（taskCenterId）为外键关联。
// v1 沿用旧切分：分镜列表+旧提示词从旧系统导入（OldShot），Shot.seq 与旧镜序对齐。

model Shot {
  id           String   @id @default(cuid())
  taskCenterId String             // 任务中心任务 ID（外键）
  seq          Int               // 镜序（集内唯一，沿用旧系统切分）
  sceneNo      Int               // 场号（旧切分带入）
  scriptExcerpt String           // 该镜剧本内容（旧切分带入）
  durationSec  Int               // 时长（≤15）
  status       String            // pending | done | needs_review | failed
  draft        Json?             // 镜头决策（景别/运镜/构图/光线/情绪）
  finalPrompt  String?           // 最终提示词（套模板渲染后）
  rationale    String?           // 推理（为什么这么设计——老板要的）
  iterations   Int       @default(0)
  tokensUsed   Int       @default(0)
  reviews      ReviewLog[]
  scores       Score[]
}

model OldShot {                    // 盲测基线：旧系统分镜+提示词（导入留存）
  id           String  @id @default(cuid())
  taskCenterId String
  seq          Int               // 旧系统镜序（与 Shot.seq 对齐）
  legacyPrompt String            // 旧系统提示词
  raw          Json               // 旧接口原始返回（留存）
}

model Score {                      // 镜头级盲测打分
  id         String  @id @default(cuid())
  shotId     String
  rater      String            // 打分者标识（昵称/编号）
  winner     String            // 选优：new | old（盲测提交时按 sideOrder 归因）
  scoreNew   Int               // 新版分 1-5
  scoreOld   Int               // 旧版分 1-5
  sideOrder  String            // 盲测渲染顺序（left/right 各是谁），事后归因用
  createdAt  DateTime @default(now())
}

model ReviewLog {
  id        String   @id @default(cuid())
  shotId    String
  round     Int
  passed    Boolean
  findings  Json              // [{ rule, severity, issue, suggestion }]
  changes   String?           // refiner 的修改说明
  createdAt DateTime @default(now())
}

model CharacterCard {
  id           String @id @default(cuid())
  taskCenterId String
  name         String
  canonical    String          // 固定描述串（全剧一致性的锚点）
}
```

> 剧本原文（scriptText）、集数、任务配置存任务中心；worker 启动时从任务中心拉取任务输入。若后续发现任务中心不适合存大文本，再评估本地建 input 表缓存（不提前建）。
```

## 5. API 契约（DTO 即文档，zod/class-validator 双轨）

```
POST /tasks
  req:  { scriptText, episodeNo?, config?: { templateId?, maxRounds?, concurrency? } }
  行为: 任务中心建档 → BullMQ 入队
  res:  { taskId, status: "queued" }        // taskId = 任务中心任务 ID

GET /tasks/:id
  res:  { status, progress, error? }        // 状态/进度透传自任务中心
                                           // + 本服务聚合：needsReview 镜数等领域指标

GET /tasks/:id/shots
  res:  [{ seq, sceneNo, status, durationSec, draft, finalPrompt,
           rationale, iterations, reviews: ReviewLog[] }]

POST /scores                  # 盲测打分提交（验证页调用）
  req:  { shotId, rater, winner: "A"|"B", scoreA, scoreB, sideOrder: "left:new"|"left:old" }
  res:  { ok: true }            // 服务端按 sideOrder 归因存储 scoreNew/scoreOld

GET /tasks/:id/scores          # 内测报表（后台/导出用，替代看板）
  res:  [{ shotSeq, rater, winnerNew, scoreNew, scoreOld, createdAt }]

GET /tasks/:id/pairs           # 盲测对比页数据：逐镜新旧一对（服务端随机侧序，sideOrder 随任务缓存，保证同一打分者看到稳定顺序）
  res:  [{ shotId, seq, scriptExcerpt, sideA: {prompt}, sideB: {prompt} }]

POST /legacy/import           # worker 内部调用：调旧接口拿分镜+旧提示词，落 OldShot（重试2次）
```

## 6. Shot Loop 详细设计

```
processEpisode(job):
  input = TaskCenter.getTaskInput(job.taskCenterId)   // 剧本/配置来自任务中心
  TaskCenter.updateStatus(processing)
  {shots, oldPrompts} = LegacyImporter(input.scriptText)  // 调旧接口：分镜列表+旧提示词，落 OldShot（重试2次，败则 failed）
  characters = CharacterExtractor(input.scriptText)   // 轻量提取角色卡（demo 后由完整 Parser 替代）
  pool = concurrency P(=4)
  for shot in shots (并发 P):                          // 镜序沿用旧切分
    ctx   = ContextBuilder(shot, characters, prevShot.summary, nextShot.summary)
    draft = Director(ctx)                            // LLM：镜头决策+初版提示词+rationale
    for round in 1..maxRounds(=3):
      review = Reviewer(draft, ctx)                  // LLM：按规则清单出 findings
      if review.passed: break
      draft  = Refiner(draft, review.findings, ctx)  // LLM：逐条修，写 changes
    if !review.passed: shot.status = needs_review    // 保留最后一版（不是丢弃）
    persist(shot, reviewLogs, tokenUsage)
    TaskCenter.reportProgress({done: n, total: m})   // 进度回写任务中心（节流：每镜完成回写一次）
  TaskCenter.updateStatus(done | failed)
```

失败处理：单镜 loop 抛错 → 该镜标 failed，不影响其他镜（p-limit + try/catch per shot）；旧接口导入失败 → 重试 2 次 → 仍败则 task=failed（旧接口稳定，此路径军见）。**所有 LLM 调用输出过 zod，解析失败带错误重试一次**——脏数据不进下一环。

## 7. 周一架子清单（链路跑通标准）

```
storyboard-agent/
├── src/
│   ├── main.ts / app.module.ts
│   ├── tasks/          tasks.controller.ts · tasks.service.ts · dto/     # 接口三层
│   ├── processor/      shot.processor.ts                                  # BullMQ worker
│   ├── core/           legacy-importer.ts · character-extractor.ts · shot-loop.ts
│   │                   director.ts · reviewer.ts · refiner.ts · context-builder.ts
│   │                   types.ts · parser.ts(占位·demo后启用)              # 纯逻辑可单测
│   ├── llm/            llm.service.ts                                     # OpenAI 兼容，env 切换
│   ├── task-center/    task-center.client.ts + task-center.mock.ts        # 任务中心适配（含 mock，N5）
│   ├── prisma/         schema.prisma · prisma.service.ts
│   ├── legacy/         legacy.proxy.ts
│   ├── prompts/        director.system.md · reviewer.system.md · refiner.system.md
│   └── config/         configuration.ts
├── samples/            短剧本样例（自写 5 镜场景）
├── test/               shot-loop.spec.ts（loop 逻辑单测，mock LLM）
├── docker-compose.yml  # 本地 pg + redis
└── README.md           # 启动步骤 · 分工地图 · TODO 清单
```

「链路跑通」的验收动作：`docker-compose up` → `POST /tasks`（samples 剧本）→ 轮询到 done → `GET /tasks/:id/shots` 拿到 5 镜的 finalPrompt + rationale + reviewLog。**用 mock LLM 也能跑通全链路**（LLM service 可注入 fake），真实端点通了换 env 即可——这是周一无真实端点时的保险。

## 8. 分工地图（4 人，按模块切，2026-08-15 grilling 确认）

| 模块 | 负责 | 周二进场拿到什么 | 不碰什么 |
|---|---|---|---|
| 架子 + core loop 结构维护 | 你（周一） | 全部代码 + README 分工地图 | — |
| 盲测打分页（前端） | 队友 A | §5 DTO 契约（pairs/scores，周一冻结）+ mock 数据 | 后端代码 |
| prompt 调优 + 穿帮规则 | 队友 B | prompts/ 三个外置文件 + 原团队 prompt + 真实剧本 | TS 代码 |
| 模板配置 + 部署联调 | 队友 C | 模板配置位接口 + 部署环境（周一路径确认） | core loop |
| 测试 + 数据准备 + 内测报表 | 队友 D | samples/ + 内测剧本管理 + scores 查询出报表 | 前后端代码 |

**协作规则**：loop 结构改动归你（架构不漂移）；队友 B 只改 prompts/*.md；队友 A 只依赖 DTO——契约变更需同步通知并过你 review。

## 9. 风险与开放问题

1. **LLM 端点**：周一拿到（用户确认）——周五必须真跑，这是成败链第一环
1b. **旧接口输出格式**：假设返回结构化 JSON 含分镜列表+提示词；周一拿接口文档验证字段结构，LegacyImporter 按 zod 契约解析
2. **任务中心接口文档未拿到**：当前假设它负责任务建档/状态/进度而非执行调度；接口形态（回调 or 拉取、大文本是否可存）待确认——适配层隔离，接口文档到了只改 task-center/ 模块
3. **双数据源一致性**：任务状态在任务中心、分镜数据在本库，以 taskCenterId 关联——需保证「任务中心已 done 但本库写入中」等中间态对前端不可见（状态聚合以任务中心为准）
4. **原团队样例**：prompt 调优和审查规则聚焦依赖它（不阻塞架子，阻塞效果）
5. **成本**：一集几十镜 × 4 角色 × 3 轮 ≈ 数百次 LLM 调用/集。tokenUsed 逐镜统计，周五验证页可见——先量化再优化
6. **旧切分质量**：沿用旧系统切分——若旧切分本身不合理（该分没分/节奏乱），单镜优化无法弥补；盲测聚焦提示词质量，切分质量 demo 后随 Parser 恢复再解决

## 10. 决策记录（grilling 三轮结论索引）

详见 [`../学习进度.md`](../学习进度.md)「共识文档」节：智能化范围/接口/异步/LLM/无人工审核/痛点=穿帮/单镜≤15s/DB+Redis 现成/NestJS/Prisma/旧侧实时/架子标准=链路跑通/周五=测试版+验证页。

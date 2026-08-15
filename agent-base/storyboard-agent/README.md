# Storyboard Agent

剧本 → 分镜提示词优化服务。v1 沿用旧系统切分，专注每镜提示词的「生成→审查→改写」循环（generator-critic），客户盲测打分对比新旧。

> 设计文档：`../docs/`（team-review.md 是 10 分钟总览；architecture.md 是完整设计）

## 快速启动

```bash
npm install

# 方式 A：无 Docker/PG/Redis 环境（链路验证、前端联调 mock 数据）——零依赖
STORE_MODE=mem QUEUE_MODE=mem LLM_MODE=mock npm run dev

# 方式 B：完整环境（周一公司环境）
docker compose up -d                 # postgres:5433 + redis:6380
npx prisma migrate dev               # 建表
QUEUE_MODE=bullmq npm run dev
```

测试：`npm test`（Shot Loop 四条路径单测）

## 模块地图与分工

```
src/
├── main.ts / app.module.ts          # 入口
├── tasks/tasks.controller.ts        # ★队友A依赖：全部 API 路由 + zod DTO（契约在这，冻结需通知）
├── llm/llm.service.ts               # LLM 封装（mock|real 切换；周一填 LLM_BASE_URL/KEY/MODEL）
├── task-center/                     # 任务中心适配（mock 内存态；接口文档到后改这里）
├── prisma/store.service.ts          # 存储适配（PG 不可达自动降级内存；schema.prisma 五表）
├── processor/episode.processor.ts   # 一集一 job：导入旧切分→逐镜 loop（并发P=4）→落库→进度回写
├── core/
│   ├── shot-loop.ts                 # ★核心：每镜 generator-critic（通过即停/≤3轮熔断/失败隔离）
│   ├── core.module.ts               # LegacyImporter（旧接口 mock 在这）+ 角色提取 + prompt 加载
│   └── types.ts                     # 全部 zod 契约（ShotDraft/ReviewReport/Score...）
└── prompts/                         # ★队友B的战场：director/reviewer/refiner 三个 .md，改效果不碰代码
```

| 队友 | 负责模块 | 入口 | 别碰 |
|---|---|---|---|
| A | 盲测打分页（前端） | `tasks.controller.ts` + `/tasks/:id/pairs` `/scores` | 后端代码 |
| B | prompt 调优+穿帮规则 | `src/prompts/*.md`（注意：reviewer 的 findings rule 名与 mock 联动） | TS |
| C | 模板配置+部署 | `.env.example` + docker-compose | core/ |
| D | 测试+数据+报表 | `samples/legacy-response.json`、`GET /tasks/:id/scores` | 前后端 |

## TODO（按归属）

- [ ] **周一·张伦**：LLM real 接入（llm.service.ts 的 callReal 已写好，填 env 即用）；旧接口 real 接入（core.module.ts callRealLegacy）；任务中心 real 接入
- [ ] **周一·张伦**：prisma migrate（公司 PG）；QUEUE_MODE=bullmq 验证
- [ ] **队友A**：盲测页（pairs 拉取→并排渲染→打分提交→侧序缓存已由服务端保证）
- [ ] **队友B**：prompts 三个文件按真实剧本调优（当前是通用版）；审查规则补充穿帮细则
- [ ] **队友C**：客户可达部署环境；模板配置接口（当前只有配置位）
- [ ] **队友D**：真实剧本进 samples/；打分报表导出

## 已知限制（mock 模式）

- LLM mock：Director 固定返回咖啡馆场景、Reviewer 固定「首轮不过次轮过」——用于验证 loop 逻辑，不代表效果
- 内存 Store/队列：重启丢数据
- rationale 字段：mock Director 返回携带；真实模型需在 prompt 中要求输出

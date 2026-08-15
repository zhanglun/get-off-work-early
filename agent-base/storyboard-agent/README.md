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

## 架构决策记录（ADR）——踩过的坑与理由

### ADR-1：CommonJS 而非 ESM（2026-08-15）

**坑**：`"type": "module"` 下 NestJS 的构造函数依赖注入失效——`emitDecoratorMetadata` 产出的 `design:paramtypes` 变成 `[Function]`，所有注入解析为 undefined（`Cannot read properties of undefined`）。tsx 转译和 tsc 编译都一样。

**决策**：回退 CommonJS（package.json 删 `type`，tsconfig module=CommonJS，import 去掉 `.js` 后缀）。

**附带规则**（队友写新模块必须遵守）：**构造函数注入的 class 类型必须用值导入**（`import { XService }`），不能只用 `import type { XService }`——type-only 导入不产生运行时引用，装饰器元数据拿不到 token，DI 静默失败。接口/类型用 `import type` 没问题。

### ADR-2：全依赖双模式（real 优先，不可达自动降级）(2026-08-15)

**背景**：周末本机无 Docker/PG/Redis，但链路要跑通。

**决策**：五个外部依赖全部做适配层——Store（PG→内存）、Queue（BullMQ/Redis→进程内即时执行）、LLM（real→mock 按 role 返回可塑性假数据）、任务中心（real→内存态）、旧接口（real→读 samples/legacy-response.json）。

**规则**：mock 不是玩具——Reviewer mock 固定「首轮不过次轮过」让 loop 迭代真实发生；单测用可注入的 fakeLlm 覆盖四条路径。接 real = 填 env + 实现桩函数，业务代码零改动。

### ADR-3：Blind test 侧序在服务端生成并随任务缓存（2026-08-15）

**决策**：`GET /tasks/:id/pairs` 服务端随机 `left:new|left:old` 并按 taskCenterId 缓存（进程内 Map）。同一任务所有打分者看到相同随机顺序——防顺序偏好污染 + 防同一人记位置。重启服务侧序会重新随机（已知限制，内存态；换任务中心/DB 后可持久化）。

### ADR-4：curl localhost 在本机走 IPv6 导致连接空回复（2026-08-15）

**坑**：`curl localhost:3111` 返回 `Empty reply`（HTTP 000），`curl 127.0.0.1:3111` 正常——本机 localhost 解析到 ::1 而服务只听 IPv4。**联调时用 127.0.0.1 或确认双栈监听**，前端 axios/浏览器不受影响。

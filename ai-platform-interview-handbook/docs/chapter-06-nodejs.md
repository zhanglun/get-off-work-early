# 第六章 Node.js

> 本章不是 Node.js 八股文。所有问题都结合项目——为什么选 NestJS、为什么 Prisma、为什么 BullMQ、为什么 Redis、为什么 PostgreSQL，以及这些技术组合在一起的深度问题。
>
> 本章共 15 题。

---

## Q1. 为什么 NestJS？

**🎤 面试官**

> Node.js 后端框架有很多——Express、Fastify、Koa、NestJS。你为什么选 NestJS？

**🙋 候选人回答**

选 NestJS 的核心原因：**DI（依赖注入）+ 模块化 + 企业级结构。**

我们的后端不是简单的 CRUD API，而是有 Task Platform、AI Platform、多个业务模块的复杂系统。Express/Fastify 是"微型框架"——只提供 HTTP 路由，其他（DI、模块化、校验、文档）要自己拼。NestJS 开箱即用提供这些。

**NestJS 的三个关键能力：**

**① DI（依赖注入）**

```typescript
// TaskService 依赖 IAIChatService（接口），不依赖具体实现
@Injectable()
export class TaskService {
  constructor(
    @Inject(TASK_SERVICE) private taskRepo: ITaskRepository,
    @Inject(AI_CHAT_PROVIDER) private ai: IChatProvider,
  ) {}
}
```

DI 让我们在第二章 Q2 讲的"接口隔离"成为可能——模块间通过接口依赖，将来拆服务只换 adapter。

**② 模块化**

```typescript
@Module({
  imports: [TaskModule, AIModule],
  controllers: [DramaController],
  providers: [DramaService],
})
export class DramaModule {}
```

每个业务领域是一个 Module，内部封装，通过 exports 暴露接口。这是"模块化单体"的基础（第二章 Q2）。

**③ 生态完善**

NestJS 有官方的校验（ValidationPipe）、文档（Swagger）、守卫（Guard）、拦截器（Interceptor）、过滤器（ExceptionFilter）。不用自己拼。

**为什么不用 Express/Fastify？**

Express/Fastify 适合小项目——几个路由、简单逻辑。但我们的系统有十几个模块、复杂的依赖关系。用 Express 要自己搭 DI（typedi/inversify）、自己组织模块结构、自己加校验和文档。拼出来的"自制框架"不如 NestJS 成熟。

**NestJS 底层可以用 Fastify**——NestJS 支持切换底层 HTTP 引擎（Express 或 Fastify）。我们用 `@nestjs/platform-fastify`，获得 Fastify 的性能 + NestJS 的结构。

---

**🎤 面试官追问**

> NestJS 的 DI 基于 Angular 的 DI 系统。它和 Spring 的 DI 比怎么样？有没有什么不足？

**🙋 候选人回答**

**NestJS 的 DI 够用，但不如 Spring 成熟。**

**不足一：没有条件化注入**

Spring 有 `@ConditionalOnProperty`——根据配置决定注入哪个实现。NestJS 没有原生支持，要自己写：

```typescript
// Spring: @ConditionalOnProperty(name="provider", havingValue="openai")
// NestJS 要手动判断
@Module({
  providers: [
    {
      provide: AI_CHAT_PROVIDER,
      useFactory: (config: ConfigService) => {
        return config.get('AI_PROVIDER') === 'openai' 
          ? new OpenAIProvider() 
          : new ClaudeProvider();
      },
      inject: [ConfigService],
    },
  ],
})
```

能用，但不如 Spring 优雅。

**不足二：没有循环依赖检测的好工具**

NestJS 有 `forwardRef` 处理循环依赖，但不优雅。Spring 有更成熟的循环依赖解决机制（虽然 Spring 的也争议很大）。

**不足三：AOP（面向切面编程）不如 Spring**

Spring 的 AOP 很强大（事务、日志、缓存都可以切面实现）。NestJS 用拦截器/装饰器模拟 AOP，但不如 Spring 灵活。

**但这些不足对我们影响不大**——我们不需要 Spring 级别的企业特性。NestJS 的 DI + 模块化 + 装饰器对我们的场景够用。而且 TypeScript 的类型系统比 Java 更灵活，弥补了一些 DI 的不足。

---

**🎤 面试官继续追问**

> 你说底层用 Fastify。Fastify 比 Express 快多少？切换有什么坑？

**🙋 候选人回答**

**Fastify 比 Express 快 2-3 倍**（根据 Fastify 官方 benchmark）。原因：Fastify 用 fast-json-stringify 预编译 JSON 序列化，Express 用 JSON.stringify。

**切换的坑：**

1. **中间件 API 不同**：Express 用 `app.use((req, res, next) => {})`，Fastify 用 `fastify.addHook('onRequest', (req, reply) => {})`。NestJS 抽象了这层差异，但直接用 Fastify 插件时要注意。
2. **文件上传**：Express 用 multer，Fastify 用 @fastify/multipart。NestJS 的 FileInterceptor 底层依赖不同。
3. **Cookie**：Express 用 cookie-parser，Fastify 用 @fastify/cookie。

**大部分情况下 NestJS 抽象了差异**，切换只需改 `main.ts` 里的一行：

```typescript
// 从 Express 切到 Fastify
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);
```

**但第三方库可能不兼容**——有些 NestJS 生态的库假设底层是 Express。切换前要测全。

### 🏗 架构分析

**框架对比**

| 框架 | DI | 模块化 | 性能 | 适合规模 |
|------|-----|--------|------|----------|
| Express | ❌ | ❌ | 中 | 小项目 |
| Fastify | ❌ | ❌ | 高 | 小项目+高性能 |
| NestJS | ✅ | ✅ | 高（用 Fastify） | 中大型项目 |

**为什么不用其它方案**

- **Express/Fastify（微型框架）**：只提供 HTTP 路由，DI/模块化/校验/文档要自己拼。对十几个模块、复杂依赖的系统，拼出来的"自制框架"不如 NestJS 成熟，团队规范难统一。
- **Koa**：更底层，连路由都要中间件自己组装，适合定制派，但我们要的是开箱即用的企业结构。
- **不直接上 Java/Spring**：团队主语言是 TypeScript，前后端同语言同类型，SDK 共享类型。换 Spring 等于推翻现有栈。

**权衡与演进**

- 权衡：启动时反射/装饰器开销略高，冷启动比 Fastify 慢；学习曲线比 Express 陡。
- 演进：若未来某模块并发量极高，可以把该模块抽成独立 Fastify 服务或 Go 服务，NestJS 的 DI+接口注入让替换成本可控。

### 🎯 面试官真正考察什么

> 不是问"你用过哪些框架"，而是看你**选型时有没有自己的判断**——能不能从 DI、模块化、团队规模、生态几个维度对比，而不是"大家都用所以我也用"。顺带考察你对 DI/AOP 的理解深度。

### ❌ 常见错误回答

- **背八股**："NestJS 是基于 TypeScript 的企业级 Node.js 框架"——纯背定义，没讲为什么选。
- **只踩一捧一**："Express 太烂了所以用 NestJS"——没说 Express 适合什么场景，显得没思考。
- **忽略团队因素**：只讲技术不讲团队技术栈、运维能力、未来演进。

### ✅ 推荐回答

> 选 NestJS 因为 DI+模块化+企业级结构。我们的系统有十几个模块和复杂依赖关系，Express/Fastify 是微型框架只提供路由其他要自己拼。NestJS 的 DI 让接口隔离可拆分成为可能（@Inject(TOKEN) 依赖接口非实现）、模块化是模块化单体的基础、官方 ValidationPipe/Swagger/Guard/Interceptor 开箱即用。底层用 @nestjs/platform-fastify 获得性能（比 Express 快 2-3 倍）。不足：没有 Spring 的条件化注入（要手动 useFactory）、AOP 不如 Spring 灵活。但 TS 类型系统弥补部分不足。切换 Fastify 的坑：中间件 API 不同、文件上传 multer→@fastify/multipart、但 NestJS 大部分抽象了差异只改 main.ts 一行。

### 📚 延伸知识

- **NestJS DI**：基于 TypeScript 装饰器 + reflect-metadata。`@Injectable()` 标记可注入，`@Inject(TOKEN)` 按令牌注入。
- **Fastify Performance**：fast-json-stringify 预编译 JSON schema → 序列化函数，比 JSON.stringify 快。对大响应体优势明显。

---

## Q2. 为什么 Prisma？

**🎤 面试官**

> Node.js 的 ORM 有 Prisma、TypeORM、Sequelize、Knex。为什么选 Prisma？

**🙋 候选人回答**

**选 Prisma 的核心原因：类型安全 + 迁移管理 + DX（开发者体验）。**

**① 类型安全**

Prisma 从 schema 文件生成 TypeScript 类型，查询结果有完整类型推导：

```prisma
// schema.prisma
model Task {
  id        String   @id @default(uuid())
  status    TaskStatus
  payload   Json
  createdAt DateTime @default(now())
}

enum TaskStatus {
  CREATED
  PENDING
  RUNNING
  COMPLETED
  FAILED
}
```

```typescript
// 查询结果有完整类型
const task = await prisma.task.findUnique({ where: { id: 'abc' } });
// task.status 类型是 TaskStatus 枚举
// task.payload 类型是 Prisma.JsonValue
// 不需要手动定义 TypeScript 接口
```

TypeORM 要手动写 Entity 类 + 手动对齐类型。Prisma 的 schema 是 single source of truth，类型从 schema 生成。

**② 迁移管理**

```bash
# 改 schema 后
prisma migrate dev --name add_task_table
# → 生成 SQL 迁移文件
# → 应用到数据库
# → 更新类型
```

迁移文件是 SQL，可以 review、可以版本控制、可以回滚。TypeORM 的迁移是 JS 代码，不如 SQL 直观。

**③ DX**

- `prisma studio`：可视化数据库浏览器，调试方便。
- `prisma format`：格式化 schema 文件。
- 自动补全：`prisma.task.findMany({ where: { ... } })` 的 where 有类型提示。

**为什么不用 TypeORM？**

1. TypeORM 的 Active Record vs Data Mapper 模式混乱，API 不统一。
2. TypeORM 的类型推导不如 Prisma——查询结果的类型经常是 `any` 或需要手动标注。
3. TypeORM 的迁移有 Bug（早期版本），不如 Prisma 的迁移稳定。

**为什么不用 Knex（查询构建器）？** Knex 不是 ORM，没有模型概念，类型安全要自己做。适合简单查询，复杂关系处理不如 ORM。

---

**🎤 面试官追问**

> Prisma 有什么不足？有人说 Prisma 在复杂查询上性能不如原生 SQL，你怎么看？

**🙋 候选人回答**

**Prisma 确实有不足，三个主要问题：**

**① 复杂查询生成的 SQL 不优**

```typescript
// Prisma 查询
const tasks = await prisma.task.findMany({
  where: { status: 'RUNNING' },
  include: { steps: true, user: true },
});
```

Prisma 可能生成多条 SQL（先查 task，再查 steps，再查 user），而不是一条 JOIN。这导致 N+1 查询或额外的网络往返。

**解决方案**：复杂查询用 `$queryRaw` 写原生 SQL：

```typescript
const tasks = await prisma.$queryRaw`
  SELECT t.*, s.*, u.name 
  FROM tasks t
  LEFT JOIN steps s ON s.task_id = t.id
  LEFT JOIN users u ON u.id = t.user_id
  WHERE t.status = 'RUNNING'
`;
```

**原则：Prisma 用于 80% 的常规 CRUD，复杂查询用原生 SQL。** 不强求所有查询都用 Prisma。

**② 不支持事务的所有场景**

Prisma 支持事务（`$transaction`），但有局限：

```typescript
// Prisma 事务
await prisma.$transaction([
  prisma.task.update({ where: { id: '1' }, data: { status: 'COMPLETED' } }),
  prisma.tokenUsage.create({ data: { taskId: '1', tokens: 100 } }),
]);
```

但交互式事务（先查再改再查）的 API 不如 Knex 灵活：

```typescript
// 交互式事务
await prisma.$transaction(async (tx) => {
  const task = await tx.task.findUnique({ where: { id: '1' } });
  if (task.status !== 'RUNNING') throw new Error('Invalid state');
  await tx.task.update({ where: { id: '1' }, data: { status: 'COMPLETED' } });
});
```

能用，但事务超时时间有默认限制（5 秒），长事务要调配置。

**③ 大表查询的内存问题**

`findMany` 默认查所有匹配行。如果查 100 万行，Prisma 会把所有数据加载到内存。

**解决方案**：分页 + 游标 + `findMany` 的 `take`/`cursor`：

```typescript
// 游标分页，不一次性加载
const tasks = await prisma.task.findMany({
  take: 100,
  cursor: { id: lastId },
  where: { status: 'RUNNING' },
});
```

**但总体来说，Prisma 的 DX 优势远大于这些不足。** 复杂查询用原生 SQL 补位，不强求 Prisma 做所有事。

### 🏗 架构分析

**ORM 对比**

| ORM | 类型安全 | 迁移 | DX | 复杂查询 |
|-----|---------|------|-----|----------|
| Prisma | ✅ 生成 | ✅ SQL | ✅ | ⚠️ 用 $queryRaw 补 |
| TypeORM | ⚠️ 手动 | ⚠️ JS | 中 | ✅ QueryBuilder |
| Knex | ❌ | ❌ | 低 | ✅ |

**为什么不用其它方案**

- **TypeORM**：Active Record / Data Mapper 模式混乱 API 不统一；类型推导差，查询结果常是 `any`；早期版本迁移有 Bug。对任务系统这种需要严格类型 + 可 review 的 SQL 迁移场景，不如 Prisma。
- **Knex（查询构建器）**：不是 ORM，无模型概念，类型安全要手写。适合简单查询，复杂关系处理不如 ORM。
- **原生 SQL + 手写类型**：最灵活但 DX 最差，类型与 SQL 容易脱节，违反"single source of truth"。

**权衡与演进**

- 权衡：复杂查询生成 SQL 不优、事务超时限制、大表查询要手动游标分页。
- 演进：关注 Drizzle ORM（更轻量、更接近 SQL），若未来 Prisma 复杂查询瓶颈明显，可在新模块试点 Drizzle，老模块继续用 Prisma 的 `$queryRaw` 补位。

### 🎯 面试官真正考察什么

> 考察你**选 ORM 时有没有真实踩过坑**——能不能讲清楚 TypeORM 的 Active Record/Data Mapper 混乱、Prisma 复杂查询的 SQL 退化，而不是只会说"Prisma 类型好"。重点看你对"复杂查询用原生 SQL 补位"这种务实判断。

### ❌ 常见错误回答

- **只夸不踩**："Prisma 类型安全所以选它"——不讲不足显得没用过。
- **无视不足**：被问"Prisma 复杂查询性能差吗"时硬说没问题，而不是承认并用 `$queryRaw` 补位。
- **混淆工具定位**：把 Knex 当 ORM 批评，或说"Prisma 比 RabbitMQ 好"这类跨类别对比。

### ✅ 推荐回答

> 选 Prisma 因为类型安全（从 schema 生成 TS 类型，查询结果有完整推导不用手动定义接口）+ 迁移管理（migrate dev 生成 SQL 可 review 可版本控制）+ DX（studio 可视化、自动补全）。不用 TypeORM 因为 Active Record/Data Mapper 模式混乱、类型推导差、迁移有 Bug。不用 Knex 因为不是 ORM 无模型概念类型安全要自己做。不足：复杂查询生成 SQL 不优（可能多条 SQL 非 JOIN）——用 $queryRaw 原生 SQL 补位；事务超时默认 5 秒长事务要调配置；findMany 默认全加载大表要游标分页。原则：Prisma 做 80% 常规 CRUD，复杂查询原生 SQL。

### 📚 延伸知识

- **Prisma Engine**：Prisma 用 Rust 写的查询引擎（Query Engine），通过 Node-API 调用。比纯 JS 的 ORM 性能好。
- **Drizzle ORM**：新兴的 TypeScript ORM，比 Prisma 更轻量、更接近 SQL。值得关注。

---

## Q3. 为什么 BullMQ？（选型对比）

**🎤 面试官**

> 这个问题第二章和第四章都涉及了，这里做系统性对比。BullMQ vs Celery vs Temporal vs RabbitMQ，各自的适用场景？

**🙋 候选人回答**

**一张表说清楚：**

| 工具 | 类型 | 语言 | 适合场景 | 不适合 |
|------|------|------|----------|--------|
| BullMQ | 任务队列 | Node | Node 项目的异步任务 | Python 主语言 |
| Celery | 任务队列 | Python | Python 项目的异步任务 | Node 主语言 |
| Temporal | 工作流引擎 | 多语言 | 复杂工作流+状态持久化 | 简单任务（过重） |
| RabbitMQ | 消息队列 | 语言无关 | 服务间解耦+消息路由 | 任务调度（无状态管理） |

**核心区别：任务队列 vs 消息队列 vs 工作流引擎**

- **任务队列**（BullMQ/Celery）：任务有状态、有重试、有超时。适合"执行一个操作并跟踪结果"。
- **消息队列**（RabbitMQ/Kafka）：消息无状态、消费即删。适合"服务间通信"。
- **工作流引擎**（Temporal）：工作流有状态持久化、支持复杂编排（分支/循环/人工审批）。适合"跨天/跨服务的复杂流程"。

**我们的选择逻辑（多语言多队列并存）：**

```
需要任务调度？
├─ NestJS 业务侧 → BullMQ（Node 生态最成熟，复用 Redis）
├─ Python 音视频侧 → Celery（Python 标配，AI/FFmpeg 生态）
├─ Go 任务中心底座 → asynq（高性能调度，目标统一）
└─ 需要复杂工作流 → Temporal（未来演进考虑）

需要服务间通信？
└─ HTTP（我们选的，简单直接，语言无关）
└─ RabbitMQ/Kafka（不需要，不是数据密集型）
```

**我们的真实状态是三队列并存，正在向 Go asynq 统一。** 这是"不同语言团队各选各的生态工具"的自然结果（康威定律）。关键认知：没有"最好的"队列，只有"最适合场景的"队列。

### 🏗 架构分析

**任务队列 vs 消息队列 vs 工作流引擎**

- **任务队列**（BullMQ/Celery）：任务有状态、有重试、有超时，适合"执行一个操作并跟踪结果"。我们的 Task Platform 任务（生成剧本、跑 pipeline）正需要这种。
- **消息队列**（RabbitMQ/Kafka）：消息无状态、消费即删，适合"服务间通信/解耦"。我们用 HTTP API 做服务间通信，所以不需要。
- **工作流引擎**（Temporal）：状态持久化 + 复杂编排（分支/循环/人工审批），适合"跨天/跨服务的复杂流程"。对当前任务是过重方案。

**为什么不用其它方案**

- **Celery**：我们 Python 侧（音视频处理）确实在用 Celery——它适合 Python 技术栈。但 NestJS 侧不用 Celery，因为跨语言调度徒增复杂度。
- **Temporal**：功能强大但对当前任务过重——需要单独部署、学习曲线陡、运维成本高。只有当任务编排复杂到需要分支循环 + 长时间持久化时才值得引入（未来演进方向）。
- **RabbitMQ/Kafka**：定位是服务间通信/数据管道，不是任务调度。我们服务间通信用 HTTP，不需要跨服务消息路由，引入它们等于杀鸡用牛刀。

**权衡与演进**

- 权衡：BullMQ 依赖 Redis（单点风险需集群/哨兵）、编排能力弱于 Temporal、Web 监控不如 Celery Flower 成熟。
- 演进：若未来出现跨天/跨服务的复杂工作流（如人工审核 + 多分支编排），考虑把该流程迁到 Temporal，简单任务仍留在 BullMQ，混合使用。

### 🎯 面试官真正考察什么

> 考察你**能不能区分任务队列、消息队列、工作流引擎三种工具的定位**，而不是把所有"队列"混为一谈。重点看你是否明白"没有最好的队列只有最适合场景的"，以及选型时是否结合了团队技术栈和复用现有基础设施（我们已用 Redis 所以 BullMQ 复用）。

### ❌ 常见错误回答

- **跨类别拉踩**："BullMQ 比 RabbitMQ/Temporal 好"——三者定位不同，不能直接比。
- **只认一个工具**：什么场景都套 BullMQ（或都套 RabbitMQ），无视任务复杂度和服务边界。
- **忽略技术栈**：Node 项目硬上 Celery，或 Python 项目硬上 BullMQ，没考虑跨语言成本。

### ✅ 推荐回答

> 四者定位不同：BullMQ/Celery/asynq 是任务队列，RabbitMQ 是消息队列，Temporal 是工作流引擎。选择跟着语言和场景走：NestJS→BullMQ，Python→Celery，Go→asynq，复杂工作流→Temporal。我们三队列并存（康威定律），正在向 Go asynq 统一。服务间通信用 HTTP。

### 📚 延伸知识

- **At-Least-Once vs At-Most-Once vs Exactly-Once**：消息投递语义。BullMQ 是 at-least-once（至少一次，可能重复，靠幂等保证）。Kafka 支持 exactly-once（但有限制）。

---

## Q4. 为什么 PostgreSQL？

**🎤 面试官**

> 数据库为什么选 PostgreSQL 不选 MySQL？很多人说 MySQL 够用了。

**🙋 候选人回答**

**三个 PostgreSQL 的优势，每个都和我们的业务相关：**

**① JSONB 支持**

我们的任务系统大量用 JSONB——stepResults、任务 payload、AI 返回的结构化数据都存 JSONB。

```sql
-- PG 的 JSONB 查询
SELECT * FROM tasks 
WHERE step_results->'script_split'->>'status' = 'COMPLETED'
  AND payload->>'type' = 'drama_gen';
```

PG 的 JSONB 有索引（GIN），查询性能好。MySQL 的 JSON 支持不如 PG 成熟（MySQL 5.7+ 支持 JSON 但查询语法不如 PG 方便，索引也不如 GIN 灵活）。

**② 向量搜索（pgvector）**

PG 的 pgvector 扩展让我们能在同一个数据库里同时做结构化查询和向量相似度搜索。AI Platform 未来要做语义检索（比如相似脚本/分镜检索、内容去重），pgvector 可以直接在 PG 里做，不用单独部署向量数据库。MySQL 没有原生向量搜索。

**③ 事务和一致性**

PG 的 MVCC（多版本并发控制）比 MySQL 的更成熟。PG 的隔离级别默认是 Read Committed，但支持 Serializable。我们的任务状态更新需要严格的一致性（乐观锁+条件 UPDATE，第四章 Q2），PG 的事务行为更可预测。

**为什么不选 MySQL？**

1. JSONB 不如 PG（MySQL 的 JSON 查询语法笨重）。
2. 没有向量搜索（要单独部署 Milvus/Pinecone）。
3. 事务行为不如 PG 可预测（MySQL 的 Repeatable Read 有幻读问题，PG 不会）。

**但 MySQL 也有优势**：运维生态更成熟（更多 DBA 会 MySQL）、工具链更丰富。如果团队只有 MySQL DBA，选 MySQL 也合理。我们团队更熟悉 PG，所以选 PG。

---

**🎤 面试官追问**

> 你说 PG 的 MVCC 比 MySQL 好，具体好在哪？MVCC 的原理是什么？

**🙋 候选人回答**

**MVCC（Multi-Version Concurrency Control）的核心：读不阻塞写，写不阻塞读。**

原理：每行数据有多个版本。事务 A 读到的是"事务 A 开始时的快照版本"，事务 B 写新版本不影响 A 的读。

```
事务 A（读）：SELECT * FROM tasks WHERE id = '1'
  → 读到 version 1（status = 'RUNNING'）

事务 B（写）：UPDATE tasks SET status = 'COMPLETED' WHERE id = '1'
  → 创建 version 2（status = 'COMPLETED'）
  → version 1 仍然存在（事务 A 还在读）

事务 A 再次读：还是读到 version 1（在同一事务里）
```

**PG vs MySQL 的 MVCC 差异：**

| 维度 | PostgreSQL | MySQL (InnoDB) |
|------|-----------|----------------|
| 版本存储 | 旧版本存 undo log | 旧版本存 undo log |
| 回滚段 | undo log 在单独区域 | undo log 在表空间 |
| Repeatable Read | 无幻读（快照隔离） | 有幻读（Next-Key Lock 缓解但不完全） |
| Vacuum | 需要定期 VACUUM 清理旧版本 | 自动清理 |
| 空间膨胀 | 旧版本在表里，需要 VACUUM | 旧版本在 undo，表不膨胀 |

**PG 的 RR 没有幻读**——因为 PG 的 RR 是真正的快照隔离（Snapshot Isolation），同一事务里多次查询结果一致。MySQL 的 RR 用 Next-Key Lock 防幻读，但在某些场景下（如范围查询+并发插入）仍可能出现幻读。

**PG 的代价是 VACUUM**——旧版本留在表里，需要定期 VACUUM 清理，否则表膨胀。这是 PG 的运维成本。MySQL 的 undo log 在单独区域，表不膨胀，但 undo 空间也要管理。

### 🏗 架构分析

**PG vs MySQL**

| 维度 | PostgreSQL | MySQL |
|------|-----------|-------|
| JSONB | ✅ GIN 索引 | ⚠️ 较弱 |
| 向量搜索 | ✅ pgvector | ❌ |
| MVCC | 快照隔离无幻读 | Next-Key Lock |
| 运维 | 需要 VACUUM | 自动清理 |
| DBA 生态 | 较少 | 丰富 |

**为什么不用其它方案**

- **MySQL**：JSONB 支持弱（查询语法笨重、索引不如 GIN 灵活）、无原生向量搜索（语义检索要单独部署 Milvus/Pinecone）、RR 隔离用 Next-Key Lock 某些场景仍有幻读。任务系统的 `stepResults`/payload 重度依赖 JSONB，MySQL 不满足。
- **MongoDB**：JSON 天然友好，但事务/一致性弱于关系库，任务状态更新需要严格一致性（乐观锁 + 条件 UPDATE），且无法和结构化数据 + 向量搜索统一在同一个库里。
- **单独向量库（Milvus/Pinecone）+ 关系库**：要维护两套系统，跨库一致性难保证。PG + pgvector 一个库搞定，运维成本低。

**权衡与演进**

- 权衡：需要定期 VACUUM 防表膨胀（运维成本）、DBA 生态不如 MySQL 丰富。
- 演进：若未来向量数据量极大，pgvector 性能不足，可拆出专用向量库（Milvus），关系数据仍留 PG。

### 🎯 面试官真正考察什么

> 不是问"MySQL 和 PG 谁好"，而是看你**选型是否基于具体业务需求**——能不能讲清楚 JSONB、pgvector、MVCC 这三点各自对应什么业务场景（任务 payload / 语义检索 / 任务状态一致性）。追问 MVCC 是在探你底层原理的深度。

### ❌ 常见错误回答

- **背八股**："PG 支持事务、ACID"——MySQL 也支持，这不算选型理由。
- **空洞对比**："PG 更先进"——讲不出 JSONB/pgvector/MVCC 的具体差异。
- **无视代价**：只夸 PG 不讲 VACUUM 运维成本和 DBA 生态劣势，显得没用过。

### ✅ 推荐回答

> 选 PG 三个原因：① JSONB 支持好（任务 stepResults/payload 存 JSONB，GIN 索引查询快，MySQL 的 JSON 查询笨重索引不灵活）；② pgvector 向量搜索（未来语义检索/内容去重在一个 DB 里做，MySQL 无原生向量）；③ MVCC 更成熟（RR 是真正的快照隔离无幻读，MySQL 的 RR 用 Next-Key Lock 某些场景仍有幻读）。PG 的 MVCC 读不阻塞写写不阻塞读——每行多版本，事务 A 读快照版本，事务 B 写新版本不影响 A。代价是 VACUUM（旧版本留表里需定期清理防膨胀，MySQL undo 在单独区域表不膨胀）。MySQL 优势是 DBA 生态丰富。我们团队更熟悉 PG 所以选 PG。

### 📚 延伸知识

- **pgvector**：PostgreSQL 的向量扩展，支持 IVFFlat 和 HNSW 索引。让 PG 可以做向量相似度搜索。
- **Snapshot Isolation**：PG 的 Repeatable Read 实际是 Snapshot Isolation——比 SQL 标准的 RR 更强（防幻读），但不如 Serializable（防写倾斜）。

---

## Q5. Node.js 的事件循环

**🎤 面试官**

> 你一直说 Node 适合 I/O 密集不适合 CPU 密集。能不能深入讲讲事件循环？为什么 CPU 密集会阻塞？

**🙋 候选人回答**

**Node.js 的事件循环是一个单线程的循环，不断处理事件队列里的任务。**

```
事件循环阶段（简化）：
  ┌───────────────────────────┐
  │   timers（setTimeout）      │
  ├───────────────────────────┤
  │   pending callbacks        │
  ├───────────────────────────┤
  │   idle, prepare             │
  ├───────────────────────────┤
  │   poll（I/O 事件）           │  ← 大部分时间在这里等 I/O
  ├───────────────────────────┤
  │   check（setImmediate）     │
  ├───────────────────────────┤
  │   close callbacks          │
  └───────────────────────────┘
```

**I/O 密集为什么不阻塞？**

```typescript
// 网络 I/O（非阻塞）
const result = await fetch('https://api.openai.com/...');
// fetch 发起请求后，事件循环不等待——继续处理其他请求
// 响应回来后，事件循环在 poll 阶段拿到结果，执行 await 之后的代码
```

I/O 操作交给系统（libuv 的线程池），事件循环不阻塞。在等 I/O 期间可以处理成千上万个其他请求。

**CPU 密集为什么阻塞？**

```typescript
// CPU 密集（阻塞）
function heavyCompute(n: number): number {
  let result = 0;
  for (let i = 0; i < n; i++) result += Math.sqrt(i);
  return result;
}

const result = heavyCompute(1000000000);  // 跑 5 秒
// 这 5 秒里，事件循环完全卡住——不处理任何其他请求
```

JavaScript 是单线程的，CPU 计算在主线程执行。计算期间事件循环无法进入下一个 tick——所有其他请求排队等待。

**这就是我们用 Python Worker 做 CPU 密集任务的原因**（第四章 Q4）——FFmpeg 视频合成、AI 图像推理是 CPU 密集的，放 Node 主线程会卡死所有请求。

---

**🎤 面试官追问**

> 如果非要在 Node 里做 CPU 密集计算，有没有办法不阻塞事件循环？

**🙋 候选人回答**

**有，用 Worker Threads。**

```typescript
import { Worker } from 'worker_threads';

// 主线程
function heavyComputeInWorker(data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./compute-worker.js', {
      workerData: data,
    });
    
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

// compute-worker.js（独立线程）
import { parentPort, workerData } from 'worker_threads';

const result = heavyCompute(workerData);
parentPort.postMessage(result);
```

Worker Threads 在独立线程跑 JS，不阻塞主线程的事件循环。

**但 Worker Threads 有局限：**

1. **不能共享内存**（除非用 SharedArrayBuffer，但复杂且有安全限制）。
2. **通信开销**：数据在主线程和 Worker 间序列化/反序列化。大数据传输慢。
3. **不是所有 Node API 都支持**（有些原生模块不能在 Worker 里用）。

**所以我们的选择是**：轻量 CPU 任务用 Worker Threads（如 JSON 大文件解析），重计算（FFmpeg/AI 推理）用 Python Worker。Worker Threads 适合"偶尔的 CPU 任务"，Python Worker 适合"持续的 CPU 密集工作流"。

**另一个方案：子进程。**

```typescript
import { exec } from 'child_process';

// 开子进程跑 CPU 密集任务
exec('python3 compute.py', (error, stdout, stderr) => {
  const result = JSON.parse(stdout);
});
```

子进程比 Worker Threads 更重（独立进程而非线程），但隔离更好。我们的 Bridge Worker（Node→Python）本质就是子进程通信。

### 🏗 架构分析

**Node.js CPU 密集的解决方案**

| 方案 | 隔离 | 通信成本 | 适合 |
|------|------|----------|------|
| 主线程 | ❌ 阻塞 | 无 | 不适合 CPU 密集 |
| Worker Threads | 线程级 | 中（序列化） | 轻量 CPU 任务 |
| 子进程 | 进程级 | 高（stdout/IPC） | 重计算/跨语言 |
| Python Worker | 进程级 | 高（Redis 队列） | AI/FFmpeg（我们用的） |

**为什么不用其它方案**

- **主线程直接算**：JS 单线程，CPU 计算会卡死事件循环，所有请求排队——对要维护大量并发请求的 Node 服务是灾难。
- **Worker Threads vs 子进程**：Worker Threads 轻量（线程级），但不能共享内存、有序列化开销，适合偶尔的 CPU 任务（大 JSON 解析）；子进程更重但隔离好，Bridge Worker（Node↔Python）本质就是子进程通信。
- **Python Worker（我们最终选的）**：FFmpeg/视频合成、AI 图像推理是持续的 CPU 密集工作流，放 Node Worker Threads 仍占用本机资源且要重写算法；Python 生态（PyTorch/FFmpeg 绑定）更成熟，通过 Redis 队列解耦，Node 主线程零阻塞。

**权衡与演进**

- 权衡：Python Worker 引入跨语言通信成本（Redis 序列化）、多一套服务要运维、调试链路更长。
- 演进：未来若 Node 侧 CPU 任务变多，可评估 Worker Threads 池化；若 AI 推理量极大，Python Worker 可独立扩缩容甚至上 GPU 集群。

### 🎯 面试官真正考察什么

> 不是考你"事件循环有几个阶段"（那是死记硬背），而是看你**是否理解 Node 的本质边界**——为什么 I/O 不阻塞、为什么 CPU 阻塞，以及遇到 CPU 密集任务时**有没有务实的工程解法**（Worker Threads / 子进程 / 拆给其他语言 Worker），而不是空谈"Node 不适合 CPU 密集"就完了。

### ❌ 常见错误回答

- **背阶段名**：把 timers/poll/check 各阶段背一遍但讲不清"为什么 I/O 不阻塞、CPU 阻塞"。
- **一刀切**："Node 不能做 CPU 密集所以我们要换 Java/Go"——忽视 Worker Threads、子进程、跨语言 Worker 这些解法。
- **混淆概念**：把 Worker Threads 当成多核并发的银弹，忽略它不能共享内存、通信开销大的局限。

### ✅ 推荐回答

> 事件循环是单线程循环，不断处理 timers/poll/check 等阶段的事件。I/O 密集不阻塞因为 I/O 交给系统（libuv 线程池），事件循环继续处理其他请求，响应回来后 poll 阶段拿结果。CPU 密集阻塞因为 JS 单线程，计算在主线程执行，期间事件循环无法进入下一个 tick 所有请求排队。非要在 Node 做 CPU 密集：Worker Threads（独立线程不阻塞主线程，但不能共享内存有通信开销，适合轻量 CPU 任务）；子进程（更重但隔离好，Bridge Worker 本质就是子进程通信）。我们的选择：轻量用 Worker Threads，重计算（FFmpeg/AI）用 Python Worker。

### 📚 延伸知识

- **libuv**：Node.js 底层的异步 I/O 库（C 语言）。提供事件循环和线程池（默认 4 线程处理 I/O）。
- **Worker Threads**：Node 10+ 的实验特性，Node 12+ 稳定。用 `worker_threads` 模块创建独立线程。

---

## Q6-Q12. 快速深挖题

---

## Q6. NestJS 的生命周期和中间件执行顺序

### 🏗 架构分析

- **为什么这么设计**：NestJS 把请求处理拆成 Middleware/Guard/Interceptor/Pipe/Filter 多个阶段，每个阶段单一职责，便于在固定切点插入横切逻辑（鉴权、校验、日志）。
- **为什么不用其它方案**：① 纯 Express 中间件链——所有逻辑挤在 `app.use` 里，鉴权/校验/日志混在一起难以分层；② 自己写 AOP 切面——重复造轮子，不如 NestJS 内建的执行管道成熟。
- **权衡**：阶段多意味着学习成本和调试链路变长（出问题要分清是哪一层），换来的是关注点分离和可插拔。

### 🎯 面试官真正考察什么

> 看你是否**真的在 NestJS 里写过 Guard/Interceptor/Pipe**，而不只是会贴 Controller。重点是执行顺序背后的设计意图（Guard 先于 Pipe 省校验资源、Interceptor 类似 AOP around）。

### ❌ 常见错误回答

- **记错顺序**：把 Pipe 说在 Guard 前，或把 ExceptionFilter 说在 Controller 前。
- **背名词不讲用途**：只列出五个阶段，讲不清各自职责和为什么是这个顺序。

### ✅ 推荐回答

> NestJS 请求生命周期：Middleware → Guard → Interceptor(before) → Pipe → Controller → Interceptor(after) → Exception Filter → Response。Guard 做权限检查（在路由处理之前），Pipe 做参数校验和转换，Interceptor 做前后处理（类似 AOP 的 around advice），ExceptionFilter 做错误处理。执行顺序很重要——Guard 在 Pipe 之前意味着权限检查优先于参数校验（未授权的请求不浪费校验资源）。Interceptor 在 Controller 前后包裹，适合做日志/缓存/响应转换。

### 📚 延伸知识

- **Guard vs Middleware**：Guard 专注鉴权、能拿到 `ExecutionContext`（知道当前是 HTTP/RPC/WS），比 Express 中间件更精准。
- **Interceptor 实现缓存/超时**：Interceptor 可包装 Controller 返回的 Observable，常用于响应转换、缓存命中短路、`timeout` 取消。

---

## Q7. Prisma 的 N+1 查询问题怎么解决？

### 🏗 架构分析

- **为什么会产生**：查主表后循环里逐条查关联，N 条关联 = N 次 SQL。Prisma 的 `include`/`select` 大部分情况会被优化成 JOIN 或批量查询，但手写循环、按条件分次查时仍会触发。
- **为什么不用其它方案**：① 手写 JOIN——SQL 复杂、类型要自己维护；② DataLoader（批量+缓存）——通用但要在代码里显式接入，Prisma 的 `include` 对常规场景已够用。
- **权衡**：`include` 简单但可能拉多余字段；`$queryRaw` 灵活但丢类型。按场景选。

### 🎯 面试官真正考察什么

> 看你是否**真的排查过 N+1**——能不能讲清"include 大部分会优化、但循环里查关联仍会触发"，以及怎么用日志定位（开 `prisma:query`），而不是只会背"用 join"。

### ❌ 常见错误回答

- **一刀切**："Prisma 一定会有 N+1，所以都改成原生 SQL"——include 大部分会优化，没必要全改。
- **讲不清检测方法**：说不出怎么发现 N+1（开 query logging 看重复模式查询）。

### ✅ 推荐回答

> N+1 是查 1 个主表后循环查 N 个关联表。Prisma 的 include 会被优化成 JOIN 或批量查询（大部分情况不是 N+1），但某些场景仍可能触发：如在循环里查关联。解决方案：① 用 include/select 一次性查关联（`prisma.task.findMany({ include: { steps: true } })`）；② 用 $queryRaw 写 JOIN SQL；③ 如果是条件关联查询用 where 过滤关联。检测 N+1：开 Prisma 的 query logging（`prisma:query` 日志），看一个请求里有没有大量相同模式的查询。

### 📚 延伸知识

- **DataLoader**：Facebook 出的批量+缓存工具，适合"同一请求内多次按 id 查同一表"的场景，配合 Prisma 用可彻底消除 N+1。
- **Prisma 的 `relationLoadStrategy: join`**：Prisma 较新版本支持配置关联加载策略，可观察生成的 SQL 是否走 JOIN。

---

## Q8. Node.js 的内存泄漏怎么排查？

### 🏗 架构分析

- **为什么这么排查**：内存泄漏是慢病，监控先行（Prometheus 采 `heapUsed`）、确认趋势后再上 Heap Snapshot 对比 diff——盲拍快照找不出问题。
- **为什么不用其它方案**：① 只靠重启掩盖——不定位根因，泄漏会复发且可能在流量高峰爆；② 纯看日志——日志反映不出对象引用关系，必须靠 Snapshot diff。
- **权衡**：拍 Heap Snapshot 会暂停进程（STW），生产环境要在低峰或单实例上做，不能常态化全量拍。

### 🎯 面试官真正考察什么

> 看你**有没有真实的排障经历**——能不能讲出一个具体案例（如 WebSocket 监听器没清理）和修复手段（`removeAllListeners`），而不是只会说"用 DevTools 看内存"。

### ❌ 常见错误回答

- **只背步骤不结合案例**：列了 Snapshot 步骤但说不出一个真实泄漏点。
- **忽视监控**：直接上 DevTools，不先讲怎么通过内存曲线判断"持续增长不回落"。

### ✅ 推荐回答

> 排查步骤：① 监控内存（Prometheus 采集 process.memoryUsage().heapUsed）；② 发现内存持续增长不回落 → 怀疑泄漏；③ 用 --inspect 启动 Node，Chrome DevTools 的 Memory 面板拍 Heap Snapshot；④ 对比两个 Snapshot 的 diff，找只增不减的对象；⑤ 常见泄漏原因：事件监听器没移除（EventEmitter.on 但没有 off）、闭包引用大对象、Map/Set 只增不删、全局缓存无限增长。我们的真实案例：WebSocket 连接断开后事件监听器没清理，每次连接断开泄漏一个监听器。修复：在 onclose 里 removeAllListeners。定期用 clinic.js 或 --heapsnapshot-near-heap-limit 自动拍快照。

### 📚 延伸知识

- **V8 的新生代/老生代**：短命对象在新生代（Scavenge 回收），存活久的进老生代（标记清除）。泄漏通常表现为老生代只增不减。
- **clinic.js / 0x**：Node 诊断工具集，`clinic heapprofiler` 可生成长期内存火焰图，比单点 Snapshot 更适合定位慢泄漏。

---

## Q9. Node.js 的 Cluster 和 PM2

### 🏗 架构分析

- **为什么需要**：Node 单进程单线程，单实例利用不满多核；Cluster 通过 fork 多个共享端口的子进程把负载分到多核。
- **为什么不用其它方案**：① 单进程单线程——CPU 利用率低、单实例吞吐受限；② 纯 PM2 Cluster——传统单机部署方案，但容器化下 PM2 和 K8s 多副本职责重叠，多一层进程管理反而干扰扩缩容。
- **权衡**：容器化 + 单进程 + K8s 多副本更云原生（扩缩容、滚动升级交给编排器），但单容器内多核利用要靠副本数凑；单机 + PM2 Cluster 更简单但不适合云原生。

### 🎯 面试官真正考察什么

> 看你是否**理解 Cluster/PM2 和容器化部署的关系**——能不能讲清"为什么我们容器里不用 PM2"，而不是把 PM2 当万能答案。

### ❌ 常见错误回答

- **无脑推 PM2**："Node 部署就用 PM2 -i max"——没考虑容器化下和 K8s 多副本职责冲突。
- **混淆进程和副本**：分不清 Cluster 多进程和 K8s 多副本解决的问题。

### ✅ 推荐回答

> Node 单进程单线程，多核 CPU 利用不满。Cluster 模块创建多个子进程（=CPU 核数），共享端口。PM2 封装了 Cluster——`pm2 start app.js -i max` 自动按 CPU 核数 fork。但我们的 Worker 用 Docker/K8s 部署，不用 PM2——每个容器一个 Node 进程，K8s 负责多副本。容器化下 Cluster 的意义降低（多副本替代多进程），但单容器内仍可用 Cluster 利用多核。选择：容器化+单进程+K8s 多副本（我们用的）vs 单机+PM2 Cluster。前者更云原生，后者更传统。

### 📚 延伸知识

- **Cluster 的 round-robin**：Node Cluster 默认用 round-robin 分发连接（除 Windows 某些场景），避免惊群。
- **PM2 的零停机重载**：`pm2 reload` 逐个重启进程实现优雅升级；K8s 对应的是 RollingUpdate + readinessProbe。

---

## Q10. async/await 的错误处理最佳实践

### 🏗 架构分析

- **为什么分层**：不同错误需要在不同层处理——已知业务错误（AI 429）局部捕获重试，未预期错误全局兜底，进程级兜底防崩溃。每层职责单一。
- **为什么不用其它方案**：① 每个 async 都 try-catch——冗余、淹没主流程，错误该冒泡的让它冒泡；② 只靠全局 Filter——丢掉局部重试能力，429 这种可恢复错误无法处理。
- **权衡**：分层需要团队约定"哪些错误在哪层捕获"，新人容易乱放；换来的是关注点分离和统一错误响应格式。

### 🎯 面试官真正考察什么

> 看你**对错误处理是否有体系化思考**——能不能讲清"局部捕获可恢复错误 + 全局 Filter 兜底 + 进程级防崩溃"三层，以及"不要每个 async 都 try-catch"这种工程判断。

### ❌ 常见错误回答

- **每个 async 都包 try-catch**：冗余、主流程被错误处理淹没。
- **业务层直接抛 HTTP 状态码**：业务逻辑耦合了传输层细节（状态码应该在 Filter 层转换）。

### ✅ 推荐回答

> 三层错误处理：① 局部 try-catch——在具体异步操作处捕获已知错误（如 AI 调用的 429）；② NestJS ExceptionFilter——全局兜底，捕获未处理的异常返回统一错误格式；③ Process 级别——`process.on('unhandledRejection')` 和 `process.on('uncaughtException')` 兜底防崩溃。关键：不要每个 async 函数都包 try-catch（冗余），让错误冒泡到上层统一处理。但要在"知道怎么处理"的层捕获（如 429 重试）。NestJS 的 Filter 捕获后转成 HTTP 响应，业务逻辑不该知道 HTTP 状态码。

### 📚 延伸知识

- **unhandledRejection 的演进**：Node 15+ 起，未处理的 Promise rejection 默认会终止进程（之前只警告）。生产必须监听并处理。
- **NestJS 内置异常**：`BadRequestException`/`NotFoundException` 等自带状态码，自定义 Filter 可统一拦截并加上错误码/链路 traceId。

---

## Q11. TypeScript 的类型系统在大型项目里的价值

### 🏗 架构分析

- **为什么这么设计**：大型 Monorepo 多模块、多团队协作，类型系统是"编译期护栏"——改一个接口立刻让所有依赖方报错，不用靠人肉搜索替换。
- **为什么不用其它方案**：① 纯 JS（动态类型）——重构靠全局搜索，漏改只在运行时炸；② JSDoc 注解——能补一部分类型但不完整、维护成本高、约束力弱；③ 运行时校验（zod/joi）——和编译期类型互补但解决不了"重构时跨文件追踪"的问题。
- **权衡**：类型定义增加代码量、编译时间、学习成本；但对大型项目，重构安全和文档即代码的收益远大于代价。

### 🎯 面试官真正考察什么

> 看你**是否体会过类型系统在大型项目里的真实价值**——重点讲"contracts 包改接口所有依赖方编译报错"这种重构安全，而不是泛泛说"TS 有类型"。

### ❌ 常见错误回答

- **背定义**："TS 是 JS 的超集，加了静态类型"——没讲大型项目里为什么值。
- **只夸不踩**：不说类型定义增加代码量和编译时间的代价。

### ✅ 推荐回答

> 类型系统在大型项目里的三个价值：① 重构安全——改一个接口，TS 编译器立刻告诉你所有受影响的地方，不用全局搜索替换；② 文档即代码——函数签名就是文档，参数类型/返回类型一目了然；③ 编译时捕获错误——拼错属性名、传错参数类型在编译时发现而非运行时。我们的 Monorepo 里 contracts 包（第三章 Q5）用 TS 类型定义跨模块接口，改一个接口所有依赖方编译报错——这是动态类型语言做不到的。代价：类型定义增加代码量、编译时间、学习成本。但对大型项目收益远大于代价。

### 📚 延伸知识

- **contracts 包模式**：Monorepo 里把跨模块的接口/DTO 抽成独立 npm 包，前后端共享类型，改一处全链路编译校验。
- **运行时校验补位**：TS 是编译期类型，外部输入（HTTP/消息）需用 zod/io-ts 在运行时校验，zod 还可推导 TS 类型做到"运行时+编译期"统一。

---

## Q12. 如果用 Go 重写后端，你觉得哪些部分值得重写？

### 🏗 架构分析

- **为什么这么选**：不是全盘换语言，而是"混合语言"——Go 重写性能瓶颈部分（高并发调度、长连接网关），Node 保留业务层和与前端共享类型的 SDK。
- **为什么不用其它方案**：① 全盘 Go 重写——推翻现有栈、丢掉 TS 与前端共享类型、重写 NestJS 的 DI/模块化，代价远大于收益；② 不重写（纯靠 Node 优化）——Task 调度核心和 WebSocket 网关的并发瓶颈靠 Node 事件循环 + Worker Threads 难以根治。
- **权衡**：混合语言增加运维和招聘复杂度、跨语言调试链路更长；换来的是性能瓶颈被针对性解决、业务层保持高效迭代。

### 🎯 面试官真正考察什么

> 考察你**对 Node 边界的清醒认知 + 务实的工程判断**——能不能区分"哪些该重写、哪些不该"，给出混合语言而非全盘推翻的方案，并讲清理由（Go 的 goroutine 适合调度/网关，NestJS 的企业结构适合业务层）。

### ❌ 常见错误回答

- **全盘重写**："Go 性能好所以全部换 Go"——无视业务层用 NestJS 更高效、SDK 需和前端共享 TS 类型。
- **一律不换**："Node 够用了"——回避调度核心和网关的并发瓶颈。
- **不懂取舍**：说不出 Go 适合什么、Node 适合什么。

### ✅ 推荐回答

> 值得用 Go 重写的：① Task Platform 的调度核心——Go 的 goroutine 比 Node 的事件循环更适合高并发任务调度，吞吐量更高延迟更低；② Bridge Worker——Go 的并发模型能更高效地处理 Node↔Python 间的消息转发；③ WebSocket Gateway——Go 的网络性能好，适合维护大量长连接。不值得重写的：① API 层——CRUD API 用 NestJS 的 DI+模块化更高效，Go 的 web 框架（Gin/Echo）没有 NestJS 的企业级结构；② SDK——TypeScript SDK 和前端共享类型，Go 写不了。结论：Go 重写性能瓶颈部分（调度/网关），Node 保留业务层。这是"混合语言"而非"全盘换语言"。

### 📚 延伸知识

- **goroutine vs Node 事件循环**：goroutine 是用户态轻量级线程（可真正多核并行），Node 事件循环是单线程协作式并发——CPU 密集 + 高并发调度场景 Go 更优。
- **gRPC/Thrift 跨语言通信**：混合语言栈里，Go 与 Node 之间用 gRPC（基于 Protocol Buffers，可生成两端类型）通信，比 REST 更高效且类型安全。

---

## Q13. Node.js Stream 和背压（backpressure）怎么处理？

**🎤 面试官**

> 你们平台要处理几百兆的视频文件，还要过 FFmpeg 转码。如果一次性把文件读进内存再做，Node 进程直接 OOM。这块你怎么用 Stream 处理？背压是什么，怎么解决？

**🙋 候选人回答**

**先讲清楚 Stream 是什么，再讲背压，最后落到我们视频处理的场景。**

**① Stream 的三种类型**

Node 的 Stream 本质是"边读边处理边写"，而不是"全读进来再处理"。四种类型：

- **Readable**：可读流，数据的来源（`fs.createReadStream`、HTTP 请求体、`process.stdin`）。
- **Writable**：可写流，数据的去处（`fs.createWriteStream`、HTTP 响应体）。
- **Transform**：转换流，读进来改一改再写出去（典型的就是 zlib 压缩、加密、我们自定义的视频分段处理）。
- **Duplex**：双向流，读写独立（如 WebSocket）。

举个最朴素的例子：从磁盘拷一个 500MB 视频文件。

```typescript
// ❌ 错误做法：一次性读进内存
import { readFileSync, writeFileSync } from 'fs';
const buf = readFileSync('./input.mp4');     // 内存吃 500MB
writeFileSync('./output.mp4', buf);

// ✅ 正确做法：流式拷贝
import { createReadStream, createWriteStream } from 'fs';
createReadStream('./input.mp4')              // 每次读 64KB（highWaterMark 默认）
  .pipe(createWriteStream('./output.mp4'));  // 每次写 64KB
// 全程内存占用只有几十 KB
```

流式处理让"处理大文件"这件事不再受内存限制。

**② 背压（Backpressure）是什么**

**背压的本质是"生产者比消费者快"——读得快、写得慢，数据堆积在内存里。**

```typescript
// 可读流每秒产 10MB，但可写流（比如传到 OSS）每秒只能写 2MB
readable.pipe(writable);
// 读出来的 8MB/s 差额去哪了？堆在 Writable 的内部 buffer 里
// buffer 越积越大 → 内存暴涨 → OOM
```

Node 的解决机制是 **highWaterMark（高水位线）**：

- 每个 Stream 内部有个 buffer，大小由 `highWaterMark` 控制（默认对象流 16 个、字节流 64KB）。
- 当 buffer 数据量超过 highWaterMark，Stream 会暂停读取，给消费者时间消化。
- 消费者消化完（drain 事件），再继续读。

**`.pipe()` 帮你做了这件事——它内部监听可写流的 drain 事件，自动暂停/恢复可读流。**

**③ 手动处理背压（pipe 不够用的时候）**

`.pipe()` 有局限：错误处理不完善、多个流串联时一个挂了不会自动清理其他。生产环境我倾向直接写手动背压循环：

```typescript
import { createReadStream, createWriteStream } from 'fs';

const readable = createReadStream('./input.mp4');
const writable = createWriteStream('./output.mp4');

readable.on('data', (chunk) => {
  const ok = writable.write(chunk);
  if (!ok) {
    // 写不进去了（buffer 超 highWaterMark）→ 暂停读
    readable.pause();
  }
});

writable.on('drain', () => {
  // buffer 消化完 → 恢复读
  readable.resume();
});

readable.on('end', () => writable.end());
```

核心是 `writable.write()` 的返回值——`false` 就表示"我先别给你了"，暂停读流；等 `drain` 事件再恢复。这就是手动版的 `.pipe()`。

**④ pipeline() 替代 pipe()**

```typescript
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { createGzip } from 'zlib';

await pipeline(
  createReadStream('./input.mp4'),
  createGzip(),                    // Transform 流
  createWriteStream('./output.mp4.gz')
);
```

`pipeline()` 比 `.pipe()` 强在：

- **错误传播**：中间任意一个流出错，整个链路自动销毁，不会泄漏 fd。
- **资源清理**：成功/失败都会 close 所有流，不会留半开的文件描述符。
- **Promise 化**：`stream/promises` 版本返回 Promise，配合 async/await 更直观。

`.pipe()` 链中如果某个流出错，其他流不会自动 close——文件描述符泄漏，长期跑会"too many open files"。所以**生产环境一律用 `pipeline()`**。

**⑤ 我们的视频处理场景：流式过 FFmpeg 不 OOM**

我们的真实需求：把一个 500MB 的用户上传视频流式喂给 FFmpeg 做转码/抽帧，不能把整个视频加载进内存。

```typescript
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

async function transcodeVideo(inputPath: string, outputPath: string) {
  // FFmpeg 从 stdin 读、往 stdout 写，天然就是个 Transform 流
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',        // 从 stdin 读
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-f', 'mp4',
    'pipe:1',              // 往 stdout 写
  ]);

  // 把 ffmpeg.stdin/stdout 接入 pipeline
  await pipeline(
    createReadStream(inputPath),    // 读源文件
    ffmpeg.stdin,                    // 喂给 FFmpeg
  );

  // 另一条 pipeline 把 FFmpeg 输出写回磁盘
  await pipeline(
    ffmpeg.stdout,
    createWriteStream(outputPath),
  );
}
```

关键点：FFmpeg 的 `stdin` 是个 Writable、`stdout` 是个 Readable。`pipeline` 自动处理背压——FFmpeg 转码跟不上时，自动暂停读源文件。全程内存占用恒定，不会因为视频大就爆。

**实际生产里我们用 fluent-ffmpeg 库**，它把这些细节封装好了，但底层原理就是上面这套。

---

**🎤 面试官追问**

> 你说 highWaterMark 默认 64KB。如果我把视频处理的 highWaterMark 调到 1MB，吞吐量会更高吗？为什么要默认这么小？

**🙋 候选人回答**

**调大 highWaterMark 确实能提高吞吐，但代价是内存占用变高。这是个吞吐 vs 内存的权衡。**

**调大的好处：**

- 每次 I/O 系统调用读更多数据，syscall 次数减少。
- 对慢速消费者场景，buffer 大了能平滑更多毛刺。

**调大的代价：**

- buffer 占用的内存 = highWaterMark × 并发流数。100 个并发流 × 1MB = 100MB，光是 buffer 就吃掉这么多。
- Node 的 V8 堆有上限（默认约 1.5GB），buffer 太多会触发 GC 压力甚至 OOM。

**默认 64KB 是个保守值**——对绝大多数应用（HTTP body、文件拷贝）够用，内存占用可控。

我们的视频转码场景会显式调大：

```typescript
const stream = createReadStream('./input.mp4', {
  highWaterMark: 1024 * 1024,  // 1MB，因为视频是大块顺序读写，调大能减少 syscall
});
```

**但有个反直觉的点**：highWaterMark 调大不一定让整体更快。因为瓶颈往往不在流本身，而在下游消费者（FFmpeg 转码、网络上传）。消费者慢，buffer 再大也是堆积。所以**调 highWaterMark 前先 profile 瓶颈在哪**——如果下游是瓶颈，调 buffer 无效，反而浪费内存。

---

**🎤 面试官继续追问**

> 你们视频转码是长任务，可能跑几分钟。如果转码中途用户取消、或者服务重启，怎么保证不留垃圾文件、不卡住？

**🙋 候选人回答**

**这是个真实的工程问题，我们处理三件事：取消、清理、超时。**

**① 取消传播（AbortSignal）**

```typescript
async function transcodeVideo(inputPath: string, outputPath: string, signal: AbortSignal) {
  const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', 'pipe:1']);

  signal.addEventListener('abort', () => {
    ffmpeg.kill('SIGTERM');  // 用户取消 → 干掉 FFmpeg 进程
  });

  try {
    await pipeline(
      createReadStream(inputPath),
      ffmpeg.stdin,
      { signal },           // pipeline 支持 signal，取消时自动销毁所有流
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      await fs.unlink(outputPath).catch(() => {});  // 清理半成品
    }
    throw err;
  }
}
```

`pipeline` 的第三个参数支持传 `signal`——AbortSignal 触发时自动销毁所有流。这是 Node 15+ 才有的能力，比手动监听 abort 优雅得多。

**② 清理半成品文件**

转码中途挂掉会留下不完整的输出文件。我们的策略：

- **写到临时文件**：输出到 `output.mp4.tmp`，转码成功才 rename 成 `output.mp4`（原子操作）。
- **失败/取消时删 tmp**：catch 块里 unlink 临时文件。
- **进程退出兜底**：`process.on('SIGTERM')` 里清理所有 in-progress 的临时文件（这正好接上 Q15 的优雅关闭）。

**③ 超时控制**

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);  // 5 分钟超时

await transcodeVideo(input, output, controller.signal);
clearTimeout(timer);
```

FFmpeg 卡住（比如输入文件损坏导致 FFmpeg hang）会一直占着进程。超时 AbortSignal 杀掉，避免任务永远不结束。

**这三件事合起来才是生产可用的流式转码**——光会 `pipeline()` 不够，取消/清理/超时才是工程化的部分。

### 🏗 架构分析

**Stream 处理大文件的几种方式**

| 方式 | 内存占用 | 错误处理 | 适用场景 |
|------|----------|----------|----------|
| 全量读入（readFileSync） | O(文件大小) | 简单 | 小文件 |
| `.pipe()` | O(highWaterMark) | 弱（不清理） | 简单链路、脚本 |
| 手动背压循环 | O(highWaterMark) | 完全可控 | 需要精细控制的场景 |
| `pipeline()` | O(highWaterMark) | 强（错误传播+清理） | 生产环境推荐 |

**为什么不用其它方案**

- **全量读入再处理**：500MB 视频直接把 Node 堆吃满，并发几个请求就 OOM。对大文件场景是灾难。
- **`.pipe()`**：背压自动处理没问题，但错误处理弱——中间流挂了不会清理上下游，文件描述符泄漏。生产环境不推荐。
- **Web Stream API（ReadableStream/WritableStream）**：浏览器原生的流 API，Node 16+ 也支持。理念类似但 API 不同，生态（FFmpeg、zlib 集成）不如 Node Stream 成熟，迁移成本高。我们保持用 Node Stream。

**权衡**

- Stream 代码比"全量处理"复杂得多——要处理背压、错误、取消、清理。对一次性小文件用全量读入更简单。
- highWaterMark 是吞吐 vs 内存的权衡，默认 64KB 偏保守，大文件场景可调大但要先 profile 瓶颈。
- 流式调试难——数据是 chunk 流，断点调试不如全量数据直观。靠日志和中间 dump chunk 辅助。

**演进**

- Node Stream 的 API 较老（基于事件），Web Stream API（基于 async iterator）更现代。新项目可评估 Web Stream，但生态集成（FFmpeg/zlib）还要等。
- 大文件处理未来可能上对象存储的分片上传（multipart），配合流式处理实现"边上传边转码"。

### 🎯 面试官真正考察什么

> 不是考"Stream 有几种类型"（那是背书），而是看你**有没有真的处理过大文件**：① 能讲清背压的本质（生产快消费慢导致堆积）和 highWaterMark 机制；② 知道生产环境用 `pipeline()` 而非 `.pipe()`，并能说出原因（错误传播、资源清理）；③ 能把 FFmpeg 这种外部进程接到流里（stdin/stdout 当 Transform）。如果还能讲取消传播（AbortSignal）、清理半成品、超时控制，说明做过生产级的长任务流式处理。

### ❌ 常见错误回答

- **背概念**："Stream 有 Readable/Writable/Duplex/Transform 四种"——背类型但不讲背压和 highWaterMark，没回答核心。
- **说不清背压**："背压就是压力太大"——讲不清"生产快消费慢导致 buffer 堆积"，也说不出 highWaterMark 和 drain 机制。
- **只会 .pipe()**：不知道 `.pipe()` 错误处理的缺陷，不知道 `pipeline()` 的存在，生产环境埋雷。
- **忽视工程细节**：只讲流式读取不讲取消、清理、超时——做不出生产可用的长任务处理。

### ✅ 推荐回答

> Stream 三种类型：Readable（来源）、Writable（去处）、Transform（转换）。处理大文件用流式而非全量读入——500MB 视频一次性读进内存 Node 进程直接 OOM，流式内存占用只有 highWaterMark（默认 64KB）。背压本质是生产快消费慢导致 buffer 堆积，Node 用 highWaterMark 机制解决——buffer 超水位暂停读，drain 后恢复。`.pipe()` 内部自动处理背压但错误处理弱（中间流挂不清理、fd 泄漏），生产环境用 `pipeline()`（错误传播+资源清理+Promise 化）。视频转码场景：FFmpeg 的 stdin/stdout 本身就是 Writable/Readable，用 pipeline 把 createReadStream→ffmpeg.stdin、ffmpeg.stdout→createWriteStream 串起来，背压自动调节，全程内存恒定。highWaterMark 调大（如 1MB）能提高吞吐但增加内存，调前先 profile 瓶颈——下游是瓶颈时调 buffer 无效。长任务还要处理取消（AbortSignal + pipeline 第三参）、清理（写 .tmp 成功后 rename、失败 unlink）、超时。

### 📚 延伸知识

- **Web Stream API**：WHATWG 标准的流 API（`ReadableStream`/`WritableStream`），基于 async iterator，比 Node Stream 更现代。Node 16+ 全局可用，未来趋势。
- **objectMode**：Stream 可以处理非字节对象（如一行行 JSON），此时 highWaterMark 是对象数而非字节数。
- **fluent-ffmpeg**：Node 调用 FFmpeg 的封装库，把 spawn + stdin/stdout 管道封装成流式 API，是 Node 生态处理视频的主流方案。

---

## Q14. worker_threads vs child_process vs 集群怎么选？

**🎤 面试官**

> Node 单线程，遇到 CPU 密集任务大家都说"开 worker"。但 worker_threads、child_process、cluster 都能"开 worker"，到底什么时候用哪个？你们项目里怎么选的？

**🙋 候选人回答**

**先一句话区分：worker_threads 是"开线程跑 JS"、child_process 是"开进程跑任意程序"、cluster 是"多核跑 HTTP 服务"。三者解决的问题不同。**

| 方案 | 单位 | 通信方式 | 能否共享内存 | 典型场景 |
|------|------|----------|--------------|----------|
| worker_threads | 线程 | MessagePort（结构化克隆） | 能（SharedArrayBuffer） | CPU 密集的 JS 计算 |
| child_process | 进程 | stdout/stdin/IPC（序列化） | 不能 | 调用外部程序、跨语言 |
| cluster | 进程 | IPC | 不能 | 多核利用、HTTP 负载均衡 |

**① worker_threads：CPU 密集的纯 JS 任务**

worker_threads 在**独立线程**里跑 JS，不阻塞主线程的事件循环（本章 Q14 讲过）。典型场景：

- 大 JSON 文件解析（几百 MB 的 AI 返回结果）。
- 加密/压缩计算（自定义算法，非 zlib 这种原生模块）。
- 图像处理（如果用纯 JS 库，不如调外部程序，见下）。

```typescript
import { Worker } from 'worker_threads';

const worker = new Worker('./heavy-compute.js', { workerData: input });
worker.on('message', (result) => console.log(result));
```

**优势**：线程比进程轻量，启动快；可以用 `SharedArrayBuffer` 共享内存（省去序列化开销）。

**劣势**：仍然跑在同一个 Node 进程里，共享 V8 实例；不是所有原生模块都兼容；通信靠序列化，大数据传输慢（除非用 SharedArrayBuffer）。

**② child_process：调用外部程序或跨语言**

child_process 开一个**独立的操作系统进程**，可以跑任意可执行文件——Python、Go 二进制、shell 命令、FFmpeg。

```typescript
import { spawn } from 'child_process';

// 调 Python 脚本做 AI 推理
const py = spawn('python3', ['inference.py']);
py.stdin.write(JSON.stringify(input));
py.stdout.on('data', (chunk) => { /* 解析结果 */ });
```

**这正是我们架构里的关键设计**：

- **Python Worker 用 child_process（Python 侧叫 subprocess）调用**——我们的 Bridge Worker（Node→Python）本质就是 Node 进程通过 child_process 启 Python 子进程，靠 Redis 队列传消息。AI 推理、FFmpeg 视频合成这些重活在 Python 进程里跑，完全不阻塞 Node 主线程。
- **FFmpeg 直接 spawn**——视频转码不需要写 Node 绑定，直接 child_process 调 FFmpeg 二进制（Q13 的场景）。

**优势**：彻底隔离（子进程崩了不影响主进程）、能用任何语言/工具、可以利用多核。

**劣势**：进程比线程重（启动慢、内存开销大）、通信靠 stdout/stdin/IPC 序列化、没有共享内存。

**③ cluster：多核扩展 HTTP 服务**

cluster 让多个 Node 进程**共享同一个端口**，由主进程把连接分发给子进程。解决的是"Node 单进程利用不满多核"的问题。

```typescript
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  for (let i = 0; i < os.cpus().length; i++) cluster.fork();
} else {
  // 每个 worker 跑一个 HTTP 服务，共享端口
  app.listen(3000);
}
```

**但我们在容器化部署里不用 cluster**（本章 Q9 讲过）——每个容器一个 Node 进程，靠 K8s 多副本利用多核。cluster 和 K8s 多副本职责重叠，容器里再开 cluster 反而干扰扩缩容。

**cluster 主要用在传统单机部署（配合 PM2）**，云原生场景被 K8s 多副本替代。

**④ 我们的选型逻辑**

```
任务类型？
├─ 纯 JS 的 CPU 计算 → worker_threads（轻量、可共享内存）
├─ 调用外部程序/跨语言 → child_process（隔离、灵活）
│   ├─ FFmpeg 视频转码 → spawn('ffmpeg')
│   └─ Python AI 推理 → Python Worker（subprocess）
└─ 多核扩展 HTTP 服务 → cluster 或 K8s 多副本（我们用后者）
```

**核心原则：按"任务性质"选，不按"哪个高级"选。** 很多人觉得 worker_threads 比 child_process"先进"就什么都用 worker_threads——调 FFmpeg 你没法用 worker_threads（FFmpeg 是外部二进制），调 Python 也没法用（Python 是另一个运行时）。工具对应场景。

---

**🎤 面试官追问**

> 你们 BullMQ Worker 是单进程跑多个 job，还是多进程？为什么这么设计？

**🙋 候选人回答**

**我们的 BullMQ Worker 是"单进程 + 进程内并发"，不是每个 job 开一个进程。** 原因要从 BullMQ 的并发模型说起。

BullMQ 的 Worker 有个 `concurrency` 参数：

```typescript
import { Worker } from 'bullmq';

new Worker('video-queue', async (job) => {
  await processVideo(job.data);
}, { concurrency: 20 });  // 进程内并发 20 个 job
```

`concurrency=20` 意味着这个 Node 进程同时处理 20 个 job，靠事件循环切换（因为这些 job 大部分时间在 await I/O——等 FFmpeg、等网络、等 DB）。

**为什么不开多进程？**

- **大部分 job 是 I/O 密集**——等 FFmpeg 转码、等 AI API 响应、等 DB 写入。事件循环在 await 期间可以处理其他 job，单进程并发 20 完全够用。
- **开多进程的代价大**——每个进程独立的 V8 实例（内存开销 100MB+）、进程间通信要序列化、进程管理复杂。

**什么时候才开多进程？**

- **job 内有 CPU 密集的纯 JS 计算**——会阻塞事件循环，影响其他 19 个 job。这时把 CPU 密集部分扔进 worker_threads，而不是开多进程。
- **job 调用外部程序**——本来就是 child_process（spawn FFmpeg），子进程独立，不影响 BullMQ Worker 进程。
- **要利用多核**——靠 K8s 多副本（多开几个 Pod），而不是单 Pod 内开 cluster。

**所以我们的架构是：每个 Pod 一个 BullMQ Worker 进程，进程内 concurrency=20，CPU 密集扔 worker_threads，外部程序用 child_process，多核靠 K8s 多副本。** 各司其职，不混用。

---

**🎤 面试官继续追问**

> worker_threads 说能共享内存（SharedArrayBuffer），你们用过吗？有什么坑？

**🙋 候选人回答**

**用过，但很谨慎。SharedArrayBuffer 的坑在于"并发原语"和"安全限制"。**

**基本用法：**

```typescript
// 主线程
const shared = new SharedArrayBuffer(1024 * 1024);  // 1MB 共享内存
const view = new Int32Array(shared);
const worker = new Worker('./worker.js', { workerData: shared });

// worker.js
const view = new Int32Array(workerData);
view[0] = 42;  // 直接写共享内存，主线程能立刻看到，无需序列化
```

**优势**：大数据（如图像像素、数值数组）无需序列化传输，性能极高。

**坑一：需要并发控制**

共享内存 = 多线程同时读写 = 数据竞争。要用 `Atomics` 做同步：

```typescript
Atomics.store(view, 0, 42);        // 原子写
const val = Atomics.load(view, 0); // 原子读
Atomics.wait(view, 0, 0);          // 等待（类似 condition variable）
Atomics.notify(view, 0, 1);        // 唤醒
```

这等于在 JS 里手写多线程同步——复杂、易错，违背 JS "单线程无锁"的心智模型。

**坑二：安全限制（COOP/COEP）**

浏览器里 SharedArrayBuffer 因 Spectre 漏洞被限制，需要设置 `Cross-Origin-Opener-Policy` 和 `Cross-Origin-Embedder-Policy` 头才能用。Node 里没这个限制，但要知道这个背景。

**坑三：只能存二进制**

SharedArrayBuffer 只能存 TypedArray（Int32Array、Float64Array 等），不能存 JS 对象、字符串、Map。要共享对象得自己序列化成二进制。

**我们的实践**：大部分场景用普通的 `postMessage`（结构化克隆）就够了——开销没想象中大，代码简单。只有在传输超大二进制（如视频帧的像素数据、大数值矩阵）且性能确实成瓶颈时，才上 SharedArrayBuffer。**不要为了"共享内存"而用，那是过度设计。**

### 🏗 架构分析

**三种"开 worker"方式的对比**

| 方案 | 并行模型 | 通信成本 | 隔离性 | 典型场景 |
|------|----------|----------|--------|----------|
| worker_threads | 真并行（多线程） | 低（结构化克隆）/ 极低（SharedArrayBuffer） | 弱（同进程） | 纯 JS 的 CPU 计算 |
| child_process | 真并行（多进程） | 高（序列化） | 强（独立进程） | 外部程序、跨语言 |
| cluster | 真并行（多进程） | 高（IPC） | 强（独立进程） | HTTP 多核扩展 |
| K8s 多副本 | 真并行（多机器/多 Pod） | 最高（网络） | 极强 | 生产级横向扩展 |

**为什么不用其它方案**

- **worker_threads 当万能锤**：调 FFmpeg/Python 不能用（它们不是 JS 运行时），纯 I/O 任务不需要（事件循环已够用）。只有"CPU 密集 + 纯 JS"才适合。
- **child_process 当默认选择**：进程开销大（每个 100MB+），频繁创建销毁成本高。纯 JS 计算用 worker_threads 更轻量。
- **cluster 在容器里用**：和 K8s 多副本职责重叠，扩缩容冲突。容器化场景应单进程 + K8s 多副本。

**权衡**

- worker_threads：轻量但要手写并发同步（Atomics），心智负担重；原生模块兼容性有坑。
- child_process：重但隔离好，崩了不影响主进程；通信开销大。
- K8s 多副本：最彻底的扩展（跨机器），但运维复杂、冷启动慢；适合生产，不适合单机开发。

**演进**

- 我们当前：单 Pod 单进程 + BullMQ 进程内并发 + worker_threads（CPU 密集）+ child_process（外部程序）+ K8s 多副本（横向扩展）。
- 未来：若某类 job 量极大，可按队列拆独立 Worker 服务，独立扩缩容（如视频转码 Worker 独立部署、上 GPU）。

### 🎯 面试官真正考察什么

> 考察你**是否真的理解三种方案的定位差异**——很多人只会说"开 worker"，分不清线程和进程、分不清"跑 JS"和"跑外部程序"。重点看：① 能否按任务性质（纯 JS 计算 / 外部程序 / HTTP 扩展）选对方案；② 能否结合项目架构讲（Python Worker 用 child_process、BullMQ 进程内并发、容器化不用 cluster）；③ 对 SharedArrayBuffer 的坑（Atomics、并发同步）有清醒认知，而不是无脑推崇"共享内存"。

### ❌ 常见错误回答

- **混为一谈**："开个 worker 处理就行"——说不清用 worker_threads 还是 child_process，也不知道区别。
- **无脑推崇 worker_threads**："共享内存所以最快"——忽视 Atomics 并发同步的复杂度和原生模块兼容性问题。
- **忽视项目架构**：不知道 Python Worker 本质是 child_process，说不清 BullMQ Worker 的并发模型。
- **容器里推 cluster**：不考虑 K8s 多副本和 cluster 的职责重叠，背了"Node 多核用 cluster"就往上套。

### ✅ 推荐回答

> 三者定位不同：worker_threads 是线程跑 JS（轻量、可 SharedArrayBuffer 共享内存，适合纯 JS 的 CPU 密集）；child_process 是进程跑任意程序（隔离强、能调外部程序/跨语言，我们 Python Worker 本质就是 child_process、FFmpeg 也用 spawn）；cluster 是多进程共享端口做 HTTP 多核扩展（容器化下被 K8s 多副本替代，我们不用）。选型按任务性质：纯 JS CPU 计算→worker_threads，调外部程序/跨语言→child_process，HTTP 多核→cluster 或 K8s 多副本。我们的 BullMQ Worker 是单进程+进程内并发（concurrency=20），因为 job 大部分是 I/O 密集（等 FFmpeg/AI API/DB）事件循环切换够用；CPU 密集扔 worker_threads，外部程序 spawn，多核靠 K8s 多副本。SharedArrayBuffer 坑：要 Atomics 做并发同步（违背 JS 单线程心智模型）、只能存 TypedArray 不能存对象、浏览器有 COOP/COEP 安全限制——大部分场景 postMessage 够了，别过度设计。

### 📚 延伸知识

- **BullMQ concurrency**：Worker 的进程内并发数，默认 1。调大可提高吞吐但要确保 job 不阻塞事件循环（CPU 密集的 job 会拖累其他并发 job）。
- **piscina**：Node 生态的 worker_threads 池化库（类似 Java 的线程池），自动管理 worker 的创建/复用/任务分发，比自己手搓 Worker 池省心。
- **Atomics API**：SharedArrayBuffer 的并发原语（store/load/wait/notify），等价于其他语言的 mutex/condition variable，但更底层。

---

## Q15. 优雅关闭（Graceful Shutdown）怎么实现？

**🎤 面试官**

> 你们的视频生成是长任务，一个 job 可能跑几分钟。K8s 滚动更新时 Pod 会被替换——如果直接 kill，正在跑的视频生成任务就断了。这块你们怎么处理优雅关闭？

**🙋 候选人回答**

**优雅关闭的核心是"收到停止信号后，先停掉新任务、跑完手头任务、再关连接，最后才退出"。对 BullMQ Worker 尤其关键——硬 kill 会丢正在跑的 job。**

**① 为什么不能直接 kill**

K8s 默认行为：删 Pod 时先发 SIGTERM，等 `terminationGracePeriodSeconds`（默认 30 秒）后如果进程还没退出，发 SIGKILL 强杀。

```typescript
// ❌ 不处理 SIGTERM 的后果
const worker = new Worker('video', async (job) => {
  await transcodeVideo(job.data);  // 跑 5 分钟
});

// Pod 被删 → SIGTERM → 进程没监听 → 30 秒后 SIGKILL
// 正在转码的视频 job 直接断了，临时文件残留，用户看到"任务失败"
```

BullMQ 的机制：job 执行中如果 Worker 进程消失，job 会在 `stalledInterval` 后被标记为 stalled，重新分配给其他 Worker 重跑。但**重跑意味着从头开始**——5 分钟的视频转码白跑了。

**② 优雅关闭的标准流程**

```typescript
import { Worker } from 'bullmq';
import { once } from 'events';

let isShuttingDown = false;

const worker = new Worker('video', async (job) => {
  if (isShuttingDown) {
    // 收到关闭信号后不再接新 job（理论上 BullMQ 的 signal 已经处理，这里是双保险）
    throw new Error('Worker is shutting down');
  }
  await transcodeVideo(job.data);
});

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;

  // 第一步：停止接收新 job
  await worker.close(false);  // false = 不等待当前 job，true = 等待

  // 实际上我们要"等待当前 job 完成"，所以用 worker.close() 配合 job 的可中断设计
  // BullMQ 的 worker.close() 会停止获取新 job，但正在执行的 job 会继续

  // 第二步：关闭 DB 连接
  await prisma.$disconnect();

  // 第三步：关闭 Redis 连接
  await redisConnection.quit();

  // 第四步：清理资源（临时文件等）
  await cleanupTempFiles();

  console.log('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

**③ 和 K8s 的配合**

```yaml
# K8s Deployment 配置
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 600  # 10 分钟，给长任务足够时间
      containers:
      - name: worker
        lifecycle:
          preStop:
            exec:
              command: ["node", "drain.js"]  # preStop hook 先触发
```

**关键配置：**

- **`terminationGracePeriodSeconds`**：K8s 等 Pod 退出的时间。默认 30 秒对我们的长任务远远不够（视频转码要几分钟），我们设成 600（10 分钟）。
- **preStop hook**：K8s 删 Pod 时先执行 preStop（在 SIGTERM 之前），可以用来"先把 Pod 从 Service 摘掉"或"主动触发 drain"。

**完整流程时序：**

```
1. K8s 发起滚动更新，要删 Pod
2. K8s 执行 preStop hook（如标记 Pod 不健康）
3. K8s 发 SIGTERM 给 Pod 内进程
4. 进程收到 SIGTERM → worker.close() 停止接新 job
5. 当前正在跑的 job 继续跑完（最多等到 terminationGracePeriodSeconds）
6. job 完成 → 关闭 DB/Redis 连接 → 清理资源
7. 进程退出（exit 0）
8. K8s 删除 Pod，启动新版本 Pod
```

**④ 让 job 支持"中途取消"**

但有个问题：如果 job 跑 30 分钟，而 `terminationGracePeriodSeconds` 设 600（10 分钟）——job 跑不完还是会被强杀。

**更优的方案是让 job 支持"中断点"，配合 BullMQ 的 job 移交：**

```typescript
const worker = new Worker('video', async (job) => {
  // 把长任务拆成多个 step，每个 step 检查是否要退出
  for (const step of steps) {
    if (isShuttingDown) {
      // 把进度存进 job，让下一个 Worker 接着跑
      await job.updateData({ ...job.data, resumeFrom: step.id });
      throw new GracefulExitError('Resumable exit');
    }
    await processStep(step);
  }
});
```

这样即使 Pod 被强杀，job 重跑时能从断点续传，而不是从头开始。我们的视频合成 pipeline 就是这么设计的——每个 step（分镜/图片/配音/合成）的中间结果都存 DB，重跑时跳过已完成的 step。

**⑤ 几个坑**

- **BullMQ 的 `worker.close()`**：默认会等待当前 job 完成。但要注意 `connection` 的引用——`worker.close()` 只关 Worker 用的连接，你手动创建的 Redis 连接（用于其他用途）要单独 `quit()`。
- **HTTP 服务的优雅关闭**：API 层和 Worker 层不同。API 层是用 `server.close()` 停止接受新连接、等已有连接处理完。Worker 层是 `worker.close()` 停止接新 job。
- **进程级兜底**：即使有优雅关闭，也要监听 `uncaughtException` 和 `unhandledRejection`，避免异常导致进程意外退出（本章 Q15 讲过）。

---

**🎤 面试官追问**

> 你说 `terminationGracePeriodSeconds` 设 600 秒。但滚动更新时旧 Pod 要等 10 分钟才退，新版本上线不就慢了？怎么平衡？

**🙋 候选人回答**

**这是优雅关闭的核心矛盾——"让旧任务跑完"和"快速发布新版本"冲突。我们用三个手段平衡。**

**① 按任务类型分队列，分别设置 grace period**

不是所有 Pod 都要等 10 分钟。我们把 Worker 按"任务时长"分队列、分部署：

```yaml
# 短任务 Worker（AI 调用、状态更新，几秒到几十秒）
spec:
  terminationGracePeriodSeconds: 60   # 1 分钟够

# 长任务 Worker（视频合成、批量处理，几分钟到几十分钟）
spec:
  terminationGracePeriodSeconds: 1800  # 30 分钟
```

短任务 Worker 滚动更新快（1 分钟内完成），长任务 Worker 给足时间。**版本发布时短任务先更新，长任务错峰更新**，不影响整体发布速度。

**② MaxUnavailable 控制滚动速度**

```yaml
spec:
  strategy:
    rollingUpdate:
      maxUnavailable: 0      # 不允许减少可用副本数（始终有足够能力接任务）
      maxSurge: 1            # 临时多起 1 个新 Pod
```

`maxUnavailable: 0` + `maxSurge: 1` 意味着：滚动更新时先起新 Pod，新 Pod ready 后再删旧 Pod。期间总副本数只增不减，处理能力不下降。代价是更新时临时多占资源（多 1 个 Pod）。

**③ 真正长任务用"任务可恢复"而非"等任务完成"**

对于动辄几十分钟的任务（如完整视频合成），靠 grace period 等是不现实的——发布一次等半小时，不可接受。

**正确做法是让任务可中断、可恢复**（前面讲的"中断点 + 进度持久化"）。Pod 被删时任务主动退出（不等待），进度存 DB；新 Pod 接手时从断点续跑。

```typescript
// 任务可恢复：进度存 DB，退出时记断点
async function processVideoWithResume(job) {
  const progress = await loadProgress(job.id);  // 从 DB 读已完成到哪
  for (const step of steps) {
    if (progress.completedSteps.includes(step.id)) continue;  // 跳过已完成
    await processStep(step);
    await saveProgress(job.id, step.id);  // 每步完成存 DB
  }
}
```

**这样 grace period 可以设得很短（如 60 秒）**——Pod 被删时任务快速退出（存好进度），新 Pod 接手续跑。发布速度和任务可靠性兼得。

**核心认知：优雅关闭不是"死等任务完成"，而是"保证任务最终会被完成"。** 能等完的等完，等不完的可恢复续跑。

---

**🎤 面试官继续追问**

> 如果进程在优雅关闭过程中卡住了（比如某个 job 一直 hang），怎么办？怎么避免僵尸 Pod？

**🙋 候选人回答**

**必须有"兜底超时"，不能让进程永远卡着。三层防护。**

**① Job 级超时**

BullMQ 支持 job 超时：

```typescript
new Worker('video', async (job) => {
  await transcodeVideo(job.data);
}, {
  // 单个 job 最多跑 30 分钟
});

// 创建 job 时设超时
await queue.add('video', data, {
  timeout: 30 * 60 * 1000,  // 30 分钟
});
```

job 超时会被标记为 failed，不会无限挂着。

**② 关闭流程级超时**

优雅关闭时设一个"软超时"——超过这个时间就强制退出：

```typescript
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}`);
  isShuttingDown = true;

  // 软超时：最多等 50 秒（比 K8s 的 grace period 短，留余量）
  const HARD_EXIT_MS = 50_000;
  const forceExitTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);  // 强制退出，让 K8s 重新调度 job
  }, HARD_EXIT_MS);

  // 尝试优雅关闭
  await worker.close();
  await prisma.$disconnect();
  await redisConnection.quit();

  clearTimeout(forceExitTimer);
  process.exit(0);
}
```

**关键：软超时要短于 K8s 的 `terminationGracePeriodSeconds`。** 这样即使优雅关闭卡住，进程也会在 K8s 发 SIGKILL 前自己退出（exit 1），避免被 SIGKILL 强杀导致的状态不一致。进程 exit 1 后，BullMQ 检测到 Worker 消失，会把 stalled job 重新分配。

**③ stalled job 检测**

即使一切防护都失效（进程被 SIGKILL、机器宕机），BullMQ 还有 stalled 检测兜底：

```typescript
new Worker('video', async (job) => { ... }, {
  stalledInterval: 30_000,      // 每 30 秒检查 stalled
  maxStalledCount: 1,           // 最多重试 1 次
});
```

BullMQ 通过 Redis 心跳判断 Worker 是否还活着。Worker 进程消失后心跳停止，超过 `stalledInterval` job 被标记 stalled，重新分配给其他 Worker。**这是最后一道防线，即使优雅关闭完全失效也能恢复。**

**三层防护总结：Job 超时（单任务不挂死）→ 关闭超时（优雅关闭不卡死）→ stalled 检测（进程崩溃也能恢复）。**

### 🏗 架构分析

**优雅关闭的几个层次**

| 层次 | 机制 | 作用 |
|------|------|------|
| 进程内 | SIGTERM 监听 + worker.close() | 停接新 job、跑完当前 job |
| 资源清理 | DB/Redis disconnect、删临时文件 | 不留泄漏 |
| K8s 配合 | terminationGracePeriodSeconds + preStop | 给足退出时间 |
| 任务可恢复 | 进度持久化 + 断点续传 | 超长任务不依赖 grace period |
| 兜底 | Job 超时 + 关闭超时 + stalled 检测 | 防卡死、防僵尸 |

**为什么不用其它方案**

- **不处理，靠 stalled 重跑**：BullMQ 确实有 stalled 检测能兜底，但重跑是从头开始，5 分钟的视频白跑、临时文件残留。优雅关闭能让大部分 job 平滑完成，只有真正来不及的才走重跑。
- **把 grace period 设得极长（如 1 小时）死等**：发布速度极慢，旧 Pod 占着资源不释放。对长任务正确做法是"可恢复续跑"而非"死等完成"。
- **用 PM2 的 reload 代替 K8s 滚动更新**：单机方案，不具备 K8s 的健康检查、资源调度、多节点能力。容器化场景应交给 K8s。

**权衡**

- `terminationGracePeriodSeconds` 长 → 任务可靠性高，但发布慢、旧 Pod 占资源久。
- 任务可恢复设计 → 开发成本高（每步要存进度），但发布快、可靠性高。值得投入。
- 优雅关闭代码复杂度 → 需要处理信号、超时、资源清理多个环节。但这是长任务服务的标配。

**演进**

- 初期：简单 SIGTERM 处理 + 较长 grace period，靠 stalled 重跑兜底。
- 成熟期：任务可恢复（进度持久化）+ 分队列设 grace period + 滚动策略优化（maxUnavailable: 0）。
- 监控：Prometheus 采集 "graceful shutdown 耗时"、"stalled job 数"、"被强杀的 job 数"，持续优化。

### 🎯 面试官真正考察什么

> 考察你**有没有真的处理过 K8s 上的长任务服务**——重点看：① 是否理解 K8s 删 Pod 的时序（preStop → SIGTERM → grace period → SIGKILL）；② 能否讲清 BullMQ Worker 的优雅关闭（worker.close 停接新 job、等当前 job、关连接）；③ 能否平衡"任务可靠性"和"发布速度"（分队列设 grace period、任务可恢复续跑）；④ 有没有兜底意识（job 超时、关闭超时、stalled 检测三层防护）。如果只讲 SIGTERM 监听，说明没踩过僵尸 Pod、强杀丢任务的坑。

### ❌ 常见错误回答

- **"监听 SIGTERM 然后 process.exit"**：直接退出等于没做优雅关闭，当前 job 直接断。
- **靠 stalled 重跑兜底就不管**：stalled 重跑是从头开始，长任务白跑、临时文件残留，用户体验差。
- **grace period 设得极长死等**：发布速度慢，旧 Pod 占资源。不讲"任务可恢复续跑"的方案。
- **忽视兜底超时**：不设关闭超时、不防 job hang——优雅关闭自己卡死变成僵尸 Pod。
- **分不清 API 层和 Worker 层**：API 层用 server.close() 等连接处理完，Worker 层用 worker.close() 停接 job。混为一谈说明没都做过。

### ✅ 推荐回答

> 优雅关闭核心是"收到停止信号后停接新任务、跑完手头任务、关连接、再退出"。对 BullMQ Worker 尤其关键——硬 kill 会丢正在跑的 job（虽然 stalled 会重跑但从头开始）。流程：监听 SIGTERM → worker.close() 停止接新 job → 等当前 job 完成（或可恢复退出）→ prisma.$disconnect() + redis.quit() → 清理临时文件 → process.exit(0)。K8s 配合：terminationGracePeriodSeconds 设足够长（短任务 60s、长任务 600s+）、preStop hook 先摘流量。平衡发布速度和可靠性：按任务时长分队列分部署设不同 grace period、maxUnavailable:0+maxSurge:1 先起新 Pod、超长任务用"进度持久化+断点续传"让 grace period 可设短。兜底三层：Job 超时（单任务不挂死）、关闭超时（优雅关闭自己卡死时强制 exit 1，短于 grace period 避免 SIGKILL）、stalled 检测（进程崩溃也能恢复）。核心认知：优雅关闭不是死等任务完成，是保证任务最终被完成——能等完等完，等不完可恢复续跑。

### 📚 延伸知识

- **K8s Pod termination 流程**：官方文档详细描述了删 Pod 的时序——preStop hook → SIGTERM → grace period → SIGKILL。理解这个时序是做优雅关闭的基础。
- **BullMQ stalled jobs**：Worker 通过 Redis 心跳保活，心跳停止超过 stalledInterval，job 被标记 stalled 并重新分配。配置 `stalledInterval` 和 `maxStalledCount` 控制行为。
- **server.close()（HTTP 优雅关闭）**：Node 的 http.Server.close() 停止接受新连接但等已有连接处理完。生产环境常配合 `close-all` / `http-terminator` 处理"连接不主动关闭"的边界情况。

---

## 本章总结

第六章 15 道题，结合项目讨论了 Node.js 技术栈的选型和深度问题。核心决策回顾：

| 技术 | 选型理由 | 不足/权衡 |
|------|----------|-----------|
| NestJS | DI+模块化+企业级结构 | 不如 Spring 的 AOP/条件注入 |
| Prisma | 类型安全+迁移管理+DX | 复杂查询用 $queryRaw 补 |
| BullMQ | Node 任务队列+复用 Redis | 编排能力弱于 Temporal |
| PostgreSQL | JSONB+pgvector+MVCC | 需要 VACUUM |
| Fastify | 比 Express 快 2-3x | 第三方库兼容性需测 |
| Stream + pipeline | 大文件流式处理+自动背压 | 调试难、需配合取消/清理/超时 |
| worker_threads/child_process | 按任务性质选型 | 共享内存并发复杂、进程开销大 |
| 优雅关闭 | SIGTERM+可恢复任务+K8s 配合 | 发布速度与可靠性需平衡 |

**核心原则**：技术选型跟着需求走，不是"最好的"而是"最适合的"。Node 的边界（CPU 密集）用 Python 补位。复杂查询用原生 SQL 补 Prisma。每层用最合适的工具，不强求统一。

下一章进入[第七章：Redis](chapter-07-redis.md)——BullMQ 依赖 Redis、缓存设计、Redis 挂了怎么办、为什么 Redis 快、分布式锁。

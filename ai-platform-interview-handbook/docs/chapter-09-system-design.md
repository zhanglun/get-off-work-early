# 第九章 系统设计

> 系统设计题考察的是"从零设计一个系统"的能力。本章的题目不是背答案，而是展示设计思路——需求分析、架构选择、数据模型、扩展性、容错。
>
> 本章共 10 题，每个题是一个完整的系统设计。

---

## Q1. 设计一个 Task Platform

**🎤 面试官**

> 假设你要从零设计一个统一任务调度平台，支持十万级日任务量、多语言 Worker、实时进度推送。给我讲讲你的设计。

**🙋 候选人回答**

这是我的主业项目，我按真实设计来讲。

**① 需求分析**

- 功能：任务创建、调度、执行、状态追踪、进度推送、重试、取消
- 非功能：十万日任务量、多语言 Worker（Node+Python）、99.5% 可用性、任务不丢
- 约束：团队以 Node 为主，已有 Redis 和 PostgreSQL

**② 架构总览**

```
┌─────────────────────────────────────────┐
│              API Layer (NestJS)          │
│   创建任务 / 查状态 / 取消任务             │
└──────────┬──────────────────────────────┘
           │
    ┌──────▼──────┐
    │  BullMQ     │ ← Redis（队列+状态）
    │  Queue      │
    └──────┬──────┘
           │
   ┌───────┼───────┐
   ▼       ▼       ▼
 Node    Node    Bridge Worker
 Worker  Worker  (→Python Worker)
(I/O)    (I/O)   (CPU 密集)
   │       │       │
   └───────┴───────┘
           │
    ┌──────▼──────┐
    │ PG (持久化)  │ ← 状态双写
    │ Redis Pub/Sub│ ← 进度推送
    └─────────────┘
           │
    ┌──────▼──────┐
    │ WS Gateway  │ → 前端
    └─────────────┘
```

**③ 数据模型**

```sql
tasks: id, type, status, payload(jsonb), step_results(jsonb), 
       project_id, priority, attempts, max_retries, 
       created_at, started_at, completed_at, version

token_usage: id, task_id, project_id, provider, model, 
             prompt_tokens, completion_tokens, cost, created_at
```

**④ 核心设计决策**

- 队列：BullMQ（Node 原生+复用 Redis）
- 状态：Redis（快）+ PG 双写（可靠），Redis 挂了 PG 恢复
- Worker：Node I/O 高并发 + Python CPU 低并发，Redis List 桥接
- 推送：WebSocket + Redis Pub/Sub + 独立 Gateway
- 幂等：SET NX 锁 + 检查点 + 业务级 upsert
- 可靠性：Redis 主从+Sentinel + PG 双写 + 恢复脚本

**⑤ 扩展性**

- 水平扩 Worker（K8s HPA：I/O 按队列长度，CPU 按 CPU 使用率）
- Redis 单实例→Cluster（百万级时）
- PG 读写分离（查询走读库）

**完整设计在第四章展开，29 道题覆盖所有细节。**

### 🏗 架构分析

**设计要点**

| 维度 | 决策 |
|------|------|
| 队列 | BullMQ + Redis |
| 状态 | Redis + PG 双写 |
| Worker | Node + Python 混合 |
| 推送 | WebSocket + Pub/Sub |
| 可靠性 | 三层（HA+双写+恢复） |
| 扩展 | K8s HPA + 读写分离 |

**队列选型对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| BullMQ + Redis | Node 原生、复用现有 Redis、API 成熟 | Redis 持久化要配 RDB+AOF | ✅ 选它（团队 Node 为主，已有 Redis） |
| RabbitMQ | 路由能力强、ACK 语义完善 | 引入新组件、运维成本、Node 客户端不如 BullMQ 顺手 | ❌ 过重 |
| Kafka | 吞吐高、日志友好 | 任务调度语义弱（偏流式）、运维重 | ❌ 不匹配十万日任务量级 |
| Temporal | 状态持久化、复杂工作流 | 对简单任务过重 | ❌ 仅 Workflow 引擎用 |

**核心权衡**：状态走 Redis+PG 双写，是"快"与"可靠"的折中——Redis 挂了能用 PG 恢复，但写放大是代价，靠双写脚本和版本号控制一致性。

**未来演进**：百万级任务量时 Redis 单实例→Cluster；查询压力上来后 PG 读写分离；跨地域时考虑活多活调度。

### 🎯 面试官真正考察什么

1. **结构化思考**：能不能从需求（功能/非功能/约束）出发拆解，而不是直接抛一个"BullMQ+Redis"答案。
2. **权衡意识**：队列、状态、Worker 每一个决策都有替代方案，看你知不知道为什么选这个、放弃了什么。
3. **可靠性思维**：任务"不丢"是分布式系统的核心难点，看你有没有双写、死信、崩溃恢复的设计。

### ❌ 常见错误回答

- **直接给结论**："用 BullMQ + Redis 就行"——没有需求分析，没有对比。
- **队列选型不讲理由**：不考虑团队技术栈和现有基础设施，机械背诵"高吞吐用 Kafka"。
- **状态只放 Redis 或只放 PG**：前者挂了丢状态，后者写放大、慢。
- **忽略可靠性**：没有死信、没有 stalled job、没有恢复脚本，任务一崩就丢。

### ✅ 推荐回答

> 需求：十万日任务+多语言 Worker+实时进度+任务不丢。架构：API(NestJS)→BullMQ(Redis 队列)→Worker(Node I/O+Python CPU 桥接)→PG 持久化+Redis Pub/Sub 推送→WS Gateway→前端。数据模型：tasks(id/status/payload/step_results/priority/attempts/version)+token_usage。核心决策：BullMQ 选型（Node 原生+复用 Redis）、Redis+PG 双写（快+可靠 Redis 挂了 PG 恢复）、Node+Python 混合（I/O 高并发+CPU 低并发 Redis List 桥接）、WebSocket+Pub/Sub+独立 Gateway（连接层业务层解耦）、幂等三层（SET NX 锁+检查点+upsert）、可靠性三层（Redis HA+PG 双写+恢复脚本）。扩展：K8s HPA（I/O 按队列/CPU 按使用率）+Redis Cluster（百万级）+PG 读写分离。完整设计在第四章 29 题展开。

### 📚 延伸知识

- **完整设计**：见[第四章 Task Platform](chapter-04-task-platform.md)，29 道题覆盖状态机、Worker、取消、重试、幂等、监控告警等全部细节。
- **BullMQ 官方文档**：重点理解 stalled job、repeatable job、rate limiter、flows（子任务编排）。
- **Redis 持久化**：RDB（快照）vs AOF（追加日志），生产建议 RDB+AOF 混用。
- **同类系统**：Celery（Python 生态）、Temporal（持久化工作流）、AWS SQS（托管队列），可对比学习取舍。

---

## Q2. 设计一个 AI Platform

**🎤 面试官**

> 设计一个统一的 AI 调用平台，支持多 Provider、Token 计费、Prompt 管理、限流降级。

**🙋 候选人回答**

**① 需求分析**

- 多 Provider：OpenAI/Claude/通义/Gemini，可动态加
- Token 计费：按项目/模型统计成本，配额限制
- Prompt 管理：版本管理、热更新、A/B 测试
- 限流降级：Provider 挂了自动切备用
- 安全：Key 集中管理、数据分级

**② 架构**

```
业务方 → SDK/HTTP API → AI Platform
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Provider         Prompt         Token
    Registry         Manager        Tracker
    (路由+熔断)       (版本+A/B)      (计费+配额)
          │              │              │
          ▼              ▼              ▼
    OpenAI/Claude    PG(prompts)    PG(token_usage)
    /通义/Gemini     Redis(缓存)    Redis(配额)
```

**③ 核心设计**

- Provider 抽象：分层接口（IChatProvider 基础 + IEmbedProvider 扩展），各 Provider 内部转换格式
- 路由：配置驱动（PG 存路由规则 + Redis 缓存 + Pub/Sub 通知变更）
- 熔断：Circuit Breaker（Redis 全局状态）+ fallback Provider
- Prompt 管理：版本+引用锁定+A/B 权重分流+灰度发布
- Token 统计：调用前估算检查预算+调用后对账
- SDK：类型安全（从 Prompt 定义生成 TS 类型）+ 内置重试+流式封装

**完整设计在第五章展开，15 道题覆盖所有细节。**

### 🏗 架构分析

**平台职责分层**

| 模块 | 职责 | 存储 |
|------|------|------|
| Provider Registry | 路由 + 熔断 + 限流 | PG（规则）+ Redis（缓存/熔断状态） |
| Prompt Manager | 版本 + A/B + 灰度 | PG（prompts）+ Redis（缓存） |
| Token Tracker | 计费 + 配额 | PG（token_usage）+ Redis（配额） |

**接入方式对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| SDK | 类型安全（Prompt 定义生成 TS）、内置重试/流式 | 业务方需引入依赖 | ✅ 内部项目首选 |
| HTTP API | 语言无关、零依赖 | 无类型、需自行处理重试 | ✅ 外部/异构接入 |
| 直连 Provider | 无中转开销 | Key 散落、无法统一计费/限流 | ❌ 放弃 |

**核心权衡**：路由配置驱动（PG+Redis 缓存+Pub/Sub 通知）是为了"切换 Provider 不重启"，代价是多了一层配置一致性维护。熔断用 Redis 全局状态是为了多实例共享视图，但 Redis 抖动可能导致误判，需配合半开探测。

**未来演进**：Prompt A/B 灰度成熟后可引入实验平台；Token 计费量大后可拆分时序库（如 ClickHouse）专门存调用流水。

### 🎯 面试官真正考察什么

1. **抽象能力**：能不能把"多 Provider"抽象成分层接口（IChatProvider/IEmbedProvider），而不是一堆 if-else。
2. **权衡意识**：路由动态切换、熔断、Token 计费每一个都有替代方案，看你为什么这么选。
3. **成本与安全意识**：Token 计费和 Key 集中管理是 AI 平台特有的痛点，体现你对 AI 业务的理解。

### ❌ 常见错误回答

- **一上来列 Provider**：OpenAI/Claude/通义…… 但不讲怎么抽象、怎么切换，停在枚举层面。
- **路由写死在代码里**：换 Provider 要改代码重新发版，没有配置驱动。
- **没有熔断/降级**：Provider 挂了全量失败，没有 fallback。
- **忽略成本**：只讲调用不讲计费和配额，AI 平台的核心价值之一就是成本管控。

### ✅ 推荐回答

> 需求：多 Provider+Token 计费+Prompt 管理+限流降级+安全。架构：SDK/HTTP→AI Platform(Provider Registry 路由+熔断 / Prompt Manager 版本+A/B / Token Tracker 计费+配额)→PG+Redis。核心设计：Provider 分层接口（IChatProvider 基础+IEmbedProvider 扩展，各 Provider 内部转换）、路由配置驱动（PG+Redis 缓存+Pub/Sub 变更通知无重启切换）、熔断 Circuit Breaker（Redis 全局状态）+fallback Provider、Prompt 版本+引用锁定+A/B 权重+灰度、Token 调用前估算检查+调用后对账、SDK 类型安全（Prompt 定义生成 TS 类型）+重试+流式。完整设计在第五章 15 题展开。

### 📚 延伸知识

- **完整设计**：见[第五章 AI Platform](chapter-05-ai-platform.md)，15 道题覆盖 Provider 抽象、Prompt 管理、SDK、配置中心、Token 统计等细节。
- **Circuit Breaker 模式**：Martin Fowler 的经典文章，三态 closed/open/half-open 是熔断设计的基础。
- **LiteLLM / LangChain**：业界做多 Provider 抽象的方案，可对比自家分层接口的设计取舍。
- **实验平台**：Prompt A/B 灰度成熟后可演进为完整实验平台（参考 GrowthBook、Optimizely）。

---

## Q3. 设计一个统一 Logger

**🎤 面试官**

> 设计一个支持结构化日志、上下文追踪、多语言、集中收集的日志系统。

**🙋 候选人回答**

**① 需求**

- 结构化：JSON 格式，可检索
- 上下文：requestId/taskId 自动传播
- 多语言：Node + Python
- 集中收集：统一存储和查询

**② 架构**

```
应用（Node/Python）
  → @myorg/logger（统一接口）
  → stdout JSON
  → Filebeat（采集）
  → Elasticsearch（存储+索引）
  → Kibana（查询，按 taskId 过滤）
```

**③ 核心设计**

- 接口统一：`logger.info(event, data)` 在 Node/Python 一致
- 上下文传播：Node 用 AsyncLocalStorage，Python 用 contextvars，跨服务用 HTTP Header（X-Request-Id/X-Task-Id）
- 日志分级：debug/info/warn/error/fatal，error≠业务失败
- 采集：Filebeat 读 stdout，发到 ES
- 查询：Kibana 按 taskId/requestId 检索，串联完整链路

**详细设计在第三章 Q8。**

### 🏗 架构分析

**采集方案对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| ELK（Filebeat+ES+Kibana） | 全文检索强、生态成熟、Kibana 查询友好 | ES 资源消耗大 | ✅ 选它（检索+查询需求强） |
| Loki + Grafana | 轻量、只索引标签、成本低 | 全文检索弱 | ❌ 日志量不大时收益不明显 |
| 云厂商日志服务（CloudWatch/SLS） | 免运维 | 锁定厂商、跨云迁移难 | ❌ 私有部署场景不适用 |
| 应用直写 ES | 少一层 Filebeat | 应用耦合存储、网络抖动直接拖累业务 | ❌ 解耦更稳 |

**核心权衡**：应用只往 stdout 写 JSON，采集交给 Filebeat——业务与存储解耦，换存储后端不动应用代码。代价是多一跳延迟，但日志不要求毫秒级实时。

**上下文传播**是难点：Node 用 AsyncLocalStorage、Python 用 contextvars，跨服务靠 HTTP Header（X-Request-Id/X-Task-Id）透传，这样任意一条日志都能按 taskId 串出完整链路。

**未来演进**：日志量上来后可引入冷热分层（热数据 ES，冷数据归档对象存储）+ 采样降本。

### 🎯 面试官真正考察什么

1. **上下文追踪的理解**：会不会只讲"打 JSON"而忽略 requestId/taskId 的全链路传播——这才是分布式日志的核心价值。
2. **解耦思维**：业务代码直接写 ES 是典型反模式，看你懂不懂"应用只管写 stdout，采集交给 sidecar"。
3. **工程取舍**：ELK 资源消耗大、Loki 轻但检索弱，看你能不能根据真实需求选型，而不是背"上 ELK"。

### ❌ 常见错误回答

- **只说"用 ELK"**：不讲上下文传播、不讲采集解耦，停在工具名称。
- **应用直连 ES**：业务和存储强耦合，ES 抖动直接拖垮业务。
- **日志分级不分**：error 满天飞，业务失败也用 error，真正的系统错误被淹没。
- **没有全链路 ID**：每条日志孤立，无法按 taskId 串联，排障全靠肉眼 grep。

### ✅ 推荐回答

> 需求：结构化 JSON+上下文追踪+多语言+集中收集。架构：应用→@myorg/logger 统一接口→stdout JSON→Filebeat 采集→Elasticsearch 存储→Kibana 查询。核心：接口统一（logger.info(event,data) Node/Python 一致）、上下文传播（Node AsyncLocalStorage+Python contextvars+跨服务 HTTP Header X-Request-Id/X-Task-Id）、分级（error≠业务失败，业务失败用 info 记 task.failed）、采集 Filebeat 读 stdout 发 ES、查询 Kibana 按 taskId 串联完整链路。

### 📚 延伸知识

- **详细设计**：见[第三章 Q8 统一 Logger](chapter-03-engineering.md)，含接口设计、上下文传播、采样策略的完整展开。
- **OpenTelemetry**：业界标准的可观测性数据协议，Logs/Traces/Metrics 三合一，未来可平滑接入。
- **AsyncLocalStorage / contextvars**：Node 和 Python 各自的异步上下文传递机制，是全链路追踪的语言基础。
- **Loki + Grafana**：若日志量极大且检索需求弱，可考虑这种"只索引标签"的轻量方案替代 ES。

---

## Q4. 设计一个 Workflow 引擎

**🎤 面试官**

> 设计一个支持 DAG 编排、条件分支、并行汇合、失败重试的工作流引擎。

**🙋 候选人回答**

**① 需求**

- DAG 编排：定义任务依赖关系
- 条件分支：根据执行结果选择路径
- 并行汇合：多个分支并行执行，汇合后继续
- 失败处理：重试、降级、中止

**② 数据模型**

```json
{
  "nodes": [
    { "id": "A", "type": "ai_call", "depends_on": [] },
    { "id": "B", "type": "ai_call", "depends_on": ["A"] },
    { "id": "C", "type": "tts", "depends_on": ["A"] },
    { "id": "D", "type": "ffmpeg", "depends_on": ["B", "C"] }
  ],
  "on_failure": { "retry": 3, "fallback": "skip" }
}
```

**③ 执行引擎**

```typescript
class DAGExecutor {
  async execute(dag: DAG): Promise<void> {
    const completed = new Set<string>();
    
    while (completed.size < dag.nodes.length) {
      // 拓扑排序：找依赖已完成的节点
      const ready = dag.nodes.filter(n => 
        !completed.has(n.id) &&
        n.depends_on.every(d => completed.has(d))
      );
      
      // 并行执行就绪节点
      await Promise.all(ready.map(async node => {
        try {
          await this.executeNode(node);
          completed.add(node.id);
        } catch (e) {
          await this.handleFailure(node, e);  // retry/skip/abort
        }
      }));
    }
  }
}
```

**④ 和 Temporal 的对比**

- 我们的 DAG：轻量、基于 BullMQ、适合简单编排
- Temporal：重量、状态持久化、适合复杂工作流（跨天/human-in-the-loop）
- 选择：简单需求自建，复杂需求 Temporal

**详细设计在第四章 Q15。**

### 🏗 架构分析

**引擎方案对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 自建 DAG（基于 BullMQ） | 轻量、复用现有基础设施、可控 | 状态/恢复要自己实现，复杂场景易踩坑 | ✅ 简单编排选它 |
| Temporal | 状态持久化、长事务、human-in-the-loop、SDK 成熟 | 引入新组件、学习曲线、运维成本 | ✅ 复杂工作流选它 |
| Airflow | 数据工程生态强、DAG 成熟 | Python 重、定时调度导向、偏批处理 | ❌ 不匹配实时编排 |
| 状态机库（XState） | 前端友好、可视化 | 偏单机、无分布式编排能力 | ❌ 仅 UI 层用 |

**核心权衡**：自建 DAG 的本质是"拓扑排序 + Promise.all 并行 + 失败策略"，胜在轻量，败在状态持久化与跨天恢复——这正是 Temporal 的强项。判据是：工作流是否跨天、是否需要人工介入、是否需要完整可重放历史。

**容错设计**：失败策略 retry N 次→fallback 跳过→abort 中止，配合步骤级检查点（每步完成落库）实现"从最后成功步骤恢复"。

**未来演进**：简单编排先用自建 DAG，一旦出现跨天工作流或 human-in-the-loop 需求，立即迁移到 Temporal，不要硬撑。

### 🎯 面试官真正考察什么

1. **DAG 理解**：会不会实现拓扑排序 + 并行汇合，而不是用一堆 if/else 串行写。
2. **选型判断**：自建 vs Temporal vs Airflow 的取舍——看你知不知道什么时候该"不自己造轮子"。
3. **容错思维**：失败重试、降级、中止三档策略，以及检查点恢复——工作流引擎的核心难点。

### ❌ 常见错误回答

- **没有 DAG，纯 if/else 串行**：无法并行汇合，扩展性差。
- **一律上 Temporal/Airflow**：不分场景，简单编排也上重量级引擎，过度工程化。
- **失败就整体重来**：没有步骤级检查点，一个长流程失败从头跑，浪费成本。
- **不支持成环却不检测**：DAG 允许成环会导致死循环，必须校验无环。

### ✅ 推荐回答

> 需求：DAG 编排+条件分支+并行汇合+失败重试。数据模型：JSON 定义 nodes（id/type/depends_on）+ on_failure 策略。执行引擎：拓扑排序找依赖已完成的就绪节点→Promise.all 并行执行→失败按策略处理（retry N 次/skip+fallback/abort）。条件分支用 condition 节点选路径但不成环。和 Temporal 对比：我们轻量基于 BullMQ 适合简单编排，Temporal 重量状态持久化适合复杂工作流（跨天/human-in-the-loop）。选择：简单自建复杂用 Temporal。详细在第四章 Q15。

### 📚 延伸知识

- **详细设计**：见[第四章 Q15 Workflow 引擎](chapter-04-task-platform.md)，含 DAG 定义、执行引擎、失败策略的完整展开。
- **Temporal**：持久化工作流引擎的代表，核心概念是 Workflow/Activity，状态机由框架托管，跨天/重试/补偿开箱即用。
- **拓扑排序**：DAG 调度的算法基础，Kahn 算法或 DFS 检测环。
- **Checkpoints in Spark/Flink**：大数据框架的检查点机制，与工作流引擎的步骤级检查点是同一思想。

---

## Q5. 设计一个 API Gateway

**🎤 面试官**

> 设计一个 API Gateway，支持路由、鉴权、限流、熔断。

**🙋 候选人回答**

**① 功能**

- 路由：请求转发到后端服务
- 鉴权：验证 API Key/JWT
- 限流：按 IP/用户/项目限流
- 熔断：后端挂了快速失败
- 日志：记录请求/响应

**② 架构**

```
客户端 → API Gateway
           ├── 鉴权（验证 API Key → 项目归属）
           ├── 限流（Redis 令牌桶，按项目）
           ├── 路由（根据路径转发）
           ├── 熔断（Circuit Breaker，按后端服务）
           └── 日志（记录请求/响应/耗时）
                 ↓
           后端服务 A / B / C
```

**③ 关键设计**

- 限流：Redis 令牌桶（全局共享），按 Project 分配配额
- 熔断：按后端服务维度，连续失败 open 状态快速失败
- 路由：配置驱动（路由规则存 PG，可动态更新）
- 鉴权：API Key → Project 映射，注入到请求 Header 传给后端

**我们当前没有独立 API Gateway**——NestJS 的 Guard/Interceptor 做了鉴权和限流。如果服务拆分（微服务化），会引入独立 Gateway。

### 🏗 架构分析

**部署形态对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| NestJS Guard/Interceptor（现状） | 零额外组件、与业务同进程、开发快 | 与业务耦合、无法独立扩缩、跨多服务难统一 | ✅ 单体阶段选它 |
| 独立 Gateway（Kong/APISIX） | 集中管控、插件生态、独立扩缩 | 引入新组件、运维成本、跨网络一跳延迟 | ✅ 微服务化后选它 |
| Service Mesh（Istio） | sidecar 治理、流量精细 | 极重、学习曲线陡 | ❌ 当前规模不需要 |
| 自研网关 | 完全可控 | 重复造轮子、长期维护负担 | ❌ 除非有特殊诉求 |

**核心权衡**：要不要独立 Gateway 的判据是"服务是否拆分"。单体时把鉴权限流放 Guard/Interceptor 是务实选择；一旦微服务化，鉴权限流会散落各处，必须上独立 Gateway 收敛。这是"延迟不可逆决策"原则的体现——先够用，触发条件到了再演进。

**限流算法**：Redis 令牌桶实现全局共享配额，按 Project 维度分配。令牌桶 vs 漏桶：前者允许突发流量，后者强平滑，按业务特征选。

**容错**：熔断按"后端服务"维度而非全局，避免一个服务故障打挂全部。

### 🎯 面试官真正考察什么

1. **务实选型**：能不能讲清楚"什么时候不需要独立 Gateway"，而不是无脑推 Kong。
2. **限流理解**：令牌桶 vs 漏桶 vs 滑动窗口的差异，以及为什么用 Redis 做全局配额。
3. **演进思维**：从单体 Guard 到独立 Gateway 的触发条件和迁移路径——体现架构演进的判断力。

### ❌ 常见错误回答

- **不管规模一律上 Kong/Istio**：过度工程化，单体阶段引入 Service Mesh 是典型反模式。
- **限流只讲"用 Redis"**：不讲算法（令牌桶/漏桶）、不讲维度（按用户/项目/IP）。
- **熔断全局一刀切**：一个后端挂了全部快速失败，没有按服务隔离。
- **忽略演进**：不会说"现在用 Guard，微服务化后引入 Gateway"，看不出架构判断力。

### ✅ 推荐回答

> 功能：路由+鉴权+限流+熔断+日志。架构：客户端→Gateway（鉴权验证 Key→项目归属 / 限流 Redis 令牌桶按项目 / 路由配置驱动 / 熔断按后端服务维度 / 日志记录请求响应耗时）→后端服务。关键：限流 Redis 令牌桶全局共享按 Project 配额、熔断按后端服务连续失败 open 快速失败、路由配置驱动 PG 存规则可动态更新、鉴权 API Key→Project 映射注入 Header 传后端。当前没有独立 Gateway——NestJS Guard/Interceptor 做了鉴权限流。服务拆分微服务化时引入独立 Gateway。

### 📚 延伸知识

- **Kong / APISIX**：主流开源 API Gateway，基于 Nginx/OpenResty，插件生态丰富，微服务化时的首选。
- **限流算法对比**：令牌桶（允许突发）、漏桶（强平滑）、滑动窗口（精准），Redis + Lua 可实现原子化的令牌桶。
- **Circuit Breaker**：与 AI Platform 的 Provider 熔断同源，按后端服务维度隔离是关键。
- **Service Mesh（Istio）**：当服务数量多、治理需求复杂（金丝雀、流量镜像）时再考虑，当前规模无需引入。

---

## Q6. 设计一个通知系统

**🎤 面试官**

> 设计一个支持多渠道（Slack/邮件/Webhook）、模板化、可靠投递的通知系统。

**🙋 候选人回答**

**① 需求**

- 多渠道：Slack/邮件/Webhook/站内信
- 模板化：通知内容用模板+变量
- 可靠投递：失败重试，不丢通知
- 优先级：紧急通知优先

**② 架构**

```
事件源（Task Platform/AI Platform/监控）
  → 通知 API
  → 通知队列（BullMQ）
  → Channel Worker
    ├── Slack Sender
    ├── Email Sender
    ├── Webhook Sender
    └── In-App Sender
  → 失败重试 / 死信
```

**③ 核心设计**

- 模板：存数据库，变量注入（`{{task_id}}` `{{error_message}}`）
- 渠道抽象：`INotificationChannel { send(message) }`，各渠道实现
- 可靠投递：BullMQ 队列+重试+死信队列
- 优先级：P0 紧急走 Slack+手机推送，P2 走邮件
- 去重：相同事件+相同时间窗口内只发一次（防告警风暴）

**和我们现有告警的关系**：第四章 Q16 的监控告警就是这个通知系统的一部分——告警是通知的一种触发源。

### 🏗 架构分析

**投递可靠性方案对比**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 同步调用渠道 API | 简单 | 渠道抖动直接拖累调用方、失败难重试 | ❌ 生产不可用 |
| BullMQ 队列 + 重试 + 死信 | 异步解耦、可靠重试、故障隔离 | 多一层队列、延迟略增 | ✅ 选它 |
| 直接对接第三方告警平台（PagerDuty） | 功能全 | 付费、定制弱、告警之外渠道少 | ❌ 仅告警场景适用 |

**核心权衡**：走队列是为了把"事件产生"和"渠道投递"解耦——Slack/邮件 API 抖动不应影响 Task Platform 主流程。代价是延迟和需维护死信队列，但对通知这类场景完全可接受。

**渠道抽象**：`INotificationChannel { send(message) }` 统一接口，新增渠道（如飞书、钉钉）只需实现接口，不改业务逻辑。这是"统一接口分化实现"原则的典型应用。

**防告警风暴**：去重靠"相同事件 + 时间窗口只发一次"，否则一次故障可能瞬间刷屏淹没关键信息。

**未来演进**：通知规则复杂后可引入规则引擎（如 CEL）；多渠道协同可做"升级链"（P0 先 Slack，N 分钟无响应升级电话）。

### 🎯 面试官真正考察什么

1. **可靠性思维**：会不会把通知做同步调用导致渠道抖动打挂主流程——这是最常见的坑。
2. **抽象能力**：渠道抽象成统一接口，新增渠道零侵入，体现扩展性设计。
3. **真实痛点意识**：优先级、去重、防告警风暴——这些是生产环境才会踩的坑，体现实战经验。

### ❌ 常见错误回答

- **同步调 Slack/邮件 API**：渠道一抖动，业务请求超时甚至雪崩。
- **没有重试和死信**：失败的通知直接丢，关键告警可能漏发。
- **没有去重**：故障期间一条告警发几十遍，刷屏淹没真正重要的信息。
- **渠道写死**：加一个新渠道要改一堆 if/else，没有抽象。

### ✅ 推荐回答

> 需求：多渠道（Slack/邮件/Webhook/站内）+模板化+可靠投递+优先级。架构：事件源→通知 API→BullMQ 队列→Channel Worker（Slack/Email/Webhook/In-App Sender）→失败重试/死信。核心：模板存 DB 变量注入（{{task_id}}/{{error_message}}）、渠道抽象 INotificationChannel 各实现、可靠投递 BullMQ+重试+死信、优先级 P0 Slack+手机推送 P2 邮件、去重相同事件+时间窗口只发一次防告警风暴。第四章 Q16 的监控告警是通知系统的一部分——告警是通知的一种触发源。

### 📚 延伸知识

- **详细设计**：见[第四章 Q16 监控和告警](chapter-04-task-platform.md)，告警规则、通知渠道、值班升级的完整展开。
- **告警平台**：PagerDuty、Opsgenie 是业界成熟的告警/值班平台，可对比自建通知系统的取舍。
- **Dead Letter Queue**：与 Task Platform 的死信机制同源，"隔离无法处理的消息"是通用模式。
- **规则引擎**：通知规则复杂后可引入 CEL（Google）或 Drools，把规则从代码中抽离。

---

## Q7. 设计一个对象存储抽象层

**🎤 面试官**

> 你们的文件（生成的图片/视频）存在哪？怎么设计存储抽象让本地/S3/MinIO 可切换？

**🙋 候选人回答**

**① 需求**

- 文件上传/下载
- 多后端：本地磁盘（开发）、S3（生产）、MinIO（私有部署）
- 预签名 URL：前端直传/下载，不经过后端
- 抽象层：业务代码不关心后端

**② 接口设计**

```typescript
interface IStorage {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// 实现
class LocalStorage implements IStorage { ... }
class S3Storage implements IStorage { ... }
class MinIOStorage implements IStorage { ... }  // S3 兼容，复用 S3Storage
```

**③ 前端直传**

```
① 前端请求后端：POST /api/storage/presign { filename, contentType }
② 后端调 storage.getSignedUrl() 生成预签名 URL
③ 前端直接 PUT 到预签名 URL（不经过后端，省带宽）
④ 前端通知后端上传完成：POST /api/storage/confirm { key }
```

**为什么不经过后端上传？** 大文件（视频可能几百 MB）经过后端会占带宽和内存。直传到 S3 只传一次，后端只签发 URL 不碰文件内容。

**④ Key 设计**

```
files/{projectId}/{taskId}/{filename}
  例：files/drama/abc-123/frame_001.png
```

按项目+任务组织，便于批量删除（删一个任务的所有文件）和权限控制（按项目隔离）。

### 🏗 架构分析

**后端选型对比**

| 方案 | 场景 | 优点 | 缺点 |
|------|------|------|------|
| 本地磁盘 | 开发/测试 | 零依赖、快 | 单机、不扩展、无冗余 |
| S3 | 云上生产 | 弹性、高可用、生态全 | 付费、锁定厂商 |
| MinIO | 私有部署 | S3 兼容、自托管、可迁移 | 要自己运维高可用 |

**核心权衡**：抽象层 `IStorage` 的价值是"业务代码只依赖接口，靠配置切换后端"——开发用本地、生产用 S3、私有部署用 MinIO，业务零改动。MinIO 兼容 S3 协议，所以直接复用 `S3Storage` 实现，体现"统一接口分化实现"。

**前端直传 vs 后端中转**：

| 方案 | 带宽 | 后端压力 | 复杂度 |
|------|------|----------|--------|
| 后端中转 | 双倍（经后端） | 高（占带宽/内存） | 低 |
| 前端直传预签名 URL | 单倍 | 低（只签 URL） | 中（需预签名+回调确认） |

视频文件几百 MB，中转会占满后端带宽和内存，所以选直传。代价是多一套预签名+确认回调流程，但收益远大于成本。

**Key 设计的考量**：`files/{projectId}/{taskId}/{filename}` 前缀按项目+任务组织，既支持"删一个任务的所有文件"（前缀批量删），又支持按项目做权限隔离（IAM 策略可按前缀授权）。

**未来演进**：量大后可引入 CDN 加速下载、生命周期策略（冷数据归档到便宜存储）、跨区域复制容灾。

### 🎯 面试官真正考察什么

1. **抽象能力**：能不能把存储后端抽象成统一接口，让业务不关心是本地还是 S3——这是平台化思维的体现。
2. **实战权衡**：前端直传 vs 后端中转的取舍，会不会忽略大文件对后端带宽/内存的冲击。
3. **可扩展设计**：Key 设计是否考虑了批量删除、权限隔离等运维诉求，而不只是"能存能取"。

### ❌ 常见错误回答

- **没有抽象层**：业务代码直接调 AWS SDK，换存储要改一堆地方，私有部署没法用。
- **大文件走后端中转**：视频几百 MB 经过后端，带宽和内存吃不消。
- **Key 用随机 UUID 扁平存储**：无法按项目/任务批量管理和权限隔离。
- **没有预签名 URL**：前端拿明文 AK/SK 直传，安全隐患极大。

### ✅ 推荐回答

> 接口 IStorage（upload/download/getSignedUrl/delete），实现 LocalStorage/S3Storage/MinIOStorage（S3 兼容复用 S3Storage）。业务代码依赖接口不关心后端，配置切换。前端直传：前端请求后端签发预签名 URL→前端直接 PUT 到 S3 不经过后端省带宽→完成后通知后端确认。不经过后端因为大文件（视频几百 MB）经过后端占带宽内存。Key 设计 files/{projectId}/{taskId}/{filename} 按项目+任务组织便于批量删除和权限隔离。

### 📚 延伸知识

- **S3 预签名 URL**：AWS 的标准直传机制，签名带过期时间，前端用临时 URL 直传，无需暴露永久凭证。
- **MinIO**：S3 兼容的开源对象存储，私有部署首选，与 `S3Storage` 实现复用是典型的"协议兼容换实现"。
- **CDN + 生命周期策略**：量大后用 CDN 加速热点文件下载、用生命周期策略把冷数据归档到廉价存储层（如 S3 Glacier）。
- **Strangler Pattern**：抽象层让存储后端可渐进替换，与新 Provider 抽象（第五章）是同一思想。

---

## Q8. 设计一个大文件/断点续传上传系统

**🎤 面试官**

> 我们做的是视频生成平台，AI 出的成片动辄几百 MB，用户有时候传一些素材进来也很猛。大文件上传经常失败——网络一抖断点就废了，用户得重头再来。你给我设计一个支持断点续传的大文件上传系统。

**🙋 候选人回答**

这是我亲历过的坑。我们漫剧平台生成的视频，一个成片 200~800MB 是常态，用户上传自己的素材（参考图、配音）也是几百 MB 起步。最早的方案就是 Q7 那套预签名 URL 直传，但发现一个现实问题：移动网络下 500MB 的文件，上传成功率不到 70%，一次中断就全量重来，用户体验非常糟糕。所以我们做了断点续传。

**① 需求分析**

- 功能：大文件分块上传、断点续传、上传进度查询、秒传（去重）、上传完成回调
- 非功能：单文件最大 5GB、弱网下成功率 >95%、断网/刷新/换设备后能续传、上传 24 小时未完成要清理
- 约束：存储用 S3 兼容（MinIO 私有部署 / S3 云上），后端 NestJS，前端 Web + 移动端 H5

**② 架构总览**

```
┌──────────────┐   ① 初始化上传            ┌──────────────┐
│   前端/Web   │ ─────────────────────────▶ │  NestJS API  │
│  分块切片器  │ ◀────── uploadId +          │ /uploads/    │
└──────┬───────┘        chunkUrls[]          │  init        │
       │                                       └──────┬───────┘
       │ ② 每个分块预签名 URL                       │ S3
       │   (CreateMultipartUpload)                 │ CreateMultipart
       ▼                                           │ Upload
┌──────────────┐   ③ PUT chunk straight to S3  ┌────▼─────────┐
│  分块并行    │ ─────────────────────────────▶│   S3 / MinIO  │
│  (并发 3~5)  │ ◀────── ETag per part ────────│  (Multipart)  │
└──────┬───────┘                                └────┬─────────┘
       │ ④ 断网：已传 part ETag 持久化(本地+后端)    │
       │    恢复：调 ListParts 拿已传 part 列表      │
       │ ⑤ 全部 part 上传完                         │
       ▼                                           │
┌──────────────┐   ⑥ Complete / Abort        ┌────▼─────────┐
│  前端合并    │ ─────────────────────────────▶│   S3 合并    │
│  上传 ETags  │                              │  → 成品对象   │
└──────────────┘                              └──────────────┘
       │ ⑦ 通知后端
       ▼
┌──────────────┐
│ NestJS 确认  │ → 落库 files 表（key/size/owner/projectId）
│ + 触发后续   │ → BullMQ：转码/缩略图/水印
└──────────────┘
```

**③ 数据模型**

```sql
uploads: id, user_id, project_id, storage_key, upload_id(=S3 multipart id),
         file_size, chunk_size, chunk_count, status(pending/uploading/completed/aborted/expired),
         content_md5, created_at, expires_at

upload_parts: id, upload_id, part_number, etag, size, uploaded_at
              UNIQUE(upload_id, part_number)
```

`upload_id` 就是 S3 `CreateMultipartUpload` 返回的 ID，必须落库——续传时前端拿它去 `ListParts` 查已传分块。`expires_at` 用于定时清理 24h 未完成的孤儿上传。

**④ 核心流程**

初始化（`POST /uploads/init`）：
1. 后端计算或前端传入 `contentMd5`，先查 `uploads` 表是否已有相同 MD5 → 命中直接返回"秒传成功"
2. 调 S3 `CreateMultipartUpload` 拿 `uploadId`
3. 按 `chunkSize`（默认 8MB）切，为每个 part 生成预签名 URL
4. 落库 `uploads` + 返回 `{ uploadId, chunkUrls, chunkSize }`

续传（`GET /uploads/:id/resume`）：
1. 前端带 `uploadId` 来，后端调 S3 `ListParts` 拿已传 part 列表
2. 前端对比本地记录，只重传缺失的 part
3. 已传 part 的 ETag 跟 S3 对得上就直接跳过

完成（`POST /uploads/:id/complete`）：
1. 前端汇总所有 part 的 `{ partNumber, etag }` 列表
2. 后端调 S3 `CompleteMultipartUpload`
3. 落库 `files`，丢 BullMQ 触发转码

清理：BullMQ 定时任务每小时扫一次 `uploads`，对 `expires_at < now()` 且状态非 completed 的，调 S3 `AbortMultipartUpload`（**这一步很关键**，否则 S3 会持续计费那些未完成的分块）。

**⑤ 关键决策**

- 分块大小 8MB：S3 最小 5MB（除最后一个 part），8MB 平衡并发度和 HTTP 开销；500MB 文件 ≈ 63 个 part，并发 3~5 个 part 上传，弱网下失败也只重传一个 8MB
- 前端本地用 IndexedDB 记录 `{ uploadId, partEtags }`，刷新页面能恢复；后端 `upload_parts` 表做兜底（前端清缓存了也能从 S3 `ListParts` 恢复）
- 秒传：业务文件（用户重复上传同一素材）很常见，MD5 命中直接返回，省一次上传

---

**🎤 面试官追问**

> 弱网下分块上传失败率高，你怎么处理？还有，前端并发上传会不会把 S3 配额或带宽打爆？

**🙋 候选人回答**

失败处理是这套系统的核心。单 part 失败的处理链：先指数退避重试 3 次（1s/2s/4s）→ 还失败就把这个 part 标记 pending，前端跳过它继续传别的 part（不要卡住整体）→ 所有 part 传完后再补传失败的 → 如果某 part 反复失败（比如这个分块本身就是坏的），就 abort 整个 multipart 让用户重选文件。

并发控制我们走"滑动窗口"：默认并发 3，移动端降为 2。用 `p-limit` 这种简单的并发控制器就够，不需要复杂的调度。带宽方面 S3 预签名上传是按请求计费不是按带宽，单客户上传远不到瓶颈；真正要防的是恶意用户大量初始化 multipart 不完成，所以我们在 init 接口做了**每用户每分钟 N 次**的限流（复用 Q9 的限流器），以及 24h 强制 abort 清理。

---

**🎤 面试官继续追问**

> 为什么不直接上 tus 这种现成的断点续传协议？或者让前端走后端中转，后端自己组装不是更可控？

**🙋 候选人回答**

这就是选型权衡。tus 是 HTTP 断点续传的标准协议，生态有 `tusd` 服务端、`tus-js-client` 前端，开箱即用。但我们最终没选它，原因有三：第一，tus 默认是把文件传到 tus server 的本地盘或自定义后端，再由它转存 S3，多一跳中转，带宽翻倍——这恰好是我们想避免的（几百 MB 视频过中转节点很贵）；第二，tus 的续传语义和 S3 Multipart 不是天然对齐，要做适配层反而复杂；第三，团队对 S3 SDK 更熟，运维成本低。

至于后端中转组装：业务上确实"更可控"（能加水印、病毒扫描、内容审核），但**带宽和内存代价不可接受**。500MB 视频走 Node 进程，要么流式处理要么内存爆炸，流式又占满带宽。所以我们的取舍是：**上传链路只做"搬运"，直传 S3；后处理（审核、转码、水印）放到上传完成后的异步队列里做**（BullMQ + FFmpeg Worker）。这符合"快慢分离"——上传是用户等不起的同步路径，后处理是异步路径。

### 🏗 架构分析

**上传方案对比**

| 方案 | 断点续传 | 后端压力 | 弱网成功率 | 运维复杂度 | 结论 |
|------|----------|----------|------------|------------|------|
| 直接 PUT 单个预签名 URL | ❌ | 低 | 低（大文件中断全废） | 低 | ❌ 仅小文件 |
| 后端中转分块 | ✅ | 高（带宽/内存×2） | 中 | 中 | ❌ 几百 MB 文件扛不住 |
| S3 Multipart + 预签名直传 | ✅ | 低（只签 URL） | 高（只重传失败分块） | 中 | ✅ 选它 |
| tus 协议（tusd） | ✅（原生） | 中（中转一跳） | 高 | 中（多一套服务） | ❌ 多一跳中转，与 S3 语义不齐 |

**核心权衡**：选 S3 Multipart 直传，本质是"把搬运交给 S3，把控制权留在后端"。后端只做签发 URL、记录进度、触发后处理，不碰文件字节流。代价是流程比直接 PUT 复杂（init / ListParts / complete 三步），但换来的弱网成功率提升是数量级的。

**分块大小的权衡**：太小（如 1MB）→ part 数量爆炸，HTTP 开销大，S3 的 ListParts/Complete 慢；太大（如 64MB）→ 单 part 失败重传成本高，弱网体验差。8MB 是 S3 最小 5MB 限制之上、兼顾两者的甜点，大文件实测经验值。

**未来演进**：跨地域上传可叠加 S3 Transfer Acceleration（走 CloudFront 边缘节点）；超大文件（>10GB）引入并行 multipart + 分片校验；移动端弱网场景可叠加 QUIC/HTTP3 减少握手开销。

### 🎯 面试官真正考察什么

1. **真实场景意识**：能不能想到"几百 MB 视频在移动网络下传不上去"这个具体痛点，而不是停在"用 S3 存文件"。
2. **断点续传的本质**：分块 + 状态持久化 + 失败重试只重传坏块——会不会只说"分块"而漏掉 `ListParts` 续传和 Abort 清理。
3. **架构权衡**：直传 vs 中转、自建 vs tus 协议、分块大小——每个决策都体现工程判断力。

### ❌ 常见错误回答

- **"用预签名 URL 直传就行了"**：那是 Q7 的小文件方案，几百 MB 文件弱网下中断就全废，没解决断点续传。
- **分块但没续传**：只讲"切成块上传"，不讲失败怎么只重传坏块、不讲 `ListParts` 恢复——半成品。
- **忘了 Abort 清理**：S3 未完成的 multipart 会持续计费，没有定时 abort 清理是真实的账单炸弹。
- **秒传/去重没考虑**：业务上重复上传很常见，MD5 秒传能省一大笔带宽和存储。

### ✅ 推荐回答

> 需求：单文件最大 5GB、弱网成功率 >95%、断网能续传。架构：前端分块切片器 → init 拿 uploadId+S3 multipart+每块预签名 URL → 并发 PUT 直传 S3（并发 3，移动端 2）→ 断网时已传 part 的 ETag 持久化（前端 IndexedDB + 后端 upload_parts 表）→ 恢复时 ListParts 拿已传列表只补缺失块 → Complete 合并 → 通知后端落库触发转码。失败处理：单 part 指数退避 3 次再跳过、整体补传、坏块 abort 重来。清理：每小时扫 expires_at < now() 的 uploads 调 AbortMultipartUpload（否则 S3 持续计费）。秒传：MD5 命中直接返回。分块大小 8MB（S3 最小 5MB+弱网重传成本权衡）。选型对比：直接 PUT 无续传、后端中转带宽内存×2 扛不住、tus 协议多一跳中转——S3 Multipart 直传是搬运交给 S3、控制权留后端的最佳平衡。

### 📚 延伸知识

- **S3 Multipart Upload**：AWS 标准的大文件上传协议，`CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` / `AbortMultipartUpload` 四个 API 是核心。
- **tus 协议**：HTTP 断点续传开放标准（tus.io），`tusd` 是参考实现，适合不能直传 S3 的场景（如自建块存储）。
- **S3 Transfer Acceleration**：跨地域上传加速，走 CloudFront 边缘节点，跨国上传大文件时收益明显。
- **Content-Range / ETag**：HTTP 分块上传的字段基础，理解 ETag 的弱校验语义对续传校验很关键。

---

## Q9. 设计一个分布式限流器

**🎤 面试官**

> 你的 AI 平台对外提供 API，有免费用户也有付费大客户，免费用户一天能调几百次、付费用户配额高得多。多台机器部署时，怎么设计一个精准的限流器？

**🙋 候选人回答**

这是我们 AI Platform 真实的场景。第五章那套 Provider 路由后面就挂着限流——既要防下游 LLM Provider 把我们打爆（按 Provider 维度限流），也要防上游用户薅羊毛（按用户/API Key 维度限流）。单体时我用 NestJS Guard + 内存计数凑合过，一旦多实例部署，内存计数就不准了——同一用户分散打到不同实例，每个实例都觉得自己没超限。所以必须做分布式限流。

**① 需求分析**

- 功能：按多维度限流（用户 / API Key / IP / 项目）、多档配额（免费/付费/企业）、突发流量允许、平滑限流
- 非功能：多实例共享计数（精准）、低延迟（<5ms）、限流器自身不能成为单点
- 约束：已有 Redis（BullMQ 在用），团队 Node 为主

**② 架构总览**

```
┌──────────────┐   请求带 userId / apiKey
│  NestJS App  │ ──────┐
│  (多实例)    │       │ 每实例都走同一份 Lua
└──────────────┘       ▼
                 ┌──────────────┐
                 │   Redis      │  ← 原子 Lua 脚本
                 │  (计数/桶)    │     KEYS = limiter:{维度}:{id}
                 └──────────────┘     ARGV = 容量、补充速率、now
                        ▲
                        │ 全局共享视图
                 ┌──────┴───────┐
                 │ 所有实例看到 │  → 限流判定一致
                 │ 同一份计数    │
                 └──────────────┘
```

**③ 算法选择：令牌桶**

为什么选令牌桶？AI 调用的特点是**有突发**——用户 batch 处理一批数据时会短时间打十几个请求，但平均频率不高。令牌桶允许突发（桶里攒着令牌就放行），又能在长时间维度上限制平均速率（按速率补充）。漏桶会把突发强制抹平，体验差；滑动窗口虽然精确但内存开销大。

**④ 核心实现：Redis + Lua 保证原子性**

这是整个设计的关键。限流判定是"读计数 + 判断 + 写计数"三步，多实例并发下如果不是原子的，就会出现超卖。Redis 单线程模型 + Lua 脚本保证这三步在一次执行中不可被打断：

```lua
-- KEYS[1] = limiter:user:123
-- ARGV[1] = capacity(桶容量)
-- ARGV[2] = refill_rate(每秒补充令牌数)
-- ARGV[3] = now(当前毫秒时间戳)
-- ARGV[4] = requested(本次请求需要的令牌，通常 1)

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- 按经过时间补充令牌
local elapsed = math.max(0, now - last_refill) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000) + 1000)

return { allowed, tokens }
```

`now` 时间戳由客户端传入，不是用 Redis 的 `TIME` 命令——因为 `TIME` 会让 Lua 脚本变成非纯函数（replication 环境下有问题），客户端传时间戳更可控（但要处理时钟偏差，见下文）。

**⑤ 多维度限流**

一个请求可能同时受多个维度约束：免费用户每分钟 10 次（user 维度）+ 单 IP 每小时 1000 次（防刷维度）+ 该 Provider 全局每秒 500 次（保护下游）。做法是**多重 Guard 串联**，每个维度一个 key，最严的判定生效。配额档位存 PG（用户 tier），启动时加载到内存 + Redis Pub/Sub 通知变更。

**⑥ 时钟偏差处理**

多实例服务器时钟不可能完全同步，秒级偏差在令牌桶补充计算里会带来误差。我们的做法：
1. 部署 NTP / Chrony 强制对齐，把偏差控制在 50ms 内
2. 令牌补充按"经过时间"算，对几十 ms 偏差不敏感（最多补一两个令牌的误差）
3. 关键场景（计费、配额）以 Redis 的时间为准，业务时间戳仅作参考

### 🏗 架构分析

**算法对比**

| 算法 | 原理 | 突发流量 | 平滑性 | 内存 | 精度 | 适用场景 |
|------|------|----------|--------|------|------|----------|
| 固定窗口 | 每窗口内计数 | ❌ 窗口边界双倍突发 | 差 | 极低 | 低 | 粗粒度限流（如每日上限） |
| 滑动窗口 | 按时间分片加权/按请求时间戳 | ✅ | 好 | 高（存时间戳列表）| 高 | 精确限流、配额计费 |
| 漏桶 | 固定速率出水 | ❌ 强制平滑 | 极好 | 低 | 中 | 流量整形（如下游 QPS 保护） |
| 令牌桶 | 固定速率补令牌，桶有上限 | ✅ 攒令牌允许突发 | 好（平均速率）| 低 | 中 | ✅ API 限流首选 |

**为什么不用其它**：
- 固定窗口：窗口边界（如 59 秒和 01 秒各打满额度）瞬间双倍流量，AI 调用场景会击穿下游配额
- 滑动窗口：精确但 Redis 要存 Sorted Set 的时间戳，内存开销大，AI 调用量级（百万 QPS）扛不住
- 漏桶：把突发强制排队抹平，对 batch 处理用户体验差

**部署形态对比**

| 方案 | 精度 | 延迟 | 容错 | 结论 |
|------|------|------|------|------|
| 单机内存计数 | ❌ 多实例不准 | 极低 | 单点 | ❌ 仅单实例可用 |
| Redis + Lua（中心化） | ✅ 全局一致 | 低（1~3ms） | Redis 挂则降级本地 | ✅ 选它（已有 Redis） |
| 客户端限流（SDK 内嵌） | ❌ 无法防恶意 | 极低 | - | ❌ 防君子不防小人 |
| 令牌服务（独立 Token Service） | ✅ | 中（多一跳） | 高 | ❌ 过度工程化（当前规模） |

**核心权衡**：Redis + Lua 是"精度 vs 延迟 vs 复杂度"的甜点。Redis 挂了怎么办？我们做了**降级策略**：Redis 不可用时，每实例回退到本地内存计数 + 单机配额打八折（宁可放过部分流量也别把业务打挂），等 Redis 恢复再切回。这是限流器自身不能成为单点的关键设计。

**未来演进**：超大规模（亿级用户）时单 Redis 扛不住，可演进为"预分配配额"——每实例定期从 Redis 拉一批令牌到本地，本地用完再批量申请，减少 Redis 压力（类似 Stripe 的 Cell 架构）。

### 🎯 面试官真正考察什么

1. **原子性意识**：会不会漏掉"读-判-写"三步在并发下的原子性问题——这是分布式限流的灵魂。
2. **算法选型**：四种算法的差异，为什么 API 限流常用令牌桶，而不是无脑选滑动窗口。
3. **降级思维**：限流器自身挂了怎么办——很多人答不上来，这是生产系统的硬指标。

### ❌ 常见错误回答

- **"用 NestJS Guard 计数就行"**：多实例部署下内存计数完全不准，这是最典型的坑。
- **算法只说一个**：背"令牌桶"但不讲为什么不用滑动窗口、漏桶，缺乏对比。
- **不讲原子性**：Lua 脚本这一层不提，等于没解决并发超卖问题。
- **没有降级**：Redis 一挂全盘崩，限流器自己成了单点。

### ✅ 推荐回答

> 需求：多维度（user/apiKey/ip/project）多档配额、突发允许、多实例精准。架构：NestJS Guard → Redis + Lua 原子脚本（KEYS=limiter:{维度}:{id}，HMGET 拿桶 tokens+last_refill→按 elapsed 补充→够则扣减 allowed=1→HMSET 回写+PEXPIRE）。算法选令牌桶（AI 调用有突发，桶攒令牌放行+平均速率限制），对比固定窗口（边界双倍突发）、滑动窗口（精确但内存高）、漏桶（强平滑 batch 体验差）。时钟偏差靠 NTP 对齐+按经过时间补充对几十 ms 不敏感。降级：Redis 挂了每实例回退本地计数配额打八折别打挂业务。未来亿级用预分配配额（每实例批量拉令牌到本地）。这是我们 AI Platform Provider 路由后面的限流器。

### 📚 延伸知识

- **Redis Lua + Atomicity**：Redis 单线程模型保证 Lua 脚本执行期间不被中断，是分布式限流/计数器原子操作的基础。
- **Stripe Cell 架构**：超大规模限流的解法，把全局配额切分到 cell（实例组）预分配，减少中心化 Redis 压力。
- **Sentinel / Resilience4j**：业界成熟的限流/熔断库，可对比自研 Lua 方案的取舍（功能全 vs 可控性）。
- **Clock Skew**：分布式系统的经典难题，NTP/Chrony + 业务容忍是工程上的常见折中。

---

## Q10. 设计一个 Feature Flag / 实验平台

**🎤 面试官**

> 你们 AI Platform 第五章讲过 Prompt A/B，本质上就是 feature flag 对吧？我想听你把这套抽象成一个通用的实验平台——支持灰度发布、用户分群、A/B 指标回收。给我讲讲你怎么设计。

**🙋 候选人回答**

对，我们的 Prompt A/B 系统其实就是 feature flag 的一个特化——把"返回哪个 Prompt 版本"当成 flag 的求值结果。但当时只做了 Prompt 一个领域，需求扩散后（模型灰度、UI 实验、付费墙位置测试），我们把它抽象成了通用实验平台。我按这个演进来讲。

**① 需求分析**

- 功能：flag 定义、求值（eval）、定向规则（targeting）、百分比灰度（rollout）、A/B 指标回收、即时开关（kill switch）
- 非功能：求值延迟 <5ms（在请求关键路径）、规则变更 1s 内全集群生效、求值服务自身高可用（挂了业务能跑默认值）
- 约束：已有 PG + Redis + BullMQ，团队 NestJS

**② 架构总览**

```
┌──────────────┐   配置 flag/规则/实验
│  管理后台 UI │ ──────┐
└──────────────┘       ▼
                 ┌──────────────┐
                 │  Admin API   │ → PG(flags/targeting/experiments)
                 └──────┬───────┘ → Redis(全量缓存 + Pub/Sub)
                        │ 变更广播
                        ▼
                 ┌──────────────┐
                 │  Redis Pub   │ ──┐
                 │   /Sub       │   │
                 └──────────────┘   │ 1s 内推到所有 SDK
                                    ▼
┌──────────────┐   eval(flagKey, user)    ┌──────────────┐
│  业务服务    │ ◀──────────────────────── │  本地 SDK    │  ← 内存缓存 flag 快照
│  (NestJS)    │                            │  求值器      │     挂了走默认值
└──────┬───────┘                            └──────────────┘
       │ 命中实验 → 上报 exposure
       ▼
┌──────────────┐   异步队列
│  Events      │ ──────────────▶ BullMQ → PG(raw_events)
│  Collector   │                              │
└──────────────┘                              ▼
                                       ETL 聚合（实验组 × 指标）
                                              ▼
                                       实验报表（显著性检验）
```

**③ 数据模型**

```sql
flags: id, key, type(boolean/number/string/json), enabled, default_value,
       version, updated_at

targeting_rules: id, flag_id, priority, condition(jsonb),
                 value(jsonb)
-- condition 例：{"and":[{"var":"user.country"},"==","CN"],
--                  {"var":"user.tier"},"==","paid"]}

rollouts: id, flag_id, bucket_by(user_id/device_id), percentage,
          seed
-- 百分比灰度：hash(bucket_by + seed) % 100 < percentage

experiments: id, flag_id, name, hypothesis, metrics(jsonb),
             status(running/stopped), start_at, end_at

exposure_events: id, experiment_id, user_id, variant, exposed_at
                 INDEX(experiment_id, variant, exposed_at)

metric_events: id, experiment_id, user_id, metric_name, value, occurred_at
```

**④ 求值逻辑（核心）**

```
eval(flagKey, user):
  1. 从本地缓存拿 flag（SDK 启动时从 Redis 拉全量，Pub/Sub 增量更新）
  2. flag.enabled == false → 返回 default_value
  3. 遍历 targeting_rules（按 priority 排序）：
       命中第一条 → 返回该规则的 value
  4. 若有 rollout：
       bucket = murmurhash(user[flag.bucket_by] + flag.seed) % 100
       bucket < percentage → 返回实验变体
       否则 → 返回 default_value
  5. SDK 挂了/超时/缓存空 → 返回 default_value（fail-open，业务不阻断）
```

定向规则的 condition 用 JSONLogic 之类的表达式引擎求值，支持 `and/or/>/regex` 等组合，业务侧只传 `user` 上下文。百分比灰度的关键是 `bucket_by + seed` 哈希——同一用户每次求值落到同一个桶，不会在 A/B 之间反复横跳；`seed` 用于调整哈希分布（发现分桶倾斜时换 seed）。

**⑤ A/B 指标回收**

1. 用户命中实验变体时，SDK 异步上报 `exposure_event`（含 experiment_id / variant / user_id）到 Events Collector
2. 用户的业务行为（如视频生成成功、付费转化）作为 `metric_event` 上报
3. 后台 ETL 按 `experiment_id × variant` 聚合，对每个指标做显著性检验（t-test / 卡方），输出实验报表
4. 报表给业务看，决策保留哪个变体

**⑥ 和 Prompt 管理的关系**

Prompt A/B 是实验平台的一个特化：
- Prompt 版本 = flag 的一个 string 类型变体
- Prompt 灰度 = flag 的百分比 rollout
- Prompt 效果对比 = 实验平台的 A/B 指标回收（生成质量评分、用户满意度、token 成本）

演进路径是：先把 Prompt A/B 做深（第五章那套），再把 flag 抽象抽出来复用到模型灰度、UI 实验，最后统一成实验平台。不要一上来就建大平台——先有具体场景验证抽象。

---

**🎤 面试官追问**

> 求值在请求关键路径上，延迟怎么保证？还有，SDK 缓存和后台规则变更怎么同步？

**🙋 候选人回答**

延迟这一块：求值在 NestJS 进程内做，纯内存操作（拿 flag 快照 + JSONLogic 求值 + 哈希分桶），P99 在 1ms 以内，不碰网络。关键是**不在请求路径上调 Redis**——SDK 启动时把全量 flag 拉到内存，运行时只读内存。

同步用的是 Redis Pub/Sub：管理后台改规则 → 写 PG → 发 Pub/Sub 消息 → 所有业务实例的 SDK 订阅 → 增量更新本地缓存。正常情况下 1 秒内全集群生效。兜底是每 30s SDK 主动拉一次全量快照（防漏消息）；Pub/Sub 消息丢了，30s 内也会被轮询纠正。

求值服务自身高可用：SDK 设计成**fail-open**——拿不到缓存、求值抛异常、网络全挂，都返回 `default_value`。Feature flag 的语义是"优化"不是"必需"，绝不能因为求值挂了把业务请求打挂。这跟限流器（Q9）的 fail-open 降级是同一思路。

---

**🎤 面试官继续追问**

> 那为什么不直接用 LaunchDarkly 或 Unleash？自建有什么理由？

**🙋 候选人回答**

这是真实的 build vs buy 决策。我们的考量：

**支持自建的理由**：
1. 数据合规——AI 漫剧平台的用户上下文（含 prompt 内容、用户分群）属于敏感数据，不能出私网；LaunchDarkly 是 SaaS，规则和求值上下文要传到它的云上
2. 私有部署交付——部分客户要求整套系统私有化部署，第三方 SaaS 没法打包进去
3. 已有基础设施复用——PG + Redis + BullMQ 都是现成的，自建增量成本不高
4. Prompt 场景特化——通用 feature flag 不懂"Prompt 版本+token 成本+生成质量评分"这套 AI 特有指标，自建能深度集成

**支持买（LaunchDarkly/Unleash）的理由**：
1. 开箱即用的实验统计、报表、SDK 全语言覆盖
2. 不用维护求值引擎、SDK、统计显著性检验这些非业务核心功能
3. 大厂的灰度经验沉淀在产品里（如分桶算法的边角 case）

我们的取舍是：**核心 flag 求值 + Prompt/模型实验场景自建**（因为有数据合规和私有部署硬约束），**统计显著性和高级报表**这种通用能力短期自建、长期评估 Unleash（开源、可私有部署）做替换。这是典型的"核心自建、周边外采"策略。

### 🏗 架构分析

**求值位置对比**

| 方案 | 延迟 | 可用性 | 网络依赖 | 结论 |
|------|------|--------|----------|------|
| 远程求值（每次请求调 flag 服务） | 高（网络往返） | 依赖 flag 服务 | 强 | ❌ 关键路径不可接受 |
| 本地 SDK 求值（内存快照） | 极低（<1ms） | fail-open 走默认值 | 弱（Pub/Sub 增量 + 定期全量） | ✅ 选它 |
| 边车求值（sidecar） | 低 | 中 | 中 | ❌ 过度工程化 |

**build vs buy 对比**

| 方案 | 数据合规 | 私有部署 | 定制化 | 上手速度 | 维护成本 | 结论 |
|------|----------|----------|--------|----------|----------|------|
| 自建 | ✅ 全在私网 | ✅ | ✅ 深度（Prompt 场景） | 慢 | 高（求值/统计/SDK） | ✅ 核心场景选它 |
| LaunchDarkly（SaaS） | ❌ 数据出网 | ❌ | ❌ | 极快 | 低 | ❌ 合规不允许 |
| Unleash（开源，可自托管） | ✅ | ✅ | 中 | 快 | 中 | ✅ 通用能力可评估替换 |
| GrowthBook（开源 A/B） | ✅ | ✅ | 中（偏 A/B 统计） | 快 | 中 | △ 统计报表补充 |

**核心权衡**：求值放本地 SDK 是"延迟 vs 一致性"的取舍——牺牲秒级一致性（Pub/Sub + 30s 全量纠正），换关键路径零网络延迟。规则变更 1s 生效对绝大多数灰度场景够用（kill switch 类紧急场景可缩短到 500ms 或叠加强制刷新接口）。

**分桶算法的坑**：朴素 `user_id % 100` 在 user_id 不均匀（如全是偶数）时会严重倾斜，所以用 `murmurhash(bucket_by + seed) % 100` 摚乱分布，`seed` 还能在线调整修正倾斜。这是实战才会踩的细节。

**未来演进**：实验多了之后做"互斥实验分组"（同一用户不能同时进太多实验，避免干扰）；统计自动化（停止条件、Sample Ratio Mismatch 检测）；和 Prompt 管理（第五章）深度联动，把 Prompt 质量指标自动接入实验报表。

### 🎯 面试官真正考察什么

1. **抽象能力**：能不能看出 Prompt A/B 本质就是 feature flag，并把它泛化成通用平台——这是平台化思维的核心。
2. **关键路径设计**：求值在请求路径上，懂不懂用本地缓存 + Pub/Sub + fail-open 把延迟和可用性问题解决。
3. **build vs buy 的判断**：能不能讲清楚什么时候自建（合规/私有部署/特化）、什么时候外采（通用能力），而不是无脑自建或无脑买。

### ❌ 常见错误回答

- **"就是个配置表，按 flag 查返回值"**：完全没考虑定向规则、百分比灰度、A/B 指标，停在查表层面。
- **求值走远程服务**：每个业务请求都远程调 flag 服务，延迟和可用性双崩。
- **百分比用 `userId % 100`**：user_id 分布不均导致分桶严重倾斜，实验结果失真。
- **不分青红皂白上 LaunchDarkly**：不考虑数据合规和私有部署约束，盲目买 SaaS。

### ✅ 推荐回答

> 需求：flag 求值（<5ms 在关键路径）、定向规则（user 分群）、百分比灰度、A/B 指标回收、kill switch。架构：管理后台→Admin API 写 PG(flags/targeting_rules/rollouts/experiments)+Redis 缓存+Pub/Sub 广播→所有业务实例的本地 SDK 订阅增量更新内存快照（兜底 30s 全量拉取）→业务请求时 SDK 内存求值（flag.enabled→targeting 规则按 priority 命中→rollout murmurhash(user.bucket_by+seed)%100<percentage→命中实验异步上报 exposure）。A/B：SDK 异步上报 exposure+metric 到 Events Collector→BullMQ→PG→ETL 按 experiment×variant 聚合做显著性检验出报表。求值在进程内纯内存 P99<1ms 不碰网络，SDK fail-open 拿不到缓存返回 default_value 业务不阻断。和 Prompt 管理关系：Prompt A/B 是 flag 的 string 变体特化，先做深 Prompt 场景再抽象通用平台。build vs buy：自建因数据合规+私有部署+Prompt 特化，通用统计能力可评估 Unleash 替换。分桶坑：user_id%100 会倾斜，用 murmurhash(bucket_by+seed)。

### 📚 延伸知识

- **LaunchDarkly / Unleash / GrowthBook**：业界主流 feature flag / 实验平台，Unleash 和 GrowthBook 开源可私有部署，适合有合规诉求的场景。
- **JSONLogic / CEL**：规则求值表达式引擎，feature flag 的 targeting 通常用这类引擎而非手写 if/else。
- **A/B 测试统计**：显著性检验（t-test / 卡方）、Sample Ratio Mismatch（SRM）检测、贝叶斯方法——实验平台的统计基石。
- **互斥实验分组（Mutually Exclusive Experiments）**：流量分层技术，避免多个实验互相干扰，是实验平台进阶能力。

---

## 本章总结

第九章 10 道系统设计题。核心是展示设计思路而非背答案。每题遵循：

1. **需求分析**（功能+非功能+约束）
2. **架构总览**（分层图）
3. **核心设计决策**（选型+理由+权衡）
4. **扩展性**（水平扩展+演进路径）

**贯穿所有设计的核心原则：**
- 统一接口分化实现（Provider/Storage/Channel 抽象）
- 快慢分离（Redis 快+PG 可靠）
- 配置驱动（路由/模板/限流动态可变）
- 可观测性优先（日志/Trace/监控是一切的基础）
- 延迟不可逆决策（先够用再演进）

下一章进入[第十章：团队管理](chapter-10-team-management.md)——推动工程化、规范、Code Review、带新人、技术规划、拆需求、平台建设。

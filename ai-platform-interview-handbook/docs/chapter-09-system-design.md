# 第九章 系统设计

> 系统设计题考察的是"从零设计一个系统"的能力。本章的题目不是背答案，而是展示设计思路——需求分析、架构选择、数据模型、扩展性、容错。
>
> 本章共 12 题，每个题是一个完整的系统设计。

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

## Q11. 设计一个 AI 模型推理服务

**🎤 面试官**

> 我们是做 AI 漫剧和视频生成的，文生图、图生视频这些模型一天要跑几十万次推理。GPU 又贵又稀缺，冷启动几十秒、显存动不动就爆。你给我设计一个在线推理服务，要扛得住流量、扛得住模型崩溃，还能平滑灰度新模型。

**🙋 候选人回答**

这是我们 AI Platform 往下延伸的一层——第五章讲的是"调 LLM API 的统一网关"，这题是"自己托管多模态模型（文生图/图生视频）的推理服务"。两个痛点最真实：一是 GPU 利用率，一张 A10/A100 一个月大几千上万，闲着就是烧钱；二是冷启动，图生视频模型加载到显存要 30~60 秒，用户第一个请求等这么久直接超时。我从这两点切入。

**① 需求分析**

- 功能：多模型托管（SDXL/图生视频/后续 LoRA）、模型版本管理与灰度、同步 HTTP 推理 + 异步推理（视频生成走队列）、batch 推理提升吞吐
- 非功能：P99 延迟（文生图 <8s，图生视频异步不卡链路）、GPU 利用率 >70%、单 GPU OOM/崩溃自动恢复、新模型灰度无感
- 约束：GPU 数量有限（先按 8 张卡算）、模型权重单个 4~20GB、Python 推理栈（Torch / Diffusers）、上层调用方是 NestJS 业务层

**② 架构总览**

```
┌──────────────┐  推理请求(带 model_version)   ┌──────────────────┐
│ NestJS 业务层 │ ────────────────────────────▶│  Inference Gateway│
│ (文生图/视频) │                              │  (路由+鉴权+限流) │
└──────────────┘                              └────────┬─────────┘
                                                       │ 按模型版本路由
                                                       ▼
                                              ┌──────────────────┐
                                              │  Dispatch 队列   │  ← asynq(Go)
                                              │ (动态 batch 攒批)│     或 Celery
                                              └────────┬─────────┘
                                                       │
                       ┌───────────────────────────────┼────────────────┐
                       ▼                               ▼                ▼
              ┌────────────────┐              ┌────────────────┐  ┌────────────────┐
              │  GPU Worker A  │              │  GPU Worker B  │  │  GPU Worker C  │
              │ model: sdxl@v2 │              │ model: i2v@v1  │  │ model: sdxl    │
              │ (canary 10%)   │              │ (异步,长任务) │  │  @v1 (stable)  │
              │ 2 个 slot      │              │ 占满整卡       │  │ 4 个 slot      │
              └───────┬────────┘              └───────┬────────┘  └───────┬────────┘
                      │                               │                   │
                      └───────────────┬───────────────┴───────────────────┘
                                      ▼
                              ┌────────────────┐
                              │ Model Registry │  ← 权重存 S3/MinIO
                              │ + 显存调度器   │  ← 哪张卡加载哪个模型
                              └────────────────┘
                                      │
                                      ▼
                              ┌────────────────┐
                              │  指标→Autoscaler│ ← 队列深度/GPU 利用率
                              │  (K8s HPA/自定义)│   → 扩缩 GPU Worker
                              └────────────────┘
```

**③ GPU 调度：模型池 + 预热 + 冷启动治理**

冷启动是体验杀手。我的做法是**常驻模型池 + 预热**：每个模型根据流量配额固定占若干张卡（如文生图主力模型常驻 4 张），权重在 Worker 启动时就加载到显存（warmup），第一个用户请求来的时候不再等加载。冷启动只发生在"扩容新卡"或"切换模型版本"时——这种冷启动我让它**在健康检查通过前不接流量**，K8s readinessProbe 卡住直到 warmup 完成，用户永远不打到没加载完的 Worker。

显存调度器负责"哪张卡放哪个模型"：每个模型声明 `vram_required`（如 SDXL ~8GB，图生视频 ~20GB），调度器按卡剩余显存 bin-pack。一个模型可以分多 slot 占一张卡（小模型并发跑），也可以独占一张卡（大模型），通过配置切换。

**④ 模型版本与金丝雀**

模型版本走 `model@version` 语义（参考 Docker tag）。Registry 存权重 + 元数据，新版本发布流程：权重上传 S3 → 标记 canary → 路由层按权重把 10% 流量切到新版本 → 观察 P99 延迟、失败率、人工抽检生成质量 → 逐步 10%→50%→100%。回滚就是改路由权重，秒级生效。灰度维度按 user_id 哈希分桶（同用户始终命中同一版本，避免同一用户前后效果不一致）。

**⑤ 动态 Batching：吞吐关键**

单个推理请求一次只算一张图，GPU 算力没用满。做法是在 Dispatch 层加一个**动态 batch 攒批器**：请求进来不立刻转发，先等一个短窗口（如 50ms）攒到 N 个同类请求（如 4~8 个），合并成一个 batch 一次性喂给 GPU。这是 NVIDIA Triton 的核心思路，我们用 Go 的 asynq 任务中心做攒批（它能精准控制延迟 vs 吞吐），阈值可配——高峰期窗口拉长攒大 batch 提吞吐，低峰期窗口缩短保延迟。

**⑥ 显存管理：加载/卸载 + OOM 自愈**

显存是稀缺资源。策略：常驻模型不卸载；低频模型用 LRU 淘汰（超过显存阈值时卸载最久没用的）。每个 Worker 有 watchdog 监控显存，逼近上限时拒绝新请求（让调度器路由到别的卡），并触发淘汰。

OOM / 模型崩溃的自愈：Worker 心跳 + CUDA 错误捕获。检测到 OOM 或推理进程挂了 → K8s 重启 Pod → warmup 完成再接流量 → 上层靠重试（asynq 自动重试 + 指数退避）兜住这次失败。关键是要有**熔断**：同一张卡连续 OOM 3 次，把它从调度池摘掉告警，别让坏卡一直接流量。

**⑦ Autoscaling：按队列深度 vs GPU 利用率**

这俩指标我会组合用：**同步推理**（文生图，用户等结果）按 GPU 利用率扩缩（>70% 扩，<30% 缩）；**异步推理**（图生视频，走队列）按队列深度扩缩（堆积超阈值扩卡，避免任务积压）。缩容要冷却时间（如 10 分钟），防止流量波动反复加载/卸载模型——冷启动成本太高，不能频繁缩。

---

**🎤 面试官追问**

> 你说动态 batching 能提吞吐，但如果攒批窗口里一直凑不满 N 个请求，用户不就一直干等？这个延迟和吞吐的矛盾你怎么平衡？

**🙋 候选人回答**

这是个典型的延迟-吞吐权衡，靠"双阈值"解：要么攒够 N 个请求立刻发（吞吐优先），要么等到 max_delay（如 50ms）没攒够也强制发（延迟兜底）。两个条件谁先到触发谁。这样 P99 延迟有上限（max_delay + 单次推理时间），吞吐在高峰期能吃满 batch。

实际配置是动态的：监控队列长度，高峰期 N 调大、max_delay 调长（反正请求多很快攒满，吞吐优先）；低峰期 N 调小、max_delay 调短（保延迟）。我们按模型类型分桶配——文生图快、max_delay 给 50ms；图生视频一次几十秒，max_delay 给 500ms 也无所谓，重点是把 batch 攒大省卡。

---

**🎤 面试官继续追问**

> GPU 这么贵，你提到了常驻模型池。那"每个模型独占几张卡"和"共享 GPU 池按需加载模型"这两种，到底怎么选？还有人说干脆上 serverless GPU，按调用计费，你怎么看？

**🙋 候选人回答**

这三种我正好都评估过，是核心选型。

**独占每模型**：一张卡只跑一个模型，常驻不卸载。优点是延迟稳定（无冷启动）、隔离性好（一个模型 OOM 不影响别的）。缺点是 GPU 利用率低——低频模型占着卡闲着，8 张卡可能只服务了 5 个模型，其余模型没卡用。适合**高频主力模型**（我们文生图主力模型就这么搞）。

**共享 GPU 池**：所有卡是一个池，按需加载/卸载模型，靠显存调度器分配。优点是利用率高（低频模型用时才加载），能托管很多模型。缺点是冷启动痛（加载几十秒）、模型间争抢显存可能互相 OOM。适合**模型多但单个 QPS 不高**的长尾场景。

**Serverless GPU**（如 Modal/Replicate/云厂商）：按调用计费，零运维。优点是没有闲置成本、自动扩缩。缺点是冷启动更狠（连运行时都要拉起，可能几分钟）、单价贵（按调用算比自建贵 2~5 倍）、图生视频这种长任务计费爆炸。适合**流量极不均匀的低频模型**或**PoC 阶段**。

我们的取舍：**主力高频模型独占常驻**（保延迟）、**长尾低频模型走共享池 LRU 加载**（保利用率）、**实验性模型/突发流量用 serverless 兜底**（弹性）。这其实是"热点独占、长尾共享、峰值弹性"的分层策略，跟缓存的多级（L1/L2/CDN）是同一思想。

### 🏗 架构分析

**GPU 调度模式对比**

| 方案 | GPU 利用率 | 冷启动 | 隔离性 | 适用场景 | 结论 |
|------|-----------|--------|--------|----------|------|
| 独占每模型（常驻） | 低（低频模型闲着） | 无（预热好） | 好 | 高频主力模型 | ✅ 主力模型选它 |
| 共享 GPU 池（按需加载） | 高 | 有（加载几十秒） | 差（争显存） | 长尾低频模型 | ✅ 长尾模型选它 |
| Serverless GPU（按调用） | 极高（零闲置） | 极重（连运行时拉起） | 好 | 突发/PoC/低频 | △ 弹性兜底，单价贵 |

**Batching 策略对比**

| 方案 | 吞吐 | 延迟 | 复杂度 | 结论 |
|------|------|------|--------|------|
| 无 batch（一请求一推理） | 低 | 低 | 极低 | ❌ GPU 浪费 |
| 静态 batch（固定攒满 N 才发） | 高 | 不稳定（凑不满就死等） | 低 | ❌ 低峰期卡死 |
| 动态 batch（N 或 max_delay 双阈值） | 高 | 有上限 | 中 | ✅ 选它 |

**核心权衡**：独占 vs 共享本质是"延迟稳定性 vs GPU 利用率"。我们把高频模型独占（延迟优先）、长尾模型共享（利用率优先），是按模型流量画像分层，而不是一刀切。动态 batching 的双阈值是"吞吐 vs 延迟"的工程化解法——不会为了吞吐让用户无限等。

**未来演进**：模型增多后引入显存预热预测（按历史流量曲线提前在高峰前加载低频模型）；多模态融合后支持流水线并行（文生图→图生视频分到两张卡串行）；自建模型仓库 + LoRA 热插拔（基础模型常驻，LoRA 权重按需叠加，省显存）。

### 🎯 面试官真正考察什么

1. **GPU 成本意识**：会不会意识到 GPU 是最贵的资源，讲清楚怎么提高利用率（batching、池化、 autoscale），而不是"加卡就行"。
2. **冷启动治理**：懂不懂 warmup + readinessProbe 不让用户等加载、动态 batch 攒批提吞吐——这是推理服务的工程难点。
3. **分层选型判断**：独占/共享/serverless 三种模式各适用什么场景，能不能按模型流量画像组合使用，而不是只会一种。

### ❌ 常见错误回答

- **"起一堆 Pod 跑模型就行"**：不讲 GPU 调度、不讲 batching、不讲显存管理，GPU 利用率极低，烧钱。
- **忽略冷启动**：用户第一个请求等几十秒加载权重，体验崩盘；没有预热和 readinessProbe。
- **OOM/崩溃无自愈**：模型一崩就持续报错，没有 watchdog、重启、熔断、重试。
- **灰度靠"改配置重发版"**：没有 model@version + 路由权重 + 按用户分桶的金丝雀，新模型一上线全量翻车。

### ✅ 推荐回答

> 需求：多模态模型托管（文生图/图生视频）+版本灰度+同步/异步推理+高 GPU 利用率+模型崩溃自愈。架构：NestJS 业务层→Inference Gateway(路由+鉴权+限流)→Dispatch 队列(动态 batch 攒批)→GPU Worker(常驻模型池)→Model Registry(权重存 S3+显存调度)+Autoscaler。GPU 调度：常驻池+warmup(启动加载权重,readinessProbe 卡住到 warmup 完成用户不等加载)，显存调度器按 vram_required bin-pack。版本灰度：model@version+权重路由 10%→50%→100%+user_id 哈希分桶同用户始终同版本。动态 batching：双阈值(N 攒满或 max_delay 到)高峰调大吞吐优先低峰调小保延迟。显存管理：常驻不卸载+低频 LRU 淘汰+watchdog 逼近上限拒新请求。自愈：心跳+CUDA 错误捕获→K8s 重启 Pod→warmup 完再接流量+asynq 重试兜底+连续 OOM 3 次熔断摘卡告警。Autoscaling：同步按 GPU 利用率异步按队列深度+缩容冷却 10 分钟防反复加载。选型：主力高频模型独占常驻(保延迟)、长尾低频共享池 LRU(保利用率)、突发 serverless 兜底(弹性)——热点独占长尾共享峰值弹性，跟多级缓存同一思想。

### 📚 延伸知识

- **NVIDIA Triton Inference Server**：业界标杆推理服务，动态 batching、多模型调度、TensorRT 加速是它的核心能力，自建推理服务必看。
- **vLLM / TGI**：LLM 推理加速框架，PagedAttention 管理显存分页，思路可迁移到多模态模型的显存管理。
- **LoRA / QLoRA**：基础模型常驻 + 小权重按需叠加，大幅省显存，是托管多 LoRA 变体的关键技巧。
- **CUDA OOM / MIG**：GPU OOM 是推理服务最常见故障；MIG（Multi-Instance GPU）把一张 A100 物理切成多个隔离实例，是独占/共享之外的第三种切分维度。

---

## Q12. 设计一个视频/图片处理流水线

**🎤 面试官**

> 我们 AI 漫剧平台，AI 出来的素材要经过一堆后处理才能交付给用户——转码、抽封面、加水印、过内容审核、拼成最终成片。这套流水线现在是 Python + Celery + FFmpeg 在跑，但量一上来就各种卡：某个环节挂了整条流水线停摆、转码慢得要死、进度用户看不到。你给我重新设计这条流水线。

**🙋 候选人回答**

这是我们 Python 侧的主战场，Celery + FFmpeg 那套。痛点我全踩过：最早是一个大 Celery task 里串行调 FFmpeg，转码完了接抽帧再接水印，任何一个环节抛异常整条任务失败重来，几十分钟的转码白跑。后来我们改成了分阶段 DAG。我从这个演进讲。

**① 需求分析**

- 功能：转码（H.264/H.265/AV1 多档清晰度）、缩略图/封面抽取、水印（图片+文字）、拼接（多段素材合成）、内容审核（鉴黄/鉴暴）、转码后上传 CDN
- 非功能：单任务失败不重来整条（断点续跑）、各阶段可独立扩缩、进度可查（用户看到"转码中 60%"）、单 Worker 资源限住（别一个转码吃满内存 OOM 全家）
- 约束：Python + Celery + FFmpeg（CPU 为主，部分有 NVENC GPU 卡）、素材存 S3/MinIO、上层 NestJS 调度

**② 流水线 DAG 总览**

```
素材上传完成(BullMQ 触发)
        │
        ▼
┌──────────────┐
│ ① 转码       │  FFmpeg CPU/GPU 编码 → 多档清晰度(360p/720p/1080p)
│ (最重,独立池)│  失败→重试3次→死信(不阻塞下游已转码档位)
└──────┬───────┘
       │ 转码完成事件
       ├──────────────────┬──────────────────┐
       ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ ② 抽封面     │   │ ③ 加水印     │   │ ④ 内容审核   │
│ (FFmpeg 抽帧)│   │ (overlay)    │   │ (调审核API)  │
│ 轻量,快      │   │ 依赖转码产物 │   │ 并行,可失败  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┴──────────────────┘
                          │ 全部完成(汇合)
                          ▼
                  ┌──────────────┐
                  │ ⑤ 拼接/合成  │  多段→成片(如有)
                  │ (FFmpeg concat)│
                  └──────┬───────┘
                         ▼
                  ┌──────────────┐
                  │ ⑥ 上传 CDN   │  → 通知 NestJS 交付完成
                  │ + 生成签名URL│
                  └──────────────┘
        │
        ▼ 每阶段上报进度
┌──────────────┐
│ 进度聚合器   │  ← Redis(各阶段状态) → WS 推前端
│ (阶段%加权)  │
└──────────────┘
```

关键点是**各阶段是独立的 Celery task，通过事件（转码完成）触发下游，而不是一个大 task 串行调**。转码产物（720p 文件）落 S3，下游任务拿 S3 key 继续处理，阶段间靠存储解耦，不靠内存传递。

**③ 编码选型：H.264 / H.265 / AV1 + GPU vs CPU**

这是转码阶段的核心决策。我的选型表：

| 编码 | 压缩率 | 编码速度 | 兼容性 | 适用 |
|------|--------|----------|--------|------|
| H.264 | 基准 | 快 | 全平台 | ✅ 默认档（兜底兼容） |
| H.265 (HEVC) | 省 40% | 慢 | iOS/新 Android 好 | ✅ 高清档（省带宽） |
| AV1 | 省 50%+ | 极慢 | 新浏览器 | △ 未来档（生态成熟中） |

实践：**默认出 H.264 保兼容，1080p 高清额外出 H.265 省带宽**，AV1 暂不量产（编码太慢，机器成本扛不住，等硬件编码器普及）。

GPU vs CPU：有 NVENC 卡的 Worker 走 `-c:v h264_nvenc`（速度快 3~5 倍），CPU Worker 走 `libx264`（慢但质量略好、零硬件依赖）。调度器按 Worker 标签（`gpu=true`）路由，GPU 池优先跑高清档，CPU 池跑低清档和抽帧。注意 NVENC 同卡并发会降速（单卡同时编码路数有上限），要做并发限额。

**④ 失败隔离：阶段独立 + 断点续跑**

这是流水线设计的灵魂。原则是**一个阶段失败不让整条流水线废掉**：
- 每个阶段是独立 Celery task，有自己的重试（3 次）和死信队列
- 阶段产物落 S3，失败重试从"上一个成功阶段的产物"继续，不从头跑
- 转码多档清晰度各自独立——720p 失败不影响 360p 已完成
- 内容审核失败（审核 API 抖动）不阻断转码和交付，降级为"人工复审"标记，成片照常出但打待审标签

具体实现：每个任务记录 `stage_results`（JSON，存每阶段产物 key + 状态），重试时读这个字段判断从哪续。

**⑤ 进度跟踪：阶段加权**

用户看"处理中 60%"不能是假的。做法是给每阶段一个权重（转码 50%、抽封面 5%、水印 10%、审核 10%、上传 25%），进度 = Σ(已完成阶段权重 × 100% + 进行中阶段权重 × 阶段内进度)。每阶段 task 上报进度到 Redis（`HSET task:{id}:progress stage percent`），NestJS 侧的进度聚合器加权计算后通过 WS（Q1 那套）推前端。

**⑥ 资源限制：单 Worker 限死**

FFmpeg 是吃资源大户，一个转码能吃满 8 核 + 8GB 内存，不加限制一个 Worker 跑两个转码就 OOM。手段：
- Celery Worker `--concurrency=1` 或 2（单 Worker 同时跑的任务数限死）
- FFmpeg 用 cgroups / K8s resource limits 限 CPU 和内存
- 任务超时（如转码 30 分钟强制 kill，防止卡死任务占 Worker）
- 长 IP/磁盘配额（中间产物走独立临时盘，转码完清理）

---

**🎤 面试官追问**

> 你说各阶段独立 task 靠事件触发，那如果转码完成了、但下游"加水印"的 task 还没被调度（Worker 满了），产物不就一直晾着？这种流水线编排你怎么管？

**🙋 候选人回答**

这正是 Celery 原生的 chord/chain 不够用、我们引入 DAG 编排的原因（第九章 Q4 那套）。Celery 的 `chain` 是把任务串起来，`chord` 是并行+汇合，但组合复杂流水线（并行+串行+条件分支）会很绕，而且它的状态管理在结果后端，大规模下不稳。

我们的做法是**显式 DAG + 事件驱动**：每个阶段完成后往 BullMQ/asynq 发"转码完成"事件，事件里带 task_id 和产物 key，下游阶段订阅自己关心的事件类型触发。编排逻辑（谁依赖谁、汇合点在哪）由一个轻量编排器管理——它本质就是 Q4 的 DAG 执行引擎，记录每个节点的依赖完成情况，依赖全满足就触发下游。

产物晾着不是问题——S3 存储便宜，晾几小时甚至几天都没事。真正要防的是"任务卡在某个状态不前进"，所以有超时监控：某阶段超过预期时长（如转码 30 分钟）还没完成，告警 + 自动 retry 或转人工。

---

**🎤 面试官继续追问**

> 这套流水线，"串行一个 task 干完所有事"、"每阶段并行但无编排"、"DAG 编排"这三种你最终选了 DAG。前两种为什么不行？给我讲透。

**🙋 候选人回答**

三种我都跑过，痛点很具体。

**串行大 task**（最早方案）：一个 Celery task 里依次调 `转码→抽帧→水印→审核→上传`。优点是简单、状态在一个 task 内。致命缺点：**一处失败全盘重来**——转码跑了 20 分钟成功，水印那步抛异常，整个 task 失败重试又从转码开始，20 分钟白烧。还有无法并行（抽帧和水印明明能并行却串着跑）、进度无法细粒度上报（只能上报"task 完成 X%"很粗）。

**每阶段独立 task 但无编排**：拆成多个 task，但靠"前一个 task 末尾手动调 `delay()` 触发下一个"（在代码里硬编码链）。比串行好（失败只重试当前阶段），但并行汇合很难写（"等转码和审核都完成再拼接"这种逻辑手写容易出 bug），而且编排逻辑散在各 task 代码里，改流程要改一堆地方，没有全局视图。

**DAG 编排**：显式定义节点 + 依赖（Q4 那套），编排器统一调度。优点是失败隔离（单节点重试）、天然并行（拓扑排序找就绪节点 Promise.all）、全局可视化（DAG 图能画出来）、流程改动只改 DAG 定义不改 task 代码。缺点是引入编排器（自建或 Temporal），有学习和运维成本。

判据很简单：**流水线阶段少（≤3）且无并行，串行够用；阶段多、有并行汇合、需要可视化运维，上 DAG**。我们漫剧流水线 6 个阶段 + 多处并行，必然上 DAG。

### 🏗 架构分析

**流水线编排模式对比**

| 方案 | 失败隔离 | 并行汇合 | 可视化运维 | 复杂度 | 结论 |
|------|----------|----------|-----------|--------|------|
| 串行大 task（一个 task 全干） | ❌（一处失败全重来） | ❌ | ❌ | 极低 | ❌ 仅简单流水线 |
| 阶段独立 task + 手动链 | △（单阶段重试，但编排散落） | △（手写汇合易 bug） | ❌ | 低 | ❌ 中等复杂度就乱 |
| DAG 编排（显式依赖+事件驱动） | ✅（单节点重试） | ✅（拓扑+并行） | ✅ | 中 | ✅ 选它 |

**编码方案对比**

| 编码 | 压缩率 | 速度 | 兼容性 | 结论 |
|------|--------|------|--------|------|
| H.264 | 基准 | 快 | 全平台 | ✅ 默认档兜底 |
| H.265 | 省 40% | 慢 | iOS/新端好 | ✅ 高清档省带宽 |
| AV1 | 省 50%+ | 极慢 | 生态未成熟 | △ 暂不量产 |

**核心权衡**：DAG 编排 vs 串行，本质是"运维可视性 + 失败隔离" vs "实现简单"。流水线一旦超过 3 个阶段且有并行，串行的失败重来成本（重烧几十分钟转码）会超过引入编排器的成本。我们用自建轻量 DAG（基于 asynq/BullMQ）而非 Temporal，是因为流水线不跨天、无 human-in-the-loop，自建够用（Q4 同一判据）。

**GPU vs CPU 编码的权衡**：NVENC 快 3~5 倍但单卡并发有上限、质量略逊 CPU。我们按清晰度分档路由——高清档（1080p）走 GPU 保速度，低清档（360p）和抽帧走 CPU 保质量。这是"按任务特征路由到合适资源池"的典型应用。

**未来演进**：流水线复杂后引入 DAG 可视化运维台（实时看每个任务卡在哪）；转码弹性用 spot/preemptible 实例降本（可重试任务对中断容忍）；AV1 硬件编码普及后逐步替换 H.265。

### 🎯 面试官真正考察什么

1. **失败隔离思维**：会不会意识到"一处失败全重来"是流水线最大的坑，讲清楚分阶段 + 产物落盘 + 断点续跑——这是实战才会踩的痛。
2. **FFmpeg 工程化**：懂不懂 H.264/H.265/AV1 的取舍、GPU(NVENC) vs CPU 的路由、单 Worker 资源限制——而不是只会"调 FFmpeg 命令"。
3. **编排模式判断**：串行 / 手动链 / DAG 三种各适用什么场景，能不能按流水线复杂度选型，而不是无脑堆 Temporal 或无脑串行。

### ❌ 常见错误回答

- **"写个大 Celery task 串行调 FFmpeg"**：一处失败全盘重来，几十分钟转码白烧，没有失败隔离。
- **编码只说"用 H.264"**：不讲 H.265/AV1 取舍、不讲 GPU NVENC，停留在默认参数。
- **没有资源限制**：FFmpeg 一个转码吃满内存 OOM 全家，Worker `--concurrency` 不设。
- **进度全靠猜**：用户看不到细粒度进度，只能转圈圈；没有阶段加权进度上报。

### ✅ 推荐回答

> 需求：转码(多档清晰度)+抽封面+水印+审核+拼接+上传 CDN，失败不重来整条、各阶段独立扩缩、进度可查、单 Worker 资源限住。架构：上传完成触发→①转码(FFmpeg H.264默认+H.265高清,GPU NVENC池跑高清/CPU池跑低清)→并行②抽帧③水印④审核(汇合)→⑤拼接→⑥上传CDN,各阶段独立 Celery task 靠事件触发下游,产物落 S3 解耦。失败隔离:每阶段独立重试3次+死信,产物落盘失败重试从上一成功阶段续,多档清晰度各自独立,审核失败降级人工复审不阻断交付。进度:阶段加权(转码50%+上传25%等)各 task 上报 Redis→聚合器加权→WS 推前端。资源限制:Worker concurrency 限死+cgroups 限 CPU/内存+任务超时 kill。编排选 DAG(显式依赖+拓扑并行+全局可视化)对比串行大 task(一处失败全重来)和手动链(并行汇合手写易 bug)——阶段>3 且有并行必上 DAG,自建轻量基于 asynq/BullMQ 不上 Temporal(不跨天无 human-in-the-loop)。编码:H.264 默认兜底兼容+H.265 高清省带宽+AV1 暂不量产(编码太慢)。

### 📚 延伸知识

- **FFmpeg 编码器**：`libx264`(CPU H.264) / `libx265`(CPU H.265) / `h264_nvenc`(NVIDIA GPU) / `libsvtav1`(AV1)，参数（CRF 码率控制、preset 速度/质量权衡）是转码调优核心。
- **Celery chord / chain / group**：Celery 原生的任务编排原语，简单流水线够用，复杂 DAG 场景建议上 Q4 的显式编排器或 Temporal。
- **NVENC 并发限制**：消费级 GPU（如 RTX 系列）NVENC 同时编码路数有驱动限制（通常 3~5 路），数据中心卡（A10/A100）限制更宽松，调度时要按卡型号配并发。
- **内容审核**：图片/视频鉴黄鉴暴通常调云端 API（阿里绿网/腾讯天御）或自建模型，流水线中作为并行阶段，失败降级人工复审而非阻断。

---

## Q13. 设计一个短链服务

**🎤 面试官**

> 咱们做个经典的暖场题。你给我从零设计一个短链服务——输入长 URL，返回一个短码，访问短码要跳转到原地址。日活千万、单条短链可能被瞬间打几十万次（营销短信群发那种）。讲讲你怎么设计。

**🙋 候选人回答**

短链是经典的"小题见功底"——表面是个 `long → short` 的映射，真要做好要抠存储、编码、缓存、跳转语义、防滥用好几层。我按真实思路走一遍。

**① 需求分析**

- 功能：长链转短链、短链跳长链、自定义短码（品牌号）、过期时间、访问统计（PV/UV/来源）
- 非功能：日活千万、单链峰值 QPS 可达十万级（短信群发瞬间）、跳转延迟 <50ms、短码长度尽量短（6~7 位）
- 约束：读远大于写（跳转是读、生成是写，比例 100:1 以上），短码要不易枚举（防爬）

**② 架构总览**

```
┌────────────┐  ① 生成短链: POST /api/shorten {longUrl, customCode?}
│  业务方/   │ ─────────────────┐
│  营销后台  │                  ▼
└────────────┘            ┌──────────────┐
                          │  Write API   │ ── 发号器(Snowflake/号段)
                          │  (NestJS)    │ ── base62 编码
                          └──────┬───────┘ ── 落 PG(urls 表)
                                 │          ── 预热 Redis
                                 ▼
                          ┌──────────────┐
                          │  PostgreSQL  │  urls: code(PK)/long_url/
                          │              │       owner/expires_at/created_at
                          └──────┬───────┘
                                 │ 写穿透
                                 ▼
                          ┌──────────────┐
                          │    Redis     │  short:{code} → long_url
                          │   (缓存)     │  TTL 同 expires_at
                          └──────────────┘

┌────────────┐  ② 跳转: GET /:code (峰值 QPS 十万级)
│  终端用户  │ ─────────────────┐
│  (浏览器)  │                  ▼
└────────────┘            ┌──────────────┐     命中(99%+)
                          │  Redirect    │ ◀─────────── Redis
                          │  Service     │
                          │  (NestJS)    │     未命中
                          └──────┬───────┘ ◀─────────── PG 回源
                                 │                + 回填 Redis
                                 ▼ 302 Location: long_url
                          ┌──────────────┐
                          │  浏览器跳转  │
                          └──────────────┘
                                 │
                                 │ ③ 异步埋点
                                 ▼
                          ┌──────────────┐
                          │  BullMQ 队列 │ → PG(access_logs, 聚合后)
                          │  (访问统计)  │ → ClickHouse(明细,量大时)
                          └──────────────┘
```

**③ 短码生成——这是核心**

短码生成本质是"如何把一个全局唯一 ID 压成 6~7 位字符串"。我用 base62（a-z, A-Z, 0-9 共 62 个字符）编码，6 位可表达 62^6 ≈ 568 亿，足够用。

ID 怎么来？三种路子：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| DB 自增 ID + base62 | `INSERT` 拿 auto_increment → 转 base62 | 简单、短码有序（防不了爬但好排障） | 单点 DB 发号、可被枚举遍历 |
| MD5(longUrl) 取前 6 位 | 长链哈希后截断 | 同一长链得同一短码（天然去重） | 冲突率高（6 位只有 568 亿桶，亿级长链必撞） |
| Snowflake 分布式 ID + base62 | 机器号+时间戳+序列号 → 64bit → base62 | 分布式无单点、趋势递增、不可枚举 | 短码长一点（8~10 位） |

**我们选 Snowflake + base62**：理由是发号要脱离单点 DB（峰值写不能卡在自增锁上），且 Snowflake 趋势递增对 B+树索引友好、不可枚举能挡掉一部分恶意爬取。为了控制长度，我做了个变体——用 10bit 机器号 + 41bit 毫秒时间 + 12bit 序列，base62 后约 8 位，可接受。自定义短码走单独校验：先查是否被占用（Redis 布隆过滤器预筛 + PG 唯一约束兜底），冲突就让用户换。

**④ 跳转：301 还是 302？**

这是个常被忽略但很考究的点：

| 状态码 | 语义 | 缓存 | 统计 |
|--------|------|------|------|
| 301 Moved Permanently | 永久重定向 | 浏览器/CDN 长缓存，后续不再访问短链服务 | ❌ 命中缓存后服务收不到请求，统计丢失 |
| 302 Found | 临时重定向 | 不长缓存（每次都回源） | ✅ 每次跳转都经过服务，能埋点统计 |

**我们选 302**——短链的商业模式之一是访问统计（PV/UV、来源、地域），301 会被浏览器和 CDN 缓存掉，统计全丢。代价是每次都回源，所以必须把 Redis 缓存命中率做到 99%+（预写 + 回填 + TTL）。只有纯静态、不需要统计的场景才用 301。

**⑤ 缓存与防穿透**

跳转是读密集型，Redis 命中率是命门。三层设计：
1. **写时预热**：生成短链时同步写 Redis，不等第一次访问
2. **回源回填**：Redis miss → 查 PG → 回填 Redis（带 TTL = expires_at）
3. **防穿透**：不存在的短码用布隆过滤器挡（生成时 set bit，查询前先判否），避免恶意打不存在的 code 把 PG 打穿；对布隆过滤器判"存在"但 PG 查无的，缓存空值 `null` 短 TTL（60s）防同 code 反复回源

**⑥ 防滥用**

短链服务是黑产重灾区——拿免费短链做钓鱼、做薅羊毛跳板、做垃圾邮件外链。我们做了三道：
1. **生成侧限流**：按用户/租户维度，Q9 那套 Redis + Lua 令牌桶（免费用户每天 100 条，企业按套餐）
2. **长链安全检查**：接 Google Safe Browsing / 自建黑名单，长链命中黑名单直接拒绝生成
3. **跳转侧频率**：单 code 短时间内异常高频（比如 1 秒上千次来自同 IP）触发风控——风控命中后跳转页插中间页"即将离开本站，注意安全"让人工确认

**⑦ 访问统计异步化**

跳转是关键路径，**绝不能同步写统计**——否则 DB 写放大直接拖垮跳转。每次跳转只往 BullMQ 丢一条埋点（code/uid/ip/referer/ua/ts），消费者批量聚合后落 PG（小时级 PV/UV 表），量大后迁 ClickHouse 存明细。这跟 Q1 的快慢分离是同一套思路。

---

**🎤 面试官追问**

> 你说用 Snowflake 发号，但如果短链服务刚启动、机器号还没分配，或者时钟回拨了怎么办？

**🙋 候选人回答**

机器号分配：我们用 ZooKeeper/etcd 做机器号注册——每个实例启动时去抢一个 0~1023 的 workerId，抢到就持久化（写本地文件做 fallback），下次启动优先读本地、再去 ZK 校验占用状态。这样即使 ZK 临时挂了，本地还有上次的 workerId 可用。

时钟回拨是 Snowflake 的经典坑。我们的处理：
1. 启动时记录上次发号时间戳，发现当前时间 < 上次时间，拒绝发号并告警（最多回拨 5ms 内可以"等"，sleep 到追平）
2. 业务上发号失败走降级——临时回退到 DB 自增 ID 发号（保证可用），事后排查时钟
3. 根因上靠 NTP/Chrony 把所有机器时钟同步到 50ms 内，回拨基本不会发生

其实最稳的是**号段模式（Leaf-Segment）**——DB 里维护一个 `max_id` 字段，每次批量拉一个号段（比如 1000 个 ID）到内存发，发完再拉。这样完全不依赖时钟、对 DB 压力小（批量）、性能高（内存发号）。缺点是 ID 可能不连续（重启丢号段）、趋势递增但不严格递增。我们最终是号段为主、Snowflake 兜底（号段 DB 故障时切）。

---

**🎤 面试官继续追问**

> 短链这么短，被人遍历爬出来全部长链怎么办？还有自定义短码冲突你怎么保证？

**🙋 候选人回答**

防遍历：base62 编码本身是单调的（ID 递增 → 编码递增），确实容易被顺序爬。我们的对策：
1. **短码"洗"一下**——发号后不直接 base62，而是先做一个固定置换 + 加 secret 的哈希扰动（类似 Hashids 库），让相邻 ID 的短码看起来毫无规律，挡掉 99% 的脚本小子
2. **跳转侧风控**——单 IP 短时间内遍历大量不连续短码 → 触发验证码 / 限流 / 封 IP（Q9 限流器复用）

自定义短码冲突保证：用 PG 的唯一约束（`urls.code` UNIQUE）做最终兜底，写入冲突直接报错让用户换。乐观做法是写入前先查 Redis 布隆过滤器（生成短链时把所有 code 都 add 进去），布隆说"不存在"大概率真不存在，省一次 PG 查询；布隆说"存在"再去 PG 精确查。布隆有假阳性但无假阴性，"判不存在"是可靠的，足够挡掉绝大多数自定义短码的冲突查询。

### 🏗 架构分析

**短码生成方案对比**

| 方案 | 长度 | 去重 | 分布式 | 可枚举 | 结论 |
|------|------|------|--------|--------|------|
| 自增 ID + base62 | 6 位 | ❌（每次新 ID） | ❌（DB 单点） | ✅ 易被爬 | △ 仅小规模 |
| MD5(longUrl) 截 6 位 | 6 位 | ✅（同链同码） | ✅ | ❌ | ❌ 冲突率高，亿级必撞 |
| Snowflake + base62 | 8 位 | ❌ | ✅ 无单点 | △（加 Hashids 洗） | ✅ 写密集选它 |
| 号段(Leaf) + base62 | 6~7 位 | ❌ | ✅（批量拉号段） | ✅ 易被爬 | ✅ 读密集/可用性优先选它 |

**核心权衡**：去重（同长链得同短码）是 MD5 方案的最大卖点，省存储、幂等。但 6 位桶太少，亿级长链必撞——要解决就得加长到 8 位以上，又损失"短"的核心价值。我们的取舍：**不去重**（用 Snowflake/号段每次发新码），理由是业务上同一长链生成多次短链是少数（且用户往往就是想要新短码重新统计），为这少数场景扛冲突处理的复杂度不划算。真要去重的场景（比如内部固定资源），走单独的"长链 → 已有短码"查询表。

**301 vs 302 的商业权衡**：很多人无脑选 301（"永久更快"），但忽略了短链服务的统计诉求。301 让浏览器和 CDN 把映射缓存死，服务收不到请求 = 统计全丢 = 商业模式崩。选 302 是用"每次回源"换"每次能埋点"，再用 Redis 99% 命中率把回源成本压下去。这是"业务语义驱动技术选型"的典型。

**未来演进**：访问明细量大后，统计从 PG 迁 ClickHouse（列存适合时序聚合）；跨地域时短链服务多活 + 就近跳转（CDN 边缘做 302）；品牌短码多了上审核流（防钓鱼）。

### 🎯 面试官真正考察什么

1. **发号器设计**：能不能讲清楚 ID 生成的几种方案（自增/哈希/Snowflake/号段）及各自的分布式、冲突、可枚举权衡——这是短链的灵魂。
2. **读写不对称意识**：短链是 100:1 的读多写少，懂不懂用 Redis 预热 + 回填 + 布隆防穿透把读扛住。
3. **301/302 的业务思考**：会不会无脑选 301，而忽略了统计诉求——体现"技术选型服务业务"的判断力。

### ❌ 常见错误回答

- **"用 MD5 取前 6 位"**：不讲冲突处理，亿级长链必撞，面试官追问就露馅。
- **发号只说自增 ID**：没考虑分布式发号的单点和性能瓶颈。
- **跳转用 301**：忽略统计需求，被追问"那 PV/UV 怎么算"答不上来。
- **统计同步写**：跳转路径同步落库，DB 写放大直接拖垮跳转。
- **没有防滥用**：短链是黑产重灾区，不提限流/黑名单/风控等于没做过生产。

### ✅ 推荐回答

> 需求：长转短、短跳长、自定义码、统计，日活千万、单链峰值十万 QPS、跳转 <50ms。架构：生成（Write API → Snowflake/号段发号 → base62 → Hashids 洗码防爬 → 落 PG + 预热 Redis + 布隆过滤）+ 跳转（Redirect Service → Redis 99% 命中/未命中回源 PG 回填/布隆挡穿透缓存空值 → 302 跳转 → 异步埋点进 BullMQ → 聚合落 PG/ClickHouse）。发号对比：自增 ID 单点易爬、MD5 截断亿级必撞、Snowflake 分布式无单点 8 位、号段批量拉抗 DB 故障——选 Snowflake/号段。301 vs 302：选 302 因为统计是商业模式，301 被缓存统计全丢，靠 Redis 高命中率压回源成本。防滥用三道：生成侧令牌桶限流、长链黑名单、跳转侧高频风控中间页。

### 📚 延伸知识

- **Hashids**：把整数编码成无规律短串的库，原理是置换 + salt 哈希，能解码回原 ID，防遍历爬取的常用手段。
- **Leaf（美团）/ Tinyid**：业界开源的分布式 ID 生成器，Leaf-Segment（号段）和 Leaf-Snowflake 两种模式，生产级发号器的参考实现。
- **布隆过滤器**：空间高效的概率数据结构，短链防穿透、爬虫 URL 去重、海量数据存在性判断的通用工具。
- **Google Safe Browsing**：Google 的恶意 URL 数据库，短链服务防钓鱼的标配接入。

---

## Q14. 从零设计一个消息队列

**🎤 面试官**

> 你简历上写用 BullMQ、Celery、asynq 三套队列——Node、Python、Go 各一套。那你应该对队列内部很熟了。现在给你一道反向题：**从零设计一个消息队列**。不用造得像 Kafka 那么大，但核心语义——投递保证、消费组、重试死信、分区并行——你得讲清楚。给我讲讲你的设计。

**🙋 候选人回答**

这题正好是我的舒适区。我用过三套队列：Node 生态的 BullMQ（漫剧平台 Task Platform 在用，Q1 那套）、Python 的 Celery（视频处理管线）、Go 的 asynq（一个高并发网关的异步任务）。三套底层分别是 Redis list/stream、Redis+AMQP 思路、Redis。用多了自然会比较它们的设计取舍，我从这些实战经验反推一个队列该有哪些核心机制。

**① 需求分析**

- 功能：消息发布/订阅、消费组（多消费者分摊）、ack/nack、重试 + 死信、延迟消息、优先级、顺序消费（可选）
- 非功能：高吞吐（单机万级 QPS）、消息不丢、水平扩展、HA（broker 挂了能恢复）
- 三种投递语义：at-most-once（最多一次）、at-least-once（至少一次）、exactly-once（精确一次）

**② 架构总览**

```
┌──────────┐  produce(msg, topic, key)        ┌──────────────────┐
│ Producer │ ───────────────────────────────▶ │     Broker       │
└──────────┘                                   │  ┌────────────┐  │
                                               │  │ Partition0 │←─┐
                                               │  │ [msg][msg] │  │ 按 key 哈希
                                               │  ├────────────┤  │ 选分区
                                               │  │ Partition1 │──┘
                                               │  │ [msg][msg] │
                                               │  ├────────────┤
                                               │  │ Partition2 │  每个 Partition
                                               │  │ [msg][msg] │  是一个追加日志
                                               │  └────────────┘
                                               │  + 副本(Replication)
                                               │  + 消费组 offset
                                               └────────┬─────────┘
                                                        │
                              ┌─────────────────────────┴──────────┐
                              ▼                                    ▼
                     ┌──────────────────┐               ┌──────────────────┐
                     │  Consumer Group A │               │  Consumer Group B │
                     │  (订单处理)       │               │  (数据同步)        │
                     │ ┌────┐ ┌────┐    │               │ ┌────┐ ┌────┐    │
                     │ │ C1 │ │ C2 │    │               │ │ C1 │ │ C2 │    │
                     │ │←P0 │ │←P1 │    │               │ │←P0 │ │←P1 │    │
                     │ │←P2 │ │    │    │               │ │←P2 │ │    │    │
                     │ └────┘ └────┘    │               │ └────┘ └────┘    │
                     └──────────────────┘               └──────────────────┘
                       每分区只被组内          不同消费组各自维护
                       一个消费者消费            offset，互不影响
                              │
                              ▼ 处理失败
                     ┌──────────────────┐
                     │  Retry Queue     │ → 重试 N 次仍失败
                     │  (指数退避)       │
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │  Dead Letter     │ → 人工介入/告警
                     │  Queue (DLQ)     │
                     └──────────────────┘
```

**③ 消息存储：日志模型 vs 列表模型**

这是队列设计的第一个分水岭。我用过的两派：

| 维度 | 日志型（Kafka/BookKeeper） | 列表型（Redis List/BullMQ） |
|------|---------------------------|----------------------------|
| 存储 | 追加写不可变日志，按 offset 读 | LPUSH/BRPOP 一进一出，消费即删 |
| 顺序保证 | 分区内严格有序（offset 单调） | 单 List 有序，但并发消费后乱序 |
| 回溯 | ✅ 消息留存期内可重放（改 offset 回退） | ❌ 消费即删，无法回溯 |
| 吞吐 | 极高（顺序写磁盘 + 零拷贝） | 中（Redis 单线程 + 网络） |
| 持久化 | 磁盘日志（天然持久） | 需配 AOF/RDB，丢窗口风险 |
| 消费确认 | offset 提交（批量高效） | 单条 ack（细粒度但开销大） |

BullMQ 底层其实是 Redis Stream（带消费者组的日志结构）+ 部分列表操作，介于两者之间。我们的设计选**日志型**，因为它在回溯、顺序、吞吐上更完整，且能解释 Kafka 的核心机制。

**④ 投递语义——三个层次**

这是面试官最爱挖的点，必须讲透：

| 语义 | 实现方式 | 代价 | 适用 |
|------|---------|------|------|
| at-most-once | 发完就忘 / auto-ack | 可能丢消息 | 日志、监控（丢一两条无伤） |
| at-least-once | 消费完才 ack，broker 未收 ack 重投 | 消费者可能重复消费（需幂等） | ✅ 多数业务选这个 |
| exactly-once | 需事务（生产+消费原子）或幂等 + 去重 | 极重，性能代价大 | 计费、金融 |

**at-least-once 怎么实现**：消费者拉取消息 → 处理 → 处理成功才提交 offset；如果消费者崩溃，broker 检测到 session 失效（心跳超时），把该分区重新分配给组内其他消费者，从**上次提交的 offset** 重新投递。代价是"处理完但 ack 前 crash"会导致重复投递，所以**业务必须幂等**（用 msgId 去重表 / upsert / SETNX，Q1 那套）。

**exactly-once 怎么实现**：两条路——一是**事务消息**（Kafka 的 transactional API，生产+提交 offset 在一个事务里原子），二是**幂等消费 + 去重**（用 msgId 在业务库做唯一约束，重复投递被业务层挡掉）。后者更轻量，工程上绝大多数"exactly-once"诉求其实是用 at-least-once + 幂等达成的。我们 Task Platform 就是这套——BullMQ 保证 at-least-once，业务用 `SETNX task:{id}:running` 做幂等锁。

**⑤ 消费组与 offset 管理**

消费组是并行消费的基础。核心规则：**一个分区在同一消费组内只能被一个消费者消费**——这保证分区内顺序。消费组内消费者数 ≤ 分区数才有意义（多了的消费者空转）。offset 存在哪？Kafka 存 broker 内部 topic（`__consumer_offsets`），BullMQ 存 Redis，我们设计里存 broker 的 offset 表。

rebalance 机制：消费者上下线、broker 检测心跳超时 → 触发 rebalance → 重新分配分区。rebalance 是痛点（Stop-The-World 期间不消费），Kafka 用 cooperative rebalancer 减少影响。

**⑥ 重试与死信**

消息处理失败不能直接丢。我们的策略：
1. **指数退避重试**：1s / 5s / 30s / 2min / 10min，最多 N 次（可配）。实现是失败后投递到延迟队列（Redis ZSET 按到期时间排序 / 专门的 retry topic）
2. **死信队列（DLQ）**：重试耗尽仍失败 → 投到 DLQ，触发告警人工介入。DLQ 里的消息可回放（修复 bug 后重新投递）
3. **区分瞬时失败 vs 永久失败**：网络抖动重试有效，参数错误重试无意义——业务侧要能标 `non-retryable` 跳过重试直接进 DLQ

这正是 BullMQ 的 `attempts` + `backoff` + `failed` 队列，Celery 的 `autoretry_for` + `max_retries` + 死信，asynq 的 `MaxRetry` + `RetryDelay` 的共同设计。

**⑦ 分区与副本**

分区（Partition）是为了并行——单分区再快也是单线程瓶颈，多分区才能水平扩展吞吐。分区策略：按 `key` 哈希（同 key 同分区，保证相关消息有序）或 round-robin（无序、均匀）。

副本（Replica）是为了 HA——每个分区有 1 leader + N follower，写只走 leader，follower 异步/同步复制。leader 挂了从 follower 选举新 leader。这里有个经典的 ack 级别权衡：

| acks | 含义 | 一致性 | 性能 | 丢消息风险 |
|------|------|--------|------|-----------|
| 0 | 发完不等 | 最弱 | 最高 | leader 挂则丢 |
| 1 | leader 写入即返回 | 中 | 高 | leader 挂且未复制则丢 |
| all | 所有副本确认才返回 | 强 | 低 | 不丢（前提 min.insync.replicas） |

我们默认 `acks=all` + `min.insync.replicas=2`（3 副本里至少 2 个确认），用性能换"消息不丢"——Task Platform 的任务不能丢，这个底线不能让。

---

**🎤 面试官追问**

> 你说 at-least-once 业务要幂等。但如果消费者处理成功了、提交 offset 前崩溃，重启后会重复消费——这个你能彻底避免吗？还是只能靠幂等兜底？

**🙋 候选人回答**

只能靠幂等兜底，无法从队列层彻底避免。这是分布式系统的一个本质约束——"处理成功"和"提交 offset"是两个动作，中间总有窗口，crash 落在窗口内就重复。能做到 exactly-once 的只有把"处理 + 提交"做成一个原子事务：

- **外部状态在 broker**：Kafka Streams 的 exactly-once，消费 offset 提交和生产下游消息在一个事务里，broker 侧原子。但要求上下游都是 Kafka，且性能打折。
- **外部状态在业务 DB**：把"业务处理"和"记录已处理 msgId"写进**同一个本地事务**——要么都成功要么都回滚，这样即使重复投递，第二次查到 msgId 已处理直接跳过。这是工程上最实用的"exactly-once"达成方式。

我们在 Task Platform 用的是后者：Worker 处理任务时，`BEGIN → 更新任务状态 + 写 token_usage + 记录 processed_msg_id → COMMIT`，全在一个 PG 事务里。BullMQ 重复投递时，第二个 Worker 查到 `processed_msg_id` 已存在，直接 ack 不执行。这套需要业务 DB 支持事务，但最稳。

所以面试官问"能不能彻底避免"——我的诚实回答是：**队列层只能保证 at-least-once，exactly-once 是业务 + 队列协同达成的**。谁宣称队列单方面做到 exactly-once 而不讲业务幂等，要么是骗你要么是没踩过坑。

---

**🎤 面试官继续追问**

> BullMQ/Celery/asynq 你都用过，它们和 Kafka 这种"重型"队列的本质区别是什么？什么场景该用哪个？

**🙋 候选人回答**

本质区别在**存储模型和定位**：

- **BullMQ/Celery/asynq**（任务队列，Task Queue）：以"任务"为单位，一条消息对应一个任务，消费即处理完。底层多是 Redis（BullMQ/asynq 是 Redis Stream/List，Celery 可配 Redis/RabbitMQ）。强项是**任务语义丰富**——延迟、优先级、定时、流程编排（BullMQ Flows、Celery Chain/Group）、细粒度重试。弱项是**吞吐和留存**——Redis 单线程、消息消费即清理不适合做事件溯源。
- **Kafka/Pulsar**（日志/流队列，Log/Stream Queue）：以"日志"为单位，消息持久留存按 offset 读，多消费组各自独立。强项是**高吞吐、回溯、事件溯源、流处理**。弱项是**任务语义弱**——没有现成的延迟/优先级/重试编排，做任务调度要自己包一层。

判据很清晰：
- **业务是"派活干"**（任务执行、异步处理、定时作业）→ 用任务队列（BullMQ/Celery/asynq）。我们的 Task Platform、视频转码、邮件发送都是这类。
- **业务是"事件流"**（日志聚合、数据同步、CDC、实时数仓）→ 用日志队列（Kafka/Pulsar）。访问日志、埋点、订单事件流是这类。
- **混用**：比如电商下单——订单事件进 Kafka（多个下游订阅：库存、推荐、数仓），每个下游内部的任务执行用 BullMQ/Celery。这是常见架构。

为什么我用了三套？不是炫技，是**语言生态绑定**——Node 项目用 BullMQ（原生、和 NestJS 一体）、Python 项目用 Celery（社区主流、和 ML 生态一体）、Go 项目用 asynq（轻量、和 Go 并发模型贴合）。如果跨语言统一，会选 NATS/Temporal 这种语言无关的，但那要单独运维一个 broker，团队成本高。语言原生的队列复用现有 Redis，运维几乎为零，这是中小团队的务实选择。

### 🏗 架构分析

**日志型 vs 列表型存储对比**

| 维度 | 日志型（Kafka） | 列表型（Redis List/BullMQ） |
|------|----------------|----------------------------|
| 消费模型 | pull，按 offset 拉取 | push（BRPOP 阻塞拉）或 pull |
| 消息留存 | 配置留存期（可回溯） | 消费即删（除非 Stream） |
| 顺序保证 | 分区内严格有序 | 单消费者有序，并发乱序 |
| 多消费组 | ✅ 各自 offset 互不干扰 | △（Stream 支持，List 不支持） |
| 吞吐 | 极高（顺序写+零拷贝） | 中（Redis 单线程） |
| 持久化 | 磁盘日志天然持久 | 需 AOF/RDB，有丢窗口 |
| 适合 | 事件流、数据管道、回溯 | 任务调度、异步处理 |

**投递语义对比**

| 语义 | 实现 | 业务要求 | 性能 | 典型 |
|------|------|---------|------|------|
| at-most-once | auto-ack / 发完忘 | 容忍丢失 | 最高 | 监控埋点 |
| at-least-once | 处理后 ack，崩溃重投 | 幂等 | 中 | ✅ 多数业务 |
| exactly-once | 事务消息 / 幂等+去重 | 强一致 | 低 | 计费、金融 |

**核心权衡**：exactly-once 是个"昂贵的幻觉"——纯队列层做不到，必须靠业务幂等或事务协同。工程上 90% 场景用 at-least-once + 幂等达成"逻辑 exactly-once"，性能和复杂度都最优。死磕纯队列 exactly-once 的，要么是金融级硬需求（值得），要么是没算清成本账。

**任务队列 vs 流队列的边界**：不是谁替代谁，而是定位不同。任务队列强在"执行编排"（延迟/优先级/重试/流程），流队列强在"事件留存"（回溯/多订阅/高吞吐）。成熟架构常是两者协同——Kafka 做事件分发，BullMQ/Celery 做下游任务执行。

**未来演进**：单 broker 扛不住时分区水平扩；HA 用多副本 + leader 选举；跨地域用 MirrorMaker/Cluster Replication；超大规模演进到 Pulsar（计算存储分离，更易扩）。

### 🎯 面试官真正考察什么

1. **投递语义的本质理解**：能不能讲透三种语义的实现机制，以及"exactly-once 必须业务幂等协同"这个本质——这是区分背概念和真懂的试金石。
2. **存储模型的取舍**：日志型 vs 列表型、Kafka vs BullMQ 的定位差异——看你是不是只会用一个队列，理解不了队列设计的多样性。
3. **实战选型判断**：任务队列 vs 流队列的边界，以及为什么不同语言生态有不同的主流队列——体现真实工程经验。

### ❌ 常见错误回答

- **"用 Redis List 就行"**：只讲数据结构，不讲投递语义、ack、重试、HA——停在入门。
- **宣称"exactly-once 用事务"**：但不讲事务的前提（同 broker / 业务 DB）和性能代价，被追问就露馅。
- **不分任务队列和流队列**：所有场景都推 Kafka，或都推 RabbitMQ，缺乏定位判断。
- **没有重试和死信**：失败消息直接丢，没有兜底，生产环境必出事。
- **多副本不讲 acks 级别**：副本只说"有 HA"，不讲 leader 挂时丢不丢消息取决于 acks 配置。

### ✅ 推荐回答

> 需求：发布订阅、消费组、ack/nack、重试死信、分区并行、HA、三种投递语义。架构：Producer → Broker（多 Partition 追加日志 + 副本 leader/follower）→ 消费组（每分区组内单消费者消费保顺序，多消费组各自 offset）→ 失败进重试队列（指数退避）→ 耗尽进 DLQ 告警。存储：日志型（Kafka，追加写按 offset 读、可回溯、高吞吐）vs 列表型（Redis List/BullMQ，消费即删、任务语义强）——我选日志型讲清全貌。投递：at-most-once 发完忘、at-least-once 处理后 ack 崩溃重投（业务需幂等，多数场景选它）、exactly-once 靠事务消息或幂等+去重（本质是业务+队列协同，纯队列做不到）。HA：多副本 + acks=all + min.insync.replicas=2 用性能换不丢。重试：指数退避 N 次→DLQ 人工介入，区分瞬时/永久失败。三套队列心得：BullMQ/Celery/asynq 是任务队列（派活干），Kafka 是流队列（事件流），判据是"执行编排"还是"事件留存"，常协同使用。语言生态绑定让中小团队选原生队列复用 Redis。

### 📚 延伸知识

- **BullMQ 源码**：基于 Redis Stream + Lua 脚本实现消费者组、stalled job 检测、延迟任务（ZSET），是任务队列设计的优秀参考实现。
- **Kafka ISR（In-Sync Replicas）**：与 leader 保持同步的副本集合，acks=all + min.insync.replicas 的底层机制，理解它就理解了 Kafka 的持久化保证。
- **Pulsar 的计算存储分离**：broker 无状态 + BookKeeper 存消息，扩容时计算和存储独立扩展，是 Kafka 之后的演进方向。
- **Temporal / Cadence**：持久化工作流引擎，本质是"带状态的队列"，复杂工作流（跨天、human-in-the-loop）比纯队列更适合，Q4 Workflow 引擎有对比。

---

## Q15. 设计一个实时协同编辑系统

**🎤 面试官**

> 你简历上有个实时协同的项目——用 tldraw 做的会议批注工具，WebSocket 多人实时同屏。那这题正好打在你的点上：**从零设计一个实时协同编辑系统**，多人同时编辑一个文档/画板，要能看到对方的光标、改动实时同步、不冲突。给我讲讲你怎么设计。

**🙋 候选人回答**

这题我有实战体感。我们做的会议批注工具（亿次网联的项目），场景是会议中多人同屏在一个画板上批注——画线、贴便签、拖元素，所有人实时看到彼此的操作。底层用 tldraw（它内置了 CRDT）+ WebSocket 做实时同步。我从这个实战经验出发讲设计。

**① 需求分析**

- 功能：多人实时同屏编辑（文档/画板）、实时光标和选区（presence）、改动实时同步、并发不冲突、离线编辑后重连合并、历史回放
- 非功能：延迟 <100ms（局域）/ <300ms（跨地域）、支持单房间 50 人同时在线、断线重连不丢改动、弱网下不卡顿
- 约束：团队 Node + WebSocket（NestJS Gateway），画板数据是 JSON（tldraw 的 Records）

**② 架构总览**

```
┌────────┐  ┌────────┐  ┌────────┐
│ 用户 A │  │ 用户 B │  │ 用户 C │   浏览器
│ (画板) │  │ (画板) │  │ (画板) │   本地 CRDT 副本
└───┬────┘  └───┬────┘  └───┬────┘   (tldraw store)
    │ WSS       │ WSS       │ WSS
    └───────────┼───────────┘
                ▼
        ┌───────────────┐
        │  WS Gateway   │  NestJS Gateway
        │  (连接层)     │  连接管理 + 心跳 + 鉴权
        └───────┬───────┘
                │ 按 roomId 哈希到对应房间服务
                ▼
        ┌───────────────┐         ┌──────────────┐
        │  Room Service │ ◀──────▶│  Redis       │
        │  (房间逻辑)   │  Pub    │  Pub/Sub     │ 跨 Gateway 实例
        │  - CRDT 合并  │  Sub    │  + presence  │ 广播 + 在线状态
        │  - 广播 diff  │         │  + room:{id} │
        └───────┬───────┘         └──────────────┘
                │ 持久化
                ▼
        ┌───────────────┐
        │  Snapshot     │  PG(快照) + S3(大文档)
        │  Store        │  Redis(热数据缓存)
        └───────────────┘
```

**③ CRDT vs OT——这是协同编辑的灵魂选择**

多人并发编辑的核心难题是"冲突解决"。两个流派：

| 维度 | OT（Operational Transform） | CRDT（Conflict-free Replicated Data Type） |
|------|----------------------------|--------------------------------------------|
| 原理 | 对操作做变换，服务端 central 转换 | 数据结构本身保证合并无冲突 |
| 中心化 | 需要中心服务做 transform | ✅ 去中心化，P2P 也能合并 |
| 实现复杂度 | 极高（transform 函数易写错） | 中（有成熟库：Yjs/Automerge/tldraw） |
| 历史依赖 | 依赖操作顺序，需向量时钟 | 不依赖顺序（基于偏序） |
| 撤销/重做 | 难（要反 transform） | 相对易（tldraw 的 history） |
| 离线支持 | 弱（重连后顺序乱） | ✅ 强（合并即一致） |
| 典型实现 | Google Docs、老版 EtherPad | Yjs、Automerge、tldraw、Figma |

**我们选 CRDT**——理由有三：第一，tldraw 内置就是 CRDT（基于自身的数据结构 + Yjs 思路），不用自己实现 transform 这种"出名的难"；第二，CRDT 去中心化的特性让离线编辑重连后能自动合并，会议场景里有人网络抖动掉线很常见，OT 重连后的顺序处理很痛；第三，撤销重做 CRDT 更直观（tldraw 的 history stack）。代价是 CRDT 元数据开销略大（每条记录带时钟/版本），但对画板这种粒度的数据完全可接受。

OT 的优势在**严格顺序敏感的富文本**（如 Google Docs 的字符级编辑），那里 CRDT 的实现复杂度和元数据成本会高。但我们的场景是结构化图形元素（形状/便签/线条），CRDT 是甜点。

**④ WebSocket fan-out 与 presence**

实时协同有两个数据流，要分开处理：

**操作流（改动同步）**：用户 A 移动一个形状 → 本地 CRDT 产生 diff → WSS 发到 Room Service → Room Service 广播给同房间其他用户 → 其他用户本地 CRDT merge。这里关键是 Room Service 不做"权威计算"，只是 fan-out 中转——因为 CRDT 的合并在每个客户端本地都能做且结果一致。Room Service 跨实例广播靠 Redis Pub/Sub（room 频道）。

**presence 流（光标/选区/在线状态）**：这是**高频、瞬态、可丢失**的数据——光标位置每秒可能更新几十次，丢几帧无所谓。所以 presence 走单独通道：客户端高频发 → Room Service 直接 Redis Pub/Sub 广播 → 其他客户端收，**不进持久化、不做 CRDT 合并**。这样高频光标不会污染文档操作流，也不会拖累持久化。

presence 还包含"谁在线"——用户 join/leave 时维护 Redis Set `room:{id}:online`，断线心跳超时自动移除（TTL + 心跳续期）。

**⑤ 离线支持与重连 replay**

会议场景网络不稳，断线重连必须不丢改动。设计：
1. **客户端本地持久化**：tldraw 的 store 持久化到 IndexedDB，所有操作先落本地，离线也能编辑
2. **重连后增量同步**：重连时客户端带自己的"最后同步版本号"，Room Service 对比后只发缺失的 diff（不是全量）
3. **CRDT 自动合并**：离线期间的本地操作和服务器端的并发操作，CRDT 合并保证最终一致——这是 CRDT 相对 OT 的杀手锏，OT 离线重连的顺序处理非常痛

**⑥ 快照与持久化**

CRDT 的操作日志会无限增长，必须定期快照压缩。设计：
1. **增量日志**：每次操作记录 diff（带版本号），存 PG，便于回放和增量同步
2. **定期快照**：每 N 次操作或每 M 分钟，把当前全量状态做快照存 PG/S3，清掉旧日志
3. **新用户加载**：先拉最新快照 → 再 replay 快照之后的增量日志 → 追上实时
4. **历史回放**：保留若干历史快照，可回放"这次会议的编辑过程"——这是会议批注工具的一个增值功能

---

**🎤 面试官追问**

> 50 人同时在一个房间，假设每个人都频繁移动元素，广播风暴怎么扛？还有，WebSocket 长连接这么多，Gateway 怎么水平扩展？

**🙋 候选人回答**

广播风暴是协同系统的真实痛点。50 人房间，每人每秒发 10 次操作，就是 500 msg/s，每条要广播给其他 49 人 = 24500 次发送/s，单房间就够呛。我们的优化：

1. **操作合并（coalescing）**：客户端高频操作（如拖拽的 mousemove）本地先 debounce/coalesce，每 50ms 只发一帧"当前位置"，而不是每个 mousemove 都发。拖拽结束才发最终位置。这一步就能把消息量砍掉 80%。
2. **服务端批量广播**：Room Service 收到操作后不立即广播，而是攒一个短窗口（如 30ms）批量打包发，减少 WebSocket 帧数。
3. **presence 与操作分离**（前面讲过）：光标这种高频瞬态走独立通道，且光标只发"增量位置"不发全量。
4. **背压控制**：客户端如果跟不上接收速率，Room Service 检测到积压就降低该客户端的广播频率（或直接丢光标帧，保操作帧）。

Gateway 水平扩展：单机 WebSocket 连接数有上限（Node 单进程几万连接，受 fd 和内存限制），50 人 × 多房间必须多实例。挑战是"同一房间的用户可能连在不同 Gateway 实例上"。解法是 **Redis Pub/Sub 做跨实例广播**：
- 每个 Gateway 实例订阅自己上面有连接的 `room:{id}` 频道
- 用户 A 在实例 1 发操作 → 实例 1 的 Room Service 发到 Redis `room:{id}` 频道 → 实例 2/3 上有该房间连接的 Gateway 收到 → 广播给各自的客户端

连接路由用一致性哈希或 Sticky Session（同一房间尽量路由到同实例，减少跨实例广播）。再上一层可以加 LB（如 HAProxy/Nginx）按 `roomId` 做一致性哈希分发 WebSocket 连接，让同房间用户尽量落同实例，Redis Pub/Sub 只做兜底跨实例同步。这正是我们 Q1 Task Platform 的 WS Gateway 那套（连接层和业务层解耦 + Pub/Sub 跨实例），这里复用。

---

**🎤 面试官继续追问**

> CRDT 听起来很美，但它有什么代价？什么场景不该用 CRDT？

**🙋 候选人回答**

CRDT 的代价很实在，不是银弹：

1. **元数据开销**：每条记录要带版本向量/逻辑时钟，元数据可能比数据本身还大。对画板的大对象（一个形状几十字段）无所谓，但对**字符级文本编辑**（如协作文档逐字符），元数据膨胀会很严重——Yjs 用了专门的文本 CRDT 优化（RGA/Split tree）才压下来。
2. **语义不总是直觉**：CRDT 的合并是"最终一致"，但"最终一致"不等于"用户想要的结果"。最经典的例子是**并发删除 vs 并发修改**——A 删了一段文字，B 同时改了同一段，CRDT 的合并结果可能是"保留了 B 的修改"（last-write-wins per character），但用户预期可能是"删掉了"。这种语义冲突 CRDT 无法自动解决，需要 UI 层提示（"这里有冲突，请确认"）。
3. **实现门槛**：自己实现 CRDT 极难（涉及到偏序、因果、合并函数的数学证明），几乎必须用成熟库（Yjs/Automerge/tldraw）。但库的抽象和数据模型要适配业务，有学习曲线。
4. **撤销重做**：CRDT 的撤销是"反向操作"不是"回退状态"，实现比 OT 的状态快照复杂（要记录 anti-operation）。

**不该用 CRDT 的场景**：
- **需要强一致/线性一致**的场景（如金融账户余额）——CRDT 只保证最终一致，不适合强一致诉求。
- **操作有严格顺序语义**的场景（如"先 A 后 B"，顺序变了语义全错）——CRDT 不保证顺序，这类要用 OT 或中心化顺序服务。
- **冲突需要人类裁决**的场景——CRDT 自动合并，但有些冲突（如两人同时改同一段话的不同意思）自动合并的结果可能谁都不满意，这种反而需要"显式冲突标记 + 人工选择"（类似 Git merge conflict）。

我们的会议批注用 CRDT 是甜点：画板元素是结构化对象、粒度大、冲突语义简单（图形元素基本是 last-write-wins，谁后改听谁的）、离线重连需求强。如果是协办公文（字符级、语义敏感），我会重新评估 OT 或 CRDT+冲突标记的混合方案。

### 🏗 架构分析

**CRDT vs OT 对比**

| 维度 | OT | CRDT |
|------|-----|------|
| 冲突解决 | 服务端 transform | 数据结构保证 |
| 中心化 | 必须中心服务 | ✅ 去中心化 |
| 实现难度 | 极高（transform 易错） | 中（有成熟库） |
| 离线支持 | 弱 | ✅ 强 |
| 撤销 | 难 | 相对易 |
| 元数据 | 小 | 大 |
| 适合 | 富文本（Google Docs） | 结构化数据/画板（Figma/tldraw） |

**数据流分离对比**

| 数据流 | 特征 | 处理方式 | 持久化 |
|--------|------|---------|--------|
| 操作流（文档改动） | 低频、不可丢、需合并 | CRDT 合并 + 广播 + 增量日志 | ✅ 落 PG + 快照 |
| presence 流（光标/在线） | 高频、可丢、瞬态 | Redis Pub/Sub 直播 | ❌ 不持久化 |

**核心权衡**：操作流和 presence 流分离是协同系统的关键设计——把"低频但重要"的文档操作和"高频但可丢"的光标状态走不同通道，避免高频光标污染文档流和拖累持久化。混在一起做是新手常犯的错。

**CRDT 的诚实代价**：元数据膨胀（字符级文本要专门优化）、合并语义不总符直觉（并发删/改冲突）、实现依赖成熟库。它不是银弹，适合结构化大粒度数据 + 强离线诉求的场景。

**未来演进**：超大规模房间（百人+）用分层广播（核心编辑者 + 只读观众，观众走只读流不参与 CRDT）；跨地域用区域 Room Service + 跨区域 Pub/Sub；历史回放做产品化（会议录像式的编辑过程回放）。

### 🎯 面试官真正考察什么

1. **CRDT vs OT 的本质理解**：能不能讲透两者的原理差异、各自的适用场景和代价，而不是只说"CRDT 比较好"。
2. **实时系统的数据流分离**：操作流和 presence 流分离是协同系统的关键设计，懂不懂是分水岭。
3. **WebSocket 水平扩展**：长连接多实例的跨实例广播（Redis Pub/Sub）、广播风暴优化（coalescing/批量/背压）——体现真实生产经验。

### ❌ 常见错误回答

- **"用 WebSocket 广播就行"**：不讲冲突解决（CRDT/OT），多人并发编辑必乱。
- **CRDT/OT 只说一个不对比**：无脑吹 CRDT 或无脑吹 OT，不讲各自代价和适用场景。
- **操作流和 presence 混在一起**：高频光标污染文档流，持久化和性能双崩。
- **没有广播优化**：50 人房间直接全量广播，消息量爆炸。
- **不讲离线重连**：断线就丢改动，会议场景不可接受。

### ✅ 推荐回答

> 需求：多人实时同屏编辑+实时光标+并发不冲突+离线重连+历史回放，单房间 50 人，延迟 <100ms。架构：客户端（本地 CRDT 副本，tldraw store + IndexedDB）→ WSS → WS Gateway（连接管理+心跳+鉴权）→ Room Service（CRDT 合并中转+按 roomId 广播）→ Redis Pub/Sub（跨实例广播+presence+在线状态）+ PG/S3（快照+增量日志）。CRDT vs OT：选 CRDT（tldraw 内置+去中心化离线强+撤销易），代价是元数据开销和合并语义不总符直觉，不适合强一致/严格顺序/字符级富文本（那用 OT）。数据流分离：操作流（低频不可丢，CRDT 合并+广播+落库）vs presence 流（高频可丢，Redis Pub/Sub 直播不持久化）。广播优化：客户端 coalescing（拖拽 50ms 一帧）+ 服务端批量打包 + 背压。WebSocket 扩展：多实例 + Redis Pub/Sub 跨实例广播 + LB 按 roomId 一致性哈希路由（复用 Q1 WS Gateway 那套）。离线重连：本地 IndexedDB 持久化+重连带版本号增量同步+CRDT 自动合并。快照：增量日志+定期快照压缩+新用户拉快照 replay 增量。

### 📚 延伸知识

- **Yjs / Automerge**：主流的 CRDT 库，Yjs 偏性能优化（文档协同），Automerge 偏 JSON 数据模型。tldraw 的协同底层借鉴了这些思想。
- **OT 算法**：Operational Transformation 的经典论文（Ellis & Gibbs 1989），Google Docs 的 Jupiter 算法是工业级实现，理解 OT 的 transform 函数为什么难写是关键。
- **tldraw Sync**：tldraw 官方的协同方案，基于自研的 CRDT-like 数据结构 + WebSocket，是画板协同的参考实现，我们项目的直接基础。
- **WebSocket 水平扩展**：Socket.IO 的 Redis Adapter、NestJS 的 Redis IoAdapter 都是跨实例广播的成熟方案，原理都是 Redis Pub/Sub 做消息中转。

---

## Q16. 设计缓存策略（穿透/击穿/雪崩 + 双写一致性）

**🎤 面试官**

> 你们 AI Platform 里 Redis 用得挺重的——Prompt 缓存、配置缓存、限流计数都在上面。我就问一个绕不开的问题：缓存穿透、击穿、雪崩你怎么防？还有缓存和数据库双写一致性怎么保证？给我讲讲你的实战设计。

**🙋 候选人回答**

这是我们平台真踩过坑的地方。最早我们 Prompt 缓存就是"读 Redis 没有就读 PG 再回填"，简单粗暴。后来上线后连续踩了三个坑：一是有人拿不存在的 prompt_id 疯狂刷接口（穿透），二是一个热门 Prompt 过期瞬间几十个请求同时回源（击穿），三是某个凌晨一批 Prompt 同时过期把 PG 打挂了（雪崩）。我们是被坑怕了才把这套补全的，我按真实演进讲。

**① 需求分析**

- 功能：Prompt 缓存、配置缓存、用户配额缓存，读多写少
- 非功能：缓存命中率 >90%、热点 key 不能击穿、缓存挂了不能把 DB 打垮、缓存与 DB 最终一致（秒级）
- 约束：已有 Redis（主从+Sentinel）和 PG，团队 NestJS

**② 三种缓存模式先选对**

这是基础。我们 Prompt 缓存用的是 cache-aside，但配置缓存这种强一致的用 write-through。三种模式对比：

| 模式 | 写流程 | 一致性 | 复杂度 | 适用场景 |
|------|--------|--------|--------|----------|
| Cache-Aside（旁路缓存） | 先写 DB，再删缓存 | 最终一致 | 低 | ✅ Prompt 缓存（读多写少） |
| Write-Through（直写） | 同时写缓存和 DB | 强一致 | 中 | 配置缓存（变更要立即生效） |
| Write-Behind（异步写回） | 先写缓存，异步刷 DB | 最弱 | 高（需刷盘兜底） | 写密集计数器（暂不用） |

为什么 Prompt 缓存选 cache-aside？Prompt 变更频率低（一天改几次），读频率高（每秒几百次），cache-aside 的"读时回填、写时删除"最简单。Write-through 要每次写都同步双写，对 Prompt 这种低频写没必要；write-behind 一致性太弱，万一 Redis 宕机丢数据风险大。

**③ 三大经典问题的防御**

```
                    ┌─────────────────────────────────┐
                    │         请求进来                  │
                    └────────────┬────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │  查 Redis (GET key)    │
                    └────────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        缓存命中            缓存未命中          缓存不存在
        (有值)              (有值=空标记)      (key 不存在)
              │                  │                  │
              ▼                  ▼                  ▼
         直接返回            返回空(防穿透)      ┌──────────┐
                                            │ 布隆过滤器 │ → 不存在直接返回(防穿透)
                                            └────┬─────┘
                                                 │ 可能存在
                                                 ▼
                                          ┌──────────────┐
                                          │ 互斥锁 SET NX │ → 拿锁查 DB 回填(防击穿)
                                          └──────┬───────┘
                                                 ▼
                                            查 DB → 回填 Redis
                                            (随机 TTL 防雪崩)
```

**穿透（Penetration）——查不存在的 key**

黑客拿不存在的 prompt_id 疯狂请求，Redis 没有，全打到 PG。两层防御：
1. 布隆过滤器（Bloom Filter）：启动时把所有有效的 prompt_id 灌进 Redis 的 Bloom Filter，请求先过布隆过滤器，不存在直接返回。代价是有误判率（说存在可能不存在，但说不存在一定不存在），我们设 1% 误判率够用。
2. 空值缓存：查 DB 也没有的 key，写一个空标记（`NULL_CACHE`，TTL 60s）到 Redis，短期内的重复请求直接命中空标记。防的就是同一不存在 key 被反复查。

**击穿（Breakdown）——热点 key 过期瞬间**

一个爆款 Prompt 过期的瞬间，几百个请求同时 miss，全部去查 PG 回填，PG 瞬间被打爆。解法是**互斥锁（Mutex）**：第一个 miss 的请求用 `SET NX` 抢锁去查 DB 回填，其它请求等待或返回旧值。代码大致：

```typescript
async function getPromptWithCache(id: string) {
  const cached = await redis.get(`prompt:${id}`);
  if (cached) return cached !== 'NULL_CACHE' ? JSON.parse(cached) : null;

  // 抢互斥锁，防击穿
  const lockOk = await redis.set(`lock:prompt:${id}`, '1', 'NX', 'EX', 3);
  if (!lockOk) {
    // 没抢到锁，短暂等待后重试读缓存（拿锁的实例正在回填）
    await sleep(50);
    return getPromptWithCache(id);
  }
  try {
    const dbVal = await pg.query('SELECT * FROM prompts WHERE id=$1', [id]);
    if (!dbVal) {
      await redis.set(`prompt:${id}`, 'NULL_CACHE', 'EX', 60); // 空值缓存
      return null;
    }
    const ttl = 300 + Math.floor(Math.random() * 60); // 随机 TTL 防雪崩
    await redis.set(`prompt:${id}`, JSON.stringify(dbVal), 'EX', ttl);
    return dbVal;
  } finally {
    await redis.del(`lock:prompt:${id}`);
  }
}
```

**雪崩（Avalanche）——大量 key 同时过期**

一批 Prompt 在同一时刻过期（比如批量导入时设了一样的 TTL），瞬间全部 miss 打 PG。解法是**随机 TTL**：基础 TTL + 随机偏移（如 300s ± 60s），让过期时间分散开。还有一招是**永不过期 + 主动刷新**——热点 Prompt 不设 TTL，靠后台任务定期刷新；Redis 挂了也别让 DB 裸奔，DB 查询本身要有限流或熔断兜底（复用 Q9 的限流器）。

**④ 缓存与 DB 双写一致性**

这是最容易被追问的点。我们的策略分两层：

**写流程（先写 DB 再删缓存）**：

```
更新 Prompt：
  ① BEGIN → UPDATE prompts SET ... WHERE id=... → COMMIT
  ② DEL redis:prompt:{id}   ← 删而不是改，下次读时回填最新值
```

为什么是"删缓存"而不是"更新缓存"？因为更新缓存有并发问题——两个写请求交错可能导致缓存里是旧值。删除是幂等的，下次读自然会回填最新。

**延迟双删（防读旧值）**：

```
① DEL redis:prompt:{id}     ← 先删一次
② UPDATE prompts ...         ← 写 DB
③ sleep(500ms)               ← 等一个读周期
④ DEL redis:prompt:{id}     ← 再删一次
```

为什么需要双删？因为"读-回填"和"写-删除"并发时，读请求可能在写请求删缓存后又把旧值回填进去。延迟双删的第二次删除就是兜底清掉这个脏回填。500ms 是我们估算的一个读周期上限。

**更彻底的方案——binlog 订阅**：

如果一致性要求极高（比如配置缓存），我们用 Canal/Debezium 订阅 PG 的 WAL（逻辑复制），binlog 变更时由专门的 worker 删缓存。好处是应用代码不用关心缓存失效（解耦），坏处是多一套 CDC 基础设施。

**一致性策略对比**：

| 策略 | 一致性 | 复杂度 | 适用场景 |
|------|--------|--------|----------|
| 先删缓存再写 DB | 弱（删了又被读回填旧值） | 低 | ❌ 不推荐 |
| 先写 DB 再删缓存 | 最终一致（秒级） | 低 | ✅ Prompt 缓存（写少） |
| 延迟双删 | 较强（覆盖读旧值窗口） | 中 | ✅ 配置/强一致场景 |
| binlog 订阅删缓存 | 强（应用解耦） | 高（需 CDC 组件） | ✅ 一致性要求极高 |

**⑤ 我们 AI Platform 的落地**

- Prompt 缓存：cache-aside + 布隆过滤器防穿透 + 互斥锁防击穿 + 随机 TTL 防雪崩 + 先写 DB 再删缓存
- 配置缓存（Provider 路由、限流规则）：write-through，变更走 Pub/Sub 通知所有实例刷新
- 用户配额：Redis 是主存（Q9 那套令牌桶），不存在缓存一致性问题

---

**🎤 面试官追问**

> 你说先写 DB 再删缓存，但如果删缓存那一步失败了怎么办？缓存里不就是脏数据了吗？

**🙋 候选人回答**

这是真实会发生的。删缓存失败有几种情况：Redis 网络抖动、Redis 正在主从切换、key 被大量访问导致 DEL 阻塞。我们的兜底是**重试 + 兜底过期**：

1. 删缓存失败时进重试队列（BullMQ），异步重试 3 次，间隔指数退避
2. 即便重试全失败，缓存里的值也有 TTL（我们 Prompt 缓存 TTL 300s），最差 5 分钟后过期自然一致——这就是"最终一致"的底线
3. 关键场景（配置类）叠加延迟双删 + binlog 订阅，多管齐下

更彻底的做法是把"写 DB + 删缓存"做成一个补偿事务：写 DB 成功后记一条"待删缓存"日志到 PG，后台 worker 扫描日志执行删除并确认，删成功才标记完成。这就是 Outbox 模式——把跨系统的最终一致性用一个本地事务 + 异步重试来保证。我们没做到这么重，因为 Prompt 缓存 5 分钟过期对业务可接受；但如果是计费/配额这种场景就必须上 Outbox。

---

**🎤 面试官继续追问**

> 布隆过滤器和互斥锁都有性能开销，你怎么权衡？还有，缓存击穿和缓存雪崩的边界在哪？

**🙋 候选人回答**

先说边界：击穿是**单个热点 key** 过期瞬间被打，雪崩是**大批 key 同时**过期。区分的意义是解法不同——击穿靠互斥锁（只锁那一个 key），雪崩靠随机 TTL（分散过期时间）。

性能开销的权衡是这样：
- 布隆过滤器：查询是 O(k) 的哈希，开销极小（微秒级），相比挡住穿透查 DB 的代价（毫秒级 + DB 压力）完全值得。我们只对"key 空间可枚举且存在大量不存在查询"的场景用，Prompt（id 可枚举）适合，用户输入的模糊搜索就不适合
- 互斥锁：只在缓存 miss 时才抢锁，命中时零开销。命中率高（>90%）时，抢锁的请求占比很低。代价是抢不到锁的请求要等待（50ms 重试），对延迟敏感的场景可以改成"返回旧值"——即缓存里保留一份旧数据（用 `GET` 拿到旧值先返回），后台异步刷新，这就是 cache-aside 的升级版 cache-refresh（类似单飞 singleflight 模式）

我们的取舍是：Prompt 缓存用互斥锁（可接受 50ms 等待），限流配额这种不能等的场景用"返回旧值 + 异步刷新"。没有银弹，看业务对延迟和一致性的容忍度。

### 🏗 架构分析

**一致性策略对比**（上文已列，核心是先写 DB 再删缓存 + 延迟双删/binlog 兜底）

**缓存模式对比**（上文已列 cache-aside vs write-through vs write-behind）

**为什么不用其它**：
- 永不设置 TTL：能彻底防雪崩，但内存只增不减，热点数据会被冷数据挤出。我们只对 top 热点 Prompt 用"逻辑过期"（value 里带过期时间，读到了发现过期就异步刷新，不依赖 Redis 的 TTL）
- 多级缓存（本地 + Redis）：本地缓存（如 Node 的 LRU）能进一步降延迟，但一致性更难保证（多实例本地缓存怎么同步）。我们 Prompt 缓存量级还没到必须上多级，Redis 一跳够用

**核心权衡**：cache-aside + 删缓存是"简单 vs 一致"的甜点。强一致场景叠加延迟双删或 binlog 订阅，但要权衡运维复杂度。一致性的底线是 TTL——再怎么出错，TTL 到了自然一致，所以**所有缓存都必须设 TTL 兜底**，这是铁律。

**未来演进**：缓存规模上来后，Redis 单实例 → Cluster（按 key 哈希分片）；强一致场景从延迟双删演进到 Outbox + binlog 订阅；多地域部署时考虑"本地 Redis + 异步同步到中心"，接受跨地域的弱一致。

### 🎯 面试官真正考察什么

1. **三大问题的区分**：能不能讲清楚穿透（不存在 key）、击穿（单热点过期）、雪崩（批量过期）的区别和对应解法，而不是一锅炖。
2. **一致性的深度**：双写一致性是真正的难点，看你懂不懂"删 vs 更新"、"先删 vs 后删"、延迟双删、binlog 订阅这些层次的取舍。
3. **实战意识**：布隆过滤器、互斥锁、随机 TTL 这些是不是结合具体场景（Prompt 缓存）讲，而不是背概念。

### ❌ 常见错误回答

- **三大问题分不清**：把穿透说成击穿，解法张冠李戴——这是最基本的概念，错了直接出局。
- **"更新缓存"而不是"删缓存"**：并发下更新缓存会写入旧值，这是经典反模式。
- **只讲防御不讲一致性**：穿透击穿雪崩背一堆，问到"删缓存失败了怎么办"答不上来。
- **没有 TTL 兜底**：所有缓存都必须有 TTL，靠 TTL 作为最终一致的最后防线，没有 TTL 是定时炸弹。

### ✅ 推荐回答

> 三大问题：穿透（查不存在的 key）→ 布隆过滤器预过滤 + 空值缓存；击穿（单热点 key 过期）→ SET NX 互斥锁只让一个请求回源，其它等待或返回旧值；雪崩（批量同时过期）→ 随机 TTL（基础+随机偏移）分散过期 + Redis 挂了 DB 限流兜底。缓存模式选 cache-aside（Prompt 读多写少）+ write-through（配置强一致）。双写一致性：先写 DB 再删缓存（删而非更新，避免并发写旧值），删失败进重试队列，兜底靠 TTL（所有缓存必设）；强一致场景叠加延迟双删（删→写 DB→sleep→再删）或 binlog 订阅（Canal/Debezium 订阅 WAL 异步删缓存，应用解耦）。我们 AI Platform：Prompt 缓存 cache-aside+布隆+互斥锁+随机 TTL+先写 DB 再删缓存；配置缓存 write-through+Pub/Sub 刷新；配额 Redis 主存无一致性问题。

### 📚 延伸知识

- **布隆过滤器**：概率型数据结构，空间效率极高，有误判（假阳性）但不会漏判，适合"缓存穿透防御"和"海量去重"。Redis Bloom 模块开箱即用。
- **Singleflight 模式**：Go 标准库的经典模式，同一 key 的并发请求只让一个去回源，其它等结果——互斥锁的优雅升级版。
- **Canal / Debezium**：MySQL binlog / PostgreSQL WAL 的 CDC（Change Data Capture）工具，订阅数据库变更驱动缓存失效，实现应用与缓存的彻底解耦。
- **Outbox Pattern**：分布式事务的最终一致性方案，把"写 DB + 发消息"用一个本地事务保证，后台 worker 异步处理消息。

---

## Q17. 设计 PostgreSQL 的分库分表方案

**🎤 面试官**

> 你们 token_usage 表记录每次 AI 调用的 token 消耗，跑了一年数据量肯定不小吧？假设现在单表已经上亿行，查询开始变慢，你给我讲讲怎么设计分库分表方案——什么时候该分、按什么分、分完跨分片查询怎么办。

**🙋 候选人回答**

这是我们正在经历的事。token_usage 表是 AI Platform 里增长最快的——每次 LLM 调用都写一条，高峰期一天百万级，一年下来轻松破亿。最早的信号是统计报表查询从 200ms 涨到 5 秒，然后是索引维护开始卡、批量插入偶尔超时。我按我们真实的演进路径讲：先做分区（partition），扛不住再分片（shard）。

**① 需求分析**

- 数据量：token_usage 单表已过亿，年增长 3~5 亿行
- 查询模式：按时间范围查（日报/月报）、按 project_id 查（项目成本）、按 user_id 查（用户用量明细）
- 非功能：写入吞吐 >10000 TPS、报表查询 <1s、历史数据归档冷存储
- 约束：PG（不支持透明的分布式事务，需中间件或应用层处理）、尽量不中断业务

**② 先别急着分库分表——三个前置手段**

很多人一上来就要分库分表，但这是最后的手段。我们按顺序评估：

| 手段 | 效果 | 代价 | 何时考虑 |
|------|------|------|----------|
| 加索引 + 优化查询 | 10 倍 | 低 | 查询慢但数据量 <5000 万 |
| 读写分离（读副本） | 读负载降 80% | 低（PG 流复制原生支持） | 读多写少，单表 <1 亿 |
| 分区表（按时间） | 单分区小，查询快 | 低（PG 原生声明式分区） | ✅ 我们当前阶段 |
| 分库分表 | 量级质变 | 极高（跨分片事务/聚合） | 单分区也扛不住时 |

**我们 token_usage 先做了按月分区**，立竿见影——查询带上时间范围只扫一两个分区，历史数据直接 detach 归档。分区扛了大概两年，直到单月分区也破亿、写入开始打满单机 IOPS，才考虑分库分表。下面讲分片方案。

**③ 分片键的选择（最关键）**

分片键选错了，后面全是坑。我们的候选：

| 分片键 | 优点 | 缺点 | 评估 |
|--------|------|------|------|
| `id`（自增/雪花） | 数据均匀 | 业务查询用不上，几乎全是跨分片 | ❌ |
| `created_at`（时间） | 时间范围查询友好 | 写入热点（最新分片被打） | △ 范围分片可考虑 |
| `project_id` | 项目维度查询单分片搞定 | 大项目数据倾斜（头部客户独占一个分片） | ✅ 配合子分片 |
| `user_id` | 用户维度查询友好 | 项目报表要跨分片聚合 | △ 看主查询路径 |

我们最终选 **`project_id` 作为主分片键 + `created_at` 作为分片内排序/分区**。理由：token_usage 最高频的查询是"某项目的用量统计"和"某项目的调用明细"，按 project 分片后这类查询命中单分片；用户维度查询（"我看自己的用量"）相对低频，走跨分片聚合可接受。大项目倾斜的问题用"一致性哈希 + 大项目单独拆子分片"解决。

**④ 范围分片 vs 哈希分片**

```
方案 A：范围分片（Range）
  Shard 1: project_id 1~1000
  Shard 2: project_id 1001~2000
  ...
  优点：范围查询友好、扩容只需加新范围
  缺点：热点（新项目都落最后一个分片）

方案 B：哈希分片（Hash）
  shard = hash(project_id) % N
  优点：数据均匀、无热点
  缺点：扩容要 rehash 全部数据、范围查询全跨分片

方案 C：一致性哈希（Consistent Hash）✅ 我们选它
  shard = consistent_hash(project_id)
  优点：扩容只迁移部分数据、分布较均匀
  缺点：实现复杂（需路由层）
```

我们选一致性哈希的原因：token_usage 会持续增长，**扩容（resharding）是必然**，一致性哈希扩容时只迁移 1/N 的数据，而普通哈希要迁移几乎全部。

**⑤ 全局唯一 ID（Snowflake）**

分片后各分片不能再用 PG 的自增序列（会冲突），需要全局 ID 生成器。我们用 Snowflake（雪花算法）：

```
| 1 bit | 41 bit 时间戳 | 10 bit 机器ID | 12 bit 序列号 |
|  不用  | ~69 年        | 1024 台机器   | 每毫秒 4096 个 |
```

生成的是趋势递增的 64 位整数，对 B-tree 索引友好（避免随机插入导致页分裂）。机器 ID 由配置中心分配（或用 PG 的序列预分配一段），保证多实例不重复。

**⑥ 跨分片查询和聚合**

这是分片最痛的地方。几种典型场景的处理：

| 场景 | 解法 |
|------|------|
| 按 project_id 查（命中单分片） | 路由层直接打到对应分片，零开销 |
| 按 user_id 查（跨分片） | fan-out 到所有分片，结果合并 |
| 聚合统计（SUM/COUNT/GROUP BY） | 各分片聚合后，协调层二次聚合 |
| 分页（LIMIT/OFFSET） | 深度分页极难，改用游标（WHERE id > last_id） |
| 跨分片 JOIN | 尽量避免；必要时用广播表（小表全分片冗余）或应用层 join |

我们的 token_usage 报表查询（如"全平台本月 token 消耗按 provider 分组"）就是 fan-out + 二次聚合：协调节点向所有分片发"本分区按 provider 分组的 SUM"，收回后在协调层再 SUM 一次。这种两层聚合对 SUM/COUNT/MIN/MAX 正确，对 AVG 要改成 SUM/COUNT 再算。

**⑦ 分布式事务**

跨分片写要分布式事务。token_usage 是单分片写（一条记录只属于一个 project_id），所以基本不用。但如果是跨项目的转账类操作（我们没有），就要上两阶段提交（2PC）或 Saga。PG 原生支持 2PC（`PREPARE TRANSACTION`），但性能差、阻塞长；我们更倾向 Saga + 补偿事务。这块我们没踩过，因为 token_usage 不涉及跨分片事务。

**⑧ 路由层方案**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 应用层路由（SDK 封装） | 灵活、可控 | 业务代码耦合分片逻辑 | ✅ 我们用（NestJS 封装 ShardRouter） |
| 中间件（Citus / pgx） | 透明、SQL 兼容 | 引入新组件、部分 SQL 不支持 | △ 评估 Citus（PG 原生扩展） |
| 代理层（如 Vitess for MySQL） | 应用无感 | PG 生态没成熟的代理 | ❌ PG 场景缺成熟方案 |

我们选应用层路由——在 NestJS 里封装一个 `ShardRouter`，根据分片键算出目标分片，业务代码调 `router.query(projectId, sql)`。代价是业务要感知分片键，但对 token_usage 这种边界清晰的表完全可控。

**⑨ Resharding（扩容迁移）流程**

```
① 双写：新分片上线，写入时同时写旧分片和新分片
② 历史数据迁移：后台任务把旧分片数据搬到新分片
③ 校验：对比新旧分片数据一致性
④ 切读：逐步把读流量切到新分片（灰度）
⑤ 下线旧分片
```

整个过程零停机，关键是双写期保证两边一致（用 Q16 的延迟双删思路）。我们还没大规模 reshard 过，但预案是这样设计的。

---

**🎤 面试官追问**

> 你说按 project_id 分片，但如果一个项目的数据特别大（头部大客户），单个分片装不下怎么办？

**🙋 候选人回答**

这就是数据倾斜。我们的做法是**"大客户单独拆子分片"**：

1. 监控各分片数据量，超过阈值（如 1 亿行）的分片标记为"热点分片"
2. 把热点分片里的超大 project 按 `project_id + created_at` 二次拆分——比如大客户 A 的数据按月再分片，落到多个物理分片
3. 路由层维护一张"分片规则表"：`project_id → shard_id`（或 `project_id + month → shard_id`），小项目走哈希，大项目走显式映射

这相当于"哈希分片为主、范围分片为辅"的混合策略。代价是路由层多一次查规则表（缓存到 Redis 消除开销），收益是解决倾斜。其实这就是动态 resharding 的一种特化——数据量变化时调整分片规则。

另一种思路是**按二级维度拆**：token_usage 按 project_id 分片后，单个 project 的数据如果还大，可以再按 `user_id` 在分片内做哈希拆表。但层级越深运维越复杂，我们优先"大客户单独拆"。

---

**🎤 面试官继续追问**

> 分库分表后，报表统计这种复杂查询怎么办？还有，历史数据要不要归档？

**🙋 候选人回答**

复杂报表查询跨分片聚合是分片的天然短板。我们的演进路径：

1. **短期**：协调层 fan-out + 二次聚合，扛得住常规报表（月度成本、TopN 项目）。延迟从单机的 200ms 变成 1~2s，可接受
2. **中期**：引入预聚合——后台任务每小时/每天把明细聚合到 `token_usage_daily` / `token_usage_monthly` 汇总表，报表查汇总表而非明细。明细表只服务于"用户查自己调用记录"这种点查
3. **长期**：明细数据进 OLAP（如 ClickHouse），PG 只保留近期热数据和汇总。ClickHouse 对聚合查询有 100 倍优势，且列存对 token_usage 这种"宽表窄查询"极度友好

历史数据归档我们已经在做：按月分区后，3 个月前的分区 detach 出来，导成 Parquet 放对象存储（S3/MinIO），PG 里只留 3 个月热数据。查询历史时走"冷热分层"——热查 PG，冷查对象存储（通过外部表或专门的查询服务）。这是成本和查询体验的平衡。

### 🏗 架构分析

**扩容路径对比**

| 方案 | 适用阶段 | 代价 | 结论 |
|------|----------|------|------|
| 加索引/优化 SQL | 单表 <5000 万 | 极低 | ✅ 第一步 |
| 读写分离 | 单表 <1 亿，读多 | 低 | ✅ 第二步 |
| 分区表（按时间/项目） | 单表 <5 亿 | 低（PG 原生） | ✅ 第三步（我们当前） |
| 分库分表 | 单表 >5 亿 或分区扛不住 | 极高 | ✅ 第四步（预案就绪） |

**为什么不用其它**：
- 直接上 Cassandra/MongoDB 这类原生分布式库：放弃 PG 的事务和生态（JOIN、jsonb、丰富的 SQL），token_usage 的复杂统计需求不适合。我们更愿意"先用尽 PG 再分片"
- NewSQL（TiDB/CockroachDB）：兼容 PG 协议（CockroachDB）、自动分片、分布式事务，看起来很美，但运维成本高、私有部署复杂、团队学习曲线陡。我们评估过，结论是"规模到几十亿行且分布式事务是硬需求时再考虑"

**核心权衡**：分库分表是**不可逆的复杂度跃升**——一旦分了，跨分片查询、聚合、事务、扩容迁移都是长期负担。所以判据是"分区 + 读写分离 + 预聚合 + OLAP 卸载 都用尽后还扛不住，才分片"。很多场景其实用 OLAP（ClickHouse）卸载分析负载，PG 只扛事务和近期热数据，根本不用分片。我们的演进是：分区（已做）→ 预聚合（做）→ ClickHouse 卸载（规划）→ 分片（最后手段）。

**未来演进**：token_usage 这类日志型数据，终极形态是 PG 存元数据和近期明细 + ClickHouse 存全量明细 + 对象存储归档冷数据。业务库（projects/users/prompts）单机 PG + 读写分离够用很多年，不轻易分片。

### 🎯 面试官真正考察什么

1. **克制分片的判断力**：能不能讲清楚"分库分表是最后手段"，先穷尽索引、读写分离、分区、OLAP 卸载——这是工程成熟度的体现，不是上来就分。
2. **分片键的权衡**：分片键选错全盘皆输，看你能不能根据查询模式（按项目？按用户？按时间？）做取舍，并处理倾斜。
3. **跨分片难题的意识**：聚合、JOIN、分页、事务这些分片后的硬伤，知不知道解法（预聚合、广播表、游标分页、Saga）和代价。

### ❌ 常见错误回答

- **"单表慢了就分库分表"**：不分场景，没有前置手段（索引/读写分离/分区/OLAP），过度工程化的典型。
- **分片键乱选**：按 id 分片（业务查询用不上）、按时间分片（写入热点），不讲查询模式。
- **不讲跨分片代价**：只说"分了就快了"，回避聚合、JOIN、事务的复杂度。
- **没有全局 ID 方案**：分片后还用自增序列会冲突，必须 Snowflake 或类似方案。

### ✅ 推荐回答

> 演进路径：加索引/优化 SQL → 读写分离 → 分区表（token_usage 按月分区，PG 原生声明式分区，历史分区 detach 归档对象存储）→ 分库分表（最后手段）。分片键选 project_id（最高频查询是按项目统计+明细，命中单分片），大客户倾斜用"大项目单独拆子分片 + 路由规则表"。分片方式选一致性哈希（扩容只迁移 1/N 数据）。全局 ID 用 Snowflake（趋势递增、对 B-tree 友好）。跨分片查询：按 project 单分片零开销、按 user fan-out、聚合走两层（各分片聚合+协调层二次聚合，AVG 改 SUM/COUNT）、分页改游标、JOIN 尽量避免或用广播表。分布式事务：token_usage 单分片写不涉及，跨分片用 Saga+补偿，PG 原生 2PC 性能差慎用。路由层应用层封装（NestJS ShardRouter，业务传分片键）。Resharding：双写→迁移→校验→灰度切读→下线旧分片，零停机。报表查询：短期 fan-out 聚合，中期预聚合（daily/monthly 汇总表），长期 ClickHouse 卸载 OLAP 负载。核心原则：分片是不可逆复杂度跃升，先用尽 PG 再分。

### 📚 延伸知识

- **PostgreSQL 声明式分区**：PG 10+ 原生支持 RANGE/LIST/HASH 分区，分区可 detach/attach，是分片前的最佳过渡方案。
- **Snowflake ID**：Twitter 开源的全局唯一 ID 算法，64 bit = 时间戳 + 机器 ID + 序列号，趋势递增。变体有 Sonyflake、百度 UidGenerator。
- **Citus**：PG 的分布式扩展（被微软收购），把 PG 变成分布式数据库，透明分片 + 分布式查询，是"轻量分片"的备选。
- **ClickHouse / Doris**：OLAP 列存引擎，对聚合查询有数量级优势，适合做 PG 的分析负载卸载，是"不分片也能扛大数据量"的关键。
- **一致性哈希**：分布式系统的经典算法（Dynamo 论文），扩缩容时只迁移最小数据量，是 Redis Cluster、Cassandra 的基础。

---

## Q18. 设计一个内容搜索系统

**🎤 面试官**

> 你们平台每天生成大量 AI 内容——漫剧、视频、图片，用户要在自己创作的内容里搜东西，按标题、标签、剧情描述找。给我设计一个内容搜索系统，要支持中文搜索、按相关性排序，最好还能"搜语义相近的"。

**🙋 候选人回答**

这是我们漫剧平台真实的需求。用户创作几百个漫剧后，找具体某个就靠搜索；运营也要按标签筛选内容做推荐位。最早的方案是 PG 的 `LIKE '%关键词%'`，问题是全表扫描、不支持中文分词、相关性排序为零。后来我们上了 Elasticsearch 做关键词搜索，又叠加了向量搜索做语义检索。我按这个演进讲。

**① 需求分析**

- 功能：按标题/标签/剧情描述/角色名搜索；中文分词；按相关性排序；支持"语义相近"搜索；按时间/热度/质量二次排序
- 非功能：搜索延迟 <200ms、索引近实时（数据写入到可搜 <5s）、日均搜索量百万级
- 数据特征：漫剧/视频的元数据（标题、标签、描述、角色）+ 生成参数（提示词、模型）+ 用户行为（点赞、完播率）
- 约束：已有 PG（元数据主存）+ Redis，私有部署可用 ES

**② 架构总览**

```
┌──────────────┐   写入/更新内容
│  业务服务    │ ──────┐
│ (NestJS)     │       │
└──────────────┘       ▼
                 ┌──────────────┐
                 │  PostgreSQL  │ ← 元数据主存（drama/video 表）
                 │  (主库)      │
                 └──────┬───────┘
                        │ WAL 逻辑复制 (CDC)
                        ▼
                 ┌──────────────┐
                 │ Debezium /   │ → 捕获变更事件
                 │ WAL 解析     │
                 └──────┬───────┘
                        │ 变更消息（Kafka/Stream）
                        ▼
                 ┌──────────────┐    ┌──────────────┐
                 │  Indexer     │ →  │  Embedding   │
                 │  Worker      │    │  Worker      │
                 │ (写 ES 文档) │    │ (调模型生成向量)
                 └──────┬───────┘    └──────┬───────┘
                        │                   │
                        ▼                   ▼
                 ┌──────────────┐    ┌──────────────┐
                 │ Elasticsearch│    │ 向量索引     │
                 │ (倒排索引)   │    │ (ES kNN 或  │
                 │  关键词搜索  │    │  pgvector)  │
                 └──────┬───────┘    └──────┬───────┘
                        │                   │
                        └─────────┬─────────┘
                                  ▼
┌──────────────┐   搜索请求      ┌──────────────┐
│  前端/客户端 │ ──────────────▶ │  Search API  │
└──────────────┘                 │ (NestJS)     │
       ▲                         │  混合检索 +  │
       │                         │  排序融合    │
       │                         └──────────────┘
       └───────── 返回结果（关键词 + 语义候选融合排序）
```

**③ 核心组件：倒排索引与中文分词**

ES 的核心是**倒排索引**——不是"文档→词"，而是"词→包含它的文档列表"。搜索时先分词，再查倒排索引拿到候选文档，按相关性打分。

中文分词是关键。英文按空格分词就行，中文不行——"AI漫剧生成平台"要切成"AI/漫剧/生成/平台"而不是单字。我们用 **IK 分词器**（ES 插件），它有两套粒度：
- `ik_smart`：粗粒度，适合索引（"漫剧生成" → "漫剧"/"生成"）
- `ik_max_word`：细粒度，适合搜索（切出尽可能多的词）

还有自定义词典——我们把平台专有词（角色名、模型名、业务术语）加进 IK 词典，否则"通义千问"会被切成"通/义/千/问"。词典要热更新（不重启 ES 生效），IK 支持远程词典。

**④ 相关性打分：BM25**

ES 默认用 BM25（TF-IDF 的改进版）打分：

- TF（词频）：词在文档出现越多越相关，但有饱和（出现 10 次不比 5 次相关 2 倍）
- IDF（逆文档频率）：词在越多文档出现越不重要（"的"出现在所有文档，权重低）
- 文档长度归一化：短文档命中权重更高

我们除了 BM25，还叠加业务权重：标题命中 > 标签命中 > 描述命中；热门内容（高点赞/完播）加权；新内容有 freshness boost。这是在 `_score` 基础上用 `function_score` 做的二次排序。

**⑤ 混合搜索：关键词 + 向量（语义）**

关键词搜索的短板是"字面匹配"——搜"卡通短片"找不到只写了"动漫视频"的内容。语义搜索用 Embedding 向量解决：把内容文本编码成向量，搜索时把查询也编码成向量，用相似度（cosine）找最近邻。

```
混合检索流程：
  ① 关键词查询 → ES 倒排索引 → top 50 候选（按 BM25）
  ② 查询文本 → Embedding → 向量索引 kNN → top 50 候选（按 cosine）
  ③ 两路候选合并 → 重排（RRF 或加权融合）→ top 20 返回
```

向量索引我们选了 **ES 的 kNN（dense_vector）**——不引入新组件（pgvector 也可，但 ES 已在用）。Embedding 用通义的文本模型生成，索引时由 Embedding Worker 异步算（写入后几秒内完成）。

**融合排序用 RRF（Reciprocal Rank Fusion）**：不看分数只看排名，`score = Σ 1/(k + rank_i)`，对两路结果都很稳健（避免不同打分体系量纲不一致的问题）。简单有效，是我们的首选。

**⑥ 索引同步：CDC 管道**

元数据主存在 PG，搜索在 ES，怎么保持同步？我们用 CDC（Debezium 订阅 PG WAL）：

```
PG 写入 → WAL → Debezium → Kafka → Indexer Worker → ES
```

为什么用 CDC 而不是应用双写？三个理由：
1. **解耦**：业务代码不关心 ES，改 PG 自动同步
2. **可靠性**：WAL 是 PG 事务的产物，不会丢；应用双写要处理"写 PG 成功写 ES 失败"的一致性
3. **历史数据**：初次全量同步也能从 WAL 重放

代价是多一套 CDC 基础设施（Debezium + Kafka），但搜索场景的"近实时"要求（5 秒延迟）CDC 完全满足。Embedding 向量也走类似管道——CDC 触发后，Embedding Worker 调模型算向量写进 ES 的 dense_vector 字段。

**⑦ 索引设计（ES Mapping）**

```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "title": { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "tags": { "type": "keyword" },
      "description": { "type": "text", "analyzer": "ik_max_word" },
      "characters": { "type": "keyword" },
      "status": { "type": "keyword" },
      "like_count": { "type": "integer" },
      "created_at": { "type": "date" },
      "embedding": { "type": "dense_vector", "dims": 1024, "index": true, "similarity": "cosine" }
    }
  }
}
```

关键点：`title`/`description` 用 text 类型 + IK 分词（可全文搜），`tags`/`characters` 用 keyword（精确匹配+聚合），`embedding` 用 dense_vector 开 kNN 检索。索引和搜索用不同分词器（索引细、搜索粗）是 IK 的常见配置。

---

**🎤 面试官追问**

> 搜索结果怎么排序才合理？纯相关性还是 popularity 优先？还有，新建的内容刚出来没有行为数据，怎么排？

**🙋 候选人回答**

排序是搜索系统的灵魂。我们的策略是**多层因子加权**，不是单一指标：

```
final_score = 
    α * BM25_score(归一化)     // 文本相关性
  + β * popularity_score        // 热度（点赞+完播率，对数衰减防刷）
  + γ * freshness_score         // 新鲜度（时间衰减）
  + δ * quality_score           // 质量分（人工标注/举报惩罚）
```

权重（α/β/γ/δ）按场景调：搜索默认偏相关性（α 大），推荐位偏热度（β 大），"最新发布"页偏新鲜度（γ 大）。这是 ES 的 `function_score` 实现的。

**冷启动问题**——新内容没行为数据，popularity 是 0 会被埋没。我们的解法：
1. **新鲜度 boost**：新内容在发布后 24~72 小时有 freshness 加成，给它曝光机会
2. **质量分兜底**：用内容本身特征（分辨率、时长、是否高清）给个初始质量分
3. **探索流量**：留一小部分流量做 bandit（如 Thompson Sampling），把新内容随机曝光收集反馈，逐步收敛到真实 popularity

这是"排序公平性"问题——只按 popularity 排会导致马太效应（热门的越来越热，新的永无出头）。freshness boost + 探索流量是标准解法。

---

**🎤 面试官继续追问**

> 为什么不直接用 PG 的全文搜索（pg_trgm / pgvector）？一定要上 ES 吗？

**🙋 候选人回答**

这是核心选型问题。我们的考量：

**PG 全文搜索（tsvector + pgvector）**：
- 优点：单库搞定、零额外组件、事务一致（写完立即能搜）
- 缺点：中文分词要靠 zhparser/jieba（不如 IK 成熟）、复杂打分和多因子排序不如 ES 灵活、大数据量下倒排索引性能不如 ES、不支持分布式扩展

**Meilisearch**：
- 优点：轻量、开箱即用、中文分词还不错、延迟低
- 缺点：不支持向量搜索（截至我们选型时）、生态不如 ES、大规模数据经验少

**Elasticsearch**：
- 优点：倒排索引成熟、IK 中文分词强、kNN 向量检索、聚合分析强、生态丰富（Kibana/Logstash）、水平扩展
- 缺点：重（JVM、吃内存）、运维复杂、与 PG 双库有一致性维护成本

**我们的取舍**：

| 需求 | PG | Meilisearch | ES |
|------|----|-------------|----|
| 中文分词 | 一般（zhparser） | 好 | 好（IK，可定制） |
| 向量搜索 | ✅ pgvector | ❌（选型时） | ✅ dense_vector |
| 多因子排序 | 弱 | 中 | ✅ 强（function_score） |
| 大规模扩展 | 弱（单机为主） | 中 | ✅ 分布式 |
| 运维成本 | 低 | 低 | 高 |
| 数据一致性 | ✅ 强（单库） | 弱（CDC） | 弱（CDC） |

最终选 ES 的关键理由：我们需要**关键词 + 向量混合搜索 + 复杂排序**，ES 是唯一三合一的方案。如果只是简单关键词搜索，Meilisearch 更轻；如果数据量小且要强一致，PG pgvector 够用。

**混合策略的现实**：我们其实也用了 pgvector——做"用户看某个漫剧后推荐相似内容"时，向量数据量小（活跃内容几千条），直接在 PG 里用 pgvector 做最近邻，省去走 ES 一跳。大规模全文搜索才走 ES。这是"用对工具"而非"一把梭"。

### 🏗 架构分析

**搜索引擎选型对比**（上文表格已列）

**索引同步方案对比**

| 方案 | 实时性 | 可靠性 | 解耦度 | 结论 |
|------|--------|--------|--------|------|
| 应用双写（写 PG 同时写 ES） | 强（事务内） | 中（双写失败要补偿） | 低（业务耦合） | △ 简单但脏 |
| CDC 订阅 WAL（Debezium） | 近实时（秒级） | 高（基于事务日志） | 高 | ✅ 选它 |
| 定时全量同步 | 差（分钟~小时级） | 高 | 高 | ❌ 仅冷数据重建 |

**为什么不用其它**：
- 应用双写：业务代码每个写操作都要同步写 ES，逻辑散落，且双写失败的一致性处理复杂。CDC 把"写 PG"和"同步 ES"彻底解耦
- MQ 异步消息（业务发消息）：比双写好，但消息可靠性要自己保证（Outbox 模式）。CDC 直接基于 DB 日志，更可靠
- 定时全量：只能做兜底（索引重建），不能做日常增量

**核心权衡**：CDC 带来"近实时 + 解耦 + 可靠"，代价是"多一套 Debezium + Kafka 基础设施"和"秒级延迟"。搜索场景能容忍 5 秒延迟，CDC 是甜点。如果要求"写完立即能搜"（强一致），就只能接受应用双写的复杂度。

**中文分词的坑**：IK 分词器对"新词"（网络流行语、产品名）识别差，必须维护自定义词典并热更新；同义词（"漫剧"="动漫短剧"）要配 synonym filter；拼音搜索（搜"manju"找到"漫剧"）要叠加 pinyin analyzer。这些都是 ES 中文化实战才会踩的细节。

**未来演进**：向量搜索规模上来后，可能引入专用向量库（Milvus/Qdrant）——ES 的 HNSW 索引内存占用大，亿级向量时不如专用库高效；个性化搜索（结合用户画像 re-rank）；多模态搜索（用图片搜相似视频，靠 CLIP 生成图文统一向量）。

### 🎯 面试官真正考察什么

1. **倒排索引 + 分词的理解**：会不会只说"用 ES"而讲不清倒排索引原理、中文分词（IK）的配置、自定义词典——这是搜索系统的底层基础。
2. **混合搜索的设计**：关键词 + 向量 + 业务权重的多因子融合，懂不懂 RRF、function_score 这些融合排序的手段。
3. **索引同步的权衡**：CDC vs 应用双写 vs 定时同步的取舍，看你懂不懂"为什么用 Debezium 订阅 WAL"而不是无脑双写。

### ❌ 常见错误回答

- **"用 ES 就行"**：不讲倒排索引、不讲中文分词、不讲同步管道，停在工具名称。
- **中文分词只字不提**：直接用 ES 默认分词器，中文被切成单字，搜索效果极差。
- **没有索引同步方案**：数据在 PG，搜索在 ES，怎么同步讲不清——这是工程落地的核心难点。
- **忽视向量搜索**：只讲关键词搜索，题目明确要"语义相近"，答非所问。

### ✅ 推荐回答

> 需求：中文搜索（标题/标签/描述/角色）+ 相关性排序 + 语义搜索 + 业务因子加权。架构：PG 元数据主存 → Debezium 订阅 WAL → Kafka → Indexer Worker 写 ES + Embedding Worker 算向量写 dense_vector → ES（倒排索引 + dense_vector kNN）。核心：倒排索引（词→文档列表）+ IK 中文分词（ik_smart 粗搜索/ik_max_word 细索引 + 自定义词典热更新专有词）+ BM25 打分（TF/IDF/文档长度归一）+ 混合搜索（关键词 BM25 top50 + 向量 cosine top50 → RRF 融合重排 top20）+ function_score 业务加权（标题>标签>描述，热度/新鲜度/质量分多层因子）。索引同步选 CDC（解耦+可靠+近实时秒级，代价是 Debezium+Kafka 基础设施；应用双写耦合脏、定时全量延迟高）。排序：final=αBM25+βpopularity+γfreshness+δquality，新内容冷启动靠 freshness boost+探索流量防马太效应。选型对比：PG 全文搜索（中文分词弱、多因子排序弱）、Meilisearch（轻但选型时无向量）、ES（三合一：倒排+IK+kNN+function_score+分布式）。现实是 pgvector 也用——小规模相似推荐（千级活跃内容）直接 PG pgvector 省一跳，大规模全文搜索走 ES。

### 📚 延伸知识

- **倒排索引**：搜索引擎的核心数据结构，Lucene（ES 底层）的实现是 FST（有限状态转换器）+ posting list，理解它才能调优索引大小和查询性能。
- **BM25 / TF-IDF**：相关性打分的经典算法，BM25 是 TF-IDF 的改进（词频饱和 + 文档长度归一），ES 默认打分。
- **IK 分词器 / jieba**：ES 中文分词的主流方案，IK 适合搜索（细粒度+词典），jieba 适合预处理。自定义词典和同义词配置是中文化必做项。
- **HNSW 算法**：近似最近邻搜索（ANN）的主流算法，ES dense_vector 和 Milvus/Qdrant 都用它，理解"精度 vs 内存 vs 延迟"的三角权衡。
- **RRF（Reciprocal Rank Fusion）**：多路搜索结果融合的经典算法，不看分数看排名，对量纲不一致的打分体系很稳健。
- **Milvus / Qdrant / Weaviate**：专用向量数据库，亿级向量时比 ES 的 kNN 更高效，是向量搜索规模化的演进方向。

---

## 本章总结

第九章 15 道系统设计题。核心是展示设计思路而非背答案。每题遵循：

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

# 第七章 Redis

> Redis 是我们技术栈的核心组件——BullMQ 的队列、缓存的存储、Pub/Sub 的通信、分布式锁的基础。本章不背 Redis 命令，而是结合 Task Platform 和 AI Platform 讨论真实场景中的 Redis 使用。
>
> 本章共 8 题。

---

## Q1. 为什么 BullMQ 选择 Redis？

**🎤 面试官**

> BullMQ 底层依赖 Redis。为什么不设计成依赖 PostgreSQL？PG 也能做队列（比如用 SELECT FOR UPDATE）。

**🙋 候选人回答**

**Redis 适合队列的三个特性，PG 都不具备：**

**① 内存级速度**

队列操作（入队 LPUSH、出队 BRPOPLPUSH）是高频操作——每秒可能几千次。Redis 内存操作延迟 <1ms，PG 磁盘操作延迟 ~10ms。10 倍差距。

**② 原子操作**

Redis 的 BRPOPLPUSH 是单命令原子操作——"从 A 取出放入 B"不会被打断。PG 要用事务模拟（BEGIN; SELECT ... FOR UPDATE; UPDATE ...; COMMIT），更慢且有死锁风险。

**③ 数据结构丰富**

Redis 有 List（队列）、Sorted Set（优先级/延迟）、Hash（任务数据）、Pub/Sub（事件通知）。BullMQ 用这些数据结构组合出完整的任务系统。PG 只有表，要用表模拟队列，笨重。

**但 PG 也有 Redis 不具备的：持久化可靠性。** Redis 的持久化（RDB/AOF）不是同步的，崩溃可能丢数据。PG 的 WAL 是同步的，崩溃不丢。所以我们的设计是 Redis 做队列（快）+ PG 做状态持久化（可靠），两者分工（第四章 Q9）。

### 🏗 架构分析

- **为什么这么设计？** BullMQ 的队列本质是"高频读写 + 原子流转"的场景，需要的是吞吐和低延迟，而 Redis 的内存模型 + 单线程原子命令天然契合。Task Platform 的任务每秒入队/出队/状态流转几百到上千次，把这部分放在内存里，把"最终状态"沉淀到 PG，形成"快路径 + 可靠路径"的分层。
- **为什么不用其它方案？**
    | 方案 | 速度 | 原子性 | 数据结构 | 持久化 | 结论 |
    |------|------|--------|----------|--------|------|
    | Redis（BullMQ 选型） | 内存级 <1ms | 单命令原子（LPUSH/BRPOPLPUSH） | List/Sorted Set/Hash/Pub-Sub | RDB/AOF（异步，可能丢） | 队列首选 |
    | PostgreSQL（SELECT FOR UPDATE） | 磁盘 ~10ms | 需事务模拟，有死锁风险 | 只有表 | WAL 同步，可靠 | 做状态持久化，不做队列 |
    | RabbitMQ / Kafka | 内存+磁盘 | 强 | 队列模型成熟 | 可配置 | 多一套中间件，运维成本翻倍，且与 BullMQ（Node 生态）集成不如 Redis 原生 |
- **权衡**：用 Redis 换来了速度，代价是持久化可靠性弱（主从异步、AOF 也有窗口）。我们的兜底是 PG 双写——Redis 丢了任务用 PG 的任务表恢复（第四章 Q9）。本质是"用一致性换吞吐"，而不是假装 Redis 既能快又能可靠。
- **未来演进**：当单 Redis 写到瓶颈，第一选择不是直接上 Cluster（BullMQ 兼容性差，见 Q2），而是按业务域拆多个 Redis 实例（视频生产 / AI 推理 / BullMQ 各一），拓扑更简单。真正海量时再评估 Kafka 替代 BullMQ 的持久队列。

### 🎯 面试官真正考察什么

不是问"Redis 是什么"，而是考察候选人能否把中间件选型还原成工程权衡——为什么 Task Platform 的队列层选 Redis、状态层选 PG，而不是"一个数据库打天下"。能讲出"快路径 + 可靠路径分层"的人，才是真做过系统设计。

### ❌ 常见错误回答

- 只背"Redis 快，所以用它做队列"——没说快在哪、快换来什么代价。
- 把 PG 和 Redis 对立成"二选一"，给不出分工理由，暴露没做过分布式系统。
- 列一堆 Redis 命令（LPUSH/RPUSH/BRPOP）当成答案，纯八股，不解释原子操作和死锁规避的工程意义。

### ✅ 推荐回答

> Redis 适合队列三个特性：① 内存级速度（LPUSH/BRPOPLPUSH 延迟<1ms，PG 磁盘~10ms，10 倍差距）；② 原子操作（BRPOPLPUSH 单命令原子"从 A 取出放入 B"不可打断，PG 要事务模拟更慢有死锁风险）；③ 数据结构丰富（List 队列+Sorted Set 优先级/延迟+Hash 任务数据+Pub/Sub 通知，PG 只有表）。但 PG 有 Redis 没有的持久化可靠性——Redis RDB/AOF 非同步可能丢数据，PG WAL 同步不丢。所以 Redis 做队列（快）+ PG 做状态持久化（可靠），两者分工。

### 📚 延伸知识

- **Redis Persistence**：RDB（快照，定期全量）vs AOF（日志，每次写追加）。AOF 更可靠但文件大。可组合使用。

---

## Q2. Redis 挂了怎么办？

**🎤 面试官**

> 这个问题第四章 Q9 讲过可靠性方案。这里我想深入聊 Redis 的高可用架构本身——主从、哨兵、Cluster 你选哪个？

**🙋 候选人回答**

**我们用主从 + Sentinel（哨兵），不用 Cluster。**

**三种方案对比：**

| 方案 | 拓扑 | 优点 | 缺点 | 适合 |
|------|------|------|------|------|
| 主从 | 1 Master + N Slave | 读写分离、备份 | 手动故障转移 | 小规模 |
| Sentinel | 主从 + 哨兵监控 | 自动故障转移 | 单 Master 写瓶颈 | 中规模（我们） |
| Cluster | 多 Master 分片 | 水平扩展写 | 运维复杂、BullMQ 兼容性 | 大规模 |

**为什么不用 Cluster？**

BullMQ 对 Redis Cluster 的兼容性有问题——BullMQ 的任务操作涉及多个 key（任务数据 Hash + 队列 List + 优先级 Sorted Set），Cluster 下这些 key 可能在不同分片，跨分片操作要用 hash tag（`{tag}key`）强制同分片。配置复杂且容易出错。

**Sentinel 方案够用**——单 Master 写性能（~10 万 QPS）对我们的任务量（日几万）绰绰有余。等流量增长到单 Master 瓶颈，再考虑 Cluster 或按业务类型分到不同 Redis 实例。

**Sentinel 的工作原理：**

```
3 个 Sentinel 节点监控 Master
  → Master 挂了
  → Sentinel 之间投票（quorum）
  → 选举一个 Slave 升级为新 Master
  → 通知客户端（BullMQ）连新 Master
  → 自动恢复，无需人工介入
```

**故障转移的盲区**：主从同步是异步的，Master 写入后未同步到 Slave 就挂了，这条数据丢失。我们用 PG 双写兜底（第四章 Q9）——Redis 丢了用 PG 恢复。

### 🏗 架构分析

- **为什么这么设计？** 选型不是"越强越好"，而是"够用且最简"。我们 Task Platform 的任务是日几万级别，单 Master ~10 万 QPS 的写吞吐完全够，瓶颈不在 Redis 写能力而在下游 Worker 处理速度。这时候花大力气上 Cluster 是典型的过度设计。
- **为什么不用其它方案？**
    | 方案 | 拓扑 | 自动故障转移 | 写扩展 | 运维复杂度 | BullMQ 兼容 | 结论 |
    |------|------|------------|--------|-----------|------------|------|
    | 纯主从 | 1 Master + N Slave | 否（手动） | 否 | 低 | 好 | 备份够，故障要人工 |
    | 主从 + Sentinel（我们） | 主从 + 3 哨兵 | 是 | 否（单 Master） | 中 | 好 | 当前规模最优 |
    | Cluster | 多 Master 分片 | 是 | 是 | 高 | 差（多 key 要 hash tag） | 规模没到，不值当 |
- **权衡**：Sentinel 换来了"自动故障转移 + 零运维介入"，代价是主从异步带来的少量丢数据风险。我们用 PG 双写兜底这个窗口（Redis 丢、PG 不丢，重建时从 PG 回灌），而不是去追求 Redis 自己强一致——后者代价远大于双写。
- **未来演进**：到单 Master 写瓶颈时，先做"业务域拆分"（不同业务用不同 Redis 实例，拓扑简单、风险隔离），而非直接上 Cluster。只有当单一业务域本身写量爆炸，才评估 Cluster 或迁移到 Kafka 持久队列。

### 🎯 面试官真正考察什么

考察候选人对"高可用方案选型"的工程判断——能不能根据当前业务规模在主从/Sentinel/Cluster 间做取舍，而不是无脑选"最强的 Cluster"。真正值钱的是知道"什么时候不上 Cluster"（BullMQ 多 key 兼容性、运维成本），以及怎么兜底主从异步丢数据。

### ❌ 常见错误回答

- 背三种方案的名词定义，但说不出"我们为什么选 Sentinel 不选 Cluster"。
- 答"选 Cluster 因为最强"——忽视 BullMQ 多 key 跨分片问题，也没结合自己业务量。
- 把"主从异步可能丢数据"当成"Redis 的 bug"，给不出 PG 双写的兜底设计，暴露没做过可靠系统。

### ✅ 推荐回答

> 用主从+Sentinel 不用 Cluster。Sentinel 自动故障转移：3 个哨兵监控 Master，挂了投票选举 Slave 升级新 Master 通知 BullMQ 连新 Master。不用 Cluster 因为 BullMQ 对 Cluster 兼容性有问题——任务操作涉及多 key（Hash+List+Sorted Set）可能跨分片，要 hash tag 强制同分片配置复杂。Sentinel 够用——单 Master ~10 万 QPS 对日几万任务绰绰有余。故障转移盲区：主从异步同步 Master 未同步就挂了丢数据，PG 双写兜底恢复。流量到单 Master 瓶颈再考虑 Cluster 或按业务分 Redis 实例。

### 📚 延伸知识

- **Redis Sentinel Quorum**：哨兵投票的法定人数。3 个哨兵配 quorum=2，2 个同意才故障转移。防止单哨兵误判。
- **Redis Cluster Hash Tag**：`{user:1000}:tasks` 和 `{user:1000}:profile` 会在同一分片（大括号内相同）。

---

## Q3. 缓存如何设计？

**🎤 面试官**

> 你们用 Redis 做缓存，缓存策略是什么？缓存穿透、击穿、雪崩怎么防？

**🙋 候选人回答**

**我们的缓存场景：AI Platform 的 Prompt 缓存、配置缓存、限流计数器。**

**缓存策略：Cache-Aside（旁路缓存）**

```typescript
async function getPrompt(promptId: string): Promise<Prompt> {
  // 1. 先查缓存
  const cached = await redis.get(`prompt:${promptId}`);
  if (cached) return JSON.parse(cached);
  
  // 2. 缓存没有，查数据库
  const prompt = await prisma.prompt.findUnique({ where: { id: promptId } });
  if (!prompt) throw new NotFoundError();
  
  // 3. 写入缓存（带 TTL）
  await redis.set(`prompt:${promptId}`, JSON.stringify(prompt), 'EX', 300);  // 5 分钟
  return prompt;
}
```

**三个经典问题的防御：**

**① 缓存穿透（查不存在的数据，每次都打到 DB）**

```typescript
// 缓存空值
async function getPrompt(promptId: string) {
  const cached = await redis.get(`prompt:${promptId}`);
  if (cached === 'null') return null;  // 缓存了空值
  if (cached) return JSON.parse(cached);
  
  const prompt = await prisma.prompt.findUnique({ where: { id: promptId } });
  if (!prompt) {
    await redis.set(`prompt:${promptId}`, 'null', 'EX', 60);  // 空值缓存 60 秒
    return null;
  }
  // ...
}
```

**② 缓存击穿（热点 key 过期瞬间大量请求打到 DB）**

```typescript
// 互斥锁：只有一个请求查 DB，其他等
async function getPromptWithLock(promptId: string) {
  const cached = await redis.get(`prompt:${promptId}`);
  if (cached) return JSON.parse(cached);
  
  // 获取互斥锁
  const lockKey = `lock:prompt:${promptId}`;
  const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);
  
  if (acquired) {
    // 拿到锁，查 DB
    const prompt = await prisma.prompt.findUnique({ where: { id: promptId } });
    await redis.set(`prompt:${promptId}`, JSON.stringify(prompt), 'EX', 300);
    await redis.del(lockKey);
    return prompt;
  } else {
    // 没拿到锁，等一下重试
    await sleep(100);
    return getPromptWithLock(promptId);
  }
}
```

**③ 缓存雪崩（大量 key 同时过期）**

```typescript
// 随机 TTL 防同时过期
const ttl = 300 + Math.floor(Math.random() * 60);  // 300-360 秒
await redis.set(key, value, 'EX', ttl);
```

**但我们大部分场景不需要这么复杂**——Prompt 变更频率低、数据量不大，简单的 Cache-Aside + TTL 够用。过度防御增加代码复杂度。只在真正的热点数据上用互斥锁。

### 🏗 架构分析

- **为什么这么设计？** AI Platform 的 Prompt、模型配置、限流计数器是典型的"读多写少 + 容忍短时不一致"场景，天然适合 Cache-Aside。核心思路是"让热数据离应用最近"，把 DB 从读压力里解放出来。
- **为什么不用其它方案？**
    | 策略 | 写入方式 | 一致性 | 复杂度 | 适合 | 结论 |
    |------|---------|--------|--------|------|------|
    | Cache-Aside（我们） | 读时填充，写时删缓存 | 最终一致 | 低 | 读多写少 | 当前场景最优 |
    | Write-Through | 写缓存同步写 DB | 强一致 | 中（要缓存层拦截写） | 写多 | 多一层抽象，不划算 |
    | Write-Behind | 写缓存异步刷 DB | 弱一致 | 高（要刷盘/容错） | 写极多 | 我们没这量级 |
- **三个经典问题的防御层级**：穿透（空值缓存 / 布隆过滤器）、击穿（互斥锁 SET NX）、雪崩（随机 TTL）。但关键是"按需防御"——我们 Prompt 变更低频、数据量不大，简单 Cache-Aside + TTL 就够；互斥锁只在真正的热点 key 上用，避免过度设计。
- **权衡**：用 Cache-Aside 换来简单和可控，代价是写后短时不一致（先删缓存还是先更新库的竞态）。我们的实践是"先更新 DB 再删缓存 + 短 TTL 兜底"，一致性要求高的场景再上延迟双删。
- **未来演进**：当出现真正的超热点（如某爆款 Prompt 被 QPS 万级读取），会从"应用层缓存"演进到"CDN + 本地缓存（如 node-cache）+ Redis"三级缓存，把 Redis 作为 L2，进一步降低单点压力。

### 🎯 面试官真正考察什么

不是问"背一下三大问题"，而是考察候选人能否分场景取舍——什么数据值得缓存、什么防御值得加。能说出"大部分场景简单 Cache-Aside + TTL 够用，只在热点 key 上加锁"的人，比能背全套互斥锁代码的人值钱。

### ❌ 常见错误回答

- 把穿透/击穿/雪崩三个概念背一遍，但说不清三者区别（穿透是查不存在的、击穿是热点过期、雪崩是批量过期）。
- 不管什么场景都堆全部防御（空值 + 互斥锁 + 布隆过滤器 + 随机 TTL），暴露不懂"按需防御"的过度设计。
- 写一致性答"先删缓存再更新库"，不知道这会有读请求把旧值回写缓存的竞态。

### ✅ 推荐回答

> Cache-Aside 策略：先查缓存→没有查 DB→写入缓存（带 TTL）。三个问题防御：① 穿透（查不存在数据每次打 DB）——缓存空值 60 秒；② 击穿（热点 key 过期瞬间大量请求打 DB）——互斥锁 SET NX 只一个请求查 DB 其他等重试；③ 雪崩（大量 key 同时过期）——随机 TTL（300+random(60)）。但大部分场景简单 Cache-Aside+TTL 够用，不过度防御。只在真正热点数据用互斥锁。我们的缓存场景：Prompt 缓存、配置缓存、限流计数器。

### 📚 延伸知识

- **Write-Through vs Write-Behind**：Write-Through（写缓存同步写 DB）、Write-Behind（写缓存异步写 DB）。我们用 Cache-Aside（读时填充，写时删缓存）——最简单。
- **Bloom Filter**：防缓存穿透的高级方案——用布隆过滤器判断 key 是否可能存在，不存在直接返回不查 DB。

---

## Q4. 为什么 Redis 快？

**🎤 面试官**

> 都说 Redis 快，但"快"的具体原因是什么？单线程为什么反而快？

**🙋 候选人回答**

**Redis 快的四个原因：**

**① 纯内存操作**

数据全在内存，读写不经过磁盘。内存访问 ~100ns，磁盘访问 ~10ms。100 倍差距。

**② 单线程无锁**

Redis 的核心处理是单线程的——没有多线程的锁竞争、上下文切换。看起来"单线程慢"，实际上"无锁无切换"反而快。

**③ IO 多路复用**

Redis 用 epoll（Linux）实现 IO 多路复用——一个线程同时处理成千上万个连接。不是"一个连接一个线程"（那是传统模型，线程多了切换开销大）。

```
传统模型：1000 连接 = 1000 线程（切换开销大）
Redis：1000 连接 = 1 线程 + epoll（无切换）
```

**④ 高效的数据结构**

Redis 的数据结构是专门优化的：
- List 用 quicklist（双向链表+ziplist 混合）
- Hash 用 ziplist（小）或 hashtable（大）
- Sorted Set 用 skiplist + hash table

这些数据结构的操作复杂度低（O(1) 或 O(logN)）。

**单线程的局限**：

- CPU 密集操作会阻塞（如大 key 的 SORT 操作）。
- 不能利用多核（但可以通过多实例/Cluster 水平扩展）。

**Redis 6.0 引入了多线程处理网络 I/O**（协议解析、响应写入），但命令执行仍是单线程。这解决了"网络 I/O 瓶颈"但保留了"无锁命令执行"。

### 🏗 架构分析

- **为什么这么设计？** Redis 的核心矛盾不是"CPU 算得慢"，而是"IO 等待 + 内存访问"。所以它把单线程用在命令执行上（避免锁开销、保证原子性），把多线程只用在网络 I/O 上（6.0+），这是对"瓶颈在哪里就优化哪里"的精准取舍。
- **为什么不用其它方案？**
    | 模型 | 命令执行 | 网络 I/O | 锁开销 | 多核利用 | 结论 |
    |------|---------|---------|--------|---------|------|
    | 传统多线程（一连接一线程） | 多线程 | 多线程 | 大（要加锁） | 是 | 锁竞争 + 上下文切换拖慢 |
    | Redis ≤5.0 单线程 | 单线程 | 单线程（epoll） | 无 | 否 | 简单无锁，但网络成瓶颈 |
    | Redis 6.0+ 多线程 I/O | 单线程 | 多线程 | 无（命令仍串行） | 部分（I/O） | 当前最优解 |
- **权衡**：单线程换来了"无锁 + 命令原子"的简单性，代价是 CPU 密集操作（大 key 的 SORT、KEYS）会阻塞整个实例。所以工程上的约束是"避免大 key、避免 KEYS"，用 SCAN 替代——这是架构选择带来的运维纪律，而不是 Redis 的缺陷。
- **未来演进**：单实例 CPU 上限明确，扩展方向不是"把 Redis 做成多核"，而是"多实例 + Cluster / 业务域拆分"水平扩展。Redis 7+ 也在持续优化多线程 I/O 和数据结构内存效率，但命令单线程的本质不会变（变了就不是 Redis）。

### 🎯 面试官真正考察什么

考察候选人对"性能瓶颈归因"的理解——能不能把"快"拆解成内存、单线程无锁、IO 多路复用、数据结构四个可量化的点，并解释"单线程为什么反而快"。能讲清 6.0 多线程只动 I/O 不动命令执行的人，说明真的理解了架构，而不是背"单线程"三个字。

### ❌ 常见错误回答

- 只答"因为 Redis 是内存数据库"——一个点当全部答案，忽略单线程无锁和 epoll 的关键作用。
- 把"单线程"说成 Redis 的缺点或"因为 Redis 没能力做多线程"，完全反向，没理解"无锁无切换"反而是性能优势。
- 把 6.0 多线程说成"Redis 现在是多线程命令执行了"——错，多线程只用于网络 I/O，命令执行仍单线程。

### ✅ 推荐回答

> Redis 快四个原因：① 纯内存操作（~100ns vs 磁盘~10ms，100 倍）；② 单线程无锁（无锁竞争无上下文切换，看起来慢实际无锁快）；③ IO 多路复用（epoll 一个线程处理上万连接，非一个连接一个线程）；④ 高效数据结构（quicklist/ziplist/skiplist 操作复杂度低 O(1)/O(logN)）。单线程局限：CPU 密集操作阻塞（大 key SORT）、不能利用多核（多实例/Cluster 扩展）。Redis 6.0 多线程处理网络 I/O（协议解析/响应写入）但命令执行仍单线程——解决网络瓶颈保留无锁执行。

### 📚 延伸知识

- **Redis 6.0 多线程 I/O**：`io-threads 4` 开启。网络读写多线程，命令执行单线程。对网络密集型场景提升明显。
- **epoll vs select/poll**：epoll 是 Linux 的高效 IO 多路复用。select 有 1024 fd 限制，poll 无限制但仍是 O(n) 遍历，epoll 是 O(1) 事件驱动。

---

## Q5. 分布式锁

**🎤 面试官**

> 第四章 Q8 讲过分布式锁的实现。这里深入问：Redis 分布式锁可靠吗？Redlock 算法你了解吗？

**🙋 候选人回答**

**Redis 分布式锁的演进：从 SET NX 到 Redlock。**

**v1: SET NX + EX（我们用的）**

```typescript
const acquired = await redis.set(lockKey, lockId, 'NX', 'EX', 30);
// 释放时用 Lua 检查 lockId 防误删
```

**问题**：单点 Redis 挂了，锁丢失。主从切换时，新 Master 没有锁信息，其他客户端能获取同样的锁。

**v2: Redlock（Antirez 提出）**

为了解决单点不可靠，Redlock 在多个（通常 5 个）独立 Redis 实例上获取锁：

```
1. 获取当前时间 T1
2. 依次向 5 个 Redis 实例发 SET NX EX
3. 获取当前时间 T2
4. 如果在 ≥3 个实例上获取成功，且 T2-T1 < 锁有效期 → 锁获取成功
5. 否则 → 向所有实例发 DEL 释放
```

**多数派原则**：超过半数（3/5）获取成功才算锁成功。即使 1-2 个实例挂了，锁仍有效。

**但 Redlock 有争议**——Martin Kleppmann（DDIA 作者）写文章质疑 Redlock 的安全性：

1. **GC 暂停问题**：客户端获取锁后发生长 GC 暂停，锁过期了但客户端不知道，以为还持有锁。此时另一个客户端获取了锁——两个客户端同时"持有"锁。
2. **时钟漂移**：Redlock 依赖各实例的时钟一致。如果某实例时钟跳了（NTP 同步、虚拟机迁移），锁的过期时间不准。

**Kleppmann 的结论**：如果需要正确性保证，用 ZooKeeper/etcd（基于共识算法），不用 Redis。如果只需要"大部分时候对"，Redis 锁够用。

**我们的选择**：用 v1（SET NX + EX），不用 Redlock。因为：

1. 我们的锁不是"必须绝对正确"的场景——即使锁失效导致两个 Worker 同时执行，幂等性（检查点+去重）保证不会产生错误结果。
2. Redlock 增加复杂度（5 个 Redis 实例），收益不大。
3. 如果将来需要绝对正确的锁，用 etcd（K8s 已有）。

**核心认知：分布式锁没有"完美"方案，关键是知道"锁失效后怎么办"。** 我们的答案是幂等——锁失效了也不怕，幂等保证结果正确。

### 🏗 架构分析

- **为什么这么设计？** 分布式锁的正确性问题本质上是无解的（GC 暂停、时钟漂移、网络分区都会破坏它）。所以我们不追求"锁绝对可靠"，而是把可靠性下沉到业务层——用幂等性保证"即使锁失效，重复执行也不出错"。这是比"堆更复杂的锁算法"更稳健的工程思路。
- **为什么不用其它方案？**
    | 方案 | 一致性 | 性能 | 复杂度 | 依赖 | 结论 |
    |------|--------|------|--------|------|------|
    | SET NX + EX（我们） | 弱（单点，主从切换可能丢锁） | 高（单 Redis） | 低 | Redis（已有） | 幂等兜底下够用 |
    | Redlock | 多数派，抗单点 | 中（5 实例 RTT） | 高 | 5 个独立 Redis | 仍解决不了 GC/时钟问题，收益有限 |
    | ZooKeeper / etcd | 强（ZAB/Raft 共识） | 低（每次锁操作集群投票） | 中 | 额外中间件 | 需要绝对正确性时才上（K8s 已有 etcd） |
- **权衡**：选 SET NX + EX 换来了简单和高性能（复用现有 Redis，无额外中间件），代价是锁失效风险。我们的兜底是业务幂等（检查点 + 去重），让"锁失效"的后果可控——这比 Redlock 的"半正确"更诚实。
- **未来演进**：如果出现"锁失效会导致资金/数据损坏"的强一致场景，不会上 Redlock（争议大），而是直接用 etcd（K8s 已部署）做基于 Raft 的租约锁 + Fencing Token 写存储校验。

### 🎯 面试官真正考察什么

考察候选人对分布式锁本质的认知深度——能不能跳出"背 Redlock 流程"，看到 Kleppmann 的质疑（GC 暂停、时钟漂移），并给出"锁不可靠 → 用幂等兜底"的工程结论。能说出"分布式锁没有完美方案，关键是失效后怎么办"的人，是真正做过并发系统的。

### ❌ 常见错误回答

- 把 Redlock 流程背一遍就结束，不知道 Kleppmann 的质疑，也没想过 GC/时钟问题。
- 答"我们的锁很可靠，用了 Redlock"——盲目信任算法，没分析自己业务到底需不需要强一致。
- 只讲怎么获取锁、怎么释放锁（SET NX / Lua 删 key），完全没提"锁失效怎么办"，回避了分布式锁最难的点。

### ✅ 推荐回答

> Redis 分布式锁演进：v1 SET NX+EX（我们用的，单点 Redis 挂了锁丢失）；v2 Redlock（5 个独立实例多数派 3/5 获取成功才算锁成功，解决单点不可靠）。但 Redlock 有争议——Kleppmann 质疑：GC 暂停问题（客户端 GC 暂停锁过期了但以为还持有，两个客户端同时持锁）、时钟漂移（依赖各实例时钟一致）。Kleppmann 结论：需正确性用 ZooKeeper/etcd 不用 Redis，只需"大部分时候对"Redis 够用。我们选 v1 不用 Redlock——锁不是必须绝对正确的场景，锁失效了幂等性（检查点+去重）保证结果正确。Redlock 5 实例复杂度大收益不大。认知：分布式锁无完美方案，关键是"锁失效后怎么办"——我们的答案是幂等。

### 📚 延伸知识

- **ZooKeeper / etcd 分布式锁**：基于共识算法（ZAB/Raft），保证一致性。但性能不如 Redis（每次锁操作涉及集群投票）。
- **Fencing Token**：Kleppmann 提出的防 GC 暂停方案——锁带递增 token，写存储时检查 token，旧 token 的写拒绝。但需要存储配合。

---

## Q6-Q8. 快速深挖题

---

## Q6. Redis 的过期策略是什么？

**🎤 面试官**

> 你给缓存设了 TTL，那 Redis 是怎么把这些 key 真正删掉的？是到点就删，还是别的机制？

**🙋 候选人回答**

**两种策略组合：惰性过期 + 定期过期。**

惰性过期——访问 key 时才检查是否过期，过期才删除。优点是不额外消耗 CPU，缺点是过期 key 不被访问就一直占内存。定期过期——Redis 每 100ms 随机抽查一些 key，过期的删除，抽查而非全扫（全扫会卡死）。两者组合：大部分过期 key 被定期过期清理，漏网的被惰性过期兜底。内存满时还有淘汰策略（maxmemory-policy）。我们的配置：maxmemory 2GB + allkeys-lru。

### 🏗 架构分析

- **为什么这么设计？** 过期删除本质是"及时性 vs CPU 开销"的权衡。全量定时扫描保证及时，但 CPU 消耗大、会阻塞；纯惰性删除零 CPU 开销，但内存会被"僵尸 key"吃光。Redis 的组合策略是"用定期过期覆盖大多数 + 惰性过期兜底漏网"，把 CPU 和内存都控制在合理范围。
- **为什么不用其它方案？**
    | 策略 | 及时性 | CPU 开销 | 内存占用 | 结论 |
    |------|--------|---------|---------|------|
    | 定时器到期即删（每 key 一个 timer） | 高 | 高（海量 timer） | 低 | key 多时 timer 表爆炸 |
    | 纯惰性删除 | 低 | 零 | 高（僵尸 key 堆积） | 内存不可控 |
    | 惰性 + 定期（Redis 选型） | 中 | 低（抽查） | 中 | CPU 与内存平衡 |
- **权衡**：组合策略换来了 CPU 可控，代价是"过期 key 可能在被删除前仍占内存"——所以还要配淘汰策略（LRU/LFU）作为最后一道防线。我们用 allkeys-lru，内存满时淘汰最久未用的 key，保证实例不 OOM。
- **未来演进**：Redis 7+ 的 lazyfree（异步删除）让大 key 过期删除不再阻塞主线程，配合 UNLINK（Q7）进一步降低过期对延迟的影响。

### 🎯 面试官真正考察什么

考察候选人是否理解 Redis 过期是"概率性清理 + 多层兜底"的设计，而不是"到点精准删除"。能讲清惰性 + 定期 + 淘汰策略三层关系的人，说明理解了内存数据库的内存管理哲学。

### ❌ 常见错误回答

- 答"Redis 到点就自动删除"——把 TTL 当成精准定时器，完全错了。
- 只说惰性过期或只说定期过期，漏掉另一个，给不出组合策略。
- 把过期策略和淘汰策略混为一谈（过期是"到期删"，淘汰是"内存满删"），概念不分。

### ✅ 推荐回答

> 两种策略组合：① 惰性过期——访问 key 时检查是否过期，过期才删除。优点不额外消耗 CPU，缺点过期 key 不访问就一直占内存。② 定期过期——Redis 每 100ms 随机抽查一些 key，过期的删除。抽查而非全扫（全扫太慢）。两者组合：大部分过期 key 被定期过期清理，漏网的被惰性过期兜底。内存满时还有 LRU/LFU 淘汰策略（maxmemory-policy）。我们的配置：maxmemory 2GB + allkeys-lru（内存满时 LRU 淘汰）。

### 📚 延伸知识

- **淘汰策略 8 种**：noeviction（不淘汰，写报错）、allkeys-lru / volatile-lru、allkeys-lfu / volatile-lfu、allkeys-random / volatile-random、volatile-ttl。带 volatile 前缀的只对设了 TTL 的 key 生效。我们用 allkeys-lru 是因为缓存场景下"最久未用 = 最不可能再用"。
- **lazyfree**：Redis 4.0+ 的异步删除，DEL 大 key 时改用 UNLINK，后台线程释放内存，不阻塞主线程。

---

## Q7. Redis 的大 Key 问题怎么处理？

**🎤 面试官**

> 我们 BullMQ 任务里有时候会塞大 payload。大 Key 在 Redis 里到底有什么问题？你们怎么避免？

**🙋 候选人回答**

**大 Key（如一个 List 存 10 万元素）的问题：操作慢（DEL 10 万元素的 List 阻塞数秒）、网络传输大、内存集中。** 排查用 `redis-cli --bigkeys` 扫描。处理：① 拆分（大 List 拆成多个小 List，用 hash 分桶）；② 删除用 UNLINK 不用 DEL（异步删除不阻塞）；③ 监控大 key 告警。我们的实践：BullMQ 的任务 payload 如果大（如 base64 图片），不存 Redis——payload 只存引用（S3 URL），数据存对象存储，Redis 里的单 key 控制在 10KB 以内。

### 🏗 架构分析

- **为什么这么设计？** 大 Key 之所以危险，根因是 Redis 命令执行单线程（Q4）——一个 DEL 10 万元素的 key 会阻塞整个实例数秒，期间所有其它请求排队。所以我们的设计原则是"Redis 只存小而热的元数据，大而冷的数据下沉到对象存储/DB"。
- **为什么不用其它方案？**
    | 方案 | 阻塞风险 | 实现复杂度 | 结论 |
    |------|---------|-----------|------|
    | 直接存大 key + 用 DEL 删 | 高（主线程阻塞） | 低 | 不可接受 |
    | 拆分大 key（hash 分桶） | 低 | 中 | 结构化数据可用 |
    | payload 只存引用，数据下沉 S3（我们） | 无 | 低 | BullMQ 任务场景最优 |
    | UNLINK 异步删除 | 低 | 低 | 兜底手段，配合上面 |
- **权衡**：选"payload 存引用"换来了 Redis 永远轻量、单 key 可控，代价是多一次 S3 往返。但任务 payload 通常几十 KB 到几 MB，S3 延迟（几十 ms）相对任务执行时间（秒级）可忽略，这笔交易非常划算。
- **未来演进**：增加自动化防线——CI 阶段对 BullMQ 任务 payload 做大小检查，超阈值直接拒绝入库；运行时用 `MEMORY USAGE` + 告警监控，把大 Key 拦在进 Redis 之前。

### 🎯 面试官真正考察什么

考察候选人是否理解"大 Key 危险的根因是单线程阻塞"，以及能否给出"从源头避免 + 运行时兜底"的分层方案。能联系到 BullMQ payload 只存引用、数据下沉 S3 的人，说明是真在分布式任务系统里踩过坑。

### ❌ 常见错误回答

- 只说"大 Key 慢"，说不清为什么会慢（单线程阻塞），给不出根因。
- 答案只有"用 UNLINK 代替 DEL"——这是兜底手段，不是根治方案，回避了"为什么会产生大 key"。
- 不知道怎么排查（`redis-cli --bigkeys`），也没有预防设计，纯靠出事再救火。

### ✅ 推荐回答

> 大 Key（如一个 List 存 10 万元素）的问题：操作慢（DEL 10 万元素的 List 阻塞数秒）、网络传输大、内存集中。排查：`redis-cli --bigkeys` 扫描大 key。处理：① 拆分（大 List 拆成多个小 List，用 hash 分桶）；② 删除用 UNLINK 不用 DEL（UNLINK 异步删除不阻塞）；③ 监控大 key 告警。我们的实践：BullMQ 的任务数据如果 payload 大（如 base64 图片），不存 Redis——payload 只存引用（S3 URL），数据存对象存储。Redis 里的单 key 控制在 10KB 以内。

### 📚 延伸知识

- **热 Key 问题**：与大 Key 对应的是热 Key（某 key 被 QPS 万级访问，打挂单分片）。排查用 `redis-cli --hotkeys`（需开启 LFU）。处理：本地缓存（node-cache）多副本分摊、读多副本。
- **lazyfree 阈值**：Redis 可配 `lazyfree-lazy-expiration` / `lazyfree-lazy-eviction` 让过期和淘汰也走异步删除，进一步降低阻塞。

---

## Q8. Redis 的 Pub/Sub 和 Streams 有什么区别？

**🎤 面试官**

> 你们 WebSocket 进度推送和任务结果回写都用了 Redis 通信。为什么一个用 Pub/Sub、一个用 Hash+通知？Streams 你考虑过吗？

**🙋 候选人回答**

**Pub/Sub 是"发即忘"——不持久化，订阅者不在线消息就丢。Streams 是持久化消息队列，支持消费组和 ACK，离线重连能补消费未读。** 我们的选择：进度推送用 Pub/Sub（快但不保证，丢了前端轮询兜底）；任务结果用 Hash+Pub/Sub 通知（第四章 Q5，数据落在 Hash 里可靠，Pub/Sub 只做唤醒）。如果需要更强可靠性（如必须不丢的任务结果流），会迁移到 Streams，它还支持消费组让多个消费者分摊消息。

### 🏗 架构分析

- **为什么这么设计？** 关键是按"消息丢了后果有多严重"分层选型。进度推送丢了最多 UI 卡顿一下，前端轮询能补，用 Pub/Sub 够；任务结果是业务数据，丢了要重新跑任务（成本高），所以数据落在 Hash（持久化），Pub/Sub 只当"唤醒铃"。这是"可靠数据 + 轻量通知"的组合，比无脑上 Streams 更轻。
- **为什么不用其它方案？**
    | 方案 | 持久化 | 消费组/ACK | 性能 | 复杂度 | 结论 |
    |------|--------|-----------|------|--------|------|
    | Pub/Sub | 否（发即忘） | 否 | 极高 | 低 | 实时通知首选 |
    | Streams | 是 | 是（消费组+ACK+PEL） | 高 | 中 | 可靠消息流 |
    | Hash + Pub/Sub 通知（我们） | 是（Hash 持久化） | 否 | 高 | 低 | 数据可靠 + 轻通知，当前够用 |
    | Kafka/RabbitMQ | 是 | 是 | 高 | 高 | 多一套中间件，不值当 |
- **权衡**：选"Hash + Pub/Sub 通知"换来了简单（复用现有 Redis，无新中间件），代价是"通知丢了则消费方要靠轮询发现新结果"——我们用短间隔轮询兜底，延迟可接受。如果将来延迟要求更严或要支持多消费者分摊，再迁 Streams。
- **未来演进**：当任务结果量级上去、需要"严格不丢 + 消费组负载均衡"时，把任务结果通道从 Hash+通知升级到 Streams（XADD/XREADGROUP/XACK），天然支持 PEL（pending list）重投递，且不用引入 Kafka。

### 🎯 面试官真正考察什么

考察候选人对"消息可靠性"的分层认知——能不能根据"丢了后果"在 Pub/Sub / Streams / Hash+通知 之间取舍。能说出"进度推送用 Pub/Sub、任务结果数据落 Hash 而通知用 Pub/Sub"的人，说明真理解了"数据可靠"和"通知可靠"是两回事。

### ❌ 常见错误回答

- 把两者当名词解释背一遍（Pub/Sub 是发布订阅、Streams 是流），不结合场景说选型理由。
- 答"实时用 Pub/Sub、可靠用 Streams"就停——说不清我们为什么"可靠场景也没上 Streams"（因为 Hash+通知已够，避免过度设计）。
- 误以为 Pub/Sub 能持久化、能补消费离线消息，概念搞反。

### ✅ 推荐回答

> Pub/Sub：发即忘，不持久化，订阅者不在线消息丢失。适合"实时通知"（我们的 WebSocket 进度推送用 Pub/Sub——消息丢了没关系，前端轮询兜底）。Streams：持久化消息队列，支持消费组和 ACK。订阅者离线后重连能消费未读消息。适合"可靠消息"（如任务结果回写——Python Worker 写结果到 Stream，Node 消费后 ACK，没 ACK 的消息重连后还在）。我们的选择：进度推送用 Pub/Sub（快但不保证），任务结果用 Hash+Pub/Sub 通知（第四章 Q5），如果需要更强可靠性会迁移到 Streams。Streams 还支持消费组（多个消费者分摊消息）。

### 📚 延伸知识

- **Streams 消费组与 PEL**：XREADGROUP 读取后消息进入 PEL（Pending Entry List），XACK 后才移除。消费者宕机重启，PEL 里的消息可被 XCLAIM 转移给其它消费者重投递——这是 Streams 可靠性的核心机制。
- **Pub/Sub 的 fan-out 特性**：一条消息发到 channel，所有在线订阅者都收到（广播）。Streams 默认是消费组内分摊（一条消息只被组内一个消费者处理），适合负载均衡。

---

## 本章总结

第七章 8 道题，结合项目讨论了 Redis 的核心使用场景。回顾：

| 主题 | 核心决策 | 题号 |
|------|----------|------|
| BullMQ 为什么用 Redis | 内存速度+原子操作+丰富数据结构 | Q1 |
| Redis 高可用 | 主从+Sentinel（不用 Cluster 因 BullMQ 兼容性） | Q2 |
| 缓存设计 | Cache-Aside+TTL，穿透/击穿/雪崩防御 | Q3 |
| 为什么快 | 内存+单线程无锁+epoll+高效数据结构 | Q4 |
| 分布式锁 | SET NX+EX，不用 Redlock，幂等兜底 | Q5 |
| 过期策略 | 惰性+定期组合 | Q6 |
| 大 Key | 拆分+UNLINK+payload 只存引用 | Q7 |
| Pub/Sub vs Streams | 实时用 Pub/Sub，可靠用 Streams | Q8 |

**核心原则**：Redis 是"快存储"不是"真持久化"，和 PG 分工——Redis 管速度，PG 管可靠。分布式锁无完美方案，关键是锁失效后的兜底（幂等）。

下一章进入[第八章：PostgreSQL](chapter-08-postgresql.md)——索引、事务、MVCC、Explain、优化。

# 第七章 Redis

> Redis 是我们技术栈的核心组件——BullMQ 的队列、缓存的存储、Pub/Sub 的通信、分布式锁的基础。本章不背 Redis 命令，而是结合 Task Platform 和 AI Platform 讨论真实场景中的 Redis 使用。
>
> 本章共 14 题（前 8 题项目场景，Q9-Q14 为底层技术原理深挖）。

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

## Q9. Redis 的持久化机制（RDB vs AOF）

**🎤 面试官**

> 前面你说"Redis 是快存储不是真持久化"，那 Redis 到底有没有持久化机制？RDB 和 AOF 是什么？你怎么给我们这套 BullMQ 任务队列选持久化？

**🙋 候选人回答**

**Redis 有两套持久化机制：RDB（快照）和 AOF（追加日志），Redis 4.0+ 还支持混合持久化。**

**① RDB（Redis Database）——全量快照**

把某一时刻的全量内存数据写成二进制文件 `dump.rdb`。触发方式有两种：手动（`SAVE`/`BGSAVE`）和自动（配置 `save 900 1` 表示 900 秒内 1 个变更就触发）。

关键点是 `BGSAVE` 用 **`fork()` + copy-on-write**：主进程 fork 出子进程，子进程遍历内存写快照，父进程继续对外服务。父子共享物理内存页，父进程有写操作时才真正复制对应页——所以 fork 瞬间会有一段时间双倍内存占用（大实例要特别注意）。

优点：文件小、恢复快、适合远程备份。缺点：两次快照之间的数据会丢。

**② AOF（Append Only File）——追加日志**

每条写命令追加到 `appendonly.aof`。恢复时回放命令重建状态。可靠性取决于 `fsync` 策略：

| appendfsync 策略 | 含义 | 可靠性 | 性能 | 数据丢失窗口 |
|------------------|------|--------|------|------------|
| `always` | 每条命令都 fsync | 最高 | 最差（每写一次盘） | 不丢 |
| `everysec`（默认） | 每秒 fsync 一次 | 高 | 接近 RDB | 最多丢 1 秒 |
| `no` | 由操作系统决定何时刷盘 | 低 | 最好 | 丢一个 OS 缓冲周期（~30 秒） |

但 AOF 文件会越来越大，所以有 **AOF rewrite（重写）**——读取当前内存状态生成最小命令集，丢弃过期/已删/历史中间状态。比如同一个 key INCR 100 次后值为 100，原 AOF 100 条命令，重写后只留一条 `SET key 100`。重写也是 fork 子进程做的。

**③ 混合持久化（Redis 4.0+）**

AOF rewrite 时不再写命令，而是直接把当前内存以 RDB 二进制格式写到 AOF 文件开头，之后新命令以 AOF 文本追加。恢复时先加载 RDB 段（快）、再回放 AOF 段（补增量）。`aof-use-rdb-preamble yes` 开启（5.0+ 默认开启）。这是当前生产环境的推荐姿势。

---

**🎤 面试官追问**

> 那你们 BullMQ 这套任务队列数据，选 RDB、AOF 还是都用？为什么？

**🙋 候选人回答**

**我们的选择是 AOF（`everysec`）+ 混合持久化，关掉纯 RDB 自动快照（手动 `BGSAVE` 做远程备份）。**

理由是任务队列的持久化要求是"宁可慢一点也不能多丢"。BullMQ 的任务数据（Hash）、队列结构（List/Sorted Set）、优先级都在 Redis 里——如果用 RDB，两次快照之间崩溃就丢一大段任务，不可接受。AOF `everysec` 最多丢 1 秒数据，配合第四章 Q9 的 PG 双写兜底（任务最终状态以 PG 为准），这个窗口我们能接受。

为什么不直接上 `always`？每条命令 fsync 一次磁盘，BullMQ 高频入队（LPUSH/ZADD）会被磁盘 I/O 拖慢到几百 QPS，把"内存级速度"彻底吃掉，违背用 Redis 做队列的初衷。`everysec` 是性能和可靠性的甜点。

---

**🎤 面试官继续追问**

> AOF rewrite 时如果有新写入怎么办？rewrite 期间主进程挂了会丢数据吗？

**🙋 候选人回答**

两个问题分两层：

**rewrite 期间的新写入**：fork 子进程开始 rewrite 那一刻，把内存状态"冻结"了。但主进程还在对外服务，新命令不断进来。这些新命令会同时做两件事——① 正常追加到旧的 AOF 文件（保证 rewrite 失败也不丢）；② 写到一个 **AOF rewrite buffer**，等子进程写完新 AOF 后，主进程把 buffer 里的增量追加到新文件末尾，再原子替换旧文件。所以 rewrite 期间的数据不会丢。

**rewrite 期间主进程挂了**：旧 AOF 文件还在（rewrite 还没替换），恢复时用旧 AOF——最多丢到最后一次 fsync 之后那 1 秒。这和平时崩溃的窗口一样，没有额外风险。

唯一要警惕的是 rewrite 期间内存涨：fork 出子进程那一刻，主进程对内存的修改会触发 COW 复制，大实例可能短时间内存翻倍。我们监控里专门对 rewrite 期间的内存峰值告警，避免 OOM。

### 🏗 架构分析

- **为什么这么设计？** 持久化的本质是"数据丢失容忍度 vs 性能开销"的权衡。RDB 是"低频全量"，AOF 是"高频增量"，混合持久化是两者的取长补短。任务队列丢数据的代价（任务重跑、用户重提）远高于缓存丢数据的代价（缓存穿透重新加载），所以队列场景必须 AOF，缓存场景 RDB 就够。
- **为什么不用其它方案？**
    | 方案 | 数据丢失窗口 | 恢复速度 | 文件大小 | 性能影响 | 结论 |
    |------|------------|---------|---------|---------|------|
    | 纯 RDB | 大（两次快照之间全丢） | 快（二进制加载） | 小 | 低（fork 瞬间） | 缓存场景够用 |
    | AOF `always` | 不丢 | 慢（回放命令） | 大 | 高（每写 fsync） | 性能损失太大 |
    | AOF `everysec`（队列场景选） | ≤1 秒 | 慢 | 中 | 低（每秒一次 fsync） | 性能/可靠甜点 |
    | AOF `everysec` + 混合（我们） | ≤1 秒 | 较快（RDB 段快加载） | 中 | 低 | 当前最优解 |
- **权衡**：AOF 换来了低丢失窗口，代价是恢复比 RDB 慢（要回放命令）、文件比 RDB 大、rewrite 期间有内存峰值。混合持久化解决了"恢复慢"和"文件大"两个问题，但 rewrite 内存峰值仍在——这是我们必须监控的运维点。
- **未来演进**：如果任务量进一步增大导致 AOF rewrite 频繁，会调大 `auto-aof-rewrite-percentage` 阈值减少 rewrite 频率；或者把"绝对不能丢的任务状态"全部下沉到 PG，Redis 只做流转层，恢复时从 PG 回灌——这本质上是承认 Redis 持久化有上限，把可靠性需求彻底交给 PG。

### 🎯 面试官真正考察什么

不是问"RDB 和 AOF 是什么"的名词解释，而是考察三件事：① 能不能讲清 fork+COW 的实现机制（而不是只说"fork 子进程"）；② fsync 三策略的性能/可靠性权衡（特别是为什么生产用 `everysec` 而非 `always`）；③ 能不能结合业务（BullMQ 任务数据 vs 缓存）给出选型理由。能讲清 rewrite buffer 机制的人，说明真的啃过 Redis 源码细节。

### ❌ 常见错误回答

- 把 RDB 和 AOF 当名词解释背一遍（RDB 是快照、AOF 是日志），说不清 fork+COW、fsync 三策略、AOF rewrite 这些实现细节。
- 答"生产一定要用 AOF `always` 最可靠"——只看可靠性不看性能，没意识到 `always` 会把 Redis 变成磁盘数据库。
- 不知道混合持久化（4.0+），还在讲"RDB 和 AOF 二选一"，技术认知停留在 3.x 时代。
- 给 BullMQ 任务队列选 RDB——任务数据丢一大段不可接受，暴露没考虑过业务后果。

### ✅ 推荐回答

> Redis 两套持久化：① RDB 全量快照，`BGSAVE` 用 fork+COW（子进程遍历内存写 dump.rdb，父进程继续服务，写时才复制内存页），文件小恢复快但两次快照之间丢数据；② AOF 追加日志，每条写命令追加到 aof 文件，可靠性取决于 fsync 策略（always 每条 fsync 不丢但慢、everysec 每秒一次最多丢 1 秒是生产默认、no 交 OS 最快但可能丢 30 秒）。AOF 文件大会膨胀，所以有 AOF rewrite（fork 子进程读内存生成最小命令集）。Redis 4.0+ 混合持久化：rewrite 时 AOF 开头写 RDB 段（快加载），之后追加 AOF 命令（补增量）。我们 BullMQ 任务队列选 AOF everysec+混合持久化——任务数据不能丢一大段所以不用 RDB，不用 always 因为每写 fsync 会拖垮内存级速度。最多丢 1 秒配合 PG 双写兜底可接受。

### 📚 延伸知识

- **fork 与 COW**：Linux 的 copy-on-write 让 fork 子进程共享父进程内存页，只有父进程修改某页时才真正复制。大实例 fork 本身耗时（要复制页表），且 rewrite 期间内存可能翻倍。
- **RDB 触发时机**：`save 900 1 / save 300 10 / save 60 10000` 是默认配置；主从全量同步、`SHUTDOWN`、`DEBUG RELOAD` 也会触发。
- **Redis 7.0 Multi-Part AOF（MP-AOF）**：把 AOF 拆成 base（RDB 快照）、incremental（增量命令）、manifest（清单）三个文件，rewrite 更高效、可增量备份。

---

## Q10. Redis 的内存淘汰策略

**🎤 面试官**

> 你们 Redis 既存 BullMQ 任务队列数据，又存缓存。如果内存满了，Redis 会怎么淘汰？淘汰策略有哪些？队列数据和缓存数据被误淘汰了怎么办？

**🙋 候选人回答**

**Redis 的淘汰策略一共 8 种，关键是按"要不要淘汰 + 淘汰范围 + 淘汰算法"三个维度理解。**

**先理解触发条件**：当 Redis 内存超过 `maxmemory` 配置上限时，新写入会触发淘汰。淘汰由命令执行线程在写入前同步进行（6.0+ 可配 lazyfree 异步释放内存）。

**8 种策略分类：**

| 策略 | 淘汰范围 | 算法 | 含义 |
|------|---------|------|------|
| `noeviction` | 不淘汰 | —— | 内存满直接拒绝写（返回 OOM 错误） |
| `allkeys-lru` | 所有 key | LRU | 淘汰最久未访问的 key |
| `allkeys-lfu` | 所有 key | LFU | 淘汰访问频率最低的 key |
| `allkeys-random` | 所有 key | 随机 | 随机淘汰 |
| `volatile-lru` | 设了 TTL 的 key | LRU | 只在带过期的 key 里淘汰 |
| `volatile-lfu` | 设了 TTL 的 key | LFU | 只在带过期的 key 里淘汰 |
| `volatile-random` | 设了 TTL 的 key | 随机 | 只在带过期的 key 里随机淘汰 |
| `volatile-ttl` | 设了 TTL 的 key | TTL | 优先淘汰快过期的 key |

**LRU vs LFU 的核心区别：**

- **LRU（Least Recently Used）**：淘汰最久未访问的。"时间"维度，认为"很久没用过的 = 不会再用的"。问题是会被"偶发性冷数据访问"污染——一个僵尸 key 被访问一次就被"刷新"，挤掉真正常用的 key。
- **LFU（Least Frequently Used，Redis 4.0+）**：淘汰访问频率最低的。"频率"维度，看的是"一段时间内访问多少次"。偶发访问不会大幅提升频率，更抗污染。适合"少数热点 key 反复被访问"的场景。

实现上 Redis 的 LRU/LFU 都是**近似算法**——不维护全局排序链表（太重），而是采样：每次淘汰时随机抽 N 个 key（`maxmemory-samples`，默认 5）从中选最该淘汰的。采样数调大更准但更慢。

---

**🎤 面试官追问**

> 那 BullMQ 任务队列的 key 和缓存的 key 在同一个 Redis 里，万一队列 key 被淘汰了怎么办？你怎么隔离？

**🙋 候选人回答**

**这是真实痛点。队列数据绝对不能被淘汰——一个任务被淘汰等于任务丢失，任务在 BullMQ 里"凭空消失"。我们的隔离方案是分实例，而不是在同一个实例里靠策略硬隔离。**

**为什么不靠策略隔离**：理论上可以用 `volatile-lru` + 给所有缓存 key 设 TTL、队列 key 不设 TTL，这样淘汰只在缓存 key 里发生。但这是"约定"不是"机制"——只要有一个缓存 key 忘记设 TTL，或者有新同事不清楚规则，队列 key 就可能被淘汰。约定靠不住。

**我们最终选的方案：实例隔离**。开两个 Redis 实例：① 缓存实例——`maxmemory-policy allkeys-lru`，所有 key 都可淘汰，满了就 LRU 淘汰无所谓；② 队列实例——`maxmemory-policy noeviction`，禁止淘汰，满了直接拒绝写入（让 BullMQ 报错而不是丢任务）。这样从机制上保证队列数据永不被淘汰。

---

**🎤 面试官继续追问**

> 那队列实例内存满了怎么办？noeviction 会让写入全失败。

**🙋 候选人回答**

**这正是我们想要的"显式失败"，而不是"悄悄丢数据"。** 内存满的原因通常是任务积压（生产快于消费）或大 payload。我们的处理：

① **监控告警**：队列实例内存使用率到 70% 告警，到 85% 紧急告警，提前介入。

② **水平扩容消费**：任务积压时第一时间加 Worker，消费速度跟上后队列自然消化。

③ **设置 BullMQ 任务 TTL + 自动清理**：BullMQ 自带 `removeOnComplete` / `removeOnFail`，完成的任务自动从 Redis 删除，不让成功任务的"尸体"占内存。

④ **大 payload 拒绝**：CI 阶段限制 BullMQ payload 大小，避免单个任务占几十 MB。

`noeviction` 的拒绝写入是"故障可见"——我们宁可让 BullMQ 入队失败触发上游重试/告警，也不要 Redis 自作主张淘汰掉队列里的任务。这是"显式失败优于隐式数据损坏"的工程原则。

### 🏗 架构分析

- **为什么这么设计？** 内存淘汰策略的本质是"当资源不够时牺牲谁"。对于缓存，牺牲旧数据换内存是设计意图（缓存本就是"尽力而为"）；对于任务队列，牺牲任务等于业务数据丢失，是设计灾难。所以两类数据必须物理隔离——而不是在同一个实例里靠策略"赌"。
- **为什么不用其它方案？**
    | 方案 | 队列数据风险 | 隔离强度 | 运维成本 | 结论 |
    |------|------------|---------|---------|------|
    | 单实例 + volatile-lru（约定） | 高（约定失效则队列被淘汰） | 弱（靠人） | 低 | 不可靠，约定靠不住 |
    | 单实例 + noeviction（全不淘汰） | 缓存也会写失败，缓存雪崩 | 强 | 低 | 缓存场景被牺牲，不合理 |
    | 双实例隔离（缓存 LRU + 队列 noeviction，我们） | 无 | 强（机制保证） | 中（多一个实例） | 当前最优解 |
    | 队列下沉 Kafka（持久化队列） | 无（磁盘持久） | 强 | 高（新中间件） | 量级到了才上 |
- **权衡**：双实例换来了"队列永不丢 + 缓存可任意淘汰"的清晰边界，代价是多一个 Redis 实例的运维成本（监控、备份、内存规划）。但相比"队列被淘汰导致任务丢失"的事故成本，这个代价微不足道。
- **未来演进**：当队列实例也撑不住（海量任务积压），从"内存队列"演进到"持久化队列"——Kafka 或 Redis Streams（Streams 落盘且支持消费组），把任务流转从内存模型迁到磁盘模型，彻底解除内存上限约束。

### 🎯 面试官真正考察什么

考察三层认知：① 能不能讲清 8 种策略的分类逻辑（淘汰范围 × 算法）和 LRU/LFU 的本质区别（时间维度 vs 频率维度、近似采样）；② 能不能识别"队列数据不能被淘汰"这个业务约束，而不是无脑选 LRU；③ 能不能给出"实例隔离"而非"策略约定"的机制级解法。能讲出"显式失败优于隐式丢数据"的人，是真做过生产可靠系统。

### ❌ 常见错误回答

- 背 8 种策略的名字，但说不清 LRU 和 LFU 的区别，更不知道 Redis 用的是近似算法（采样而非全局排序）。
- 答"生产都用 allkeys-lru"——不区分队列和缓存场景，把缓存策略套到任务队列上。
- 隔离方案答"用 volatile-lru 给队列 key 不设 TTL"——这是约定不是机制，没意识到约定的脆弱性。
- 对 noeviction 内存满的回答是"那就淘汰"——自相矛盾，noeviction 就是不淘汰。

### ✅ 推荐回答

> 8 种淘汰策略按"范围 × 算法"分类：noeviction（不淘汰写失败）、allkeys-{lru/lfu/random}（全 key 范围）、volatile-{lru/lfu/random/ttl}（只带 TTL 的 key）。LRU 淘汰最久未访问（时间维度），LFU 淘汰访问频率最低（频率维度，抗偶发访问污染，4.0+）。Redis 用近似算法——采样 maxmemory-samples 个 key 选淘汰，不维护全局链表。我们的隔离方案是双实例：缓存实例 allkeys-lru（满了淘汰无所谓），队列实例 noeviction（禁止淘汰，满了 BullMQ 写失败触发上游重试+告警）。不靠策略约定隔离（volatile-lru+队列 key 不设 TTL），因为约定靠不住——一个缓存 key 忘记设 TTL 队列就被淘汰。noeviction 内存满时监控告警+加 Worker 消费+removeOnComplete 自动清理+大 payload 拒绝。原则：显式失败优于隐式丢数据。

### 📚 延伸知识

- **近似 LRU 的采样数**：`maxmemory-samples` 默认 5，调到 10 更接近真实 LRU 但更慢。Redis 5.0+ 增强了 LFU 的衰减算法，更适合"热点漂移"场景。
- **LFU 的计数衰减**：LFU 的访问计数不是单调递增，而是有时间衰减——旧访问的权重随时间降低，避免"曾经的爆款 key"永不被淘汰。
- **lazyfree 与淘汰**：`lazyfree-lazy-eviction yes` 让淘汰时的内存释放走异步线程，避免大 key 淘汰阻塞主线程。

---

## Q11. Redis 的 Pipeline 和事务

**🎤 面试官**

> 我看你前面代码里用 Redis 批量写入。Redis 的 Pipeline、MULTI/EXEC 事务、Lua 脚本、WATCH 这几个概念你能分清吗？它们解决的是不同问题吗？

**🙋 候选人回答**

**这四个东西经常被混在一起说，但解决的是完全不同的问题。我按"解决什么问题"来区分。**

**① Pipeline——解决"网络往返（RTT）开销"问题**

普通模式每条命令一次网络往返（client→server→client）。要发 100 条命令就是 100 个 RTT。Pipeline 是客户端把多条命令打包一次发出，服务端依次执行后把结果打包返回——1 个 RTT 完成 100 条命令。

```typescript
// 普通：100 次 RTT
for (let i = 0; i < 100; i++) {
  await redis.set(`k${i}`, i);
}

// Pipeline：1 次 RTT
const pipeline = redis.pipeline();
for (let i = 0; i < 100; i++) {
  pipeline.set(`k${i}`, i);
}
await pipeline.exec();
```

**关键点**：Pipeline **不保证原子性**。它只是"打包发送"，服务端还是一条条执行，期间可能插入其他客户端的命令。Pipeline 是客户端特性，服务端感知不到"这批命令是一个整体"。

**② MULTI/EXEC 事务——解决"命令打包不可打断"问题**

事务把一组命令在 EXEC 时一次性、连续地执行，期间不会被其他客户端打断：

```
MULTI         // 开启事务
SET k1 v1
INCR counter
SET k2 v2
EXEC          // 一次性执行所有命令
```

**Redis 事务的两大特点**：
- **原子性是"执行原子"，不是"回滚原子"**：EXEC 时命令连续执行不可打断，但如果某条命令运行时出错（比如对字符串 INCR），**不会回滚已执行的命令**，后续命令继续执行。这跟关系型数据库事务完全不同。
- **不支持运行时回滚**：作者 antirez 的解释是"Redis 命令出错通常是程序 bug（类型用错），不应该靠回滚掩盖"。所以 Redis 没有 ROLLBACK。

编译时错误（命令名拼错、参数数量错）会导致整个事务在 EXEC 前就失败，所有命令都不执行。但运行时错误（类型错误）不阻断。

**③ WATCH——解决"事务内的乐观锁"问题**

WATCH 监视一个或多个 key，如果在 EXEC 之前这些 key 被修改了（包括自己修改、其他客户端修改、过期重置），整个事务被放弃（返回 nil）：

```
WATCH counter       // 监视
val = GET counter   // 读
val = val + 1
MULTI
SET counter val
EXEC                // 如果 counter 在 WATCH 后被改过，整个事务放弃，需重试
```

这是 CAS（Compare-And-Swap）的乐观锁模式——适合"读-改-写"竞争场景。

**④ Lua 脚本——解决"复杂原子逻辑"问题**

Lua 脚本在 Redis 服务端以"单线程串行"方式执行，天然原子，等价于"一条复合命令"：

```lua
-- 原子地 INCR 且过期 1 秒后清零
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], 1)
end
return current
```

Lua 比 MULTI/EXEC 强的地方：① 可以根据中间结果做条件判断（事务不行，EXEC 前不能看结果）；② 复杂逻辑可以写在一处，比堆命令清晰。我们限流（Q3 提到的限流计数器）就用 Lua 实现"固定窗口计数"——原子地 INCR + 判断阈值 + 设过期。

---

**🎤 面试官追问**

> Pipeline 和事务，我什么时候该用哪个？能结合一起用吗？

**🙋 候选人回答**

**判断标准是"你要不要原子性"和"中间要不要看结果"。**

- 只要减少 RTT、不在乎中间是否被打断 → **Pipeline**。典型是批量写入、批量读取（如批量设置缓存、批量 HGETALL）。
- 需要一组命令原子执行、中间不看结果 → **MULTI/EXEC**。典型是"同时更新多个关联 key"（如扣库存+加订单）。
- 需要"读-改-写"且防竞争 → **WATCH + MULTI/EXEC**。典型是计数器、秒杀库存。
- 逻辑复杂、要条件判断、要原子 → **Lua 脚本**。典型是限流、分布式锁释放（Q5 提到释放锁要 Lua 检查 lockId 防误删）。

**可以组合**：MULTI/EXEC 的事务命令本身可以用 Pipeline 发送，这样既原子又省 RTT。大部分客户端（ioredis、node-redis）的 `multi()` 默认就是 Pipeline + MULTI/EXEC 的组合。

我们 BullMQ 的入队（LPUSH 任务 + ZADD 优先级 + HSET 任务数据 + PUBLISH 通知）就是用 Pipeline + MULTI/EXEC——既省网络往返，又保证这几个 key 的写入原子（要么都写成功要么都不写，避免半成品状态）。

---

**🎤 面试官继续追问**

> MULTI/EXEC 既然不支持回滚，那它算事务吗？跟 MySQL 的事务差在哪？

**🙋 候选人回答**

**叫"事务"是历史命名，实质是"命令打包连续执行"，不是关系型那种 ACID 事务。差别在两点：**

**① 没有 ACID 的 I（隔离性）层面的事务语义**。Redis 单线程命令执行天然串行，所以"隔离性"等价于"全部跑完前别人插不进来"——这是"执行原子"。但 MySQL 事务有 RR（可重复读）、RC（读已提交）等隔离级别，支持 MVCC 快照读、行锁、间隙锁。Redis 没有这些。

**② 没有 A（原子性）的回滚**。MySQL 一个 SQL 失败可以 ROLLBACK 全部撤销；Redis 事务中一条命令运行时出错，前面已执行的不撤销，后面继续执行。比如事务里 `SET k1 v1` → `INCR k1`（k1 是字符串会出错）→ `SET k2 v2`，结果是 k1 被设了、k2 也被设了，只有 INCR 失败——这显然不是"原子"。

**结论**：Redis 事务的真正用途是"原子地提交一批命令"（防中间被打断），不是"出错能回滚"。需要回滚的业务逻辑要靠 Lua（把判断写在脚本里，错误时返回特定值由客户端处理），或者干脆下沉到 PG（强事务保证）。这也是为什么 BullMQ 的关键状态流转我们双写到 PG——PG 那边有真正的 ACID 事务兜底。

### 🏗 架构分析

- **为什么这么设计？** 四个机制对应四个不同维度的问题：Pipeline 对"网络"（RTT）、MULTI/EXEC 对"原子执行"（连续性）、WATCH 对"并发竞争"（乐观锁）、Lua 对"复杂原子逻辑"（条件判断）。把它们理解成"四个工具"而不是"四个相似概念"，才不会混。
- **为什么不用其它方案？**
    | 机制 | 解决问题 | 原子性 | 支持条件判断 | 跨命令 | 典型场景 |
    |------|---------|--------|------------|--------|---------|
    | Pipeline | RTT 开销 | 否（可能被打断） | 否 | 否 | 批量读写 |
    | MULTI/EXEC | 原子打包执行 | 是（执行原子） | 否 | 是 | 关联 key 同步更新 |
    | WATCH+MULTI/EXEC | 乐观锁 | 是 | 否（失败重试） | 是 | 读-改-写竞争 |
    | Lua 脚本 | 复杂原子逻辑 | 是 | 是 | 是 | 限流、锁释放 |
- **权衡**：Lua 脚本最强（原子+条件逻辑），但代价是脚本过长会阻塞单线程（脚本执行期间整个实例卡住）。所以 Redis 7 引入 lua-timeout，对超时脚本可中断。我们的实践是"逻辑短小才用 Lua"，复杂逻辑拆成多条命令加幂等控制。
- **未来演进**：当需要"多 key 跨分片的原子事务"（Cluster 下 MULTI/EXEC 只能同一分片），会从"Redis 端事务"演进到"业务层补偿事务"或下沉到 PG——Redis Cluster 本质上不支持跨 slot 事务，这是架构选型时就要认清的边界。

### 🎯 面试官真正考察什么

考察候选人能否把这四个容易混淆的概念按"解决的问题"区分清楚，而不是当名词解释。能讲出三个关键认知的人是真懂：① Pipeline 不原子、是客户端特性；② Redis 事务"执行原子但不回滚"，跟 MySQL 事务不是一回事；③ Lua 是最原子的（连条件判断都包含）。能联系到 BullMQ 入队用 Pipeline+MULTI 组合、限流用 Lua、释放锁用 Lua 的人，说明是真在用。

### ❌ 常见错误回答

- 把 Pipeline 和 MULTI/EXEC 都说成"事务"，混为一谈，说不清"Pipeline 不保证原子性"。
- 答"Redis 事务支持回滚"——错的，运行时出错不回滚。或者把不支持回滚说成"Redis 的 bug"，没理解设计意图。
- 不知道 Lua 脚本是原子的，把 Lua 当成"普通脚本语言"，没意识到它在服务端单线程串行执行。
- 不知道 WATCH 的乐观锁用法，遇到"读-改-写竞争"只会说"加分布式锁"——其实 WATCH 是更轻的方案。

### ✅ 推荐回答

> 四个机制解决不同问题：① Pipeline——打包命令减少 RTT，客户端特性，不保证原子（服务端还是一条条执行可被打断）；② MULTI/EXEC——命令打包连续执行，执行原子但不支持回滚（运行时出错前面不撤销后面继续，跟 MySQL 事务不是一回事）；③ WATCH——监视 key，EXEC 前被改过整个事务放弃，是 CAS 乐观锁，适合读-改-写竞争；④ Lua 脚本——服务端单线程串行执行天然原子，能做条件判断，适合复杂原子逻辑（限流、锁释放）。选择：减 RTT 用 Pipeline、关联 key 原子更新用 MULTI、读改写竞争用 WATCH+MULTI、复杂原子逻辑用 Lua。可组合——客户端 multi() 默认是 Pipeline+MULTI/EXEC。我们 BullMQ 入队（LPUSH+ZADD+HSET+PUBLISH）用 Pipeline+MULTI 既省往返又原子。Redis 事务跟 MySQL 差在：无回滚、无隔离级别（单线程天然串行）、无 MVCC，所以关键状态流转双写到 PG 兜底。

### 📚 延伸知识

- **DISCARD**：放弃事务——MULTI 后用 DISCARD 而不是 EXEC，所有排队命令作废，WATCH 也清空。
- **EVALSHA 优化**：Lua 脚本每次发全文浪费带宽，Redis 用 `SCRIPT LOAD` 缓存脚本返回 SHA1，之后用 `EVALSHA` 只发哈希，找不到再 fallback 到 EVAL。
- **Redis Cluster 与事务**：MULTI/EXEC 的命令必须落在同一 slot，跨 slot 直接报错。用 hash tag `{tag}key` 强制同分片才能事务。

---

## Q12. Redis 的主从复制原理

**🎤 面试官**

> 第二章 Q2 你说用主从+Sentinel。那主从复制的原理讲一下——全量同步和增量同步怎么区分？复制延迟和数据丢失窗口你了解吗？

**🙋 候选人回答**

**Redis 主从复制分两个阶段：全量同步（首次连接或断开太久）和增量同步（短暂断线后断点续传）。**

**① 全量同步（Full Resync）**

Slave 第一次连 Master，或断开太久增量同步失败时触发：

```
1. Slave 发送 PSYNC ? -1（首次）或 PSYNC <replid> <offset>（重连）
2. Master 判断需要全量同步
3. Master 执行 BGSAVE 生成 RDB 快照（fork 子进程，Q9 讲过）
4. 同时 Master 把这期间新的写命令缓存到"复制客户端输出缓冲区"
5. Master 把 RDB 文件发给 Slave
6. Slave 加载 RDB（清空旧数据 → 导入）
7. Master 把缓冲区里的增量命令发给 Slave
8. 之后进入"命令传播"阶段——Master 每条写命令实时复制给 Slave
```

这一步代价很大——Master 要 BGSAVE（fork 开销+内存峰值）、要传整个 RDB（大实例几 GB）、Slave 要清库重载（期间不能服务）。所以应该尽量避免频繁触发全量同步。

**② 增量同步（Partial Resync，Redis 2.8+）**

短暂断线后，Slave 重连想"只补丢失的那一段"，不想重新全量。机制靠三个东西：

- **replid（复制 ID）**：Master 的唯一标识。Slave 记住自己复制的 Master 的 replid。
- **offset（复制偏移量）**：Master 和 Slave 各维护一个累积字节偏移量，表示复制到了哪里。
- **replication backlog（复制积压缓冲区）**：Master 维护的一个环形缓冲区（默认 1MB），存最近的写命令。

Slave 重连时发 `PSYNC <replid> <offset>`：
- 如果 Slave 的 replid 还是当前 Master 的，且 offset 还在 backlog 环形缓冲区范围内 → **增量同步**，Master 从 backlog 里补发 offset 之后的命令。
- 如果 replid 变了（Master 换了），或 offset 已经被环形缓冲区覆盖掉了（断线太久，backlog 滚出去了）→ **退化为全量同步**。

`repl-backlog-size` 配置环形缓冲区大小——调大能容忍更长的断线时间，代价是占内存。我们的配置是 64MB，能容忍几分钟的网络抖动。

**③ 异步复制的本质与丢数据窗口**

Redis 复制是**异步**的——Master 写入后立即返回客户端成功，不等 Slave 确认。所以存在两个窗口：

- **延迟窗口**：Slave 数据落后于 Master 一段时间（毫秒到秒级）。
- **丢数据窗口**：Master 写入后还没复制到 Slave 就挂了，这条数据丢失。主从切换后，新 Master（原 Slave）没有这条数据。

这正是第二章 Q2 提到的"主从异步可能丢数据，用 PG 双写兜底"的技术根因。

---

**🎤 面试官追问**

> 那 Sentinel 的故障转移，依赖的是这套复制机制吗？切换过程中怎么保证不丢数据？

**🙋 候选人回答**

**Sentinel 依赖复制机制做状态判断和切换，但"切换不丢数据"它保证不了——只能减少丢失。**

Sentinel 故障转移流程：
1. **主观下线（SDOWN）**：单个 Sentinel 发现 Master 30 秒（`down-after-milliseconds`）没回应 PING。
2. **客观下线（ODOWN）**：超过 quorum 个 Sentinel 都判定 SDOWN，达成共识"Master 真挂了"。
3. **选举 Leader Sentinel**：Sentinel 之间用 Raft-like 算法选一个负责执行转移。
4. **选新 Master**：从 Slave 里挑——按优先级（slave-priority）> 复制偏移量（offset 最大=数据最新）> runid 最小。
5. **提升新 Master**：选中的 Slave 执行 `SLAVEOF NO ONE` 成为主，其它 Slave 执行 `SLAVEOF <new-master>` 跟新主。
6. **通知客户端**：客户端（BullMQ/Node）订阅 Sentinel 的频道，感知到切换后连新 Master。

**"不丢数据"做不到，只能"选数据最新的 Slave"**。第 4 步用 offset 最大选 Slave，意味着选的是"复制得最远"的那个——理论上丢的最少。但即使是最新的 Slave，也落后 Master 一段（异步延迟），Master 挂那一刻来不及复制的命令照样丢。

我们用的兜底还是 PG 双写（第四章 Q9）：任务在 Redis 里可能丢（主从异步窗口），但 PG 里有完整任务记录，重建时从 PG 回灌。**承认 Redis 主从异步有丢数据窗口，把可靠性需求交给 PG，这是我们的核心设计取舍。**

---

**🎤 面试官继续追问**

> 有没有办法让 Redis 复制变成"不丢"的？比如半同步？

**🙋 候选人回答**

**有，Redis 有 WAIT 命令和半同步复制（Wait Replica），但我们不用——因为代价不划算。**

`WAIT numreplicas timeout` 命令：客户端写完后调 WAIT，阻塞等待至少 `numreplicas` 个 Slave 确认收到这条命令，或超时。这是一种"客户端强制的同步复制"。但它有两个问题：

① **不严格保证**：WAIT 返回后，Slave 仍然可能在 Master 持久化前崩溃，且 WAIT 只保证"到达 Slave 内存"，不保证"Slave 持久化到磁盘"。

② **性能损失**：每次写都要等 Slave 确认，吞吐大幅下降，违背用 Redis 做"快存储"的初衷。

真正的"强一致复制"要共识算法（Raft/Paxos），Redis 没有内置。所以业内对"绝对不能丢"的场景，标准答案是用 etcd/ZooKeeper（Raft/ZAB 共识）或直接上 PG（同步流复制）。Redis 的定位就是"快但可能丢一点"，强行让它强一致是错配。

**我们的认知是：不要试图把 Redis 改造成 PG**。Redis 做快路径（队列流转）、PG 做可靠路径（状态持久化），各司其职。这才是正确的架构分层。

### 🏗 架构分析

- **为什么这么设计？** Redis 复制选"全量 + 增量"两层，是为了平衡"首次/灾难场景的完整性"和"日常抖动的效率"——全量同步代价大但能恢复任意状态，增量同步高效但只适用于"短暂断线"。异步复制则是"性能优先"的取舍——Redis 的核心卖点是快，同步复制会毁掉这个卖点。
- **为什么不用其它方案？**
    | 方案 | 同步方式 | 数据丢失 | 性能 | 一致性 | 结论 |
    |------|---------|---------|------|--------|------|
    | 全异步复制（Redis 默认） | Master 写完即返回 | 有（复制窗口） | 最高 | 最终一致 | 当前选型 |
    | 半同步（WAIT 命令） | 等至少 N 个 Slave 确认 | 少（仍不严格） | 中 | 较强 | 性能损失大，收益有限 |
    | 同步复制（PG 流复制） | 等所有副本刷盘 | 无 | 低（要等磁盘） | 强一致 | Redis 做不到，要换 PG |
    | 共识算法（etcd Raft） | 多数派确认 | 无 | 低（投票） | 强一致 | 强一致场景用 etcd |
- **权衡**：异步复制换来了高吞吐和低延迟，代价是主从切换的丢数据窗口。我们的兜底是 PG 双写——Redis 丢了用 PG 补，比"改造 Redis 强一致"的代价（性能损失、引入复杂机制）划算得多。
- **未来演进**：如果出现"Redis 也不能丢"的强一致需求，方向不是改 Redis，而是把那部分数据下沉到 PG/etcd——这是"用对工具"而非"改造工具"。

### 🎯 面试官真正考察什么

考察三层：① 能不能讲清 PSYNC 全量 vs 增量的区分条件（replid + offset + backlog 环形缓冲），而不是只会说"主从同步"；② 能不能识别"异步复制必然有丢数据窗口"，并理解 Sentinel 的 offset 选主只是"少丢"不是"不丢"；③ 能不能给出"Redis 不强一致，用 PG 兜底"的正确工程取舍，而不是幻想"Redis 加配置就强一致"。能讲清 WAIT 命令局限性的人，说明真的研究过。

### ❌ 常见错误回答

- 答"主从同步就是 Master 写完同步给 Slave"，说不清全量 vs 增量，更不知道 backlog、offset、replid 这些机制。
- 把 Sentinel 故障转移说成"保证不丢数据"——错，Sentinel 只能"选数据最新的 Slave"，丢数据窗口仍在。
- 答"用 WAIT 命令就能强一致"——没意识到 WAIT 不严格、且有性能代价。
- 把 Redis 复制跟 MySQL/PG 同步复制等同——完全不同的设计取舍，Redis 是性能优先。

### ✅ 推荐回答

> Redis 主从复制两层：① 全量同步（PSYNC）——Slave 首次连或断开太久，Master BGSAVE 生成 RDB（fork+COW）发给 Slave，期间新命令缓存到复制缓冲区，Slave 加载 RDB 后补发增量；② 增量同步（Partial Resync，2.8+）——短暂断线后，Slave 发 PSYNC replid offset，Master 判断 replid 一致且 offset 还在 replication backlog（默认 1MB 环形缓冲）范围内，就只补发丢失段，否则退化为全量。复制是异步的——Master 写完即返回不等 Slave 确认，所以有丢数据窗口（Master 未复制就挂了，新 Master 没这条）。Sentinel 故障转移依赖复制：SDOWN→ODOWN→选 Leader Sentinel→按优先级+offset 选新 Master（offset 最大=数据最新）→SLAVEOF NO ONE 提升→通知客户端。但"不丢数据"做不到，只能"选最新 Slave 少丢"。WAIT 命令是客户端强制半同步但不严格且有性能损失。Redis 定位是快但可能丢，我们用 PG 双写兜底，不强求 Redis 强一致。

### 📚 延伸知识

- **replication backlog 调优**：`repl-backlog-size` 调大（如 64MB-256MB）能容忍更长断线、减少全量同步概率；`repl-backlog-ttl` 控制 Master 无 Slave 时 backlog 保留多久。
- **级联复制**：Slave 也可以作为别的 Slave 的 Master（链式），减少 Master 的复制压力。
- **Redis 7.0 多副本共享 RDB**：多个 Slave 同时请求全量同步时，Master 只 BGSAVE 一次共享 RDB，减少 fork 开销。

---

## Q13. Redis 的热 Key 问题怎么解决？

**🎤 面试官**

> 假设我们平台有个爆款任务，它对应的状态 key 被前端轮询疯狂查询，单 key QPS 到了 5 万。这种"热 Key"问题怎么解决？

**🙋 候选人回答**

**先定义清楚"热 Key"——单 key 或极少数 key 承载了远超平均的访问量，导致这个 key 所在的 Redis 单线程实例、单分片被打爆。** 它跟大 Key（Q7）是对应的：大 Key 是"单 key 数据量大"，热 Key 是"单 key 访问量大"。两者都可能压垮单点。

**热 Key 的危害**：
- 单分片 CPU 100%（如果是 Cluster，热 key 所在分片被打爆，其他分片闲着）。
- 单实例单线程被这个 key 的命令占满，其他 key 响应变慢。
- 网卡出口被打满（如果这个 key 的 value 大）。

**怎么发现热 Key**：
- `redis-cli --hotkeys` 命令（需开启 LFU 淘汰策略，4.0+），扫描出访问频率最高的 key。
- `OBJECT FREQ key` 查看单个 key 的 LFU 频率。
- `redis-cli --latency` 或 `INFO commandstats` 看命令分布。
- 监控层面：对 Redis 实例的 QPS、CPU 做分维度监控，发现某实例 QPS 异常高时排查是不是单 key 导致的。
- 业务层面：从应用端统计 key 访问日志，识别热点。

**解决方案，从轻到重：**

**① 本地缓存（应用层多级缓存）——首选**

最有效。在应用进程内用 LRU 缓存（node-cache、lru-cache）缓存热 key 的值，设置很短的 TTL（1-5 秒）。这样大部分请求根本不打 Redis。

```typescript
const NodeCache = require('node-cache');
const localCache = new NodeCache({ stdTTL: 2 });  // 本地缓存 2 秒

async function getTaskStatus(taskId: string) {
  const cacheKey = `task:${taskId}`;
  // 1. 先查本地缓存（命中率最高）
  const local = localCache.get(cacheKey);
  if (local) return local;
  // 2. 再查 Redis
  const val = await redis.get(cacheKey);
  if (val) {
    localCache.set(cacheKey, val);  // 回填本地
  }
  return val;
}
```

代价是"短时不一致"——本地缓存 2 秒内可能读到旧值。对"任务状态查询"这种场景，2 秒延迟可接受。

**② key 分片/打散——把热点拆成多个**

把一个热 key 拆成 N 个（如 `task:status:abc:0` ~ `task:status:abc:9`），写入时同时写 N 份，读取时随机选一个读。这样单 key 的 QPS 分散到 N 份上。Cluster 下还能让 N 份落到不同分片，彻底分散单点压力。

```typescript
const N = 10;
const shardIdx = Math.floor(Math.random() * N);
const key = `task:status:${taskId}:${shardIdx}`;
```

代价是写入放大（写 N 份）和数据冗余。

**③ 读副本（读写分离）——利用多个 Slave 分摊读**

主从架构下（Q12），读请求分发到多个 Slave，把单实例的读压力分摊到 N 个副本。代价是读副本有延迟（异步复制），可能读到旧值。

---

**🎤 面试官追问**

> 本地缓存方案听起来好，但如果是多实例部署（10 个 Node 进程），每个进程都缓存一份，数据更新了怎么办？

**🙋 候选人回答**

**这是本地缓存的核心矛盾——"每个实例一份缓存"导致更新时各实例不一致。我们的处理：**

**① 短 TTL 兜底（最简单，我们用这个）**

本地缓存 TTL 设很短（2-5 秒），容忍这个时间窗口的不一致。任务状态查询是"展示用"，2 秒延迟用户感知不到，所以不需要强一致。一旦 TTL 到期，下次读会从 Redis 拉到最新值。

**② Pub/Sub 主动失效（更精确）**

数据更新时通过 Redis Pub/Sub 广播一个失效消息，所有应用实例订阅，收到后主动删本地缓存：

```typescript
// 更新时
await redis.set(`task:${taskId}`, newVal);
await redis.publish('cache:invalidate', `task:${taskId}`);

// 每个实例订阅
redis.subscribe('cache:invalidate', (channel, key) => {
  localCache.del(key);
});
```

代价是增加复杂度，且 Pub/Sub 不保证可靠（Q8 讲过发即忘，订阅方没在线消息就丢）。所以 Pub/Sub 失效 + 短 TTL 兜底，两层防御。

**③ 版本号/ETag 校验**

本地缓存带版本号，读时先比对版本，版本变了才真正读 value。减少大 value 的传输。

我们的选择是"短 TTL + Pub/Sub 失效"组合：日常靠短 TTL 自动收敛，更新频繁的热 key 加 Pub/Sub 主动失效。简单有效，不追求绝对一致。

---

**🎤 面试官继续追问**

> 那这个爆款任务的状态，你从一开始设计就考虑热 Key 了吗？还是出事了才补救？

**🙋 候选人回答**

**老实说，是出事了才补救——这是真实的成长过程。** 最初我们的任务状态查询就是直接读 Redis，没本地缓存。直到有一次一个爆款视频生成任务被几十个用户同时盯着进度页轮询，单 key QPS 飙到 5 万，Redis 单实例 CPU 90%，其他业务都受影响。

事后复盘我们做了两件事：

**短期**：立刻给任务状态查询加本地缓存（node-cache + 2 秒 TTL），单实例 QPS 从 5 万降到 2000（命中率 96%），Redis CPU 降到正常。

**长期（设计规范）**：把"所有对外暴露的查询接口"都按"可能成为热 Key"来设计——默认走"本地缓存 + Redis"两级。新增需求时，凡是"会被多个用户同时访问的数据"（如热门内容、共享配置），从一开始就上多级缓存，不等出事。

**如果重新设计**：BullMQ 的任务进度本身就支持 Pub/Sub 推送（Q8），不应该让前端轮询 Redis——改成 WebSocket + Pub/Sub 推进度，从源头消除轮询热点。这是从"事后加缓存"到"架构层规避"的演进。

### 🏗 架构分析

- **为什么这么设计？** 热 Key 的根因是"单点承载过量"，所以解法的本质是"分流"——本地缓存把请求挡在 Redis 之前（最有效）、key 分片把单点拆成多点、读副本把单实例读分摊到多实例。三者按"改请求侧 → 改数据侧 → 改基础设施侧"递进。
- **为什么不用其它方案？**
    | 方案 | 效果 | 实现复杂度 | 一致性影响 | 结论 |
    |------|------|-----------|-----------|------|
    | 本地缓存（node-cache，我们） | 极好（拦截大部分请求） | 低 | 短时不一致 | 首选 |
    | key 分片（N 份随机读） | 好（分摊到 N 份） | 中 | 写放大、需同步 N 份 | Cluster 下值得 |
    | 读副本（多 Slave 读） | 中（分摊到 N 实例） | 中 | 异步延迟 | 读多副本架构已有时用 |
    | 升级单实例规格（加 CPU/内存） | 弱（治标不治本） | 低 | 无 | 临时缓解 |
- **权衡**：本地缓存换来了 Redis 压力骤降，代价是多实例数据不一致。对"展示用、容忍延迟"的场景（任务状态、热门内容）这个代价可接受；对"强一致"场景（库存、余额）不能用本地缓存，要用 key 分片或读副本。
- **未来演进**：从"事后加缓存"演进到"架构层规避热点"——用 Pub/Sub 推送替代轮询、用 CDN 挡静态热点、用限流防恶意刷。热 Key 不是单纯 Redis 问题，是整个读路径的设计问题。

### 🎯 面试官真正考察什么

考察三点：① 能不能区分热 Key 和大 Key（访问量大 vs 数据量大），知道热 Key 危害是"单点压力"；② 能不能给出"本地缓存首选 + key 分片 + 读副本"的分层方案，而不是只会"加机器"；③ 能不能识别本地缓存的多实例一致性问题并给出解法（短 TTL + Pub/Sub 失效）。能坦诚"出事才补救"并讲清演进路径的人，比假装"一开始就考虑"的人可信。

### ❌ 常见错误回答

- 把热 Key 和大 Key 混为一谈，或只说"热 Key 就是访问频繁的 key"，说不清危害（单点打爆）。
- 解法只说"升级 Redis 配置"或"加机器"——治标不治本，单点压力不解决。
- 不知道本地缓存方案，或知道但答不出"多实例不一致怎么办"。
- 不知道怎么发现热 Key（`--hotkeys`、监控），纯靠出事才发现。

### ✅ 推荐回答

> 热 Key 是单 key 承载远超平均的访问量（如爆款任务状态被前端轮询 QPS 5 万），危害是单分片/单实例 CPU 打爆、单线程被占满、影响其他 key。发现：redis-cli --hotkeys（需 LFU）、OBJECT FREQ、监控 QPS/CPU 分维度、应用端 key 访问统计。解决方案：① 本地缓存（node-cache 2-5 秒 TTL）首选——把请求挡在 Redis 之前，命中率 90%+，代价短时不一致；② key 分片（task:status:id:0~9 随机读）拆单点为多点，Cluster 下分散到不同分片；③ 读副本（多 Slave 分摊读）利用主从读写分离。本地缓存多实例不一致解法：短 TTL 兜底（默认）+ Pub/Sub 主动失效（更新时广播删本地）。我们的真实经历：爆款视频任务轮询打爆 Redis，事后加本地缓存 QPS 从 5 万降到 2000，复盘后所有对外查询接口默认两级缓存。如果重新设计：用 WebSocket+Pub/Sub 推进度替代轮询，从架构层消除热点。

### 📚 延伸知识

- **LFU 计数与热 Key 发现**：`--hotkeys` 依赖 LFU 计数，所以要在 `maxmemory-policy` 配 allkeys-lfu 或 volatile-lfu 才有效。LFU 用 Morris 计数器（概率递增）+ 时间衰减。
- **Redis Cluster 的 slot 热点**：Cluster 下单个 slot 可能成热点（key 哈希到同一 slot），可用 hash tag 控制 key 落点，或重新设计 key 分布。
- **限流兜底**：对热 key 加 token bucket / sliding window 限流（Redis + Lua 实现），防止恶意刷爆。

---

## Q14. Redis 6.0 的多线程模型

**🎤 面试官**

> 第四章 Q4 你说"Redis 单线程反而快"，但 Redis 6.0 又引入了多线程。这不是矛盾吗？6.0 的多线程到底改了什么？为什么不全改成多线程？

**🙋 候选人回答**

**不矛盾——6.0 的多线程只动了一件事：网络 I/O，命令执行仍然是单线程。** 这是"哪里是瓶颈就优化哪里"的精准取舍，不是推翻单线程设计。

**先回顾为什么 Redis 原本单线程（Q4）**：
- 纯内存操作，命令执行本身极快（微秒级）。
- 单线程无锁、无上下文切换，命令天然原子。
- 瓶颈不在 CPU 算力，而在网络 I/O 和内存访问。

**但随着 QPS 上去，瓶颈转移了**——当 Redis 单实例 QPS 到几十万、连接数上万时，**网络 I/O（读取 socket、协议解析、写回 socket）成了瓶颈**，而命令执行仍然不是瓶颈。单线程处理网络 I/O 时，大量的 read/write 系统调用把主线程占满了。

**6.0 的多线程 I/O 做的事**：

把网络 I/O 拆出去给多个 I/O 线程并行处理，主线程只负责命令执行：

```
传统单线程模型（≤5.0）：
  [读 socket] → [解析协议] → [执行命令] → [写 socket]   全在主线程串行

6.0 多线程 I/O 模型：
  I/O 线程池：[读 socket + 解析协议] ← 多线程并行
  主线程：            ↓
                   [执行命令]        ← 仍然单线程、无锁、原子
  I/O 线程池：       ↓
                   [写回 socket]      ← 多线程并行
```

配置：`io-threads 4`（建议 CPU 核数的一半左右），`io-threads-do-reads yes`（读也用多线程，默认只写多线程）。

**效果**：在高并发、大 value（网络传输重）场景下，吞吐能提升 1-2 倍。命令执行单线程的优势（无锁、原子）完全保留。

---

**🎤 面试官追问**

> 那为什么不干脆把命令执行也多线程化？性能不是更高吗？

**🙋 候选人回答**

**这是经典追问。Redis 一直没有把命令执行多线程化，是经过深思熟虑的，核心原因有三个：**

**① 命令执行多线程 = 必须加锁，违背 Redis 设计哲学**

Redis 所有数据结构在单线程下天然无锁——访问一个 Hash 不用加锁，操作一个 Sorted Set 不用加锁。一旦命令执行多线程，所有数据结构都要加细粒度锁（行锁、对象锁），并发访问同一 key 要互斥。锁竞争、死锁风险、锁开销，全部回来了——Redis 引以为傲的"无锁快"就没了。

**② 复杂度爆炸，收益有限**

命令执行本身是微秒级（纯内存操作），多线程化的收益远不如想象。真正耗时的是网络 I/O（毫秒级，比命令执行慢 1000 倍）和慢命令（大 key 操作）。优化网络 I/O（6.0 已做）收益巨大，优化命令执行收益小、代价大。

**③ Redis 的定位是"内存数据库"，不是"CPU 密集型数据库"**

CPU 密集场景（如分析型查询）才需要多核并行。Redis 是 KV 内存存储，单核算力完全够用。真正扩展方向是"多实例 + Cluster"水平扩展，不是"单实例多核"垂直扩展。一台 32 核机器跑 16 个 Redis 实例，比跑一个 16 线程的 Redis 实例更简单、更稳、扩展性更好。

**反例**：KeyDB、Dragonfly 等项目尝试做"多线程 Redis"，确实提升了单实例性能，但工程复杂度大（要处理所有数据结构的并发安全）、生态兼容性有坑。Redis 官方选择了"保守路线"——只动网络 I/O，命令执行保持单线程，这是工程稳健性的体现。

---

**🎤 面试官继续追问**

> 那你们实际用 6.0 的多线程 I/O 了吗？什么场景值得开？

**🙋 候选人回答**

**开了，但只在高并发、大 value 的实例上开，不是所有实例都开。**

**值得开多线程 I/O 的场景**：
- 高并发连接（>1000）、高 QPS（>10 万）。
- value 较大（如 BullMQ 任务 payload 较大、缓存大对象），网络传输重。
- 网络成为瓶颈（`INFO clients` 看 connected_clients 多、网卡流量接近上限）。

**不值得开的场景**：
- QPS 低（<1 万）、连接少——单线程够用，开多线程反而有线程切换开销。
- value 极小（几十字节）——网络 I/O 不是瓶颈，开多线程没收益。
- CPU 核数少（1-2 核）——I/O 线程和主线程抢核。

我们的配置策略：
- **BullMQ 队列实例**：开 `io-threads 4`——QPS 高、payload 有一定大小、连接多。
- **缓存实例**：看情况——高 QPS 的缓存开，低 QPS 的不开。
- **配置/元数据实例**：不开——QPS 低、value 小。

`io-threads` 参数不是越大越好。官方建议：4 核机器设 2-3，8 核机器设 4-6。设太大会让 I/O 线程和主线程争抢 CPU，反而变慢。我们经过压测调到 4（8 核机器），吞吐比单线程提升约 60%。

### 🏗 架构分析

- **为什么这么设计？** Redis 6.0 多线程 I/O 的本质是"瓶颈驱动的优化"——命令执行不是瓶颈（微秒级）、网络 I/O 是瓶颈（毫秒级），所以只优化网络 I/O。这是"用最小改动解决最大问题"的工程智慧，比"全盘多线程化"风险小得多。
- **为什么不用其它方案？**
    | 模型 | 命令执行 | 网络 I/O | 锁开销 | 性能 | 复杂度 | 结论 |
    |------|---------|---------|--------|------|--------|------|
    | 单线程（≤5.0） | 单 | 单（epoll） | 无 | 中（高并发瓶颈） | 低 | 简单但网络成瓶颈 |
    | 多线程 I/O（6.0+，我们） | 单 | 多 | 无（命令串行） | 高 | 中 | 当前最优解 |
    | 全多线程（KeyDB/Dragonfly） | 多 | 多 | 大（要细粒度锁） | 最高 | 高 | 工程复杂、兼容性风险 |
- **权衡**：多线程 I/O 换来了网络吞吐提升，代价是配置复杂度（要调 io-threads 数、压测验证）和少量线程开销。对低 QPS 场景这个代价不划算，所以"按需开启"是关键。
- **未来演进**：Redis 7+ 持续优化多线程 I/O（如读写都用多线程、I/O 线程数自适应），但"命令执行单线程"的本质不会变——变了就不是 Redis。真正需要全多线程 KV 的场景，会评估 Dragonfly（Redis 协议兼容、多线程架构）作为替代。

### 🎯 面试官真正考察什么

考察三个关键认知：① 能不能讲清"6.0 多线程只动网络 I/O、命令执行仍单线程"，纠正"Redis 现在是多线程命令执行"的常见误解；② 能不能解释"为什么不全多线程"——锁开销、复杂度、定位（内存 vs CPU 密集），看到设计权衡；③ 能不能结合业务给出"哪些实例开、哪些不开"的判断，而不是无脑全开。能讲清"瓶颈驱动优化"思路的人，是真理解系统性能。

### ❌ 常见错误回答

- 答"Redis 6.0 是多线程的了"——错，命令执行仍单线程，多线程只用于网络 I/O。
- 把 6.0 多线程说成"Redis 终于支持多核了"——曲解，单实例仍用不满多核（命令执行单线程），要多核还是靠多实例。
- 不知道为什么要保留命令执行单线程，答"因为 Redis 没能力做多线程"——完全反了，是主动选择（无锁、原子、简单）。
- 对 io-threads 配置没概念，答"开越大越好"——线程和主线程争抢 CPU 反而变慢。

### ✅ 推荐回答

> Redis 6.0 多线程只动网络 I/O，命令执行仍单线程——不矛盾，是"瓶颈驱动优化"。原本单线程因为命令执行微秒级（纯内存），瓶颈在网络 I/O（毫秒级，比命令慢 1000 倍）。高 QPS+大 value 时单线程 read/write 系统调用占满主线程，所以 6.0 把读 socket+协议解析+写 socket 拆给 I/O 线程池并行，主线程只执行命令。配置 io-threads 4（4 核建议 2-3，8 核建议 4-6）。为什么不全多线程化：① 命令执行多线程要加锁，违背 Redis 无锁设计哲学；② 命令执行微秒级，多线程收益小代价大；③ Redis 是内存数据库非 CPU 密集，扩展靠多实例+Cluster 水平扩展不是单实例多核。值得开多线程 I/O 的场景：高并发（>1000 连接）、大 value、网络瓶颈；不值得：QPS 低、value 小、核数少。我们 BullMQ 队列实例开 io-threads 4（QPS 高 payload 大），缓存实例看情况，元数据实例不开。压测吞吐提升约 60%。

### 📚 延伸知识

- **io-threads 调优**：官方建议不超过 CPU 核数的一半。`io-threads-do-reads yes` 让读也走多线程（默认只写）。配合 `client-output-buffer-limit` 避免大 value 输出缓冲打爆内存。
- **KeyDB / Dragonfly**：多线程 Redis 替代品。KeyDB（被 Snap 收购）线程共享架构；Dragonfly（2022 开源）用共享无锁数据结构，单实例性能数倍于 Redis，兼容 Redis 协议但部分命令行为有差异。
- **Redis 7 I/O 优化**：7.0 改进了 I/O 线程的负载均衡，减少主线程等待 I/O 线程的阻塞时间；7.4 引入更细粒度的 I/O 调度。

---

## 本章总结

第七章 14 道题，前 8 道结合项目讨论 Redis 的核心使用场景，后 6 道（Q9-Q14）补全 Redis 的底层技术原理。回顾：

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
| 持久化机制 | AOF everysec+混合持久化，BullMQ 任务不能丢 | Q9 |
| 内存淘汰策略 | 8 种策略，缓存实例 LRU + 队列实例 noeviction 隔离 | Q10 |
| Pipeline 与事务 | Pipeline 减 RTT，MULTI/EXEC 执行原子不回滚，Lua 复杂原子 | Q11 |
| 主从复制原理 | PSYNC 全量+增量，异步复制有丢数据窗口，PG 兜底 | Q12 |
| 热 Key 问题 | 本地缓存首选+key 分片+读副本，短 TTL+Pub/Sub 失效 | Q13 |
| 6.0 多线程模型 | 只动网络 I/O，命令执行仍单线程，瓶颈驱动优化 | Q14 |

**核心原则**：Redis 是"快存储"不是"真持久化"，和 PG 分工——Redis 管速度，PG 管可靠。分布式锁无完美方案，关键是锁失效后的兜底（幂等）。Redis 的每一个设计（单线程、异步复制、近似 LRU、不回滚事务）都是"性能优先"的取舍，理解这些取舍比背概念重要——遇到可靠性需求时，正确答案是"用 PG/etcd 兜底"，而不是"改造 Redis 强一致"。

下一章进入[第八章：PostgreSQL](chapter-08-postgresql.md)——索引、事务、MVCC、Explain、优化。

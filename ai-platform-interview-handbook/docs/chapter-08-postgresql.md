# 第八章 PostgreSQL

> PG 是我们的持久化数据库——任务状态、Prompt、Token 统计、用户权限都存在 PG。本章结合项目讨论索引、事务、MVCC、Explain、优化，不背概念。
>
> 本章共 14 题。

---

## Q1. 索引怎么设计？

**🎤 面试官**

> 你们的 tasks 表有几十万条数据，查询模式各异。索引怎么设计的？

**🙋 候选人回答**

**先看查询模式，再设计索引。** 不看查询模式盲目加索引是灾难——每个索引增加写入成本。

**tasks 表的主要查询模式：**

```sql
-- ① 按 ID 查单条（最频繁）
SELECT * FROM tasks WHERE id = $1;

-- ② 按状态+时间查列表（管理后台/监控）
SELECT * FROM tasks WHERE status = 'RUNNING' AND created_at > $1 ORDER BY created_at DESC LIMIT 50;

-- ③ 按项目+时间查列表（业务方查自己的任务）
SELECT * FROM tasks WHERE project_id = $1 AND created_at > $2 ORDER BY created_at DESC LIMIT 50;

-- ④ 按 Task ID 关联查 Token 使用（统计）
SELECT SUM(prompt_tokens + completion_tokens) FROM token_usage WHERE task_id = $1;
```

**对应的索引设计：**

```sql
-- ① 主键索引（自动创建）
PRIMARY KEY (id)

-- ② 复合索引：状态+时间（覆盖查询②）
CREATE INDEX idx_tasks_status_created ON tasks(status, created_at DESC);

-- ③ 复合索引：项目+时间（覆盖查询③）
CREATE INDEX idx_tasks_project_created ON tasks(project_id, created_at DESC);

-- ④ Token 使用表的 task_id 索引
CREATE INDEX idx_token_usage_task ON token_usage(task_id);
```

**关键原则：**

**① 索引顺序遵循"等值在前，范围在后"**

```sql
-- 好：status 等值 + created_at 范围
CREATE INDEX idx_tasks_status_created ON tasks(status, created_at DESC);

-- 不好：created_at 范围在前，status 等值在后
CREATE INDEX idx_tasks_created_status ON tasks(created_at DESC, status);
-- created_at 范围查询后，status 无法走索引（因为范围后的列不能用索引）
```

**② 不要过度索引**

每个索引增加写入成本（INSERT/UPDATE 要更新索引）。tasks 表写入频繁，索引多了写入变慢。我们只对"高频查询"建索引，低频查询全表扫描可接受。

**③ 索引不是万能的**

如果查询返回大量数据（如 status='COMPLETED' 有 90% 的行），索引反而不如全表扫描——因为索引要回表（先查索引拿 ID，再查表拿数据），大量数据的回表成本高于直接扫表。PG 的优化器会自动选择全表扫描。

---

**🎤 面试官追问**

> 你提到"索引顺序：等值在前范围在后"。能不能深入讲讲为什么？索引的底层结构是什么？

**🙋 候选人回答**

**PG 的默认索引是 B-Tree（平衡多路搜索树）。**

```
B-Tree 结构（简化）：
         [50]
        /    \
    [20,40]  [70,80]
   / | | \   / | | \
 [10][20][30][40][50][60][70][80]
```

B-Tree 的特点：数据有序存储，查找 O(logN)。复合索引 `(status, created_at)` 的排序规则是：先按 status 排序，status 相同的再按 created_at 排序。

```
复合索引 (status, created_at) 的存储：
  COMPLETED, 2026-07-10
  COMPLETED, 2026-07-11
  COMPLETED, 2026-07-12
  FAILED,    2026-07-10
  FAILED,    2026-07-11
  RUNNING,   2026-07-10
  RUNNING,   2026-07-11
```

**为什么"等值在前范围在后"能走索引？**

```sql
-- 查询：status='RUNNING' AND created_at > '2026-07-10'
-- 索引：(status, created_at)

-- B-Tree 先定位 status='RUNNING' 的范围（等值查询，精确定位）
-- 然后在 RUNNING 的范围内，找 created_at > '2026-07-10'（范围查询，连续扫描）
-- ✅ 两个条件都能用索引
```

**反过来为什么不行？**

```sql
-- 查询：created_at > '2026-07-10' AND status='RUNNING'
-- 索引：(created_at, status)

-- B-Tree 先定位 created_at > '2026-07-07-10'（范围查询，跨多个 status 值）
-- 在这个范围内，status 是无序的（因为 created_at 优先排序）
-- 要在结果里过滤 status='RUNNING'，不能走索引，只能回表判断
-- ❌ status 条件不能用索引
```

**核心原理：B-Tree 的复合索引按列顺序排序。第一列确定后第二列才有序。等值查询"锁定"第一列的值，第二列在锁定的范围内有序可用。范围查询不"锁定"值，后续列无序不可用。**

---

**🎤 面试官继续追问**

> 你用了复合索引，有没有考虑过覆盖索引（Covering Index）？PG 支持 INCLUDE 子句。

**🙋 候选人回答**

**用过。覆盖索引避免回表。**

```sql
-- 查询：SELECT status, created_at FROM tasks WHERE project_id = $1
-- 普通索引：先查索引拿 ID，再回表拿 status/created_at
CREATE INDEX idx_tasks_project ON tasks(project_id);

-- 覆盖索引：把查询的列直接放索引里，不用回表
CREATE INDEX idx_tasks_project_covering ON tasks(project_id) INCLUDE (status, created_at);
```

**INCLUDE 的列不参与索引排序**（只存值），所以不影响索引的有序性，但查询时直接从索引拿数据不用回表。

**我们的使用场景**：token_usage 表的统计查询——`SELECT SUM(prompt_tokens) FROM token_usage WHERE project_id = $1 AND created_at > $2`。如果用覆盖索引包含 prompt_tokens，查询完全在索引上完成不回表：

```sql
CREATE INDEX idx_token_usage_project_created 
  ON token_usage(project_id, created_at) 
  INCLUDE (prompt_tokens, completion_tokens);
```

**但覆盖索引增加索引大小**（存的列多了）和写入成本。只对"高频+只查特定列"的查询用。如果查询 `SELECT *`，覆盖索引没意义（要返回所有列，还是要回表）。

### 🏗 架构分析

- **为什么这么设计：** 索引由查询模式驱动，不是先建表再想索引。我们先把 tasks 表的高频查询列出来（按 id、按 status+time、按 project+time、token_usage 按 task_id 聚合），每条查询对应一个索引，避免"为了建而建"。
- **为什么不用其它方案：**
  - **单列索引 vs 复合索引**：给 status、created_at 各建一个单列索引，PG 只能用其中一个 + 回表过滤另一个，比 `(status, created_at DESC)` 一次定位差很多。复合索引能用上一列的排序天然支持 `ORDER BY created_at DESC` 避免额外 sort。
  - **B-Tree vs Hash vs GIN vs BRIN**：B-Tree 支持等值+范围+排序，覆盖 99% 查询，所以默认 B-Tree；Hash 只能等值且不支持 `ORDER BY`/范围，几乎不用；GIN 给 JSONB/全文检索（见 Q5）；BRIN 适合时序大表（如按时间追加的日志表），blocks 级范围索引，体积极小但不适合 tasks 这种随机更新。
  - **覆盖索引 vs 普通索引**：token_usage 的 `SUM(prompt_tokens)` 查询如果普通索引要回表，列多时回表代价大；用 `INCLUDE (prompt_tokens, completion_tokens)` 让查询在索引上完成。代价是索引变大、写入变慢，只对高频+固定列查询用。
- **权衡：** 每加一个索引，INSERT/UPDATE 都要维护它——tasks 表写入频繁，索引越多写入越慢。所以原则是"只对高频查询建索引，低频全表扫可接受"。大比例匹配查询（如 status='COMPLETED' 占 90%）优化器会自动放弃索引走全表扫，因为回表比直接扫表还慢。
- **未来演进：** 数据量上去后考虑分区表（按 created_at 月分区）让索引更小更局部；引入 `pg_stat_statements` 找出真正高频查询再针对性补索引；对只查固定列的报表查询推广覆盖索引。

| 原则 | 说明 |
|------|------|
| 等值在前范围在后 | B-Tree 复合索引的排序规则 |
| 不过度索引 | 每个索引增加写入成本 |
| 覆盖索引 | 高频查询+特定列避免回表 |
| 让优化器选择 | 大量数据时全表扫描可能更优 |

### 🎯 面试官真正考察什么

不是背"B-Tree 是什么"，而是看你会不会**从查询模式反推索引设计**，并能否讲清复合索引列顺序背后的底层原理（排序规则、等值锁定 vs 范围不锁定）。顺带考察"过度索引"的工程权衡意识。

### ❌ 常见错误回答

- "给每个字段都加索引"——忽略写入成本和复合索引的协同。
- "索引越多查询越快"——大比例匹配查询索引反而更慢（回表）。
- 复合索引列顺序随便排——答不出为什么"等值在前范围在后"。
- 只会背 B-Tree 概念，讲不清 INCLUDE 覆盖索引和不回表的关系。

### ✅ 推荐回答

> 先看查询模式再设计索引。tasks 表：主键 id、复合索引(status,created_at DESC) 覆盖按状态+时间查、复合索引(project_id,created_at DESC) 覆盖按项目+时间查、token_usage 的 task_id 索引。核心原则"等值在前范围在后"——B-Tree 复合索引按列顺序排序，第一列等值查询锁定值后第二列在范围内有序可用，范围查询不锁定值后续列无序不可用。覆盖索引用 INCLUDE 把查询列放索引里避免回表，用于高频+特定列查询（如 token 统计 SUM(prompt_tokens)）。不过度索引因为每个索引增加写入成本。大比例查询（如 90% 行匹配）优化器自动选全表扫描因为回表成本更高。

### 📚 延伸知识

- **B-Tree vs Hash Index**：B-Tree 支持等值+范围+排序，Hash 只支持等值。PG 默认 B-Tree。
- **Partial Index**：`CREATE INDEX ... WHERE status = 'RUNNING'` 只索引特定条件的行。适合"只查某状态"的场景，索引更小。

---

## Q2. 事务和隔离级别

**🎤 面试官**

> 你们任务状态更新用乐观锁（第四章 Q2）。如果用悲观锁，隔离级别怎么选？PG 的隔离级别有什么特点？

**🙋 候选人回答**

**PG 支持三个隔离级别（没有 Read Uncommitted，因为 PG 的 RU 等同于 RC）：**

| 隔离级别 | PG 实现 | 防什么 | 代价 |
|----------|---------|--------|------|
| Read Committed（默认） | 每条语句读最新提交 | 脏读 | 有不可重复读+幻读 |
| Repeatable Read | 事务级快照 | 脏读+不可重复读+幻读 | 可能序列化失败需重试 |
| Serializable | SSI（序列化快照隔离） | 所有并发问题 | 性能最低+可能序列化失败 |

**PG 的特殊之处：**

**① PG 的 RR 防幻读**

SQL 标准的 RR 允许幻读，但 PG 的 RR 是真正的快照隔离（Snapshot Isolation）——同一事务里多次查询结果一致，防幻读。这比 MySQL 的 RR 更强。

**② PG 的 Serializable 用 SSI**

PG 的 Serializable 不是用锁实现的，而是用 SSI（Serializable Snapshot Isolation）——跟踪事务间的读写依赖，检测到冲突时回滚其中一个。性能比锁-based 的 Serializable 好很多。

**我们的选择**：默认 Read Committed + 乐观锁。

```sql
-- 乐观锁：条件 UPDATE
UPDATE tasks SET status = 'RUNNING', version = version + 1
WHERE id = $1 AND status = 'PENDING' AND version = $2;
-- affected rows = 0 → 并发冲突，放弃
```

**为什么不用 Serializable？**

1. 性能代价——SSI 有开销，我们的任务状态更新频率不高，RC + 乐观锁够用。
2. 序列化失败要重试——增加代码复杂度。
3. BullMQ 已经保证了大部分并发安全（BRPOPLPUSH 原子领取），数据库层面的并发冲突很少。

**什么场景用 Serializable？** 需要严格一致性的复杂事务——如"转账"（扣 A 加 B，不能出现不一致）。我们的任务系统没有这种需求，RC 够用。

---

**🎤 面试官追问**

> 你说 PG 的 RR 防幻读，但 PG 的 RR 也有一个经典问题——写倾斜（Write Skew）。你遇到过吗？

**🙋 候选人回答**

**写倾斜是快照隔离的经典问题。**

场景：两个事务同时读同一组数据，基于读结果做不同的写操作，写操作不冲突但逻辑上有问题。

```
任务系统示例：
规则：一个项目同时最多 3 个 RUNNING 任务

事务 A：查项目 RUNNING 任务数（2 个）→ 允许创建新任务 → INSERT
事务 B：查项目 RUNNING 任务数（2 个）→ 允许创建新任务 → INSERT

结果：4 个 RUNNING 任务，违反规则
```

两个事务的写不冲突（都 INSERT 不同行），快照隔离下不会报错。但逻辑上违反了"最多 3 个"的规则。

**RC 下也有这个问题**——因为两个事务读的都是"2 个 RUNNING"，都认为可以创建。

**解决方式：**

**① 用 Serializable**——SSI 会检测到读写依赖冲突，回滚一个事务。但性能代价。

**② 用约束**——如果规则能用 CHECK 约束表达，数据库会强制保证。但"最多 3 个 RUNNING"无法用 CHECK 表达（需要聚合查询）。

**③ 用悲观锁**：

```sql
-- 先锁住项目的所有任务行
SELECT * FROM tasks WHERE project_id = $1 FOR UPDATE;
-- 然后查 RUNNING 数量，决定是否允许创建
```

`FOR UPDATE` 锁住查询的行，其他事务的相同查询会阻塞。

**④ 应用层检查 + 唯一约束**：

```sql
-- 用一个计数器表，CHECK 约束保证 ≤3
CREATE TABLE project_running_count (
  project_id VARCHAR PRIMARY KEY,
  running_count INT CHECK (running_count <= 3)
);

-- 创建任务时原子更新计数器
UPDATE project_running_count SET running_count = running_count + 1
WHERE project_id = $1 AND running_count < 3;
-- affected rows = 0 → 已满，不允许创建
```

**我们的实际情况**：没有"最多 N 个 RUNNING"的硬限制——通过限流（令牌桶）控制并发而非数据库约束。所以没遇到写倾斜问题。但这是一个好的思考角度——知道快照隔离的局限。

### 🏗 架构分析

- **为什么这么设计：** 任务状态更新是典型的"读-判断-写"，但写冲突概率低（一个任务同一时刻基本只有一个 worker 在处理），所以用乐观锁（条件 UPDATE）而不是悲观锁——读不阻塞、写不持锁，吞吐高。
- **为什么不用其它方案：**
  - **悲观锁 `SELECT ... FOR UPDATE`**：强一致但持锁期间阻塞其他事务，高并发下吞吐差，还容易死锁；适合写冲突激烈的场景，不适合我们。
  - **Serializable（SSI）**：数据库层面保证可序列化，但 SSI 要跟踪读写依赖、冲突要回滚重试，写多时性能下降明显；任务系统不需要这么强的一致性，BullMQ 的 BRPOPLPUSH 已经在队列层保证了一个任务只被一个 worker 领走，DB 层冲突极少。
  - **RC vs RR**：选 RC 是因为 PG 的 RC 是语句级快照，简单且无序列化失败；RR 是事务级快照，在长事务里反而更容易触发写倾斜和序列化失败，没必要。
- **权衡：** RC+乐观锁的代价是写冲突时要由应用层处理（affected=0 → 重试或放弃），需要写好重试逻辑；好处是无锁、无序列化失败、吞吐高。写倾斜（Write Skew）是快照隔离的固有局限，我们靠限流（令牌桶）在应用层控制并发数规避，而不是上 Serializable。
- **未来演进：** 如果出现"必须严格一致的聚合约束"（如账户余额、配额扣减），优先用"计数器表 + CHECK 约束 + 条件 UPDATE"在 DB 层原子保证，而不是升隔离级别到 Serializable——更可控、性能更好。

### 🎯 面试官真正考察什么

不是背"四个隔离级别分别防什么"，而是看你是否理解 **PG 的 RC/RR/Serializable 实现与 SQL 标准的差异**（PG 的 RR 真正防幻读、Serializable 用 SSI 而非锁），以及能否结合业务讲清"为什么选 RC+乐观锁而不是更高级别"的工程权衡。

### ❌ 常见错误回答

- 把 PG 的隔离级别当 SQL 标准照背，不知道 PG 的 RR 已防幻读、Serializable 是 SSI。
- 一律答"用 Serializable 最安全"——回避了性能代价和序列化失败重试的复杂度。
- 混淆乐观锁和悲观锁的适用场景，或者答不出写倾斜是怎么产生的。
- 说"RC 防幻读"——RC 不防幻读，PG 防幻读的是 RR。

### ✅ 推荐回答

> PG 三个隔离级别：RC（默认，每条语句读最新提交，有不可重复读+幻读）、RR（事务级快照，防幻读——PG 的 RR 是真正的快照隔离比 MySQL 强）、Serializable（SSI 序列化快照隔离，跟踪读写依赖检测冲突回滚，性能比锁-based 好但仍有代价）。我们用 RC+乐观锁（条件 UPDATE WHERE version=$2，affected=0 则冲突放弃）——BullMQ 已保证大部分并发安全，DB 层冲突少。不用 Serializable 因为性能代价+序列化失败要重试。写倾斜是快照隔离经典问题：两事务同时读同一数据基于结果写不同行不冲突但逻辑违反规则（如最多 3 个 RUNNING 两事务都读到 2 都创建变 4）。解决：Serializable、悲观锁 FOR UPDATE、或计数器表+CHECK 约束。我们用限流控制并发没遇到。

### 📚 延伸知识

- **SSI (Serializable Snapshot Isolation)**：PG 9.1+ 引入。通过跟踪 SIREAD lock（读依赖）和 WRITE lock（写依赖）检测危险的序列化冲突。参考 PG 文档 "Serializable Isolation Level"。
- **Write Skew**：快照隔离下的经典异常。参考 Wikipedia "Write skew" 和 Martin Kleppmann 的 DDIA 第七章。

---

## Q3. MVCC 和 VACUUM

**🎤 面试官**

> 第六章 Q4 提过 PG 的 MVCC 需要 VACUUM。VACUUM 的原理是什么？不 VACUUM 会怎样？

**🙋 候选人回答**

**MVCC 的实现：旧版本留在表里。**

```
UPDATE tasks SET status = 'COMPLETED' WHERE id = '1';

PG 的做法：
  → 不修改原行，而是插入新行（status=COMPLETED）
  → 旧行（status=RUNNING）标记为"死元组"（dead tuple）
  → 旧行保留，因为可能有其他事务还在读它
```

**时间长了，表里堆积大量死元组**——表膨胀（bloat），查询要扫过死元组变慢，磁盘占用增加。

**VACUUM 的作用**：清理死元组，回收空间。

```sql
-- 手动 VACUUM（不锁表）
VACUUM tasks;

-- VACUUM FULL（锁表，重建表，回收磁盘空间给操作系统）
VACUUM FULL tasks;

-- ANALYZE（更新统计信息，优化器用）
ANALYZE tasks;

-- 组合
VACUUM ANALYZE tasks;
```

**VACUUM vs VACUUM FULL：**

| 操作 | 锁表 | 回收空间 | 速度 |
|------|------|----------|------|
| VACUUM | ❌ | ❌（空间留给新行用） | 快 |
| VACUUM FULL | ✅ | ✅（空间还给 OS） | 慢 |

**不 VACUUM 会怎样？**

1. 表膨胀——死元组堆积，查询变慢。
2. 事务 ID 回卷（XID Wraparound）——PG 的事务 ID 是 32 位整数，用完会回卷，导致数据可见性错误。VACUUM 会"冻结"老行防止回卷。**这是致命问题**——不 VACUUM 可能导致数据库不可用。

**我们的配置：**

```ini
# postgresql.conf
autovacuum = on                    # 自动 VACUUM（默认开）
autovacuum_vacuum_threshold = 50   # 死元组超过 50 触发
autovacuum_vacuum_scale_factor = 0.2  # 或死元组超过表的 20% 触发
autovacuum_analyze_scale_factor = 0.1

# 高频更新的表单独配置
ALTER TABLE tasks SET (autovacuum_vacuum_scale_factor = 0.05);  # 5% 就触发
```

**监控 VACUUM**：

```sql
-- 查看表的死元组比例
SELECT relname, n_dead_tup, n_live_tup, 
       n_dead_tup::float / (n_live_tup + 1) AS dead_ratio
FROM pg_stat_user_tables
ORDER BY dead_ratio DESC;
```

### 🏗 架构分析

- **为什么这么设计：** PG 的 MVCC 选了"多版本留在表里 + 无锁读"的方案——读不阻塞写、写不阻塞读，并发性能极好。代价就是旧版本（死元组）堆积，需要后台 VACUUM 回收。这是 PG 在读写并发和高吞吐场景下的核心架构取舍。
- **为什么不用其它方案：**
  - **MySQL InnoDB 的 undo log 回滚段方案**：旧版本存在独立的 undo segment，旧版本随时可清理、表不易膨胀。代价是读旧版本要"回查" undo 链，且 undo 也要 purge。两种方案各有取舍：PG 换来更简单的并发控制，MySQL 换来更小的表膨胀。
  - **原地更新（in-place update，如 MyISAM）**：写要加锁、读要加锁，并发差，现代 OLTP 几乎不用。
  - **手动 VACUUM vs autovacuum**：手动不可控、易遗漏；autovacuum 默认开启、按阈值自动触发，是生产标配。我们只对高频更新表（tasks）单独调小 scale_factor，让它更激进地回收。
- **权衡：** autovacuum 调得激进 → 表更紧凑但 VACUUM 本身消耗 IO/CPU；调得保守 → 表易膨胀但后台压力小。VACUUM FULL 回收磁盘给 OS 但锁表，生产一般用 pg_repack 在线重建替代。
- **未来演进：** 监控死元组比例建立告警；对持续膨胀的大表上 pg_repack 定期在线重建；关注 XID 回卷风险（`pg_stat_activity`、`age(datfrozenxid)`），防止触发"防回卷强制 VACUUM"导致业务卡顿。

### 🎯 面试官真正考察什么

不是问"MVCC 是什么"，而是考察你能否讲清 **PG 多版本"留在表里"的实现代价**（表膨胀、XID 回卷），以及是否把 VACUUM 当作一项**生产运维必修课**来对待——有没有真在监控死元组、配过 autovacuum。

### ❌ 常见错误回答

- 只答"MVCC 实现多版本并发控制"，讲不清旧版本去哪了、为什么需要 VACUUM。
- 把 VACUUM 和 VACUUM FULL 混为一谈，不知道一个不锁表不还空间、一个锁表还空间。
- 不知道 XID 回卷这个致命风险，以为不 VACUUM 只是"慢一点"。
- 说"PG 会自动清理不用管"——autovacuum 阈值不调，高频更新表照样膨胀。

### ✅ 推荐回答

> MVCC 实现是旧版本留表里——UPDATE 不改原行而是插新行，旧行标记死元组。VACUUM 清理死元组回收空间。VACUUM 不锁表但空间留给新行用不还 OS，VACUUM FULL 锁表重建表空间还 OS 但慢。不 VACUUM 两个后果：① 表膨胀死元组堆积查询变慢磁盘增加；② 事务 ID 回卷（XID 32 位用完回卷导致可见性错误数据库不可用，VACUUM 冻结老行防回卷）。配置 autovacuum=on（自动 VACUUM），阈值 50 死元组或 20% 表大小触发。高频更新表（tasks）单独配 5% 触发。监控 pg_stat_user_tables 的 n_dead_tup/n_live_tup 比例。

### 📚 延伸知识

- **XID Wraparound**：PG 事务 ID 是 32 位（~42 亿）。用完后回卷，老数据可能"消失"或"出现"。VACUUM FREEZE 把老行的 XID 设为 Frozen（永远可见）。这是 PG 运维必须了解的。
- **pg_repack**：第三方工具，在线重建表（不锁表），替代 VACUUM FULL。

---

## Q4. EXPLAIN 怎么看？

**🎤 面试官**

> 你说慢查询要优化。怎么用 EXPLAIN 分析查询？能不能演示一个真实案例？

**🙋 候选人回答**

**EXPLAIN 显示查询计划——PG 优化器打算怎么执行查询。**

```sql
-- 加 ANALYZE 实际执行（不只是计划）+ BUFFERS 看内存/磁盘
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM tasks 
WHERE project_id = 'drama' AND created_at > '2026-07-01'
ORDER BY created_at DESC LIMIT 50;
```

**输出解读：**

```
Limit  (cost=0.42..15.30 rows=50 width=200) (actual time=0.05..0.15 rows=50 loops=1)
  -> Index Scan using idx_tasks_project_created on tasks  (cost=0.42..15.30 rows=50 width=200) (actual time=0.04..0.14 rows=50 loops=1)
        Index Cond: ((project_id = 'drama') AND (created_at > '2026-07-01'))
        Buffers: shared hit=5
Planning Time: 0.08 ms
Execution Time: 0.15 ms
```

**关键指标：**

| 指标 | 含义 | 关注 |
|------|------|------|
| cost | 估算成本（启动..总） | 总成本高需优化 |
| rows | 估算行数 | 和实际差太多说明统计信息过期 |
| actual time | 实际耗时 | 高就是慢 |
| Buffers shared hit | 内存命中 | hit 低说明大量磁盘读 |
| Seq Scan | 全表扫描 | 大表 Seq Scan 通常是问题 |
| Index Scan | 索引扫描 | 好 |
| Bitmap Scan | 位图扫描 | 介于两者间 |

**真实案例：慢查询优化**

```sql
-- 慢查询：按项目查任务列表，3 秒
EXPLAIN ANALYZE
SELECT * FROM tasks WHERE project_id = 'drama' ORDER BY created_at DESC LIMIT 50;

-- 计划：
Seq Scan on tasks  (cost=0..50000 rows=100000 width=200) (actual time=0.5..3000 rows=50000)
  Filter: (project_id = 'drama')
-- 全表扫描！没有索引
```

**问题**：没有 project_id 的索引，全表扫描 10 万行。

**优化：加索引**

```sql
CREATE INDEX idx_tasks_project_created ON tasks(project_id, created_at DESC);

-- 优化后：0.15ms
Index Scan using idx_tasks_project_created on tasks  (cost=0.42..15.30 rows=50)
  Index Cond: (project_id = 'drama')
-- 索引扫描，只扫 50 行
```

**3000ms → 0.15ms，20000 倍提升。**

**另一个案例：统计信息过期**

```sql
-- 查询变慢了，但索引在
EXPLAIN ANALYZE SELECT * FROM tasks WHERE status = 'RUNNING';

-- 计划显示 rows=1000（估算），实际 rows=50000
-- 优化器以为只有 1000 行，选了全表扫描（少量行全表扫快）
-- 实际 50000 行，全表扫慢

-- 解决：更新统计信息
ANALYZE tasks;
-- 优化器知道有 50000 行，选索引扫描
```

**ANALYZE 更新统计信息**——优化器靠统计信息估算行数决定执行计划。大量数据变更后统计信息可能过期，手动 ANALYZE 更新。

### 🏗 架构分析

- **为什么这么设计：** EXPLAIN 是"用数据说话"——优化器基于统计信息估算成本选执行计划，看 EXPLAIN 就能判断是索引没用上、统计信息过期还是 plan 选错。这比靠经验猜"为什么慢"靠谱得多，是 PG 调优的第一手工具。
- **为什么不用其它方案：**
  - **只看慢查询日志（如 pg_stat_statements）**：能知道"哪条慢、慢多少"，但不知道"为什么慢、走没走索引"。必须配合 EXPLAIN ANALYZE 才能定位根因。
  - **凭经验加索引**：不看 plan 盲目加索引，可能加了也不被用（列顺序错、被优化器放弃），还白增写入成本。我们的案例就是先 EXPLAIN 看到 Seq Scan 才知道要加 `(project_id, created_at DESC)`。
  - **`EXPLAIN` vs `EXPLAIN ANALYZE`**：不加 ANALYZE 只看估算计划，可能和实际差很远；加 ANALYZE 真正执行（注意：INSERT/UPDATE/DELETE 会真的执行，生产环境慎用，必要时包在事务里 ROLLBACK）。
- **权衡：** ANALYZE 估算行数依赖统计信息，统计信息过期（大量数据变更后没自动 analyze）会导致 plan 选错——`rows=1000 实际 50000` 就是典型。所以"加索引后查询变慢"经常不是索引的问题，而是统计信息过期，手动 ANALYZE 即可。
- **未来演进：** 上 `pg_stat_statements` 持续采样慢查询，`auto_explain` 自动记录超阈值查询的计划，把"看 EXPLAIN"从被动排查变成持续监控；配合 Grafana 看查询耗时趋势。

### 🎯 面试官真正考察什么

不是问"EXPLAIN 怎么用"，而是看你会不会**用 EXPLAIN ANALYZE 做一次真实调优闭环**——能不能读 plan、能不能区分 Seq Scan/Index Scan/Bitmap Scan、能不能识别"统计信息过期导致选错 plan"这种非索引类问题。

### ❌ 常见错误回答

- 只说"用 EXPLAIN 看计划"，但讲不清 cost/rows/actual time/Buffers 各自含义。
- 看到慢查询就只会"加索引"，不知道可能是统计信息过期导致 plan 选错。
- 不加 ANALYZE，只看估算值，得出错误结论。
- 在生产环境对 UPDATE/DELETE 跑 EXPLAIN ANALYZE 真改数据。

### ✅ 推荐回答

> EXPLAIN (ANALYZE, BUFFERS) 显示查询计划和实际执行。关键指标：cost（估算成本）、rows（估算行数——和实际差多说明统计信息过期要 ANALYZE）、actual time（实际耗时）、Buffers shared hit（内存命中率低说明大量磁盘读）、Seq Scan（全表扫描大表通常是问题）vs Index Scan（好）。真实案例：按项目查任务 3 秒——EXPLAIN 显示 Seq Scan 全表扫 10 万行无索引，加复合索引后 0.15ms 提升 20000 倍。另一个：查询变慢但索引在——rows 估算 1000 实际 50000，统计信息过期优化器选错计划，ANALYZE 更新后选索引扫描。大量数据变更后手动 ANALYZE。

### 📚 延伸知识

- **pg_stat_statements**：PG 扩展，记录所有查询的执行统计（调用次数、总耗时、平均耗时）。找慢查询的利器。
- **Auto Explain**：自动记录慢查询的 EXPLAIN。`auto_explain.log_min_duration = '1s'` 自动记录超过 1 秒的查询计划。

---

## Q5-Q8. 快速深挖题

---

## Q5. JSONB 的索引怎么建？

**🎤 面试官**

> tasks 表的 payload 和 step_results 是 JSONB，你们怎么查又怎么建索引？直接建 B-Tree 行不行？

### 🏗 架构分析

- **为什么这么设计：** tasks 的 payload（任务参数）、step_results（每个步骤的结果/状态）是半结构化数据——字段不固定、经常加新 key，用 JSONB 比"为每种参数建列"灵活得多。但 JSONB 默认无索引，按内部字段查会全表扫，所以核心是"为高频查询路径建索引"。
- **为什么不用其它方案：**
  - **B-Tree on JSONB 整列**：B-Tree 要求可排序、且整个 JSONB 当一个值比较，无法支持下钻到某个 key 查询，几乎无用。
  - **GIN vs 表达式索引**：GIN（`USING GIN (payload)`）支持 `@>` 包含、`->>` 等值等多种查询，灵活但索引大（把所有 key 都索引进去）、写入慢；表达式索引（`((payload->>'type'))`）只索引某个抽出的字段，索引小、查询快，但只对该字段有效。
  - **GIN 的 jsonb_path_ops vs 默认 ops**：`jsonb_path_ops` 索引更小但只支持 `@>` 包含查询；默认 GIN ops 支持 `?`、`@>` 等更多操作符。按查询模式选。
- **权衡：** 高频字段用表达式索引（小且快），偶尔查的字段用 GIN（一次性覆盖灵活查询），是性能与灵活性的取舍。表达式索引的代价是查询 SQL 必须严格匹配索引表达式（写法稍有不同就不走索引）。
- **未来演进：** JSONB 查询模式稳定后，可考虑把高频字段从 JSONB 提升为独立列（用 B-Tree），既快又能加约束；对复杂嵌套查询评估 PG 12+ 的 SQL/JSON path（`jsonb_path_query`）+ GIN jsonb_path_ops。

### 🎯 面试官真正考察什么

不是问"JSONB 是什么"，而是看你是否知道 **JSONB 默认不索引、要靠 GIN 或表达式索引**，以及能否针对"高频字段 vs 偶尔查询"做出不同的索引选型，而不是无脑 `USING GIN`。

### ❌ 常见错误回答

- 给整个 JSONB 列建 B-Tree，然后抱怨"为什么查询没走索引"。
- 一律用 GIN，导致索引巨大、写入变慢。
- 写了表达式索引但查询 SQL 的表达式写法和索引不一致（如多了空格、用了 `->` 而非 `->>`），结果没命中索引。
- 不知道 `@>`（包含）和 `->>`（取值）是两种不同的查询路径，索引选型也不同。

### ✅ 推荐回答

> 两种索引：① GIN 索引——`CREATE INDEX idx ON tasks USING GIN (payload)`，支持 `payload->>'key' = 'value'` 和 `payload @> '{"key":"value"}'` 查询。GIN 索引大但查询灵活。② 表达式索引——`CREATE INDEX idx ON tasks ((payload->>'type'))`，只索引 JSONB 的某个字段，索引小但只支持该字段查询。我们的选择：高频查询的 JSONB 字段用表达式索引（小且快），偶尔查询的用 GIN（灵活）。step_results 的步骤状态查询用表达式索引 `((step_results->'script_split'->>'status'))`。

### 📚 延伸知识

- **GIN 索引原理**：Generalized Inverted Index，倒排索引——把每个 key/value 映射到包含它的行。适合多对多查询（全文检索、JSONB、数组）。
- **jsonb_path_ops**：GIN 的更紧凑 opclass，索引更小更快，但只支持 `@>` 操作符。
- **SQL/JSON Path（PG 12+）**：`jsonb_path_query` / `@?` 用 JSONPath 表达式查 JSONB，配合 GIN 索引。

---

## Q6. 连接池怎么配置？

**🎤 面试官**

> 上线后 PG 连接数飙升，内存爆了。连接池怎么配？为什么 PG 这么吃连接？

### 🏗 架构分析

- **为什么这么设计：** PG 的进程模型决定了每个连接是一个独立的 OS 进程（fork），比 MySQL 的线程重得多——每个连接光 work_mem、私有内存就占不少，几百上千连接很快把内存吃光。所以在 PG 前面必须加一层连接池，用少量"真实 PG 连接"复用大量"客户端连接"。
- **为什么不用其它方案：**
  - **PgBouncer（独立连接池服务）**：成熟的轻量级方案，支持 session/transaction/statement 三种 pooling 模式。transaction pooling 复用率最高（事务结束即归还连接），是生产主流。
  - **应用内置连接池（Prisma、node-postgres pg-pool）**：在每个 Node 进程内维护一个小池子，进程间不共享。简单但水平扩容时连接数 = 进程数 × 每进程连接数，仍可能失控。
  - **PG 14+ built-in connection pooler**：PG 自身在逐步内置连接池（预留 docker），但目前成熟度和功能仍不如 PgBouncer。
  - **调大 `max_connections` 硬扛**：治标不治本，连接越多内存越多、上下文切换越频繁，反而更慢。
- **权衡：** transaction pooling 的代价是 **session-level 状态会丢失**——临时表、`SET` 会话变量、`LISTEN/NOTIFY`、prepared statements 在事务间不复用，部分 ORM（依赖 session 状态的）需要适配或开 session pooling。我们 PgBouncer 用 transaction pooling + Prisma 每进程 connection_limit=10，总 PG 连接 = pool_size × 实例数，可控。
- **未来演进：** 监控 `pg_stat_activity` 连接数和等待事件；当实例数上涨时评估 PgBouncer 集群（多 PgBouncer 前置负载均衡）；关注 PG 内置 pooler 的成熟度以简化架构。

### 🎯 面试官真正考察什么

不是问"连接池是什么"，而是看你是否理解 **PG 进程模型的代价**，以及 transaction pooling 模式背后的取舍（复用率高但 session 状态丢失），能不能算清"总 PG 连接数 = pool_size × 实例数"。

### ❌ 常见错误回答

- 不知道 PG 连接是进程而非线程，把它当 MySQL 那样随意开连接。
- 一味调大 `max_connections`，不引入连接池。
- 选 session pooling 当 transaction pooling 用，复用率上不去。
- 用了 transaction pooling 但没注意临时表/prepared statement/SET 在事务间失效的坑。

### ✅ 推荐回答

> PG 连接是进程（每个连接 fork 一个进程），比 MySQL 的线程重。连接多时内存和 CPU 开销大。用连接池：PgBouncer（独立连接池服务）或 Prisma 内置连接池。PgBouncer 的 transaction pooling 模式——多个客户端复用少量真实连接（事务结束归还连接）。我们的配置：PgBouncer max_client_conn=200（客户端连接数）+ default_pool_size=20（实际 PG 连接数）。Prisma 连接池 connection_limit=10（每个 Node 进程）。总 PG 连接 = PgBouncer pool_size × 实例数。不配连接池的后果：1000 个并发请求 → 1000 个 PG 连接 → PG 内存爆。

### 📚 延伸知识

- **三种 pooling 模式**：session（连接绑定整个会话）、transaction（绑定一个事务）、statement（绑定一条语句）。复用率 statement > transaction > session，但功能约束反过来。
- **PgBouncer + PgBouncer 集群**：大规模下用多个 PgBouncer 分担，前面用 HAProxy/LB。
- **PG 进程模型**：`postgres` 主进程 fork 出每个 backend 进程，`max_connections` 控制上限，每个 backend 约占 5~10MB+work_mem。

---

## Q7. 大表分页怎么做？

**🎤 面试官**

> tasks 表越来越大，管理后台翻到第 1000 页直接超时。分页怎么优化？

### 🏗 架构分析

- **为什么这么设计：** OFFSET 的本质是"先扫过前 N 行再开始返回"，`LIMIT 50 OFFSET 100000` 要扫过 100050 行丢掉前 100000 行，OFFSET 越大越慢，且无法用索引跳过这 100000 行——这是 LIMIT/OFFSET 的固有缺陷。游标分页（keyset pagination）用 `WHERE created_at < $last_seen` 直接定位游标位置，永远只扫 50 行，深度翻页 O(1)。
- **为什么不用其它方案：**
  - **OFFSET 分页**：实现简单、支持"跳到第 N 页"，但深翻页是 O(N) 性能灾难，大表不可用。
  - **游标分页（keyset/cursor）**：性能稳定，但只能上一页/下一页，不支持"跳到第 N 页"，且游标列必须唯一有序（用 `(created_at, id)` 复合游标避免 created_at 相同时丢数据）。
  - **前端"加载更多"无限滚动**：本质就是游标分页，体验上回避了"跳页"需求，适合 App/Feed 场景。
- **权衡：** 我们采用混合策略——用户日常浏览（管理后台任务列表）用游标分页，绝大多数人只翻前几页，性能稳定；确实需要"跳到第 N 页"的报表场景用 OFFSET，但限制 `OFFSET <= 10000`，超过就引导用搜索/筛选条件缩小范围。这是性能与功能的折中。
- **未来演进：** 对必须深翻页的报表，考虑物化视图/预聚合；接入 Elasticsearch 做检索型分页（search_after 也是游标思想）；评估 PG declarative partitioning 减小单分页扫描量。

### 🎯 面试官真正考察什么

不是问"分页语句怎么写"，而是看你能否讲清 **OFFSET 深翻页为什么是 O(N)**、**游标分页为什么 O(1)**，以及面对"必须跳页"的需求时如何权衡而不是只给一种方案。

### ❌ 常见错误回答

- "加个索引 OFFSET 就快了"——OFFSET 本质要扫过前 N 行，索引救不了。
- 只会 OFFSET 分页，不知道游标分页。
- 游标分页游标列不唯一（只用 created_at），并列时间相同时丢数据或重复。
- 一刀切用游标分页，答不出"跳页"场景怎么办。

### ✅ 推荐回答

> OFFSET 分页在大表上慢——`LIMIT 50 OFFSET 100000` 要扫过 100050 行丢弃前 100000 行。用游标分页：`WHERE created_at < $last_seen ORDER BY created_at DESC LIMIT 50`，直接跳到游标位置不扫前面。但游标分页不支持"跳到第 N 页"——只能上一页/下一页。我们的管理后台用游标分页（用户一般只翻前几页），需要跳页的场景（如"第 100 页"）用 OFFSET 但限制最大 OFFSET（如 10000，超过提示用搜索过滤）。

### 📚 延伸知识

- **Keyset Pagination**：用排序键做游标，性能 O(1)。推荐 Markus Winand 的 "Pagination Done the PostgreSQL Way"。
- **复合游标**：`(created_at DESC, id DESC)` 保证全局唯一有序，避免并列值丢数据。
- **Search After（ES）**：Elasticsearch 的 search_after 也是游标思想，跨存储方案一致。

---

## Q8. PG 的备份和恢复怎么做？

**🎤 面试官**

> 任务数据、Prompt、Token 统计全在 PG，数据库挂了怎么办？备份恢复方案是怎么设计的？

### 🏗 架构分析

- **为什么这么设计：** PG 的数据有两类失败——逻辑错误（误删表、误更新）和物理损坏（磁盘坏、实例挂）。单一备份方案覆盖不全，所以我们做三层互补：逻辑备份（pg_dump）管"误删某表"、WAL 归档+基础备份管"PITR 恢复到任意秒"、物理备份管"整机恢复"。每层解决不同粒度的问题。
- **为什么不用其它方案：**
  - **只用 pg_dump**：逻辑备份恢复慢、无法 PITR、备份间隔内数据会丢；适合小库或做异构迁移，不能当唯一手段。
  - **只用 WAL 归档没基础备份**：WAL 是增量日志，必须有一个全量基础备份作起点才能重放，否则无法恢复。
  - **pg_basebackup 物理备份 vs pg_dump 逻辑备份**：物理备份是块级拷贝、恢复快、支持 PITR，但只能恢复到同架构 PG；逻辑备份是 SQL/自定义格式、跨版本、粒度到表，但慢。
  - **云托管 RDS 的自动备份**：底层也是基础备份+WAL 归档+PITR，自建 PG 要自己拼这套。
- **权衡：** WAL 归档间隔越短 RPO 越小，但归档频率高增加 IO 和存储成本；基础备份频率越高恢复越快（WAL 重放少），但全量备份本身耗资源。我们定 RPO=5min（WAL 归档间隔）、RTO=30min（基础备份恢复+WAL 重放）。逻辑备份保留 7 天便于快速单表恢复。
- **未来演进：** 增量/连续 WAL 归档到对象存储做长期保留；引入复制（流复制 standby）做高可用——主挂切从，比从备份恢复快得多（分钟级 RTO）；定期做恢复演练，避免"备份在但恢复不出来"。

### 🎯 面试官真正考察什么

不是问"用什么命令备份"，而是看你是否理解 **RPO/RTO 的概念**、能否区分 **逻辑备份/物理备份/WAL 归档** 各自的适用场景，以及有没有"恢复演练"这种工程意识——没演练过的备份等于没备份。

### ❌ 常见错误回答

- 只说"用 pg_dump 定时备份"，不知道 pg_dump 无法 PITR、恢复慢。
- 答不出 RPO/RTO 是什么，给不出具体数字。
- 有 WAL 归档但没有基础备份，以为有了 WAL 就能恢复。
- 只备份不演练——等真出事才发现备份格式不对、恢复脚本跑不通。

### ✅ 推荐回答

> 三层备份：① pg_dump 逻辑备份——每天 cron 跑 `pg_dump --format=custom`，保留 7 天。恢复粒度到表。② WAL 归档——`archive_mode=on`，WAL 日志归档到 S3，支持 PITR（Point-in-Time Recovery）恢复到任意时间点。③ 基础备份——`pg_basebackup` 定期全量物理备份到 S3，配合 WAL 归档做完整恢复。恢复演练：每月模拟一次恢复（在测试环境从备份恢复），验证备份可用。RPO（数据丢失容忍）= WAL 归档间隔（5 分钟），RTO（恢复时间目标）= 30 分钟（基础备份恢复+WAL 重放）。

### 📚 延伸知识

- **PITR (Point-in-Time Recovery)**：基础备份 + 重放 WAL 到指定时间点，恢复到"误操作前一秒"。
- **流复制 + Hot Standby**：主从实时复制，主挂切从做高可用，RTO 降到分钟级，比从备份恢复快。
- **Barman / pgBackRest**：第三方 PG 备份管理工具，支持增量备份、压缩、异地保留，比手写脚本更可靠。

---

## Q9. B-Tree 和 B+Tree 的区别？PG 的索引底层是什么？

**🎤 面试官**

> Q1 你说 PG 默认索引是 B-Tree，但 MySQL InnoDB 用的是 B+Tree。这俩到底啥区别？PG 用的到底是哪个？

**🙋 候选人回答**

**先纠正一个常见的误区：PG 文档里叫 "B-Tree"，但它实际用的是 B+Tree 的变体。** 严格来说，PG 的 nbtree 实现里，数据值只存在叶子节点、非叶子节点只存路由 key、叶子节点之间有双向链表——这就是 B+Tree 的结构特征。

**B-Tree vs B+Tree 的核心区别：**

```
B-Tree：每个节点都存 key + data（value）
         [50:data50]
        /     |      \
   [20:d20, 40:d40]  [70:d70, 80:d80]
   叶子之间不连接

B+Tree：只有叶子节点存 data，非叶子只存 key 路由；叶子双向链表
         [50]
        /     \
   [20,40] → [50,60] → [70,80]   （叶子之间 → 链接）
   叶子存完整数据，非叶子不存 data
```

| 维度 | B-Tree | B+Tree |
|------|--------|--------|
| 数据存放 | 每个节点都存 key+data | 只有叶子存 data，非叶子只存 key |
| 单节点可放 key 数 | 少（data 占空间） | 多（只有 key，扇出 fanout 更大） |
| 树高 | 相对高 | 相对矮（扇出大） |
| 磁盘 IO 次数 | 多（树高） | 少（树矮） |
| 范围查询 | 要中序遍历整棵树，慢 | 沿叶子链表顺序扫，快 |
| 等值查询 | 命中即返回（可能不用到叶子） | 必到叶子，但树矮总 IO 还是少 |

**对磁盘数据库来说，B+Tree 几乎完胜**：数据库的瓶颈是磁盘 IO，一次读一个 page（默认 8KB）。B+Tree 非叶子节点不放 data，一个 page 能塞更多 key → 扇出更大 → 树更矮 → 从根到叶子的 IO 次数更少。比如千万级数据，B-Tree 可能要 4 层，B+Tree 只要 3 层，每次查询少一次磁盘读。

**范围查询更是 B+Tree 的主场**：找 `created_at > '2026-07-01'` 这种，定位到起点后顺着叶子链表一路扫，完全不用回溯非叶子节点。Q1 里那个 `(status, created_at DESC)` 复合索引能高效支持 `ORDER BY created_at DESC LIMIT 50`，靠的就是叶子链表的顺序性。

---

**🎤 面试官追问**

> 既然 B+Tree 这么强，PG 还提供 GIN、GiST、BRIN 这些类型干嘛？啥时候该用哪个？

**🙋 候选人回答**

**B+Tree（PG 的 B-Tree）只擅长"有序、可比较"的数据：等值、范围、排序。** 遇到"包含""全文检索""空间范围""时序"这些场景，B+Tree 干不了或效率很差，得换专门索引。

| 索引类型 | 原理 | 适用场景 | 我们的项目例子 |
|----------|------|----------|----------------|
| B-Tree（默认） | 有序平衡树 | 等值/范围/排序，几乎所有标量列 | tasks 的 status/created_at 复合索引 |
| GIN | 倒排索引（key→行列表） | JSONB、数组、全文检索（一对多） | tasks.payload / step_results 的 JSONB 查询（Q5） |
| GiST | 广义搜索树框架 | 空间/几何、范围类型、最近邻 | 地理坐标、重叠区间（我们项目用得少） |
| BRIN | 块范围索引（每段记 min/max） | 物理顺序与列值高度相关的大表，时序日志 | token_usage 按 created_at 追加写入的归档分区 |
| Hash（PG 10+ WAL 后） | 哈希表 | 仅等值查询，不支持范围/排序 | 几乎不用，B-Tree 已够好 |

**选型决策树：**
1. 标量列、有排序需求 → **B-Tree**（默认 99% 场景）
2. JSONB / 数组 / 全文检索 → **GIN**（Q5 我们就是这么做的，支持 `@>` `->>` `?` 等操作符）
3. 物理写入顺序与某列一致的大时序表 → **BRIN**（索引体积极小，只有几 KB，但只能粗筛）
4. 空间/几何 → **GiST**（带 PostGIS 时用）
5. 只需等值且无排序 → Hash 几乎不用，B-Tree 已足够

**BRIN 的特殊价值**：我们的 token_usage 表每天涨几百万行，如果全量建 B-Tree 索引会非常大且慢。但 token_usage 是按 created_at 顺序追加写的，BRIN 只需记录"每段 page 的 created_at min/max"，体积比 B-Tree 小几个数量级，做时间范围粗筛足够。

---

**🎤 面试官继续追问**

> 你说 PG 的 B-Tree 是 B+Tree 变体，那它和 MySQL InnoDB 的 B+Tree 聚簇索引有什么本质区别？

**🙋 候选人回答**

**关键区别在"数据放哪"和"二级索引指什么"。**

| 维度 | PG | MySQL InnoDB |
|------|----|--------------|
| 数据存储 | 堆表（heap），数据和索引分离 | 聚簇索引（主键 B+Tree 的叶子就是整行） |
| 二级索引叶子存什么 | TID（行物理位置：page号+偏移） | 主键值（要回主键索引找行） |
| 普通查询路径 | 索引 → TID → 堆表取行（回表） | 二级索引 → 主键值 → 主键索引取行（两次 B+Tree 查找） |
| 主键是否必须 | 否（可用隐式 ctid） | 是（没有显式主键会用隐式 ROWID） |
| 二级索引大小 | 小（存 TID） | 大（存主键值，主键越长索引越大） |

**PG 用堆表 + 二级索引存 TID 的设计哲学**：所有索引（主键/二级）地位平等，都指向物理位置；不存在"聚簇/非聚簇"之分，所以加任意索引都一样轻量。代价是几乎所有索引查询都要"回表"拿完整行（除非用 INCLUDE 覆盖索引，见 Q1）。

**InnoDB 用聚簇索引的设计哲学**：主键索引叶子直接存整行，按主键查快且不用回表；但二级索引要"两次查找"（先查主键值再查主键索引），且主键越长所有二级索引都跟着变大。InnoDB 不建议用 UUID 做主键就是因为插入无序导致页分裂频繁、二级索引膨胀。

**我们的选择**：tasks 表用自增 bigint id 做主键（插入有序、紧凑），不依赖聚簇特性，因为我们大多数查询是按 status/project_id+created_at 走二级复合索引，PG 的堆表设计反而让所有索引平等轻量。需要"少回表"的场景用 INCLUDE 覆盖索引（Q1 的 token_usage 统计）。

### 🏗 架构分析

- **为什么这么设计：** 数据库的瓶颈是磁盘 IO，B+Tree 把非叶子节点瘦身（只存 key）→ 扇出更大 → 树更矮 → 查询 IO 次数更少，再加上叶子链表让范围查询 O(N) 顺序扫，完美契合 OLTP 的"等值+范围+排序"负载。PG 选 B+Tree 变体 + 堆表分离，是为了让所有索引地位平等、加索引轻量、不强制聚簇。
- **为什么不用其它方案：**
  - **B-Tree（严格版）**：每个节点存 data 导致扇出小、树更高、范围查询要中序遍历，磁盘场景全面不如 B+Tree。
  - **Hash 索引**：O(1) 等值很快，但不支持范围/排序/ORDER BY/前缀匹配，通用性太差，且 PG 10 之前不支持 WAL 副本不安全，所以默认 B-Tree。
  - **Red-Black 树/AVL 树（二叉）**：二叉树树高 log₂N，千万级数据要 20 多层，每层一次 IO 太多；B+Tree 是多路，几千万数据 3~4 层就够。
  - **LSM-Tree（如 RocksDB）**：写放大低、写友好，但读要合并多层 SSTable、空间放大高，OLTP 读多写少场景不如 B+Tree；适合写极重的时序/日志库。
  - **聚簇（InnoDB）vs 堆表（PG）**：InnoDB 主键查询快不回表，但二级索引要回主键、主键选型敏感；PG 堆表让索引平等轻量，代价是普遍要回表，靠 INCLUDE 覆盖索引弥补。
- **权衡：** B+Tree 写入时有页分裂（split）和树重平衡成本，所以索引越多写入越慢——这就是 Q1 说"不过度索引"的底层原因。GIN 索引查询强但写入要更新倒排表、索引大、写入慢，所以 GIN 只给真正需要的 JSONB/全文列用。
- **未来演进：** 大表索引维护成本上去后考虑部分索引（Partial Index）只索引热点行、BRIN 给冷数据归档分区、表达式索引给高频 JSONB 字段；监控 `pg_stat_user_indexes` 找从未使用的索引删掉省写入开销。

### 🎯 面试官真正考察什么

不是问"B-Tree 定义是什么"，而是看你能否讲清 **B-Tree 与 B+Tree 在"数据存放位置/扇出/树高/范围查询"上的本质差异**、**为什么磁盘数据库清一色选 B+Tree**（IO 次数），并区分 **PG 堆表 vs InnoDB 聚簇**这两种设计哲学对索引选型和主键设计的影响。顺带考察你对 GIN/GiST/BRIN 选型的判断。

### ❌ 常见错误回答

- "PG 用 B-Tree，MySQL 用 B+Tree，所以 PG 比较落后"——PG 的 B-Tree 实际就是 B+Tree 变体（叶子存数据、非叶子只路由、叶子链表）。
- 只背"B+Tree 叶子有链表"，但讲不清"为什么链表重要"（范围查询顺序扫、磁盘 IO 少）。
- 把 B-Tree 和二叉搜索树混淆，不知道"多路"的意义在于降低树高减少磁盘 IO。
- 对 GIN/GiST/BRIN 的适用场景一锅粥，一律答"加个索引"。
- 说"PG 用聚簇索引"——PG 用堆表，索引存 TID 指向物理位置，没有聚簇的概念。

### ✅ 推荐回答

> B-Tree 每个节点存 key+data，B+Tree 只有叶子存 data、非叶子只存 key 路由，叶子双向链表。区别带来的结果：B+Tree 非叶子扇出更大（一页塞更多 key）→ 树更矮 → 查询磁盘 IO 更少；范围查询沿叶子链表顺序扫不用回溯。数据库瓶颈是磁盘 IO 所以清一色选 B+Tree。PG 文档叫 B-Tree 但实际是 B+Tree 变体（叶子存数据、非叶子只路由、叶子链表）。其他类型：GIN 倒排索引给 JSONB/数组/全文检索（我们 tasks.payload 用），GiST 给空间/几何，BRIN 块范围索引给时序追加写大表（token_usage 归档分区可用，体积比 B-Tree 小几个数量级）。和 MySQL InnoDB 的区别：PG 是堆表+二级索引存 TID（所有索引平等轻量但普遍要回表，用 INCLUDE 覆盖弥补），InnoDB 是聚簇索引（主键叶子存整行、二级索引存主键值要回主键两次查找，主键选型敏感）。我们 tasks 用自增 bigint 主键，不依赖聚簇特性，按 status/project_id+created_at 走二级复合索引。

### 📚 延伸知识

- **PG nbtree 实现**：参考 PG 源码 `src/backend/access/nbtree/`，Lehman & Yao 的 B+Tree 并发算法变体（带 high key 的页面，支持无锁遍历）。
- **LSM-Tree vs B+Tree**：Bigtable / RocksDB / Cassandra 用 LSM（Log-Structured Merge-Tree），写友好读放大高；OLTP 数据库（PG/MySQL/Oracle）用 B+Tree，读友好。Google Spanner 论文有详细对比。
- ** INCLUDE 覆盖索引**（Q1）：PG 11+ 支持，让堆表设计也能"少回表"，缩小和聚簇索引的体验差距。

---

## Q10. WAL 机制是什么？为什么需要它？

**🎤 面试官**

> 第三章 Q7 提到 PG 用 WAL 保证持久化。WAL 到底是怎么工作的？为什么不直接写数据文件？

**🙋 候选人回答**

**WAL = Write-Ahead Logging，预写式日志。核心原则：所有对数据文件的修改，必须先把对应的日志记录写到 WAL 之后，才能改数据文件。**

**为什么不能直接改数据文件？** 假设 PG 直接改 tasks 表的数据 page：

```
UPDATE tasks SET status='COMPLETED' WHERE id=1;

→ 找到 id=1 所在的 page（page 42）
→ 修改 page 42 in memory（dirty page）
→ 挂了，没刷盘
→ 重启后 status 还是 RUNNING，丢更新
```

**随机写盘很慢**：数据 page 的修改是随机的（哪行在哪 page 不定），磁盘随机 IO 慢。如果每次 UPDATE 都要 fsync 数据 page，性能崩。

**WAL 的解法：把"随机写数据"变成"顺序写日志"。**

```
UPDATE tasks SET status='COMPLETED' WHERE id=1;

→ 生成 WAL 记录："把 page 42 offset 100 从 RUNNING 改成 COMPLETED"
→ 顺序追加写 WAL 文件（很快，磁盘顺序写）
→ fsync WAL（保证日志落盘）
→ 返回客户端"成功"
→ 数据 page 42 在内存里改了（dirty page），但不必立刻刷盘
→ 后台 checkpointer 慢慢把 dirty page 刷到数据文件
```

**崩溃恢复的原理（redo）：** 如果在 dirty page 刷盘前宕机，数据文件还是旧的（status=RUNNING），但 WAL 里有"改成 COMPLETED"的记录。重启时 PG 扫 WAL，把还没应用到数据文件的修改重放（redo）一遍，数据就回来了。

**WAL 的两大收益：**

1. **崩溃恢复（Crash Recovery）**：WAL 落盘了就算"提交成功"，dirty page 哪怕没刷盘也能从 WAL 重放。这正是第三章 Q7 说"任务状态落 PG = WAL 落盘 = 持久化"的底层。
2. **性能**：把随机写数据变成顺序写 WAL，fsync 一次 WAL 就算提交成功，不用等慢的随机写。事务提交延迟从"等随机 IO"降到"等顺序 IO"。

**还有两个衍生能力：**
- **PITR（Point-in-Time Recovery）**：保留所有 WAL，加一个基础备份，可以重放到任意时间点——Q8 的备份恢复就靠它。
- **复制（Replication）**：standby 流式接收主库的 WAL 并重放，做到主从一致——Q12 详聊。

**WAL 的物理形态：** WAL 是一组固定大小的 segment 文件（默认 16MB 一个），文件名是它在 WAL 流中的 LSN（Log Sequence Number）位置。`pg_wal/` 目录下能看到 `000000010000000000000001` 这样的文件。

```
$ ls pg_wal/
000000010000000000000001  # 16MB
000000010000000000000002
000000010000000000000003
...
```

**checkpoint 机制：** checkpoint 是"确保到某个 LSN 之前的所有 dirty page 都已刷盘"的动作。checkpoint 之后，LSN 之前的 WAL 在崩溃恢复时不再需要（数据已经在磁盘上了），可以回收或归档。checkpoint 太频繁 → IO 压力大；太少 → 崩溃恢复要重放很多 WAL，恢复慢。

```ini
# postgresql.conf
checkpoint_timeout = 5min         # 至少每 5 分钟一次
max_wal_size = 1GB                # checkpoint 之间最多攒 1GB WAL
min_wal_size = 80MB
checkpoint_completion_target = 0.9 # 在下次 checkpoint 前 90% 时间刷完，平滑 IO
```

---

**🎤 面试官追问**

> 你提到任务状态落 PG = WAL 落盘 = 持久化。那 BullMQ 把任务状态从 RUNNING 改成 COMPLETED，到底是 Redis 还是 PG 保证的持久化？

**🙋 候选人回答**

**两层都保证，但语义不同。** 这正是第三章 Q7 的核心：

- **BullMQ 层（Redis）保证"任务不会丢、不会重复执行"**：BullMQ 用 Redis 的 RDB/AOF 持久化任务状态和"已处理任务 ID"。worker 把任务标记 COMPLETED 时，BullMQ 写 Redis 的 hash + 移除 active list。Redis 配 AOF + `appendfsync always` 才是真持久化（每条命令 fsync），但性能差；通常用 `everysec`，最坏丢 1 秒。
- **PG 层（WAL）保证"业务数据持久化"**：worker 真正改 tasks 表 `status='COMPLETED'` 时，PG 写 WAL 并 fsync（`synchronous_commit=on` 默认），WAL 落盘后返回成功。崩溃后从 WAL 重放，状态不丢。

**两层的协同：**
```
worker 处理完任务：
  1. 业务逻辑完成（如调 LLM 出脚本）
  2. UPDATE tasks SET status='COMPLETED', result=... → PG 写 WAL fsync
  3. BullMQ 任务标记 COMPLETED → Redis 写
  4. 返回客户端

崩溃在 2 之后 3 之前：
  → PG 重启，status='COMPLETED'（WAL 已落盘）✓
  → BullMQ 重启，任务可能还是 active 状态
  → worker 重启后会重新尝试处理这个任务
  → 但应用层检查 tasks.status 已 COMPLETED，直接跳过不重复执行
```

**所以 tasks.status 落 PG（WAL）是真正的"事实源"，BullMQ/Redis 是"调度状态"。** 即使 Redis 数据全丢，凭 PG 的 tasks 表也能重建任务状态（哪些做完了、哪些没做）。这就是为什么任务结果必须落 PG，不能只放 Redis。

---

**🎤 面试官继续追问**

> 那 WAL 是顺序写，磁盘顺序写确实快，但每次事务都要 fsync WAL 也不便宜吧？怎么权衡？

**🙋 候选人回答**

**对，fsync 是 PG 写入延迟的最大头。** 一次 fsync 在 SSD 上大约 0.1~1ms（HDD 更慢），如果每个事务都 fsync 一次 WAL，TPS 上限就被 fsync 拖住。PG 提供 `synchronous_commit` 参数让你权衡：

| synchronous_commit | 行为 | 持久性 | 延迟 | 适用 |
|--------------------|------|--------|------|------|
| on（默认） | 每事务 fsync WAL | 强（崩溃不丢已提交） | 高 | 钱、状态、关键业务 |
| off | 不 fsync，依赖 OS page cache | 弱（OS 崩溃可能丢 1~3 倍 wal_writer 周期） | 低 | 日志、可重算数据 |
| remote_write | 同步复制到 standby + standby 写 OS cache（未 fsync） | 中 | 中 | HA 场景 |
| remote_flush | 同步复制 + standby fsync | 强（双盘都落） | 最高 | 最高一致性 |
| local | 本地 fsync，不等复制 | 中 | 中 | 异步复制场景 |

**我们项目里的精细配置：** 不是所有事务都需要强持久化。tasks 表的状态变更用默认 `synchronous_commit=on`（任务状态不能丢）；但某些"可重算的统计写入"（如非关键的日志、缓存）可以会话级别 `SET LOCAL synchronous_commit=off` 换吞吐。

**还有更激进的优化：组提交（group commit）。** 多个并发事务的 WAL fsync 会被 PG 合并成一次——事务 A 提交时 fsync，这期间 B、C、D 也在等提交，它们的 WAL 一起被这次 fsync 落盘。所以"高并发反而单次 fsync 摊薄"，这是为什么 PG 在并发上来的 TPS 比"单事务延迟倒数"算出来的高。调大 `commit_delay` / `commit_siblings` 能强化组提交效果。

**另一个常见优化：把 WAL 放到单独的磁盘/SSD。** WAL 是顺序写、对延迟敏感，单独放高性能盘避免和数据文件的随机 IO 抢资源。

### 🏗 架构分析

- **为什么这么设计：** WAL 把"对随机数据页的随机写"重新组织成"对日志的顺序写 + 延迟刷盘"，让事务提交只需等一次顺序 fsync 而不是多次随机 IO；同时日志天然是"操作流"，崩溃后重放即可恢复，这是数据库"持久性（D of ACID）+ 性能"兼顾的经典解法。
- **为什么不用其它方案：**
  - **直接 fsync 数据文件（shadow paging / 原地写）**：每次 UPDATE fsync 对应 page，随机 IO 慢，且一个事务可能改多个 page 要多次 fsync，延迟爆炸。
  - **只靠内存 + 周期 RDB（如纯 Redis AOF off）**：性能极高但崩溃丢数据，钱、任务状态不能这么玩。
  - **Tlog（如 SQL Server）vs WAL**：本质类似都是预写日志，概念互通。
- **权衡：** `synchronous_commit=on` 保证最强持久性但延迟受 fsync 限制；`off` 提升吞吐但牺牲一点持久性。我们按数据重要性分级配置——关键状态 on、可重算数据 off。组提交能摊薄 fsync 成本，但要求一定并发量才有效。
- **未来演进：** 监控 WAL 生成速率（`pg_stat_wal`）、checkpoint 频率（`pg_stat_bgwriter`），避免 checkpoint 抖动；WAL 归档到对象存储做长期 PITR；同步复制 + remote_flush 让"主库挂也不丢已提交事务"。

### 🎯 面试官真正考察什么

不是问"WAL 是 Write-Ahead Logging 的缩写"，而是看你能否讲清 **WAL 把"随机写数据"变成"顺序写日志+延迟刷盘"的设计动机（性能+崩溃恢复 redo）**、**checkpoint 与崩溃恢复时长的关系**，以及**结合任务状态持久化讲清 PG（事实源）vs Redis（调度状态）的分工**。顺带看你对 `synchronous_commit` 这种持久性/延迟权衡是否有真实工程判断。

### ❌ 常见错误回答

- "WAL 就是日志，写日志就不丢数据"——讲不清"先写日志后改数据"的顺序约束，也讲不清崩溃后是怎么 redo 恢复的。
- 不知道 WAL 是顺序写、数据文件是随机写，答不出"为什么要多此一举写日志"。
- 把 WAL 当 audit log（业务审计日志）——WAL 是物理/逻辑变更日志，不是给人看的操作记录。
- 一律 `synchronous_commit=off` 追求性能，不知道这会让 OS 崩溃时丢数据，且对任务状态这种关键数据不可接受。
- 分不清 WAL（本地崩溃恢复）和复制（standby 同步）的关系——复制是"流式把 WAL 发给 standby"。

### ✅ 推荐回答

> WAL = Write-Ahead Logging 预写式日志：所有对数据文件的修改必须先把日志写到 WAL 落盘后才能改数据文件。动机：① 崩溃恢复——dirty page 没刷盘时宕机，重启从 WAL redo 重放恢复数据；② 性能——把随机写数据变成顺序写 WAL + 延迟刷盘，事务提交只需一次顺序 fsync。WAL 是固定 16MB 的 segment 文件存 pg_wal/。checkpoint 确保某 LSN 前 dirty page 全刷盘，之后的 WAL 不再需要用于崩溃恢复。和任务状态的关系：tasks.status 落 PG 写 WAL fsync（synchronous_commit=on 默认）是真正的持久化事实源，BullMQ/Redis 是调度状态——Redis 全丢也能凭 PG 重建任务状态。synchronous_commit 权衡：on（强持久延迟高）off（快但 OS 崩溃可能丢）、remote_flush（同步复制双盘都落）。组提交让高并发摊薄 fsync 成本。

### 📚 延伸知识

- **ARIES 算法**：WAL + redo/undo 的经典理论（IBM 的 ARIES 论文），现代关系数据库恢复的基石。PG 主要做 redo（因为 MVCC 旧版本还在表里），undo 隐含在多版本中。
- **全页写（full_page_writes）**：PG 防止 page 部分写（torn page）的机制——checkpoint 后对每个 page 的第一次修改，整页写入 WAL。开它增加 WAL 量但防磁盘页断裂。
- **pg_waldump**：工具，可读 WAL 内容用于调试恢复。

---

## Q11. PG 的锁机制（行锁、表锁、死锁）

**🎤 面试官**

> Q2 讲了隔离级别用乐观锁。但如果两个 worker 同时改同一个任务、或者后台批量操作和正常业务撞上，PG 的锁是怎么工作的？死锁怎么处理？

**🙋 候选人回答**

**PG 的锁分两层：表级锁和行级锁，用不同的锁模式控制并发。**

**行级锁（最常用）：** 通过 `SELECT ... FOR ...` 加，或在 UPDATE/DELETE 时自动加。

| 锁模式 | 语法 | 语义 | 冲突 |
|--------|------|------|------|
| FOR UPDATE | `SELECT ... FOR UPDATE` | 独占，其他事务不能改/删/加 FOR UPDATE | 与 FOR UPDATE / FOR NO KEY UPDATE 冲突 |
| FOR NO KEY UPDATE | UPDATE 自动加 | 类似 FOR UPDATE 但允许其他事务的 FOR KEY SHARE（不冲突外键锁） | |
| FOR SHARE | `SELECT ... FOR SHARE` | 共享读锁，允许其他 FOR SHARE 但禁止 UPDATE | 与 FOR UPDATE/FOR NO KEY UPDATE 冲突 |
| FOR KEY SHARE | 最弱行锁 | 允许其他事务 UPDATE 非主键列，只锁主键（外键检查用） | |

**Q2 的悲观锁例子就是 FOR UPDATE：**

```sql
-- 先锁住项目的所有任务行，防止其他事务同时改
BEGIN;
SELECT * FROM tasks WHERE project_id = $1 FOR UPDATE;
-- 此时其他事务对相同行 SELECT ... FOR UPDATE 会阻塞
-- 查 RUNNING 数量，决定是否创建新任务
INSERT INTO tasks ...;
COMMIT;
```

**表级锁：** 8 种模式，从弱到强冲突递增。常见：

| 锁模式 | 谁加的 | 典型场景 |
|--------|--------|----------|
| ACCESS SHARE | `SELECT` 自动加 | 读表 |
| ROW SHARE | `SELECT ... FOR UPDATE/SHARE` | 行锁时父表加这个 |
| ROW EXCLUSIVE | `INSERT/UPDATE/DELETE` 自动加 | 写数据 |
| SHARE | `LOCK TABLE ... IN SHARE MODE` | 显式共享锁 |
| EXCLUSIVE | `LOCK TABLE ... IN EXCLUSIVE MODE` | 显式独占 |
| ACCESS EXCLUSIVE | `ALTER/DROP/TRUNCATE/LOCK` | DDL，最严，和所有锁冲突 |

**冲突兼容矩阵：** 太长不全列，关键规律是"ACCESS EXCLUSIVE 和所有人冲突（独占表）"、"ROW EXCLUSIVE 之间兼容（多事务都能写）"、"SHARE 和 ROW EXCLUSIVE 冲突（共享锁禁止别人写）"。完整矩阵看 PG 文档。

---

**🎤 面试官追问**

> 死锁呢？两个 worker 互相等对方的行锁会怎样？

**🙋 候选人回答**

**PG 自动检测死锁并杀掉其中一个事务。**

死锁场景：

```
Worker A：BEGIN; UPDATE tasks SET ... WHERE id=1;  -- 持有 id=1 行锁
Worker B：BEGIN; UPDATE tasks SET ... WHERE id=2;  -- 持有 id=2 行锁
Worker A：UPDATE tasks SET ... WHERE id=2;          -- 等 id=2 锁（B 持有）→ 阻塞
Worker B：UPDATE tasks SET ... WHERE id=1;          -- 等 id=1 锁（A 持有）→ 死锁
```

**PG 的死锁检测机制：** 后台进程 `deadlock_timeout`（默认 1 秒）触发一次检测，遍历"等待锁的图"找环——发现 A 等 B、B 等 A 形成环，就选一个事务（通常是后发起的那个）abort，报错 `ERROR: deadlock detected`。被杀的事务收到错误，应用层捕获后重试或放弃。

```sql
-- Worker B 收到：
ERROR:  deadlock detected
DETAIL:  Process ... waits for ShareLock on transaction ... blocked by process ...
```

**应用层必须处理死锁：** 死锁是 PG 的正常行为（不是 bug），应用要捕获 `40P01`（deadlock_detected）错误码并重试。我们用 Prisma + 业务封装的重试中间件：

```ts
async function withDeadlockRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e.code === '40P01' && attempt < 2) {
        await sleep(backoff(attempt));  // 指数退避
        continue;
      }
      throw e;
    }
  }
}
```

**但重试是兜底，预防比治疗更重要。** 预防死锁的核心手段：

1. **固定加锁顺序**：所有事务按相同顺序加锁（如始终按 id 升序），就不会成环。
2. **缩短事务**：事务越短持锁越短，撞锁概率越低。
3. **尽量用乐观锁**（Q2）：读不持锁、条件 UPDATE 原子提交，根本不进入"等对方锁"的状态。

---

**🎤 面试官继续追问**

> 除了行锁表锁，我还听说过 advisory lock（咨询锁），这是什么？我们项目里能用来干嘛？

**🙋 候选人回答**

**Advisory lock（咨询锁）是应用自定义的"逻辑锁"，不锁任何具体数据行，只是 PG 帮你维护一个全局/会话级的锁标记。**

```sql
-- 会话级咨询锁（session-level），断开自动释放
SELECT pg_advisory_lock(12345);     -- 加锁，key=12345
-- 干活（如跑一次性 cron 任务）
SELECT pg_advisory_unlock(12345);   -- 释放

-- 事务级咨询锁（transaction-level），事务结束自动释放
BEGIN;
SELECT pg_advisory_xact_lock(12345);
-- 干活
COMMIT;  -- 自动释放，不会忘记 unlock
```

**和行锁的区别：** 行锁锁的是"某行数据"，advisory lock 锁的是"任意 64 位 key"，不绑数据。它纯粹是"借用 PG 的锁管理器做一个分布式协调"。

**我们项目里的两个典型用法：**

1. **cron 任务去重（防止多实例重复跑）：**
```sql
-- 多个 Node 实例都跑了 cron，但只有一个能拿到锁
SELECT pg_try_advisory_lock(hashtext('cron_daily_report'));
-- 返回 true → 我是 leader，执行；返回 false → 别人在跑，跳过
```
这比在 Redis 里 SET NX 或者在 PG 里建一张 lock 表更轻量。

2. **限流/配额：** 对"每用户每天最多 100 次调用"这种粗粒度限流，可以用 advisory lock + 计数器表原子化，比行锁 FOR UPDATE 简单。

**注意事项：**
- advisory lock 不会自动防止"忘了 unlock"——session 级的如果进程异常退出但连接没断（连接池复用），锁可能不释放。所以关键场景用 `pg_advisory_xact_lock`（事务级，COMMIT 自动释放）。
- advisory lock 是单库内的，跨库/跨实例分布式锁要用 Redis SET NX 或 Zookeeper。

### 🏗 架构分析

- **为什么这么设计：** PG 的锁体系分两层（表锁控 DDL/批量操作粒度、行锁控并发写）、行锁只在修改/显式 FOR 时加、读默认不加锁（靠 MVCC 多版本）——这是为了"读不阻塞写、写不阻塞读"的高并发模型。死锁靠后台检测器自动处理而不是预防，因为预防成本太高（要全局排序所有锁请求）。
- **为什么不用其它方案：**
  - **全表锁（MyISAM 风格）**：写锁整张表，并发几乎为零，OLTP 不可用。
  - **行锁 vs 乐观锁**：行锁（FOR UPDATE）强一致但持锁阻塞、易死锁；乐观锁读不持锁吞吐高但要处理冲突重试。Q2 已讲我们的取舍——任务系统冲突少用乐观锁，需要严格聚合一致才用悲观锁。
  - **依赖应用层互斥（Redis 锁）**：跨库分布式锁要用 Redis，但单库内的协调 advisory lock 比 Redis 更轻（无网络往返、和事务原子性绑定）。
  - **手动死锁预防 vs PG 自动检测**：手动给所有锁请求全局排序极难实现（涉及 SQL 语句、触发器、外键级联）；PG 选"运行时检测+杀一个"更实际。
- **权衡：** 行锁（FOR UPDATE）保证强一致但持锁期间阻塞并发、增加死锁概率；乐观锁吞吐高但要写重试逻辑。advisory lock 灵活但易忘释放（用 xact 版本绑定事务）。PG 的死锁检测有 `deadlock_timeout`（默认 1s）延迟，期间事务都在阻塞——所以高并发场景要缩短事务、用乐观锁避免长持锁。
- **未来演进：** 监控 `pg_stat_activity` 的等待事件（`wait_event_type='Lock'`）找锁等待热点；用 `pg_locks` 视图看持锁情况；对热点行考虑"分片"（如把单个计数器拆成 N 个随机选一个）减少争用。

### 🎯 面试官真正考察什么

不是问"PG 有哪几种锁模式照背一遍"，而是看你是否理解 **行锁只在 UPDATE/FOR 时加、读靠 MVCC 不持锁**这一并发模型，能否讲清 **死锁是 PG 自动检测+杀一个事务的正常行为、应用必须处理重试**，以及是否会用 **advisory lock 做单库内的逻辑协调**（如 cron 去重）。最忌只会背锁模式表但讲不清死锁形成条件和预防。

### ❌ 常见错误回答

- 把所有锁模式照背一遍，但讲不清"什么时候加什么锁""读会不会阻塞写"。
- 说"PG 不会死锁"——会，且必须应用层处理重试。
- 死锁后不做重试，让用户直接看到 500 错误。
- 用 SELECT FOR UPDATE 锁一堆行后做长时间计算，持锁太久拖垮并发。
- advisory lock 用了 session 级但忘 unlock，连接池复用导致锁泄漏。

### ✅ 推荐回答

> PG 锁分两层：表锁（ACCESS SHARE→ACCESS EXCLUSIVE 8 种模式，控制 DDL/批量操作粒度）和行锁（FOR UPDATE 独占、FOR SHARE 共享读、UPDATE/DELETE 自动加 FOR NO KEY UPDATE）。读默认不加锁靠 MVCC 多版本实现读不阻塞写。死锁：两事务互相等对方行锁时，PG 后台 deadlock_timeout（1s）触发检测，遍历等待图找环，杀掉一个事务报 40P01 错误，应用层捕获重试（指数退避）。预防死锁：固定加锁顺序、缩短事务、尽量用乐观锁。advisory lock 是应用自定义逻辑锁不绑数据行，用于 cron 去重（pg_try_advisory_lock 选 leader）、限流等单库协调；关键场景用 pg_advisory_xact_lock 事务级避免忘 unlock。跨库分布式锁才用 Redis。

### 📚 延伸知识

- **行锁的实现：** PG 行锁不写在行上，而是写在行的 xmax 字段 + 一个多事务（Multixact）结构，所以行锁几乎不占额外空间，但多事务 ID 也有回卷风险（类似 XID）。
- **锁等待监控：** `pg_stat_activity.wait_event` 看谁在等什么；`pg_blocking_pids(pid)` 查谁阻塞了某进程；`pg_locks` 看全库锁状态。
- **SKIP LOCKED：** `SELECT ... FOR UPDATE SKIP LOCKED` 跳过已被锁的行，常用于"任务队列"（拿一个能立即处理的任务）， BullMQ 早期在 PG 后端就有用类似思想。

---

## Q12. PG 的复制方案（流复制、逻辑复制）

**🎤 面试官**

> 第八章 Q8 提到流复制 standby。PG 的流复制和逻辑复制有啥区别？你们的任务查询为什么要走从库？

**🙋 候选人回答**

**PG 有两套复制机制：物理（流复制）和逻辑（逻辑复制）。**

| 维度 | 流复制（Streaming/Physical） | 逻辑复制（Logical） |
|------|------------------------------|---------------------|
| 复制什么 | WAL 字节流（块级） | 逻辑变更（行级 INSERT/UPDATE/DELETE） |
| standby 是什么 | 主库的字节级副本 | 独立库，订阅 publication 的变更 |
| 复制粒度 | 整库（不能选表） | 表级/行级可选（pub/sub 模型） |
| 版本要求 | 主从同大版本 | 可跨版本（PG 12→14 也行） |
| 异构 | 必须相同架构、相同 PG | 可以不同 schema、不同平台 |
| 用途 | HA、读副本、灾备 | 数据同步、部分表复制、升级迁移 |
| 复制 DDL | 是（WAL 包含 DDL） | 否（只 DML，schema 要自己同步） |

**流复制（物理）：**

```
Primary ──(WAL bytes)──> Standby1
                      ──> Standby2 (级联)

- Standby 重放 WAL，是 primary 的"克隆"
- standby 只读（hot standby），可以承担读请求
- 同步模式：async（默认，主不等从）/ sync（主等至少一个从确认）
```

配置：主库开 `wal_level=replica`，建 replication slot 或用 `primary_conninfo`；从库 `standby_mode=on`。

**逻辑复制（PG 10+）：**

```sql
-- 主库：发布
CREATE PUBLICATION pub_tasks FOR TABLE tasks, token_usage;

-- 从库：订阅
CREATE SUBSCRIPTION sub_tasks
  CONNECTION 'host=primary ...'
  PUBLICATION pub_tasks;
```

逻辑复制把 WAL 解码成逻辑变更（"tasks 表 id=1 的 status 改成 COMPLETED"），通过 pub/sub 推给订阅者。订阅者可以有自己的额外列、不同索引，甚至不是 PG（用 pglogical 或第三方解码到 Kafka）。

---

**🎤 面试官追问**

> 同步复制和异步复制怎么选？同步是不是更安全一定该用？

**🙋 候选人回答**

**不一定。同步复制有性能代价，要看一致性 vs 吞吐的权衡。**

| 模式 | 主库提交时 | 持久性 | 延迟 | 写吞吐 |
|------|------------|--------|------|--------|
| 异步（async，默认） | 不等从库 | 主库挂可能丢未同步的 WAL | 低 | 高 |
| 同步（`synchronous_commit=on` + `synchronous_standby_names`） | 等至少一个从库收到 WAL | 主库挂不丢已提交事务 | 高（等网络往返） | 低 |
| remote_write | 等从库写 OS cache | 主+从 OS 同时挂才丢 | 中 | 中 |
| remote_flush | 等从库 fsync | 双盘都落 | 最高 | 最低 |

**为什么"同步一定更好"是错的？**

- **延迟翻倍**：每次提交都要等 WAL 网络往返从库，跨机房延迟直接加到事务延迟上。
- **可用性反降**：如果从库挂了，主库的写入会**阻塞**（等不到同步确认）——同步复制用不好反而降低了可用性。
- **吞吐受从库拖累**：从库慢，主库跟着慢。

**我们项目的选择：**
- **HA + 读副本用异步复制**：主库挂有少量数据丢失风险（WAL 还没传到从库的部分），但写吞吐不受影响。配合应用层重试和"任务幂等"（任务可以安全重跑），丢一点未同步状态可以接受重算。
- **关键业务（如果有的话）才上同步**：如对账、计费——这种才值得用同步复制换"主库挂不丢已提交事务"。

**`synchronous_standby_names` 可以精确控制**：`ANY 1 (standby1, standby2)` 表示任意 1 个从确认即可（适合多从库），`FIRST 1 (standby1)` 表示优先 standby1。

---

**🎤 面试官继续追问**

> 那任务查询为什么走从库？有没有什么坑？

**🙋 候选人回答**

**核心动机：读写分离，把读流量从主库卸到从库，保护主库的写入性能。**

我们的负载特征：
- **写主库**：worker 改任务状态、API 创建任务、token_usage 写入——这些走主库。
- **读从库**：管理后台查任务列表、监控看板、token 统计报表、用户查自己的任务结果——这些走从库。

```
API Server ──写──> Primary
         ──读──> Standby (读副本)

读副本可以多个，横向扩展读能力。
```

**坑：复制延迟（replication lag）。** 异步复制下从库有几百 ms 到几秒的延迟——用户刚提交任务，立刻查列表可能"看不到"自己刚提交的任务（write 后 read 走从库，从库还没同步）。这是经典的"读写一致性"问题。

**我们的应对：**

1. **写后强一致读**：用户自己的任务相关查询走主库（"我自己的数据"必须立即可见），其他人的/聚合查询走从库。
2. **关键页面降级走主库**：如"任务详情页"用户提交后跳转的页面走主库。
3. **监控复制延迟**：`pg_stat_replication` 的 `write_lag`/`flush_lag`/`replay_lag`，延迟超阈值告警。
4. **客户端读偏好**：在 PgBouncer 或应用路由层加"刚写完 N 秒内强制读主库"的逻辑（sticky read）。

**为什么不全部走主库？** 主库扛写就够累了，再扛所有读会拖慢写入。读写分离是 OLTP 扩展性的关键手段。

**逻辑复制的坑：** 逻辑复制不复制 DDL（schema 变更要手动同步到从库）、不支持序列（sequence，自增 ID 在从库不会推进，故障切换时要重置）、有 PK 才能高效复制（无 PK 的表 UPDATE/DELETE 会全表扫）。所以大部分场景还是用流复制，逻辑复制只在"跨版本升级""只复制部分表到数据仓库"时才用。

### 🏗 架构分析

- **为什么这么设计：** 流复制走 WAL 字节流，从库是主库的物理克隆——实现简单、延迟低、可以做热备自动切换；逻辑复制把 WAL 解码成逻辑变更，灵活（跨版本/异构/部分表）但有编解码开销和 DDL/序列不复制等局限。PG 同时提供两套是为了覆盖不同场景：HA 和读副本用流复制，数据同步/升级迁移用逻辑复制。
- **为什么不用其它方案：**
  - **基于触发器的复制（如 Slony-I）**：老方案，每个表加触发器记录变更，性能差、侵入大，已被逻辑复制取代。
  - **CDC 工具（Debezium 解码 WAL）**：本质和逻辑复制一样解码 WAL，但推到 Kafka 给外部系统（ES、数仓），适合异构数据管道；纯 PG 间同步直接用逻辑复制更轻。
  - **共享存储（RDS 多 AZ）**：底层也是流复制，云厂商封装好了。
  - **同步 vs 异步**：异步是吞吐/可用性优先（我们的选择），同步是强一致优先但要付延迟和"从库挂主库阻塞"的代价。
- **权衡：** 异步复制有复制延迟，导致"写后立即读"看不到最新数据，靠"用户自身数据走主库"和 sticky read 缓解。流复制从库是只读的（不能写），所以不能用它做"多活"——多写多活要用逻辑复制或 BDR（Bi-Directional Replication）。
- **未来演进：** 读流量上来横向加 standby；引入 Patroni 或 stolon 做自动 failover（主挂自动选从提升为主，降低 RTO）；跨机房灾备评估同步复制 + remote_flush 给关键业务；CDC 推 Kafka 给数据团队做实时分析。

### 🎯 面试官真正考察什么

不是问"流复制和逻辑复制的定义"，而是看你能否讲清 **物理（WAL 字节流）vs 逻辑（行级变更 pub/sub）的本质区别和各自适用场景**、**同步 vs 异步复制在延迟/吞吐/可用性上的权衡**（不是无脑选同步），以及 **读写分离 + 复制延迟带来的"读写一致性"坑和应对**（sticky read、关键查询走主库）。顺带考察你知不知道逻辑复制不复制 DDL/序列这种实操陷阱。

### ❌ 常见错误回答

- 把流复制和逻辑复制定义照背，但讲不清"什么时候选哪个"。
- "同步复制一定更好更安全"——忽略延迟翻倍和"从库挂主库阻塞"的可用性反降。
- 读写分离后没考虑复制延迟，用户"刚提交查不到"。
- 把逻辑复制当万能——不知道它不复制 DDL、不支持序列、要 PK。
- 不知道 standby 是只读的，以为从库也能写（多活）。

### ✅ 推荐回答

> 流复制（物理）：传 WAL 字节流，从库是主库的物理克隆，整库复制不能选表，主从同版本同架构，适合 HA 和读副本。逻辑复制（PG 10+）：WAL 解码成行级变更，pub/sub 模型可跨版本/部分表/异构，适合数据同步和升级迁移，但不复制 DDL 和序列、需要 PK。同步 vs 异步：异步默认主不等从延迟低吞吐高但主库挂可能丢未同步 WAL；同步（synchronous_standby_names）等从库确认主库挂不丢已提交但延迟翻倍且从库挂会阻塞主库写。我们用异步+任务幂等重试。任务查询走从库读写分离保护主库写性能，坑是复制延迟导致"写后立即读看不到"——应对：用户自身数据/关键页走主库、PgBouncer 路由层 sticky read、监控 pg_stat_replication 延迟。多活要逻辑复制或 BDR，流复制 standby 是只读的。

### 📚 延伸知识

- **复制槽（Replication Slot）**：保证主库不删除还没被从库消费的 WAL，避免从库断线后主库清 WAL 导致从库追不上。但 slot 不消费会堆积 WAL 撑爆磁盘，要监控。
- **Patroni / stolon / pg_auto_failover**：自动 failover 工具，主挂自动选从提升，配合 etcd/ZooKeeper 做选主。
- **BDR（Bi-Directional Replication）**：PG 多活方案，每节点可写，但冲突处理复杂，少用。
- **CDC（Debezium）**：解码 WAL 推 Kafka，给 ES/数仓做实时管道，比逻辑复制更通用。

---

## Q13. CTE 和窗口函数

**🎤 面试官**

> 你们的 tasks 表有父子依赖关系（一个任务的下一步依赖前一步），还有"每个项目最近一个任务"这种查询。怎么写 SQL？

**🙋 候选人回答**

**两个利器：CTE（特别是递归 CTE）和窗口函数。**

**CTE（Common Table Expression，通用表表达式）：** `WITH` 子句定义临时结果集，让复杂查询可读。

```sql
-- 普通 CTE：先算活跃项目，再查它们的任务
WITH active_projects AS (
  SELECT id, name FROM projects WHERE status = 'ACTIVE'
)
SELECT t.* FROM tasks t
JOIN active_projects p ON t.project_id = p.id;
```

**递归 CTE（Recursive CTE）：处理树/图结构，是 PG 的杀手锏。**

我们的 step_results 是分步骤的，有时任务是链式依赖（task_A → task_B → task_C），查"一个任务的所有下游依赖"用递归 CTE：

```sql
-- 假设有 task_dependencies 表：parent_id → child_id
WITH RECURSIVE task_tree AS (
  -- 锚点：起始任务
  SELECT id, parent_id, 0 AS depth
  FROM tasks WHERE id = 'task_root'

  UNION ALL

  -- 递归：找上一层的子任务
  SELECT t.id, t.parent_id, tt.depth + 1
  FROM tasks t
  JOIN task_tree tt ON t.parent_id = tt.id
  WHERE tt.depth < 10  -- 防止无限递归（环保护）
)
SELECT * FROM task_tree ORDER BY depth;
```

执行过程：
```
depth=0: task_root
depth=1: task_root 的直接子任务
depth=2: 子任务的子任务
... 直到没有新的子任务
```

**窗口函数（Window Functions）：在不折叠行的前提下做"分组内的计算"。**

经典场景：**每个项目最近一条任务**。

```sql
-- 每个 project_id 取最近 created_at 的那条任务
SELECT * FROM (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) AS rn
  FROM tasks
) t
WHERE rn = 1;
```

`ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC)` 给每个项目的任务按时间倒序编号，rn=1 就是最近的。这比"用 GROUP BY + JOIN 回原表"或"相关子查询"优雅得多，性能也更好。

**常用窗口函数：**

| 函数 | 作用 |
|------|------|
| `ROW_NUMBER()` | 行号（不并列） |
| `RANK()` | 排名，并列后跳号（1,1,3） |
| `DENSE_RANK()` | 排名，并列不跳号（1,1,2） |
| `LAG(col, n)` | 前 n 行的值（用于环比） |
| `LEAD(col, n)` | 后 n 行的值 |
| `SUM/AVG(...) OVER (...)` | 滑动/分组聚合 |

**实际例子：每个项目 token 用量的环比。**

```sql
-- 每月每项目的 token 用量，和上月对比（LAG）
SELECT project_id, month, total_tokens,
  LAG(total_tokens, 1) OVER (PARTITION BY project_id ORDER BY month) AS prev_month,
  total_tokens - LAG(total_tokens, 1) OVER (PARTITION BY project_id ORDER BY month) AS diff
FROM (
  SELECT project_id,
    date_trunc('month', created_at) AS month,
    SUM(prompt_tokens + completion_tokens) AS total_tokens
  FROM token_usage
  GROUP BY project_id, date_trunc('month', created_at)
) m;
```

---

**🎤 面试官追问**

> 递归 CTE 听起来强，但它的性能怎么样？有没有什么坑？

**🙋 候选人回答**

**有几个坑要注意。**

1. **递归 CTE 在 PG 12 之前是"优化屏障"（optimization fence）。** 12 以前 PG 把 CTE 当成"先物化再连接"，不能下推谓词——你在外层 WHERE 加条件，CTE 内部还是全表扫。12+ 改成可内联（MATERIALIZED 关键字才强制物化）：

```sql
-- PG 12+ 默认内联（高效）
WITH t AS (SELECT ... FROM tasks WHERE ...) SELECT * FROM t WHERE t.status='X';
-- 等价于直接 SELECT ... FROM tasks WHERE ... AND status='X'

-- 强制物化（某些场景用，如多次引用避免重复计算）
WITH t AS MATERIALIZED (SELECT ...) SELECT ... FROM t, t AS t2;
```

2. **递归 CTE 必须有终止条件。** 数据有环（A 依赖 B，B 依赖 A）会无限递归。靠 `depth < N` 或 `UNION`（去重，遇到重复自动停）保护。用 `UNION ALL` 不去重要特别小心环。

3. **递归 CTE 的索引很关键。** 每次递归都是一次 `JOIN ... ON t.parent_id = tt.id`，`parent_id` 上必须有索引，否则每层都全表扫。

4. **深度大树会慢。** 递归深度 = 树高，每层一次 JOIN。扁平宽树比瘦高树友好。

**性能实测：** 我们的任务链一般深度 ≤ 5，递归 CTE 性能完全够用（毫秒级）。但如果要做"全库所有任务的依赖图"（几万节点），就要考虑用图数据库（Neo4j）或在应用层做 BFS。

---

**🎤 面试官继续追问**

> 窗口函数和 GROUP BY 有什么本质区别？什么时候必须用窗口函数？

**🙋 候选人回答**

**核心区别：GROUP BY 把多行折叠成一行，窗口函数保留所有行只是"加一列计算结果"。**

```sql
-- GROUP BY：每个项目一行（折叠了）
SELECT project_id, COUNT(*) FROM tasks GROUP BY project_id;
-- 结果：projectA | 100, projectB | 50（每个项目一行）

-- 窗口函数：每行都还在，加一列"项目任务总数"
SELECT id, project_id,
  COUNT(*) OVER (PARTITION BY project_id) AS project_total
FROM tasks;
-- 结果：task1 | projectA | 100, task2 | projectA | 100, ...（每行都有 project_total）
```

**什么时候必须用窗口函数（GROUP BY 做不到）：**

1. **既要分组聚合、又要保留明细行：** 如"每个任务 + 它所属项目的任务总数"——GROUP BY 会丢明细。
2. **每组取 Top N：** "每项目最近 3 条任务"——GROUP BY 没法取 Top N。
3. **行间比较（前后行）：** LAG/LEAD 算环比，GROUP BY 没有行序概念。
4. **累计/滑动聚合：** `SUM(...) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` 算累计，GROUP BY 只能给单组聚合值。

**一个经典坑：用 GROUP BY + 自连接做"每组 Top 1"，又慢又丑：**

```sql
-- 笨办法（GROUP BY + JOIN）：慢
SELECT t.* FROM tasks t
JOIN (SELECT project_id, MAX(created_at) AS m FROM tasks GROUP BY project_id) g
  ON t.project_id = g.project_id AND t.created_at = g.m;

-- 优雅办法（窗口函数）：清晰高效
SELECT * FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) AS rn
  FROM tasks
) t WHERE rn = 1;
```

窗口函数一次扫描就能算出所有分组的排名，比自连接（两次扫表 + JOIN）高效。

### 🏗 架构分析

- **为什么这么设计：** CTE 把复杂查询拆成命名的、有顺序的逻辑块，解决"一条 SQL 套五层子查询读不懂"的问题；递归 CTE 用"锚点 + 递归 UNION"的简洁语法表达树/图遍历，是 SQL 处理层次数据的标准答案。窗口函数扩展了 SQL 的表达能力——在不破坏行粒度的情况下做分组计算和行间比较，让"每用户最近一条""环比""累计"这类分析查询能一条 SQL 写完，不用跑应用层 N+1。
- **为什么不用其它方案：**
  - **多层子查询替代 CTE**：能做但可读性极差；CTE 命名 + 顺序展开让复杂查询像读故事。
  - **应用层 N+1 替代窗口函数**：查项目列表，再 for 循环查每个项目最近任务——N 次查询慢且脏。窗口函数一次扫完。
  - **GROUP BY + 自连接替代窗口函数**：能做但性能差（两次扫表 + JOIN）、SQL 丑。
  - **应用层 BFS 替代递归 CTE**：处理树遍历要多次查 DB，递归 CTE 一次搞定。
  - **图数据库（Neo4j）替代递归 CTE**：复杂图查询更好，但引入新组件；简单的树/依赖链递归 CTE 够用。
- **权衡：** 递归 CTE 性能依赖树高和索引（parent_id 必须有索引、深度不能太大）；窗口函数内存敏感（PARTITION 数据量大要排序+缓存）。PG 12+ CTE 默认内联解决了"优化屏障"老问题，但要注意老版本或显式 MATERIALIZED 的物化开销。
- **未来演进：** 复杂分析查询（如多维 token 趋势报表）数据量上来后，考虑物化视图预聚合或推到 OLAP 引擎（ClickHouse）；递归 CTE 跑不动的图查询考虑 Neo4j。

### 🎯 面试官真正考察什么

不是问"CTE 怎么写/窗口函数语法"，而是看你能否用 **递归 CTE 解决树/依赖遍历**、**窗口函数解决"每组 Top N""环比"这类 GROUP BY 做不到的查询**，以及是否知道 **窗口函数和 GROUP BY 的本质区别（保留行 vs 折叠行）** 和 **PG 12+ CTE 内联**这种版本相关的性能细节。

### ❌ 常见错误回答

- 会写 CTE 但不知道递归 CTE，处理树遍历靠应用层 N+1。
- 递归 CTE 不加终止条件/环保护，遇到环数据无限递归。
- 窗口函数和 GROUP BY 混淆，答不清"什么时候必须用窗口函数"。
- "每组 Top 1"用 GROUP BY + 自连接，又慢又丑。
- 不知道 PG 12+ CTE 默认内联，以为 CTE 都是物化有性能代价。

### ✅ 推荐回答

> CTE 用 WITH 定义临时结果集让复杂查询可读，递归 CTE 处理树/图——锚点 + UNION ALL 递归找下层，我们用来查任务的下游依赖链（task_dependencies 表 parent_id→child_id，parent_id 必须有索引、depth<N 防环）。窗口函数保留所有行只加计算列，和 GROUP BY 的区别是 GROUP BY 折叠行、窗口函数不折叠——所以"每组 Top N""环比 LAG/LEAD""累计 SUM OVER"必须用窗口函数。例子：每项目最近一条任务用 ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) WHERE rn=1，比 GROUP BY+自连接优雅高效。token 月环比用 LAG(total_tokens, 1) OVER (PARTITION BY project_id ORDER BY month)。PG 12+ CTE 默认内联不再是优化屏障，MATERIALIZED 才强制物化。

### 📚 延伸知识

- **递归 CTE 执行模型**：基于"工作队列"——锚点结果入队，每次取出一批做递归步、新结果再入队，直到空。参考 PG 文档 "WITH Queries"。
- **窗口函数的 FRAME**：`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` 定义窗口范围，可做累计/滑动聚合。
- **物化视图（PG 9.3+）**：`CREATE MATERIALIZED VIEW` 预计算窗口函数结果，REFRESH 刷新，适合报表。

---

## Q14. PG 的分区表

**🎤 面试官**

> 你们的 token_usage 表涨得很快，每天几百万行，一年下来几十亿。这种大表怎么管？

**🙋 候选人回答**

**用分区表（Partitioning）。把一张逻辑大表拆成多个物理子表，查询只扫相关分区，索引也更小更局部。**

**PG 的声明式分区（Declarative Partitioning，PG 10+）：** 三种策略。

```sql
-- RANGE 分区：按范围（最常用，按时间）
CREATE TABLE token_usage (
  id BIGSERIAL,
  project_id VARCHAR,
  task_id VARCHAR,
  prompt_tokens INT,
  completion_tokens INT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at)  -- 分区键必须在主键里
) PARTITION BY RANGE (created_at);

-- 建子分区（按月）
CREATE TABLE token_usage_2026_07 PARTITION OF token_usage
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE token_usage_2026_08 PARTITION OF token_usage
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- ...

-- LIST 分区：按枚举值（如按项目）
CREATE TABLE tasks (...) PARTITION BY LIST (project_id);
CREATE TABLE tasks_drama PARTITION OF tasks FOR VALUES IN ('drama');
CREATE TABLE tasks_shortvideo PARTITION OF tasks FOR VALUES IN ('shortvideo');

-- HASH 分区：均匀打散（如按 user_id hash）
CREATE TABLE (...) PARTITION BY HASH (user_id);
CREATE TABLE t_p0 PARTITION OF t FOR VALUES WITH (modulus 4, remainder 0);
```

**分区表的核心收益：**

1. **分区裁剪（Partition Pruning）：** 查询带分区键条件时，PG 只扫相关分区，其他分区不碰。
```sql
-- 查 7 月的数据，只扫 token_usage_2026_07 一个分区
EXPLAIN SELECT * FROM token_usage WHERE created_at >= '2026-07-01' AND created_at < '2026-08-01';
-- → Append → Seq Scan on token_usage_2026_07（只扫一个分区）
```

2. **索引局部化：** 每个分区有自己的索引，比全表大索引小、维护快。删除旧分区时索引一起删，不产生大量死元组（对比在单表 DELETE 旧行会留死元组要 VACUUM）。

3. **数据生命周期管理：** 老数据归档直接 `DROP TABLE token_usage_2025_01`（瞬间释放空间，比 DELETE 快几个数量级），或 `DETACH PARTITION` 转成普通表搬走。

**什么时候该分区？** 不是越多越好。经验值：**表 > 1000 万行且查询明显变慢、或数据有明显的时间/分类维度** 才考虑。小表分区纯属增加复杂度没收益。

---

**🎤 面试官追问**

> 那你怎么自动创建未来的分区？总不能每个月手动建吧？

**🙋 候选人回答**

**对，手动建不现实——忘了就会出现"插入失败"（没有匹配分区的行报错）。我们用 `pg_partman` 扩展自动管理。**

```sql
-- 安装 pg_partman
CREATE EXTENSION pg_partman;

-- 配置：按月自动分区，预创建未来 3 个月、保留过去 12 个月
SELECT partman.create_parent(
  'public.token_usage',
  'created_at',
  'native',
  'monthly',
  p_premake := 3,        -- 预创建未来 3 个月分区
  p_retention := '12 months',  -- 保留 12 个月
  p_retention_schema := 'archive'  -- 老分区 DETACH 到 archive schema
);

-- 定时跑维护（cron 每天）
CALL partman.run_maintenance_proc();
```

pg_partman 会：
- 自动创建未来 N 个月的分区（premake）
- 超过保留期的老分区自动 DETACH 或 DROP（retention）
- 配合 cron 定时跑 `run_maintenance_proc`

**也有 PG 原生的"DEFAULT 分区"兜底：**

```sql
CREATE TABLE token_usage_default PARTITION OF token_usage DEFAULT;
```

没匹配任何分区的行落到 default 分区。但这有坑：default 分区会"拖累"新分区的创建（PG 要扫描 default 确认没有应该属于新分区的行），数据多了慢。所以 default 只是兜底，正经还得靠 pg_partman 预创建。

---

**🎤 面试官继续追问**

> 分区表有什么坑？主键/外键/跨分区查询这些怎么处理？

**🙋 候选人回答**

**分区表有不少限制要注意：**

1. **主键/唯一约束必须包含分区键。**

```sql
-- 错：PRIMARY KEY (id) 单独 id 不行（跨分区无法保证唯一）
CREATE TABLE token_usage (id BIGSERIAL PRIMARY KEY, ...) PARTITION BY RANGE (created_at);
-- 错误：PRIMARY KEY constraint on partitioned table must include all partitioning columns

-- 对：把 created_at 加进主键
PRIMARY KEY (id, created_at)
```

这导致"id 全局唯一"这个常见需求不能直接用主键实现。我们的做法：用应用层生成 UUID/snowflake 作为 id 保证全局唯一，主键用 `(id, created_at)` 复合满足约束。

2. **外键引用分区表有限制。** PG 12 之前不能从普通表外键引用分区表；12+ 部分支持但性能差（要扫所有分区检查）。所以分区表尽量不当被引用方。

3. **跨分区查询没有分区裁剪时性能可能更差。** 如果查询不带分区键，PG 要扫所有分区（Append 所有子表），比单表扫还慢（多了分区开销）。

```sql
-- 慢：没带 created_at，扫所有月分区
SELECT * FROM token_usage WHERE project_id = 'drama';
-- 优化：业务上这种查询天然有时间范围（如"本月"），加上时间条件
SELECT * FROM token_usage WHERE project_id = 'drama' AND created_at >= '2026-07-01';
```

4. **UPDATE 改分区键值会"移动行"。** 如果 UPDATE 改了 created_at 让它跨分区，PG 要 DELETE 旧分区 + INSERT 新分区，比普通 UPDATE 慢且有触发器开销。我们 token_usage 的 created_at 写入后不改，没这个问题。

5. **全局聚合慢。** `SELECT SUM(prompt_tokens) FROM token_usage` 不带分区键，要扫所有分区。解决：维护一个每日/每月的物化汇总表（rollup），查询走汇总表。

**我们的 token_usage 最终设计：**
- RANGE 分区按 created_at 月分区
- 主键 `(id, created_at)`，id 用应用层 snowflake 全局唯一
- pg_partman 预创建未来 3 月、保留 12 月老分区归档
- 高频查询都带时间范围（统计报表天然按月/季）
- 维护月度物化视图给"全期累计"查询

### 🏗 架构分析

- **为什么这么设计：** 大表（几十亿行）单表的问题：索引巨大（深度增加、缓存命中率降）、VACUUM 慢、删旧数据留死元组、DDL 变更锁表久。分区表把数据按维度切开，让每个分区的索引/数据量回归"可管理"规模，查询通过分区裁剪只扫相关分区，删旧数据用 DROP PARTITION 秒级完成——是时间序列/日志类大表的标准解法。
- **为什么不用其它方案：**
  - **单表 + 大索引硬扛**：几十亿行单表的 B-Tree 索引上 TB，缓存命中率崩、VACUUM 几小时锁资源，不可持续。
  - **应用层分表（手动按月表 token_usage_202607）**：能做但要应用层路由查询（UNION ALL 各月）、跨表查询难、维护脚本多。声明式分区把这些封装在 PG 内部，应用层看到的是一张逻辑表。
  - **TimescaleDB / ClickHouse**：专门做时序的扩展/引擎，性能比原生 PG 分区更好（自动分区、压缩、连续聚合），但引入新组件。我们的 token_usage 量级（年几十亿）用原生分区 + pg_partman 够用，还没到必须上 TimescaleDB 的程度。
  - **RANGE vs LIST vs HASH**：时间序列选 RANGE（按月/日最自然），按分类维度（项目）选 LIST，无明确维度但要打散负载选 HASH。我们 token_usage 选 RANGE 按 created_at 是因为查询天然带时间范围。
- **权衡：** 分区表的代价是主键必须含分区键（破坏"id 全局唯一主键"的常见设计）、跨分区查询无裁剪时反而更慢、外键引用受限、UPDATE 分区键要移动行。所以只对真正的大表（100M+ 行）用，小表分区是负优化。
- **未来演进：** token_usage 继续涨（百亿级）评估 TimescaleDB（自动分区+压缩，能省 10x 空间）或把冷数据归档到 ClickHouse/对象存储；维护 rollup 物化视图给全期聚合查询；监控每分区大小和查询的分区裁剪命中情况。

### 🎯 面试官真正考察什么

不是问"PG 怎么建分区表语法"，而是看你能否讲清 **三种分区策略（RANGE/LIST/HASH）的选型依据**、**分区裁剪（Partition Pruning）的工作原理和"查询必须带分区键"的约束**、**主键必须含分区键这个设计影响**，以及 **数据生命周期管理（DROP PARTITION 秒级释放 vs DELETE+VACUUM）** 的工程价值。最忌只会建分区但答不出跨分区查询/主键/外键的坑。

### ❌ 常见错误回答

- 一上来给小表（几万行）也分区，增加复杂度没收益。
- 建了分区但查询不带分区键，跨分区扫比单表还慢还抱怨"分区没用"。
- 不知道主键必须含分区键，建表时 PRIMARY KEY(id) 失败不知道为什么。
- 手动建分区忘了建未来的，导致插入报"no partition found"。
- 删旧数据用 DELETE 而不是 DROP PARTITION，留一堆死元组要 VACUUM。
- 想要全局唯一 id 但用自增序列，跨分区会冲突。

### ✅ 推荐回答

> PG 10+ 声明式分区三种策略：RANGE（按范围，时间序列最常用）、LIST（按枚举值，如项目）、HASH（均匀打散）。token_usage 用 RANGE 按 created_at 月分区。核心收益：分区裁剪（查询带 created_at 只扫相关分区）、索引局部化（每分区自己的索引更小更快）、数据生命周期（老数据 DROP PARTITION 秒级释放 vs DELETE 留死元组要 VACUUM）。自动管理用 pg_partman：premake 未来 3 月、retention 保留 12 月自动 DETACH 归档，cron 跑 run_maintenance_proc。坑：① 主键/唯一约束必须含分区键（PRIMARY KEY(id,created_at)，全局唯一靠应用层 snowflake）；② 查询不带分区键要扫所有分区反而更慢（业务查询天然带时间范围规避）；③ 跨分区聚合慢要维护 rollup 物化视图；④ UPDATE 改分区键要移动行。只对 >100M 行的大表分区，小表是负优化。再大考虑 TimescaleDB（自动分区+压缩）或冷数据归档 ClickHouse。

### 📚 延伸知识

- **TimescaleDB**：PG 扩展，专为时序数据，自动分区（hypertable）、列式压缩、连续聚合，比原生分区更省心。
- **pg_partman**：分区自动管理扩展，必装。
- **分区裁剪 vs 运行时分区**：PG 11+ 支持运行时裁剪（即使计划时不知道分区键值，执行时也能跳过）。
- **DEFAULT 分区**：兜底没匹配的行，但拖累新分区创建，慎用。

---

## 本章总结

第八章 14 道题，结合项目讨论了 PG 的核心使用与底层原理。回顾：

| 主题 | 核心决策 | 题号 |
|------|----------|------|
| 索引设计 | 等值在前范围在后+覆盖索引 | Q1 |
| 事务隔离 | RC+乐观锁，PG 的 RR 防幻读 | Q2 |
| MVCC+VACUUM | 旧版本留表+自动 VACUUM 防膨胀 | Q3 |
| EXPLAIN | Seq Scan 是问题+ANALYZE 更新统计 | Q4 |
| JSONB 索引 | GIN（灵活）vs 表达式索引（小快） | Q5 |
| 连接池 | PgBouncer transaction pooling | Q6 |
| 分页 | 游标分页避免 OFFSET 大偏移 | Q7 |
| 备份恢复 | pg_dump+WAL 归档+基础备份 | Q8 |
| 索引底层 | B+Tree 变体+堆表，GIN/GiST/BRIN 选型 | Q9 |
| WAL 机制 | 顺序写日志+延迟刷盘，崩溃 redo 恢复 | Q10 |
| 锁机制 | 行锁/表锁，死锁自动检测，advisory lock | Q11 |
| 复制方案 | 流复制（物理）vs 逻辑复制，读写分离 | Q12 |
| CTE/窗口函数 | 递归 CTE 走树，窗口函数每组 Top N | Q13 |
| 分区表 | RANGE 按月分区+pg_partman，分区裁剪 | Q14 |

**核心原则**：先看查询模式再设计索引、让优化器选执行计划（但保证统计信息准确）、VACUUM 是 PG 运维的必修课、理解底层（B+Tree/WAL/MVCC）才能做对调优决策、大表分区是时序数据的必修课。

下一章进入[第九章：系统设计](chapter-09-system-design.md)——设计 Task Platform、AI Platform、Logger、Workflow、Gateway、Notification、对象存储。

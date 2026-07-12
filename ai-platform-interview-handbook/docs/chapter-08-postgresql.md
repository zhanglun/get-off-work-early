# 第八章 PostgreSQL

> PG 是我们的持久化数据库——任务状态、Prompt、Token 统计、用户权限都存在 PG。本章结合项目讨论索引、事务、MVCC、Explain、优化，不背概念。
>
> 本章共 8 题。

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

## 本章总结

第八章 8 道题，结合项目讨论了 PG 的核心使用。回顾：

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

**核心原则**：先看查询模式再设计索引、让优化器选执行计划（但保证统计信息准确）、VACUUM 是 PG 运维的必修课。

下一章进入[第九章：系统设计](chapter-09-system-design.md)——设计 Task Platform、AI Platform、Logger、Workflow、Gateway、Notification、对象存储。

# 第四章 Task Platform

> 这是全书最重要的章节。Task Platform 是作者最核心的项目，也是面试中最容易被深挖的系统。
>
> **架构说明**：我们的任务平台是多语言多队列架构——Go（asynq）做任务中心底座，Python（Celery）跑音视频处理，NestJS（BullMQ）跑业务异步任务，正在向 Go 任务中心统一迁移。本章的设计原理（生命周期、状态机、重试、幂等、死信、限流、DAG、监控）**不因队列不同而改变**——BullMQ / Celery / asynq 的底层都是 Redis，核心设计模式一致。文中以 BullMQ 为主要举例（因为 NestJS 侧最先做深），但原理同样适用于 asynq 和 Celery。
>
> 本章共 29 题，覆盖：任务生命周期、状态机设计、为什么 WebSocket、Worker 架构、多语言 Runtime、任务取消、重试策略、幂等性、可靠性保障、日志与 Trace、死信队列、优先级与限流、延迟任务、任务编排 DAG、监控告警、容量规划等。

---

## Q1. 为什么 Task Platform 需要生命周期管理？

**🎤 面试官**

> 你在第二章说过 Task Platform 管理任务的生命周期。但"生命周期"这个词听起来很抽象，一个异步任务不就是"投到队列→Worker 执行→完成"吗？为什么需要"管理"？

**🙋 候选人回答**

"投到队列→执行→完成"是最理想的情况。现实中一个任务会经历很多状态，而且**不是每个任务都能顺利完成**。

看一个真实场景：用户点"生成漫剧"，平台创建一个任务。这个任务实际经历：

```
用户点击"生成"
  → 任务创建（CREATED）
  → 入队等待（PENDING）
  → Worker 领取（RUNNING）
  → 调 AI 生成分镜（AI 调用中...）
  → AI 限流了，等 5 秒重试
  → AI 成功，生成分镜图片
  → 调 TTS 生成配音（TTS 调用中...）
  → TTS 服务超时，重试 3 次都失败
  → 任务标记失败（FAILED）
  → 用户在前端点"重试"
  → 任务从 FAILED 恢复（RETRYING）
  → Worker 从 TTS 步骤重新执行（不用重做分镜）
  → 全部完成（COMPLETED）
```

这个过程中有**7 个状态、2 次重试、1 次从中间步骤恢复**。如果没有生命周期管理：

- 用户看不到任务在干嘛（"生成中…"转了 3 分钟不知道是卡了还是在跑）
- 失败了不知道从哪恢复（从头来？还是从 TTS 步骤？）
- Worker 崩溃后任务"消失"了（没人知道它跑到哪了）

**生命周期管理的本质是：让任务的状态在任何时刻都是已知且可恢复的。** 这不是"管理"的强迫症，是可靠性的基础——如果不知道任务在哪，就没法保证它最终完成。

---

**🎤 面试官追问**

> 你说"状态在任何时刻都是已知的"，但任务实际执行时有很多中间状态（"AI 调用中""TTS 调用中"）。这些中间状态也要管吗？会不会太细了？

**🙋 候选人回答**

**区分"任务状态"和"步骤状态"——两个粒度。**

**任务状态（Task Status）**：粗粒度，描述任务整体处于什么阶段。我们定义了 7 个：

```
CREATED → PENDING → RUNNING → COMPLETED
                    ↓
                  FAILED → RETRYING → RUNNING
                    ↓
                  CANCELLED
                    ↓
                  TIMEOUT
                    ↓
                  DEAD（死信）
```

**步骤状态（Step Status）**：细粒度，描述任务内部每个步骤的进度。存在任务的 metadata 里：

```json
{
  "taskId": "abc-123",
  "status": "RUNNING",
  "steps": [
    { "name": "script_split", "status": "COMPLETED", "result": "..." },
    { "name": "image_gen", "status": "COMPLETED", "result": ["url1", "url2"] },
    { "name": "tts", "status": "RUNNING", "startedAt": "..." },
    { "name": "subtitle", "status": "PENDING" },
    { "name": "compose", "status": "PENDING" }
  ],
  "progress": 60
}
```

**任务状态是"任务对外的契约"**——前端、API、监控系统看的是任务状态。它要少而稳定，不能频繁变。

**步骤状态是"任务内部的细节"**——主要用于失败恢复和进度展示。它可以多且频繁变化。

**为什么不把步骤状态也做成任务状态？** 因为状态爆炸。如果每个步骤都对应一个任务状态，一个 5 步骤的任务就有 5×7=35 种状态组合，状态机变成网状，不可维护。步骤状态作为 metadata 存在 JSON 里，灵活且不影响状态机。

**进度百分比（progress）怎么算？** 简单加权：每个步骤有权重，完成一步加对应百分比。TTS 权重 20%，完成 TTS 则 progress +20%。不是精确的（TTS 本身可能花 10 秒或 30 秒），但给用户一个"大概到哪了"的感觉。

---

**🎤 面试官继续追问**

> 你提到 DEAD（死信）状态，什么情况下任务会变成 DEAD？

**🙋 候选人回答**

**任务重试次数耗尽且无法恢复，进入 DEAD 状态。**

具体场景：

1. **重试上限到达**：任务配了 max_retries=3，重试 3 次都失败（比如 AI Provider 持续不可用），不再自动重试，标记 DEAD。
2. **不可恢复的错误**：任务的输入数据本身有问题（比如 Prompt 为空、图片 URL 404），重试多少次都一样失败。这类错误直接标 DEAD，不浪费重试。
3. **超时且无法恢复**：任务执行超过最大超时时间（比如 30 分钟），且 Worker 失联，标记 DEAD。

**DEAD 之后怎么办？** 进入**死信队列（Dead Letter Queue）**。

```
正常队列 → 重试 N 次失败 → 死信队列
                              ↓
                         人工排查
                              ↓
                    修复后可重新入队（RETRYING）
```

死信队列的作用是**隔离故障任务**——它们不再消耗 Worker 资源（不自动重试），但不会被删除（保留现场供排查）。运维可以查看死信队列里的任务，判断是数据问题（修正后重跑）还是系统问题（修 Bug 后批量重跑）。

**BullMQ 原生支持死信队列**：配置 `attempts` 和 `removeOnFail: false`，失败的任务保留在 Redis 里，可通过 Bull Board 查看。

### 🏗 架构分析

**任务状态机**

```
CREATED → PENDING → RUNNING → COMPLETED
                      ↕         ↑
                   FAILED → RETRYING
                      ↓
                  CANCELLED / TIMEOUT / DEAD
```

**两层状态**：
- 任务状态（7 种）：粗粒度、对外契约、状态机驱动
- 步骤状态（JSON metadata）：细粒度、内部细节、失败恢复

**死信队列**：重试耗尽/不可恢复错误 → DEAD → 人工排查 → 可重入队。

### 🎯 面试官真正考察什么

1. **生命周期的真实理解**：不只是"队列→执行→完成"，而是包含失败、重试、恢复、死信的完整链路。
2. **状态设计能力**：任务状态和步骤状态分层——避免状态爆炸。这是状态机设计的核心判断。
3. **死信处理**：知道任务不是无限重试，有死信机制兜底。

### ❌ 常见错误回答

- **"就是 PENDING/RUNNING/DONE 三个状态"**：过于简单，没有失败/重试/死信。
- **状态不分层**：每个步骤都对应任务状态，状态爆炸。
- **没有死信**：失败任务无限重试或直接丢弃。

### ✅ 推荐回答

> 任务实际经历 7 个状态：CREATED→PENDING→RUNNING→COMPLETED，中间有 FAILED→RETRYING→RUNNING 的恢复路径，以及 CANCELLED/TIMEOUT/DEAD 终态。生命周期管理的本质是让任务状态在任何时刻已知且可恢复。区分任务状态（粗粒度对外契约，7 种）和步骤状态（细粒度内部细节，存 JSON metadata）——避免状态爆炸。进度百分比用步骤权重加权计算。DEAD 状态用于重试耗尽/不可恢复错误/超时失联，进入死信队列隔离故障任务，不消耗 Worker 但保留现场供人工排查。BullMQ 原生支持 attempts + removeOnFail=false。

### 📚 延伸知识

- **State Machine Pattern**：任务状态机是有限状态机（FSM）的应用。每个状态有明确的合法转换（如 FAILED 只能转 RETRYING 或 DEAD，不能转 COMPLETED）。
- **Dead Letter Queue**：消息队列的通用模式。RabbitMQ、Kafka、SQS 都有死信队列概念。核心是"隔离无法处理的消息，避免阻塞正常流程"。

---

## Q2. 状态如何设计？状态机怎么实现？

**🎤 面试官**

> 你定义了 7 个任务状态。这些状态之间的转换规则是什么？怎么保证不会出现非法转换？

**🙋 候选人回答**

**用状态机定义合法转换，非法转换直接抛错。**

状态转换规则：

```
CREATED  → PENDING          （入队）
PENDING  → RUNNING          （Worker 领取）
PENDING  → CANCELLED        （用户取消等待中的任务）
RUNNING  → COMPLETED        （成功完成）
RUNNING  → FAILED           （执行失败）
RUNNING  → CANCELLED        （用户取消运行中的任务）
RUNNING  → TIMEOUT          （超时）
FAILED   → RETRYING         （用户/自动重试）
RETRYING → PENDING          （重新入队）
TIMEOUT  → RETRYING         （超时后重试）
任何状态 → DEAD              （重试耗尽/不可恢复）
```

**实现方式：状态转换表 + 守卫函数**

```typescript
// 合法转换表
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED:  ['PENDING'],
  PENDING:  ['RUNNING', 'CANCELLED'],
  RUNNING:  ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'],
  FAILED:   ['RETRYING', 'DEAD'],
  RETRYING: ['PENDING'],
  TIMEOUT:  ['RETRYING', 'DEAD'],
  CANCELLED: [],  // 终态
  COMPLETED: [],  // 终态
  DEAD:      [],  // 终态
};

function transition(current: TaskStatus, target: TaskStatus): TaskStatus {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new IllegalTransitionError(current, target);
  }
  return target;
}
```

**为什么用转换表而不是 if-else？** 因为转换表是**声明式**的——所有合法转换一目了然，新增状态只改表不改逻辑。if-else 会让转换逻辑散落在代码各处，容易遗漏。

---

**🎤 面试官追问**

> 状态转换在数据库层面怎么保证？如果有两个 Worker 同时尝试把任务从 PENDING 转成 RUNNING，怎么防止并发冲突？

**🙋 候选人回答**

**用乐观锁（Optimistic Locking）+ 条件更新。**

BullMQ 本身保证了"一个任务只会被一个 Worker 领取"（基于 Redis 的原子操作 BRPOPLPUSH）。但状态同步到数据库时可能有并发——BullMQ 的 Worker 已经把任务标记为 RUNNING，但数据库还是 PENDING，另一个进程（如监控）可能基于旧的 PENDING 状态做操作。

**数据库层面的状态更新用条件 WHERE：**

```sql
UPDATE tasks 
SET status = 'RUNNING', 
    started_at = NOW(),
    version = version + 1
WHERE id = $1 
  AND status = 'PENDING'        -- 只有当前是 PENDING 才能转 RUNNING
  AND version = $2;              -- 乐观锁：版本号必须匹配
```

如果 affected rows = 0，说明状态已经被别人改了（或版本号不匹配），当前操作放弃。

**为什么用乐观锁而不是悲观锁（SELECT FOR UPDATE）？**

1. **悲观锁持有连接时间长**：SELECT FOR UPDATE 会锁住这行直到事务提交，高并发下连接池容易耗尽。
2. **乐观锁无锁等待**：更新时检查版本号，失败就重试或放弃。大多数情况下不会冲突（任务状态的更新频率不高）。
3. **BullMQ 已经保证了大部分并发安全**：数据库的状态更新主要是"同步"用途，不是"争抢"用途。乐观锁够用。

**版本号（version）的作用**：防止"ABA 问题"。任务从 PENDING→RUNNING→FAILED→RETRYING→PENDING，如果只检查 status=PENDING，一个基于最初 PENDING 的操作可能误以为状态没变过。版本号保证每次变更都递增，即使 status 回到 PENDING，version 也不同。

---

**🎤 面试官继续追问**

> 你说 BullMQ 保证了"一个任务只被一个 Worker 领取"，这是怎么保证的？底层原理是什么？

**🙋 候选人回答**

BullMQ 底层用 Redis 的 **BRPOPLPUSH**（或 LMOVE，Redis 6.2+）命令实现任务的原子领取。

原理：

```
Redis 数据结构：
  wait list   → [task1, task2, task3]   待执行任务
  active list → [task4, task5]          已领取任务

Worker 领取任务：
  BRPOPLPUSH wait active 0
  → 原子地从 wait 尾部取出一个任务，放入 active
  → 如果 wait 为空，阻塞等待
```

**"原子性"是关键**：BRPOPLPUSH 是 Redis 单命令，执行过程中不会被其他命令打断。即使 10 个 Worker 同时执行 BRPOPLPUSH，Redis 的单线程模型保证它们逐个执行，每个任务只会被一个 Worker 取到。

**为什么用 BRPOPLPUSH 而不是 RPOPLPUSH？** RPOPLPUSH 是非阻塞的——队列为空直接返回空。BRPOPLPUSH 是阻塞的——队列为空时 Worker 挂起等待，直到有新任务。这避免了 Worker 轮询空队列浪费 CPU。

**任务完成后的清理**：Worker 执行完任务后，从 active list 移除（LREM）。如果 Worker 崩溃了没移除，任务留在 active list 里——BullMQ 的"stalled job check"机制会检测到（通过心跳），把它重新放回 wait list。

```
正常流程：
  wait → [BRPOPLPUSH] → active → [执行完 LREM] → 移除

崩溃恢复：
  wait → [BRPOPLPUSH] → active → [Worker 崩溃] → 任务滞留
  → stalled check 检测到无心跳 → 移回 wait → 其他 Worker 重新领取
```

**这就是 BullMQ 的可靠性基础**：即使 Worker 崩溃，任务不会丢——它要么在 wait list（待执行），要么在 active list（可被 stalled check 恢复）。

### 🏗 架构分析

**状态机的三层保障**

| 层 | 机制 | 作用 |
|----|------|------|
| 应用层 | 转换表 + 守卫函数 | 防止非法转换 |
| 数据库层 | 条件 UPDATE + 乐观锁 | 防止并发冲突 |
| 队列层 | BullMQ BRPOPLPUSH | 保证任务不被重复领取 |

**乐观锁 vs 悲观锁**：选乐观锁因为状态更新频率不高、BullMQ 已保证大部分并发安全、悲观锁连接占用高。

**BullMQ 可靠性**：BRPOPLPUSH 原子领取 + active list 滞留检测 + stalled check 恢复。

### 🎯 面试官真正考察什么

1. **状态机设计**：转换表声明式定义、终态不可转出——体现状态机设计能力。
2. **并发控制**：乐观锁+条件更新——数据库并发的基础知识。
3. **BullMQ 底层原理**：BRPOPLPUSH 原子性、stalled check——不只是"会用"，还知道底层。

### ❌ 常见错误回答

- **if-else 管状态**：转换逻辑散落，容易遗漏。
- **悲观锁**：不评估场景就 SELECT FOR UPDATE。
- **不知道 BullMQ 底层**：只说"BullMQ 保证的"，说不清怎么保证的。

### ✅ 推荐回答

> 7 个状态的合法转换用转换表声明式定义（VALID_TRANSITIONS），非法转换抛 IllegalTransitionError。数据库层用乐观锁+条件 UPDATE：WHERE status='PENDING' AND version=$2，affected rows=0 则放弃——防并发冲突。用乐观锁不用悲观锁因为状态更新频率不高、BullMQ 已保证大部分并发安全、悲观锁连接占用高。版本号防 ABA 问题（状态回到 PENDING 但 version 不同）。BullMQ 底层用 Redis BRPOPLPUSH 原子领取——单命令保证一个任务只被一个 Worker 取到。任务完成后 LREM 从 active 移除，Worker 崩溃则 stalled check 检测无心跳后移回 wait 重新领取——任务不丢。

### 📚 延伸知识

- **Optimistic Concurrency Control (OCC)**：乐观并发控制。假设冲突很少发生，更新时检查版本，失败重试。适合读多写少的场景。
- **Redis BRPOPLPUSH / LMOVE**：LMOVE 是 Redis 6.2+ 的替代命令，功能相同但参数更灵活。BullMQ 4.x+ 使用 LMOVE。

---

## Q3. 为什么 WebSocket？为什么不是 SSE？为什么不是轮询？

**🎤 面试官**

> 任务进度要推给前端。你选了 WebSocket，但 SSE（Server-Sent Events）也能做服务端推送，而且更简单。为什么不用 SSE？轮询就更简单了。

**🙋 候选人回答**

三种方案对比：

**① 轮询（Polling）**

前端每隔 N 秒调一次 `/api/tasks/:id/status`。

```
优点：最简单，前端 setInterval 就行
缺点：
- 实时性差（N 秒延迟）
- 浪费请求（任务没变化也轮询）
- 并发量大时服务器压力大（1000 个前端 × 每 3 秒 = 333 QPS）
```

**我们最初就是轮询**。漫剧生成任务跑 5 分钟，前端每 3 秒轮询一次 = 100 次请求，其中 95 次返回的状态没变。浪费严重。

**② SSE（Server-Sent Events）**

服务端通过长连接推送事件，前端用 EventSource API 接收。

```
优点：
- 单向推送（服务端→前端）正好满足进度推送需求
- 基于 HTTP，简单（不用 WebSocket 握手协议）
- 自动重连（EventSource 内置）

缺点：
- 只能服务端→前端（前端不能通过同一连接发消息）
- 连接数限制（浏览器对同域 SSE 连接数有限制，HTTP/1.1 下 6 个）
- 需要 HTTP/2 或多域名才能突破连接数限制
```

**③ WebSocket**

双向全双工通信。

```
优点：
- 双向（前端也能发消息，如取消任务）
- 低延迟（不是 HTTP 轮询，帧协议开销小）
- 无连接数限制（不走 HTTP/1.1 的 6 连接限制）

缺点：
- 更复杂（握手协议、心跳、重连要自己实现）
- 需要独立的 WebSocket 服务器（或 NestJS Gateway）
```

**我们选 WebSocket 的原因：**

**① 需要双向通信**

任务进度推送是服务端→前端，但**取消任务**是前端→服务端。如果用 SSE，取消任务要单独发 HTTP 请求；用 WebSocket，取消指令通过同一连接发。

更重要的是**订阅/取消订阅**。前端打开任务详情页，订阅 task-123 的进度；离开页面，取消订阅。这个"订阅/退订"用 WebSocket 的消息很自然：

```typescript
// 前端
ws.send(JSON.stringify({ action: 'subscribe', taskId: '123' }));
// 离开页面
ws.send(JSON.stringify({ action: 'unsubscribe', taskId: '123' }));
```

SSE 虽然也能做（关闭 EventSource），但不如 WebSocket 灵活——一个 WebSocket 连接可以订阅多个任务，SSE 通常一个连接对应一个事件流。

**② 连接复用**

前端可能同时看多个任务的进度（任务列表页）。WebSocket 一个连接复用所有任务的状态推送；SSE 可能要为每个任务开一个连接（或实现复杂的多路复用）。

---

**🎤 面试官追问**

> 你说 SSE 有连接数限制（HTTP/1.1 下 6 个），但你们前端到后端不是已经用 HTTP/2 了吗？HTTP/2 下 SSE 没有连接数限制。这个理由还成立吗？

**🙋 候选人回答**

**好问题，这个理由在 HTTP/2 下确实不完全成立。** 但我选 WebSocket 还有更重要的原因——**架构上的连接管理**。

我们的 WebSocket 不是前端直连后端 API，而是连一个**独立的 WebSocket 网关**：

```
前端 ←WebSocket→ WS Gateway ←Redis Pub/Sub→ API/Worker
```

为什么要独立网关？因为 **API 服务器和 WebSocket 服务器的负载特征不同**：

- API 服务器：短连接、高 QPS、CPU 密集（处理请求）
- WebSocket 服务器：长连接、低 QPS、内存密集（维护连接状态）

如果把 WebSocket 放在 API 服务器里，长连接会占用 API 服务器的连接数和内存，影响 API 的吞吐。分开后，WebSocket 网关可以独立扩缩容——连接数多就加网关实例，API QPS 高就加 API 实例。

**SSE 做不到这种分离**——SSE 绑定在 HTTP 请求上，必须在处理 HTTP 的服务器上建立。WebSocket 是独立协议，可以独立部署。

**而且我们的 WebSocket 网关不是 NestJS Gateway，而是一个独立的轻量服务**（基于 ws 库），只做连接管理和消息转发。这让它可以极度轻量——不加载业务逻辑、不连数据库，只维护连接和 Redis 订阅。

```
WebSocket Gateway（极轻）：
  - 维护前端连接
  - 订阅 Redis 频道
  - Redis 有消息 → 推给前端
  
API/Worker（重）：
  - 处理业务逻辑
  - 状态变更时 publish 到 Redis
  - 不直接管前端连接
```

**这种"连接层"和"业务层"的分离，是 WebSocket 比 SSE 更适合我们的根本原因**——不是协议层面的优劣，是架构层面的解耦。

---

**🎤 面试官继续追问**

> 你说 WebSocket 网关订阅 Redis，Worker 状态变更 publish 到 Redis。具体的消息流是怎样的？

**🙋 候选人回答**

完整消息流：

```
① Worker 执行任务，状态变更
   worker: task.status = 'RUNNING', progress = 60%
   
② Worker 发布消息到 Redis
   redis.publish('task:abc-123', JSON.stringify({
     taskId: 'abc-123',
     status: 'RUNNING',
     progress: 60,
     timestamp: '...'
   }))
   
③ WebSocket Gateway 订阅了 task:abc-123 频道（因为前端订阅了这个任务）
   gateway 收到 Redis 消息
   
④ Gateway 转发给订阅了该任务的前端连接
   ws.send(JSON.stringify({ taskId: 'abc-123', status: 'RUNNING', progress: 60 }))
   
⑤ 前端收到，更新进度条
```

**为什么用 Redis Pub/Sub 而不是 Worker 直接推 WebSocket？**

因为 **Worker 不知道前端连了哪个 WebSocket 网关**。我们有多个网关实例（负载均衡），前端连的可能是 Gateway-1 也可能是 Gateway-2。Worker 不能直接调某个 Gateway 的 API——那需要知道 Gateway 地址、处理失败重试。

**Redis Pub/Sub 解耦了生产者和消费者**：

- Worker 只管 publish 到 Redis 频道，不关心谁消费。
- Gateway 订阅频道，有消息就推给前端。
- 多个 Gateway 实例都订阅同一频道，消息会推给所有实例——但只有持有该前端连接的实例才会真正推送。

```
Worker → Redis Pub/Sub → Gateway-1（没有订阅该任务的连接，忽略）
                      → Gateway-2（有前端连接订阅了该任务，推送）
```

**这个设计的好处是"无状态"——Gateway 不需要知道 Worker 在哪，Worker 不需要知道 Gateway 在哪。两者通过 Redis 解耦。**

**订阅管理**：

```typescript
// WebSocket Gateway
class WSGateway {
  // taskId → Set<WebSocket>（订阅该任务的所有连接）
  private subscriptions = new Map<string, Set<WebSocket>>();
  
  // 前端订阅任务
  subscribe(ws: WebSocket, taskId: string) {
    if (!this.subscriptions.has(taskId)) {
      this.subscriptions.set(taskId, new Set());
      // 第一次订阅，创建 Redis 订阅
      redis.subscribe(`task:${taskId}`);
    }
    this.subscriptions.get(taskId)!.add(ws);
  }
  
  // 前端取消订阅
  unsubscribe(ws: WebSocket, taskId: string) {
    this.subscriptions.get(taskId)?.delete(ws);
    if (this.subscriptions.get(taskId)?.size === 0) {
      // 最后一个连接退订，取消 Redis 订阅
      redis.unsubscribe(`task:${taskId}`);
      this.subscriptions.delete(taskId);
    }
  }
  
  // 收到 Redis 消息，推给所有订阅该任务的连接
  onRedisMessage(channel: string, message: string) {
    const taskId = channel.replace('task:', '');
    const subscribers = this.subscriptions.get(taskId);
    if (subscribers) {
      for (const ws of subscribers) {
        ws.send(message);
      }
    }
  }
}
```

**关键设计：引用计数式订阅**。一个任务可能有多个前端连接订阅（用户在手机和电脑都打开了），只有最后一个退订才取消 Redis 订阅。避免一个连接退订导致其他连接收不到消息。

### 🏗 架构分析

**进度推送方案对比**

| 方案 | 实时性 | 双向 | 连接复用 | 架构解耦 | 复杂度 |
|------|--------|------|----------|----------|--------|
| 轮询 | 差 | ✗ | ✗ | ✗ | 低 |
| SSE | 好 | ✗ | 差 | 差 | 低 |
| WebSocket + Redis Pub/Sub | 好 | ✅ | ✅ | ✅ | 中 |

**选 WebSocket 的根本原因**：不是协议优劣，是架构解耦——独立 Gateway + Redis Pub/Sub 让连接层和业务层分离，可独立扩缩容。

**消息流**：Worker → Redis Pub/Sub → Gateway → 前端。生产者消费者完全解耦。

### 🎯 面试官真正考察什么

1. **三种方案的对比**：轮询/SSE/WebSocket 各自的优劣，不是"WebSocket 最好"。
2. **架构思维**：选 WebSocket 不是因为"推送"，而是因为"连接层和业务层解耦"。
3. **Redis Pub/Sub 的应用**：Worker 和 Gateway 通过 Redis 解耦——这是分布式系统的经典模式。

### ❌ 常见错误回答

- **"WebSocket 最强"**：不对比 SSE 的优势（简单、自动重连）。
- **"SSE 不行"**：SSE 其实够用，只是我们的架构需要更灵活的解耦。
- **不知道 Pub/Sub**：Worker 直接推 WebSocket，无法多实例部署。

### ✅ 推荐回答

> 三种方案都考虑过。轮询实时性差且浪费请求（5 分钟任务轮询 100 次中 95 次状态没变）。SSE 只能单向且绑 HTTP 服务器无法独立部署。选 WebSocket 因为：需要双向（取消任务+订阅/退订）、连接复用（一个连接订阅多任务）、架构解耦——独立 WS Gateway 只管连接和 Redis 订阅不加载业务逻辑，API/Worker 只管 publish 到 Redis。Gateway 和 Worker 通过 Redis Pub/Sub 解耦：Worker publish 到 task:{id} 频道，所有 Gateway 实例订阅该频道，只有持有前端连接的 Gateway 推送。订阅管理用引用计数——多连接订阅同一任务，最后一个退订才取消 Redis 订阅。Gateway 独立扩缩容不受 API QPS 影响。

### 📚 延伸知识

- **WebSocket vs SSE 选择**：如果只需服务端→前端推送且不需要独立部署推送服务，SSE 更简单。需要双向或架构解耦时选 WebSocket。
- **Redis Pub/Sub 的局限**：消息不持久化，订阅者不在线时消息丢失。如果需要可靠投递，用 Redis Streams（支持消费组和持久化）。

---

## Q4. Worker 如何设计？

**🎤 面试官**

> 你们的 Worker 架构是什么样的？Node Worker 和 Python Worker 怎么分工？

**🙋 候选人回答**

Worker 分两类，按任务特性分工：

**Node Worker**：处理 I/O 密集任务

- 调 AI API（网络 I/O）
- WebSocket 推送状态
- 数据库读写
- 文件上传到存储

这些任务的特点是"等的时间长、算的时间短"——调 AI API 可能等 10 秒，但 CPU 几乎不忙。Node 的事件循环适合这种场景。

**Python Worker**：处理 CPU 密集任务

- AI 图像推理（如果用本地模型）
- FFmpeg 视频合成（subprocess）
- 图片处理（裁剪、缩放、格式转换）

这些任务的特点是"CPU/内存密集"——FFmpeg 合成视频可能吃满 4 核 CPU 3 分钟。Node 单线程跑这种任务会阻塞事件循环，导致其他任务卡死。

**架构图**：

```
                    BullMQ 队列（Node 管理）
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Node Worker  Node Worker  Node Bridge Worker
         (I/O 任务)   (I/O 任务)   (CPU 任务转发)
                                          │
                                    Redis List
                                    (Python 队列)
                                          │
                              ┌───────────┼───────────┐
                              ▼           ▼           ▼
                         Python Worker  Python Worker  Python Worker
                         (FFmpeg/AI)    (图片处理)      (AI 推理)
```

**Node Bridge Worker** 是关键中间件——它从 BullMQ 领取 CPU 密集任务，转发到 Redis List（Python 队列），Python Worker 用 BLPOP 消费。这个设计在第二章 Q6 详细讲过。

---

**🎤 面试官追问**

> Worker 的并发数怎么控制？一台机器起多少个 Worker 合适？

**🙋 候选人回答**

**不同类型的 Worker，并发策略不同。**

**Node Worker**：并发数高（10-50）

Node Worker 是 I/O 密集的，大部分时间在等网络响应，CPU 空闲。所以一个 Node 进程可以同时处理很多任务（BullMQ 的 concurrency 配置）。

```typescript
const worker = new Worker('io-tasks', processor, {
  concurrency: 20,  // 一个 Worker 进程同时处理 20 个任务
});
```

但并发不是越高越好——每个并发任务占内存（连接池、缓冲区），太高会 OOM。我们的经验值：1GB 内存的 Node 进程，concurrency 设 10-20 比较安全。

**Python Worker**：并发数低（1-3）

Python Worker 是 CPU 密集的，每个任务吃满 1-2 个 CPU 核。如果机器是 4 核，同时跑 3 个 FFmpeg 就快满了。第 4 个会让所有任务变慢（CPU 争抢）。

```python
# Python Worker 用多进程，进程数 = CPU 核数 - 1（留 1 核给系统）
import multiprocessing
worker_count = multiprocessing.cpu_count() - 1  # 4 核机器 → 3 个进程
```

**关键原则：I/O 密集高并发，CPU 密集低并发。** 搞反了要么浪费资源（CPU 密集开高并发 → 互相争抢），要么吞吐不够（I/O 密集开低并发 → CPU 空闲等着）。

**动态扩缩容**：

我们用 Docker 部署 Worker，通过容器数量水平扩展：

```yaml
# docker-compose.yml
services:
  node-worker:
    image: node-worker:latest
    deploy:
      replicas: 3  # 3 个 Node Worker 容器
    scale: 3
  
  python-worker:
    image: python-worker:latest
    deploy:
      replicas: 5  # 5 个 Python Worker 容器（CPU 密集需要更多实例）
    scale: 5
```

高峰期加副本（`docker-compose up --scale python-worker=10`），低峰期减副本。K8s 环境下用 HPA（Horizontal Pod Autoscaler）按 CPU 使用率自动扩缩容。

---

**🎤 面试官继续追问**

> Worker 如果在执行任务时崩溃了（比如 OOM 被 kill），任务怎么办？会不会丢？

**🙋 候选人回答**

**任务不会丢，BullMQ 的 stalled job 机制会恢复它。**

原理：

```
① Worker 领取任务，任务从 wait → active
② Worker 执行中，每 N 秒发心跳到 Redis（BullMQ 自动做）
③ Worker 崩溃（OOM/进程被 kill）
   → 心跳停止
④ BullMQ 的 stalled check（默认每 30 秒检查一次）
   → 发现 active 里的任务超过 stalledInterval 没有心跳
   → 判定为 stalled（失联）
   → 把任务从 active 移回 wait
   → 其他 Worker 重新领取执行
```

**配置：**

```typescript
const queue = new Queue('tasks', {
  defaultJobOptions: {
    attempts: 3,           // 最多重试 3 次（包括 stalled 恢复）
  },
});

const worker = new Worker('tasks', processor, {
  stalledInterval: 30000,     // 30 秒检查一次 stalled
  maxStalledCount: 1,         // 最多被判定 stalled 1 次（防止反复崩溃循环）
});
```

**maxStalledCount 的作用**：如果一个任务反复 stalled（Worker 每次领到就崩），说明任务本身有问题（比如数据导致 OOM）。maxStalledCount 限制后，超过次数任务直接 FAILED，不再循环。

**但有一个微妙的问题：任务可能被执行了一半。**

比如任务执行到"已调 AI 生成分镜，正准备生成图片"时崩溃。恢复后从头执行，会重新调 AI 生成分镜——浪费了之前的计算。

**解决方案：步骤级幂等 + 检查点。** 我们在第二章 Q19 讲过——每个步骤完成后把结果持久化到 step_results。恢复时检查 step_results，从最后完成的步骤继续：

```typescript
async function executeTask(task: Task) {
  const steps = loadStepResults(task.id);  // 从 DB 加载已完成的步骤
  
  if (!steps.script_split) {
    steps.script_split = await splitScript(task.input);  // 执行
    saveStepResult(task.id, 'script_split', steps.script_split);  // 持久化
  }
  // 如果 script_split 已存在，跳过
  
  if (!steps.image_gen) {
    steps.image_gen = await generateImages(steps.script_split);
    saveStepResult(task.id, 'image_gen', steps.image_gen);
  }
  
  // ... 后续步骤
}
```

**这就是"检查点（Checkpoint）模式"**：每个步骤完成后存档，崩溃恢复后从最后一个存档继续。和游戏的"存档点"一个道理。

### 🏗 架构分析

**Worker 架构**

| Worker 类型 | 任务特征 | 并发策略 | 扩展方式 |
|-------------|----------|----------|----------|
| Node Worker | I/O 密集 | 高并发（10-50） | 加容器 |
| Python Worker | CPU 密集 | 低并发（1-3） | 加容器 |
| Bridge Worker | 转发 | 中 | 加容器 |

**崩溃恢复**：BullMQ stalled check（心跳+active 检测）→ 移回 wait → 重新执行。步骤级检查点避免从头来。

### 🎯 面试官真正考察什么

1. **Worker 分工**：I/O 和 CPU 分开处理，不是一种 Worker 干所有事。
2. **并发控制**：I/O 高并发、CPU 低并发——理解 Node 事件循环和 CPU 密集的矛盾。
3. **崩溃恢复**：stalled job 机制 + 检查点模式——分布式任务系统的核心可靠性保障。

### ❌ 常见错误回答

- **一种 Worker 干所有事**：Node Worker 跑 FFmpeg，事件循环阻塞。
- **并发不管类型**：CPU 密集开高并发，互相争抢。
- **崩溃就丢**：不知道 stalled job，不知道检查点。

### ✅ 推荐回答

> Worker 分两类：Node Worker 处理 I/O 密集（调 AI/WebSocket/DB），高并发 10-50；Python Worker 处理 CPU 密集（FFmpeg/AI 推理/图片处理），低并发 1-3（=CPU 核数-1）。原则 I/O 密集高并发 CPU 密集低并发。Node Bridge Worker 从 BullMQ 领取 CPU 任务转发到 Redis List，Python Worker BLPOP 消费。崩溃恢复靠 BullMQ stalled check：Worker 每 N 秒发心跳，30 秒无心跳判定 stalled，任务从 active 移回 wait 重新领取。maxStalledCount 防反复崩溃循环。步骤级检查点避免从头执行——每步完成持久化 step_results，恢复时从最后完成步骤继续，像游戏存档点。

### 📚 延伸知识

- **Node.js Worker Threads**：Node 的 `worker_threads` 模块可以跑 CPU 密集任务不阻塞主线程。但不如直接用 Python Worker 成熟（Python 在 AI/FFmpeg 生态更强）。
- **Checkpoint Pattern**：分布式任务系统的通用模式。Spark、Flink 等大数据框架都有 checkpoint 机制——周期性保存执行状态，失败后从 checkpoint 恢复。

---

## Q5. 如何支持 Python？

**🎤 面试官**

> 你在第二章提到 Python Worker 不直接消费 BullMQ 队列，而是通过 Redis List 桥接。能不能详细讲讲这个桥接的设计？有没有考虑过其他方案？

**🙋 候选人回答**

先回顾为什么 Python 不能直接消费 BullMQ——因为 BullMQ 的任务数据结构是它自己定义的，包含元数据（attempts、timestamp、jobId 等）和业务 payload。BullMQ 的客户端负责这些元数据的管理（重试、超时、ack），Python 直接读 Redis 里的原始数据无法正确处理这些逻辑。

**我们评估过三种跨语言方案：**

**方案 A：gRPC**

Node 和 Python 之间用 gRPC 通信。

```
Node (gRPC Client) → Python (gRPC Server)
  调用 ExecuteTask(taskId, payload)
  → Python 执行
  → 返回结果
```

**问题**：任务是异步的（可能跑 5 分钟），gRPC 的 RPC 模型适合"快速请求-响应"，不适合长任务。虽然 gRPC 支持流式，但实现复杂。而且 gRPC 需要维护 proto 定义和代码生成，增加维护成本。

**方案 B：HTTP API**

Python 起一个 FastAPI 服务，Node 通过 HTTP 调用。

```
Node → POST /execute { taskId, payload } → Python
  → Python 执行
  → 返回结果
```

**问题**：同样不适合长任务——HTTP 请求等 5 分钟会超时。即使加大超时，连接占用 5 分钟浪费资源。且失败重试、并发控制要自己实现。

**方案 C：Redis 队列桥接（我们选的）**

```
Node (BullMQ) → Redis List (桥接队列) → Python (BLPOP)
                Redis Key (结果回写)  ← Python
Node 监听结果 ← Redis Pub/Sub
```

**选这个方案的原因**：

1. **天然异步**：任务投到队列就走，不阻塞。Python 执行完写结果，Node 不等待。
2. **复用 Redis**：不用引入新的通信组件（gRPC 需要独立服务，HTTP 需要 Web 服务器）。
3. **BullMQ 管生命周期**：Node 侧的任务重试、超时、状态管理由 BullMQ 负责，Python 只管执行。
4. **Python 侧极简**：BLPOP 阻塞读队列，执行，写结果。不需要框架。

---

**🎤 面试官追问**

> 具体的数据格式和通信协议是怎样的？Node 投到 Redis List 的数据长什么样？Python 怎么回写结果？

**🙋 候选人回答**

**任务投递格式**（Node → Redis List）：

```json
{
  "taskId": "abc-123",
  "type": "video_compose",
  "payload": {
    "images": ["url1", "url2", "url3"],
    "audioUrl": "https://...",
    "subtitleUrl": "https://...",
    "outputFormat": "mp4"
  },
  "timeout": 300000,
  "retryCount": 0
}
```

Node Bridge Worker 从 BullMQ 领取任务后，把业务 payload 序列化为 JSON，`LPUSH` 到 Redis List `python:tasks`：

```typescript
// Node Bridge Worker
new Worker('cpu-tasks', async (job) => {
  const taskData = {
    taskId: job.id,
    type: job.data.type,
    payload: job.data.payload,
    timeout: job.opts.timeout || 300000,
  };
  
  // 投递到 Python 队列
  await redis.lpush('python:tasks', JSON.stringify(taskData));
  
  // 等待结果（订阅结果频道，带超时）
  return waitForResult(job.id, job.opts.timeout);
}, { connection: redisConfig });
```

**Python Worker 消费**（BLPOP 阻塞读取）：

```python
import redis
import json

r = redis.Redis()

while True:
    # 阻塞等待任务
    _, raw = r.blpop('python:tasks', timeout=30)
    task = json.loads(raw)
    
    try:
        # 执行任务
        result = execute_task(task)
        
        # 回写结果
        r.hset(
            f'task:result:{task["taskId"]}',
            mapping={
                'status': 'success',
                'result': json.dumps(result),
            }
        )
    except Exception as e:
        r.hset(
            f'task:result:{task["taskId"]}',
            mapping={
                'status': 'failed',
                'error': str(e),
            }
        )
    
    # 通知 Node 结果就绪
    r.publish(f'task:done:{task["taskId"]}', 'done')
```

**Node 监听结果**（Pub/Sub + 超时）：

```typescript
async function waitForResult(taskId: string, timeout: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscriber.unsubscribe(`task:done:${taskId}`);
      reject(new TimeoutError(taskId, timeout));
    }, timeout);
    
    subscriber.subscribe(`task:done:${taskId}`, () => {
      clearTimeout(timer);
      subscriber.unsubscribe(`task:done:${taskId}`);
      
      // 读取结果
      redis.hgetall(`task:result:${taskId}`).then(result => {
        if (result.status === 'success') {
          resolve(JSON.parse(result.result));
        } else {
          reject(new TaskError(taskId, result.error));
        }
        // 清理结果
        redis.del(`task:result:${taskId}`);
      });
    });
  });
}
```

**三个 Redis 数据结构**：

1. `python:tasks`（List）：任务队列，Node LPUSH，Python BLPOP
2. `task:result:{taskId}`（Hash）：结果存储，Python 写，Node 读
3. `task:done:{taskId}`（Pub/Sub 频道）：结果就绪通知

---

**🎤 面试官继续追问**

> 如果 Python Worker 执行到一半崩溃了，结果没有回写，Node 侧的 waitForResult 会一直等吗？

**🙋 候选人回答**

**不会一直等，有超时兜底。** waitForResult 的 setTimeout 到了之后会 reject TimeoutError。BullMQ 接收到这个 error 后按重试策略处理（重试 or FAILED）。

但这里有一个**微妙的问题**：超时后 BullMQ 可能重试这个任务——又投一个相同的任务到 Python 队列。但之前那个崩溃的 Python Worker 如果恢复了，可能还在执行旧任务（如果它只是网络抖动而非真正崩溃）。这就可能出现**两个 Python Worker 执行同一个任务**。

**解决方案：幂等性 + 结果检查。**

```python
# Python Worker 执行前检查是否已有结果
existing = r.hgetall(f'task:result:{task["taskId"]}')
if existing and existing.get('status') == 'success':
    # 已经有结果了，不重复执行
    r.publish(f'task:done:{task["taskId"]}', 'done')  # 重新通知
    continue

# 执行前设置"处理中"状态，防止其他 Worker 重复领取
r.hset(f'task:result:{task["taskId"]}', 'status', 'processing')
r.expire(f'task:result:{task["taskId"]}', 600)  # 10 分钟过期（防永久锁）
```

**这是分布式系统的经典问题——"恰好一次"（exactly-once）是不可能完美实现的**，只能通过幂等性逼近"至少一次+去重=效果上一次"。

我们的策略是**"至少一次投递 + 幂等执行"**：

- 至少一次：任务可能被投递多次（超时重试），但保证至少被执行一次。
- 幂等执行：执行前检查是否已有结果，有则跳过。

**这个模式在后面的 Q7（幂等性）会详细展开。**

### 🏗 架构分析

**跨语言通信方案对比**

| 方案 | 异步支持 | 复杂度 | 复用现有组件 |
|------|----------|--------|-------------|
| gRPC | 差（长任务不友好） | 高（proto+代码生成） | ❌ |
| HTTP | 差（超时问题） | 中 | ❌ |
| Redis 队列桥接 | ✅ | 低 | ✅（已有 Redis） |

**三个 Redis 数据结构**：List（队列）+ Hash（结果）+ Pub/Sub（通知）。

**幂等保障**：至少一次投递 + 幂等执行（执行前检查已有结果）。

### 🎯 面试官真正考察什么

1. **跨语言通信的方案对比**：gRPC/HTTP/Redis 三种，能说出各自优劣。
2. **数据流和协议设计**：三个 Redis 数据结构各司其职——体现协议设计能力。
3. **分布式问题的意识**：超时重试导致重复执行——知道 exactly-once 不可实现，用幂等逼近。

### ❌ 常见错误回答

- **"用 gRPC"**：不考虑长任务不适合 RPC。
- **没有超时**：waitForResult 永久等待。
- **不处理重复**：不知道超时重试可能导致同一任务被执行两次。

### ✅ 推荐回答

> 选 Redis 队列桥接（天然异步+复用 Redis+Python 侧极简）。三个数据结构各司其职：List 投递任务、Hash 回写结果、Pub/Sub 通知就绪。超时重试可能导致重复投递，用幂等（执行前检查已有结果）逼近 exactly-once。

### 📚 延伸知识

- **Exactly-Once Semantics**：分布式系统的经典难题。两个组件之间不可能做到真正的 exactly-once（网络可能中断在任意阶段）。实际方案都是 at-least-once + idempotent。
- **Redis Streams**：比 List 更强大的队列数据结构，支持消费组、ACK、持久化。如果桥接需要更强的可靠性（如消息不丢），可以用 Streams 替代 List。
- **未来加 Go Worker**：架构天然支持，因为通信走 Redis（语言无关）。加 Go 只需 go-redis BLPOP 消费队列 + 按相同 JSON 格式回写 + Bridge Worker 加路由。注意 Redis 客户端差异（Python BLPOP 返回 None，Go 返回 redis.Nil error）和 JSON 序列化差异（数字精度/Unicode 转义）。
- **跨语言契约设计**：用 JSON Schema 作中间格式，quicktype 生成各语言类型。避免 union type（Go 没有）和复杂 Map，用枚举+可选字段。契约是协议不是实现——要简单到所有语言都能表达。

---

## Q6. 如何取消任务？

**🎤 面试官**

> 用户点"取消"后，正在运行的任务怎么真正停下来？不只是改状态，Worker 还在跑怎么办？

**🙋 候选人回答**

取消任务是最容易被忽视的难题。很多人以为"把状态改成 CANCELLED 就行了"，但 Worker 还在跑——CPU 还在算、AI 还在调、钱还在花。

**取消分两种情况：**

**① 任务在队列里等待（PENDING）**

这个简单——从队列移除即可。BullMQ 原生支持：

```typescript
const job = await queue.getJob(taskId);
await job.remove();  // 从队列移除
```

**② 任务正在执行（RUNNING）**

这个难。Worker 已经在执行逻辑了，怎么让它停下来？

**方案 A：协作式取消（Cooperative Cancellation）**

Worker 定期检查"我该不该继续"。如果任务被取消了，Worker 主动停止。

```typescript
// Node Worker
new Worker('tasks', async (job) => {
  for (const step of steps) {
    // 每步开始前检查取消标志
    const isCancelled = await redis.get(`task:cancel:${job.id}`);
    if (isCancelled) {
      throw new TaskCancelledError(job.id);  // 抛错让 BullMQ 处理
    }
    
    await executeStep(step);
  }
});
```

**"协作式"的意思是：Worker 必须主动检查，不能被外部强制杀死。** 这要求任务逻辑里埋"检查点"——每步开始前查 Redis 里的取消标志。

**优点**：Worker 可以做清理工作（释放资源、写日志）。
**缺点**：如果某一步执行很久（比如 FFmpeg 跑 3 分钟），取消要等这步跑完才生效。

**方案 B：强制取消（Force Kill）**

直接 kill Worker 进程。

```bash
# 找到执行该任务的 Worker PID
kill -TERM $PID
```

**优点**：立即停止。
**缺点**：资源可能泄漏（FFmpeg 子进程没清理、临时文件没删）、Worker 进程被杀后 BullMQ 的 stalled 机制会把任务移回队列重新执行（除非同时标记 CANCELLED 阻止重试）。

**我们用方案 A（协作式），辅以超时兜底：**

```
用户点取消
  → 状态改 CANCELLED
  → Redis 设置取消标志 task:cancel:{taskId} = 1
  → Worker 下一个检查点发现标志，抛 TaskCancelledError
  → BullMQ 捕获错误，标记任务为 CANCELLED（非 FAILED）
  → Worker 清理资源（删除临时文件、关闭连接）
```

---

**🎤 面试官追问**

> 你说"每步开始前检查取消标志"，但如果当前步骤是"调 AI API 等了 30 秒"，取消要等 30 秒后才生效。怎么让取消更快生效？

**🙋 候选人回答**

**用 AbortSignal 传播取消信号到异步操作内部。**

现代异步 API（fetch、axios、BullMQ 的 Worker）支持 AbortSignal——可以在操作进行中取消：

```typescript
new Worker('tasks', async (job, token) => {
  // BullMQ 的 job token 可以转成 AbortSignal
  
  // 创建 AbortController
  const controller = new AbortController();
  
  // 监听取消信号
  const cancelChecker = setInterval(async () => {
    const isCancelled = await redis.get(`task:cancel:${job.id}`);
    if (isCancelled) {
      controller.abort();  // 传播取消信号
      clearInterval(cancelChecker);
    }
  }, 1000);
  
  try {
    // AI 调用传入 AbortSignal
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      signal: controller.signal,  // 取消时 fetch 立即中止
      // ...
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new TaskCancelledError(job.id);
    }
    throw e;
  } finally {
    clearInterval(cancelChecker);
  }
});
```

**效果**：用户点取消 → 1 秒内检测到 → controller.abort() → fetch 立即中止（不等 AI 返回）→ 任务标记 CANCELLED。

**但不是所有操作都支持 AbortSignal。** 比如：

- `subprocess.run`（Python 调 FFmpeg）：不支持 AbortSignal。只能 kill 子进程。
- 数据库查询：大部分 ORM 支持 cancel（Prisma 的 query 可以 race condition 后 cancel）。

**对于不支持 AbortSignal 的操作**，回退到"协作式检查"——在操作完成后检查取消标志，如果已取消则不继续下一步。虽然当前操作无法中止，但不浪费后续步骤。

```typescript
// FFmpeg 不支持中途取消，但可以在完成后检查
await runFFmpeg(params);  // 这步不可中止

// 完成后检查，已取消则不继续
if (await isCancelled(job.id)) {
  throw new TaskCancelledError(job.id);
}

await nextStep();  // 不会执行
```

---

**🎤 面试官继续追问**

> 取消后，已经做了一部分的工作（比如生成了 3 张图片）怎么处理？要不要回滚？

**🙋 候选人回答**

**不回滚，但标记为"部分完成"，允许恢复。**

取消不等于回滚。用户取消可能是因为"不想等了"或"参数设错了想重来"。但已经生成的内容可能有用——比如 3 张图片里第 2 张效果很好，用户可能想保留。

**我们的设计：**

1. **已完成的步骤结果保留**：step_results 里记录了"script_split: COMPLETED, image_gen: COMPLETED (3/5)"。
2. **任务状态标记 CANCELLED**：但 metadata 里记录"取消时执行到哪一步"。
3. **支持"从取消点恢复"**：用户重新点"生成"时，系统检查是否有未完成的步骤结果，提示"上次执行到图片生成（3/5），是否继续？"

```typescript
async function resumeTask(taskId: string) {
  const task = await getTask(taskId);
  
  if (task.status === 'CANCELLED') {
    const stepResults = task.stepResults;
    
    // 检查哪些步骤已完成
    const completedSteps = Object.entries(stepResults)
      .filter(([_, s]) => s.status === 'COMPLETED')
      .map(([name]) => name);
    
    if (completedSteps.length > 0) {
      // 提示用户：可以跳过已完成步骤
      return { 
        canResume: true, 
        completedSteps,
        nextStep: findNextPendingStep(stepResults),
      };
    }
  }
  
  // 没有可恢复的步骤，从头开始
  return { canResume: false };
}
```

**为什么不做自动回滚？**

1. **回滚成本高**：生成的图片已经上传到存储，回滚要删存储文件；AI 调用已经花了钱，回滚退不了钱。
2. **部分结果有价值**：用户可能想保留部分结果。
3. **回滚逻辑复杂**：不同步骤的回滚逻辑不同（删文件？删数据库记录？发补偿事件？），维护成本高。

**取消的语义是"停止执行"，不是"撤销已做的"。** 如果需要撤销，那是另一个功能（回滚/删除），和取消分开。

### 🏗 架构分析

**任务取消的三种方式**

| 方式 | 即时性 | 资源清理 | 适用场景 |
|------|--------|----------|----------|
| 协作式（检查标志） | 慢（等检查点） | ✅ 可清理 | 通用 |
| AbortSignal | 快（操作中止） | ✅ 可清理 | 支持 Abort 的 API |
| 强制 Kill | 立即 | ❌ 可能泄漏 | 紧急情况 |

**取消的语义**：停止执行，不撤销已做的。部分结果保留，支持从取消点恢复。

### 🎯 面试官真正考察什么

1. **取消的完整性**：不只是改状态，还要让 Worker 真正停下。知不知道协作式 vs 强制式？
2. **AbortSignal**：现代异步取消的标准方案。能不能说清楚怎么传播取消信号？
3. **取消语义**：取消 ≠ 回滚。部分结果怎么处理？

### ❌ 常见错误回答

- **"改状态就行"**：Worker 还在跑，资源还在浪费。
- **"Kill 进程"**：不考虑资源泄漏和 stalled 重试。
- **取消即回滚**：把取消和回滚混为一谈。

### ✅ 推荐回答

> 取消分两种：PENDING 直接从队列移除（BullMQ job.remove()）；RUNNING 用协作式取消——Worker 每步检查 Redis 取消标志，发现则抛 TaskCancelledError。快速取消用 AbortSignal：监听取消标志后 controller.abort()，传给 fetch 等 API，操作立即中止不等 AI 返回。不支持 Abort 的操作（FFmpeg subprocess）回退到完成后检查。取消不等于回滚——已完成步骤结果保留在 step_results，标记"取消时执行到哪"，支持从取消点恢复。不做自动回滚因为成本高（已上传的文件、已花的 AI 费用）且部分结果有价值。取消语义是"停止执行"不是"撤销已做"。

### 📚 延伸知识

- **AbortController/AbortSignal**：Web 标准 API，用于取消异步操作。fetch、addEventListener、IndexedDB 等都支持。Node 15+ 全局可用。
- **双层超时**：取消和超时是同一类问题。BullMQ 配任务级超时（整体不超 5 分钟），Worker 内部用 AbortSignal + setTimeout 配操作级超时（单次 AI 调用不超 30 秒）。两层粒度不同——操作级防单步卡死，任务级防整体跑飞。
- **Cooperative vs Preemptive Cancellation**：协作式取消需要任务主动配合（检查标志），抢占式取消由系统强制中止（kill 进程）。Java 的 Thread.interrupt() 是协作式，Thread.stop() 是抢占式（已废弃，不安全）。

---

## Q7. 如何重试？

**🎤 面试官**

> 任务失败后重试听起来简单——失败了再跑一次。但重试有很多细节：什么时候该重试、重试几次、间隔多久、重试时从头来还是从断点继续？

**🙋 候选人回答**

重试策略分四个维度：

**① 什么错误该重试？**

不是所有失败都该重试。区分两类错误：

| 错误类型 | 示例 | 该重试？ |
|----------|------|----------|
| 瞬时错误 | 网络超时、5xx、429 限流、服务短暂不可用 | ✅ 重试 |
| 永久错误 | 400 参数错误、401 认证失败、数据格式错误、业务逻辑错误 | ❌ 不重试 |

**关键：永久错误重试多少次都是一样的结果，重试只是浪费资源。** 我们的 Worker 在抛错时标记错误类型：

```typescript
class TransientError extends Error { }  // 瞬时错误，可重试
class PermanentError extends Error { }  // 永久错误，不重试

async function callAI(prompt: string) {
  const response = await fetch('...');
  
  if (response.status === 429) throw new TransientError('Rate limited');
  if (response.status === 400) throw new PermanentError('Bad request');
  if (response.status >= 500) throw new TransientError('Server error');
}
```

BullMQ 的重试配置区分：

```typescript
new Queue('tasks', {
  defaultJobOptions: {
    attempts: 3,              // 最多 3 次
    backoff: {
      type: 'exponential',
      delay: 5000,            // 首次重试等 5 秒，之后指数增长
    },
    removeOnComplete: 100,    // 保留最近 100 个完成的任务
    removeOnFail: false,      // 失败任务不自动删除（进死信队列）
  },
});

// Worker 侧：根据错误类型决定是否重试
new Worker('tasks', async (job) => {
  try {
    await executeTask(job.data);
  } catch (e) {
    if (e instanceof PermanentError) {
      // 永久错误：不重试，直接标记失败
      await job.discard();  // BullMQ：标记任务不再重试
      throw e;
    }
    throw e;  // 瞬时错误：BullMQ 自动按 attempts+backoff 重试
  }
});
```

---

**🎤 面试官追问**

> 你用指数退避，具体延迟怎么算？第一次 5 秒、第二次多少？

**🙋 候选人回答**

**指数退避 + 抖动：**

```
attempt 1（首次执行）：失败
attempt 2（第 1 次重试）：等 5 秒
attempt 3（第 2 次重试）：等 10 秒（5 × 2^1）
attempt 4（第 3 次重试）：等 20 秒（5 × 2^2）—— 但 attempts=3 到此为止
```

BullMQ 的 exponential backoff 公式：`delay × 2^(attempt - 1)`。

**为什么要指数增长而不是固定间隔？**

如果 AI API 限流了，固定间隔重试（每 5 秒一次）会持续打限流。指数增长给服务端更多恢复时间——第一次等 5 秒，可能不够；第二次等 10 秒，可能恢复了一部分；第三次等 20 秒，大概率恢复。

**为什么加抖动（Jitter）？**

如果 1000 个任务同时失败（比如 AI Provider 挂了），它们的重试时间也会一致——第一次都在 5 秒后、第二次都在 10 秒后。这会导致"重试风暴"——服务端刚恢复就被 1000 个同时重试打爆。

抖动在每次重试延迟上加随机值：

```typescript
backoff: {
  type: 'exponential',
  delay: 5000,
},
// 实际延迟 = 5 × 2^attempt + random(0, 2000)
// 第一次：5s + 0~2s 随机
// 第二次：10s + 0~2s 随机
```

BullMQ 内置了抖动——exponential backoff 会自动加随机偏移。

---

**🎤 面试官继续追问**

> 重试时从头来还是从断点继续？你说有步骤级检查点，那重试时怎么利用？

**🙋 候选人回答**

**默认从断点继续，但可配置。**

**从断点继续（默认）**：

```typescript
async function executeTask(job) {
  const task = await getTask(job.id);
  const steps = task.stepResults || {};
  
  // 步骤 1：分镜
  if (!steps.script_split) {
    steps.script_split = await splitScript(task.input);
    await saveStepResult(job.id, 'script_split', steps.script_split);
  }
  
  // 步骤 2：图片（如果步骤 1 已完成，跳过步骤 1）
  if (!steps.image_gen) {
    steps.image_gen = await generateImages(steps.script_split);
    await saveStepResult(job.id, 'image_gen', steps.image_gen);
  }
  
  // ... 后续步骤
}
```

**BullMQ 重试时**，job.id 不变，stepResults 在数据库里还在。重试时加载 stepResults，跳过已完成的步骤。

**从头来（特定场景）**：

有些任务不适合从断点继续——比如任务依赖的数据已经变了（用户修改了输入），之前的结果作废。这种在创建重试任务时标记 `fresh_start: true`：

```typescript
async function retryTask(taskId: string, options: { freshStart?: boolean }) {
  if (options.freshStart) {
    await clearStepResults(taskId);  // 清除之前的步骤结果
  }
  await transitionStatus(taskId, 'RETRYING');
  await queue.add('tasks', { taskId }, { jobId: taskId });
}
```

**什么时候从头来？**

1. 用户修改了输入参数（之前的步骤结果基于旧参数，作废）。
2. 步骤结果有数据损坏（比如生成的图片 URL 失效了）。
3. 任务逻辑有 Bug 修复了（之前的结果可能不对，重新生成）。

**默认断点续传 + 可选从头来，兼顾效率和正确性。**

### 🏗 架构分析

**重试策略四维度**

| 维度 | 策略 |
|------|------|
| 错误类型 | 瞬时重试、永久不重试 |
| 重试次数 | 3 次（可配置） |
| 退避策略 | 指数退避 + 抖动（5s/10s/20s） |
| 恢复方式 | 默认断点续传、可选从头来 |

**瞬时 vs 永久的判断**是核心——重试永久错误是浪费，不重试瞬时错误是放弃可恢复的任务。

### 🎯 面试官真正考察什么

1. **错误分类**：瞬时/永久——重试策略的基础。能不能说清楚哪些错误该重试？
2. **退避策略**：指数退避 + 抖动——分布式系统的经典知识。能不能解释为什么？
3. **恢复方式**：断点续传 vs 从头来——和检查点模式的结合。

### ❌ 常见错误回答

- **"失败就重试 3 次"**：不区分错误类型，永久错误也重试。
- **固定间隔**：不理解指数退避和抖动的意义。
- **重试从头来**：不利用检查点，浪费计算。

### ✅ 推荐回答

> 重试四维度：错误类型（瞬时重试永久不重试——429/5xx 重试，400/401 不重试，Worker 抛 TransientError/PermanentError 区分，永久错误 job.discard() 不重试）、次数（3 次可配置）、退避（指数退避 5s/10s/20s + 抖动防重试风暴——1000 任务同时重试会打爆恢复中的服务）、恢复方式（默认断点续传——加载 stepResults 跳过已完成步骤，可选从头来——用户改了输入或修了 Bug）。指数增长而非固定间隔给服务端更多恢复时间。抖动防止所有任务在同一时刻重试。

### 📚 延伸知识

- **Exponential Backoff with Jitter**：AWS 推荐的重试策略。参考 AWS Architecture Blog 的 "Exponential Backoff and Jitter" 一文。抖动有三种模式：Full Jitter、Equal Jitter、Decorrelated Jitter。
- **Circuit Breaker**：当连续失败超过阈值，"熔断"——停止重试一段时间。防止持续打一个已经挂掉的服务。我们的 AI Platform 对 Provider 做了熔断（第五章详述）。

---

## Q8. 如何保证幂等？

**🎤 面试官**

> 你前面多次提到"幂等"，说重试可能导致同一任务被执行多次。到底怎么保证幂等？

**🙋 候选人回答**

先明确什么是幂等：**同一个操作执行一次和执行多次，效果相同。** 在任务系统里，幂等意味着"同一个任务即使被重试/重复执行，也不会产生副作用"。

**非幂等的危害场景：**

```
用户点"生成漫剧"
  → 创建任务 task-123
  → Worker 执行到一半，网络超时
  → BullMQ 重试，task-123 被再次执行
  → 但第一次执行其实成功了（只是响应没到）
  → 结果：生成了两份漫剧，浪费资源 + 数据混乱
```

**幂等的核心：用唯一 ID 标识操作，执行前检查是否已执行。**

```typescript
async function executeTask(job: Job) {
  const taskId = job.id;  // BullMQ 的 job.id 是唯一的
  
  // ① 执行前检查：是否已有结果？
  const existing = await redis.get(`task:executed:${taskId}`);
  if (existing) {
    logger.info('task.already_executed', { taskId });
    return JSON.parse(existing);  // 返回已有结果，不重复执行
  }
  
  // ② 设置"处理中"标记（防并发）
  const acquired = await redis.set(
    `task:executing:${taskId}`, 
    '1', 
    'NX',        // 只在不存在时设置
    'EX', 600    // 10 分钟过期（防永久锁）
  );
  
  if (!acquired) {
    // 另一个 Worker 正在执行
    throw new TransientError('Task is being executed by another worker');
  }
  
  try {
    // ③ 执行任务
    const result = await doWork(job.data);
    
    // ④ 保存结果，标记已执行
    await redis.set(
      `task:executed:${taskId}`, 
      JSON.stringify(result), 
      'EX', 86400  // 24 小时过期
    );
    
    return result;
  } finally {
    // ⑤ 清除"处理中"标记
    await redis.del(`task:executing:${taskId}`);
  }
}
```

**这个模式叫"去重+锁"：**

1. **去重**：`task:executed:{id}` 标记任务已执行，重试时直接返回已有结果。
2. **锁**：`task:executing:{id}` 用 `SET NX` 保证同一时刻只有一个 Worker 执行。

---

**🎤 面试官追问**

> 你用 Redis 的 SET NX 做锁，但如果 Worker 设置锁后崩溃了，锁不会释放怎么办？你设了 10 分钟过期，那这 10 分钟内任务不能被重试？

**🙋 候选人回答**

**这是分布式锁的经典问题。我们的处理：**

**① 锁过期是兜底，不是常规路径**

正常情况下，Worker 在 `finally` 里删除锁。只有 Worker 崩溃（OOM、进程被 kill）才会走到"锁过期"这个兜底路径。10 分钟过期是为了"最坏情况下 10 分钟后锁自动释放，任务可以重试"。

**② 过期时间要大于任务最大执行时间**

如果任务最多跑 5 分钟，锁设 10 分钟过期是安全的。如果锁设 3 分钟过期但任务跑了 5 分钟——锁提前释放，另一个 Worker 拿到锁开始执行，两个 Worker 同时跑。所以过期时间 > 任务最大执行时间。

**③ 更好的方案：锁续约（Lock Renewal / Watchdog）**

Redisson（Java Redis 客户端）有看门狗机制——锁快过期时自动续期。我们用 Node 没有现成的 Redisson，但可以自己实现：

```typescript
async function acquireLockWithRenewal(key: string, ttl: number) {
  const lockId = crypto.randomUUID();
  const acquired = await redis.set(key, lockId, 'NX', 'EX', ttl / 1000);
  
  if (!acquired) return null;
  
  // 启动续约定时器
  const renewalTimer = setInterval(async () => {
    // 用 Lua 脚本保证"检查 lockId + 续期"是原子的
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then 
         return redis.call('expire', KEYS[1], ARGV[2]) 
       else 
         return 0 
       end`,
      1, key, lockId, ttl / 2000  // 续一半时间
    );
  }, ttl / 3);  // 每 1/3 TTL 续一次
  
  return {
    release: async () => {
      clearInterval(renewalTimer);
      // 用 Lua 脚本保证"检查 lockId + 删除"是原子的（防误删别人的锁）
      await redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then 
           return redis.call('del', KEYS[1]) 
         else 
           return 0 
         end`,
        1, key, lockId
      );
    }
  };
}
```

**两个关键细节：**

1. **lockId（UUID）**：释放锁时检查 lockId，确保"只能释放自己的锁"。场景：Worker A 的锁过期了，Worker B 拿到了锁。Worker A 恢复后不能删 Worker B 的锁——所以删除前检查 lockId。
2. **Lua 脚本保证原子性**："检查 lockId + 操作"必须是原子的，否则有竞态条件。Redis 的 Lua 脚本在单线程内原子执行。

**但说实话，我们的实际实现没有做锁续约**——因为任务的步骤级检查点已经保证了幂等（即使两个 Worker 同时执行，步骤结果已存在就跳过）。锁是额外的防护，不是唯一保障。用简单的 SET NX + 过期兜底够用。

**这是一个"够用 vs 完美"的权衡**：锁续约更完美但实现复杂，步骤级检查点已经够用所以不追求锁的完美。

---

**🎤 面试官继续追问**

> 你说步骤级检查点也保证幂等，但检查点只防"步骤重复执行"。如果步骤的副作用是"往数据库写一条记录"，重试时检查点跳过了这个步骤，但数据库里已经写了——这算幂等吗？

**🙋 候选人回答**

**好问题。步骤级检查点保证的是"不重复执行步骤"，但步骤内部的副作用需要步骤自己保证幂等。**

两层幂等：

**① 任务级幂等**（平台保证）：同一任务不重复执行已完成的步骤。
**② 步骤级幂等**（业务逻辑保证）：步骤内部的副作用（写 DB、调 API）是幂等的。

举例：步骤"创建漫剧记录"往数据库 INSERT 一条记录。

```typescript
// 非幂等：重试会插入两条
async function createDrama(data) {
  await prisma.drama.create({ data });
}

// 幂等：用唯一键约束，重试不会插两条
async function createDrama(data) {
  await prisma.drama.upsert({
    where: { taskId: data.taskId },  // 用 taskId 作为唯一键
    create: data,
    update: data,  // 已存在则更新（或不变）
  });
}
```

**数据库的唯一约束是幂等的最后防线**。即使代码有 Bug 没做幂等，数据库的唯一约束也会阻止重复插入。

**对于调外部 API 的幂等**：

```typescript
// 调 AI API 时传 Idempotency-Key
await request.post('https://api.openai.com/v1/chat/completions', {
  headers: {
    'Idempotency-Key': taskId,  // 用任务 ID 作为幂等键
  },
  body: { /* ... */ },
});
```

OpenAI 等 API 支持 Idempotency-Key——相同 key 的请求返回相同结果，不重复计费。

**所以幂等是分层的**：

| 层 | 保证机制 | 负责方 |
|----|---------|--------|
| 任务级 | 检查点 + 分布式锁 | Task Platform |
| 步骤级 | upsert + 唯一约束 + 幂等键 | 业务代码 |
| 外部调用 | Idempotency-Key | API 提供方 |

**平台只保证任务级幂等，步骤级幂等是业务方的责任。** 但平台可以提供指引——在文档里说明"你的步骤代码必须是幂等的，建议用 upsert 和唯一约束"。

### 🏗 架构分析

**幂等的三层保障**

| 层 | 机制 | 场景 |
|----|------|------|
| 任务级 | Redis 去重 + SET NX 锁 | 防同一任务被多个 Worker 执行 |
| 步骤级 | 检查点（stepResults） | 防已完成的步骤重复执行 |
| 业务级 | upsert + 唯一约束 + 幂等键 | 防步骤内部的副作用重复 |

**分布式锁的细节**：SET NX + 过期兜底 + lockId 防误删 + Lua 脚本原子性。锁续约是完美方案但复杂，步骤级检查点够用时可选不做。

### 🎯 面试官真正考察什么

1. **幂等的概念**：能不能说清楚"执行一次和多次效果相同"？
2. **分层幂等**：任务级/步骤级/业务级——平台不包揽所有层，业务级是业务方的责任。
3. **分布式锁的细节**：SET NX、过期、lockId、Lua 脚本——这些是 Redis 分布式锁的标准知识。

### ❌ 常见错误回答

- **"重试时检查状态"**：只检查状态不够，可能有竞态（两个 Worker 同时检查都发现没执行）。
- **没有 lockId**：释放锁时不检查，可能删别人的锁。
- **业务级不管**：以为平台保证幂等就够了，步骤内部不幂等。

### ✅ 推荐回答

> 幂等三层：任务级（Redis 去重 task:executed:{id} + SET NX 锁 task:executing:{id} 防并发，执行前检查已有结果有则返回不重复执行）、步骤级（检查点 stepResults 跳过已完成步骤）、业务级（upsert + 唯一约束 + Idempotency-Key——业务方责任）。分布式锁细节：SET NX EX 获取、lockId(UUID) 防误删别人的锁、Lua 脚本保证"检查+删除"原子性、过期时间是兜底（>任务最大执行时间）。锁续约（Watchdog）是完美方案但复杂，步骤级检查点已够用所以可选不做。过期时间 > 最大执行时间防两个 Worker 同时执行。平台只保证任务级幂等，文档指引业务方做步骤级幂等（upsert/唯一约束）。

### 📚 延伸知识

- **Redis 分布式锁 (Redlock)**：Antirez 提出的多节点分布式锁算法。争议较多（Martin Kleppmann 质疑其安全性）。单节点 SET NX + 过期对大多数场景够用。
- **Idempotency-Key**：HTTP 标准草案。Stripe、OpenAI 等 API 支持。服务端缓存 key→response 的映射，相同 key 返回缓存结果。
- **多 Worker 去重三层保障**：多个 Worker 实例不重复执行同一任务靠纵深防御——① BullMQ BRPOPLPUSH 原子领取（一个任务只被一个 Worker 取到）；② Redis 分布式锁 SET NX（task:executing:{id}）；③ 步骤级检查点（stepResults 已存在则跳过）。即使前两层失效，第三层兜底。注意 Fencing Token 问题——持锁者 GC 暂停导致锁过期后被别人拿走，解法是单调递增的 fencing token。

---

## Q9. 如何保证可靠性？

**🎤 面试官**

> 你讲了重试、幂等、检查点。但这些都是"任务执行中"的可靠性。如果 Redis 本身挂了呢？任务数据不是全丢了吗？

**🙋 候选人回答**

**这是最关键的问题。Redis 是 BullMQ 的存储层，Redis 挂了任务数据确实会受影响。**

我们的可靠性策略分三层：

**① Redis 高可用**

Redis 不能是单点的。我们用 **Redis 主从 + Sentinel（哨兵）**：

```
Redis Master (读写)
  ↓ 同步
Redis Slave (只读备份)
  ↑
Sentinel × 3 (监控 + 自动故障转移)
  → Master 挂了 → 选举 Slave 为新 Master → 自动切换
```

Sentinel 集群（3 个节点）持续监控 Master。Master 挂了，Sentinel 选举一个 Slave 升级为新 Master，BullMQ 客户端自动连接新 Master。

**主从同步的局限**：Redis 的主从同步是异步的——Master 写入后立即返回，不等 Slave 确认。如果 Master 写入后立即挂了（还没同步到 Slave），这条数据丢失。

**这个风险我们用"数据库双写"兜底**（见下面②）。

**② 数据库双写——状态持久化**

任务状态不只存 Redis，还同步到 PostgreSQL：

```
任务状态变更：
  ① Redis（BullMQ 管理，用于队列调度）  ← 快但可能丢
  ② PostgreSQL（持久化，用于状态查询和恢复）  ← 慢但可靠
```

```typescript
async function updateTaskStatus(taskId: string, status: TaskStatus) {
  // 先写 PG（持久化优先）
  await prisma.task.update({
    where: { id: taskId },
    data: { status, updatedAt: new Date() },
  });
  
  // BullMQ 的状态由它自己管（Redis）
  // 这里只同步业务层面的状态到 PG
}
```

**Redis 挂了怎么办？**

1. Sentinel 自动切换到 Slave，BullMQ 连接新 Master，大部分任务恢复。
2. 极端情况（主从都挂了），Redis 的队列数据丢失。但**任务状态在 PG 里**——我们知道哪些任务是 RUNNING/PENDING。
3. **恢复脚本**扫描 PG 中所有 RUNNING/PENDING 的任务，重新投到 BullMQ 队列：

```typescript
async function recoverTasks() {
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['RUNNING', 'PENDING'] } },
  });
  
  for (const task of tasks) {
    await queue.add('tasks', { taskId: task.id }, { jobId: task.id });
    logger.info('task.recovered', { taskId: task.id });
  }
}
```

**这就是为什么状态必须同步到 PG**——Redis 是"快存储"，PG 是"真持久化"。Redis 挂了可以用 PG 恢复。

---

**🎤 面试官追问**

> 你说恢复脚本重新投递 RUNNING 的任务，但这些任务可能已经执行了一部分。重新投递后从头来还是断点续传？

**🙋 候选人回答**

**断点续传——因为步骤结果存在 PG 里。**

恢复时任务的 stepResults 还在（存在 PG 的 JSONB 字段）。重新投到 BullMQ 后，Worker 执行时加载 stepResults，跳过已完成步骤：

```typescript
async function executeTask(job: Job) {
  const task = await prisma.task.findUnique({ where: { id: job.id } });
  
  // 加载已有步骤结果
  const steps = task.stepResults || {};
  
  // 跳过已完成的步骤
  if (!steps.script_split) {
    steps.script_split = await splitScript(task.input);
    await prisma.task.update({
      where: { id: job.id },
      data: { stepResults: steps },
    });
  }
  
  // ... 后续步骤同理
}
```

**但有一个微妙问题**：原来执行这个任务的 Worker 可能还在跑（它没挂，只是 Redis 挂了导致 BullMQ 认为它 stalled）。恢复脚本重新投递后，可能两个 Worker 同时执行同一任务。

**这就是 Q8 的幂等设计兜底**——`task:executing:{id}` 锁保证同一时刻只有一个 Worker 执行。即使恢复脚本重复投递，只有一个 Worker 能拿到锁。

**恢复策略的完整流程：**

```
Redis 挂了
  → Sentinel 切换到 Slave（大部分任务恢复）
  → 如果主从都挂了：
    → 等待 Redis 恢复
    → 运行恢复脚本
    → 扫描 PG 中 RUNNING/PENDING 任务
    → 重新投到 BullMQ
    → Worker 断点续传执行
    → 幂等锁防并发
```

---

**🎤 面试官继续追问**

> 恢复脚本扫描 PG 重新投递，但如果任务已经超时了呢？比如一个任务最大执行时间 30 分钟，Redis 挂了 1 小时才恢复。这个任务应该重试还是直接失败？

**🙋 候选人回答**

**超时检查 + 分级处理。**

恢复脚本不只是重新投递，还要检查每个任务是否已经超时：

```typescript
async function recoverTasks() {
  const tasks = await prisma.task.findMany({
    where: { status: { in: ['RUNNING', 'PENDING'] } },
  });
  
  for (const task of tasks) {
    const elapsed = Date.now() - task.startedAt.getTime();
    const maxTimeout = task.maxTimeout || 1800000;  // 默认 30 分钟
    
    if (elapsed > maxTimeout) {
      // 超时了，标记 TIMEOUT
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'TIMEOUT', error: 'Redis recovery: task exceeded max timeout' },
      });
      logger.warn('task.recovery_timeout', { taskId: task.id, elapsed });
      
      // 通知前端
      redis.publish(`task:${task.id}`, JSON.stringify({
        taskId: task.id, status: 'TIMEOUT',
      }));
    } else {
      // 未超时，重新投递
      await queue.add('tasks', { taskId: task.id }, { jobId: task.id });
      logger.info('task.recovered', { taskId: task.id });
    }
  }
}
```

**分级处理：**

| 情况 | 处理 |
|------|------|
| 未超时 + 有步骤结果 | 断点续传重新投递 |
| 未超时 + 无步骤结果 | 从头重新投递 |
| 已超时 | 标记 TIMEOUT，不重新投递 |
| 已超时但可恢复 | 用户手动点"重试" |

**"已超时但可恢复"** 是指任务虽然超过了 maxTimeout，但步骤结果还在，用户可以选择从断点继续。系统不自动重试（因为已经超时了，可能有数据一致性问题），但给用户手动重试的选项。

### 🏗 架构分析

**可靠性三层保障**

| 层 | 机制 | 防什么 |
|----|------|--------|
| Redis 高可用 | 主从 + Sentinel | 单点故障 |
| PG 双写 | 状态同步到 PostgreSQL | Redis 数据丢失 |
| 恢复脚本 | 扫描 PG 重新投递 | 大规模故障后恢复 |

**恢复策略**：未超时断点续传、已超时标记 TIMEOUT、幂等锁防并发。

**核心原则**：Redis 是"快存储"不是"真持久化"。状态必须同步到 PG 才算可靠。

### 🎯 面试官真正考察什么

1. **Redis 挂了的应对**：不是"不会挂"而是"挂了怎么恢复"。高可用 + PG 兜底 + 恢复脚本三层。
2. **数据持久化分层**：Redis（快但可能丢）+ PG（慢但可靠）。状态同步到 PG 是关键。
3. **恢复的细节**：超时检查、断点续传、幂等防并发——恢复不是简单重投。

### ❌ 常见错误回答

- **"Redis 不会挂"**：不现实，任何系统都可能挂。
- **"Redis 挂了任务就丢了"**：没有兜底方案。
- **恢复不检查超时**：超时任务也重投，可能导致数据不一致。

### ✅ 推荐回答

> Redis 挂了三层保障：① Redis 主从+Sentinel 高可用（Master 挂了自动切 Slave，BullMQ 自动连新 Master）；② PG 双写——任务状态不只存 Redis 还同步 PostgreSQL，Redis 是快存储 PG 是真持久化；③ 恢复脚本——Redis 恢复后扫描 PG 中 RUNNING/PENDING 任务重新投到 BullMQ。主从同步是异步的可能丢数据，PG 兜底。恢复时断点续传（stepResults 在 PG 里，跳过已完成步骤）。幂等锁防两个 Worker 同时执行（原 Worker 可能没挂只是 Redis 挂了导致 stalled）。超时检查：超过 maxTimeout 的任务标记 TIMEOUT 不重投，未超时的重新投递。Redis 是快存储不是真持久化，状态必须同步 PG 才可靠。

### 📚 延伸知识

- **Redis Sentinel vs Cluster**：Sentinel 是主从+自动故障转移（一主多从）。Cluster 是分片+高可用（多主多从，数据分散）。BullMQ 对 Sentinel 支持好，对 Cluster 需要特殊处理（任务不能跨分片）。
- **Redis Persistence (RDB/AOF)**：RDB 是快照（定期全量备份），AOF 是日志（每次写操作记录）。两者可以组合使用。但持久化是"最后防线"，不如应用层的 PG 双写可靠。

---

## Q10. 日志如何设计？

**🎤 面试官**

> 任务执行过程中会产生大量日志。你们的日志系统怎么设计？怎么保证日志和任务可关联？

**🙋 候选人回答**

**日志设计的核心原则：结构化 + 可关联 + 分级。**

**① 结构化日志**

所有任务日志用统一格式，JSON 输出：

```typescript
logger.info('task.step_completed', {
  taskId: 'abc-123',
  step: 'image_gen',
  duration: 12500,        // 步骤耗时
  imageCount: 5,
  provider: 'openai',
});
```

输出：
```json
{
  "level": "info",
  "event": "task.step_completed",
  "taskId": "abc-123",
  "step": "image_gen",
  "duration": 12500,
  "imageCount": 5,
  "provider": "openai",
  "timestamp": "2026-07-11T10:30:00.000Z",
  "requestId": "req-456",    // 来自 AsyncLocalStorage
  "workerId": "worker-01"    // Worker 标识
}
```

**每个日志必须带 taskId**——这是日志和任务关联的基础。没有 taskId 的日志在任务排查时毫无价值。

**② 日志分级**

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| debug | 开发调试，生产不开 | "收到任务参数：{...}" |
| info | 正常流程节点 | "步骤完成"、"任务开始" |
| warn | 异常但可继续 | "AI 调用慢（>10s）"、"重试第 2 次" |
| error | 失败但系统可继续 | "步骤失败"、"任务超时" |
| fatal | 系统级故障 | "Worker 无法连接 Redis" |

**关键：error 不等于"任务失败"。** 任务失败是业务事件（用 info 记录"task.failed"），error 是系统异常。区分两者避免 error 日志泛滥。

**③ 日志存储和查询**

```
日志流：
  Worker 输出 JSON 日志 → stdout
    → Filebeat 采集 → Elasticsearch 存储
    → Kibana 查询（按 taskId 过滤）
```

在 Kibana 里搜 `taskId: "abc-123"` 可以看到一个任务从头到尾的所有日志——创建、入队、Worker 领取、每步执行、完成/失败。这就是"日志和任务可关联"的价值。

---

**🎤 面试官追问**

> 你说每个日志带 taskId，但任务执行过程中会调 AI API、查数据库、推 WebSocket。这些子操作的日志怎么也带上 taskId？

**🙋 候选人回答**

**用 AsyncLocalStorage 自动传播 taskId。**

在第三章 Q7 讲过 AsyncLocalStorage 的原理。在 Task Platform 里，Worker 领取任务后把 taskId 存入 ALS，后续所有日志自动带上：

```typescript
new Worker('tasks', async (job) => {
  // 把 taskId 存入异步上下文
  als.run(new Map(), () => {
    als.getStore()!.set('taskId', job.id);
    als.getStore()!.set('workerId', process.env.WORKER_ID);
    
    return executeTask(job);  // 内部所有 logger 调用自动带 taskId
  });
});

// executeTask 内部调任何东西，taskId 自动传播
async function executeTask(job: Job) {
  logger.info('task.started');  // 自动带 taskId
  
  const script = await splitScript(job.data.input);
  // splitScript 内部的 logger 也自动带 taskId
  
  const images = await generateImages(script);
  // generateImages 内部调 AI Platform，AI Platform 的日志也带 taskId
  // 因为 AI Platform 用同一个 ALS
}
```

**关键：ALS 在异步调用链中自动传播，不需要手动传 taskId。** 即使是跨函数、跨模块调用，只要在同一个异步链里，ALS 的值就能取到。

**但跨服务调用怎么办？** 比如 Worker 调 AI Platform 的 HTTP API，AI Platform 是独立服务，ALS 不跨进程。

**用 HTTP Header 传播：**

```typescript
// Worker 调 AI Platform 时，把 taskId 放入 Header
const response = await request.post('/ai/chat', {
  headers: {
    'X-Task-Id': als.getStore()?.get('taskId'),
    'X-Request-Id': als.getStore()?.get('requestId'),
  },
  body: { /* ... */ },
});

// AI Platform 收到请求，从 Header 取 taskId 存入自己的 ALS
app.use((req, res, next) => {
  als.run(new Map(), () => {
    als.getStore()!.set('taskId', req.headers['x-task-id']);
    als.getStore()!.set('requestId', req.headers['x-request-id']);
    next();
  });
});
```

**这就是"分布式上下文传播"**——taskId 通过 HTTP Header 在服务间传递，每个服务收到后存入自己的 ALS，日志自动带上。虽然 ALS 不跨进程，但通过 HTTP Header 手动传递实现了跨服务的日志关联。

---

**🎤 面试官继续追问**

> 如果任务执行过程中 AI 调用失败，日志里能看到完整的失败链路吗？比如"哪一步失败、调了哪个 API、返回了什么错误"？

**🙋 候选人回答**

**能，因为我们记录了完整的错误上下文。**

错误日志不只是"失败了"，而是包含完整的诊断信息：

```typescript
try {
  const result = await aiPlatform.chat({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
  });
} catch (error) {
  logger.error('task.ai_call_failed', {
    taskId: job.id,
    step: 'script_split',
    provider: 'openai',
    model: 'gpt-4',
    promptLength: prompt.length,
    errorType: error.constructor.name,
    errorMessage: error.message,
    statusCode: error.response?.status,
    responseBody: error.response?.data,   // API 返回的错误详情
    duration: error.duration,             // 调用耗时
    attempt: error.attempt,               // 第几次重试
    stack: error.stack,                   // 调用栈
  });
  
  throw error;  // 重新抛出，让 BullMQ 处理重试
}
```

**一条 error 日志包含**：哪个任务、哪一步、调了什么（provider+model）、为什么失败（errorType+message+statusCode）、API 返回了什么（responseBody）、花了多久（duration）、第几次重试（attempt）、调用栈（stack）。

**在 Kibana 里搜 taskId，能看到完整的失败链路：**

```
10:30:00  task.started          { taskId: "abc-123" }
10:30:01  task.step_started     { taskId: "abc-123", step: "script_split" }
10:30:01  ai.call_start         { taskId: "abc-123", provider: "openai", model: "gpt-4" }
10:30:15  task.ai_call_failed   { taskId: "abc-123", statusCode: 429, errorMessage: "Rate limited", attempt: 1 }
10:30:20  ai.call_start         { taskId: "abc-123", attempt: 2 }  // 重试
10:30:35  task.ai_call_failed   { taskId: "abc-123", statusCode: 429, attempt: 2 }
10:30:45  ai.call_start         { taskId: "abc-123", attempt: 3 }  // 最后一次重试
10:31:00  task.ai_call_failed   { taskId: "abc-123", statusCode: 429, attempt: 3 }
10:31:00  task.failed           { taskId: "abc-123", reason: "AI rate limit exceeded after 3 attempts" }
```

**从日志能看出**：任务在 script_split 步骤、调 OpenAI GPT-4、被 429 限流、重试 3 次都失败。不需要看代码就能定位问题。

### 🏗 架构分析

**日志系统设计**

| 原则 | 实现 |
|------|------|
| 结构化 | JSON 格式 + 标准字段 |
| 可关联 | taskId 贯穿所有日志 |
| 可传播 | AsyncLocalStorage（进程内）+ HTTP Header（跨服务）|
| 分级 | debug/info/warn/error/fatal，error≠任务失败 |
| 完整错误上下文 | step/provider/model/statusCode/responseBody/attempt/stack |

**日志流**：Worker stdout → Filebeat → Elasticsearch → Kibana（按 taskId 检索）

### 🎯 面试官真正考察什么

1. **结构化日志**：不是 console.log 字符串，是 JSON + 标准字段。
2. **上下文传播**：AsyncLocalStorage 进程内 + HTTP Header 跨服务——这是分布式追踪的基础。
3. **错误日志的完整性**：不只是"失败了"，是包含完整诊断信息的日志。

### ❌ 常见错误回答

- **"console.log"**：不结构化，无法检索。
- **日志不带 taskId**：无法关联任务。
- **error 等于失败**：error 泛滥，真正的系统异常被淹没。

### ✅ 推荐回答

> 日志三原则：结构化（JSON+标准字段 taskId/step/event/timestamp）、可关联（taskId 贯穿所有日志）、分级（error≠任务失败，任务失败用 info 记 task.failed）。taskId 传播用 AsyncLocalStorage——Worker 领取任务后存入 ALS，后续所有异步调用链自动带 taskId 不用手动传。跨服务用 HTTP Header 传播（X-Task-Id），接收方存入自己的 ALS。错误日志包含完整上下文：step/provider/model/statusCode/responseBody/duration/attempt/stack。日志流：Worker stdout→Filebeat→Elasticsearch→Kibana 按 taskId 检索。一条 error 日志能看出"哪个任务哪一步调了什么为什么失败第几次重试"。

### 📚 延伸知识

- **OpenTelemetry**：分布式追踪的标准。自动注入 trace context（W3C Trace Context），跨服务传播 traceId。比手动 HTTP Header 更标准化。
- **ELK Stack**：Elasticsearch（存储）+ Logstash/Filebeat（采集）+ Kibana（查询）。业界最常用的日志方案。替代方案：Loki（更轻量）、Datadog（SaaS）。

---

## Q11. Trace 如何设计？

**🎤 面试官**

> 你讲了日志，日志是离散的事件。Trace 是把离散事件串成链路。你们的 Trace 怎么设计？

**🙋 候选人回答**

**日志告诉你"发生了什么"，Trace 告诉你"链路长什么样"。**

一个任务的完整链路：

```
API 收到请求（创建任务）
  → BullMQ 入队
  → Node Worker 领取
    → 调 AI Platform（HTTP）
      → AI Platform 调 OpenAI（HTTP）
    → 调数据库（SQL）
    → 推 WebSocket（Redis Pub/Sub）
  → 任务完成
```

如果 AI 调用慢，日志只能看到"AI 调用花了 15 秒"。Trace 能看到这 15 秒在整个链路中的位置——是入口到出口 20 秒中的 15 秒，还是 2 秒中的 15 秒（不可能，但 Trace 能发现异常）。

**我们的 Trace 设计基于 OpenTelemetry：**

```
Trace（一次任务执行）
  ├── Span: API.createTask (2ms)
  ├── Span: BullMQ.enqueue (1ms)
  ├── Span: Worker.executeTask (18s)
  │   ├── Span: splitScript (3s)
  │   │   └── Span: AI.chat (2.8s)
  │   │       └── Span: OpenAI.HTTP (2.7s)
  │   ├── Span: generateImages (12s)
  │   │   └── Span: AI.generateImage × 5
  │   └── Span: DB.updateTask (50ms)
  └── Span: WebSocket.notify (5ms)
```

**每个 Span 包含**：
- 操作名（如 `AI.chat`）
- 开始/结束时间（算耗时）
- 属性（如 provider=openai, model=gpt-4）
- 父 Span（构成树形结构）
- SpanContext（traceId + spanId，跨服务传播用）

---

**🎤 面试官追问**

> OpenTelemetry 怎么集成到你们的 Node + Python 混合架构？Trace 怎么跨语言传播？

**🙋 候选人回答**

**用 W3C Trace Context 标准（HTTP Header `traceparent`）跨服务传播。**

**Node 侧（OpenTelemetry JS SDK）：**

```typescript
// 初始化 OpenTelemetry
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://otel-collector:4318/v1/traces',
  }),
  instrumentations: [
    new HttpInstrumentation(),    // 自动追踪 HTTP 调用
    new PgInstrumentation(),      // 自动追踪 PG 查询
    new RedisInstrumentation(),   // 自动追踪 Redis 操作
    new BullMQInstrumentation(),  // 自动追踪 BullMQ 任务
  ],
});

sdk.start();
```

**自动埋点**是 OpenTelemetry 的核心价值——你不需要手动给每个函数加 Span。HTTP/PG/Redis/BullMQ 的 Instrumentation 自动追踪这些操作，生成 Span。

**Node → Python 的 Trace 传播：**

Node 调 Python 的任务时，traceId 通过 Redis 队列的 payload 传播：

```typescript
// Node Bridge Worker 投递任务时，把 traceId 放入 payload
import { trace } from '@opentelemetry/api';

const span = trace.getSpan(context.active());
const traceId = span?.spanContext().traceId;

await redis.lpush('python:tasks', JSON.stringify({
  taskId: job.id,
  traceId,  // 传播 traceId
  payload: job.data.payload,
}));
```

```python
# Python Worker 收到任务后，恢复 Trace 上下文
from opentelemetry import trace
from opentelemetry.trace import SpanContext, TraceFlags

def execute_task(task):
    # 从 payload 恢复 traceId
    trace_id = task['traceId']
    span_id = generate_span_id()  # 新 spanId
    
    # 创建 SpanContext（继承 Node 侧的 traceId）
    ctx = SpanContext(
        trace_id=trace_id,
        span_id=span_id,
        is_remote=True,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    
    # 在这个 context 下执行，生成的 Span 都属于同一个 Trace
    with trace.use_context(Context(set_value("current-span", trace.get_span(ctx)))):
        with tracer.start_as_current_span("python.execute_task"):
            do_work(task)
```

**效果**：Node 侧的 Trace 和 Python 侧的 Span 在同一个 traceId 下，在 Jaeger/Tempo 里能看到完整的跨语言链路。

---

**🎤 面试官继续追问**

> OpenTelemetry 的自动埋点会追踪所有 HTTP/DB/Redis 操作。如果任务量大，Trace 数据会爆炸。你们怎么控制 Trace 的量和成本？

**🙋 候选人回答**

**用采样（Sampling）策略控制 Trace 量。**

不是每个任务都需要 Trace——如果一切正常，Trace 的价值不大。只有出问题时才需要看 Trace。

**我们的采样策略：**

| 策略 | 采样率 | 场景 |
|------|--------|------|
| 全量采样 | 100% | 开发/staging 环境 |
| 错误优先 | 失败任务 100% | 生产环境 |
| 随机采样 | 10% | 生产环境正常任务 |
| 慢查询优先 | >5秒的任务 100% | 生产环境 |

**OpenTelemetry 支持 Tail-based Sampling（尾部采样）**——在 Trace 完成后根据结果决定是否保留：

```python
# OpenTelemetry Collector 配置尾部采样
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: errors
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: slow
        type: latency
        latency: {threshold_ms: 5000}
      - name: random_10
        type: probabilistic
        probabilistic: {sampling_percentage: 10}
```

**Tail-based Sampling 的价值**：先收集所有 Span，等 Trace 完成后看结果——如果是错误或慢请求，保留；正常且快，按概率丢弃。这比 Head-based Sampling（在开始时就决定是否采样）更精准——Head-based 可能把一个后来失败的任务丢弃了。

**但 Tail-based Sampling 有成本**：需要在 Collector 里缓存完整的 Trace（等所有 Span 到齐），内存占用高。我们用专用的 OpenTelemetry Collector 处理，不放在应用服务器上。

### 🏗 架构分析

**Trace 系统架构**

```
应用（Node/Python）
  → OpenTelemetry SDK（自动埋点）
  → OTLP Exporter（HTTP/gRPC）
  → OpenTelemetry Collector
    → Tail-based Sampling（错误/慢/随机保留）
    → Jaeger / Tempo（存储+查询）
```

**跨语言 Trace 传播**：W3C Trace Context（`traceparent` Header）跨 HTTP，手动传播 traceId 跨 Redis 队列。

**采样策略**：Tail-based，错误 100%、慢请求 100%、正常随机 10%。

### 🎯 面试官真正考察什么

1. **Trace vs 日志的区别**：Trace 是链路视图，日志是离散事件。两者互补。
2. **跨语言 Trace 传播**：traceId 怎么从 Node 传到 Python？W3C Trace Context 标准。
3. **采样策略**：不是全量 Trace，按错误/慢/随机采样控制成本。Tail-based 比 Head-based 精准。

### ❌ 常见错误回答

- **"日志就够了"**：日志看不到链路全貌和耗时分布。
- **全量采样**：不考虑成本，Trace 数据爆炸。
- **不知道跨语言传播**：Node 和 Python 的 Trace 断开。

### ✅ 推荐回答

> 日志看"发生了什么"，Trace 看"链路长什么样"——一个任务的 API→BullMQ→Worker→AI→DB→WebSocket 完整 Span 树。基于 OpenTelemetry：自动埋点（HTTP/PG/Redis/BullMQ Instrumentation 自动生成 Span）、手动埋点（业务关键步骤如 splitScript/generateImages）。跨语言传播：Node→Python 通过 Redis payload 传 traceId，Python 恢复 SpanContext 继承同一 traceId。Node→AI Platform 用 W3C traceparent HTTP Header 自动传播。采样用 Tail-based：错误任务 100%、慢请求（>5s）100%、正常随机 10%——先收集所有 Span 等 Trace 完成后按结果决定保留，比 Head-based 精准（不会丢后来失败的任务）。Collector 缓存完整 Trace 内存占用高所以独立部署。

### 📚 延伸知识

- **W3C Trace Context**：标准的分布式追踪上下文格式。`traceparent: 00-{traceId}-{spanId}-{flags}`。所有支持 OpenTelemetry 的服务都能解析。
- **Jaeger vs Tempo**：Jaeger（CNCF 项目，UI 强）和 Tempo（Grafana 生态，和 Loki/Prometheus 集成好）是两大开源 Trace 后端。

---

## Q12. 死信队列怎么处理？

**🎤 面试官**

> 你在 Q1 提到 DEAD 状态和死信队列。死信队列里的任务最终怎么处理？总不能一直堆着吧。

**🙋 候选人回答**

**死信队列不是垃圾桶，是"待诊断区"。** 每个死信任务都要有人处理——要么修复后重跑，要么确认废弃后删除。

**处理流程：**

```
任务进入死信队列（DEAD）
  → 运维/开发收到告警
  → 查看死信任务详情（失败原因、步骤结果、日志）
  → 分类处理：
    ① 数据问题 → 修正数据 → 重新入队
    ② 代码 Bug → 修复 Bug → 批量重跑受影响任务
    ③ 外部依赖问题 → 等依赖恢复 → 重新入队
    ④ 不可恢复 → 标记废弃 → 归档
```

**① 死信任务的可观测性**

死信队列不能只是"一堆数据"，必须有 UI 可查看。我们用 Bull Board + 自定义面板：

```
死信队列面板：
┌──────────────────────────────────────────────────┐
│ DEAD 任务列表                                      │
├──────────────┬──────────┬──────────┬──────────────┤
│ Task ID      │ 类型     │ 失败原因  │ 死信时间      │
├──────────────┼──────────┼──────────┼──────────────┤
│ abc-123      │ 漫剧生成  │ AI 429   │ 2026-07-11   │
│ def-456      │ 视频合成  │ FFmpeg   │ 2026-07-11   │
│ ghi-789      │ 图片生成  │ 数据格式  │ 2026-07-10   │
└──────────────┴──────────┴──────────┴──────────────┘
```

**② 告警机制**

死信任务不能等人工发现。我们配了告警——死信队列长度超过阈值（如 10）时触发 Slack 告警：

```typescript
// 定时检查死信队列
setInterval(async () => {
  const deadCount = await queue.getFailedCount();
  if (deadCount > 10) {
    await slackAlert({
      channel: '#ops',
      message: `⚠️ 死信队列积压：${deadCount} 个任务`,
      actionUrl: 'https://bull-board.example.com/failed',
    });
  }
}, 60000);  // 每分钟检查
```

**③ 批量重跑**

如果是代码 Bug 修复后需要批量重跑，不能一个个手动点。我们做了批量操作：

```typescript
async function retryAllDeadTasks(filter?: { type?: string; since?: Date }) {
  const failedJobs = await queue.getFailed();
  
  for (const job of failedJobs) {
    // 按条件过滤
    if (filter?.type && job.data.type !== filter.type) continue;
    if (filter?.since && job.finishedOn! < filter.since.getTime()) continue;
    
    await job.retry();  // 重新入队
    logger.info('dead_task.retried', { taskId: job.id });
  }
}
```

---

**🎤 面试官追问**

> 你说死信任务要"有人处理"，但现实中开发团队很忙，死信任务可能堆了很久没人管。怎么避免死信队列变成"永久垃圾场"？

**🙋 候选人回答**

**这是真问题。死信队列需要"过期清理 + 定期 review"机制。**

**① 自动过期**

死信任务不能永久存。我们设了 30 天过期——30 天没处理的死信任务，自动归档到冷存储（S3）并从 Redis 删除：

```typescript
// 每天清理过期死信任务
async function cleanupOldDeadTasks() {
  const failedJobs = await queue.getFailed();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  
  for (const job of failedJobs) {
    if (job.finishedOn! < thirtyDaysAgo) {
      // 归档到 S3
      await archiveToS3(`dead-tasks/${job.id}.json`, job.toJSON());
      // 从 Redis 删除
      await job.remove();
      logger.info('dead_task.archived', { taskId: job.id });
    }
  }
}
```

**② 定期 Review**

每周的工程例会有一个固定议程："死信队列 Review"。看本周新增了哪些死信任务、原因是什么、是否需要修复。这不是"有空再看"，是固定议程——和 Review Bug 一样。

**③ 死信趋势监控**

如果某类任务频繁进死信队列，说明有系统性问题。我们统计死信任务的"类型分布"：

```
本周死信任务统计：
  AI 限流（429）：15 个 → 60%  ← 需要增加限流退避或换 Provider
  FFmpeg 崩溃：8 个 → 32%     ← 需要检查 FFmpeg 版本/资源限制
  数据格式错误：2 个 → 8%     → 个别数据问题，修数据
```

**60% 的死信是 AI 限流**——这不是个别任务的问题，是系统性的。说明我们的限流退避策略不够，或者该考虑加备用 Provider。死信队列的"趋势"比"单条"更有价值。

### 🏗 架构分析

**死信队列生命周期**

```
DEAD → 告警 → 诊断 → 处理（重跑/修复/归档）→ 过期清理（30天→S3）
```

**三个关键机制**：
1. 可观测性（Bull Board 面板 + 失败原因）
2. 告警（队列长度阈值触发 Slack）
3. 过期清理（30 天归档到 S3）

**趋势监控**：统计死信类型分布，发现系统性问题。

### 🎯 面试官真正考察什么

1. **死信不是终点**：死信队列是"待诊断区"，每个任务都要有处理路径。
2. **避免堆积**：过期清理 + 定期 Review——不能变成永久垃圾场。
3. **趋势分析**：从死信分布发现系统性问题，不只是处理单条。

### ❌ 常见错误回答

- **"死信就放着"**：没有处理流程，永久堆积。
- **没有告警**：等人工发现死信，可能已经堆了很多。
- **不看趋势**：只处理单条死信，不分析系统性原因。

### ✅ 推荐回答

> 死信队列是"待诊断区"不是垃圾桶。处理流程：告警→查看详情→分类处理（数据问题修数据重跑、代码 Bug 修复后批量重跑、依赖问题等恢复重跑、不可恢复标记废弃归档）。可观测性用 Bull Board 面板看失败原因+步骤结果。告警：队列长度>10 触发 Slack。批量重跑支持按类型/时间过滤。避免堆积：30 天过期自动归档 S3 并从 Redis 删除、每周例会固定 Review 死信、统计类型分布发现系统性问题（如 60% 是 AI 429 说明限流退避不够或该加备用 Provider）。死信的趋势比单条更有价值。

### 📚 延伸知识

- **BullMQ Failed Jobs**：BullMQ 的 `queue.getFailed()` 返回所有失败任务。`job.retry()` 重新入队。`job.remove()` 删除。
- **Error Budget**：SRE 的概念——如果死信率超过错误预算（如 1%），停止新功能开发，专注修复可靠性问题。

---

## Q13. 优先级和限流怎么设计？

**🎤 面试官**

> 有些任务可能比其他任务更重要——比如 VIP 用户的任务应该优先处理。你们怎么实现任务优先级？

**🙋 候选人回答**

**BullMQ 原生支持优先级**——通过 `priority` 选项：

```typescript
// 优先级数值越小，优先级越高
await queue.add('tasks', { type: 'drama_gen' }, { priority: 1 });   // 高优先级
await queue.add('tasks', { type: 'drama_gen' }, { priority: 10 });  // 中优先级
await queue.add('tasks', { type: 'drama_gen' }, { priority: 100 }); // 低优先级
```

BullMQ 底层用 Redis 的 Sorted Set 实现优先级——任务的 score 是优先级值，Worker 取任务时按 score 从小到大取（优先级高的先取）。

**我们的优先级模型：**

```
优先级 1-10：VIP 用户 / 付费用户 / 紧急任务
优先级 11-50：普通用户
优先级 51-100：批量任务 / 后台任务 / 免费用户
```

```typescript
function getTaskPriority(user: User, taskType: string): number {
  if (user.plan === 'vip') return 5;
  if (user.plan === 'pro') return 20;
  if (taskType === 'batch') return 80;
  return 50;  // 普通用户
}
```

**但优先级有一个陷阱：饥饿问题。**

如果高优先级任务不断涌入，低优先级任务永远排不上——被"饿死"。

**解决方案：优先级 + 公平队列（Fair Queue）。**

```
方案：分队列 + 轮询
  queue:vip   → [task1, task2]
  queue:pro   → [task3, task4, task5]
  queue:free  → [task6, task7, task8, task9, task10]
  
Worker 轮询：vip → pro → free → vip → pro → free → ...
```

但我们没有用这个方案——因为 BullMQ 的单队列优先级在我们的场景下够用。原因：我们的任务量不高（日几万），高优先级任务不会多到饿死低优先级。如果任务量增长到高优先级能持续占满 Worker，再考虑公平队列。

---

**🎤 面试官追问**

> 优先级解决了"谁先执行"的问题。但还有一个问题：任务执行速度。如果 AI API 有速率限制（如每分钟 60 次调用），你怎么控制 Worker 的执行速率不超限？

**🙋 候选人回答**

**用令牌桶（Token Bucket）限流。**

```
令牌桶模型：
  桶容量：60 个令牌（= 每分钟 60 次）
  补充速率：每秒补 1 个令牌（= 60/分钟）
  
Worker 调 AI 前：
  → 从桶里取一个令牌
  → 有令牌：执行
  → 无令牌：等待（直到有令牌）
```

**实现：**

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private capacity: number,    // 桶容量
    private refillRate: number,   // 每秒补充令牌数
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  
  async acquire(): Promise<void> {
    while (true) {
      // 补充令牌
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
      this.lastRefill = now;
      
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      
      // 令牌不够，等待
      const waitTime = (1 - this.tokens) / this.refillRate * 1000;
      await sleep(waitTime);
    }
  }
}

// 使用
const aiRateLimiter = new TokenBucket(60, 1);  // 60 容量，每秒补 1

async function callAI(params) {
  await aiRateLimiter.acquire();  // 等令牌
  return await openaiClient.chat(params);
}
```

**多 Worker 共享限流**——令牌桶存 Redis 而非内存：

```typescript
// Redis 令牌桶（Lua 脚本保证原子性）
const ACQUIRE_TOKEN = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  
  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1]) or capacity
  local last_refill = tonumber(bucket[2]) or now
  
  -- 补充令牌
  local elapsed = now - last_refill
  tokens = math.min(capacity, tokens + elapsed * refill_rate / 1000)
  
  if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, 3600)
    return 1  -- 获取成功
  else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    return 0  -- 获取失败
  end
`;

async function acquireToken(): Promise<boolean> {
  const result = await redis.eval(ACQUIRE_TOKEN, 1, 'rate_limit:ai', 60, 1, Date.now());
  return result === 1;
}
```

**为什么要存 Redis？** 因为多个 Worker 实例共享同一个速率限制。如果每个 Worker 各自在内存里限流，3 个 Worker × 60/分钟 = 180/分钟，超了 API 限制。Redis 令牌桶保证全局限流。

---

**🎤 面试官继续追问**

> 如果令牌用完了，Worker 等待令牌期间占不占资源？会不会影响其他任务？

**🙋 候选人回答**

**会占资源，所以要正确处理"限流等待"。**

**错误做法**：Worker 阻塞等令牌，占住 concurrency 名额：

```typescript
// 错误：Worker 阻塞等待，占住并发槽位
async function workerProcess(job) {
  await aiRateLimiter.acquire();  // 可能等 30 秒
  await callAI(job.data);
  // 这 30 秒里，这个并发槽位被占用，其他任务进不来
}
```

**正确做法**：限流等待时不占 Worker 并发槽位。两种方案：

**方案 A：快速失败 + 延迟重试**

令牌不够时，不等待，直接把任务延迟重新入队：

```typescript
async function workerProcess(job) {
  const hasToken = await acquireToken();
  
  if (!hasToken) {
    // 没令牌，延迟 5 秒后重试（不占 Worker 槽位）
    await job.moveToDelayed(Date.now() + 5000);
    return;  // Worker 释放，可以处理其他任务
  }
  
  await callAI(job.data);
}
```

**方案 B：前置限流队列**

在 Worker 之前加一个"限流层"——只有拿到令牌的任务才进入 Worker 队列：

```
任务 → 限流层（拿令牌）→ Worker 队列 → Worker 执行
```

没有令牌的任务在限流层排队（不占 Worker），拿到令牌才进入 Worker 队列。

**我们用方案 A**，因为它简单且 BullMQ 原生支持延迟任务（`moveToDelayed`）。方案 B 更优雅但实现复杂，当前规模不需要。

**关键认知：限流不只是"控制速率"，还要考虑"等待时不占资源"。** 阻塞等待的限流器会让 Worker 变成"等令牌的机器"，吞吐量骤降。

### 🏗 架构分析

**优先级 + 限流**

| 机制 | 实现 | 场景 |
|------|------|------|
| 优先级 | BullMQ priority（Sorted Set） | VIP 用户优先 |
| 限流 | Redis 令牌桶（Lua 原子操作） | AI API 速率限制 |
| 限流等待 | moveToDelayed 延迟重试 | 不占 Worker 槽位 |

**关键设计**：多 Worker 共享 Redis 令牌桶（全局限流）；限流等待时释放 Worker（不阻塞并发）。

### 🎯 面试官真正考察什么

1. **优先级实现**：BullMQ 原生支持，底层是 Sorted Set。知不知道饥饿问题？
2. **限流算法**：令牌桶——Redis 实现 + Lua 原子性 + 多 Worker 共享。
3. **限流等待的处理**：不阻塞 Worker，用延迟重试释放槽位。这是进阶认知。

### ❌ 常见错误回答

- **"优先级就是排序"**：不考虑饥饿问题。
- **内存限流**：多 Worker 各自限流，全局超限。
- **阻塞等待**：Worker 卡在等令牌，吞吐量骤降。

### ✅ 推荐回答

> 优先级用 BullMQ 原生 priority 选项（数值越小越优先，底层 Redis Sorted Set）。模型：VIP 1-10、普通 11-50、批量 51-100。饥饿问题（高优先级任务不断涌入低优先级饿死）可通过公平队列解决，但我们任务量不高暂不需要。限流用 Redis 令牌桶：桶容量 60（=每分钟 60 次）每秒补 1 个，调 AI 前取令牌。存 Redis 不存内存因为多 Worker 共享全局限流（否则 3 Worker×60=180 超限）。Lua 脚本保证补充+扣减原子性。限流等待时不阻塞 Worker——令牌不够用 job.moveToDelayed 延迟 5 秒重入队，Worker 释放处理其他任务。关键：限流不只控制速率，还要保证等待时不占资源。

### 📚 延伸知识

- **Token Bucket vs Leaky Bucket**：令牌桶（允许突发——桶满时可以连续取多个令牌）vs 漏桶（匀速流出，不允许突发）。API 限流通常用令牌桶。
- **Fair Queue**：防止低优先级饥饿的算法。参考 Kafka 的 Fair Scheduler 或 YARN 的 Fair Scheduler。

---

## Q14. 延迟任务怎么实现？

**🎤 面试官**

> 有些任务不是立即执行的——比如"30 分钟后检查 AI 生成结果"。这种延迟任务怎么实现？

**🙋 候选人回答**

**BullMQ 原生支持延迟任务：**

```typescript
// 延迟 30 分钟执行
await queue.add('tasks', { type: 'check_result' }, {
  delay: 30 * 60 * 1000,  // 30 分钟
});

// 指定执行时间
await queue.add('tasks', { type: 'check_result' }, {
  delay: new Date('2026-07-11T15:00:00').getTime() - Date.now(),
});
```

**BullMQ 底层用 Redis 的 Sorted Set 实现延迟**：

```
延迟队列（Sorted Set）：
  score = 应该执行的时间戳
  member = 任务 ID

  { taskId1: 1720692000000, taskId2: 1720692900000 }

Worker 定期轮询：
  ZRANGEBYSCORE delay_queue 0 now  → 取出 score <= 当前时间的任务
  → 移到执行队列
```

**BullMQ 的 Event Polling**：BullMQ 用一个定时器（默认每 5 秒）检查延迟队列，把到期的任务移到执行队列。这意味着延迟任务的执行精度是 5 秒级别——不是精确到毫秒。

**对我们的场景够用**——"30 分钟后检查"不需要精确到秒。如果需要秒级精度，需要调 BullMQ 的 `stalledInterval` 或用专门的延迟队列方案。

---

**🎤 面试官追问**

> 5 秒精度对大部分场景够用，但有没有场景需要更高精度的延迟？比如"60 秒后发通知"——如果实际 65 秒才发，用户体验不好。

**🙋 候选人回答**

**有这种场景。高精度延迟我们用 Redis 的 Keyspace Notifications（键空间通知）。**

```typescript
// 设置一个带过期的 key，过期时触发通知
await redis.set(`notify:${taskId}`, '1', 'EX', 60);  // 60 秒过期

// 监听过期事件
redis.subscribe('__keyevent@0__:expired', (message) => {
  if (message.startsWith('notify:')) {
    const taskId = message.replace('notify:', '');
    // 触发通知
    sendNotification(taskId);
  }
});
```

**原理**：Redis 的 key 过期时发布一个事件。订阅这个事件就能在 key 过期时触发操作。

**精度**：Redis 的过期检查频率可配（`hz` 参数，默认 10 次/秒），精度可达 100ms 级别。

**但 Keyspace Notifications 有局限：**

1. **不保证可靠**：如果订阅者断连期间有 key 过期，事件丢失。不适合需要可靠投递的场景。
2. **Redis 负载**：大量延迟 key 会增加 Redis 内存和过期检查负载。

**所以我们的策略是**：

| 延迟场景 | 方案 | 精度 |
|----------|------|------|
| 大延迟（分钟级） | BullMQ delay | 5 秒 |
| 小延迟（秒级） | Redis Keyspace Notification | 100ms |
| 可靠延迟 | BullMQ delay + 前端轮询兜底 | 5 秒 |

**对于"必须可靠且精确"的场景**，我们用 BullMQ delay + 前端轮询兜底——即使 BullMQ 的延迟任务晚了几秒，前端也可以轮询发现"结果已经好了"提前展示。不依赖延迟任务的精确性。

---

**🎤 面试官继续追问**

> 除了 BullMQ delay，有没有考虑过其他延迟队列方案？比如 RabbitMQ 的 TTL + DLX、或者时间轮？

**🙋 候选人回答**

**考虑过，但都不如 BullMQ delay 适合我们。**

**RabbitMQ TTL + DLX**：

```
消息进队列 A（设 TTL 30 分钟）
  → 30 分钟没消费，过期
  → 进入死信交换机（DLX）
  → 路由到队列 B
  → Worker 消费队列 B（= 30 分钟后执行）
```

**问题**：RabbitMQ 的 TTL 是"队列头部消息过期"才触发——如果队列里有 10 条消息，第 1 条 30 分钟过期，但 RabbitMQ 只检查队列头部。如果第 1 条的 TTL 比第 2 条长，第 2 条过期了也不会被处理（被第 1 条"阻塞"）。这是 RabbitMQ 延迟队列的经典坑。

**而且我们已经在用 Redis（BullMQ），不想再加 RabbitMQ。** 多一个中间件多一份运维成本。

**时间轮（Hashed Wheel Timer）**：

```
一个轮子有 N 个槽，每秒转一格：
  slot 0: [task1]
  slot 1: []
  ...
  slot 30: [task2]  ← 30 秒后执行

每秒检查当前槽的任务，执行。
```

时间轮适合**大量短延迟任务**（如 Netty 的连接超时管理）。但我们的延迟任务不多（几十个），用时间轮是大材小用。且时间轮是进程内的——多 Worker 之间不共享。

**Kafka 的延迟**：Kafka 没有原生延迟队列。通常用"多主题 + 轮询"模拟，实现复杂。

**结论**：BullMQ delay（Redis Sorted Set）在我们的场景下是最简方案——复用 Redis、精度够用、实现简单。只有在 BullMQ delay 无法满足时（如需要毫秒级精度或海量延迟任务），才考虑其他方案。

### 🏗 架构分析

**延迟任务方案对比**

| 方案 | 精度 | 可靠性 | 复杂度 | 适用场景 |
|------|------|--------|--------|----------|
| BullMQ delay | 5 秒 | 高 | 低 | 分钟级延迟（我们用） |
| Redis Keyspace Notification | 100ms | 低 | 中 | 秒级延迟 |
| RabbitMQ TTL+DLX | 秒级 | 高 | 高 | 有 RabbitMQ 的场景 |
| 时间轮 | 毫秒 | 进程内 | 中 | 大量短延迟 |

**选 BullMQ delay 的原因**：复用 Redis、精度够用、实现简单。

### 🎯 面试官真正考察什么

1. **BullMQ delay 的原理**：Redis Sorted Set + score=时间戳 + 定期轮询。
2. **精度和可靠性的权衡**：5 秒精度够不够？不够怎么办？
3. **方案对比**：RabbitMQ/时间轮/Kafka——知不知道各自的优劣和坑？

### ❌ 常见错误回答

- **"setTimeout"**：进程内，重启就丢。
- **不知道精度**：以为 BullMQ delay 精确到毫秒。
- **RabbitMQ TTL 的坑**：不知道头部阻塞问题。

### ✅ 推荐回答

> BullMQ 原生支持延迟——底层 Redis Sorted Set，score=执行时间戳，BullMQ 每 5 秒轮询取出到期任务移到执行队列，精度 5 秒级。对我们的分钟级延迟够用。秒级精度用 Redis Keyspace Notifications（key 过期触发事件，精度 100ms）但不保证可靠（订阅断连丢事件）。可靠+精确用 BullMQ delay + 前端轮询兜底。不用 RabbitMQ TTL+DLX 因为有头部阻塞坑（第 1 条 TTL 长会阻塞后面的）且不想加中间件。不用时间轮因为延迟任务不多且是进程内的不共享。复用 Redis 是最大优势。

### 📚 延伸知识

- **Redis Keyspace Notifications**：需要配置 `notify-keyspace-events Ex`（E=过期事件，x=过期触发）。默认关闭，因为消耗 CPU。
- **时间轮算法**：Netty 的 HashedWheelTimer 是经典实现。Kafka 也有层级时间轮（多层时间轮处理不同精度的延迟）。

---

## Q15. 任务编排 DAG

**🎤 面试官**

> 你在第二章提到任务编排的升级方向是 DAG（有向无环图）。现在你们的编排能力是什么样的？怎么实现条件分支和并行汇合？

**🙋 候选人回答**

**当前我们的编排能力分两级：**

**① BullMQ 原生的 parent/child（简单依赖）**

BullMQ 支持"父任务等待子任务完成"：

```typescript
// 父任务等所有子任务完成才执行
await queue.add('parent', { type: 'compose_video' }, {
  parent: {
    id: parentId,
    queue: 'parentQueue',
  },
});

// 子任务
await queue.add('child', { type: 'generate_image' }, { parent });
```

但这只是"等待"——不支持条件分支、不支持部分失败处理。如果某个子任务失败，父任务直接失败，没有"失败走分支 C"的逻辑。

**② 自定义编排层（基于 stepResults）**

我们的大部分"编排"不是用 BullMQ 的 parent/child，而是在单个任务内部用步骤定义：

```typescript
async function executeTask(job: Job) {
  const steps = loadStepResults(job.id);
  
  // 串行步骤
  if (!steps.script) {
    steps.script = await splitScript(job.data.input);
    saveStepResult(job.id, 'script', steps.script);
  }
  
  // 并行步骤
  if (!steps.images || !steps.audio) {
    const [images, audio] = await Promise.all([
      steps.images ? null : generateImages(steps.script),
      steps.audio ? null : generateAudio(steps.script),
    ]);
    if (images) saveStepResult(job.id, 'images', images);
    if (audio) saveStepResult(job.id, 'audio', audio);
  }
  
  // 依赖前一步
  if (!steps.subtitle) {
    steps.subtitle = await generateSubtitle(steps.audio);
    saveStepResult(job.id, 'subtitle', steps.subtitle);
  }
  
  // 最终合成（依赖以上全部）
  if (!steps.video) {
    steps.video = await composeVideo(steps.images, steps.audio, steps.subtitle);
    saveStepResult(job.id, 'video', steps.video);
  }
}
```

**这本质上是一个硬编码的 DAG**——步骤之间的依赖关系写死在代码里。好处是简单直接，坏处是不够灵活——改流程要改代码。

---

**🎤 面试官追问**

> 硬编码的 DAG 不能动态调整。你们有没有考虑过把编排逻辑做成数据（配置化），让业务方自己定义任务流程？

**🙋 候选人回答**

**考虑过，这是 Q13（演进方向）里说的"DAG 引擎"。当前还没有做，但我有设计思路。**

**配置化的 DAG 定义：**

```json
{
  "name": "drama_production",
  "nodes": [
    {
      "id": "script_split",
      "type": "ai_call",
      "params": { "model": "gpt-4", "prompt": "..." }
    },
    {
      "id": "image_gen",
      "type": "ai_call",
      "depends_on": ["script_split"],
      "params": { "model": "dall-e-3" }
    },
    {
      "id": "audio_gen",
      "type": "tts",
      "depends_on": ["script_split"],
      "params": { "voice": "alloy" }
    },
    {
      "id": "subtitle_gen",
      "type": "align",
      "depends_on": ["audio_gen"]
    },
    {
      "id": "compose",
      "type": "ffmpeg",
      "depends_on": ["image_gen", "audio_gen", "subtitle_gen"]
    }
  ],
  "edges": [
    { "from": "script_split", "to": "image_gen" },
    { "from": "script_split", "to": "audio_gen" },
    { "from": "audio_gen", "to": "subtitle_gen" },
    { "from": "image_gen", "to": "compose" },
    { "from": "audio_gen", "to": "compose" },
    { "from": "subtitle_gen", "to": "compose" }
  ]
}
```

**DAG 执行引擎的核心逻辑：**

```typescript
class DAGExecutor {
  async execute(dag: DAG, input: any): Promise<any> {
    const results: Map<string, any> = new Map();
    const completed: Set<string> = new Set();
    
    while (completed.size < dag.nodes.length) {
      // 找到所有依赖已完成的节点
      const ready = dag.nodes.filter(node => 
        !completed.has(node.id) &&
        node.depends_on.every(dep => completed.has(dep))
      );
      
      // 并行执行就绪的节点
      const executions = ready.map(async node => {
        const inputs = node.depends_on.map(dep => results.get(dep));
        const result = await this.executeNode(node, inputs);
        results.set(node.id, result);
        completed.add(node.id);
      });
      
      await Promise.all(executions);
    }
    
    return results;
  }
  
  private async executeNode(node: Node, inputs: any[]): Promise<any> {
    switch (node.type) {
      case 'ai_call': return aiPlatform.chat(node.params, inputs);
      case 'tts': return ttsService.generate(node.params, inputs);
      case 'ffmpeg': return ffmpegService.compose(node.params, inputs);
      // ...
    }
  }
}
```

**拓扑排序保证执行顺序**——只有依赖全部完成的节点才执行。`image_gen` 和 `audio_gen` 都依赖 `script_split`，会并行执行。`compose` 依赖三者，等它们都完成才执行。

**但这个设计目前是"纸上的"——我们还没实现。** 因为当前的硬编码 DAG 够用（流程不多、变化不频繁）。如果业务流程开始多样化（不同类型的内容用不同流程），配置化 DAG 的 ROI 才会变高。

---

**🎤 面试官继续追问**

> 你这个 DAG 执行器有一个问题：如果某个节点失败，整个 DAG 怎么处理？是全部失败还是跳过失败节点继续？

**🙋 候选人回答**

**这取决于节点的"失败策略"。每个节点可以配置失败时的行为：**

```json
{
  "id": "image_gen",
  "type": "ai_call",
  "depends_on": ["script_split"],
  "on_failure": "retry",          // 失败策略
  "max_retries": 3,
  "fallback": "placeholder_image" // 重试耗尽后的降级
}
```

**失败策略：**

| 策略 | 行为 | 场景 |
|------|------|------|
| `retry` | 重试 N 次 | 瞬时错误 |
| `skip` | 跳过节点，下游用 fallback 值 | 非关键步骤 |
| `abort` | 整个 DAG 失败 | 关键步骤 |
| `fallback` | 用预设值替代 | 降级场景 |

```typescript
private async executeNode(node: Node, inputs: any[]): Promise<any> {
  try {
    return await this.executeWithRetry(node, inputs);
  } catch (e) {
    switch (node.on_failure) {
      case 'skip':
        return node.fallback;  // 用 fallback 值，下游继续
      case 'abort':
        throw new DAGFailedError(node.id, e);  // 整个 DAG 失败
      case 'fallback':
        return node.fallback;
      default:
        throw e;
    }
  }
}
```

**举例**：

- `image_gen` 失败 → 用占位图替代（skip + fallback），视频继续合成（有占位图）
- `script_split` 失败 → 整个 DAG 失败（abort），因为没有脚本后面什么都做不了
- `subtitle_gen` 失败 → 跳过字幕，生成无字幕视频（skip，无 fallback = 空）

**失败策略让 DAG 不是"全有或全无"**——非关键步骤失败不影响整体，关键步骤失败才中止。这是 DAG 引擎成熟度的标志。

**条件分支怎么办？**

```json
{
  "id": "check_quality",
  "type": "condition",
  "params": { "if": "image_quality > 0.8" },
  "branches": {
    "true": ["enhance_image"],
    "false": ["regenerate_image"]
  }
}
```

条件节点根据执行结果选择下一个节点。这其实是 DAG 的扩展——从"无环图"变成"有条件分支的图"。但要注意不能成环（否则死循环）。

### 🏗 架构分析

**任务编排的演进**

| 阶段 | 能力 | 实现 |
|------|------|------|
| 当前 | 硬编码 DAG | 代码里的步骤顺序 + Promise.all 并行 |
| 演进 | 配置化 DAG | JSON 定义 + DAGExecutor 拓扑排序 |
| 未来 | 条件分支 DAG | condition 节点 + 分支选择 |

**DAG 引擎的核心**：拓扑排序（保证依赖顺序）+ 并行执行（就绪节点并行）+ 失败策略（retry/skip/abort/fallback）。

### 🎯 面试官真正考察什么

1. **当前编排能力**：不是"我们有 DAG 引擎"——诚实说当前是硬编码，但有演进思路。
2. **DAG 原理**：拓扑排序、并行执行、依赖管理——DAG 引擎的基础。
3. **失败处理**：不是全有或全无，有失败策略。这是 DAG 引擎的难点。

### ❌ 常见错误回答

- **"我们用 Temporal"**：前面说了不用 Temporal，这里又说用——前后矛盾。
- **DAG 不处理失败**：一个节点失败整个 DAG 崩。
- **没有演进思路**：只说当前能力，不说未来怎么做。

### ✅ 推荐回答

> 当前编排分两级：BullMQ parent/child（简单依赖但无条件分支）和硬编码 DAG（代码里步骤顺序+Promise.all 并行+stepResults 检查点）。诚实说当前是硬编码——改流程要改代码。演进方向是配置化 DAG：JSON 定义 nodes+edges，DAGExecutor 用拓扑排序保证依赖顺序、就绪节点并行执行。失败策略 per-node 配置：retry（重试）、skip+fallback（跳过用降级值继续，如图片失败用占位图）、abort（整个 DAG 失败，如脚本生成失败后面做不了）。条件分支用 condition 节点选分支但不能成环。当前硬编码够用因为流程不多变化不频繁，业务流程多样化时再建配置化 DAG。

### 📚 延伸知识

- **Topological Sort**：DAG 的核心算法。Kahn 算法（BFS 式）或 DFS 式。保证节点按依赖顺序执行。
- **DAG Workflow Engines**：Airflow（数据管道）、Temporal（业务工作流）、Argo Workflows（K8s 原生）。各自适合不同场景。

---

## Q16. 监控和告警

**🎤 面试官**

> Task Platform 跑在生产环境，你怎么知道它是否健康？监控哪些指标？什么情况告警？

**🙋 候选人回答**

**监控分三层：基础设施、队列、任务。**

**① 基础设施层**

| 指标 | 告警阈值 | 工具 |
|------|----------|------|
| Worker CPU 使用率 | > 80% 持续 5 分钟 | Prometheus + Node Exporter |
| Worker 内存使用率 | > 85% | 同上 |
| Redis 内存使用率 | > 70% | Redis Exporter |
| Redis 连接数 | > 80% 上限 | 同上 |

**② 队列层**

| 指标 | 告警阈值 | 意义 |
|------|----------|------|
| 等待队列长度 | > 100 | 任务积压，Worker 不够 |
| 活跃任务数 | 持续 = Worker 并发数 | Worker 满载 |
| 延迟队列长度 | > 50 | 延迟任务积压 |
| 死信队列长度 | > 10 | 失败任务积压 |
| 任务吞吐量 | 突降 50% | 可能 Worker 异常 |

```typescript
// BullMQ 队列指标采集
setInterval(async () => {
  const metrics = {
    waiting: await queue.getWaitingCount(),
    active: await queue.getActiveCount(),
    delayed: await queue.getDelayedCount(),
    failed: await queue.getFailedCount(),
    completed: await queue.getCompletedCount(),
  };
  
  // 推到 Prometheus
  prometheus.gauge('queue_waiting').set(metrics.waiting);
  prometheus.gauge('queue_active').set(metrics.active);
  // ...
  
  // 告警
  if (metrics.waiting > 100) {
    await alert('queue_backlog', `等待队列积压: ${metrics.waiting}`);
  }
  if (metrics.failed > 10) {
    await alert('dead_letter_backlog', `死信队列积压: ${metrics.failed}`);
  }
}, 30000);
```

**③ 任务层**

| 指标 | 告警阈值 | 意义 |
|------|----------|------|
| 任务成功率 | < 95% | 失败率异常 |
| 平均执行时间 | 比基线高 50% | 性能退化 |
| P99 执行时间 | > 10 分钟 | 长尾任务异常 |
| AI 调用失败率 | > 5% | AI Provider 问题 |

---

**🎤 面试官追问**

> 你说"任务成功率 < 95% 告警"，但不同任务类型的成功率不同——视频合成可能 90%，图片生成可能 99%。混在一起统计合理吗？

**🙋 候选人回答**

**不合理。指标要按任务类型分组（分维度统计）。**

```typescript
// 按任务类型分组统计成功率
const successRates = await prisma.task.groupBy({
  by: ['type'],
  where: {
    createdAt: { gte: oneHourAgo },
    status: { in: ['COMPLETED', 'FAILED', 'TIMEOUT'] },
  },
  _count: { id: true },
});

// 计算每种类型的成功率
for (const group of successRates) {
  const total = group._count.id;
  const success = await prisma.task.count({
    where: { type: group.type, status: 'COMPLETED', createdAt: { gte: oneHourAgo } },
  });
  const rate = success / total;
  
  prometheus.gauge('task_success_rate', { type: group.type }).set(rate);
  
  // 按类型设阈值
  const threshold = THRESHOLDS[group.type] || 0.95;
  if (rate < threshold) {
    await alert(`task_success_low:${group.type}`, 
      `${group.type} 成功率 ${rate * 100}% < ${threshold * 100}%`);
  }
}
```

**不同类型的阈值：**

```typescript
const THRESHOLDS = {
  image_gen: 0.99,       // 图片生成应该很稳定
  drama_gen: 0.95,       // 漫剧生成链路长，允许更多失败
  video_compose: 0.90,   // FFmpeg 可能因资源问题失败
  tts: 0.98,             // TTS 相对稳定
};
```

**分维度统计是监控的基本原则**——混在一起统计会让"正常的低成功率类型"（如 video_compose 的 90%）触发告警，而"异常的高成功率类型"（如 image_gen 突然降到 97%）被掩盖。

---

**🎤 面试官继续追问**

> 告警之后怎么处理？如果凌晨 3 点告警了，谁来响应？

**🙋 候选人回答**

**告警分级 + On-Call 轮值。**

**告警分级：**

| 级别 | 定义 | 响应方式 | 示例 |
|------|------|----------|------|
| P0 | 系统不可用 | 立即响应（电话） | Redis 挂了、所有 Worker 崩溃 |
| P1 | 严重影响 | 30 分钟内（Slack + 手机推送） | 死信队列暴增、成功率骤降 |
| P2 | 需要关注 | 工作时间处理 | 队列轻微积压、慢任务增多 |

**On-Call 轮值**：

```
Week 1: 开发者 A（主） + 开发者 B（备）
Week 2: 开发者 C（主） + 开发者 A（备）
...
```

主 On-Call 负责响应告警，备 On-Call 在主没响应时兜底（5 分钟未响应升级到备）。

**告警包含的信息**——不是只说"出问题了"，要包含诊断信息：

```typescript
async function alert(level: string, message: string, context?: object) {
  await slack.postMessage({
    channel: '#alerts',
    text: `[${level}] ${message}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*[${level}]* ${message}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*时间:* ${new Date().toISOString()}` },
          { type: 'mrkdwn', text: `*环境:* ${process.env.NODE_ENV}` },
          { type: 'mrkdwn', text: `*队列等待:* ${await queue.getWaitingCount()}` },
          { type: 'mrkdwn', text: `*死信:* ${await queue.getFailedCount()}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '查看 Bull Board' },
            url: 'https://bull-board.example.com',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '查看 Grafana' },
            url: 'https://grafana.example.com/d/task-platform',
          },
        ],
      },
    ],
  });
  
  // P0 级别电话通知
  if (level === 'P0') {
    await pagerduty.callOnCall();
  }
}
```

**告警里带快捷链接**——收到告警的人可以直接点进 Bull Board 看队列状态、点进 Grafana 看监控图表。不需要翻文档找 URL。

### 🏗 架构分析

**监控告警三层**

| 层 | 指标 | 告警 |
|----|------|------|
| 基础设施 | CPU/内存/连接数 | 资源耗尽 |
| 队列 | 等待/活跃/死信长度 | 积压 |
| 任务 | 成功率/执行时间（按类型分维度） | 异常 |

**告警分级**：P0（电话）、P1（Slack+推送）、P2（工作时间）。On-Call 轮值。

### 🎯 面试官真正考察什么

1. **监控分层**：不只是"看队列"，还有基础设施和任务层。
2. **分维度统计**：不同任务类型有不同的正常基线，混在一起统计会误报和漏报。
3. **告警的可操作性**：告警不只是"出问题了"，要有诊断信息和快捷链接。

### ❌ 常见错误回答

- **"监控 CPU 就行"**：不监控队列和任务层。
- **混合统计**：所有任务类型用一个阈值。
- **告警无信息**："队列积压"——积压多少？什么类型？要看什么？

### ✅ 推荐回答

> 监控三层：基础设施（Worker CPU>80%/内存>85%/Redis 内存>70%/连接数，Prometheus+Node Exporter）、队列（等待>100 积压/活跃=并发数满载/死信>10/BullMQ getWaitingCount 等）、任务（成功率按类型分维度——image_gen 99% drama_gen 95% video_compose 90% 各有阈值/平均执行时间/P99）。告警分级：P0 系统不可用电话+PagerDuty、P1 严重影响 Slack+推送 30 分钟、P2 工作时间。On-Call 轮值主备制。告警含诊断信息（时间/环境/队列状态）+快捷链接（Bull Board/Grafana 按钮直接跳转）。分维度统计是基本原则——混在一起会让正常的低成功率类型误报、异常的高成功率类型漏报。

### 📚 延伸知识

- **RED Method**：Rate（请求率）、Errors（错误率）、Duration（延迟）。微服务监控的经典三指标。
- **SLI/SLO/SLA**：SLI（指标，如成功率 99%）、SLO（目标，如月成功率≥99%）、SLA（协议，违约赔偿）。Task Platform 应该有自己的 SLO。

---

## Q17. 容量规划

**🎤 面试官**

> 你们 Task Platform 的容量怎么规划？多少 Worker 够用？什么时候该扩容？

**🙋 候选人回答**

**容量规划基于"任务吞吐量"和"任务执行时间"两个指标。**

**基本公式：**

```
需要 Worker 数 = (任务到达速率 × 平均执行时间) / 单 Worker 并发数

例：
  任务到达速率：10 个/分钟
  平均执行时间：3 分钟
  单 Worker 并发数：5
  
  需要 Worker 数 = (10 × 3) / 5 = 6 个 Worker
```

这个公式的意思是：每分钟来 10 个任务，每个任务跑 3 分钟，所以同时有 10×3=30 个任务在跑。一个 Worker 并发 5 个，需要 30/5=6 个 Worker。

**但这只是理论值。实际要考虑：**

**① 峰谷比**

任务不是均匀到达的。白天高峰可能是凌晨的 5 倍。如果按平均值规划，高峰期不够；按峰值规划，低谷期浪费。

我们的做法：**基础容量按 1.5 倍平均值，弹性容量应对峰值。**

```
基础 Worker：6 × 1.5 = 9 个（常驻）
弹性 Worker：高峰期自动加到 15 个（K8s HPA）
```

**② 任务类型混合**

不同任务类型的资源消耗不同——AI 调用任务（I/O 密集）一个 Worker 跑 20 个不累，FFmpeg 任务（CPU 密集）一个 Worker 跑 3 个就满。不能混在一起算。

```
I/O 任务：到达 8/分钟，执行 2 分钟，并发 20 → 需 1 Worker
CPU 任务：到达 2/分钟，执行 5 分钟，并发 3 → 需 4 Worker
总需：5 Worker（1 I/O + 4 CPU）
```

**③ 冗余**

不能按"刚好够"规划——Worker 崩溃、部署重启、网络抖动都会导致容量下降。我们保留 30% 冗余：理论需 6 个，实际部署 8 个。

---

**🎤 面试官追问**

> 你说 K8s HPA 自动扩缩容，HPA 根据什么指标扩容？CPU？队列长度？

**🙋 候选人回答**

**不同类型的 Worker 用不同的扩缩容指标。**

**Node Worker（I/O 密集）**：按队列长度扩容

I/O 密集任务的 CPU 使用率低（大部分时间在等网络），按 CPU 扩容不准——CPU 20% 但队列已经积压 200 个任务。

所以用**自定义指标（队列长度）**作为 HPA 指标：

```yaml
# K8s HPA 配置
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: node-worker
spec:
  scaleTargetRef:
    name: node-worker
  minReplicas: 3
  maxReplicas: 15
  metrics:
    - type: External
      external:
        metric:
          name: queue_waiting  # 自定义指标：等待队列长度
          selector:
            matchLabels:
              queue: io-tasks
        target:
          type: AverageValue
          averageValue: 10  # 每个 Pod 目标处理 10 个等待任务
```

**逻辑**：如果等待队列有 60 个任务，目标每 Pod 10 个，需要 6 个 Pod。当前 3 个 → 扩到 6 个。

**Python Worker（CPU 密集）**：按 CPU 使用率扩容

CPU 密集任务的 CPU 使用率能准确反映负载：

```yaml
metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70  # CPU 超 70% 扩容
```

**逻辑**：CPU 超 70% 说明 Worker 快满了，加 Pod。

**缩容要谨慎**——不能队列一空就缩，否则峰谷交替时频繁扩缩（thrive）。HPA 配置缩容冷却时间（`scaleDownStabilizationWindowSeconds: 300`）——5 分钟内不缩容，确保不是瞬时低谷。

---

**🎤 面试官继续追问**

> 扩容容易，缩容难。如果缩容时 Worker 正在执行任务，直接杀 Pod 会导致任务中断。怎么优雅缩容？

**🙋 候选人回答**

**用优雅停止（Graceful Shutdown）。**

K8s 缩容 Pod 时先发 SIGTERM，等 grace period（默认 30 秒）后才 SIGKILL。我们在 SIGTERM 信号里做优雅停止：

```typescript
// Worker 启动时注册信号处理
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  logger.info('worker.sigterm_received');
  isShuttingDown = true;
  
  // ① 停止接新任务
  await worker.close(false);  // false = 不等待当前任务完成，但停止接新的
  
  // ② 等待当前任务完成（最多等 grace period）
  // BullMQ 的 worker.close(false) 会停止领取新任务，但正在执行的任务继续
  // 我们等这些任务完成
  
  // ③ 如果 grace period 不够，标记任务为"需要恢复"
  // stalled check 会在其他 Worker 上恢复这些任务
  
  logger.info('worker.shutdown_complete');
  process.exit(0);
});
```

**关键：`worker.close(false)`** —— 停止接新任务但完成当前任务。如果 grace period（30 秒）不够等任务完成，进程被 SIGKILL，任务留在 active list，stalled check 会恢复它。

**但 30 秒对长任务不够**（FFmpeg 可能跑 3 分钟）。解决方案：

**① 延长 grace period**

```yaml
# K8s Pod 配置
spec:
  terminationGracePeriodSeconds: 300  # 5 分钟
```

但这会让缩容变慢——Pod 要等 5 分钟才真正停止。

**② 任务可中断时主动中止**

如果任务支持 AbortSignal（前面 Q6 讲的），收到 SIGTERM 时中止任务，BullMQ 会在其他 Worker 上重试：

```typescript
process.on('SIGTERM', async () => {
  await worker.close(false);
  // 当前任务会被中止（AbortSignal），BullMQ 在其他 Worker 重试
  process.exit(0);
});
```

**③ 使用 BullMQ 的 connection drain**

BullMQ 支持在 `worker.close()` 时等待任务完成：

```typescript
await worker.close(true);  // true = 等待所有当前任务完成
```

但如果任务很长，可能等很久。需要设超时。

**我们的实际做法**：grace period 设 60 秒 + `worker.close(false)` + stalled check 兜底。60 秒内能完成的任务正常完成；完不成的被 SIGKILL，stalled check 恢复。这是一个"大部分优雅 + 极端情况兜底"的折中。

### 🏗 架构分析

**容量规划**

| 维度 | 计算 |
|------|------|
| 理论 Worker 数 | (到达速率 × 执行时间) / 并发数 |
| 基础容量 | 理论 × 1.5（冗余）|
| 峰值容量 | 基础 × 2（弹性）|

**HPA 扩缩容**：I/O Worker 按队列长度（自定义指标），CPU Worker 按 CPU 使用率。缩容有冷却时间防 thrive。

**优雅缩容**：SIGTERM → worker.close(false) → 等当前任务 → grace period 兜底 + stalled check 恢复。

### 🎯 面试官真正考察什么

1. **容量计算**：不是拍脑袋，有公式（到达速率×执行时间/并发数）。
2. **扩缩容指标**：I/O 按队列、CPU 按使用率——不同类型用不同指标。
3. **优雅停止**：缩容不丢任务——SIGTERM + worker.close + stalled check。

### ❌ 常见错误回答

- **"看 CPU 扩容"**：I/O 密集任务 CPU 低但队列可能积压。
- **缩容直接杀**：不处理 SIGTERM，任务中断丢失。
- **不设冗余**：刚好够，一有波动就不够。

### ✅ 推荐回答

> 容量公式：Worker 数 = (任务到达速率 × 平均执行时间) / 单 Worker 并发数。例 10/分钟×3 分钟/5 并发=6 Worker。实际考虑峰谷比（基础 1.5 倍+弹性应对峰值）、任务类型混合（I/O 和 CPU 分开算）、30% 冗余。HPA 扩容：Node Worker（I/O）按队列长度自定义指标（队列 60 个÷每 Pod 目标 10=6 Pod），Python Worker（CPU）按 CPU 70%。缩容有冷却时间防 thrive。优雅缩容：SIGTERM→worker.close(false) 停止接新任务等当前完成→grace period 60 秒→超时 SIGKILL 由 stalled check 恢复。长任务可 AbortSignal 中止在其他 Worker 重试。

### 📚 延伸知识

- **K8s HPA Custom Metrics**：需要部署 Metrics Server + Prometheus Adapter，把自定义指标（如队列长度）暴露给 HPA。
- **Little's Law**：排队论的基本定律——L = λ × W（系统中的平均任务数 = 到达率 × 平均等待时间）。我们的容量公式就是 Little's Law 的应用。

---

## Q18-Q29. 综合深挖题

> 以下题目是综合性的深度问题，考察对 Task Platform 的整体理解和实战经验。每题按统一模板展开。

---

## Q18. 如果让你重新设计 Task Platform，你会做什么不同？

**🎤 面试官**

> 经历了从零搭建 Task Platform 的全过程，如果重来一遍，架构上有什么你会改的？

**🙋 候选人回答**

**五个改变：**

**① 一开始就用 OpenTelemetry，而不是后加 Trace**

我们最初只有日志，没有 Trace。线上排查"任务为什么慢"时，只能靠日志的时间戳手动拼链路——痛苦且不准确。后来加 OpenTelemetry 时，发现代码里很多地方没有 Span 上下文，要大量改造。如果重来，第一天就集成 OpenTelemetry SDK，自动埋点从第一行代码就有。

**② 状态机用 XState 而非手写转换表**

当前的状态转换表（VALID_TRANSITIONS）是手写的，虽然能用但缺乏可视化、缺乏状态变更的副作用管理。XState 是成熟的状态机库，支持状态转换的 guard、action、context。如果重来，用 XState 定义状态机，自动生成状态图可视化。

**③ Bridge Worker 的协议一开始就定义严格**

第二章说过跨语言通信协议是后补的，中间有状态不一致的 Bug。如果重来，先定义 protobuf/JSON Schema 契约，各语言从契约生成代码。协议先行，实现后跟。

**④ 动态配置一开始就做**

当前有些配置（如重试次数、超时时间）硬编码在代码里，改要发版。如果重来，这些运行时参数一开始就做成动态配置（PG + Redis 缓存），不发版可调。

**⑤ Worker 的资源隔离用 K8s 而非 Docker Compose**

当前部分 Worker 跑在 Docker Compose 上，资源隔离不如 K8s 精细。如果重来，直接上 K8s，用 Resource Quota 和 Limit Range 精确控制每个 Worker 的 CPU/内存。

### 🏗 架构分析

**重来的五个改变**

| 改变 | 当前 | 重来 |
|------|------|------|
| Trace | 后加 OpenTelemetry | 第一天集成 |
| 状态机 | 手写转换表 | XState 库 |
| 跨语言协议 | 后补 | 契约先行 |
| 配置 | 部分硬编码 | 动态配置 |
| 部署 | Docker Compose | K8s |

**权衡：** "重来一遍"的反思不是为了否定现状，而是识别"延迟不可逆决策"原则下哪些决策其实可以更早做。上述五项中，Trace 和契约是"早做成本低、晚做成本高"的典型；XState 和 K8s 则属于"看团队成熟度"——强行第一天上 K8s 可能反而拖慢初期交付。

**未来演进：** 真实世界里不会真"重来"，而是把反思转成 backlog：动态配置、XState、K8s 迁移都排进了路线图，按需求驱动逐步落地。

### 🎯 面试官真正考察什么

考察的是**反思能力**——能否从自己的架构里识别出"如果重来会改什么"。这是区分"会写代码"和"会做架构"的关键。答不出反思的人说明只是执行了方案，没有理解方案；能说出反思但说不清"为什么当初没这么做"的人，说明对时间/资源约束缺乏认知。最好的答案既诚实（承认当初的妥协），又有判断力（知道哪些妥协其实是错的）。

### ❌ 常见错误回答

- **全盘否定现状**："当初设计全是错的"——显得没有现实感，真正的高手会解释"当初为什么这么选"。
- **罗列流行技术**："我会用 Kafka / 微服务 / Service Mesh"——为了显得先进而堆砌，脱离实际需求。
- **没有取舍**："全都改"——说明没有分清哪些决策是"真错"、哪些只是"当时的合理妥协"。

### ✅ 推荐回答

> 五个改变：① 第一天就集成 OpenTelemetry 而非后加（后加要大量改造补 Span）；② 状态机用 XState 而非手写转换表（支持 guard/action/context+状态图可视化）；③ 跨语言协议契约先行（protobuf/JSON Schema 先定义再实现，避免状态不一致 Bug）；④ 运行时参数（重试次数/超时）一开始就做动态配置而非硬编码；⑤ 直接上 K8s 而非 Docker Compose（Resource Quota 精确控制资源）。

### 📚 延伸知识

- **延迟不可逆决策（Defer irreversible decisions）**：精益创业和架构设计的共同原则——把"一旦决定就难改"的决策尽量往后推，把"容易改"的决策先做。
- **契约先行（Contract-First）**：先定义接口契约（OpenAPI/protobuf/JSON Schema），再写实现。各语言从契约生成客户端，天然避免不一致。
- **XState**：David Khourshid 的状态机库，支持状态图可视化（stately.ai），在复杂状态流转场景比手写转换表更可维护。

---

## Q19. Task Platform 的最大瓶颈在哪？

**🎤 面试官**

> 当前系统跑了一段时间，你觉得最大的性能瓶颈或架构瓶颈在哪？

**🙋 候选人回答**

**最大瓶颈是 Redis 的单点性能。**

所有任务数据（队列、状态、延迟、死信）都在一个 Redis 实例里。当前任务量（日几万）不是问题，但增长到日百万级时：

1. **Redis 单线程瓶颈**：BullMQ 的 BRPOPLPUSH、ZADD、HSET 都是单线程执行。高并发下 Redis 的 QPS 上限（约 10 万）可能不够。
2. **内存瓶颈**：任务数据全在内存。百万任务可能占几十 GB 内存。
3. **网络瓶颈**：Worker 和 Redis 之间的网络往返，在高吞吐下成为延迟来源。

**解法（按演进顺序）：**

| 阶段 | 方案 | 效果 |
|------|------|------|
| 当前 | 单 Redis 实例 | 日几万够用 |
| 中期 | Redis Cluster 分片 | 水平扩展，QPS 和内存翻倍 |
| 远期 | 任务分类型到不同 Redis | 按业务隔离，互不影响 |

**架构瓶颈是 Bridge Worker 的单点。** Bridge Worker 是 Node 和 Python 之间的唯一通道，如果它挂了，所有 CPU 密集任务停摆。虽然可以多实例，但消息顺序和一致性需要额外保障。

### 🏗 架构分析

**瓶颈识别的层次：** 系统瓶颈不是单点的，而是"当下最紧的那一环"。我们的判断顺序是 ① 存储（Redis 内存/单线程）→ ② 单点组件（Bridge Worker）→ ③ 网络（Worker↔Redis 往返）。

**方案对比：**

| 方案 | 解决的问题 | 代价 |
|------|-----------|------|
| Redis Cluster 分片 | QPS + 内存水平扩展 | BullMQ 跨分片兼容性差，需 hash tag |
| 按业务类型拆 Redis 实例 | 业务隔离、互不影响 | 运维实例数翻倍、跨业务编排变难 |
| Bridge Worker 多实例 | 去单点 | 消息顺序/一致性需额外机制（如序列号+去重） |

**权衡：** 不一上来就上 Cluster，而是等真实瓶颈出现再演进——过早分片会让 BullMQ 的兼容性问题提前暴露，收益却不明显。

### 🎯 面试官真正考察什么

考察**系统视角**——能否跳出"功能跑通"看到瓶颈在哪。真正的高级工程师能指出"现在没问题，但增长到 X 规模时哪个组件先扛不住"，并给出演进路径。这是架构师和程序员的核心区别。

### ❌ 常见错误回答

- **只说功能层瓶颈**："API 太慢"——没有落到具体组件（Redis/Worker/网络）。
- **没有量化**："性能不行"——说不出 QPS、内存、延迟的具体数字和瓶颈点。
- **只报喜不报忧**："目前没问题"——回避了演进压力，显得缺乏前瞻性。

### 📚 延伸知识

- **Little's Law**：队列系统 `L = λW`（平均任务数 = 到达率 × 平均等待时间），是容量规划的基础（Q17 展开）。
- **USE 方法**（Utilization/Saturation/Errors）： Brendan Gregg 的瓶颈定位法，先看饱和度和错误率。
- **BullMQ Cluster 兼容性**：见官方文档 "Using BullMQ with Redis Cluster"，关键是用 `{queueName}` hash tag 强制同分片。

### ✅ 推荐回答

> 最大瓶颈是 Redis 单点性能——所有任务数据在一个 Redis 实例。日几万够用但百万级时：单线程 QPS 上限（~10 万）、内存瓶颈（百万任务几十 GB）、网络往返延迟。解法演进：单实例→Redis Cluster 分片→按业务类型分到不同 Redis。架构瓶颈是 Bridge Worker 单点——Node 和 Python 间唯一通道，挂了 CPU 任务停摆。多实例可缓解但消息一致性需额外保障。

---

## Q20. BullMQ 的底层原理你了解多少？

**🎤 面试官**

> 你一直用 BullMQ，能不能讲讲它的底层原理？任务在 Redis 里是怎么存的？

**🙋 候选人回答**

BullMQ 在 Redis 里用了多种数据结构：

**① 等待队列（wait list）**：Redis List，存待执行任务的 ID。

**② 延迟队列（delayed sorted set）**：Redis Sorted Set，score 是执行时间戳。

**③ 优先级队列（priority sorted set）**：Redis Sorted Set，score 是优先级值。

**④ 活跃列表（active list）**：Redis List，存正在执行的任务 ID。

**⑤ 任务数据（job hash）**：Redis Hash，每个任务一个 Hash，存 payload、进度、attempts 等。

**⑥ 事件流（events stream）**：Redis Stream，发布任务生命周期事件。

**任务执行流程**：

```
add(job) → LPUSH wait, jobId → SET job:{id} data
Worker 取：BRPOPLPUSH wait active → 读 job:{id} → 执行
完成：LREM active jobId → SADD completed jobId
失败：LREM active jobId → 如果可重试 LPUSH wait → 否则 SADD failed
进度更新：HSET job:{id} progress 60
延迟：ZADD delayed timestamp jobId → 定时移到 wait
```

**stalled 检测**：BullMQ 定期扫描 active list，对每个任务检查 `stalled:{jobId}` key 是否存在（Worker 心跳会续期这个 key）。过期则判定 stalled，移回 wait。

### 🏗 架构分析

**为什么 BullMQ 用多种数据结构而非单一结构？** 因为任务有多个维度——等待（List，FIFO）、延迟（Sorted Set，按时间戳）、优先级（Sorted Set，按优先级值）、状态（Hash）。单一结构无法同时高效支持这些操作。

**方案对比：**

| 方案 | 存储 | 优势 | 劣势 |
|------|------|------|------|
| BullMQ（多结构组合） | Redis | 各操作 O(1)/O(logN)，原生支持状态机 | 强依赖 Redis |
| 用 PG 表模拟队列 | PostgreSQL | 强持久化、事务一致 | 磁盘慢、需轮询、死锁风险 |
| 自己实现 + Kafka | Kafka 分区 | 高吞吐、可重放 | 无任务状态概念，需大量自研 |

**权衡：** BullMQ 用 Redis 换来了速度和丰富的任务语义，代价是持久化可靠性弱于 PG——所以我们用 PG 双写兜底（Q9）。这是"快存 + 真持久化"的典型组合。

### 🎯 面试官真正考察什么

不是考"背 BullMQ 命令"，而是考**对所用工具底层原理的理解深度**。会用 BullMQ 的 API 和理解它在 Redis 里怎么存是两回事。能讲清数据结构选型的人，遇到问题（如 stalled、积压、内存膨胀）才能定位根因，而不是只会重启。

### ❌ 常见错误回答

- **只说 API 层**："add() 入队、process() 处理"——这是用法不是原理。
- **记不清数据结构**："好像用 List"——一知半解比不知道更危险。
- **不联系实际**：能背原理但说不出"这个原理怎么帮我们排查过问题"。

### 📚 延伸知识

- **BRPOPLPUSH 的原子性**：Redis 单线程保证"从 A 取出放入 B"不可被打断，是可靠队列的基础。Redis 6+ 推荐用 LMOVE（同语义、更明确的名字）。
- **Sorted Set 的 Skiplist**：Redis 的 ZSet 底层是跳表（小数据用 ziplist），支持 O(logN) 的按 score 范围查询——延迟和优先级队列就靠它。
- **stalled check 的心跳模型**：和分布式锁的续期（watchdog）是同一思想。

### ✅ 推荐回答

> BullMQ 用多种 Redis 数据结构：wait（List 待执行）、delayed（Sorted Set 延迟 score=时间戳）、priority（Sorted Set 优先级 score=优先级值）、active（List 执行中）、job:{id}（Hash 任务数据）、events（Stream 生命周期事件）。流程：add→LPUSH wait+SET job 数据；Worker BRPOPLPUSH wait→active 读 Hash 执行；完成 LREM active+SADD completed；失败可重试 LPUSH 回 wait 否则 SADD failed；延迟 ZADD delayed 定时移 wait。stalled 检测：定期扫 active 检查 stalled:{jobId} 心跳 key 是否过期，过期移回 wait。

---

## Q21. 为什么不用消息队列（RabbitMQ/Kafka）？

**🎤 面试官**

> RabbitMQ 和 Kafka 是更成熟的消息队列。为什么选 BullMQ 而不是它们？

**🙋 候选人回答**

**因为 BullMQ 是"任务队列"，RabbitMQ/Kafka 是"消息队列"——定位不同。**

| 维度 | BullMQ（任务队列） | RabbitMQ（消息队列） | Kafka（流处理） |
|------|-------------------|---------------------|-----------------|
| 核心概念 | 任务（有状态、有生命周期） | 消息（无状态、消费即删） | 事件流（持久化、可重放） |
| 重试/超时 | ✅ 内置 | ⚠️ 需配置 | ❌ 需自己实现 |
 | 状态管理 | ✅ 任务状态机 | ❌ 只有 ack/nack | ❌ |
| 延迟任务 | ✅ 内置 | ⚠️ TTL+DLX（有坑） | ❌ |
| 优先级 | ✅ 内置 | ✅ | ❌ |
| 适合场景 | 异步任务调度 | 服务间解耦 | 数据管道、事件溯源 |

**我们的需求是"任务调度"——有状态、有重试、有延迟、有优先级**。BullMQ 天然为这个设计。RabbitMQ 能做但要配置很多（TTL+DLX 做延迟、手动做状态管理），Kafka 完全不适合（没有任务状态概念）。

**如果场景是"服务间消息解耦"**（如订单服务通知库存服务），RabbitMQ 更合适。如果场景是"数据管道"（如日志采集到数据仓库），Kafka 更合适。工具跟着需求走。

### 🏗 架构分析

**核心区分：任务队列 vs 消息队列 vs 事件流。** 这三者经常被混淆，但定位完全不同——任务队列关心"这件事做没做成"（有状态、有重试），消息队列关心"消息送达没"（ack/nack），事件流关心"历史可重放"（持久化日志）。

**为什么不用 RabbitMQ 做任务调度：** RabbitMQ 能做延迟（TTL + 死信交换机 DLX），但有"队头阻塞"坑——前面的消息没过期，后面的就算过期了也出不去。任务状态机、断点续传、stalled 检测都要自己实现，等于把 BullMQ 的功能重造一遍。

**未来演进：** 如果未来要做"任务结果的事件溯源"（如审计、回放），可以 BullMQ 做调度 + Kafka 做事件流，两者互补而非替代。

### 🎯 面试官真正考察什么

考察**技术选型的判断力**——能否说清"为什么选 A 不选 B"，而不是"因为大家都用 A"。关键是要讲清场景差异：没有最好的工具，只有最合适的工具。能主动说"什么场景下我反而会用 RabbitMQ/Kafka"的人，说明真的理解了边界。

### ❌ 常见错误回答

- **贬低其它工具**："RabbitMQ 过时了"——显得没有技术广度。
- **只说优点不说代价**："BullMQ 啥都能干"——回避了持久化弱、强依赖 Redis 的缺点。
- **没有场景对比**："BullMQ 比 Kafka 好"——脱离场景谈优劣毫无意义。

### 📚 延伸知识

- **RabbitMQ 的 TTL+DLX 延迟坑**：经典问题，队头阻塞导致延迟任务不准时。社区有 rabbitmq_delayed_message_exchange 插件缓解。
- **Kafka 不是队列是日志**：Kafka 的核心是"持久化、可重放的分区日志"，消费位移由消费者管理，天然不适合"做完就删"的任务语义。
- **AWS 的选择**：SQS（任务队列）+ SNS（消息广播）+ Kinesis（事件流），也是按场景拆分。

### ✅ 推荐回答

> BullMQ 是任务队列（有状态、有生命周期），RabbitMQ/Kafka 是消息队列/流处理。需求是任务调度——有重试/超时/状态机/延迟/优先级，BullMQ 内置这些。RabbitMQ 能做但要配 TTL+DLX（有头部阻塞坑）和手动状态管理。Kafka 完全不适合（无任务状态概念，是事件流持久化可重放）。如果场景是服务间消息解耦用 RabbitMQ，数据管道用 Kafka。工具跟需求走——任务调度用任务队列。

---

## Q22. 任务状态和数据库怎么同步？

**🎤 面试官**

> BullMQ 的状态在 Redis，你的业务状态在 PostgreSQL。两者怎么同步？会不会不一致？

**🙋 候选人回答**

**用"事件驱动同步"——BullMQ 状态变更时触发事件，事件处理器同步到 PG。**

```typescript
// 监听 BullMQ 事件
queue.on('completed', (job) => {
  await prisma.task.update({
    where: { id: job.id },
    data: { status: 'COMPLETED', result: job.returnvalue, completedAt: new Date() },
  });
});

queue.on('failed', (job, err) => {
  await prisma.task.update({
    where: { id: job.id },
    data: { status: 'FAILED', error: err.message },
  });
});

worker.on('progress', (job, progress) => {
  await prisma.task.update({
    where: { id: job.id },
    data: { progress },
  });
});
```

**不一致的风险**：Redis 更新成功但 PG 更新失败（网络问题、PG 宕机）。这时 Redis 和 PG 状态不一致。

**处理策略：**

1. **PG 更新失败时重试**（指数退避）。
2. **重试耗尽后告警**，人工介入。
3. **定期对账**：每小时跑一次对账脚本，比对 Redis 和 PG 的状态，不一致的修正：

```typescript
async function reconcile() {
  const activeInRedis = await queue.getActive();
  const activeInPg = await prisma.task.findMany({ where: { status: 'RUNNING' } });
  
  // Redis 有但 PG 没有的 → 同步到 PG
  // PG 有但 Redis 没有的 → 标记为异常（可能 stalled）
}
```

**核心原则：Redis 是"主"（队列调度的真实状态），PG 是"从"（查询和持久化用）。** 不一致时以 Redis 为准，PG 做对账。

### 🏗 架构分析

**为什么是"双写"而不是"单一真相源"？** 因为 Redis 和 PG 各有所长——Redis 快但不可靠，PG 可靠但慢。把"调度状态"和"查询状态"分开，让各自做最擅长的事。

**一致性方案对比：**

| 方案 | 一致性 | 代价 |
|------|--------|------|
| 事件驱动 + 对账（我们） | 最终一致（秒级） | 偶发不一致，需对账兜底 |
| 分布式事务（2PC） | 强一致 | 性能差、Redis 不原生支持 |
| 只用 PG（不要 Redis） | 强一致 | 牺牲调度速度，违背选型初衷 |

**权衡：** 我们接受"最终一致"，因为任务调度对秒级不一致容忍度高（用户看到状态晚一两秒无妨），但对调度速度要求高。这是典型的 CAP 取舍——在不是强一致的场景别强求强一致。

### 🎯 面试官真正考察什么

考察**分布式数据一致性**的理解——两个存储怎么保持同步、不一致怎么办。这是 Task Platform 这类"内存队列 + 持久化数据库"架构的经典问题。能讲清"以谁为主、怎么对账、怎么容错"的人，说明真的在生产环境踩过坑。

### ❌ 常见错误回答

- **声称完全一致**："两边同时更新不会不一致"——忽视了网络故障和部分失败。
- **没有兜底**："失败了就失败了"——没有重试和对账机制。
- **方向搞反**："以 PG 为准修正 Redis"——PG 是从，用它改 Redis 会导致调度状态错乱。

### 📚 延伸知识

- **Saga 模式**：分布式事务的替代方案，用一系列本地事务 + 补偿操作。
- **Outbox Pattern**：把"要发的事件"写进 PG 的 outbox 表，再异步投递，保证"业务写入"和"事件发布"的原子性。
- **对账（Reconciliation）**：金融系统的经典做法，定期比对两套数据修正差异，是最终一致性的兜底。

### ✅ 推荐回答

> 事件驱动同步：监听 BullMQ 的 completed/failed/progress 事件，事件处理器更新 PG。不一致风险（Redis 更新成功 PG 失败）处理：PG 更新失败指数退避重试、重试耗尽告警、定期对账脚本比对 Redis 和 PG 状态修正。核心原则：Redis 是主（队列调度真实状态），PG 是从（查询和持久化），不一致以 Redis 为准 PG 做对账。BullMQ 事件：queue.on('completed'/'failed')、worker.on('progress')。

---

## Q23. 如何处理任务积压？

**🎤 面试官**

> 如果突然来了 10000 个任务，Worker 处理不过来，队列积压了怎么办？

**🙋 候选人回答**

**分三个阶段处理：**

**① 预防——限流削峰**

不要让 10000 个任务同时进队列。在入口限流：

```typescript
// API 层限流：每秒最多接受 50 个任务
const limiter = new RateLimiter(50, 'second');

app.post('/tasks', async (req, res) => {
  if (!limiter.tryRemoveTokens(1)) {
    return res.status(429).json({ error: 'Too many tasks, please retry later' });
  }
  await queue.add('tasks', req.body);
  res.status(202).json({ status: 'accepted' });
});
```

**② 响应——自动扩容**

队列积压时 HPA 自动加 Worker（前面 Q17 讲的自定义指标扩容）。10000 个积压 ÷ 每 Pod 10 = 需要 1000 Pod（超出 maxReplicas）。所以设 maxReplicas 上限（如 30），防止无限扩容打爆资源。

**③ 降级——丢弃低优先级任务**

如果扩容到上限还处理不完，启动降级策略：

```typescript
// 积压超过阈值，丢弃低优先级任务
if (await queue.getWaitingCount() > 5000) {
  const lowPriorityJobs = await queue.getJobs(['waiting'], 0, 100);
  for (const job of lowPriorityJobs) {
    if (job.opts.priority > 50) {  // 低优先级
      await job.discard();
      await job.remove();
      logger.warn('task.dropped_low_priority', { taskId: job.id });
    }
  }
}
```

**通知用户**：被丢弃的任务通知用户"系统繁忙，请稍后重试"。比让用户等 1 小时然后超时更好。

### 🏗 架构分析

**积压处理的三个层次：** 预防（限流）→ 响应（扩容）→ 降级（丢弃）。这是一个"逐级兜底"的策略，不是单点方案。

**方案对比：**

| 方案 | 解决阶段 | 代价 |
|------|---------|------|
| 入口限流 | 预防 | 高峰期用户体验下降（429） |
| 自动扩容（HPA） | 响应 | 资源成本，且有扩容延迟（Pod 拉起需 30s+） |
| 丢弃低优先级 | 降级 | 数据丢失（需告知用户重试） |
| 背压（Backpressure） | 预防 | 要求上游支持，实现复杂 |

**权衡：** 扩容有延迟（K8s 拉 Pod 要时间），所以不能只靠扩容——必须有限流和降级兜底，撑过扩容窗口期。设 maxReplicas 上限是为了防止"扩容风暴"把整个集群资源打爆。

### 🎯 面试官真正考察什么

考察**过载保护思维**——系统在压力下是优雅降级还是雪崩崩溃。真正的高级工程师会主动想"极端情况下怎么办"，而不是假设流量永远平稳。能讲清"扩容有延迟所以需要限流兜底"的人，说明有真实运维经验。

### ❌ 常见错误回答

- **只说扩容**："加 Worker 就行"——忽视扩容延迟和成本上限。
- **没有降级**："绝不丢任务"——不切实际，极端情况下不丢任务就会全盘崩溃。
- **无差别丢弃**："随机丢"——应该按优先级丢，保护高价值任务。

### 📚 延伸知识

- **背压（Backpressure）**：响应式编程（RxJS/Reactive Streams）的核心概念，下游忙时反压上游减速，比限流更优雅但要求全链路支持。
- **令牌桶 vs 漏桶**：令牌桶允许突发（攒够令牌可一次过多个），漏桶平滑输出。任务限流一般用令牌桶。
- **舱壁隔离（Bulkhead）**：把资源分组隔离，一个分组出问题不影响其它——类似按业务类型拆队列。

### ✅ 推荐回答

> 三阶段：① 预防限流削峰——API 层 RateLimiter 每秒最多 50 个任务，超了返回 429；② 响应自动扩容——HPA 按队列长度扩 Worker，设 maxReplicas 上限（30）防无限扩容打爆资源；③ 降级丢弃低优先级——积压>5000 时 discard priority>50 的任务并通知用户"系统繁忙稍后重试"。比让用户等 1 小时超时更好。10000 积压÷每 Pod 10=1000 Pod 超上限，所以扩容到上限后降级。

---

## Q24. 如何测试 Task Platform？

**🎤 面试官**

> 异步任务系统很难测试——任务执行有延迟、有重试、有并发。你们怎么测试？

**🙋 候选人回答**

**分三层测试：**

**① 单元测试——测任务逻辑**

把任务执行逻辑和 BullMQ 解耦，单独测：

```typescript
// 测试 executeTask 函数（不经过 BullMQ）
describe('executeTask', () => {
  it('should generate drama from input', async () => {
    const result = await executeTask({ input: 'story...' });
    expect(result.images).toHaveLength(5);
    expect(result.audioUrl).toBeDefined();
  });
  
  it('should resume from checkpoint', async () => {
    // 模拟已有步骤结果
    const steps = { script_split: { result: '...' } };
    const result = await executeTask({ input: '...', stepResults: steps });
    // 验证没有重新执行 script_split
    expect(mockSplitScript).not.toHaveBeenCalled();
  });
});
```

**② 集成测试——测 BullMQ 集成**

用真实的 Redis（测试环境），测任务的完整生命周期：

```typescript
describe('Task integration', () => {
  it('should complete task end-to-end', async () => {
    const job = await queue.add('tasks', { type: 'test' });
    
    // 等待完成（带超时）
    await waitForJobCompletion(job.id, 30000);
    
    const task = await prisma.task.findUnique({ where: { id: job.id } });
    expect(task.status).toBe('COMPLETED');
  });
  
  it('should retry on transient error', async () => {
    mockAI.rejectOnce(new TransientError('429'));
    
    const job = await queue.add('tasks', { type: 'test' }, { attempts: 3 });
    await waitForJobCompletion(job.id, 60000);
    
    expect(task.status).toBe('COMPLETED');  // 重试后成功
    expect(mockAI.calls).toHaveLength(2);   // 调了 2 次
  });
});
```

**③ 混沌测试——测故障恢复**

模拟故障，验证恢复机制：

```typescript
describe('Chaos', () => {
  it('should recover from Worker crash', async () => {
    const job = await queue.add('tasks', { type: 'long_running' });
    
    // 等任务开始执行
    await waitForStatus(job.id, 'RUNNING');
    
    // 杀掉 Worker
    workerProcess.kill('SIGKILL');
    
    // 启动新 Worker
    const newWorker = startWorker();
    
    // 验证任务被恢复（stalled check 后重新执行）
    await waitForJobCompletion(job.id, 120000);
    expect(task.status).toBe('COMPLETED');
  });
  
  it('should recover from Redis restart', async () => {
    // 类似：重启 Redis，验证恢复脚本重新投递任务
  });
});
```

### 🏗 架构分析

**测试分层的核心：解耦。** 只有把任务执行逻辑（executeTask）和 BullMQ 解耦，才能单独单元测试。耦合在 BullMQ 的 process 回调里写业务逻辑，是测试灾难的根源。

**方案对比：**

| 层级 | 测什么 | 速度 | 信心 |
|------|--------|------|------|
| 单元测试 | executeTask 纯逻辑 | 快（ms） | 中（不验证集成） |
| 集成测试 | BullMQ + Redis 端到端 | 慢（s） | 高 |
| 混沌测试 | 故障恢复 | 很慢 | 最高（验证容错） |

**权衡：** 混沌测试价值最高但成本也最高（要起真实进程、模拟 kill），不能全靠它。三层互补——单元测试覆盖广度，集成测试覆盖关键路径，混沌测试覆盖容错。

### 🎯 面试官真正考察什么

考察**对异步系统可测试性的理解**——异步任务难测不是因为"难"，而是因为代码耦合度高、缺乏解耦设计。能讲清"怎么把任务逻辑拆出来单测"的人，说明真的想过工程化，而不是写完就扔。

### ❌ 常见错误回答

- **只测 Happy Path**："正常流程测一下就行"——忽视重试、超时、并发。
- **依赖 sleep**：`setTimeout(5000)` 等任务完成——测试慢且 flaky，应该用事件等待（waitForJobCompletion）。
- **不测故障恢复**："故障测不了"——混沌测试就是干这个的。

### 📚 延伸知识

- **测试金字塔**：单元（多）→ 集成（中）→ E2E（少），越往上越少越贵。
- **Chaos Engineering**：Netflix Chaos Monkey 开创，主动注入故障验证韧性。生产环境的混沌测试需要"爆炸半径"控制。
- **Property-Based Testing**：fast-check 等库，自动生成输入测试不变量，适合状态机这种输入空间大的场景。

### ✅ 推荐回答

> 三层测试：① 单元测试——executeTask 函数和 BullMQ 解耦单独测（测正常执行+断点续传 mockSplitScript 验证不重复执行）；② 集成测试——真实 Redis 测完整生命周期（端到端完成+重试 transient error 后成功+验证调用次数）；③ 混沌测试——模拟故障验证恢复（杀 Worker 后 stalled check 恢复、重启 Redis 后恢复脚本重投）。关键：任务逻辑和队列解耦才能单元测试，不耦合 BullMQ 的 executeTask 直接调。

---

## Q25-Q29. 快速深挖题

> 以下题目用精简格式回答面试中的快速追问。

---

## Q25. BullMQ 的 Flow（任务流）你用过吗？

### 🏗 架构分析

- **为什么用 Flow：** parent/child 依赖天然支持"并行 N 个子任务→汇总"模式，比手写 Promise.all + 状态记录简单。
- **为什么没深入用：** Flow 不支持条件分支和部分失败处理（一个子任务挂了父任务直接失败），复杂编排靠不住。
- **替代方案：** 我们的 stepResults 检查点 + 硬编码 DAG（Q15）。未来演进到配置化 DAG 引擎。

### 🎯 面试官真正考察什么

不是问"用没用过"，而是考察**对工具能力边界的认知**——知道一个工具能干什么不算本事，知道它干不了什么、什么时候该换方案才是。

### ❌ 常见错误回答

- **强行套用**："所有任务编排都用 Flow"——忽视了它的条件分支/部分失败短板。
- **完全不知道**："没用过"——至少应该知道 BullMQ 有这个能力及其局限。

### 📚 延伸知识

- BullMQ Flow 的 parent/child 实际是 Redis 里的多队列依赖关系，子任务结果通过 Stream 汇总给父任务。
- 真正的 DAG 引擎：Airflow（数据领域）、Temporal（长事务工作流）、Argo Workflows（K8s）。

### ✅ 推荐回答

> 用过但不多。BullMQ Flow 支持 parent/child 依赖——子任务全部完成后父任务才执行。适合"并行 N 个子任务→汇总"的场景。但局限是：不支持条件分支、不支持部分失败处理（一个子任务失败父任务直接失败）。复杂编排还是靠我们的 stepResults 检查点。Flow 适合简单依赖，复杂场景需要 DAG 引擎。

---

> **注**：超时设计（双层超时）见 Q6 延伸知识；多 Worker 去重见 Q8 延伸知识——这两点已并入相应题目的深度展开。

---

## Q26. 任务的输入数据很大（如图片 base64）怎么处理？

### 🏗 架构分析

- **为什么用引用而非传值：** BullMQ payload 存在 Redis 内存，大 payload 撑爆内存、拖慢序列化、阻塞队列操作。
- **方案对比：** payload 存大数据（简单但危险）vs 存引用（多一次存储读取，但队列轻量）vs 用 Redis Streams（支持大消息但偏离 BullMQ 模型）。
- **演进：** 大对象用 S3 预签名 URL，Worker 直接从 S3 流式读取，连数据库都不碰。

### 🎯 面试官真正考察什么

考察**消息体积意识**——队列是"传信"不是"传货"。把大对象塞进消息队列是新手常犯的错。

### ❌ 常见错误回答

- **"加大 Redis 内存就行"**：用资源换设计错误，治标不治本。
- **base64 编码传**：base64 比原数据大 33%，雪上加霜。

### 📚 延伸知识

- **Claim-Check 模式**：消息只传引用（claim），实际数据存外部存储，是云计算消息系统的标准模式。
- **S3 预签名 URL**：带签名的临时下载链接，Worker 无需长期凭证即可取数据。

### ✅ 推荐回答

> 不把大数据放任务 payload。BullMQ 的 payload 存在 Redis（内存），大 payload 撑爆内存。我们的做法：任务 payload 只存引用（如 imageId、S3 URL），Worker 执行时从存储（S3/数据库）拉实际数据。payload 控制在 1KB 以内。如果必须传大数据，用 Redis 的 Streams（支持大消息+持久化）替代 List，但通常不需要——引用比传值好。

---

## Q27. 任务的输出结果怎么存？

### 🏗 架构分析

- **为什么分类型：** 文件、结构化数据、状态三类数据的访问模式和生命周期不同，混存会互相拖累。
- **方案对比：** 全存 PG（简单但 JSONB 大对象拖慢查询）vs 全存对象存储（结构化查询难）vs 分类型存（我们，最优但要多套存储）。
- **演进：** 冷数据归档到廉价存储（如 S3 Glacier），热数据留 PG。

### 🎯 面试官真正考察什么

考察**存储分层意识**——知道不同数据该去不同的存储，而不是"一个数据库装天下"。

### ❌ 常见错误回答

- **全存数据库**：把视频二进制塞进 PG BLOB——灾难。
- **结果存 Redis**：Redis 是内存，结果一多就 OOM。
- **不区分冷热**：所有结果永远留热存储——成本爆炸。

### 📚 延伸知识

- **对象存储 + CDN**：文件类结果通过 CDN 加速分发，减轻源站压力。
- **数据生命周期**：热（PG/Redis）→ 温（对象存储标准层）→ 冷（Glacier/归档），按访问频率和成本分层。

### ✅ 推荐回答

> 分类型存：文件类结果（视频、图片）存 S3，payload 里只存 URL；结构化数据（脚本、字幕）存 PG 的 JSONB 字段；状态信息（成功/失败/进度）存 PG 的 task 表。BullMQ 的 returnvalue 只存小结果（如最终 URL），不存大文件。原则：文件进对象存储、数据进数据库、队列只存引用和状态。

---

## Q28. 你们有没有做任务的"暂停/恢复"？

### 🏗 架构分析

- **为什么只做恢复不做暂停：** BullMQ 不原生支持"暂停正在执行的任务"，强实现语义不清晰。恢复（从检查点续跑）语义明确、价值高。
- **方案对比：** 取消+恢复模拟暂停（语义模糊）vs worker.pause()（暂停领取，在跑的跑完，我们用的）vs 真正的挂起/恢复（需要保存执行上下文，极复杂）。
- **演进：** 运维窗口期的"全局暂停"用 worker.pause() 已够用，单任务的真正暂停需求未出现。

### 🎯 面试官真正考察什么

考察**需求取舍**——不是所有功能都要做，要判断哪些是真需求、哪些是伪需求。能说清"为什么没做"比"做了什么"更能体现判断力。

### ❌ 常见错误回答

- **硬要实现**："我用取消+重启模拟暂停"——语义混乱，用户分不清取消和暂停。
- **回避问题**："没考虑过"——显得缺乏需求分析能力。

### 📚 延伸知识

- **协程（Coroutine）**：编程语言层面的"挂起/恢复"，Python 的 async、Go 的 goroutine 天然支持，但跨进程的暂停恢复极难。
- **Workflow 引擎的暂停**：Temporal/Cadence 支持工作流级别的暂停恢复，靠的是事件溯源重建状态。

### ✅ 推荐回答

> 做了"恢复"但没做"暂停"。恢复：任务失败或取消后，从 stepResults 最后完成步骤继续。暂停：我们没有实现——因为 BullMQ 不原生支持"暂停正在执行的任务"，要实现只能用取消+恢复模拟，语义不清晰（暂停后 Worker 释放了，恢复要重新排队）。如果业务需要真正的暂停（如运维窗口期暂停所有任务），我们的做法是暂停 Worker（worker.pause()）而非暂停任务——Worker 不领取新任务，正在跑的跑完，等运维完再 resume。

---

## Q29. 如果流量增长 100 倍，你的架构能扛住吗？要改什么？

### 🏗 架构分析

- **核心判断：架构骨架不变，每个组件水平扩展。** BullMQ+PG+Redis+Worker 分层是合理的，100 倍不需要推翻重来，而是横向扩。
- **真正的挑战：** Redis Cluster 下 BullMQ 的兼容性（任务不能跨分片）——这是唯一可能需要架构调整的点，解法是按任务类型拆 Redis 实例。
- **演进顺序：** 先扩 Worker（最便宜）→ PG 读写分离 → Redis 分片/拆实例 → Gateway/限流升级。按瓶颈驱动，不一次全改。

### 🎯 面试官真正考察什么

考察**架构的扩展性预判**——不是"能不能扛 100 倍"（任何架构到那个量级都要改），而是"知道哪里要先改、改的代价多大"。这是系统设计能力的终极考察。

### ❌ 常见错误回答

- **"没问题"**：盲目自信，说不出具体要改什么。
- **"全部重写"**：说明当前架构缺乏水平扩展能力，是设计缺陷。
- **没有优先级**：列一堆改造点但分不清先后——真实演进是有顺序的。

### 📚 延伸知识

- **水平扩展 vs 垂直扩展**：水平（加机器）是云原生首选，垂直（加配置）有上限且昂贵。
- **分片键选择**：Redis Cluster 分片要选好 hash tag，让相关的 key 落在同一分片，避免跨分片操作。
- **渐进式重构**：Martin Fowler 的"Strangler Fig 模式"——新系统逐步包围替换旧系统，而非一次性重写。

### ✅ 推荐回答

> 100 倍增长（日几万→日几百万）需要改的：① Redis 单实例→Redis Cluster 分片（QPS 和内存水平扩展）；② Worker 从几个→几十个（K8s HPA 自动扩）；③ PG 读写分离（任务查询走读库，不压主库）；④ WebSocket Gateway 独立扩容（连接数从几百→几万）；⑤ Bridge Worker 多实例+消息顺序保障（当前单实例是瓶颈）；⑥ AI Platform 限流升级（令牌桶→滑动窗口，更精准）；⑦ 监控告警升级（Prometheus 分区、告警阈值调整）。架构的"骨架"（BullMQ+PG+Redis+Worker 分层）不变，但每个组件都要水平扩展。核心挑战是 Redis Cluster 下 BullMQ 的兼容性（任务不能跨分片），可能需要按任务类型分到不同 Redis 实例。

---

## 本章总结

第四章是全书最重要章节，30 道题覆盖了 Task Platform 的全部核心。回顾关键设计：

| 主题 | 核心决策 | 题号 |
|------|----------|------|
| 生命周期 | 7 状态 + 步骤状态分层 + 死信队列 | Q1 |
| 状态机 | 转换表 + 乐观锁 + BRPOPLPUSH 原子领取 | Q2 |
| 实时推送 | WebSocket + Redis Pub/Sub + 独立 Gateway | Q3 |
| Worker 设计 | Node(I/O高并发) + Python(CPU低并发) + Bridge | Q4 |
| 跨语言 | Redis 队列桥接 + JSON 契约 + 幂等 | Q5 |
| 取消 | 协作式 + AbortSignal + 不回滚保留检查点 | Q6 |
| 重试 | 瞬时/永久分类 + 指数退避+抖动 + 断点续传 | Q7 |
| 幂等 | 任务级(锁)+步骤级(检查点)+业务级(upsert) | Q8 |
| 可靠性 | Redis HA + PG 双写 + 恢复脚本 | Q9 |
| 日志 | 结构化 + AsyncLocalStorage + 跨服务 Header | Q10 |
| Trace | OpenTelemetry + W3C Trace Context + 尾部采样 | Q11 |
| 死信 | 告警+诊断+批量重跑+30天过期归档 | Q12 |
| 优先级限流 | BullMQ priority + Redis 令牌桶 + 延迟重试不占槽 | Q13 |
| 延迟任务 | BullMQ delay(Sorted Set) + Keyspace Notification | Q14 |
| DAG 编排 | 当前硬编码 → 演进配置化 + 失败策略 | Q15 |
| 监控告警 | 三层(基建/队列/任务) + 分维度 + 分级告警 | Q16 |
| 容量规划 | Little's Law + HPA(I/O按队列/CPU按使用率) + 优雅停止 | Q17 |

**贯穿本章的核心原则：**

1. **纵深防御**——不依赖单一机制（幂等三层、可靠性三层、并发三层）
2. **快慢分离**——Redis 快存储 + PG 真持久化
3. **接口统一实现分化**——Node/Python/Go 各自实现但协议一致
4. **延迟不可逆决策**——硬编码 DAG 先够用，配置化等需求驱动
5. **可观测性是一切的基础**——没有日志和 Trace，可靠性无从谈起

下一章进入[第五章：AI Platform](chapter-05-ai-platform.md)——深入 Provider 抽象、Prompt 管理、Token 统计、SDK 设计、权限模型、模型评测。

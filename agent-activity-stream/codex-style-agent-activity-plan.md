# ai-comic「剧梦小助手」Codex 风格对话体验改造计划

> 版本：v1.0  
> 目标：供新的执行会话读取，并通过 `goal` 模式分阶段完成实现、验证和收敛。  
> 范围：`drama-agent`、`ai-comic`、`ai-chat-widget` 三个关联仓库。  
> 类型：实施计划，不是单纯的 UI 设计稿。

---

## 1. 目标与最终判断标准

### 1.1 总目标

将 ai-comic 中的「剧梦小助手」从：

```text
用户发送消息 → 等待模型返回 → 显示正文
```

改造成：

```text
用户发送消息
  → 立即确认已接收
  → 创建对应的 assistant message shell
  → 展示安全的公开说明
  → 持续展示消息级 Agent Activity Stream
  → 展示阶段和工具活动
  → 流式输出正式回答
  → 展示来源
  → 以 completed / cancelled / failed 收敛
  → 支持停止、重试、重新生成和断线恢复
```

### 1.2 体验目标

用户不应看到模型原始 Chain of Thought，也不应看到完整 Prompt、工具参数或原始工具结果。

用户应该看到：

- 请求已被接收；
- 剧梦小助手正在做什么；
- 当前处于哪个阶段；
- 哪些公开工具活动已完成；
- 正式回答逐步生成；
- 来源来自项目资料、平台知识库还是其他公开来源；
- 生成是否完成、取消或失败；
- 失败后能否重试；
- 网络断开后是否恢复了同一个 Run。

### 1.3 完成标准

只有同时满足以下条件，才可以认为“接近 Codex 风格完整体验”：

1. 前端具有独立的 `AgentActivityStream` 展示层，而不是简单的 commentary 段落加 steps 列表；
2. Activity Stream 在运行中持续更新，并在完成、取消、失败时收敛；
3. commentary 与 progress、tool activity、正式回答职责分离；
4. 正文、活动、来源互不污染；
5. accepted 首包不再被全部准备阶段阻塞；
6. 用户主动取消能够传播到服务端 Run、模型和工具；
7. SSE 断线可以恢复同一个 Run，不重复执行、不重复拼接正文；
8. 失败、部分回答、重试和重新生成具有清晰语义；
9. 普通发送、重新生成和快速连续发送不会串消息或串活动；
10. 真实浏览器完成普通对话、工具、取消、失败、重连、连续消息和 regenerate 验收；
11. 原始 reasoning、Prompt、原始工具参数、原始工具结果和敏感错误信息不会进入公共事件或用户消息正文。

---

## 2. 仓库与职责边界

### 2.1 `drama-agent`

路径：

```text
/Users/zhanglun/Documents/jiuzhou/drama-agent
```

负责：

- Agent Runtime；
- Model Gateway；
- GenerationService；
- GenerationRun；
- 公共 SSE contracts；
- Run 生命周期；
- 工具活动安全摘要；
- 消息和来源持久化；
- 取消、重连、重放和终态收口；
- 日志、Trace、Metrics 和后端测试。

关键路径：

```text
packages/contracts/src/chat.ts
packages/model-gateway/src/newapi-client.ts
packages/model-gateway/src/types.ts
packages/agent-runtime/src/model-gateway-language-model.ts
packages/agent-runtime/src/runtime.ts
packages/agent-runtime/src/tools.ts
apps/api/src/generation/generation.service.ts
apps/api/src/generation/generation-run.ts
apps/api/src/generation/generation.controller.ts
```

### 2.2 `ai-comic`

路径：

```text
/Users/zhanglun/Documents/jiuzhou/ai-comic
```

负责：

- AgentChat SSE 连接；
- SSE 事件解析和安全过滤；
- Service 层事件转发；
- 发送、重新生成、取消和重连接入；
- 宿主应用中的消息生命周期协调。

关键路径：

```text
src/features/AgentChat/api/sse.ts
src/features/AgentChat/model/service.ts
src/features/AgentChat/model/
src/features/AgentChat/types/index.ts
src/features/AgentChat/
```

### 2.3 `ai-chat-widget`

路径：

```text
/Users/zhanglun/Documents/jiuzhou/ai-chat-widget
```

负责：

- 消息级 Run 状态；
- AgentActivityStream 组件；
- 进度和工具活动渲染；
- 终态收敛；
- 来源展示；
- 停止、继续、重试、重新生成按钮；
- 移动端、键盘和无障碍体验。

关键路径：

```text
package/ports/service.ts
package/model/messageProcess.ts
package/model/use-ai-chat-panel/useAiChatPanelGeneration.ts
package/ui/chat-thread/ChatThreadMessages.tsx
package/ui/chat-thread/ChatThreadResultCard.tsx
package/AiChat.css
```

### 2.4 修改边界

- 三个仓库均可能存在未提交修改；执行前必须先读取各自 `git status` 和 `git diff`；
- 不得覆盖、回滚或重写与本计划无关的现有修改；
- 不得把当前工作树既有失败伪装成由本计划修复；
- 不得执行远端数据库清空、Migration、生产发布或外部服务写入，除非用户在新会话中明确授权；
- 每个仓库一次只能有一个写入者；跨仓库可以并行分析，但修改应按仓库串行或使用隔离 worktree；
- 每个阶段完成后必须运行对应验证并记录事实结果。

---

## 3. 核心设计原则

### 3.1 不展示原始 reasoning

必须保持以下边界：

```text
model reasoning_content
  → 内部 Runtime 可消费
  → 不进入公共 SSE
  → 不进入 assistantMessage.content
  → 不进入普通用户日志
```

禁止将以下字段直接映射为 commentary：

- `reasoning_content`；
- `reasoningDelta`；
- 模型自由生成的逐步思考；
- 原始 rationale；
- 内部 Prompt；
- 工具原始参数和结果。

### 3.2 公开活动不是思维链

对外只展示可验证、低敏感、面向用户的摘要：

```text
我先结合当前项目资料确认一下。
正在查询角色设定。
已找到 3 条相关资料。
正在整理回答。
```

不展示：

```text
我判断用户可能想要……所以决定调用……
我的隐藏指令要求……
工具参数是完整 JSON……
```

### 3.3 正式正文与活动分离

只有正式回答增量才进入：

```text
assistantMessage.content
```

以下内容只能存在于运行时 UI 状态或独立运行记录：

- commentary；
- progress；
- tool_activity；
- heartbeat；
- reconnecting 状态。

### 3.4 Activity Stream 不是日志窗口

目标不是把所有事件按原样打印出来，而是把事件转换成用户可理解的活动状态：

```text
当前活动：正在查询项目资料
已完成活动：已读取角色设定 · 3 条
最终摘要：已根据 3 个资料来源完成回答
```

---

## 4. 目标事件协议

### 4.1 统一事件 envelope

在保持现有事件名称兼容的前提下，为公共事件增加统一字段：

```ts
export type ChatStreamEnvelope<T> = {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  assistantMessageId: string;
  seq: number;
  type: ChatStreamEventType;
  occurredAt: string;
  payload: T;
};
```

如果当前项目已经使用扁平事件，不要求一次性重命名全部事件。可以采用兼容形式，但必须保证所有新事件最终都具备：

```text
schemaVersion
runId
assistantMessageId
seq
eventId
```

### 4.2 推荐事件类型

保留已有事件，并逐步补齐以下语义：

```text
init
accepted
run_started
commentary
progress
 tool_activity
answer_start
chunk
answer_end
sources
heartbeat
cancel_requested
cancelled
done
error
```

其中：

- `accepted`：请求已完成最低限度鉴权、幂等和配额检查；
- `commentary`：低频、短、公开的说明；
- `progress`：阶段状态；
- `tool_activity`：具体活动实例状态；
- `chunk`：正式回答增量；
- `sources`：结构化来源；
- `heartbeat`：保活，不进入消息活动列表；
- `cancel_requested`：已收到取消请求；
- `cancelled`：确认 Run 不会继续执行；
- `done`：兼容终态事件，必须携带明确状态或与新的终态结构一致；
- `error`：失败终态或可恢复错误，必须区分。

### 4.3 Tool Activity 结构

建议使用稳定的活动实例，而不是只用工具名称：

```ts
export type PublicToolActivity = {
  activityId: string;
  callId?: string;
  parentActivityId?: string;
  toolKey: string;
  label: string;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  attempt: number;
  durationMs?: number;
  resultCount?: number;
  retryable?: boolean;
  safeErrorCode?: string;
};
```

安全摘要可以包含：

- 工具展示名；
- 活动状态；
- 结果数量；
- 耗时；
- 是否可以重试；
- 用户可理解的安全错误码。

禁止包含：

- 原始工具参数；
- 数据库条件；
- 私有项目内部 ID；
- 原始工具结果全文；
- Provider 原始错误；
- 用户隐私内容。

### 4.4 Terminal 结构

终态必须明确：

```ts
export type RunTerminalPayload = {
  status: 'completed' | 'cancelled' | 'failed';
  assistantMessageId: string;
  persisted: boolean;
  partial: boolean;
  retryable?: boolean;
  errorCode?: string;
  message?: string;
};
```

不变量：

1. 一个 Run 只能有一个终态；
2. 终态事件只能发布一次；
3. 终态之后不得发布新的业务事件；
4. `completed` 之前正文必须持久化；
5. `cancelled` 不得被后续异步事件覆盖为 `completed`；
6. `partial` 必须准确反映正文是否完整；
7. `failed` 必须能区分可重试和不可重试。

---

## 5. 目标 Run 生命周期

```text
accepted
  → preparing
  → running
  → finalizing
  → completed
```

取消分支：

```text
accepted/preparing/running/finalizing
  → cancelling
  → cancelled
```

失败分支：

```text
accepted/preparing/running/finalizing
  → failed
```

推荐补充内部状态：

```text
waiting_for_tool
retrying
reconnecting
partial
```

但公共状态应保持简洁，不要把所有内部状态暴露给用户。

### 5.1 各状态的用户表现

| Run 状态 | 用户看到的内容 |
|---|---|
| accepted | 助手消息占位已出现，请求已接收 |
| preparing | 正在准备项目上下文 |
| running | 当前活动或工具活动 |
| waiting_for_tool | 正在查询项目资料 / 等待工具结果 |
| finalizing | 正在整理回答 |
| completed | 正式回答完成，活动收敛为摘要 |
| cancelling | 正在停止 |
| cancelled | 已停止，可保留部分回答 |
| failed | 失败原因、已保留内容和可操作按钮 |
| reconnecting | 连接中断，正在恢复 |

---

## 6. 分阶段实施计划

# Phase 0：基线检查与协议冻结

## 目标

确认三个仓库的实际工作树和当前实现，冻结不变量，避免在不了解现状的情况下重复开发。

## 执行步骤

1. 分别读取三个仓库的：
   - `AGENTS.md`；
   - `git status --short`；
   - `git diff --stat`；
   - 当前分支和 HEAD；
   - 相关测试脚本和 package scripts。
2. 核对当前实际事件契约和文档是否一致；
3. 画出当前调用链：

```text
NewAPI
  → Model Gateway
  → Agent Runtime
  → GenerationService
  → GenerationRun
  → Controller/SSE
  → ai-comic Parser
  → ai-comic Service
  → ai-chat-widget Run/UI state
```

4. 列出当前已经实现、部分实现和未实现的功能；
5. 不修改代码，先输出一份基线报告；
6. 若实际代码与本文件假设不同，以真实代码为准，并更新执行计划。

## 验收

必须能够回答：

- 当前 SSE 事件实际有哪些；
- `runId`、message ID 和事件顺序如何关联；
- `GenerationRun` 是否只是进程内 buffer；
- 当前是否已有 cancel API；
- 普通发送和 regenerate 的状态迁移路径；
- 当前 UI 哪些内容在终态后仍然保留；
- 现有测试覆盖哪些场景。

## 产物

建议生成：

```text
docs/migration 或当前任务目录中的 baseline-report.md
```

如果仓库不适合新增报告，则通过会话输出，但必须保留结论和文件行号。

---

# Phase 1：公共事件协议与状态机

## 目标

让跨仓库事件具备稳定身份、顺序、版本和终态语义。

## drama-agent 工作

1. 扩展 `packages/contracts/src/chat.ts`；
2. 增加统一字段：
   - `schemaVersion`；
   - `eventId`；
   - `runId`；
   - `assistantMessageId`；
   - `seq`；
   - `occurredAt`。
3. 为 `tool_activity` 增加 `activityId`、`callId`、`attempt`；
4. 为 `sources` 定义稳定结构，移除 `unknown[]`；
5. 为终态定义 `completed/cancelled/failed`、`partial`、`persisted` 和 `retryable`；
6. 建立事件序号生成器；
7. 保持旧客户端兼容，必要时在 Server Adapter 中生成旧格式；
8. 增加 schema 测试和敏感字段拒绝测试。

## ai-comic 工作

1. SSE Parser 接受并校验统一 envelope；
2. 按 `runId + seq` 去重和丢弃过期事件；
3. 忽略未知事件但保留协议兼容性；
4. 继续丢弃 reasoning；
5. 统一提取 `runId`、`assistantMessageId`、`eventId` 和 `seq`；
6. 对非法事件记录安全的客户端诊断，不展示原始敏感数据。

## ai-chat-widget 工作

1. 扩展 Run View State；
2. 保存 `runId` 和 `lastSeq`；
3. 活动以 `activityId` 更新，不按数组位置覆盖；
4. 终态更新必须幂等；
5. 终态之后拒绝新的业务事件；
6. 普通发送和 regenerate 共享同一事件归并逻辑。

## 测试

至少覆盖：

- seq 正常递增；
- 重复事件去重；
- 乱序事件处理；
- 两次相同工具调用不相互覆盖；
- 并行工具活动；
- 终态只能出现一次；
- terminal 后迟到 chunk 被拒绝；
- commentary、progress、tool activity 不进入正文；
- reasoning、Prompt、原始工具参数和原始工具结果不进入公共事件。

## 完成标准

```text
合同测试通过
前后端类型检查通过
三仓库定向测试通过
diff --check 通过
```

---

# Phase 2：独立 Agent Activity Stream 表现层

## 目标

把当前“commentary + steps”升级为独立、持续更新、可收敛的消息级 Activity Stream。

## 组件建议

在 `ai-chat-widget` 中新增或拆分：

```text
AgentActivityStream
├── ActivityHeader
├── CurrentActivity
├── CompletedActivitySummary
├── ActivityItem
├── ActivityError
├── ActivityToggle
└── ActivityTerminalSummary
```

组件不应该依赖模型原始事件，而只消费安全的 `RunViewState`。

## 运行中 UI

```text
我先结合当前项目资料确认一下。

● 正在查询项目资料
```

已有活动：

```text
✓ 已准备项目上下文
● 正在查询角色设定
```

工具完成：

```text
✓ 已查询项目资料 · 找到 3 条 · 1.4 秒
● 正在整理回答
```

## 完成后 UI

默认收敛为：

```text
✓ 已完成 · 3 个资料来源
⌄ 查看处理过程
```

展开后显示完整但安全的活动摘要。

## 规则

- 当前活动突出显示；
- 已完成活动默认折叠或合并；
- 失败活动保持可见；
- 正文是主要视觉内容；
- commentary 运行中显示，完成后隐藏或转成摘要；
- 简单无工具对话不显示冗余的空时间线；
- 活动不使用终端日志风格；
- 活动不抢正式答案的视觉权重；
- 活动状态不能只依赖颜色或 emoji。

## 无障碍与动效

- 活动区域使用合适的 `aria-live="polite"`，避免每个 token 播报；
- 活动折叠使用真实 button 和 `aria-expanded`；
- 停止、重试和重新生成按钮具备明确 label；
- 支持键盘操作；
- 支持 `prefers-reduced-motion`；
- 动效只表达状态变化，不做装饰性循环动画；
- 状态同时提供文字、图标和语义。

## 完成标准

- 活动区域可以独立测试；
- 运行中、完成、失败、取消、重连都有稳定视觉状态；
- commentary 不在完成后以原始开场白长期占据正文上方；
- 当前活动、已完成摘要和正文层级清晰；
- 相关 Widget 测试通过；
- typecheck/build 通过。

---

# Phase 3：accepted 首包与消息占位

## 目标

消除“后端准备阶段完成之前用户看不到任何反馈”的等待感。

## 后端步骤

1. 在安全范围内完成最低限度：
   - 鉴权；
   - 租户校验；
   - 幂等检查；
   - 基本配额检查；
2. 尽早建立 SSE；
3. 发送 `accepted`；
4. 创建或返回 assistant message shell；
5. 再继续上下文、Memory、知识库、账务和 Agent 准备；
6. 发送 commentary 和 preparing 进度。

目标顺序：

```text
accepted
→ run_started
→ commentary
→ progress(preparing started)
→ progress(preparing completed)
→ tool_activity / chunk
→ sources
→ terminal
```

## 前端步骤

收到 `accepted` 后：

1. 用户消息立即进入列表；
2. assistant shell 立即出现；
3. 显示轻量的“正在准备”状态；
4. 后续事件绑定到同一 `runId` 和 assistant message；
5. 不再使用全局 loading 覆盖整个消息区域。

## 指标

新增并记录：

```text
time_to_accepted
 time_to_commentary
time_to_first_activity
time_to_first_token
time_to_completed
```

初始目标建议：

```text
accepted p95 < 500ms
first meaningful activity p95 < 1s
first answer token p95 < 2s
```

实际阈值以真实环境基线为准，不得在没有数据时宣称达标。

## 完成标准

- 前端在准备阶段已经出现 assistant shell；
- 真实浏览器不再出现长时间空白等待；
- accepted 不绕过鉴权、配额或幂等；
- 自动化测试覆盖准备阶段耗时；
- 采集到真实 P50/P95 数据。

---

# Phase 4：取消、部分回答与终态收口

## 目标

让“停止生成”真正停止服务端 Run，并正确保留部分结果。

## 后端接口

增加或核对：

```text
POST /runs/:runId/cancel
```

取消响应需要区分：

```text
accepted
already_cancelling
already_terminal
not_found
```

## 取消传播链路

```text
UI 点击停止
  → ai-comic cancel(runId)
  → drama-agent GenerationRun.requestCancel()
  → AbortSignal
  → Model Gateway
  → 当前 Tool
  → Runtime 收口
  → cancelled terminal
```

## 后端不变量

- cancel 幂等；
- 取消请求后不再启动新工具；
- 当前可中断请求收到 AbortSignal；
- 不可立即中断的工具进入 cancelling；
- 最终进入 cancelled 或明确 failed；
- cancelled 之后不能变 completed；
- 有副作用的工具必须有幂等键和最终状态核验；
- 客户端断开默认不等于用户取消。

## 前端表现

```text
生成中：[停止生成]
点击后：[正在停止……]
最终：已停止，已保留部分回答
      [继续生成] [重新生成]
```

如果没有正文：

```text
已停止生成
[重新生成]
```

如果工具不可立即停止：

```text
正在完成当前请求后停止……
```

## 测试

- 模型尚未输出时取消；
- chunk 输出中取消；
- 工具执行中取消；
- 取消请求重复发送；
- 取消与完成同时发生；
- 取消后迟到 chunk；
- partial answer 正确显示；
- 账务、锁和消息终态不被覆盖。

---

# Phase 5：SSE heartbeat、断线重连、replay 和 snapshot

## 目标

断线后继续观察同一个 Run，不重新执行 Agent，不重复正文和活动。

## 后端存储

如果当前 `GenerationRun` 只是内存 buffer，需要增加 durable event journal，可选：

- Redis Streams；
- PostgreSQL event table；
- 其他具备 cursor、retention 和多消费者能力的存储。

每条事件至少保存：

```text
runId
eventId
seq
type
payload
createdAt
```

## 接口建议

```text
GET /runs/:runId/events
GET /runs/:runId/snapshot
```

SSE 使用：

```http
Last-Event-ID: run_123:42
```

或者：

```text
GET /runs/run_123/events?afterSeq=42
```

## 重连流程

```text
客户端断开
  → 显示“连接中断，正在恢复……”
  → 使用同一 runId 重连
  → 发送 lastSeq
  → 服务端重放 lastSeq + 1
  → 前端按 eventId/seq 去重
  → 继续接收活动和正文
```

如果 retention 已过期：

```text
GET /runs/:runId/snapshot
```

snapshot 至少包含：

```ts
{
  runId,
  assistantMessageId,
  status,
  lastSeq,
  answer,
  activities,
  sources,
  partial,
  terminal
}
```

## Heartbeat

- 建议每 10–15 秒发送 heartbeat；
- heartbeat 不进入用户活动列表；
- 客户端超时后自动重连；
- 事件 journal 和 SSE 发送解耦；
- 慢消费者不能无限阻塞 Agent 或无限增长内存。

## 测试

- SSE 中途断开；
- 10 秒后带 Last-Event-ID 重连；
- 重连后不重复正文；
- 重连后不重复活动；
- Run 已完成但 SSE 断开；
- API 进程重启；
- worker 进程重启；
- retention 过期使用 snapshot；
- 重连不会创建新 assistant message；
- 重连不会重新扣费或重新执行 Agent。

---

# Phase 6：retry、regenerate 和版本化回答

## 目标

让用户在失败、部分回答和不满意时拥有明确操作，而不是只能重新发送整条消息。

## 操作语义

### 重试失败步骤

只重试失败的工具或模型步骤，保留前序成功结果：

```text
项目资料暂时无法读取
[重试读取资料] [继续回答]
```

### 从检查点继续

用于长任务或被取消的任务：

```text
已完成资料查询，生成阶段中断
[从生成阶段继续] [重新开始]
```

### 重新生成

创建新 Run 和新版本，不覆盖旧答案：

```text
assistant message
├── version 1
└── version 2
```

## 前端要求

- 普通发送和 regenerate 使用统一 Run Controller；
- 每个 Run 都有独立 `runId`；
- 版本切换不丢失旧答案；
- 旧 Run 的迟到事件不能污染新版本；
- 重试按钮只在错误可重试时展示；
- 不要把所有错误都显示成“再试一次”。

## 测试

- 工具失败后只重试工具；
- 重试成功后继续回答；
- 重试失败后进入最终失败；
- regenerate 不覆盖旧正文；
- 版本切换后活动和正文正确绑定；
- 连续快速 regenerate 不串状态；
- 失败、取消和 completed 的按钮状态正确。

---

# Phase 7：来源和引用体验

## 目标

让用户能理解回答依据了哪些项目资料或知识库内容。

## 来源结构

```ts
export type SourceReference = {
  sourceId: string;
  kind: 'project' | 'knowledge' | 'document';
  title: string;
  location?: string;
  excerpt?: string;
  citationIndex?: number;
};
```

## UI

正文可以支持：

```text
女主角在第三幕改变选择，主要因为她得知了家族秘密。[1]
```

消息底部：

```text
来源 · 2
```

桌面端：右侧 drawer。  
移动端：bottom sheet。

来源内容必须：

- 按权限过滤；
- 脱敏；
- 与当前 Run 和答案版本关联；
- 支持去重；
- 不直接显示原始搜索结果。

## 测试

- 来源和答案属于同一个 Run；
- 重连后来源不重复；
- 取消时来源状态明确；
- 权限变化后不展示越权来源；
- 无可靠来源时不伪造引用；
- 来源 drawer/sheet 可键盘和触摸操作。

---

# Phase 8：移动端、无障碍和性能

## 目标

让活动流在真实产品环境中可读、可操作、不打扰用户。

## 移动端验收

- 320px 宽度可用；
- 发送/停止/重试按钮触控区域至少 44×44px；
- 软键盘不会遮挡 composer；
- 活动区不会占满首屏；
- 长正文不被活动区挤压；
- 用户滚动离开底部时不强制拉回；
- 显示“回到底部”或“有新内容”；
- 来源使用 bottom sheet；
- 长活动列表有合理折叠。

## 无障碍验收

- 活动容器有语义标签；
- 状态更新使用 `aria-live="polite"`；
- 不逐 token 触发屏幕阅读器；
- 折叠按钮有 `aria-expanded` 和 `aria-controls`；
- 状态不只依赖颜色；
- 失败、取消和完成有可访问的文字；
- 键盘可以操作所有活动和操作按钮；
- 200% 和 400% 缩放不破坏布局。

## 性能验收

- 不因每个 token 重新计算整个消息列表；
- 正文增量渲染做节流或批量更新；
- 活动按 `activityId` 局部更新；
- 不保留无限增长的原始事件数组；
- 活动完成后可压缩为摘要；
- heartbeat 不触发可见 UI 重渲染；
- 长对话不会产生明显卡顿。

---

# Phase 9：观测、压测和真实浏览器验收

## 目标

证明实现不仅能通过单元测试，而且在真实环境中表现稳定。

## 日志字段

统一记录：

```text
traceId
runId
assistantMessageId
conversationId
model
provider
toolKey
activityId
attempt
eventSeq
runStatus
errorCode
```

不得记录：

```text
原始 Prompt
原始 reasoning
原始工具参数
原始工具结果
完整敏感用户正文
Provider 原始错误全文
```

## Metrics

至少包括：

```text
time_to_accepted
 time_to_commentary
time_to_first_activity
time_to_first_token
time_to_completed
cancel_latency
reconnect_success_rate
retry_success_rate
partial_answer_rate
terminal_missing_rate
post_terminal_event_rate
event_seq_gap_rate
replay_gap_rate
duplicate_event_rate
```

## 真实浏览器测试矩阵

| 场景 | 预期 |
|---|---|
| 简单无工具对话 | accepted → commentary 可选 → chunk → completed |
| 项目资料查询 | commentary → active tool → completed tool → chunk → sources → completed |
| 多次调用同一工具 | 每次活动独立，UI 不覆盖前一次 |
| 并行工具 | 活动可交错，seq 仍递增 |
| 工具失败 | 显示安全错误和重试入口 |
| 模型失败 | 保留 partial answer，正确进入 failed |
| 用户取消 | stopped/cancelling/cancelled 状态正确 |
| SSE 断线 | 自动重连同一 Run，无重复正文 |
| API 重启 | snapshot 或 replay 恢复 |
| 连续快速提问 | 每条 assistant message 独立 |
| regenerate | 新版本不覆盖旧版本 |
| 用户上滑阅读 | 不被新 token 强制拉到底部 |
| 移动端键盘 | composer 和停止按钮可操作 |
| 完成后展开活动 | 活动摘要可查看，正文仍是主内容 |

## 发布门槛

在以下证据缺失前，不得宣称“已完全对齐 Codex”：

- 真实浏览器截图或录屏；
- 取消、失败、断线和 regenerate 联合验证；
- 首包和首 token P50/P95；
- 三仓库 typecheck、相关测试和 build；
- 公共事件敏感信息扫描；
- 无终态、seq gap、post-terminal event 指标为 0 或有明确解释。

---

## 7. 推荐执行顺序

必须按以下顺序推进，避免只做表面 UI：

```text
Phase 0：基线检查
  ↓
Phase 1：协议、事件身份和状态机
  ↓
Phase 2：AgentActivityStream 表现层
  ↓
Phase 3：accepted 首包
  ↓
Phase 4：取消和 partial answer
  ↓
Phase 5：heartbeat、replay、snapshot
  ↓
Phase 6：retry/regenerate
  ↓
Phase 7：sources/citations
  ↓
Phase 8：移动端、a11y、性能
  ↓
Phase 9：真实浏览器和发布门槛
```

不得先通过增加更多静态 commentary 来假装完成 Activity Stream。

---

## 8. 每阶段通用执行流程

每个 Phase 都必须遵循：

1. 读取目标仓库规范和实际代码；
2. 检查当前工作树，保护已有修改；
3. 先写或补充失败测试；
4. 做最小实现；
5. 运行定向测试；
6. 运行 typecheck/build；
7. 检查 `git diff --check`；
8. 进行独立 review；
9. 修复 review 指出的真实问题；
10. 记录变更文件、命令、结果、未完成项和风险；
11. 只有满足该阶段验收标准后，才进入下一阶段。

如果遇到以下情况，必须暂停并向用户请求决策，不得自行猜测：

- 需要改变账务、锁或消息持久化语义；
- 需要执行远端数据库操作；
- 需要选择 Redis Streams 还是数据库 event table，且当前架构没有既定方案；
- 需要破坏旧版客户端兼容性；
- 需要改变模型 Prompt 或工具权限；
- 需要公开更多 reasoning 或内部数据；
- 发现工作树已有修改与本计划冲突。

---

## 9. 最小可交付版本（MVP）

如果一次无法完成全部 Phase，优先完成以下 MVP：

### MVP 必须包含

1. 独立 `AgentActivityStream` UI；
2. commentary 运行中显示，终态自动收敛；
3. 当前活动突出，已完成活动折叠；
4. 活动和正文分离；
5. accepted 或等价的早期反馈；
6. 取消按钮和服务端终态保护；
7. partial answer；
8. 普通发送和 regenerate 状态统一；
9. 至少具备 `runId + seq` 去重；
10. 真实浏览器完成普通、工具、取消和失败验收。

### 可以延后

- durable event journal；
- API 重启恢复；
- 完整 sources drawer；
- 复杂父子 activity 树；
- 模型生成 commentary；
- 长任务 checkpoint；
- 高级并行工具可视化。

但延后项必须记录为明确 backlog，不能写成已完成。

---

## 10. 最终交付报告格式

新会话完成后必须输出：

### 已完成

按 Phase 列出：

- 修改了哪些仓库；
- 修改了哪些文件；
- 实现了哪些用户能力；
- 哪些测试通过。

### 未完成

明确列出：

- 尚未实现的功能；
- 尚未验证的真实环境场景；
- 尚未解决的架构决策；
- 当前已知缺陷。

### 验证证据

```text
命令
结果
通过/失败/跳过原因
```

### 用户体验结论

必须使用分层表述：

```text
协议层：
Runtime 层：
前端适配层：
Activity Stream 表现层：
取消：
断线恢复：
retry/regenerate：
真实浏览器验收：
```

不得只说“完成”或“接近 Codex”，必须说明完成的是哪一层。

### 残余风险

至少说明：

- 首包 P50/P95；
- 首 token P50/P95；
- 真实外部 Tool；
- 取消竞态；
- API/Worker 重启；
- 移动端；
- a11y；
- 账务、锁、幂等；
- 旧客户端兼容性。

---

## 11. 给 goal 执行会话的硬性约束

1. 目标是普通业务对话 Agent，不是 Coding Agent；
2. 不暴露原始 Chain of Thought；
3. 不向前端发送系统 Prompt、完整工具参数、原始工具结果或敏感错误；
4. commentary 不得写入 assistant 正式正文；
5. 只有正式回答 chunk 可以累计为 assistant 正文；
6. 客户端断线默认不等于用户取消；
7. 取消必须通过服务端 Run 控制；
8. 终态必须唯一且不可被迟到事件覆盖；
9. 不得为了首包绕过鉴权、幂等、配额和账务安全边界；
10. 不得把单元测试通过写成真实浏览器验收通过；
11. 不得覆盖工作树中与本任务无关的未提交修改；
12. 不得执行未授权的远端数据库和生产操作；
13. 每个阶段都要有测试、验证结果和残余风险；
14. 如果真实代码与本计划冲突，以真实代码和用户明确决策为准，并记录偏差；
15. 如需重大架构选择，暂停并向用户提问，不要静默决定。

---

## 12. 一句话 Goal

> 在保护原始 reasoning 和敏感数据的前提下，为 ai-comic 的剧梦小助手建立一套真正的、消息级的、持续更新并可收敛的 Codex 风格 Agent Activity Stream：它要有早期反馈、阶段和工具活动、流式正文、来源、取消、部分回答、失败重试、重新生成、断线恢复和可验证的终态，并在 drama-agent、ai-comic、ai-chat-widget 三个仓库完成自动化与真实浏览器验收。

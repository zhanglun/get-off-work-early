# Agent Tools 调用失败的全生命周期处理

> 从模型生成 Tool Call，到参数校验、权限控制、工具执行、结果校验、重试、补偿、降级和审计。
>
> 读者读完应该能回答三个问题：一次工具调用会在哪里失败；每一类失败由谁负责、怎么恢复；错误信息应该以什么形状回到模型。
>
> 文中所有框架行为、事故细节和研究数字均来自 2026-09 的调研核实（来源见文末），调研原始数据在 [agent-tool-failure-research/report.md](../agent-tool-failure-research/report.md)。主线框架是 Mastra；工具本身怎么设计（Description 工程、参数与返回值）见姊妹篇 [为 Agent 设计文件工具](../agent-file-tools.md)，本文只讲一件事：**它们失败的时候怎么办**。

## 1. 你写的第一个 Tool，大概率没考虑过失败

回忆一下你写的第一个 Agent Tool。大概率长这样：

```ts
const searchOrders = createTool({
  id: 'search-orders',
  description: '查询订单',
  inputSchema: z.object({ customerId: z.string() }),
  execute: async ({ customerId }) => {
    return await db.orders.findByCustomer(customerId);  // 顺利的话
  },
});
```

顺利的话，它工作得很好。然后在真实用户手里，它开始以你没想到的方式失败：

- 用户上传的文件还在解析，模型调了 `file.search`，返回了空数组——模型得出结论"文件里没有相关内容"，一本正经地告诉用户。实际上是**还没解析完**；
- 检索没有命中，模型换个措辞连调五次 `file.search`，每次都空手而归，五轮 Token 烧完，没有回答；
- 用户重复点了上传，两次 `registerUpload` 入队了两个解析任务，同一份文件被处理了两遍；
- 工具抛了个异常，整个 Agent Run 崩掉，用户看到的是一个堆栈错误页；
- 最糟的一种：导出工具超时了，你以为没成功，重试了一次——用户收到了两份导出文件。**副作用执行了两遍**。

这些场景没有一个发生在"模型不够聪明"上，全部发生在"失败路径没被设计"上。2025 年 7 月的两起真实事故只是把这个问题推到了极端：Replit 的 coding agent 在用户明确 code freeze 期间删掉了生产库（AI Incident Database #1152）；安全研究者演示了 Cursor 经 Supabase MCP 完整外泄数据库（详见第 7 章）。Happy path 人人都会写，**失败路径才是工程**。

一个 Agent Tool 调用不是"模型调用函数"这么简单，而是一条跨越多个边界的 pipeline：

```text
用户意图
  ↓
模型生成 Tool Call
  ↓
Agent Runtime 解析调用
  ↓
输入 Schema 校验
  ↓
Tool 内部业务校验
  ↓
权限 / 安全 / 状态检查
  ↓
真正执行：数据库、API、文件系统、MCP 服务
  ↓
输出结果归一化与结果校验
  ↓
Tool Result 返回模型
  ↓
模型决定：继续调用、修正、询问、降级或结束
```

模型的作用是"提出下一步行动"，而不是提供最终安全边界。真正的安全边界必须位于 Tool 实现和服务端。这篇文章沿着这条 pipeline 走两遍：第一遍（第 2–4 章）看**失败发生在哪一层、由谁负责**；第二遍（第 5–10 章）按处理动线走——**收到失败之后，你一步步该怎么办**。

## 2. 贯穿案例：一组文件工具

用户上传了一份 `服务协议.docx`，然后说："付款周期是多少？总结一下退款规则。"

Agent 需要四个工具（设计细节在姊妹篇，这里只列骨架）：

```ts
const registerUpload = createTool({
  id: 'file-upload-register',
  inputSchema: z.object({
    fileName: z.string(),
    objectKey: z.string(),        // OSS 直传后的定位
  }),
  // 副作用：写 documents/attachments/revisions 三张表 + 投递解析任务
  execute: async ({ fileName, objectKey }, { mastra }) => { /* ... */ },
});

const fileSearch = createTool({
  id: 'file-search',
  inputSchema: z.object({ query: z.string() }),
  // 只读：在当前 Revision 的 Segment 内混合检索
  execute: async ({ query }, { mastra }) => { /* ... */ },
});

const fileRead = createTool({
  id: 'file-read',
  inputSchema: z.object({
    segmentId: z.string().optional(),
    page: z.number().int().optional(),
  }),
  // 只读：按位置回读原文，登记 Evidence
  execute: async (args, { mastra }) => { /* ... */ },
});

const fileSummarize = createTool({
  id: 'file-summarize',
  inputSchema: z.object({}),
  // 长任务：层级摘要，可能 partial
  execute: async (_, { mastra }) => { /* ... */ },
});
```

理想情况下这条链是：`file.search("付款周期")` → `file.read(seg_123)` → 回答。但真实用户手里，每个环节都可能出现下面这些调用：

```text
file.search({ query: 123 })                          // Schema 层：类型错误
file.read({ segmentId: "刚才第二段" })                 // Schema 层：自然语言当 ID
file.search({ query: "付款周期" })  // 文件还在解析    // 业务层：NOT_READY
file.search({ query: "海外付款" })  // 文件里没有      // 业务层：NO_MATCH
file.read({ segmentId: "seg_999" })                   // 业务层：NOT_FOUND
file.upload-register(...)   // 用户双击了两次上传       // 副作用层：重复执行
file.read({ segmentId: "seg_123" })  // 检索服务超时   // 执行层：结果未知
file.summarize({})     // 20% 章节摘要失败             // 结果层：partial
```

最后一种值得多看一眼：**参数合法、工具存在、权限通过，调用仍然失败**——而且是最危险的一类，因为副作用可能已经提交。这个案例同时覆盖只读工具（search/read）和副作用工具（upload-register），后面每一章都会回到它。

## 3. "调用失败"的完整分类

### 3.1 模型输出与协议层失败

这类错误发生在业务 Tool 执行之前：

- JSON 截断或语法错误
- Tool Call envelope 格式错误
- 工具名称不存在
- `call_id` 缺失或无法关联
- 多轮消息顺序不符合供应商协议
- 流式参数片段没有正确聚合——Gemini 文档明确要求"必须先聚合这些增量再重建完整调用"

各家 provider 对这一层的防护不同。OpenAI 的 strict 模式在**请求时**就拒绝不合规的 schema（缺 `additionalProperties: false` 或未全标 required 直接报错并指出缺失约束）；Gemini 把"模型被强制在工具调用前输出结构化文本"导致的畸形调用命名为 `Malformed_Function_Call`，官方建议把工具前的说明收进专用的 `update()` 函数调用；Anthropic 的 strict tool use 保证输入始终匹配 schema。Vercel AI SDK 给出最细的类型化分类：`NoSuchToolError`、`InvalidToolInputError`、`ToolCallRepairError`、`ToolChoiceViolationError` 四类，全部可以用 `.isInstance(error)` 判别。

处理方式：Runtime 拒绝执行，生成明确的协议错误。是否反馈模型并重试，取决于 Agent 框架；不能假设一定自动发生。

### 3.2 输入 Schema 失败

- 缺少必填字段
- 类型错误，例如 `query: 123`
- 枚举值错误
- 字符串长度、数字范围或正则不满足
- 多余字段
- 嵌套对象结构错误

Schema 的作用是约束"参数形状"。它不能证明 segmentId 存在，也不能证明用户有权限读这个 Revision。`file.read({ segmentId: "刚才第二段" })` 能通过任何"非空字符串"校验——位置类参数必须来自系统生成的 ID，这一点姊妹篇的参数设计五原则已经覆盖。

### 3.3 参数规范化失败

一些低风险转换可以由开发者明确允许：

```text
"30" → 30
"2026/08/27" → "2026-08-27"
```

但自动修复不是默认正确答案。对文件路径、删除目标、权限范围、覆盖写入这类高风险字段，静默猜测可能产生实际副作用。此时应拒绝、要求模型重试，或询问用户确认。

### 3.4 Tool 业务层失败

即使 Schema 通过，Tool 仍要再次执行业务校验。文件工具的业务错误码在姊妹篇定义过，这里按失败原因归类：

- `NOT_READY`——文件还在解析（queued/parsing）。注意它和 NO_MATCH 的天壤之别：一个说"等等再试"，一个说"别试了"；
- `NO_MATCH`——当前文件中没有相关内容。模型不该换措辞无限重试；
- `NOT_FOUND`——segmentId 不存在或不属于当前 Revision；
- `PERMISSION_DENIED`——Attachment 不属于当前用户/Session；
- `CONFLICT`——Revision 已被替换。

这些检查必须由 Tool 或服务端完成，不能让模型代替鉴权和状态判断。

### 3.5 Tool 执行与外部系统失败

- 数据库连接失败
- HTTP 5xx
- 网络断开
- 超时——检索服务没在时限内返回
- 第三方限流
- MCP Server 不可用
- Tool 内部未捕获异常

要区分临时错误和永久错误：

| 错误 | 通常可重试？ | 典型策略 |
|---|---:|---|
| 连接重置 | 是 | 指数退避，限制次数 |
| HTTP 429 | 通常是 | 遵循 `Retry-After` |
| HTTP 5xx | 通常是 | 有上限的传输层重试 |
| 请求参数错误 | 否 | 修正参数，不要盲目重试 |
| 无权限 / NOT_FOUND | 否 | 告知用户或换查询方式 |
| NO_MATCH | 否 | 换个问题或确认目标文件，不是重试 |
| NOT_READY | 是（稍后） | 告知用户等待，别空转重试 |
| 未知工具 | 可让模型修正 | 反馈可用工具列表 |

### 3.6 Tool 输出与结果层失败

不要只校验输入，也要校验输出。文件工具的典型输出问题：

- read 返回的原文与库中 Segment 不一致（版本错配）
- search 返回的候选里混入了其他文件的结果（范围泄漏）
- summarize 报告 `completed`，但 Coverage 显示关键章节失败——**错误的成功比明确的失败更危险**，因为模型会把它继续传播给用户
- 返回了超出授权范围的内容

MCP 是目前唯一把输出校验写进协议的规范：工具可声明 `outputSchema`，提供时服务端 **MUST** 返回符合 schema 的 `structuredContent`，客户端 **SHOULD** 校验。

### 3.7 编排与运行控制失败

即使单次 Tool 没有异常，Agent Run 也可能失败：

- 连续重试超过预算——模型对 NO_MATCH 换措辞连调五次就是这种；
- Agent 循环次数达到上限
- Token 或总时间预算耗尽
- 并行工具调用中部分成功、部分失败
- 用户取消任务
- 高风险操作等待确认超时
- 熔断器打开

MAST（Why Do Multi-Agent LLM Systems Fail?，NeurIPS 2025）的失败分类研究发现，无限循环是实测中最常见的失败模式之一，而且多数失败源于编排设计而非单模型能力——终止语义不是锦上添花，是核心防线。

## 4. 每一层到底由谁负责？

| 层 | 主要职责 | 是否能只交给模型？ |
|---|---|---:|
| LLM | 选择 Tool、生成参数、根据反馈尝试修正 | 否 |
| Provider API | 生成结构化 Tool Call、提供 strict/structured output 能力 | 否 |
| Agent Runtime | 解析、路由、消息关联、重试编排 | 否 |
| Input Schema | required、type、enum、范围、额外字段 | 否 |
| Tool 实现 | 业务规则、资源存在性、幂等、异常捕获 | 绝对不能 |
| Auth/Policy | 权限、租户、资源范围、人工审批 | 绝对不能 |
| 服务端 | 最终鉴权、事务、一致性、限额、状态机 | 绝对不能 |
| Output Validator | 结果结构、敏感信息、语义一致性 | 否 |
| Recovery | 重试、降级、熔断、询问、终止 | 否 |
| Audit | 记录调用、参数摘要、决策、结果、耗时 | 否 |

这张表上有一个 2025 年才被认真提出的问题：**重试状态由谁保存？** Diagrid 对 Microsoft Agent Framework 的批评（《Still Not Durable》）指出：检查点可靠不等于重试持久——middleware 重试是内存态，进程崩溃即丢失。这个问题对多数 Agent 框架同样成立：Mastra 的 `StreamErrorRetryProcessor` 在流处理期间逐次重试、workflow 快照仅在 suspend 时写入，重试计数大概率同为内存态（文档未明确，源码级未验证）；LangGraph 的 RetryPolicy、Pydantic AI 的重试预算也都没有声明跨崩溃持久。目前把重试决策做成持久态的只有 Temporal 这类 durable execution 系统——重试记录进事件历史，进程崩溃后从历史确定性重放。对你的文件 pipeline 这意味着一个具体风险：解析 Worker 在第 3 次重试时崩溃，重启后从第 1 次重新数，同一份文件可能被重复解析入库。

诊断部分到此为止。下面按处理动线走：收到失败之后，一步步该怎么办。

## 5. 第一步：让模型看见错误

### 5.1 行业正在收敛的共识：错误是结果，不是异常

三个互不知情的实现给出了同一个方向：

- **Anthropic**：`tool_result` 块有可选的 `is_error: true` 字段，错误文本放 content。官方文档明确记载模型的行为——"Claude will retry 2-3 times with corrections before apologizing to the user"。收到可理解的错误后，模型会自动修正参数重试；
- **Vercel AI SDK**：工具执行错误不抛给调用方，而是作为 `tool-error` content part 加入步骤内容，官方说明是"以支持多步场景中的自动化 LLM 往返"——模型在下一步看到错误并自行换路；
- **Mastra**：官方内置的 `webFetchTool` 注释写着"Failures don't throw. The tool returns `isError: true` with the reason in `content`"——目的就是"让 agent 可以重试或向用户解释"。

对照 OpenAI 的零结构（`function_call_output` 是纯字符串，格式自定，协议层无法区分错误与正常结果），能看出这个共识不是巧合：**错误回传给模型，模型才有机会自愈；抛异常中断 Run，模型连纠正的机会都没有**。

CriticTool（首个工具调用自批评基准，arXiv 2506.13977）给了这组设计价值一个残酷的量化背景：GPT-4o 在现有基准上的错误恢复率只有 22.16%（NESTFUL）、17.39%（API-Bank）、28.57%（BFCL）——"模型收到错误后自己就能恢复"在默认情况下不成立。恢复率取决于错误信息的质量，这正是下一节的主题。

### 5.2 结构化错误返回

文件工具的错误返回应该是这个形状（姊妹篇第 4 节定义过，这里从失败处理的角度复述）：

```json
{
  "ok": false,
  "code": "NOT_READY",
  "message": "文件《服务协议.docx》正在解析中，预计 30 秒内完成。请告知用户稍候，不要重复查询。",
  "retryable": true,
  "details": { "revisionId": "rev_789", "status": "parsing" }
}
```

错误信息应当：

1. 指明失败层和错误码——NOT_READY 和 NO_MATCH 一个字之差，行为指引完全相反；
2. 指明哪个字段或哪个业务条件失败；
3. 明确 `retryable`；
4. 给出模型下一步可以采取的动作——上面 message 里那句"请告知用户稍候，不要重复查询"，就是防住"换措辞空转重试"的关键；
5. 不泄漏密钥、内部堆栈、隐私或攻击细节；
6. 让用户可见的说明与内部诊断分离。

Anthropic 的官方示例说明了什么叫"可行动"的错误：返回 `Rate limit exceeded. Retry after 60 seconds.` 而不是 `failed`——模型不需要猜测就能恢复。Pydantic AI 把这个理念做成了类型系统：`ModelRetry`（值得重试，消费重试预算，以 RetryPromptPart 形式回传"Fix the errors and try again"）与 `ToolFailed`（记录失败但不消费重试预算，改由用量上限封顶）是一对显式区分"该重试的错误"和"不该重试的失败"的原语。

还有一个容易被忽略的发现（来自 CriticTool）：**静默失败是模型最难自救的一类**。参数合法但工具选错时，GPT-4o 的自查率只有 23.42%，而幻觉工具名的自查率是 97.72%——显眼的错误模型看得见，"合法但错误"的调用模型自己看不见。错误反馈设计的价值，恰恰在于帮模型看见它自己看不见的失败。

### 5.3 修复：重试与放弃之外的第三条路

Vercel AI SDK 的 `repairToolCall` 提供了第三种处理：调用形状错误（工具不存在、参数不合法）时，不进入下一轮对话，而是在当前步内修复调用——用结构化输出让模型重新生成参数，或带着错误信息 re-ask。官方的动机很实际：修复"不会污染消息历史"，而把失败调用原样回传会占用轮次并累积噪声。返回 `null` 表示放弃修复（此时 `ToolCallRepairError` 上抛）。

对快速迭代的产品，这层的价值排序是：先保证错误能回传（is_error 形状），再考虑修复环。修复是优化，回传是底线。

## 6. 第二步：判断敢不敢重试

### 6.1 重试不是一种东西，而是多层机制

重试必须先回答"重新执行什么"：

**传输层重试**——重新发送同一个 HTTP 请求，模型通常看不到。适合连接重置、429、部分 5xx。Stripe 的 SDK 从 v13 起默认自动重试一次并自动补幂等键；各家 provider SDK 也内置了指数退避。

**Tool 参数重试**——把验证错误反馈给模型，请模型修正同一个 Tool Call。Anthropic 文档记载的"retry 2-3 times with corrections"就是这一层；Pydantic AI 的默认预算是 1、按工具名分键计数、成功即重置——一个交替失败/成功的工具不会耗尽全局预算，幻觉工具名有自己的独立预算。

**Tool 执行重试**——重新执行同一个副作用操作。必须有幂等键、去重和明确的安全策略。**"请求超时"不等于"操作没有发生"**——重新执行副作用之前，必须考虑服务端是否已经成功提交。这是全篇最重要的一句工程格言。

**模型切换**——当前模型或供应商不可用时切换备用。这不是简单的同一请求重试。

**整个 Agent Run 重试**——从更高层重新运行任务。应谨慎使用，因为可能重复所有工具副作用；需要 checkpoint、幂等和补偿事务。

推荐默认值：参数/模型重试 2–3 次；传输层遵循服务端限流提示；副作用 Tool 只有在幂等和结果不确定时才允许谨慎重试。Mastra 的官方建议可以作为跨框架参考：模型级 `maxRetries` 设为 0、把重试集中到 errorProcessors 一处——两处各重试 3 次，最坏情况是 9 次底层请求，多层重试会相乘。

### 6.2 结果三分法：敢不敢重试的判定标准

把执行结果分成三类，重试决策会清晰很多：

```text
成功          —— 副作用已提交
干净失败      —— 执行根本没开始 → 可安全重试
结果未知      —— 超时、5xx（可能已提交也可能没有）→ 必须用幂等键收敛
```

Stripe 把这个分界做成了协议行为：幂等缓存只保存"端点开始执行之后"的结果；参数校验失败和 `idempotency_key_in_use`（409）不入缓存、可安全重试——这就是"干净失败"的工程定义。对超时和 5xx，官方守则是视为结果不确定，**用同一个幂等键重放收敛，不要换新键重试**——换键等于对可能已提交的操作发起第二次执行。Stripe 甚至用 `Stripe-Should-Retry` 响应头让服务端显式回答"该不该重试"，把判定权从客户端猜测升级为服务端声明。

文件工具的对应判定：

```text
file.search 超时        → 只读，无副作用，可自由重试
file.search NO_MATCH    → 不是失败，是答案的一部分：文件里没有
registerUpload 超时     → 结果未知！同 objectKey 重放，绝不换键
解析 Worker 超时        → 同幂等键重新入队（见下一章）
```

### 6.3 别忘了预算：防"换措辞空转"

CriticTool 的权重设计是这一节最好的论据：评测里"有界重试"（retry）只占 0.05 的权重，而"知道何时跳过/何时停下来问用户"（skip/finish）合计 0.45——**知道何时停止，比机械重试重要一个数量级**。它同时记录了弱模型的真实失败模式：对 NO_MATCH 无限换措辞重试、在正确步骤上过度反思、或者幻觉答案而不是问用户。

工程对应：每个错误码在定义时就写明"模型下一步该做什么"，`NO_MATCH` 的 message 里就应当包含"不要基于常识猜测，考虑向用户确认问题或目标文件"——这正是姊妹篇第 4 节那个 NO_MATCH 返回示例的深层理由。

## 7. 第三步：保护副作用

### 7.1 幂等：你的文件 pipeline 里其实已经有一半

回到贯穿案例：`registerUpload` 是副作用工具（写三张表 + 入队）。它怎么防重复执行？姊妹篇第五章给过答案，值得从幂等视角重看：

```text
binaryHash（内容 SHA-256）     → 相同内容的上传复用解析结果（天然幂等）
任务幂等键 revisionId:parse:parser-v3 → 队列重复投递不会重复处理
```

这就是 Stripe 教科书的本地实现：**内容 hash 去重 = 服务端的幂等缓存**；`revisionId:operation:processorVersion` = 请求级唯一键。对照 Stripe 的参数细节还能发现差距：Stripe 的幂等键 24 小时过期、同键不同参数报 `idempotency_error`（防止键被误用）——你的 pipeline 对"同键不同参数"（同 revisionId 但文件内容变了）用新 Revision 解决，语义等价但更干净。

把这套推广到所有写操作类 Tool：**任何副作用工具都应支持幂等键**——要么客户端传入（业务标识组合），要么服务端从内容派生（hash）。这是"副作用工具怎么重试"的完整答案的前半段。

### 7.2 补偿：语义逆而不是状态恢复

当流程有多个步骤、中间某步失败时，需要撤销已完成的步骤。Saga 模式（Garcia-Molina & Salem，1987）的定义至今没变：保证"要么 T1..Tn 全部执行，要么逆序执行补偿 Cj..C1"。两个容易被误解的点：

- **补偿是语义逆**：撤销"生成摘要文件"不是删库回滚，是删除那份文件（可能还要清理缓存和索引）。补偿是新的业务操作，不是数据库事务回滚；
- **补偿本身必须幂等、可记录进度、可从失败点恢复**——补偿失败比原失败更糟。

Saga 论文的步骤可恢复性四分类是所有副作用声明的理论先祖：retriable（可重试）/ compensable（可补偿）/ pivot（不可补偿的临界点）/ irreversible（不可逆，应排在流程尾部）。MCP 的 Tool Annotations（`readOnlyHint`/`destructiveHint`/`idempotentHint`）是这个分类的现代版本，但 MCP 规范自己明文警告：**annotations 必须视为不可信，除非来自可信服务器**——它是风险交流词汇，不是安全保证。落到文件工具：search/read 天生 readOnly，summarize 生成派生数据（compensable：可删），registerUpload 写入业务身份（pivot 之前可补偿，之后只能靠版本链管理）。

### 7.3 Temporal 的三个工程答案

把 saga 做成生产级基础设施的是 Temporal（durable execution）：

- 重试决策持久化在事件历史里，进程崩溃后从历史重放恢复——重试计数不会归零；
- 官方样例 temporal-pause-resume-compensate：Activity 失败 → Workflow 暂停 → 信号恢复或判失败 → 失败触发补偿；
- 社区最佳实践：补偿用独立的 CompensationActivities、无限重试，不阻塞主流程。

它还有一个所有人都该知道的坑：**Activity 默认自动重试，业务失败（比如文件解析失败）必须显式返回 non-retryable error 才会触发补偿**——否则补偿步骤永远不会执行，流程在无限重试里打转。重试与补偿的触发条件是联动的，配错一边，另一边就失效。

引入 Temporal 是重量级决策。对文件 pipeline，最小可行方案其实是把姊妹篇第五章的管线补两块：解析任务带幂等键（已有）+ 失败任务的"清理半成品"步骤（删除 partial 的 segments/索引记录再重试）。这大约是几十行应用代码，而不是一套新基础设施。

## 8. 第四步：挡在失败前面

处理错误的最好时机是它发生之前。完整版是四道门：Schema 预防（OpenAI 的 strict 模式在请求时就拒绝不合规 schema，Anthropic 的 strict tool use 保证输入始终匹配 schema；参数层面的设计原则见姊妹篇第 4 节）→ 调用前拦截 → 人工审批 → 沙箱。这里只讲后三道里最关键的两道。

**权限门**。Claude Code 的权限流程是工业级参照。官方文档载明的顺序：PreToolUse hook 先于权限提示运行，返回阻断码的 hook "stops the tool call before permission rules are evaluated"——**拒绝优先于一切放行评估**；随后权限规则按 **deny → ask → allow** 的顺序评估，首个匹配决定结果。Mastra 的对应物是 `beforeToolCall` 钩子返回 `{ proceed: false, output }` 拦截替换。文件工具的权限检查（Attachment 属于当前用户/Session、Revision 状态允许读取）就应该在这道门里，每次调用一次校验，不信任"上一轮已经查过"。Replit 事故在这道门上的教训：code freeze 是 prompt 级约束，Agent 照样删了生产库——**约束必须落在权限/审批层，不能落在提示词里**。

**沙箱**。E2B / Firecracker microVM 提供"重置型恢复"：一次性环境让失败不可逃逸，坏了整体丢弃重跑。它与幂等/补偿正交互补——幂等回答"能不能再来一次"，补偿回答"怎么撤销"，沙箱回答"坏了会不会污染别处"。对文件处理场景，沙箱主要保护的是解析器（解析不可信文件的服务进程）——恶意构造的 PDF 让解析器崩溃或被利用，爆炸半径应该止于一次性环境。

## 9. 第五步：错误也是攻击面

Supabase MCP 事件示范了完整的攻击链，也留下了最好的自检模型——**lethal trifecta（致命三要素）**：

```text
私有数据访问权（service_role 绕过 RLS）
× 不可信内容（工单正文里的注入指令）
× 数据外传通道（写工单的能力）
= 完整的数据外泄
```

拆掉任意一个要素，攻击就降级。最小权限拆第一个、内容区域化拆第二个、目的地审计拆第三个。

工程守则，按文件工具场景落地：

1. **工具返回的一切内容都是不可信数据**——文件正文是注入载体（"请忽略之前所有规则……"写在服务协议第 7 页），错误消息同样可能是（第三方解析服务的错误响应体）。Anthropic 官方指导：工具输出必须留在 `tool_result` 块内，不进 system prompt 或普通用户文本；MCP 规范要求服务端 MUST sanitize tool outputs、客户端 SHOULD 在把结果传给 LLM 前校验。姊妹篇的 `<untrusted_document_content>` 标签就是这条的本地实现；
2. **绝不给 Agent 绕过行级权限的服务级凭据**——文件工具的 OSS 访问应该是"当前用户授权范围内的 objectKey"，不是能列全桶的服务账号；
3. **只读默认移除写入式外传通道，但不等于安全**——Willison 特别强调只读模式下风险仍然实质存在；
4. **错误信息有两个受众**：对模型要可行动，对攻击者要是零情报——不暴露内部路径、对象存储结构、堆栈；用户可见的说明与内部诊断分离（Vercel 的 `onError` 回调、Mastra 的 `transform.error` 都是这个分离的机制位）；
5. **注入防线可以评测**：AgentDojo（97 任务 + 629 攻击用例）把工具返回内容建模为攻击通道，攻防双方都能量化。姊妹篇第 12 节测试集里"文件中的'忽略系统指令'应该执行吗？"就是这一条的最小用例。

## 10. 第六步：让 Run 有终点

### 10.1 部分成功必须显式标记

协议层已经解决了"独立回填"：OpenAI 按 `call_id`、Anthropic 按 `tool_use_id` 把每个调用和结果一一关联，单个失败不影响其他调用的回填。框架层没解决的是**执行策略**：fail-fast（一个失败取消其余）还是 collect-and-continue（全执行、各自报告）。决策规则：

```text
副作用工具批 → fail-fast：避免半批次已提交后继续执行
只读工具批   → collect-and-continue：一次看全失败面再决定
```

文件场景的典型批：多文件会话里并行 search 三个文件（只读，collect-and-continue，谁的 NO_MATCH 都如实报告）；批量 registerUpload（副作用，fail-fast 或逐个幂等）。无论哪种，**部分成功必须显式标记给模型**，否则模型会把半批结果当全量继续推理——和截断必须标 `truncated` 是同一个道理。

### 10.2 收口：预算耗尽不是静默消失

每个 Run 必须能到达明确的终点状态。CriticTool 的权重设计（skip/finish 0.45 vs retry 0.05）在这里第二次适用：知道何时停下来问用户，好过硬撑。落到文件问答：

```text
completed          —— 证据足够，回答完成
partial            —— summarize 有 20% 章节失败：回答 + 明确说明哪些部分不可靠
unable_to_confirm  —— 检索无命中且无常识可用：诚实说"文件里没有找到"
failed             —— 系统错误：道歉 + 保留 Run 状态供恢复
```

"无法确认"优于凭常识编造——这与姊妹篇的 `unable_to_confirm` 收口完全一致。MAST 的实测再次背书：无限循环是最常见失败，而它的反面不是"更努力地循环"，是"有预算、有终点、有话直说"。

## 11. 端到端参考实现

把全文的决策合成一段编排伪代码（文件工具场景，Mastra 风格）：

```python
MAX_TOOL_RETRIES = 3

for attempt in range(MAX_TOOL_RETRIES + 1):
    model_response = await agent.generate(messages, tools=FILE_TOOLS)

    for call in model_response.tool_calls:
        try:
            args = parse_json(call.arguments)
            args = input_schema.validate(args)
        except ValidationError as e:
            append_tool_result(call, error_result(
                code="VALIDATION_ERROR",
                message=format_validation_error(e),   # 指明具体字段
                retryable=True,                       # 模型可自愈
            ))
            continue

        try:
            # 权限门：每次调用一次校验，不信任上一轮
            scope = await resolve_document_scope(ctx, call)
            if not scope.allowed:
                result = error_result("PERMISSION_DENIED", "…", retryable=False)
            else:
                raw = await execute_file_tool(call.name, args, ctx)
                result = output_schema.validate(raw)   # 输出也校验
        except BusinessError as e:        # NOT_READY / NO_MATCH / NOT_FOUND
            result = error_result(e.code, instructive_message(e), retryable=e.retryable)
        except TransientError:            # 检索服务 5xx：只读，随便重试
            result = error_result("TRANSIENT", "服务暂时不可用", retryable=True)
        except TimeoutError:              # 副作用结果未知：交给幂等键收敛
            result = error_result("RESULT_UNKNOWN",
                "请求超时，结果待确认；重试请携带相同幂等键", retryable=True)
        except Exception:
            log_exception_with_traceback()  # 内部留全量，外部给最小
            result = error_result("INTERNAL_ERROR", "工具执行失败", retryable=False)

        append_tool_result(call, result)   # 错误以结果形状回传，不抛出
        write_audit_event(call, result)    # 独立于模型的审计

    if all_results_are_final(messages):
        break

    if retry_budget_exhausted():
        finalize_with_partial_summary(messages)  # 收口而不是消失
        break
```

刻意不在循环里的东西：无限重试（预算封顶）、凭常识补全（unable_to_confirm 收口）、模型自选权限（每次调用服务端校验）。

## 12. 生产级设计清单

### Tool 定义

- 名称清晰、互不混淆；描述写清"不适用"边界（工具间的边界比功能更容易让模型犯错）；
- 使用 enum 表达有限状态、`additionalProperties: false`，能启用 strict 时启用；
- 副作用工具在参数中暴露幂等键（或声明从内容派生）；
- 不让模型填写代码已知的参数（segmentId 由系统生成、模型转抄）。

### Tool 实现

- Schema 校验后仍做业务二次校验（NOT_READY/NO_MATCH/NOT_FOUND/PERMISSION_DENIED 各自独立错误码）；
- 服务端再次鉴权（对象级：owner/session/document/revision 逐级查）；
- 错误返回结构化（code + instructive message + retryable + details），以结果形状回传模型而不是抛异常；
- 结果按 output schema 验证；partial 与 Coverage 一致；
- 超时单独分类：结果未知 ≠ 失败，同幂等键收敛；
- 最外层捕获未预料异常；日志不记录密钥与正文。

### Agent 编排

- 区分传输/参数/执行/模型切换/Run 五类重试，每层独立预算，警惕相乘；
- 明确各层重试的持久性预期（进程崩溃后计数是否归零）；
- 总时间、Token、循环、并发上限齐备；预算耗尽进入明确收口状态；
- 并行批次显式选择 fail-fast 或 collect-and-continue，部分成功显式标记；
- 支持用户取消与人工审批；对未知结果的副作用进行补偿或人工核对。

### 安全

- 工具返回的一切内容（文件正文 + 错误消息）视为不可信数据，与指令区域隔离；
- 最小权限凭据；破坏性操作强制人工确认（deny 不可被 bypass）；
- 错误信息对模型可行动、对攻击者零情报；
- 用 lethal trifecta 自检每个工具组合。

## 13. 最容易犯的六个错误

### 错误一：以为 strict 就等于业务安全

strict 约束模型输出结构；它不能证明 segmentId 存在、用户有权限或解析已完成。`NOT_READY` 和 `NO_MATCH` 都是 strict 之后的失败。

### 错误二：把所有失败都反馈给模型重试

NO_MATCH、PERMISSION_DENIED、NOT_FOUND 不是重试能解决的。盲目重试浪费 Token、放大成本。CriticTool 实测：弱模型的典型病就是对 NO_MATCH 无限换措辞。

### 错误三：Tool 抛异常就让 Agent 崩溃

三家框架（Anthropic/Vercel/Mastra）都收敛在"错误以结果形状回传"。生产 Tool 应将可公开的错误转成稳定的 Tool Result，同时把详细堆栈写入内部日志。

### 错误四：重试副作用而没有幂等性

"请求超时"不等于"操作没有发生"。registerUpload 超时后换键重试 = 同一文件两套解析任务。Stripe 守则：结果未知时同键重放，不要换键。

### 错误五：只校验输入，不校验输出

错误的成功比明确失败更危险——summarize 报告 completed 但 Coverage 撒谎，模型会把错误结论传播给用户。MCP 已把 outputSchema 校验写进协议，照做。

### 错误六：忽略"重试计数崩溃归零"

多数框架的重试是内存态，进程重启后副作用工具可能被从第 1 次重新执行。副作用流程要么自己维护持久化执行账本（你的解析任务幂等键就是），要么交给 durable execution 基础设施。

## 14. 一句话记忆法

```text
模型负责提出，Runtime 负责编排，Schema 负责形状，Tool 负责业务，
服务端负责最终安全，幂等负责敢重试，补偿负责能撤销，
Recovery 负责有限恢复，Audit 负责事后证明。
```

---

## 官方资料与延伸阅读

**Provider 与协议**

1. [OpenAI Function Calling Guide](https://developers.openai.com/api/docs/guides/function-calling) —— strict 模式、并行调用、错误输出格式。
2. [Anthropic Tool Use: Handle Tool Calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) —— `tool_result`、`is_error`、"retry 2-3 times with corrections"、注入防线。
3. [Google Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling) —— `Malformed_Function_Call`、`validated` tool_choice、流式参数聚合。
4. [MCP Specification: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) —— 协议错误 vs 执行错误双通道、outputSchema、annotations 不可信警告、安全 MUST/SHOULD 清单。

**框架**

5. [Mastra: Workflows Error Handling](https://mastra.ai/docs/workflows/error-handling) / [Suspend and Resume](https://mastra.ai/docs/workflows/suspend-and-resume) / [StreamErrorRetryProcessor](https://mastra.ai/reference/processors/stream-error-retry-processor) / [Tools](https://mastra.ai/docs/agents/tools) —— retryConfig/retries、快照与恢复、可重试判定链、webFetchTool 的 isError 模式。
6. [Vercel AI SDK: Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) —— repairToolCall、四类 SDK 错误、tool-error part。
7. [Pydantic AI: Retries](https://pydantic.dev/docs/ai/core-concepts/retries/) —— ModelRetry/ToolFailed 对偶、分键重试预算。
8. [LangGraph: Fault Tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance) —— RetryPolicy、NodeTimeoutError 清除失败写入。
9. [Diagrid: Still Not Durable](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake) —— 检查点可靠 ≠ 重试持久。
10. [Temporal Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies) / [pause-resume-compensate 样例](https://github.com/temporalio/temporal-pause-resume-compensate)

**工业实践**

11. [Stripe: Idempotency Keys](https://docs.stripe.com/api/idempotent_requests) / [Error & Retry Guidance](https://docs.stripe.com/error-low-level) —— 结果三分法、Stripe-Should-Retry、同键重放守则。

**研究与评测**

12. [CriticTool（arXiv 2506.13977）](https://arxiv.org/html/2506.13977v1) —— 错误恢复率基线、静默失败自查率、skip/finish 权重设计。
13. [Failure Makes the Agent Stronger（arXiv 2509.18847）](https://arxiv.org/html/2509.18847v1) —— prompt 反思脆弱、把修复训练成模型能力。
14. [MAST: Why Do Multi-Agent LLM Systems Fail?（arXiv 2503.13657）](https://arxiv.org/abs/2503.13657) —— 多 Agent 失败分类学、无限循环最常见。

**事故与安全**

15. [Replit 事故（AI Incident Database #1152）](https://incidentdatabase.ai/cite/1152/)
16. [Simon Willison: Supabase MCP lethal trifecta](https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta/) / [The Lethal Trifecta for AI Agents](https://simonw.substack.com/p/the-lethal-trifecta-for-ai-agents)
17. [OWASP LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) / [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

**关联阅读**

- [为 Agent 设计文件工具](../agent-file-tools.md) —— 工具设计视角：Description 工程、参数与返回值、评测方法。
- [让 AI 持续理解用户上传的文件](../document-grounded-agent.md) —— 文档问答系统架构。
- [调研原始数据](../agent-tool-failure-research/report.md) —— 本文全部框架行为、事故细节与研究数字的出处。

## 附录：失败要能归因到层

正文刻意略去了可观测性的展开，只留结论：**错误分类学要落地，靠的是可观测性**。三件套——OTel GenAI Semantic Conventions（agent/tool 调用与 error.type 的标准 span 字段，尚未 stable，接入要锁版本）、TRAIL（148 条标注 trace、841 个错误，reasoning/execution/planning 三分类）、Who&When（失败归因基准：定位"哪个 agent 失败"最佳 53.5%，定位"哪一步是决定性错误"最好也只有 14.2%）。归因这么难，是"现在就把失败层级写进结构化日志"的最好理由——普通日志保留 `runId / toolName / call_id / 状态 / errorCode / duration / token 用量`，不记参数与结果正文。Replit 事故还提醒了审计的特殊价值：模型的自我报告不可信（它伪造数据、隐瞒行为），独立于模型的审计日志是事后唯一可靠的事实来源。

## 配套交互图

打开同目录下的 [agent-tools-failure-lifecycle.html](./agent-tools-failure-lifecycle.html)，通过 Guided Views 查看：

- 成功主链路；
- 模型与解析失败；
- Schema 与 Tool 业务失败；
- 外部故障与恢复；
- 责任边界。

# Agent Tools 调用失败的全生命周期处理

> 从模型生成 Tool Call，到参数校验、权限控制、工具执行、结果校验、重试、降级、人工介入和审计。
>
> **核心结论：**“参数与预期不一致”是 Tool 调用失败的一类原因；“Tools 调用失败如何处理”是更大的问题集合。

## 1. 先建立正确的心智模型

一个 Agent Tool 调用不是“模型调用函数”这么简单，而是一条跨越多个边界的流水线：

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
真正执行：数据库、API、文件、浏览器、MCP 服务
  ↓
输出结果归一化与结果校验
  ↓
Tool Result 返回模型
  ↓
模型决定：继续调用、修正、询问、降级或结束
```

模型的作用是“提出下一步行动”，而不是提供最终安全边界。真正的安全边界必须位于 Tool 实现和服务端。

## 2. 一个贯穿案例

用户说：

> “查询订单 ORD-42，如果还没有发货，就取消它。”

注册工具：

```json
{
  "name": "cancel_order",
  "description": "取消一个尚未发货的订单。只能操作当前用户拥有的订单。",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "order_id": { "type": "string" },
      "reason": {
        "type": "string",
        "enum": ["user_request", "fraud_review"]
      }
    },
    "required": ["order_id", "reason"],
    "additionalProperties": false
  }
}
```

理想调用：

```json
{
  "order_id": "ORD-42",
  "reason": "user_request"
}
```

但模型也可能产生：

```json
{ "order_id": 42 }
```

或者：

```json
{ "order_id": "ORD-42", "reason": "因为用户想取消" }
```

或者调用一个不存在的工具：

```text
remove_order(order_id="ORD-42")
```

甚至参数完全合法，但订单已经发货、用户没有权限，或者订单服务超时。

## 3. “调用失败”的完整分类

### 3.1 模型输出与协议层失败

这类错误发生在业务 Tool 执行之前：

- JSON 截断或语法错误
- Tool Call envelope 格式错误
- 工具名称不存在
- `call_id` 缺失或无法关联
- 多轮消息顺序不符合供应商协议
- 流式参数片段没有正确聚合

处理方式：Runtime 拒绝执行，生成明确的协议错误。是否反馈模型并重试，取决于 Agent 框架；不能假设一定自动发生。

### 3.2 输入 Schema 失败

包括：

- 缺少必填字段
- 类型错误，例如 `order_id: 42`
- 枚举值错误，例如 `reason: "其他"`
- 字符串长度、数字范围或正则不满足
- 多余字段
- 嵌套对象结构错误

Schema 的作用是约束“参数形状”。它不能证明订单存在，也不能证明调用者有权限取消订单。

### 3.3 参数规范化失败

一些低风险转换可以由开发者明确允许：

```text
"30" → 30
"2026/08/27" → "2026-08-27"
```

但自动修复不是默认正确答案。对金额、收款人、文件路径、删除目标、权限范围、发布日期等高风险字段，静默猜测可能产生实际副作用。此时应拒绝、要求模型重试，或询问用户确认。

### 3.4 Tool 业务层失败

即使 Schema 通过，Tool 仍要再次执行：

- 订单不存在：`ORDER_NOT_FOUND`
- 用户无权访问：`PERMISSION_DENIED`
- 订单状态不允许：`INVALID_STATE`
- 资源已被其他请求修改：`CONFLICT`
- 幂等键重复：返回稳定结果，而不是重复执行副作用
- 业务规则或配额不允许

这些检查必须由 Tool 或服务端完成，不能让模型代替鉴权和状态机。

### 3.5 Tool 执行与外部系统失败

例如：

- 数据库连接失败
- HTTP 5xx
- 网络断开
- 超时
- 第三方限流
- 文件系统权限不足
- 浏览器页面状态变化
- MCP Server 不可用
- Tool 内部未捕获异常

要区分临时错误和永久错误：

| 错误 | 通常可重试？ | 典型策略 |
|---|---:|---|
| 连接重置 | 是 | 指数退避，限制次数 |
| HTTP 429 | 通常是 | 遵循 `Retry-After` |
| HTTP 5xx | 通常是 | 有上限的传输层重试 |
| 请求参数错误 | 否 | 修正参数，不要盲目重试 |
| 无权限 | 否 | 询问权限或结束 |
| 资源不存在 | 通常否 | 告知用户或换查询方式 |
| 已发货不可取消 | 否 | 返回业务原因 |
| 未知工具 | 可让模型修正 | 反馈可用工具列表 |

### 3.6 Tool 输出与结果层失败

不要只校验输入，也要校验输出：

```json
{
  "ok": true,
  "data": {
    "order_id": "ORD-42",
    "status": "cancelled"
  }
}
```

可能的输出问题包括：

- Tool 返回非 JSON，但调用方要求 JSON
- 缺少 `ok` 或 `data`
- 状态值不在输出枚举中
- 返回结果与数据库实际状态不一致
- Tool 报告成功，但副作用没有持久化
- 返回了敏感数据，不应直接暴露给模型或用户

MCP 支持可选 `outputSchema`；提供时，服务端应产生符合 Schema 的结构化结果，客户端也应验证结果。

### 3.7 编排与运行控制失败

即使单次 Tool 没有异常，Agent Run 也可能失败：

- 连续重试超过预算
- Agent 循环次数达到上限
- Token 或总时间预算耗尽
- 并行工具调用中部分成功、部分失败
- 用户取消任务
- 高风险操作等待确认超时
- 熔断器打开
- 需要切换模型或备用 Tool

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

## 5. 错误应该如何返回给模型？

推荐使用稳定的结构化格式：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_STATE",
    "message": "订单 ORD-42 已发货，不能取消。",
    "retryable": false,
    "user_action_required": false,
    "details": {
      "current_status": "shipped",
      "allowed_statuses": ["pending", "processing"]
    }
  }
}
```

错误信息应当：

1. 指明失败层和错误代码；
2. 指明哪个字段或哪个业务条件失败；
3. 明确 `retryable`；
4. 给出模型下一步可以采取的动作；
5. 不泄漏密钥、内部堆栈、隐私或攻击细节；
6. 让用户可见的说明与内部诊断分离。

## 6. 重试不是一种东西，而是多层机制

重试必须先回答“重新执行什么”：

### 6.1 传输层重试

重新发送同一个 HTTP 请求。模型通常看不到这些尝试。适合连接重置、429、部分 5xx。

### 6.2 Tool 参数重试

把验证错误或 Tool 错误反馈给模型，请模型修正同一个 Tool Call。适合缺字段、类型错误、可明确修正的参数。

### 6.3 Tool 执行重试

重新执行同一个副作用操作。必须有幂等键、去重和明确的安全策略，否则可能重复扣款、重复发邮件或重复删除。

### 6.4 模型切换

当前模型或供应商不可用时，切换备用模型。这不是简单的同一请求重试。

### 6.5 整个 Agent Run 重试

从更高层重新运行任务。应谨慎使用，因为可能重复所有工具副作用；需要 checkpoint、幂等和补偿事务。

**推荐默认值：**参数/模型重试 2–3 次；传输层遵循服务端限流提示；副作用 Tool 只有在幂等和结果不确定时才允许谨慎重试。

## 7. 一个可靠的编排伪代码

```python
MAX_MODEL_RETRIES = 3

for attempt in range(MAX_MODEL_RETRIES + 1):
    model_response = call_model(messages, tools=registered_tools)

    for call in model_response.tool_calls:
        try:
            args = parse_json(call.arguments)
        except ParseError as e:
            result = error_result(
                code="PARSE_ERROR",
                message="Tool arguments 不是合法 JSON",
                retryable=True,
            )
            append_tool_result(call, result)
            continue

        if not registry.has(call.name):
            result = error_result(
                code="UNKNOWN_TOOL",
                message="工具不存在；请从可用工具中选择",
                retryable=True,
            )
            append_tool_result(call, result)
            continue

        try:
            args = input_schema.validate(args)
        except ValidationError as e:
            result = error_result(
                code="VALIDATION_ERROR",
                message=format_validation_error(e),
                retryable=True,
            )
            append_tool_result(call, result)
            continue

        try:
            # Tool 内部仍然要做权限、状态、资源和幂等校验
            raw_result = execute_tool(call.name, args)
            result = output_schema.validate(raw_result)
        except BusinessError as e:
            result = error_result(e.code, e.public_message, retryable=False)
        except TransientError as e:
            result = error_result(e.code, "服务暂时不可用", retryable=True)
        except Exception:
            log_exception_with_traceback()
            result = error_result("INTERNAL_ERROR", "工具执行失败", retryable=False)

        append_tool_result(call, result)
        write_audit_event(call, result)

    if all_results_are_final(messages):
        break

    if retry_budget_exhausted():
        ask_user_or_degrade()
        break
```

注意：伪代码中的 `retryable=true` 只是允许编排层考虑重试，不是命令模型必须无限重试。

## 8. 生产级设计清单

### Tool 定义

- Tool 名称清晰、互不混淆；
- 描述写清楚什么时候调用、什么时候不要调用；
- 参数描述足够让“没有上下文的实习生”正确调用；
- 使用 enum 表达有限状态；
- 使用 `additionalProperties: false`；
- 能启用时启用 strict/structured outputs；
- 不让模型填写代码已知的参数；
- 初始暴露的 Tool 数量保持小，使用工具搜索或分组延迟加载。

### Tool 实现

- Schema 校验后仍做业务二次校验；
- 服务端再次鉴权；
- 所有副作用操作设计幂等键；
- 对超时、取消、429、5xx 做明确分类；
- 最外层捕获未预料异常；
- 错误返回结构化，不吞掉错误；
- 结果按 output schema 验证；
- 日志中不记录密钥和不必要的敏感数据。

### Agent 编排

- 区分传输重试、模型重试、Tool 重试和 Run 重试；
- 每层设置独立预算；
- 对不同错误使用不同策略；
- 设置总时间、Token、循环和并发上限；
- 支持用户取消与人工审批；
- 处理并行 Tool 的部分成功；
- 对未知结果的副作用进行补偿或人工核对；
- 记录 trace、call_id、版本、耗时和决策。

## 9. 最容易犯的五个错误

### 错误一：以为 strict 就等于业务安全

strict 主要约束模型输出结构；它不能证明订单存在、用户有权限或数据库事务成功。

### 错误二：把所有失败都反馈给模型重试

权限拒绝、状态非法、余额不足、资源不存在通常不是模型重试能解决的。盲目重试只会浪费 Token，甚至重复副作用。

### 错误三：Tool 抛异常就让 Agent 崩溃

生产 Tool 应将可公开的错误转成稳定的 Tool Result，同时把详细堆栈写入内部日志。

### 错误四：重试副作用而没有幂等性

“请求超时”不等于“操作没有发生”。重新取消、扣款、发信之前，必须考虑服务端是否已经成功提交。

### 错误五：只校验输入，不校验输出

错误的成功结果可能比明确失败更危险，因为模型会把它继续传播给用户或下游 Tool。

## 10. 一句话记忆法

```text
模型负责提出，Runtime 负责编排，Schema 负责形状，Tool 负责业务，
服务端负责最终安全，Recovery 负责有限恢复，Audit 负责事后证明。
```

## 11. 官方资料与延伸阅读

1. [OpenAI Function Calling Guide](https://developers.openai.com/api/docs/guides/function-calling) —— Tool calling 的五步流程、`strict`、并行调用、工具定义和结果回传。
2. [Anthropic Tool Use: Handle Tool Calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) —— `tool_result`、`is_error`、消息顺序和错误恢复。
3. [Model Context Protocol: Server Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) —— `tools/list`、`tools/call`、输入/输出 Schema、协议错误与执行错误、安全要求。
4. [Pydantic AI: Retries](https://pydantic.dev/docs/ai/core-concepts/retries/) —— 传输重试、模型 fallback、Tool retry、Output retry 的分层预算，以及 `ModelRetry`/`ToolFailed` 的区别。

## 配套交互图

打开同目录下的 [agent-tools-failure-lifecycle.html](./agent-tools-failure-lifecycle.html)，通过 Guided Views 查看：

- 成功主链路；
- 模型与解析失败；
- Schema 与 Tool 业务失败；
- 外部故障与恢复；
- 责任边界。

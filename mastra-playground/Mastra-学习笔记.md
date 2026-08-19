# Mastra 学习笔记（独立 TypeScript 沙盒）

> 定位：与 `week-research-agent/`（手写 Python Agent）和 `agent-base/storyboard-agent/`（NestJS 工作流）并行的框架对照项目。
> 原则：先用小实例验证 Mastra 的运行模型，再决定是否接入真实业务；**不直接改写现有 Agent**。

## 0. 初始化状态

项目通过以下命令创建：

```bash
pnpm dlx create-mastra@latest mastra-playground --empty --no-git
```

采用 `--empty` 的原因：先理解 Mastra 的最小运行时，不在第一天绑定模板、模型厂商或业务代码。

当前环境（以本地安装包为准）：

| 项目 | 版本 / 状态 |
| --- | --- |
| Node.js | `v24.15.0` |
| pnpm | `v11.20.0` |
| `@mastra/core` | `1.59.0` |
| `mastra` CLI | `1.25.0` |
| TypeScript | `6.0.3` |
| 运行方式 | ESM：`"type": "module"` |
| TypeScript 配置 | `ES2022` + `moduleResolution: "bundler"` |

已验证：`pnpm build` 和 `pnpm exec tsc --noEmit` 均通过。

> 创建与构建期间有 PostHog 网络上报超时警告；依赖安装和构建本身成功。该警告不影响本地项目的运行与构建。

---

## 1. 项目结构

```text
mastra-playground/
├── src/
│   ├── lesson01-minimal-agent.ts      # 命令行运行与可读 Trace 输出
│   └── mastra/
│       ├── index.ts                   # Mastra Runtime 入口；注册 Agent
│       ├── agents/calculator-agent.ts # 最小 Agent：规则、模型、工具装配
│       └── tools/add-tool.ts          # createTool + Zod Schema + execute
├── .agents/skills/mastra/             # create-mastra 自动安装的官方 Skill（当前 API 指南）
├── .env.example                       # 仅环境变量名，不能提交真实 Key
├── package.json                       # dev / build / start / lesson:01 脚本
├── tsconfig.json                      # ESM + 严格 TypeScript
└── Mastra-学习笔记.md                  # 本文
```

Lesson 01 完成后，Runtime 已登记 `calculatorAgent`：

```ts
export const mastra = new Mastra({
  agents: { calculatorAgent },
})
```

这说明项目已具备 **Mastra Runtime 容器 + Agent Registry**；Workflow、Memory 和 Storage 留给后续 Lesson 单独引入。

---

## 2. 一句话心智模型

> **Mastra 是 TypeScript 的 AI 应用运行时与组装框架：把 Agent、Tool、Workflow、Memory、Storage、Server、Studio、评估与可观测性放进一个统一容器。**

它不是单纯的 Agent Loop 库，也不只是 LangGraph 的 TypeScript 翻版。

```text
Mastra 实例（应用运行时 / 注册中心）
  ├─ Agent       开放任务：模型自主决定是否、何时调用工具并停止
  ├─ Tool        可验证的确定性能力：Schema + execute
  ├─ Workflow    固定多步骤：显式顺序、分支、并行、暂停、恢复
  ├─ Memory      对话历史 / 工作记忆 / 语义回忆 / 观察式长期记忆
  ├─ Storage     持久化 Memory、Workflow 快照、Trace、Eval、Schedule 等领域数据
  └─ Server + Studio
       ├─ 开发服务与 API
       └─ 可视化调试 Agent、Workflow、调用轨迹和状态
```

---

## 3. 核心原语：与已学内容对照

| Mastra 原语 | 它解决什么 | Python Research Agent 对应物 | LangGraph 对应物 |
| --- | --- | --- | --- |
| `Agent` | 开放任务的模型-工具循环 | `run_research()` 的 while tool_calls | `model → ToolNode → model` |
| `createTool()` | 用 Schema 封装一个可执行能力 | Python 函数 + TOOLS_SCHEMA + Registry | `@tool` + `ToolNode` |
| `Workflow` + `createStep()` | 确定性多步骤业务流程 | Planner → Executor → Synthesizer | StateGraph 的节点与边（但抽象不同） |
| `Memory` | 对话和长期上下文的组合管理 | SQLite session + messages 拼接 | message state + checkpointer（不完全等价） |
| `Storage` | 跨运行时领域的持久化底座 | SQLite / Chroma / JSONL 分散存储 | Checkpointer + 外部存储 |
| `Mastra` | 注册、共享服务、Server 生命周期 | FastAPI 入口 + 各模块手工装配 | 图编译后的应用外层 |
| Studio | 运行、观察与调试 UI | 自建 SSE 页面 + 日志 | 图可视化 / stream 外围能力 |

### 一个关键差异

```text
LangGraph 的重心：状态图、节点、边、路由、检查点
Mastra 的重心：可运行 AI 应用的全家桶（Agent + Workflow + Memory + Storage + Server + Studio）
```

两者并不是非此即彼：Mastra 的 Workflow 用显式 Step 组织确定性流程；LangGraph 用 StateGraph 表达图形控制流。项目选型应由实际任务的控制流、持久化、可观测性和 TypeScript 生态需求决定。

---

## 4. Agent：把手写 Loop 交给框架

根据本地 `@mastra/core@1.59.0` 文档，Agent 需要：

```ts
new Agent({
  id,
  name,
  instructions,
  model: 'provider/model-name',
  tools,
})
```

Agent 的语义和当前 `research_agent/researcher.py` 一样：面对开放任务时，模型决定调用哪个工具、调用多少轮、什么时候最终回答。区别是 Mastra 在 `agent.generate()` / `agent.stream()` 内封装了工具调用循环、工具消息回传、结果和 usage 聚合。

```text
手写 Python：
LLM → while tool_calls → Tool Registry → Observation → LLM → 最终回答

Mastra：
agent.generate() / agent.stream()
  └─ 内部执行同类模型-工具循环
```

框架没有让 Agent 更聪明；它减少了工具协议、循环管理、流式事件和运行时集成的样板代码。

---

## 5. Tool：从“三件套”到 `createTool()`

本地文档明确要求：普通 object 定义的工具会静默执行失败；必须用 `createTool()` 创建。

```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const addTool = createTool({
  id: 'add',
  description: '计算两个数字的加法。',
  inputSchema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  outputSchema: z.object({
    result: z.number(),
  }),
  execute: async ({ a, b }) => ({ result: a + b }),
})
```

与手写版的映射：

| 手写 Python | Mastra |
| --- | --- |
| `def add(a, b)` | `execute: async ({ a, b }) => ...` |
| 手写 JSON Tool Schema | `inputSchema: z.object(...)` |
| 手写返回值约定 | `outputSchema: z.object(...)` |
| `TOOL_REGISTRY = {"add": add}` | `tools: { addTool }` 挂到 Agent |

> Tool 描述和 Schema 仍然是给 LLM 的选择指南；框架只替你生成协议与执行胶水，不能替你写清楚“什么时候该调用我”。

---

## 6. Workflow：确定性步骤，不是 Agent 的替代品

Mastra Workflow 的最小组成：

```text
createStep()：声明输入 Schema、输出 Schema 和 execute 业务逻辑
createWorkflow()：声明工作流输入/输出
.then(step)：连接固定执行顺序
.commit()：完成工作流定义
```

```ts
const workflow = createWorkflow({ id, inputSchema, outputSchema })
  .then(step1)
  .then(step2)
  .commit()
```

这与 `week-research-agent/workflow/` 的 Planner → Executor → Synthesizer 固定链路同构。差异在于 Mastra 已提供：

- Schema 化的 Step 输入/输出；
- `start()` 的最终结果；
- `stream()` 的步骤事件；
- suspend / resume；
- Workflow State；
- Storage 持久化快照；
- Studio 图形化查看与 time travel。

> **Agent 处理“下一步不确定”；Workflow 处理“步骤已知”。** 这和 `agent-base/docs/workflow-vs-agent.md` 的核心决策一致。

---

## 7. Memory 与 Storage：Mastra 的工程化优势

目前 Python 项目将持久化分散在：

```text
SQLite sessions.db       → Session Memory
Chroma                   → RAG Vector Store
JSONL / 日志文件          → 运行记录
评估结果 JSON            → Evaluation Artifact
```

Mastra 将运行时数据按 Storage Domain 统一建模：

| Storage Domain | 保存的数据 |
| --- | --- |
| `memory` | thread、message、resource、工作记忆 |
| `workflows` | 挂起/恢复需要的 Workflow 快照 |
| `observability` | trace、span、metric、log、feedback |
| `scores` / `datasets` / `experiments` | 评估与实验数据 |
| `backgroundTasks` / `schedules` | 长任务和定时任务状态 |
| `threadState` | 持久任务、目标和线程状态 |

Memory 里尤其要区分两个标识：

```text
resource = 用户 / 实体的稳定身份（跨会话）
thread   = 一次具体对话（隔离会话历史）
```

这正是现有 `session_id` 方案向“用户级记忆 + 会话级记忆”演进时需要补上的模型。

---

## 8. 已验证的当前能力

### 8.1 真实本地 API 来源

`create-mastra` 自动安装了官方 Mastra Skill：

```text
.agents/skills/mastra/SKILL.md
```

随后按它的要求优先读取了当前安装版本的嵌入文档：

```text
node_modules/@mastra/core/dist/docs/
```

因此本笔记使用的是 `@mastra/core@1.59.0` 的本地 API，而不是可能过期的网络教程。

### 8.2 模型路由

官方 provider registry 已验证 `zhipuai` 是当前支持的 provider；可用模型中包括：

```text
zhipuai/glm-4.7-flash
zhipuai/glm-4.7
zhipuai/glm-4.5-flash
...
```

Agent 当前采用：`zhipuai/glm-4.7-flash`。

模型名必须采用：

```text
provider/model-name
```

本地 `@mastra/core@1.59.0` 的 provider registry 还确认：`zhipuai` 读取的环境变量是 **`ZHIPU_API_KEY`**（不是现有 Python 项目使用的 `ZHIPUAI_API_KEY`）。因此项目提供 `.env.example`：

```bash
cp .env.example .env
# 填入 ZHIPU_API_KEY，不提交 .env
```

不要猜模型名；每次改 provider/model 前先运行：

```bash
node .agents/skills/mastra/scripts/provider-registry.mjs --provider zhipuai
```

---

## 9. Lesson 01：最小 Agent + `addTool`

### 9.1 目标

用一个没有网络、副作用或数据库的加法工具，隔离验证 Agent Tool Calling 的完整协议：

```text
用户：12.5 加 7.25 等于多少？
  ↓
calculatorAgent（instructions + model + tools）
  ↓ 模型输出 tool call
addTool（Zod 校验 a / b）
  ↓
execute({ a, b }) → { expression, result }
  ↓ 工具结果自动回送给模型
Agent 生成最终中文回答
```

### 9.2 三个文件分别负责什么

| 文件 | 职责 | 关键 API |
| --- | --- | --- |
| `src/mastra/tools/add-tool.ts` | 定义可验证、可执行的确定性能力 | `createTool()`、`z.object()`、`execute()` |
| `src/mastra/agents/calculator-agent.ts` | 定义 Agent 的规则、模型和可用工具 | `new Agent()` |
| `src/mastra/index.ts` | 将 Agent 加入 Runtime Registry | `new Mastra({ agents })` |
| `src/lesson01-minimal-agent.ts` | 取得注册后的 Agent、调用并打印 Trace | `getAgentById()`、`generate()` |

### 9.3 为什么 `addTool` 要写 Input 和 Output Schema？

```ts
inputSchema: z.object({ a: z.number(), b: z.number() })
outputSchema: z.object({ expression: z.string(), result: z.number() })
```

- `inputSchema` 同时是给模型看的“函数签名”和运行前的输入校验；
- `outputSchema` 约束 `execute()` 返回的 Observation；
- 所以 Tool 不只是普通 TypeScript 函数，而是 **模型可调用的、带边界契约的能力**。

### 9.4 `toolChoice` 与真实自主决策

Lesson runner 显式指定：

```ts
toolChoice: { type: 'tool', toolName: 'addTool' }
```

目的只是让第一课稳定地验证整个协议链条；否则有些模型可能直接心算 `19.75`，导致你无法观察 `execute()` 是否实际发生。

实际产品通常保持默认值 `toolChoice: 'auto'`：模型会根据 **用户问题、instructions、tool description、input schema** 自己决定要不要用工具。Lesson 02 会去掉强制选择，用多工具测试它的选择质量。

### 9.5 `maxSteps` 是什么？

```ts
maxSteps: 2
```

它限制这次 `generate()` 最多的模型步骤。对于该例：

```text
Step 1：模型请求 addTool
Step 2：读取 Tool Result，输出最终回答
```

这是 Agent Loop 的业务保险丝。它对应手写 Python `MAX_STEPS`，也对应 LangGraph 执行时设定的 `recursion_limit`，但放置层级不同：

| 实现 | 防无限循环的设置 |
| --- | --- |
| 手写 Research Agent | while 循环中的 `MAX_STEPS` |
| LangGraph | 运行 config 的 `recursion_limit` |
| Mastra | `agent.generate(..., { maxSteps })` 或 stop conditions |

### 9.6 如何运行

```bash
cd mastra-playground
cp .env.example .env
# 编辑 .env，填入 ZHIPU_API_KEY
pnpm run lesson:01
```

成功时 Trace 将至少显示：

```text
工具调用数：1
工具调用 1：add(...)
工具结果 1：add → {"expression":"12.5 + 7.25","result":19.75}
最终回答：……19.75……
```

runner 还会打印 `finishReason`、`steps.length` 和 `usage`，这就是 Mastra 对手写 Debug Trace 的结构化替代。

已直接验证 `addTool.execute({ a: 12.5, b: 7.25 })` 返回 `{ expression: "12.5 + 7.25", result: 19.75 }`；TypeScript typecheck 和 Mastra bundle build 也已通过。

曾使用现有开发 Key 对真实链路发起请求，Mastra 已正确将 Tool Schema 编译为 provider function 定义并向 `zhipuai/glm-4.7-flash` 发送；但智谱上游返回 **HTTP 429 / code 1305（当前访问量过大）**，所以本轮无法得到最终模型回答与远端 tool-call trace。这是 provider 繁忙而非本地代码/鉴权错误；稍后执行 `pnpm run lesson:01` 即可复验完整链路。

---

## 10. Lesson 02：多工具自主选择

### 10.1 目标

Lesson 01 用 `toolChoice` 强制调用 `addTool`，只验证“工具调用协议能不能走通”。Lesson 02 移除强制选择，验证真正的 Agent 决策：模型能否从请求和 Tool 描述中选择正确能力，并在不支持的问题上拒绝调用。

```text
用户意图 + Agent instructions + Tool description + inputSchema
                         ↓
                模型自主 tool_choice = auto
                         ↓
           addTool / multiplyTool / 不调用工具
```

新增：

| 文件 | 用途 |
| --- | --- |
| `src/mastra/tools/multiply-tool.ts` | 第二个确定性工具：`multiplyTool` |
| `src/lesson02-tool-selection.ts` | 四个带期望工具序列的可执行行为测试 |

`calculatorAgent` 的工具注册变为：

```ts
tools: { addTool, multiplyTool }
```

### 10.2 测试集与断言

| 用例 | 期望 Tool 调用序列 | 意义 |
| --- | --- | --- |
| `12.5 加 7.25` | `addTool` | 基本意图路由 |
| `6.5 乘以 4` | `multiplyTool` | 相邻工具的区分能力 |
| `(8 加 2) 乘以 3` | `addTool → multiplyTool` | 多轮 Tool Loop 与中间 Observation |
| `北京今天天气怎么样？` | 无 | 能力边界：不能为了“看起来像 Agent”而乱调用工具 |

runner 不再传 `toolChoice`，保持 Mastra 默认 `auto`。它读取 `response.toolCalls`，按调用顺序和期望序列比对，打印通过/未通过、工具结果、`finishReason`、步骤数和 `usage`；任一用例失败会以非零退出码结束，方便后续接 CI。

```bash
pnpm run lesson:02
```

### 10.3 真实运行的观察

真实调用已确认请求中使用：

```text
tool_choice: auto
```

且四个工具的 Schema 都已被 Mastra 送往 provider。测试时智谱 `glm-4.7-flash` 连续返回 HTTP 429 / code 1305（访问量过大），因此前三个需要工具的用例没有得到模型输出；这属于上游临时限流，runner 会正确显示失败并以非零状态退出，避免将“没测到”误报为通过。

第四个“不支持天气问题”的用例成功返回：

```text
实际工具：无
选择验证：通过
结束原因：stop；步骤数：1
```

这个反例很重要：Agent 的“工具选择质量”不仅是**该用时用对**，还包括**不该用时不乱用**。

### 10.4 与手写版 / LangGraph 的对照

| 关注点 | 手写 Agent | LangGraph | Mastra Lesson 02 |
| --- | --- | --- | --- |
| Tool 注册 | `TOOL_REGISTRY` + JSON Schema | `TOOLS` + `bind_tools()` | `tools: { addTool, multiplyTool }` |
| 选择哪个工具 | 模型 function call | model node 输出 `tool_calls` | 模型 `tool_choice: auto` |
| 执行工具 | 自己分派函数 | `ToolNode` | Agent Runtime 自动执行 `createTool().execute()` |
| 循环控制 | `while` + `MAX_STEPS` | 条件边 + `recursion_limit` | `generate({ maxSteps })` |
| 测试选择质量 | 手写日志/断言 | 检查 graph state messages | 检查 `response.toolCalls` 的有序序列 |

> Framework 减少了 Loop 和工具协议样板，但**工具描述、清晰的边界与行为断言仍是应用代码的责任**。

---

## 11. 学习路线

```text
✅ 00 初始化独立空项目 + 阅读当前本地文档 + build 验证
✅ 01 最小 Agent + addTool：完成 Agent / Tool / Mastra 注册 / generate() runner
✅ 02 多工具：移除 toolChoice，加入 multiplyTool 与工具选择行为测试
⬜ 03 Workflow：固定的“拆 → 执行 → 汇总”对照现有 Python workflow/
⬜ 04 Memory + LibSQL：resource / thread、重启后连续会话
⬜ 05 RAG：私有知识检索接 Agent Tool
⬜ 06 Streaming + Studio：观察 Tool call、Token、Trace 与 Workflow 图
⬜ 07 选型复盘：Mastra vs LangGraph vs NestJS 手写工作流
```

---

## 12. 立即可用命令

```bash
cd mastra-playground
pnpm run lesson:01 # 强制 addTool，验证最小 Tool Calling
pnpm run lesson:02 # tool_choice=auto，验证多工具选择与拒绝调用
pnpm run dev       # 启动 Mastra Dev Server / Studio（默认 4111）
pnpm run check     # TypeScript 类型检查
pnpm run build     # 构建可部署产物到 .mastra/output/
```

Lesson 01 / 02 都注册在 `calculatorAgent`。运行 `pnpm run dev` 后，可在 `http://localhost:4111` 的 Studio 中直接聊天、查看 Tool Call 和 Trace。

---

## 三句话记住本课

1. **Mastra 是“AI 应用运行时”，不只是 Agent Loop：它统一 Agent、Workflow、Memory、Storage、Server 和 Studio。**
2. **`createTool()` 的 Schema 是模型调用与运行时校验之间的契约；`Agent.generate()` 接管了手写的模型-工具循环。**
3. **多工具 Agent 的质量等于“选对、按正确顺序调用、并能在能力边界外不调用”；仅验证一个工具被强制执行还不够。**

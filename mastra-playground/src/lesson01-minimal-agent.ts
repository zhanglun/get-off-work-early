/**
 * Lesson 01：从命令行运行最小 Mastra Agent + Tool。
 *
 * 运行前：
 *   export ZHIPU_API_KEY="..."
 * 或：
 *   ZHIPU_API_KEY="..." node --env-file=.env src/lesson01-minimal-agent.ts
 *
 * 运行：
 *   pnpm run lesson:01
 */
import { mastra } from "./mastra/index.ts";

const agent = mastra.getAgentById("calculator-agent");

if (!agent) {
 throw new Error(
  "未找到 calculator-agent；请检查 src/mastra/index.ts 的注册。",
 );
}

let response: Awaited<ReturnType<typeof agent.generate>>;

try {
 response = await agent.generate("12.5 加 7.25 等于多少？", {
  // Lesson 的业务级保险丝：最多允许“模型请求工具 + 读取结果后回答”两轮。
  maxSteps: 2,
  // 用于验证 Tool Calling；生产环境通常保持 auto，让模型自行判断是否该用工具。
  toolChoice: { type: "tool", toolName: "addTool" },
 });
} catch (error) {
 const message = error instanceof Error ? error.message : String(error);
 throw new Error(
  `Mastra Agent 调用失败：${message}\n` +
   "请确认 ZHIPU_API_KEY 已配置；若上游返回 429，请稍后重试。",
  { cause: error },
 );
}

const lines = [
 "=== Mastra Lesson 01：最小 Agent + Tool ===",
 "预期链路：用户问题 → Agent 选择 add → execute() → Agent 最终回答",
 "",
 `最终回答：${response.text}`,
 `结束原因：${response.finishReason}`,
 `执行步骤数：${response.steps.length}`,
 `工具调用数：${response.toolCalls.length}`,
];

for (const [index, toolCall] of response.toolCalls.entries()) {
 lines.push(
  `工具调用 ${index + 1}：${toolCall.payload.toolName}(${JSON.stringify(toolCall.payload.args)})`,
 );
}

for (const [index, toolResult] of response.toolResults.entries()) {
 lines.push(
  `工具结果 ${index + 1}：${toolResult.payload.toolName} → ${JSON.stringify(toolResult.payload.result)}`,
 );
}

lines.push(`Token Usage：${JSON.stringify(response.usage)}`);
console.info(lines.join("\n"));

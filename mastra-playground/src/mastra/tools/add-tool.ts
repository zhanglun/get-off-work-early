import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";

/**
 * Lesson 01 的最小确定性能力。
 *
 * 它刻意不依赖网络或数据库，目的是把注意力放在：
 * 1. Zod 输入/输出 Schema；
 * 2. Agent 决定调用工具；
 * 3. Mastra 执行 execute() 并把结果回传给模型。
 */
export const addTool = createTool({
 id: "add",
 description: "计算两个数字的加法。用户询问两个数相加时必须使用此工具。",
 inputSchema: z.object({
  a: z.number().describe("第一个加数"),
  b: z.number().describe("第二个加数"),
 }),
 outputSchema: z.object({
  expression: z.string(),
  result: z.number(),
 }),
 execute: async ({ a, b }) => ({
  expression: `${a} + ${b}`,
  result: a + b,
 }),
});

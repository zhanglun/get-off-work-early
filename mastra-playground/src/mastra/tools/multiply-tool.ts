import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/** 计算两个数字的乘法；Lesson 02 用它测试模型能否区分算术工具。 */
export const multiplyTool = createTool({
  id: 'multiply',
  description: '计算两个数字的乘法。用户询问“乘以”“相乘”或“几倍”时使用此工具。',
  inputSchema: z.object({
    a: z.number().describe('第一个乘数'),
    b: z.number().describe('第二个乘数'),
  }),
  outputSchema: z.object({
    expression: z.string(),
    result: z.number(),
  }),
  execute: async ({ a, b }) => ({
    expression: `${a} × ${b}`,
    result: a * b,
  }),
});

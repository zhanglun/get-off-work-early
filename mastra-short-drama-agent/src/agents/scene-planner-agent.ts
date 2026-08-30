import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { scenePlanSchema } from '../domain/scene-schemas.ts';

const scenePlannerOutputSchema = z.object({
  scenes: z.array(scenePlanSchema),
});

export const scenePlannerAgent = new Agent({
  id: 'scene-planner',
  name: 'Scene Planner',
  description: '将已确认的 StoryBible 和剧本场次整理成可执行的场次计划。',
  instructions: `
你是短剧场次规划师。只能基于已确认的 StoryBible 和原始剧本规划场次，不要擅自新增角色、地点或剧情事实。
为每个场次明确：戏剧目标、核心冲突、事件节拍、情绪弧线和连续性注意事项。
如果信息不足，降低 confidence 并写入 continuityNotes，不要伪装成确定事实。
每个 sourceRefs 必须指向输入中的 StoryBible 或场次编号。只输出符合 schema 的结构化结果。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
});

export { scenePlanSchema, scenePlannerOutputSchema };

import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { findingSchema, refineResultSchema, reviewReportSchema, shotDraftSchema } from '../domain/schemas.ts';

const model = process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol';

export const directorAgent = new Agent({
  id: 'storyboard-director',
  name: 'Storyboard Director',
  description: '为短剧单个镜头设计可执行、连续且不穿帮的生成提示词。',
  instructions: `
你是短剧分镜导演。基于剧本片段、旧提示词、角色卡和相邻镜头上下文，输出一个镜头方案。
必须保留叙事意图，但要修复旧提示词中的歧义；角色卡 canonical 必须原样嵌入 prompt。
关注画面物理逻辑、景别/运镜、构图、光线、情绪，以及可直接交给视频模型执行的具体措辞。
不要输出 Markdown，只输出符合给定 schema 的结构化结果。
`,
  model,
});

export const reviewerAgent = new Agent({
  id: 'storyboard-reviewer',
  name: 'Storyboard Reviewer',
  description: '以严格甲方视角审查镜头提示词，识别角色不一致、连续性和物理逻辑问题。',
  instructions: `
你是独立的短剧分镜审查员，不负责创作，只负责找问题。
逐项检查：character-consistency、scene-continuity、physical-logic、shot-language、prompt-specificity。
只有全部规则满足时 passed 才能为 true；发现问题必须给出具体 issue 和 suggestion。
不要输出 Markdown，只输出符合给定 schema 的结构化结果。
`,
  model,
});

export const refinerAgent = new Agent({
  id: 'storyboard-refiner',
  name: 'Storyboard Refiner',
  description: '根据审查发现逐条修订镜头提示词，并保留未涉及部分。',
  instructions: `
你是提示词优化师。只修改 Reviewer 指出的内容，其他镜头设计保持稳定。
character-consistency 问题必须以角色卡 canonical 为唯一来源并原样嵌入 prompt。
修改必须落到具体措辞，并在 changes 中说明每条发现如何处理。
不要输出 Markdown，只输出符合给定 schema 的结构化结果。
`,
  model,
});

export const directorOutputSchema = shotDraftSchema;
export const reviewerOutputSchema = reviewReportSchema;
export const refinerOutputSchema = refineResultSchema;
export const reviewFindingSchema = findingSchema;

export type AgentSchemas = {
  director: typeof directorOutputSchema;
  reviewer: typeof reviewerOutputSchema;
  refiner: typeof refinerOutputSchema;
};

export const emptyReviewSchema = z.object({
  passed: z.boolean(),
  confidence: z.number(),
  findings: z.array(reviewFindingSchema),
});

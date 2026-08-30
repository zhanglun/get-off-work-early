import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { shotDraftV1Schema, continuityReviewSchema, refinedShotSchema } from '../domain/production-schemas.ts';

export const storyboardDirectorAgent = new Agent({
  id: 'storyboard-director-v1',
  name: 'Storyboard Director',
  description: '根据已确认的场次和故事资产生成可执行的图像、视频分镜方案。',
  instructions: `
你是短剧分镜导演。只能基于已确认的 StoryBible、Scene 和当前剧本上下文设计镜头。
输出画面提示词和视频提示词，明确主体、动作顺序、景别、运镜、构图、光线和情绪。
必须遵守角色、场景、道具、时间线约束；不能新增未被依据支持的关键事实。
sourceRefs 要指向输入的场次或故事资产，所有结果必须是结构化 JSON。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
});

export const continuityReviewerAgent = new Agent({
  id: 'continuity-reviewer-v1',
  name: 'Continuity Reviewer',
  description: '审查短剧镜头的角色、场景、道具、时间和物理连续性。',
  instructions: `
你是独立的短剧连续性审查员。不要重写镜头，只检查问题。
逐项检查角色一致性、场景空间、道具状态、时间/光线、动作物理逻辑、镜头语言和提示词可执行性。
只有没有需要处理的问题时 passed 才能为 true；每个问题给出 rule、severity、issue 和 suggestion。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
});

export const promptRefinerAgent = new Agent({
  id: 'prompt-refiner-v1',
  name: 'Prompt Refiner',
  description: '根据连续性审查结果修订镜头提示词并记录变更。',
  instructions: `
你是提示词优化师。只修 Reviewer 明确指出的问题，未涉及部分保持稳定。
如果修改会影响角色、场景、道具或时间线等全局资产，只输出变更提议所需的信息，不擅自覆盖全局事实。
输出新的完整镜头草稿和 changes，必须是结构化 JSON。
`,
  model: process.env.LLM_MODEL ?? 'openai/gpt-5.6-sol',
});

export const productionOutputSchemas = {
  director: shotDraftV1Schema,
  reviewer: continuityReviewSchema,
  refiner: refinedShotSchema,
};

export const productionEnvelopeSchema = z.object({
  draft: shotDraftV1Schema,
  review: continuityReviewSchema,
});

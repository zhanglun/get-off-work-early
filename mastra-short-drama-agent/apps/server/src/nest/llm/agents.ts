import {
  storyBibleDraftSchema,
  type StoryBibleDraft,
  type ParsedScript,
} from '../../domain/story-schemas.ts';
import {
  shotDraftV1Schema,
  continuityReviewSchema,
  refinedShotSchema,
  type ShotDraftV1,
  type ContinuityReview,
} from '../../domain/production-schemas.ts';
import { scenePlanListSchema, type ScenePlan } from './scene-schemas.ts';
import { ModelRequestError, type StructuredAgent, type GenerationResult } from './provider.ts';
import { generateStructured } from './provider.ts';

export const scriptAnalystAgent: StructuredAgent = {
  id: 'script-analyst',
  name: 'Script Analyst',
  instructions: `你是短剧剧本分析师。你的任务不是改写剧本，而是建立 StoryBible 草稿。
输入包含原始剧本和程序预解析结果。程序解析出的场次、对白和动作是事实线索，不要无依据地改变它们。
补充：剧本摘要、logline、角色外观与性格、场景空间、关键道具、人物关系、时间线、剧情目的和不确定项。
sourceRefs 必须指向输入中的剧本或预解析场次；不能把猜测伪装成剧本事实。
剧本没有明确描述时用“待确认”措辞并降低 confidence，必要时写入 ambiguities。`,
  schema: storyBibleDraftSchema,
};

export const scenePlannerAgent: StructuredAgent = {
  id: 'scene-planner',
  name: 'Scene Planner',
  instructions: `你是短剧场次规划师。基于 StoryBible 和预解析场次，为每场补充目标、冲突、节拍与情绪弧线。
不要改动场次顺序与归属；每场输出 2-5 个可供分镜使用的节拍。`,
  schema: scenePlanListSchema,
};

export const storyboardDirectorAgent: StructuredAgent = {
  id: 'storyboard-director',
  name: 'Storyboard Director',
  instructions: `你是短剧分镜导演。只能基于 StoryBible、场次和剧本上下文设计镜头。
输出画面与视频提示词，明确主体、动作顺序、景别、运镜、构图、光线和情绪。
必须遵守角色、场景、道具、时间线约束；不能新增未被依据支持的关键事实。`,
  schema: shotDraftV1Schema,
};

export const continuityReviewerAgent: StructuredAgent = {
  id: 'continuity-reviewer',
  name: 'Continuity Reviewer',
  instructions: `你是独立的短剧连续性审查员。不要重写镜头，只检查问题。
逐项检查角色一致性、场景空间、道具状态、时间/光线、动作物理逻辑、镜头语言和提示词可执行性。
只有没有需要处理的问题时 passed 才为 true；每个问题给出 rule、severity、issue 和 suggestion。`,
  schema: continuityReviewSchema,
};

export const promptRefinerAgent: StructuredAgent = {
  id: 'prompt-refiner',
  name: 'Prompt Refiner',
  instructions: `你是提示词优化师。只修 Reviewer 明确指出的问题，未涉及部分保持稳定。
如果修改会影响全局资产，只在 changes 里说明，不擅自覆盖全局事实。输出新的完整镜头草稿。`,
  schema: refinedShotSchema,
};

export async function generateStoryBible(parsed: ParsedScript, scriptText: string): Promise<GenerationResult<StoryBibleDraft>> {
  return generateStructured<StoryBibleDraft>(
    scriptAnalystAgent,
    `【原始剧本】\n${scriptText}\n\n【预解析结果】\n${JSON.stringify(parsed)}`,
  );
}

export async function generateScenePlans(parsed: ParsedScript, bible: StoryBibleDraft): Promise<GenerationResult<ScenePlan[]>> {
  const result = await generateStructured<{ scenes: ScenePlan[] }>(
    scenePlannerAgent,
    `【StoryBible】\n${JSON.stringify(bible)}\n\n【预解析场次】\n${JSON.stringify(parsed.scenes)}`,
  );
  return { ...result, value: result.value.scenes };
}

export function generateShot(scene: ScenePlan, sequence: number, beat: string, bible: StoryBibleDraft): Promise<GenerationResult<ShotDraftV1>> {
  if (process.env.DEV_FAIL_SHOT === `${scene.sceneNo}:${sequence}`) {
    throw new ModelRequestError(`开发故障注入：镜 ${scene.sceneNo}-${sequence} 模型请求失败`);
  }
  return generateStructured<ShotDraftV1>(
    storyboardDirectorAgent,
    `【StoryBible】${JSON.stringify(bible)}\n【Scene】${JSON.stringify(scene)}\n【当前镜头序号】${sequence}\n【当前节拍】${beat}`,
  );
}

export function reviewShot(scene: ScenePlan, bible: StoryBibleDraft, draft: ShotDraftV1): Promise<GenerationResult<ContinuityReview>> {
  return generateStructured<ContinuityReview>(
    continuityReviewerAgent,
    `【StoryBible】${JSON.stringify(bible)}\n【Scene】${JSON.stringify(scene)}\n【Shot】${JSON.stringify(draft)}`,
  );
}

export function refineShot(scene: ScenePlan, bible: StoryBibleDraft, draft: ShotDraftV1): Promise<GenerationResult<{ draft: ShotDraftV1; changes: string }>> {
  return generateStructured<{ draft: ShotDraftV1; changes: string }>(
    promptRefinerAgent,
    `【StoryBible】${JSON.stringify(bible)}\n【Scene】${JSON.stringify(scene)}\n【Shot】${JSON.stringify(draft)}`,
  );
}

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
import {
  episodeGroupListSchema,
  episodeSplitReviewSchema,
  shotPlanListSchema,
  validateShotPlan,
  type EpisodeGroupList,
  type EpisodeSplitReview,
  type ShotPlanList,
} from './split-schemas.ts';
import {
  sceneBriefList,
  validateEpisodeGroups,
  type EpisodeGroup,
} from '../../domain/episode-splitter.ts';
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

// ── 拆集：规则失败时的模型分组（结构校验失败携反馈重试，最多 3 轮）──

export const episodeSplitterAgent: StructuredAgent = {
  id: 'episode-splitter',
  name: 'Episode Splitter',
  instructions: `你是短剧拆集师。输入是一部完整剧本解析出的场次清单（场次下标 + 场次标题 + 行数 + 对白数）。
你的任务是把全部场次划分为多集：每集剧情独立成篇，有自身的起承转合；集与集在悬念钩子处断开，不能把一个连续动作序列拦腰截断。
episodeNo 从 1 开始严格递增；sceneIndexes 必须合起来覆盖全部场次且互不重叠；summary 用一句话概括该集剧情。`,
  schema: episodeGroupListSchema,
};

export const episodeSplitReviewerAgent: StructuredAgent = {
  id: 'episode-split-reviewer',
  name: 'Episode Split Reviewer',
  instructions: `你是独立的拆集审查员。输入是场次清单与一版分集结果，只检查不改写：逐集核对剧情是否独立成篇、边界是否落在自然的悬念或收束处、有无场次被错误归集。
没有问题时 passed 为 true；有问题时给出 issues（指出集数与原因），并在 corrected 中输出修正后的完整分组（必须覆盖全部场次）。无法给出可靠修正时 corrected 置为 null。`,
  schema: episodeSplitReviewSchema,
};

export async function splitEpisodesByModel(parsed: ParsedScript): Promise<EpisodeGroup[]> {
  const brief = sceneBriefList(parsed);
  let feedback = '';
  for (let round = 1; round <= 3; round++) {
    const result = await generateStructured<EpisodeGroupList>(
      episodeSplitterAgent,
      `【场次清单】\n${brief}\n\n${feedback ? `【上一轮分组未通过结构校验，必须修正】\n${feedback}\n\n` : ''}请输出完整分集分组。`,
    );
    const verdict = validateEpisodeGroups(result.value.episodes, parsed.scenes.length);
    if (verdict.ok) return result.value.episodes;
    feedback = verdict.problems.join('；');
  }
  throw new ModelRequestError('模型拆集未通过结构校验（已重试 3 轮）');
}

export interface EpisodeSplitReviewResult {
  passed: boolean;
  issues: EpisodeSplitReview['issues'];
  groups: EpisodeGroup[];
}

/** 拆分复查：审查员发现问题并给出修正分组时，修正结果需再次过结构校验后进入下一轮复查。 */
export async function reviewEpisodeSplit(groups: EpisodeGroup[], parsed: ParsedScript): Promise<EpisodeSplitReviewResult> {
  const brief = sceneBriefList(parsed);
  let current = groups;
  let lastIssues: EpisodeSplitReview['issues'] = [];
  for (let round = 1; round <= 2; round++) {
    const result = await generateStructured<EpisodeSplitReview>(
      episodeSplitReviewerAgent,
      `【场次清单】\n${brief}\n\n【当前分集】\n${JSON.stringify(current)}`,
    );
    if (result.value.passed) return { passed: true, issues: [], groups: current };
    lastIssues = result.value.issues;
    if (result.value.corrected) {
      const verdict = validateEpisodeGroups(result.value.corrected.episodes, parsed.scenes.length);
      if (verdict.ok) {
        current = result.value.corrected.episodes;
        continue;
      }
    }
    break;
  }
  return { passed: false, issues: lastIssues, groups: current };
}

// ── 镜头规划：每场镜头数由模型按内容密度决定（校验失败携反馈重试，最多 3 轮）──

export const shotPlannerAgent: StructuredAgent = {
  id: 'shot-planner',
  name: 'Shot Planner',
  instructions: `你是短剧分镜规划师。输入是一场次规划清单（场次标题、目标、冲突、节拍、对白与动作密度）。
为每场决定镜头数：节拍多、动作与对白密集的场分配更多镜头；过渡性短场可以只给 1 个镜头。
镜头总数要匹配短剧节奏，避免平均主义；rationale 用一句话说明分配依据。`,
  schema: shotPlanListSchema,
};

export async function planShotsByModel(scenePlans: ScenePlan[], parsedScenes: { sceneNo: number; dialogues: string[]; actions: string[] }[]): Promise<Map<number, number>> {
  const density = new Map(parsedScenes.map((scene) => [scene.sceneNo, scene]));
  const brief = scenePlans.map((scene) => {
    const source = density.get(scene.sceneNo);
    return `场次 ${scene.sceneNo}：${scene.heading}（节拍 ${scene.beats.length} 个 · 对白 ${source?.dialogues.length ?? 0} 条 · 动作 ${source?.actions.length ?? 0} 条）\n  目标：${scene.objective}\n  节拍：${scene.beats.join(' / ')}`;
  }).join('\n');
  let feedback = '';
  for (let round = 1; round <= 3; round++) {
    const result = await generateStructured<ShotPlanList>(
      shotPlannerAgent,
      `【场次规划】\n${brief}\n\n${feedback ? `【上一轮规划未通过校验，必须修正】\n${feedback}\n\n` : ''}请为每场输出镜头数。`,
    );
    const verdict = validateShotPlan(result.value, scenePlans);
    if (verdict.ok) {
      return new Map(result.value.scenes.map((item) => [item.sceneNo, item.shotCount]));
    }
    feedback = verdict.problems.join('；');
  }
  throw new ModelRequestError('镜头规划未通过校验（已重试 3 轮）');
}

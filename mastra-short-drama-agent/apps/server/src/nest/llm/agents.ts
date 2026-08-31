import { z } from 'zod';
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
import type { StructuredAgent, GenerationResult } from './provider.ts';
import { generateStructured } from './provider.ts';

// ── Agent 指令（沿用 Spike 的指令文本，经 Provider 直连 OpenAI 兼容接口）──

export const scriptAnalystAgent: StructuredAgent = {
  id: 'script-analyst',
  name: 'Script Analyst',
  instructions: `你是短剧剧本分析师。你的任务不是改写剧本，而是建立 StoryBible 草稿。
输入包含原始剧本和程序预解析结果。程序解析出的场次、对白和动作是事实线索，不要无依据地改变它们。
补充：剧本摘要、logline、角色外观与性格、场景空间、关键道具、人物关系、时间线、剧情目的和不确定项。
sourceRefs 必须指向输入中的剧本或预解析场次；不能把猜测伪装成剧本事实。
剧本没有明确描述时用"待确认"措辞并降低 confidence，必要时写入 ambiguities。`,
  schema: storyBibleDraftSchema,
};

export const scenePlannerAgent: StructuredAgent = {
  id: 'scene-planner',
  name: 'Scene Planner',
  instructions: `你是短剧场次规划师。基于已确认的 StoryBible 和预解析场次，为每场补充目标、冲突、节拍与情绪弧线。
不要改动场次顺序与归属；节拍（beats）是后续分镜的依据，每场 2-5 拍。`,
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

// ── Mock 生成（可复现；支持 MOCK_FAIL_SHOT 注入失败）──

export function mockStoryBible(parsed: ParsedScript, scriptText: string): StoryBibleDraft {
  const characters = [...new Set(parsed.scenes.flatMap((scene) => scene.characters))].map((name) => ({
    name,
    aliases: [] as string[],
    age: null,
    appearance: '待确认（剧本未明确外观）',
    clothing: '待确认',
    personality: '待确认',
    speakingStyle: '待确认',
    canonicalDescription: `${name}：由剧本对白与动作推断的主要角色。`,
    sourceRefs: [{ type: 'script' as const, ref: 'script:full' }],
    confidence: 0.6,
  }));
  const locations = [...new Set(parsed.scenes.map((scene) => scene.locationLabel).filter(Boolean))] as string[];
  return {
    summary: `本集共 ${parsed.scenes.length} 场，围绕${characters.map((c) => c.name).join('、')}展开。`,
    logline: 'Mock 摘要：主线冲突在场景推进中逐步升级并收束。',
    characters,
    locations: locations.map((name) => ({
      name,
      layout: '待确认',
      lighting: '待确认',
      colorStyle: '待确认',
      fixedProps: [],
      spatialConstraints: [],
      sourceRefs: [{ type: 'script' as const, ref: `location:${name}` }],
      confidence: 0.55,
    })),
    props: [],
    relationships: characters.slice(0, 2).length === 2
      ? [{ from: characters[0].name, to: characters[1].name, type: '对手/伙伴', description: '待确认', sourceRefs: [] }]
      : [],
    timeline: parsed.scenes.map((scene, index) => ({
      sceneNo: scene.sceneNo,
      sequence: index + 1,
      timeLabel: scene.timeLabel ?? '待确认',
      participants: scene.characters,
      action: scene.actions[0] ?? '',
      emotionalChange: '待确认',
      dramaticPurpose: '推进主线',
      sourceRefs: [{ type: 'script' as const, ref: `scene:${scene.sceneNo}` }],
    })),
    ambiguities: parsed.warnings,
    conflicts: [],
  };
}

export function mockScenePlans(parsed: ParsedScript): ScenePlan[] {
  return parsed.scenes.map((scene) => ({
    sceneNo: scene.sceneNo,
    heading: scene.heading,
    timeLabel: scene.timeLabel,
    locationLabel: scene.locationLabel,
    characters: scene.characters,
    objective: `完成第 ${scene.sceneNo} 场的叙事推进`,
    conflict: '待确认（Mock）',
    beats: scene.actions.slice(0, 3).length > 0 ? scene.actions.slice(0, 3) : ['完成本场核心动作'],
    emotionalArc: '平稳推进',
    continuityNotes: [],
  }));
}

export function mockShotDraft(scene: ScenePlan, sequence: number, beat: string): ShotDraftV1 {
  const subject = scene.characters.join('与') || '场景人物';
  const location = scene.locationLabel ?? scene.heading;
  return {
    shotSize: sequence === 1 ? '中景' : '近景',
    cameraMove: sequence === 1 ? '固定镜头后缓慢推近' : '轻微跟拍后停住',
    composition: `${subject}位于画面三分线，保留${location}的空间关系和动作方向。`,
    lighting: `${scene.timeLabel ?? '场次时间'}的自然光，光向与场景设定一致。`,
    emotion: scene.emotionalArc,
    imagePrompt: `${location}，${subject}，${beat}。画面主体明确，保持角色外观、空间位置和道具连续。`,
    videoPrompt: `${location}，${subject}先完成「${beat}」，再在镜头结束时保持明确姿态；${sequence === 1 ? '镜头缓慢推近' : '镜头轻微跟随'}，动作连续可执行。`,
    rationale: `围绕场次目标「${scene.objective}」安排第 ${sequence} 个镜头。`,
    sourceRefs: [{ type: 'script' as const, ref: `scene:${scene.sceneNo}` }],
    confidence: 0.78,
  };
}

export function mockReview(round: number, draft: ShotDraftV1): ContinuityReview {
  if (round === 1) {
    return {
      passed: false,
      confidence: 0.7,
      findings: [{
        rule: 'prompt-specificity',
        severity: 'medium',
        issue: '动作的结束状态没有完全明确。',
        suggestion: '补充动作完成后的停留状态，避免生成模型自由补全。',
      }],
    };
  }
  return { passed: true, confidence: Math.min(0.96, draft.confidence + 0.15), findings: [] };
}

export function mockRefine(draft: ShotDraftV1): { draft: ShotDraftV1; changes: string } {
  return {
    draft: {
      ...draft,
      videoPrompt: `${draft.videoPrompt} 动作完成后人物停留在最终姿态，镜头保持两秒再结束。`,
    },
    changes: '补充动作结束状态和镜头停留时间。',
  };
}

export function shouldFailShotMock(sceneNo: number, sequence: number): boolean {
  return process.env.MOCK_FAIL_SHOT === `${sceneNo}:${sequence}`;
}

// ── 经 Provider 的统一调用面 ──

export async function generateStoryBible(parsed: ParsedScript, scriptText: string): Promise<GenerationResult<StoryBibleDraft>> {
  return generateStructured<StoryBibleDraft>(
    scriptAnalystAgent,
    `【原始剧本】\\n${scriptText}\\n\\n【预解析结果】\\n${JSON.stringify(parsed)}`,
    () => mockStoryBible(parsed, scriptText),
  );
}

export async function generateScenePlans(parsed: ParsedScript, bible: StoryBibleDraft): Promise<GenerationResult<ScenePlan[]>> {
  return generateStructured<ScenePlan[]>(
    scenePlannerAgent,
    `【StoryBible】\\n${JSON.stringify(bible)}\\n\\n【预解析场次】\\n${JSON.stringify(parsed.scenes)}`,
    () => mockScenePlans(parsed),
  );
}

export async function generateShot(scene: ScenePlan, sequence: number, beat: string, bible: StoryBibleDraft): Promise<GenerationResult<ShotDraftV1>> {
  if (!process.env.MODEL_BASE_URL && shouldFailShotMock(scene.sceneNo, sequence)) {
    throw new Error(`mock shot failure: ${scene.sceneNo}/${sequence}`);
  }
  return generateStructured<ShotDraftV1>(
    storyboardDirectorAgent,
    `【StoryBible】${JSON.stringify(bible)}\\n【Scene】${JSON.stringify(scene)}\\n【当前镜头序号】${sequence}\\n【当前节拍】${beat}`,
    () => mockShotDraft(scene, sequence, beat),
  );
}

export async function reviewShot(scene: ScenePlan, bible: StoryBibleDraft, draft: ShotDraftV1): Promise<GenerationResult<ContinuityReview>> {
  return generateStructured<ContinuityReview>(
    continuityReviewerAgent,
    `【StoryBible】${JSON.stringify(bible)}\\n【Scene】${JSON.stringify(scene)}\\n【Shot】${JSON.stringify(draft)}`,
    () => mockReview(1, draft),
  );
}

export async function refineShot(scene: ScenePlan, bible: StoryBibleDraft, draft: ShotDraftV1): Promise<GenerationResult<{ draft: ShotDraftV1; changes: string }>> {
  return generateStructured<{ draft: ShotDraftV1; changes: string }>(
    promptRefinerAgent,
    `【StoryBible】${JSON.stringify(bible)}\\n【Scene】${JSON.stringify(scene)}\\n【Shot】${JSON.stringify(draft)}`,
    () => mockRefine(draft),
  );
}

export const _schemas = { z };

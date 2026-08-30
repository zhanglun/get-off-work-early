import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { storyboardDirectorAgent, continuityReviewerAgent, promptRefinerAgent, productionOutputSchemas } from '../agents/production-agents.ts';
import { sceneRepository } from '../domain/scene-repository.ts';
import { storyRepository } from '../domain/story-repository.ts';
import {
  storyboardProductionInputSchema,
  storyboardProductionResultSchema,
  shotProductionResultSchema,
  type ContinuityReview,
  type ShotDraftV1,
} from '../domain/production-schemas.ts';
import { productionRepository } from '../domain/production-repository.ts';

const preparedProductionSchema = z.object({
  input: storyboardProductionInputSchema,
  scenes: z.array(z.object({
    sceneNo: z.number().int().positive(),
    heading: z.string(),
    timeLabel: z.string().nullable(),
    locationLabel: z.string().nullable(),
    characters: z.array(z.string()),
    objective: z.string(),
    conflict: z.string(),
    beats: z.array(z.string()),
    emotionalArc: z.string(),
    continuityNotes: z.array(z.string()),
  })),
  storyBible: z.unknown(),
});

const productionOutput = z.object({
  episodeId: z.string(),
  shots: z.array(shotProductionResultSchema),
});

function mockDraft(scene: z.infer<typeof preparedProductionSchema>['scenes'][number], sequence: number, beat: string): ShotDraftV1 {
  const subject = scene.characters.join('与') || '场景人物';
  const location = scene.locationLabel ?? scene.heading;
  const time = scene.timeLabel ?? '符合场次设定的时间';
  return {
    shotSize: sequence === 1 ? '中景' : '近景',
    cameraMove: sequence === 1 ? '固定镜头后缓慢推近' : '轻微跟拍后停住',
    composition: `${subject}位于画面三分线，保留${location}的空间关系和动作方向。`,
    lighting: `${time}的自然光，光向与场景设定保持一致。`,
    emotion: scene.emotionalArc,
    imagePrompt: `${location}，${subject}，${beat}。画面主体明确，保持角色外观、空间位置和道具连续。`,
    videoPrompt: `${location}，${subject}先完成“${beat}”，再在镜头结束时保持明确姿态；${sequence === 1 ? '镜头缓慢推近' : '镜头轻微跟随'}，动作连续可执行。`,
    rationale: `围绕场次目标“${scene.objective}”和冲突“${scene.conflict}”安排第${sequence}个镜头。`,
    sourceRefs: [{ type: 'script', ref: `scene:${scene.sceneNo}` }],
    confidence: 0.78,
  };
}

function mockReview(round: number, draft: ShotDraftV1): ContinuityReview {
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

function mockRefine(draft: ShotDraftV1): { draft: ShotDraftV1; changes: string } {
  return {
    draft: {
      ...draft,
      videoPrompt: `${draft.videoPrompt} 动作完成后人物停留在最终姿态，镜头保持两秒再结束。`,
    },
    changes: '补充动作结束状态和镜头停留时间。',
  };
}

async function runAgent<T>(agent: typeof storyboardDirectorAgent | typeof continuityReviewerAgent | typeof promptRefinerAgent, prompt: string, schema: z.ZodType<T>): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
  const response = await agent.generate(prompt, {
    maxSteps: 1,
    structuredOutput: { schema, jsonPromptInjection: 'auto' },
    modelSettings: { temperature: 0.2, maxOutputTokens: 2500 },
  });
  const usage = response.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  return {
    value: schema.parse(response.object),
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? usage?.totalTokens ?? 0,
  };
}

const prepareProductionStep = createStep({
  id: 'prepare-production',
  inputSchema: storyboardProductionInputSchema,
  outputSchema: preparedProductionSchema,
  execute: async ({ inputData }) => {
    const story = await storyRepository.getStoryUnderstanding(inputData.episodeId);
    if (!story) throw new Error(`StoryBible 不存在: ${inputData.episodeId}`);
    if (story.status !== 'confirmed') throw new Error(`StoryBible 尚未确认，不能生产分镜: ${inputData.episodeId}`);
    const scenes = await sceneRepository.getScenePlans(inputData.episodeId);
    if (!scenes) throw new Error(`Scene 规划不存在: ${inputData.episodeId}`);
    if (scenes.status !== 'confirmed') throw new Error(`Scene 尚未确认，不能生产分镜: ${inputData.episodeId}`);
    return { input: inputData, scenes: scenes.scenes, storyBible: story.storyBible };
  },
});

const produceShotsStep = createStep({
  id: 'produce-shots',
  inputSchema: preparedProductionSchema,
  outputSchema: productionOutput,
  execute: async ({ inputData }) => {
    const mode = process.env.LLM_MODE ?? 'mock';
    const selectedScenes = inputData.input.sceneNos?.length
      ? inputData.scenes.filter((scene) => inputData.input.sceneNos?.includes(scene.sceneNo))
      : inputData.scenes;
    const queue = selectedScenes.flatMap((scene) => {
      const beats = scene.beats.length > 0 ? scene.beats : [scene.objective];
      return beats.slice(0, 2)
        .map((beat, index) => ({ scene, sequence: index + 1, beat }))
        .filter((item) => !inputData.input.shotSequences?.length || inputData.input.shotSequences.some((shot) => shot.sceneNo === item.scene.sceneNo && shot.sequence === item.sequence));
    });
    const results: z.infer<typeof shotProductionResultSchema>[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        if (!item) return;
        const startedAt = Date.now();
        let draft: ShotDraftV1 | null = null;
        let inputTokens = 0;
        let outputTokens = 0;
        const reviews: z.infer<typeof shotProductionResultSchema>['reviews'] = [];
        let passed = false;
        try {
          if (mode === 'mock' && process.env.MOCK_FAIL_SHOT === `${item.scene.sceneNo}:${item.sequence}`) {
            throw new Error(`mock shot failure: ${item.scene.sceneNo}/${item.sequence}`);
          }
          if (mode === 'mock') draft = mockDraft(item.scene, item.sequence, item.beat);
          else {
            const response = await runAgent(
              storyboardDirectorAgent,
              `【StoryBible】${JSON.stringify(inputData.storyBible)}\n【Scene】${JSON.stringify(item.scene)}\n【当前镜头序号】${item.sequence}\n【当前节拍】${item.beat}`,
              productionOutputSchemas.director,
            );
            draft = response.value;
            inputTokens += response.inputTokens;
            outputTokens += response.outputTokens;
          }
          if (!draft) throw new Error('Director 未生成镜头草稿');
          for (let round = 1; round <= inputData.input.maxRounds; round++) {
            let review: ContinuityReview;
            if (mode === 'mock') review = mockReview(round, draft);
            else {
              const response = await runAgent(
                continuityReviewerAgent,
                `【StoryBible】${JSON.stringify(inputData.storyBible)}\n【Scene】${JSON.stringify(item.scene)}\n【Shot】${JSON.stringify(draft)}`,
                productionOutputSchemas.reviewer,
              );
              review = response.value;
              inputTokens += response.inputTokens;
              outputTokens += response.outputTokens;
            }
            let changes: string | null = null;
            if (!review.passed && round < inputData.input.maxRounds) {
              if (mode === 'mock') {
                const refined = mockRefine(draft);
                draft = refined.draft;
                changes = refined.changes;
              } else {
                const response: { value: { draft: ShotDraftV1; changes: string }; inputTokens: number; outputTokens: number } = await runAgent(
                  promptRefinerAgent,
                  `【StoryBible】${JSON.stringify(inputData.storyBible)}\n【Scene】${JSON.stringify(item.scene)}\n【Shot】${JSON.stringify(draft)}\n【Findings】${JSON.stringify(review.findings)}`,
                  productionOutputSchemas.refiner,
                );
                draft = response.value.draft;
                changes = response.value.changes;
                inputTokens += response.inputTokens;
                outputTokens += response.outputTokens;
              }
            }
            reviews.push({ round, ...review, changes });
            if (review.passed) {
              passed = true;
              break;
            }
          }
          results.push(shotProductionResultSchema.parse({
            sceneNo: item.scene.sceneNo,
            sequence: item.sequence,
            status: passed ? 'done' : 'needs_review',
            draft,
            promptVersions: draft ? [
              { kind: 'image', version: 1, content: draft.imagePrompt, rationale: draft.rationale },
              { kind: 'video', version: 1, content: draft.videoPrompt, rationale: draft.rationale },
            ] : [],
            reviews,
            iterations: reviews.length,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - startedAt,
          }));
        } catch (error) {
          results.push(shotProductionResultSchema.parse({
            sceneNo: item.scene.sceneNo,
            sequence: item.sequence,
            status: 'failed',
            draft,
            promptVersions: [],
            reviews,
            iterations: reviews.length,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - startedAt,
          }));
          console.warn(`[shot:${item.scene.sceneNo}/${item.sequence}] failed: ${String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(inputData.input.concurrency, queue.length || 1) }, worker));
    results.sort((a, b) => a.sceneNo - b.sceneNo || a.sequence - b.sequence);
    await productionRepository.saveShots(inputData.input.episodeId, results);
    return { episodeId: inputData.input.episodeId, shots: results };
  },
});

const finalizeProductionStep = createStep({
  id: 'finalize-production',
  inputSchema: productionOutput,
  outputSchema: storyboardProductionResultSchema,
  execute: async ({ inputData }) => {
    const summary = {
      total: inputData.shots.length,
      done: inputData.shots.filter((shot) => shot.status === 'done').length,
      needsReview: inputData.shots.filter((shot) => shot.status === 'needs_review').length,
      failed: inputData.shots.filter((shot) => shot.status === 'failed').length,
      inputTokens: inputData.shots.reduce((sum, shot) => sum + shot.inputTokens, 0),
      outputTokens: inputData.shots.reduce((sum, shot) => sum + shot.outputTokens, 0),
    };
    const status = summary.failed === summary.total ? 'failed' : summary.failed > 0 || summary.needsReview > 0 ? 'needs_review' : 'done';
    return storyboardProductionResultSchema.parse({ episodeId: inputData.episodeId, status, shots: inputData.shots, summary });
  },
});

export const storyboardProductionWorkflow = createWorkflow({
  id: 'storyboard-production-workflow',
  inputSchema: storyboardProductionInputSchema,
  outputSchema: storyboardProductionResultSchema,
})
  .then(prepareProductionStep)
  .then(produceShotsStep)
  .then(finalizeProductionStep)
  .commit();

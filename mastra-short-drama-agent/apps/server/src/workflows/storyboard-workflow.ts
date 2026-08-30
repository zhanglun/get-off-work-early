import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  directorAgent,
  refinerAgent,
  reviewerAgent,
} from '../agents/storyboard-agents.ts';
import {
  directorOutputSchema,
  refinerOutputSchema,
  reviewerOutputSchema,
} from '../agents/storyboard-agents.ts';
import {
  businessResultSchema,
  characterCardSchema,
  configSchema,
  legacyImportSchema,
  shotResultSchema,
  taskInputSchema,
  type CharacterCard,
  type LegacyShot,
  type ReviewReport,
  type ShotDraft,
} from '../domain/schemas.ts';
import { storyboardStore } from '../domain/store.ts';

const preparedSchema = taskInputSchema.extend({
  characters: z.array(characterCardSchema),
  legacy: legacyImportSchema,
});

function buildShotContext(
  shot: LegacyShot,
  characters: CharacterCard[],
  allShots: LegacyShot[],
): string {
  const index = allShots.findIndex((item) => item.seq === shot.seq);
  const previous = allShots[index - 1]?.scriptExcerpt ?? '无';
  const next = allShots[index + 1]?.scriptExcerpt ?? '无';
  return [
    `seq=${shot.seq} 场号=${shot.sceneNo} 时长=${shot.durationSec}s`,
    `【剧本片段】${shot.scriptExcerpt}`,
    `【旧系统提示词】${shot.legacyPrompt}`,
    `【角色卡】${characters.map((item) => `${item.name}: ${item.canonical}`).join('\n') || '无'}`,
    `【前一镜摘要】${previous}`,
    `【后一镜摘要】${next}`,
  ].join('\n\n');
}

function mockDraft(shot: LegacyShot, characters: CharacterCard[]): ShotDraft {
  const anchors = characters.map((item) => `${item.name}（${item.canonical}）`).join('、');
  return {
    shotSize: '中景',
    cameraMove: '缓慢推近',
    composition: '主体位于画面三分线，保留明确前后景关系',
    lighting: '延续场景原有光向，暖色自然光',
    emotion: '克制、连续的情绪推进',
    prompt: `${shot.legacyPrompt}。角色锚定：${anchors || '以剧本明确角色为准'}。画面动作单一且可拍，保持人物位置、道具和光线连续。`,
    rationale: '保留旧提示词叙事意图，补充镜头语言、角色锚定和连续性约束。',
  };
}

function mockReview(round: number): ReviewReport {
  return round === 1
    ? {
        passed: false,
        confidence: 0.62,
        findings: [
          {
            rule: 'prompt-specificity',
            severity: 'medium',
            issue: '动作的起止状态不够明确，视频模型可能自由补全。',
            suggestion: '补充动作顺序和镜头结束状态。',
          },
        ],
      }
    : { passed: true, confidence: 0.91, findings: [] };
}

function mockRefine(draft: ShotDraft): { draft: ShotDraft; changes: string } {
  return {
    draft: {
      ...draft,
      prompt: `${draft.prompt} 动作顺序：角色先看向对方，再缓慢抬手，镜头在目光交汇时停住。`,
    },
    changes: '补充动作顺序与镜头结束状态，避免视频模型自由补全。',
  };
}

async function generateObject<T>(
  mode: string,
  agent: typeof directorAgent | typeof reviewerAgent | typeof refinerAgent,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<{ object: T; tokens: number }> {
  if (mode === 'mock') throw new Error('mock-mode');
  const response = await agent.generate(prompt, {
    maxSteps: 1,
    structuredOutput: { schema },
    modelSettings: { temperature: 0.2, maxOutputTokens: 1600 },
  });
  return {
    object: schema.parse(response.object),
    tokens: (response.usage?.totalTokens ?? 0),
  };
}

const prepareTaskStep = createStep({
  id: 'prepare-task',
  inputSchema: taskInputSchema,
  outputSchema: preparedSchema,
  execute: async ({ inputData }) => {
    const config = configSchema.parse(inputData.config ?? {});
    storyboardStore.createTask(inputData);
    storyboardStore.update(inputData.taskId, { status: 'processing' });

    // v1 先模拟旧系统结构化导入；真实系统只需替换这个适配器。
    const legacy = legacyImportSchema.parse({
      shots: inputData.scriptText
        .split(/\n+/)
        .map((text) => text.trim())
        .filter((text) => text && !/^角色[:：]/.test(text))
        .map((text, index) => ({
          seq: index + 1,
          sceneNo: index + 1,
          scriptExcerpt: text,
          durationSec: 8,
          legacyPrompt: text,
        })),
    });
    const characters = inputData.scriptText.match(/角色[:：]([^\n]+)/)?.[1]
      ?.split(/[、,，]/)
      .filter(Boolean)
      .map((name) => ({ name: name.trim(), canonical: `${name.trim()}，服装与外观保持全剧一致` })) ?? [];

    storyboardStore.saveLegacy(inputData.taskId, legacy.shots);
    storyboardStore.saveCharacters(inputData.taskId, characters);
    storyboardStore.update(inputData.taskId, { progress: { done: 0, total: legacy.shots.length } });
    return { ...inputData, config, legacy, characters };
  },
});

const processEpisodeStep = createStep({
  id: 'process-episode',
  inputSchema: preparedSchema,
  outputSchema: z.object({ taskId: z.string(), shots: z.array(shotResultSchema) }),
  execute: async ({ inputData }) => {
    const mode = process.env.LLM_MODE ?? 'mock';
    const config = configSchema.parse(inputData.config ?? {});
    let completed = 0;
    const results: z.infer<typeof shotResultSchema>[] = [];

    // 业务级并发控制：一镜一条独立的 Director → Reviewer → Refiner loop。
    const queue = [...inputData.legacy.shots];
    const worker = async () => {
      while (queue.length) {
        const shot = queue.shift();
        if (!shot) return;
        const context = buildShotContext(shot, inputData.characters, inputData.legacy.shots);
        let draft: ShotDraft | null = null;
        let tokens = 0;
        const reviews: z.infer<typeof shotResultSchema>['reviews'] = [];
        let passed = false;

        try {
          if (mode === 'mock') draft = mockDraft(shot, inputData.characters);
          else {
            const response: { object: ShotDraft; tokens: number } = await generateObject(
              mode,
              directorAgent,
              context,
              directorOutputSchema,
            );
            draft = response.object;
            tokens += response.tokens;
          }
          for (let round = 1; round <= config.maxRounds; round++) {
            let review: ReviewReport;
            if (mode === 'mock') review = mockReview(round);
            else {
              const response: { object: ReviewReport; tokens: number } = await generateObject(
                mode,
                reviewerAgent,
                `${context}\n\n【待审查方案】${JSON.stringify(draft)}`,
                reviewerOutputSchema,
              );
              review = response.object;
              tokens += response.tokens;
            }
            let changes: string | null = null;
            if (!review.passed && round < config.maxRounds) {
              if (mode === 'mock') {
                const refined = mockRefine(draft!);
                draft = refined.draft;
                changes = refined.changes;
              } else {
                const response: { object: { draft: ShotDraft; changes: string }; tokens: number } = await generateObject(
                  mode,
                  refinerAgent,
                  `${context}\n\n【当前方案】${JSON.stringify(draft)}\n\n【审查发现】${JSON.stringify(review.findings)}`,
                  refinerOutputSchema,
                );
                const refined = response.object;
                draft = refined.draft;
                changes = refined.changes;
                tokens += response.tokens;
              }
            }
            reviews.push({ ...review, round, changes });
            if (review.passed) {
              passed = true;
              break;
            }
          }
          const result = shotResultSchema.parse({
            seq: shot.seq,
            status: passed ? 'done' : 'needs_review',
            draft,
            finalPrompt: draft?.prompt ?? null,
            rationale: draft?.rationale ?? null,
            iterations: reviews.length,
            tokensUsed: tokens,
            reviews,
          });
          results.push(result);
          storyboardStore.saveShot(inputData.taskId, result);
        } catch (error) {
          const result = shotResultSchema.parse({
            seq: shot.seq,
            status: 'failed',
            draft,
            finalPrompt: draft?.prompt ?? null,
            rationale: draft?.rationale ?? null,
            iterations: reviews.length,
            tokensUsed: tokens,
            reviews,
          });
          results.push(result);
          storyboardStore.saveShot(inputData.taskId, result);
          console.warn(`[shot:${shot.seq}] failed: ${String(error)}`);
        } finally {
          completed += 1;
          storyboardStore.update(inputData.taskId, { progress: { done: completed, total: inputData.legacy.shots.length } });
        }
      }
    };

    await Promise.all(Array.from({ length: config.concurrency }, worker));
    results.sort((a, b) => a.seq - b.seq);
    return { taskId: inputData.taskId, shots: results };
  },
});

const finalizeTaskStep = createStep({
  id: 'finalize-task',
  inputSchema: z.object({ taskId: z.string(), shots: z.array(shotResultSchema) }),
  outputSchema: businessResultSchema,
  execute: async ({ inputData }) => {
    const summary = {
      total: inputData.shots.length,
      done: inputData.shots.filter((shot) => shot.status === 'done').length,
      needsReview: inputData.shots.filter((shot) => shot.status === 'needs_review').length,
      failed: inputData.shots.filter((shot) => shot.status === 'failed').length,
      tokensUsed: inputData.shots.reduce((sum, shot) => sum + shot.tokensUsed, 0),
    };
    const status: 'done' | 'needs_review' | 'failed' = summary.failed === summary.total
      ? 'failed'
      : summary.needsReview > 0 || summary.failed > 0
        ? 'needs_review'
        : 'done';
    storyboardStore.update(inputData.taskId, { status, shots: inputData.shots });
    return { ...inputData, status, summary };
  },
});

export const storyboardWorkflow = createWorkflow({
  id: 'storyboard-production-workflow',
  inputSchema: taskInputSchema,
  outputSchema: businessResultSchema,
})
  .then(prepareTaskStep)
  .then(processEpisodeStep)
  .then(finalizeTaskStep)
  .commit();

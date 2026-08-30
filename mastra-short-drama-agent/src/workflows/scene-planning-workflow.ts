import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { scenePlannerAgent, scenePlannerOutputSchema } from '../agents/scene-planner-agent.ts';
import { scenePlanningInputSchema, scenePlanningResultSchema, scenePlanSchema, type ScenePlan } from '../domain/scene-schemas.ts';
import { storyRepository } from '../domain/story-repository.ts';
import { sceneRepository } from '../domain/scene-repository.ts';

const planningOutputSchema = z.object({
  input: scenePlanningInputSchema,
  storyBibleId: z.string(),
  scenes: z.array(scenePlanSchema),
});

async function generatePlans(episodeId: string): Promise<{ storyBibleId: string; scenes: ScenePlan[] }> {
  const story = await storyRepository.getStoryUnderstanding(episodeId);
  if (!story) throw new Error(`StoryBible 不存在: ${episodeId}`);
  if (story.status !== 'confirmed') {
    throw new Error(`StoryBible 尚未确认，不能生成 Scene: ${episodeId}`);
  }

  if ((process.env.LLM_MODE ?? 'mock') === 'mock') {
    const scenes = story.parsedScript.scenes.map((scene) => ({
      sceneNo: scene.sceneNo,
      heading: scene.heading,
      timeLabel: scene.timeLabel,
      locationLabel: scene.locationLabel,
      characters: scene.characters,
      objective: `推进第${scene.sceneNo}场的核心叙事事件`,
      conflict: scene.dialogues.length > 0 ? '角色目标与当下信息存在张力' : '角色需要通过行动推动事件继续',
      beats: [
        ...(scene.actions.length > 0 ? scene.actions : ['建立场景和人物状态']),
        ...(scene.dialogues.length > 0 ? scene.dialogues : ['通过动作完成情绪变化']),
      ],
      emotionalArc: '从当前状态进入更明确的情绪或关系变化',
      continuityNotes: [
        scene.timeLabel ? `保持时间设定：${scene.timeLabel}` : '时间待确认',
        scene.locationLabel ? `保持空间设定：${scene.locationLabel}` : '地点待确认',
      ],
      sourceRefs: [{ type: 'script' as const, ref: `scene:${scene.sceneNo}` }],
      confidence: 0.7,
    }));
    return { storyBibleId: story.storyBibleId, scenes };
  }

  const response = await scenePlannerAgent.generate(
    `【已确认 StoryBible】\n${JSON.stringify(story.storyBible)}\n\n【剧本和场次】\n${JSON.stringify(story.parsedScript)}`,
    {
      maxSteps: 1,
      structuredOutput: { schema: scenePlannerOutputSchema, jsonPromptInjection: 'auto' },
      modelSettings: { temperature: 0.2, maxOutputTokens: 5000 },
    },
  );
  const parsed = scenePlannerOutputSchema.parse(response.object);
  return { storyBibleId: story.storyBibleId, scenes: parsed.scenes };
}

const planScenesStep = createStep({
  id: 'plan-scenes',
  inputSchema: scenePlanningInputSchema,
  outputSchema: planningOutputSchema,
  execute: async ({ inputData }) => {
    const plans = await generatePlans(inputData.episodeId);
    return { input: inputData, ...plans };
  },
});

const saveScenePlansStep = createStep({
  id: 'save-scene-plans',
  inputSchema: planningOutputSchema,
  outputSchema: scenePlanningResultSchema,
  execute: async ({ inputData }) => {
    await sceneRepository.saveScenePlans({
      episodeId: inputData.input.episodeId,
      storyBibleId: inputData.storyBibleId,
      status: 'awaiting_confirmation',
      scenes: inputData.scenes,
    });
    return {
      episodeId: inputData.input.episodeId,
      storyBibleId: inputData.storyBibleId,
      status: 'awaiting_confirmation' as const,
      scenes: inputData.scenes,
    };
  },
});

export const scenePlanningWorkflow = createWorkflow({
  id: 'scene-planning-workflow',
  inputSchema: scenePlanningInputSchema,
  outputSchema: scenePlanningResultSchema,
})
  .then(planScenesStep)
  .then(saveScenePlansStep)
  .commit();

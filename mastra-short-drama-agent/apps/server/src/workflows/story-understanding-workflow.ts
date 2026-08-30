import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { scriptAnalystAgent, scriptAnalystOutputSchema } from '../agents/script-analyst-agent.ts';
import {
  storyUnderstandingInputSchema,
  parsedScriptSchema,
  storyBibleDraftSchema,
  type ParsedScript,
  type StoryBibleDraft,
} from '../domain/story-schemas.ts';
import { parseScriptMarkdown } from '../domain/markdown-script-parser.ts';
import { storyRepository } from '../domain/story-repository.ts';
import { projectRepository } from '../domain/project-repository.ts';

const parsedInputSchema = z.object({
  input: storyUnderstandingInputSchema,
  parsedScript: parsedScriptSchema,
});

const analyzedOutputSchema = z.object({
  input: storyUnderstandingInputSchema,
  parsedScript: parsedScriptSchema,
  storyBible: storyBibleDraftSchema,
});

function mockStoryBible(parsed: ParsedScript): StoryBibleDraft {
  const characterNames = [...new Set(parsed.scenes.flatMap((scene) => scene.characters))];
  const locationNames = [...new Set(parsed.scenes.map((scene) => scene.locationLabel).filter((value): value is string => Boolean(value)))];
  return {
    summary: parsed.scenes.map((scene) => scene.actions.join('；') || scene.rawText).join(' '),
    logline: parsed.scenes.length > 0 ? `第${parsed.scenes.length}场短剧：人物在连续事件中产生新的冲突与行动。` : '待补充剧情梗概',
    characters: characterNames.map((name) => ({
      name,
      aliases: [],
      age: null,
      appearance: '剧本未明确，待确认',
      clothing: '剧本未明确，待确认',
      personality: '剧本未明确，待确认',
      speakingStyle: '剧本未明确，待确认',
      canonicalDescription: `${name}：外观、服装和关键特征待用户确认`,
      sourceRefs: [{ type: 'script' as const, ref: `character:${name}` }],
      confidence: 0.45,
    })),
    locations: locationNames.map((name) => ({
      name,
      layout: '剧本未明确，待确认',
      lighting: '剧本未明确，待确认',
      colorStyle: '剧本未明确，待确认',
      fixedProps: [],
      spatialConstraints: [],
      sourceRefs: [{ type: 'script' as const, ref: `location:${name}` }],
      confidence: 0.45,
    })),
    props: [],
    relationships: [],
    timeline: parsed.scenes.map((scene, index) => ({
      sceneNo: scene.sceneNo,
      sequence: index + 1,
      timeLabel: scene.timeLabel ?? '待确认',
      participants: scene.characters,
      action: scene.actions.join('；') || '待确认',
      emotionalChange: '待 Agent 分析或用户确认',
      dramaticPurpose: '待 Agent 分析或用户确认',
      sourceRefs: [{ type: 'script' as const, ref: `scene:${scene.sceneNo}` }],
    })),
    ambiguities: parsed.warnings,
    conflicts: [],
  };
}

async function analyzeStory(parsed: ParsedScript, scriptText: string): Promise<StoryBibleDraft> {
  if ((process.env.LLM_MODE ?? 'mock') === 'mock') return mockStoryBible(parsed);
  const response = await scriptAnalystAgent.generate(
    `【原始剧本】\n${scriptText}\n\n【程序预解析结果】\n${JSON.stringify(parsed)}`,
    {
      maxSteps: 1,
      structuredOutput: {
        schema: scriptAnalystOutputSchema,
        jsonPromptInjection: 'auto',
      },
      modelSettings: { temperature: 0.2, maxOutputTokens: 5000 },
    },
  );
  return scriptAnalystOutputSchema.parse(response.object);
}

const parseScriptStep = createStep({
  id: 'parse-script',
  inputSchema: storyUnderstandingInputSchema,
  outputSchema: parsedInputSchema,
  execute: async ({ inputData }) => {
    const input = storyUnderstandingInputSchema.parse(inputData);
    return { input, parsedScript: parseScriptMarkdown(input.scriptText) };
  },
});

const analyzeStoryStep = createStep({
  id: 'analyze-story',
  inputSchema: parsedInputSchema,
  outputSchema: analyzedOutputSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    storyBible: await analyzeStory(inputData.parsedScript, inputData.input.scriptText),
  }),
});

const saveDraftStep = createStep({
  id: 'save-story-bible-draft',
  inputSchema: analyzedOutputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    episodeId: z.string(),
    scriptVersionId: z.string(),
    storyBibleId: z.string(),
    status: z.literal('awaiting_confirmation'),
    parsedScript: parsedScriptSchema,
    storyBible: storyBibleDraftSchema,
  }),
  execute: async ({ inputData }) => {
    let projectId = inputData.input.projectId ?? `project_${crypto.randomUUID()}`;
    const episodeId = inputData.input.episodeId ?? `episode_${crypto.randomUUID()}`;
    const existingEpisode = await projectRepository.getEpisode(episodeId);
    if (inputData.input.episodeId && !existingEpisode) throw new Error(`剧集不存在: ${episodeId}`);
    if (existingEpisode) projectId = existingEpisode.projectId;
    if (!existingEpisode) {
      await projectRepository.createProject({ id: projectId, name: inputData.input.projectName });
      await projectRepository.createEpisode({ id: episodeId, projectId, episodeNo: inputData.input.episodeNo, title: inputData.input.episodeTitle });
    }
    const scriptVersionId = `script_${crypto.randomUUID()}`;
    const storyBibleId = `bible_${crypto.randomUUID()}`;
    const result = {
      projectId,
      episodeId,
      scriptVersionId,
      storyBibleId,
      status: 'awaiting_confirmation' as const,
      parsedScript: inputData.parsedScript,
      storyBible: inputData.storyBible,
    };
    await storyRepository.saveStoryUnderstanding({
      ...result,
      projectName: inputData.input.projectName,
      episodeNo: inputData.input.episodeNo,
      scriptText: inputData.input.scriptText,
    });
    return result;
  },
});

export const storyUnderstandingWorkflow = createWorkflow({
  id: 'story-understanding-workflow',
  inputSchema: storyUnderstandingInputSchema,
  outputSchema: z.object({
    projectId: z.string(),
    episodeId: z.string(),
    scriptVersionId: z.string(),
    storyBibleId: z.string(),
    status: z.literal('awaiting_confirmation'),
    parsedScript: parsedScriptSchema,
    storyBible: storyBibleDraftSchema,
  }),
})
  .then(parseScriptStep)
  .then(analyzeStoryStep)
  .then(saveDraftStep)
  .commit();

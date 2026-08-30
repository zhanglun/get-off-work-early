import { storyRepository } from './story-repository.ts';
import { sceneRepository } from './scene-repository.ts';
import { productionRepository } from './production-repository.ts';

export function renderProductionMarkdown(input: {
  story: Awaited<ReturnType<typeof storyRepository.getStoryUnderstanding>>;
  scenes: Awaited<ReturnType<typeof sceneRepository.getScenePlans>>;
  shots: Awaited<ReturnType<typeof productionRepository.listShots>>;
}): string {
  if (!input.story) throw new Error('StoryBible 不存在');
  const lines = [`# ${input.story.projectName} 第${input.story.episodeNo}集`, '', '## 故事摘要', input.story.storyBible.summary, '', '## Logline', input.story.storyBible.logline, '', '## 角色'];
  for (const character of input.story.storyBible.characters) {
    lines.push(`### ${character.name}`, `- 外观：${character.appearance}`, `- 服装：${character.clothing}`, `- 性格：${character.personality}`, `- 固定描述：${character.canonicalDescription}`, '');
  }
  lines.push('## 场次与分镜');
  for (const scene of input.scenes?.scenes ?? []) {
    lines.push(`### 第${scene.sceneNo}场：${scene.heading}`, `- 目标：${scene.objective}`, `- 冲突：${scene.conflict}`, `- 情绪弧线：${scene.emotionalArc}`, '');
    for (const shot of input.shots.filter((item) => item.sceneNo === scene.sceneNo)) {
      lines.push(`#### 镜头 ${shot.sequence} [${shot.status}]`, `- 景别：${shot.draft?.shotSize ?? '失败'}`, `- 运镜：${shot.draft?.cameraMove ?? '失败'}`, `- 画面提示词：${shot.draft?.imagePrompt ?? ''}`, `- 视频提示词：${shot.draft?.videoPrompt ?? ''}`, `- 理由：${shot.draft?.rationale ?? ''}`, `- 审查轮数：${shot.iterations}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderProductionJson(input: Parameters<typeof renderProductionMarkdown>[0]): string {
  return JSON.stringify({
    project: input.story ? { id: input.story.projectId, name: input.story.projectName } : null,
    episode: input.story ? { id: input.story.episodeId, episodeNo: input.story.episodeNo } : null,
    storyBible: input.story?.storyBible ?? null,
    scenes: input.scenes ?? null,
    shots: input.shots,
  }, null, 2);
}

export async function exportEpisode(episodeId: string, format: 'markdown' | 'json'): Promise<{ episodeId: string; format: string; content: string }> {
  const [story, scenes, shots] = await Promise.all([
    storyRepository.getStoryUnderstanding(episodeId),
    sceneRepository.getScenePlans(episodeId),
    productionRepository.listShots(episodeId),
  ]);
  if (!story) throw new Error(`StoryBible 不存在: ${episodeId}`);
  if (story.status !== 'confirmed') throw new Error(`StoryBible 尚未确认: ${episodeId}`);
  if (!scenes || scenes.status !== 'confirmed') throw new Error(`Scene 尚未确认: ${episodeId}`);
  if (shots.length === 0) throw new Error(`分镜尚未生成: ${episodeId}`);
  const content = format === 'markdown' ? renderProductionMarkdown({ story, scenes, shots }) : renderProductionJson({ story, scenes, shots });
  const version = 1;
  await productionRepository.saveExport({ episodeId, version, format, includedAssets: { storyBible: story.storyBibleId, sceneCount: scenes.scenes.length, shotCount: shots.length }, content });
  return { episodeId, format, content };
}

import { mastra } from './mastra/index.ts';
import { storyRepository } from './domain/story-repository.ts';
import { sceneRepository } from './domain/scene-repository.ts';

const understanding = await storyRepository.getStoryUnderstanding(process.env.EPISODE_ID ?? '');
if (!understanding) {
  const workflow = mastra.getWorkflow('storyUnderstandingWorkflow');
  const run = await workflow.createRun();
  const created = await run.start({
    inputData: {
      projectName: 'Scene Planning Demo',
      episodeNo: 1,
      scriptText: `## 第1场 夜 / 写字楼门口\n【人物】林小雨、陈默\n【动作】林小雨抱着文件冲出旋转门，撞上陈默。\n【对白】陈默：你的合同掉了。\n\n## 第2场 次日白天 / 咖啡馆靠窗位\n【人物】林小雨、陈默\n【动作】陈默端着咖啡寻找位置。`,
    },
  });
  if (created.status !== 'success') throw new Error(`StoryBible 生成失败: ${JSON.stringify(created)}`);
  console.log(`请先确认 StoryBible：POST /episodes/${created.result.episodeId}/story-bible/confirm`);
  console.log(JSON.stringify(created.result, null, 2));
} else if (understanding.status !== 'confirmed') {
  console.log(`当前 StoryBible 尚未确认：${understanding.episodeId}`);
  console.log(`执行：EPISODE_ID=${understanding.episodeId} pnpm run confirm-story-bible`);
} else {
  const workflow = mastra.getWorkflow('scenePlanningWorkflow');
  const run = await workflow.createRun();
  const result = await run.start({ inputData: { episodeId: understanding.episodeId } });
  if (result.status !== 'success') throw new Error(`Scene 规划失败: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result.result, null, 2));
  console.log(JSON.stringify(await sceneRepository.getScenePlans(understanding.episodeId), null, 2));
  console.log(`请确认 Scene 规划：POST /episodes/${understanding.episodeId}/scenes/confirm`);
}
await storyRepository.close?.();
await sceneRepository.close?.();

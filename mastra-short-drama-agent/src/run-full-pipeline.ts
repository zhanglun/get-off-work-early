import { mastra } from './mastra/index.ts';
import { storyRepository } from './domain/story-repository.ts';
import { sceneRepository } from './domain/scene-repository.ts';
import { productionRepository } from './domain/production-repository.ts';
import { exportEpisode } from './domain/export-service.ts';

const storyRun = await mastra.getWorkflow('storyUnderstandingWorkflow').createRun();
const storyResult = await storyRun.start({
  inputData: {
    projectName: '完整链路验收',
    episodeNo: 1,
    scriptText: `# 完整链路验收

## 第1场 夜 / 写字楼门口
【人物】林小雨、陈默
【动作】林小雨抱着文件冲出旋转门，撞上陈默，文件散落一地。
【对白】陈默：你的合同掉了。

## 第2场 次日白天 / 咖啡馆靠窗位
【人物】林小雨、陈默
【动作】陈默端着咖啡寻找位置，林小雨抬头看向他。
【对白】林小雨：是你？
`,
  },
});
if (storyResult.status !== 'success') throw new Error(`StoryBible 失败: ${JSON.stringify(storyResult)}`);
await storyRepository.confirmStoryBible(storyResult.result.episodeId);

const sceneRun = await mastra.getWorkflow('scenePlanningWorkflow').createRun();
const sceneResult = await sceneRun.start({ inputData: { episodeId: storyResult.result.episodeId } });
if (sceneResult.status !== 'success') throw new Error(`Scene 失败: ${JSON.stringify(sceneResult)}`);
await sceneRepository.confirmScenePlans(storyResult.result.episodeId);

const productionRun = await mastra.getWorkflow('storyboardProductionWorkflow').createRun();
const productionResult = await productionRun.start({ inputData: { episodeId: storyResult.result.episodeId, maxRounds: 3, concurrency: 2 } });
if (productionResult.status !== 'success') throw new Error(`分镜生产失败: ${JSON.stringify(productionResult)}`);

const markdown = await exportEpisode(storyResult.result.episodeId, 'markdown');
const json = await exportEpisode(storyResult.result.episodeId, 'json');
console.log(JSON.stringify({
  episodeId: storyResult.result.episodeId,
  storyBible: 'confirmed',
  scenes: sceneResult.result.scenes.length,
  shots: productionResult.result.summary,
  exports: { markdownBytes: markdown.content.length, jsonBytes: json.content.length },
}, null, 2));

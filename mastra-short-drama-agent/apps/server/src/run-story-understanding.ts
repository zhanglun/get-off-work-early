import { mastra } from './mastra/index.ts';
import { storyRepository } from './domain/story-repository.ts';

const workflow = mastra.getWorkflow('storyUnderstandingWorkflow');
const run = await workflow.createRun();
const result = await run.start({
  inputData: {
    projectName: '咖啡馆初遇',
    episodeNo: 1,
    scriptText: `# 咖啡馆初遇

## 第1场 夜 / 写字楼门口
【人物】林小雨、陈默
【动作】林小雨抱着文件冲出旋转门，撞上迎面而来的陈默，文件散落一地。
【对白】陈默：你的合同掉了。

## 第2场 次日白天 / 咖啡馆靠窗位
【人物】林小雨、方圆、陈默
【动作】方圆搅着咖啡提醒林小雨不要回头，陈默端着咖啡寻找位置。
【对白】方圆：别回头，穿黑高领的那个是不是昨天撞你的？
【备注】两人的视线再次相遇。
`,
  },
});

if (result.status !== 'success') throw new Error(`Workflow 执行失败: ${JSON.stringify(result)}`);
console.log(JSON.stringify(result.result, null, 2));
console.log('\n=== 当前 StoryBible 状态 ===');
console.log(JSON.stringify(await storyRepository.getStoryUnderstanding(result.result.episodeId), null, 2));
await storyRepository.close?.();

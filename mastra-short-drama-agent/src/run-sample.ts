import { mastra } from './mastra/index.ts';
import { storyboardStore } from './domain/store.ts';

const taskId = `demo_${Date.now().toString(36)}`;
const scriptText = `
角色：林晚、顾沉
林晚在咖啡馆窗边放下咖啡杯，抬头看向刚进门的顾沉。
顾沉停在门口，确认林晚的位置后向她走来。
两人在窗边坐下，林晚把一张照片推到顾沉面前。
`;

const workflow = mastra.getWorkflow('storyboardWorkflow');
const run = await workflow.createRun();
const result = await run.start({
  inputData: {
    taskId,
    scriptText,
    episodeNo: 1,
    config: { maxRounds: 3, concurrency: 2 },
  },
});

if (result.status !== 'success') {
  throw new Error(`工作流执行失败: ${JSON.stringify(result)}`);
}

console.log(JSON.stringify(result.result, null, 2));
console.log('\n=== 查询已落库任务 ===');
console.log(JSON.stringify(storyboardStore.getTask(taskId), null, 2));

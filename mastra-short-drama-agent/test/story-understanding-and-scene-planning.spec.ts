import assert from 'node:assert/strict';
import test from 'node:test';
import { mastra } from '../src/mastra/index.ts';
import { storyRepository } from '../src/domain/story-repository.ts';
import { sceneRepository } from '../src/domain/scene-repository.ts';

test('StoryBible 确认后才能生成 Scene 规划', async () => {
  const storyWorkflow = mastra.getWorkflow('storyUnderstandingWorkflow');
  const storyRun = await storyWorkflow.createRun();
  const storyResult = await storyRun.start({
    inputData: {
      projectName: 'Scene Planning Test',
      episodeNo: 1,
      scriptText: `## 第1场 夜 / 天台\n【人物】林小雨、陈默\n【动作】林小雨看向远处。\n【对白】陈默：你终于来了。`,
    },
  });
  assert.equal(storyResult.status, 'success');
  if (storyResult.status !== 'success') return;

  const episodeId = storyResult.result.episodeId;
  const blockedRun = await mastra.getWorkflow('scenePlanningWorkflow').createRun();
  const blockedResult = await blockedRun.start({ inputData: { episodeId } });
  assert.equal(blockedResult.status, 'failed');
  if (blockedResult.status === 'failed') {
    assert.match(blockedResult.error.message, /尚未确认/);
  }

  await storyRepository.confirmStoryBible(episodeId);
  const sceneRun = await mastra.getWorkflow('scenePlanningWorkflow').createRun();
  const sceneResult = await sceneRun.start({ inputData: { episodeId } });
  assert.equal(sceneResult.status, 'success');
  if (sceneResult.status !== 'success') return;
  assert.equal(sceneResult.result.status, 'awaiting_confirmation');
  assert.equal(sceneResult.result.scenes.length, 1);
  assert.equal((await sceneRepository.getScenePlans(episodeId))?.scenes.length, 1);
});

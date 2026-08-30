import assert from 'node:assert/strict';
import test from 'node:test';
import { mastra } from '../src/mastra/index.ts';
import { storyRepository } from '../src/domain/story-repository.ts';
import { sceneRepository } from '../src/domain/scene-repository.ts';
import { productionRepository } from '../src/domain/production-repository.ts';
import { exportEpisode } from '../src/domain/export-service.ts';

async function createConfirmedEpisode(): Promise<string> {
  const storyRun = await mastra.getWorkflow('storyUnderstandingWorkflow').createRun();
  const story = await storyRun.start({ inputData: {
    projectName: 'Production Test',
    episodeNo: 1,
    scriptText: `## 第1场 夜 / 天台\n【人物】林小雨、陈默\n【动作】林小雨看向陈默。\n【对白】陈默：你终于来了。`,
  } });
  assert.equal(story.status, 'success');
  if (story.status !== 'success') throw new Error('story workflow failed');
  await storyRepository.confirmStoryBible(story.result.episodeId);
  const sceneRun = await mastra.getWorkflow('scenePlanningWorkflow').createRun();
  const scenes = await sceneRun.start({ inputData: { episodeId: story.result.episodeId } });
  assert.equal(scenes.status, 'success');
  await sceneRepository.confirmScenePlans(story.result.episodeId);
  return story.result.episodeId;
}

test('生产链：Confirmed StoryBible + Scene → Shot/Prompt/Review → Export', async () => {
  const episodeId = await createConfirmedEpisode();
  const productionRun = await mastra.getWorkflow('storyboardProductionWorkflow').createRun();
  const production = await productionRun.start({ inputData: { episodeId, maxRounds: 3, concurrency: 2 } });
  assert.equal(production.status, 'success');
  if (production.status !== 'success') return;
  assert.equal(production.result.status, 'done');
  assert.equal(production.result.summary.total, 2);
  assert.equal(production.result.summary.done, 2);
  assert.ok(production.result.shots.every((shot) => shot.promptVersions.length === 2));
  assert.ok(production.result.shots.every((shot) => shot.reviews.length === 2));

  const stored = await productionRepository.listShots(episodeId);
  assert.equal(stored.length, 2);
  const markdown = await exportEpisode(episodeId, 'markdown');
  const json = await exportEpisode(episodeId, 'json');
  assert.match(markdown.content, /场次与分镜/);
  assert.match(json.content, /"storyBible"/);
});

test('maxRounds=1 时首轮未通过进入 needs_review', async () => {
  const episodeId = await createConfirmedEpisode();
  const run = await mastra.getWorkflow('storyboardProductionWorkflow').createRun();
  const result = await run.start({ inputData: { episodeId, maxRounds: 1, concurrency: 2 } });
  assert.equal(result.status, 'success');
  if (result.status !== 'success') return;
  assert.equal(result.result.summary.needsReview, result.result.summary.total);
  assert.ok(result.result.shots.every((shot) => shot.iterations === 1));
});

test('单镜失败隔离：一个镜头失败不影响同批其他镜头', async () => {
  const episodeId = await createConfirmedEpisode();
  process.env.MOCK_FAIL_SHOT = '1:1';
  try {
    const run = await mastra.getWorkflow('storyboardProductionWorkflow').createRun();
    const result = await run.start({ inputData: { episodeId, maxRounds: 3, concurrency: 2 } });
    assert.equal(result.status, 'success');
    if (result.status !== 'success') return;
    assert.equal(result.result.summary.failed, 1);
    assert.ok(result.result.summary.done >= 1);
  } finally {
    delete process.env.MOCK_FAIL_SHOT;
  }
});

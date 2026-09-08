import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScriptMarkdown } from '../src/domain/markdown-script-parser.ts';
import {
  matchEpisodeMarker,
  splitEpisodesByRules,
  validateEpisodeGroups,
  segmentsFromGroups,
} from '../src/domain/episode-splitter.ts';
import { validateShotPlan } from '../src/nest/llm/split-schemas.ts';
import type { ScenePlan } from '../src/nest/llm/scene-schemas.ts';

const MULTI_EPISODE_SCRIPT = `# 三城故事

序章说明文字。

## 第1集 出发

## 第1场 夜 / 车站
【动作】林小雨登上列车。

## 第2场 日 / 车厢
【对白】陈默：坐这里吧。

## 第2集 抵达

## 第3场 夜 / 天台
【动作】两人看城市灯火。
`;

const MARKERLESS_SCRIPT = `# 无标记剧本

## 第1场 夜 / 车站
【动作】林小雨登上列车。

## 第2场 日 / 车厢
【对白】陈默：坐这里吧。

## 第3场 夜 / 天台
【动作】两人看城市灯火。
`;

test('分集标记识别：标题行、EP、Episode 与对白行防误判', () => {
  assert.deepEqual(matchEpisodeMarker('## 第1集 出发'), { no: 1, title: '出发' });
  assert.deepEqual(matchEpisodeMarker('第3话'), { no: 3, title: null });
  assert.deepEqual(matchEpisodeMarker('EP03 意外'), { no: 3, title: '意外' });
  assert.deepEqual(matchEpisodeMarker('episode 4：重逢'), { no: 4, title: '重逢' });
  assert.equal(matchEpisodeMarker('第2集才怪，事情完全不是这样发展的，越说越长越说越长越说越长越说越长'), null);
  assert.equal(matchEpisodeMarker('林小雨：第2集再见面吧。'), null);
  assert.equal(matchEpisodeMarker('## 第1场 夜 / 车站'), null);
});

test('规则拆分：两集剧本切成两段，序章并入第 1 集，场次归属正确', () => {
  const parsed = parseScriptMarkdown(MULTI_EPISODE_SCRIPT);
  assert.equal(parsed.scenes.length, 3);

  const result = splitEpisodesByRules(MULTI_EPISODE_SCRIPT, parsed);
  assert.equal(result.matchedMarkers, 2);
  assert.equal(result.segments.length, 2);

  const [first, second] = result.segments;
  assert.equal(first!.episodeNo, 1);
  assert.equal(first!.title, '出发');
  assert.deepEqual(first!.sceneIndexes, [0, 1]);
  assert.ok(first!.content.includes('序章说明文字'));
  assert.ok(first!.content.includes('第1集 出发'));
  assert.ok(first!.content.includes('第2场'));

  assert.equal(second!.episodeNo, 2);
  assert.equal(second!.title, '抵达');
  assert.deepEqual(second!.sceneIndexes, [2]);
  assert.ok(second!.content.includes('第2集 抵达'));
  assert.ok(second!.content.includes('天台'));
  assert.ok(!second!.content.includes('第1集'));
});

test('规则拆分：分集标记不足两个时不拆分，交由模型辅助', () => {
  const single = parseScriptMarkdown('## 第1集 独角戏\n\n## 第1场 夜 / 房间\n【动作】发呆。\n');
  const result = splitEpisodesByRules('## 第1集 独角戏\n\n## 第1场 夜 / 房间\n【动作】发呆。\n', single);
  assert.equal(result.matchedMarkers, 1);
  assert.equal(result.segments.length, 0);

  const none = parseScriptMarkdown(MARKERLESS_SCRIPT);
  const noMarker = splitEpisodesByRules(MARKERLESS_SCRIPT, none);
  assert.equal(noMarker.matchedMarkers, 0);
  assert.equal(noMarker.segments.length, 0);
});

test('分组结构校验：完整划分通过，重复/遗漏/越界/乱序拒绝', () => {
  const ok = validateEpisodeGroups([
    { episodeNo: 1, title: null, sceneIndexes: [0, 1] },
    { episodeNo: 2, title: null, sceneIndexes: [2] },
  ], 3);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.problems, []);

  const overlap = validateEpisodeGroups([
    { episodeNo: 1, title: null, sceneIndexes: [0, 1] },
    { episodeNo: 2, title: null, sceneIndexes: [1, 2] },
  ], 3);
  assert.equal(overlap.ok, false);
  assert.ok(overlap.problems.some((problem) => problem.includes('多集')));

  const missing = validateEpisodeGroups([
    { episodeNo: 1, title: null, sceneIndexes: [0] },
    { episodeNo: 2, title: null, sceneIndexes: [1] },
  ], 3);
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((problem) => problem.includes('未被分配')));

  const outOfBounds = validateEpisodeGroups([
    { episodeNo: 1, title: null, sceneIndexes: [0, 9] },
    { episodeNo: 2, title: null, sceneIndexes: [1] },
  ], 3);
  assert.equal(outOfBounds.ok, false);
  assert.ok(outOfBounds.problems.some((problem) => problem.includes('越界')));

  const disorder = validateEpisodeGroups([
    { episodeNo: 2, title: null, sceneIndexes: [0] },
    { episodeNo: 1, title: null, sceneIndexes: [1, 2] },
  ], 3);
  assert.equal(disorder.ok, false);
  assert.ok(disorder.problems.some((problem) => problem.includes('递增')));

  const singleGroup = validateEpisodeGroups([{ episodeNo: 1, title: null, sceneIndexes: [0, 1, 2] }], 3);
  assert.equal(singleGroup.ok, false);
  assert.ok(singleGroup.problems.some((problem) => problem.includes('≥ 2')));
});

test('按模型分组切片原文：序章并入首集，边界落在场次起始行', () => {
  const parsed = parseScriptMarkdown(MARKERLESS_SCRIPT);
  const segments = segmentsFromGroups(MARKERLESS_SCRIPT, [
    { episodeNo: 1, title: '启程', sceneIndexes: [0, 1], summary: '上车' },
    { episodeNo: 2, title: '夜晚', sceneIndexes: [2], summary: '天台' },
  ], parsed);

  assert.equal(segments.length, 2);
  assert.ok(segments[0]!.content.includes('无标记剧本'));
  assert.ok(segments[0]!.content.includes('第1场'));
  assert.ok(segments[0]!.content.includes('第2场'));
  assert.ok(!segments[0]!.content.includes('第3场'));
  assert.equal(segments[1]!.episodeNo, 2);
  assert.ok(segments[1]!.content.includes('第3场'));
  assert.ok(segments[1]!.content.includes('两人看城市灯火'));
});

function scenePlan(sceneNo: number, beats: string[]): ScenePlan {
  return {
    sceneNo,
    heading: `第${sceneNo}场`,
    timeLabel: null,
    locationLabel: null,
    characters: [],
    objective: '目标',
    conflict: '冲突',
    beats,
    emotionalArc: '平缓',
    continuityNotes: [],
  };
}

test('镜头规划校验：全覆盖通过，缺场次/超上限/总数越界拒绝', () => {
  const plans = [scenePlan(1, ['节拍A']), scenePlan(2, ['节拍B', '节拍C'])];

  const ok = validateShotPlan({ scenes: [{ sceneNo: 1, shotCount: 4, rationale: null }, { sceneNo: 2, shotCount: 6, rationale: null }] }, plans);
  assert.equal(ok.ok, true);

  const missingScene = validateShotPlan({ scenes: [{ sceneNo: 1, shotCount: 5, rationale: null }] }, plans);
  assert.equal(missingScene.ok, false);
  assert.ok(missingScene.problems.some((problem) => problem.includes('缺少场次')));

  const unknownScene = validateShotPlan({ scenes: [{ sceneNo: 1, shotCount: 4, rationale: null }, { sceneNo: 2, shotCount: 6, rationale: null }, { sceneNo: 9, shotCount: 1, rationale: null }] }, plans);
  assert.equal(unknownScene.ok, false);
  assert.ok(unknownScene.problems.some((problem) => problem.includes('未知场次')));

  const overLimit = validateShotPlan({ scenes: [{ sceneNo: 1, shotCount: 20, rationale: null }, { sceneNo: 2, shotCount: 6, rationale: null }] }, plans);
  assert.equal(overLimit.ok, false);
  assert.ok(overLimit.problems.some((problem) => problem.includes('镜头数必须在')));

  const totalTooLow = validateShotPlan({ scenes: [{ sceneNo: 1, shotCount: 1, rationale: null }, { sceneNo: 2, shotCount: 1, rationale: null }] }, plans);
  assert.equal(totalTooLow.ok, false);
  assert.ok(totalTooLow.problems.some((problem) => problem.includes('镜头总数')));
});

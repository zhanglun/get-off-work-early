import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBlindScores } from '../src/core/blind';
import { ScoreSubmitSchema } from '../src/core/types';
import { StoreService } from '../src/prisma/store.service';

// ===== 盲测归因（契约 v1.1 冻结的关键逻辑）=====
test('归因：left:new 时 A 位是新 → winner A 归 new', () => {
  const r = resolveBlindScores({ winner: 'A', scoreA: 5, scoreB: 3, sideOrder: 'left:new' });
  assert.equal(r.winner, 'new');
  assert.equal(r.scoreNew, 5);
  assert.equal(r.scoreOld, 3);
});

test('归因：left:old 时 A 位是旧 → winner A 归 old，双分对调', () => {
  const r = resolveBlindScores({ winner: 'A', scoreA: 4, scoreB: 2, sideOrder: 'left:old' });
  assert.equal(r.winner, 'old');
  assert.equal(r.scoreNew, 2);
  assert.equal(r.scoreOld, 4);
});

test('归因：winner B + left:old → new', () => {
  const r = resolveBlindScores({ winner: 'B', scoreA: 1, scoreB: 5, sideOrder: 'left:old' });
  assert.equal(r.winner, 'new');
  assert.equal(r.scoreNew, 5);
});

test('归因：tie 恒为 tie，双分仍按侧序归位', () => {
  for (const sideOrder of ['left:new', 'left:old'] as const) {
    const r = resolveBlindScores({ winner: 'tie', scoreA: 4, scoreB: 4, sideOrder });
    assert.equal(r.winner, 'tie');
    assert.equal(r.scoreNew, sideOrder === 'left:new' ? 4 : 4);
  }
});

// ===== 提交 schema（v1.1：无 sideOrder、winner 含 tie）=====
test('schema：接受 {shotId, rater, winner: A|B|tie, scoreA, scoreB}', () => {
  for (const winner of ['A', 'B', 'tie'] as const) {
    const r = ScoreSubmitSchema.safeParse({ shotId: 's1', rater: '客户1', winner, scoreA: 4, scoreB: 3 });
    assert.equal(r.success, true);
  }
});

test('schema：客户端传 sideOrder 不再是合法字段（多余键忽略，但不参与校验）——文档层面已移除', () => {
  const r = ScoreSubmitSchema.safeParse({ shotId: 's1', rater: 'x', winner: 'A', scoreA: 4, scoreB: 3, sideOrder: 'left:new' });
  // zod 默认 strip 未知键：通过但 sideOrder 被丢弃，服务端不信客户端侧序
  assert.equal(r.success, true);
  assert.equal('sideOrder' in (r.success ? r.data : {}), false);
});

test('schema：分数越界（0/6）拒绝', () => {
  assert.equal(ScoreSubmitSchema.safeParse({ shotId: 's1', rater: 'x', winner: 'A', scoreA: 0, scoreB: 3 }).success, false);
  assert.equal(ScoreSubmitSchema.safeParse({ shotId: 's1', rater: 'x', winner: 'A', scoreA: 6, scoreB: 3 }).success, false);
});

// ===== mem 模式 store：防重复 + 侧序稳定 =====
test('store(mem)：一人一镜一票，第二次提交返回 duplicate', async () => {
  process.env.STORE_MODE = 'mem';
  const store = new StoreService();
  await store.onModuleInit();
  const first = await store.addScore({ shotId: 'shot1', rater: '张三', winner: 'new', scoreNew: 5, scoreOld: 3, sideOrder: 'left:new' });
  assert.equal(first.ok, true);
  const dup = await store.addScore({ shotId: 'shot1', rater: '张三', winner: 'old', scoreNew: 2, scoreOld: 4, sideOrder: 'left:new' });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.reason, 'duplicate');
  // 同镜不同人、同人不同镜都合法
  const other = await store.addScore({ shotId: 'shot1', rater: '李四', winner: 'tie', scoreNew: 3, scoreOld: 3, sideOrder: 'left:new' });
  assert.equal(other.ok, true);
});

test('store(mem)：getOrInitSideOrder 同任务多次调用返回同一值', async () => {
  process.env.STORE_MODE = 'mem';
  const store = new StoreService();
  await store.onModuleInit();
  const a = await store.getOrInitSideOrder('task-1');
  const b = await store.getOrInitSideOrder('task-1');
  assert.equal(a, b);
  assert.ok(a === 'left:new' || a === 'left:old');
});

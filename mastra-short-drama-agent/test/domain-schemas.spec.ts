import assert from 'node:assert/strict';
import test from 'node:test';
import { storyBibleDraftSchema } from '../src/domain/story-schemas.ts';
import { changeProposalSchema, shotDraftV1Schema } from '../src/domain/production-schemas.ts';
import { assertStoryBibleConfirmable } from '../src/domain/story-confirmation.ts';

test('StoryBible Schema 接受来源、置信度和冲突字段', () => {
  const result = storyBibleDraftSchema.safeParse({
    summary: 'summary', logline: 'logline',
    characters: [], locations: [], props: [], relationships: [], timeline: [],
    ambiguities: ['服装未说明'], conflicts: [],
  });
  assert.equal(result.success, true);
});

test('高风险冲突阻断 StoryBible 确认', () => {
  assert.throws(() => assertStoryBibleConfirmable({
    summary: '', logline: '', characters: [], locations: [], props: [], relationships: [], timeline: [], ambiguities: [], conflicts: ['角色身份冲突'],
  }), /阻断冲突/);
});

test('变更提议必须包含 before/after 和影响范围', () => {
  const result = changeProposalSchema.safeParse({
    id: 'cp1', targetType: 'character', targetId: 'c1', changeType: 'clothing', riskLevel: 'high',
    before: { clothing: '灰色风衣' }, after: { clothing: '白色风衣' }, reason: '用户要求', impactScope: ['scene:1', 'shot:1'], status: 'pending',
  });
  assert.equal(result.success, true);
  assert.equal(shotDraftV1Schema.safeParse({}).success, false);
});

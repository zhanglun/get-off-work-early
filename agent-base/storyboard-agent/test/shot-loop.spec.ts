// Shot Loop 单测：三种路径 + 单镜失败隔离 + mock LLM 可注入
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShotLoopService, type ShotContext } from '../src/core/shot-loop.ts';
import type { LlmService } from '../src/llm/llm.service.ts';
import { DefaultLoopConfig } from '../src/core/types.ts';

function makeCtx(seq = 1): ShotContext {
  return {
    seq,
    sceneNo: 1,
    scriptExcerpt: '测试镜内容',
    durationSec: 10,
    legacyPrompt: '旧提示词',
    characters: [{ name: '林小雨', canonical: '25岁，短发，灰色风衣' }],
  };
}

function fakeLlm(behavior: {
  reviewFailRounds: number; // 前几轮 fail
  directorThrow?: boolean;
}): LlmService {
  let reviewRound = 0;
  return {
    async complete(opts: never) {
      const o = opts as { role: string; schema: { safeParse: (d: unknown) => { success: boolean; data?: unknown } } };
      if (o.role === 'director') {
        if (behavior.directorThrow) throw new Error('LLM 挂了');
        return { data: { shotSize: '中景', cameraMove: '缓推', composition: '三分线', lighting: '暖光', emotion: '克制', prompt: 'v1提示词', rationale: '测试推理' }, usage: { promptTokens: 100, completionTokens: 50 } };
      }
      if (o.role === 'reviewer') {
        reviewRound++;
        const passed = reviewRound > behavior.reviewFailRounds;
        return { data: { passed, confidence: passed ? 0.9 : 0.4, findings: passed ? [] : [{ rule: 'prompt-specificity', severity: 'medium', issue: '不够具体', suggestion: '加细节' }] }, usage: { promptTokens: 80, completionTokens: 40 } };
      }
      return { data: { draft: { shotSize: '中景', cameraMove: '缓推', composition: '三分线', lighting: '暖光', emotion: '克制', prompt: `v${reviewRound + 1}提示词`, rationale: '修订' }, changes: '按 findings 修改' }, usage: { promptTokens: 120, completionTokens: 60 } };
    },
  } as unknown as LlmService;
}

test('路径1：首轮即过 → done, iterations=1', async () => {
  const loop = new ShotLoopService(fakeLlm({ reviewFailRounds: 0 }));
  const r = await loop.run(makeCtx(), DefaultLoopConfig);
  assert.equal(r.status, 'done');
  assert.equal(r.iterations, 1);
  assert.equal(r.finalPrompt, 'v1提示词');
});

test('路径2：第2轮过 → done, iterations=2, 有 refiner changes', async () => {
  const loop = new ShotLoopService(fakeLlm({ reviewFailRounds: 1 }));
  const r = await loop.run(makeCtx(), DefaultLoopConfig);
  assert.equal(r.status, 'done');
  assert.equal(r.iterations, 2);
  assert.equal(r.finalPrompt, 'v2提示词');
  assert.ok(r.reviewLogs[0].changes);
});

test('路径3：3轮都不过 → needs_review, 保留最后版', async () => {
  const loop = new ShotLoopService(fakeLlm({ reviewFailRounds: 99 }));
  const r = await loop.run(makeCtx(), DefaultLoopConfig);
  assert.equal(r.status, 'needs_review');
  assert.equal(r.iterations, 3);
  assert.equal(r.finalPrompt, 'v3提示词');
});

test('路径4：Director 抛错 → failed 不拖累（返回 failed 而非 throw）', async () => {
  const loop = new ShotLoopService(fakeLlm({ reviewFailRounds: 0, directorThrow: true }));
  const r = await loop.run(makeCtx(), DefaultLoopConfig);
  assert.equal(r.status, 'failed');
  assert.equal(r.finalPrompt, null);
});

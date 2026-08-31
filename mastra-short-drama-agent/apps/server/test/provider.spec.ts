import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import { getModelConfig, generateStructured, ModelConfigurationError, type StructuredAgent } from '../src/nest/llm/provider.ts';

const agent: StructuredAgent = {
  id: 'provider-test',
  name: 'Provider Test',
  instructions: '返回 value 数字。',
  schema: z.object({ value: z.number().int() }),
};

function withServer(handler: (requestCount: number) => object, callback: (url: string) => Promise<void>): Promise<void> {
  let requestCount = 0;
  const server = createServer((_req, res) => {
    requestCount++;
    const body = JSON.stringify(handler(requestCount));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: body } }], usage: {} }));
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('test server did not bind'));
      void callback(`http://127.0.0.1:${address.port}/v1`).then(() => server.close(() => resolve()), reject);
    });
  });
}

test('未配置真实模型时明确拒绝启动配置', () => {
  const saved = { base: process.env.MODEL_BASE_URL, key: process.env.MODEL_API_KEY, name: process.env.MODEL_NAME };
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_NAME;
  try {
    assert.throws(() => getModelConfig(), ModelConfigurationError);
  } finally {
    for (const [key, value] of [['MODEL_BASE_URL', saved.base], ['MODEL_API_KEY', saved.key], ['MODEL_NAME', saved.name]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('真实 Provider 在临时网络错误后重试并通过 Zod 校验', async () => {
  await withServer((requestCount) => requestCount < 3 ? { wrong: 'shape' } : { value: 4 }, async (url) => {
    const saved = { base: process.env.MODEL_BASE_URL, key: process.env.MODEL_API_KEY, name: process.env.MODEL_NAME };
    Object.assign(process.env, { MODEL_BASE_URL: url, MODEL_API_KEY: 'test-key', MODEL_NAME: 'test-model' });
    try {
      const result = await generateStructured(agent, '返回 {value:4}');
      assert.equal((result.value as { value: number }).value, 4);
      assert.equal(result.attempts, 3);
      assert.equal(result.model, 'test-model');
    } finally {
      for (const [key, value] of [['MODEL_BASE_URL', saved.base], ['MODEL_API_KEY', saved.key], ['MODEL_NAME', saved.name]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

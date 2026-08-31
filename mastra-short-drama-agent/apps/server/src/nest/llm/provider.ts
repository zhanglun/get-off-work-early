import { z, type ZodType } from 'zod';

export interface StructuredAgent {
  id: string;
  name: string;
  instructions: string;
  schema: ZodType<unknown>;
}

export interface GenerationResult<T> {
  value: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
}

export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigurationError';
  }
}

export class ModelRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelRequestError';
  }
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function getModelConfig(): ModelConfig {
  const missing = ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']
    .filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new ModelConfigurationError(`真实模型未配置：缺少 ${missing.join('、')}。请配置 MODEL_BASE_URL、MODEL_API_KEY、MODEL_NAME。`);
  }
  return {
    baseUrl: process.env.MODEL_BASE_URL!.replace(/\/$/, ''),
    apiKey: process.env.MODEL_API_KEY!,
    model: process.env.MODEL_NAME!,
  };
}

const MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 调用 OpenAI 兼容结构化接口；失败只重试并抛错，不生成替代数据。 */
export async function generateStructured<T>(agent: StructuredAgent, prompt: string): Promise<GenerationResult<T>> {
  const config = getModelConfig();
  const schema = z.toJSONSchema(agent.schema);
  let lastError: unknown;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 4000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${agent.instructions}\n\n只输出 JSON，不要输出 Markdown 或解释文字。输出必须满足以下 JSON Schema：\n${JSON.stringify(schema)}` },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!response.ok) throw new ModelRequestError(`模型 HTTP ${response.status}`);
      const json = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new ModelRequestError('模型返回为空');
      const value = agent.schema.parse(JSON.parse(content)) as T;
      return {
        value,
        model: config.model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - startedAt,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      console.error(JSON.stringify({
        event: 'model_request_failed', agent: agent.id, model: config.model,
        attempt, maxAttempts: MAX_ATTEMPTS, error: error instanceof Error ? error.message : String(error),
      }));
      if (attempt < MAX_ATTEMPTS) await delay(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ModelRequestError(`模型调用失败（${agent.id}，已重试 ${MAX_ATTEMPTS} 次）`, { cause: lastError });
}

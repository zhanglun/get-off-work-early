import type { z } from 'zod';

export interface StructuredAgent {
  id: string;
  name: string;
  instructions: string;
  schema: z.ZodType<unknown>;
}

export interface GenerationResult<T> {
  value: T;
  mock: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

const BASE_URL = process.env.MODEL_BASE_URL;
const API_KEY = process.env.MODEL_API_KEY;
const MODEL = process.env.MODEL_NAME;

export function realModelConfigured(): boolean {
  return Boolean(BASE_URL && API_KEY && MODEL);
}

/** OpenAI 兼容结构化调用；未配置或失败 → null（由调用方落 Mock）。 */
async function callReal<T>(agent: StructuredAgent, prompt: string): Promise<GenerationResult<T> | null> {
  if (!realModelConfigured()) return null;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const response = await fetch(`${BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${agent.instructions}\n\n必须输出符合给定 JSON Schema 的结构化对象，不要输出 Markdown 或解释文字。` },
          { role: 'user', content: prompt },
        ],
      }),
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`模型 HTTP ${response.status}`);
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型返回为空');
    return {
      value: agent.schema.parse(JSON.parse(content)) as T,
      mock: false,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn(`[llm] real 调用失败（${agent.id}），切换 Mock: ${String(error)}`);
    return null;
  }
}

function invokeMock<T>(agent: StructuredAgent, mock: (agent: StructuredAgent, prompt: string) => T, prompt: string): GenerationResult<T> {
  return { value: mock(agent, prompt), mock: true, inputTokens: 0, outputTokens: 0, latencyMs: 5 };
}

/** 统一入口：真实优先，失败自动 Mock；结果携带 mock 标志供印章披露。 */
export async function generateStructured<T>(
  agent: StructuredAgent,
  prompt: string,
  mock: (agent: StructuredAgent, prompt: string) => T,
): Promise<GenerationResult<T>> {
  return (await callReal<T>(agent, prompt)) ?? invokeMock(agent, mock, prompt);
}

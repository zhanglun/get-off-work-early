import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ShotDraft, ReviewReport, RefineResult, Finding } from '../core/types';

export type LlmRole = 'director' | 'reviewer' | 'refiner';

export interface LlmCompleteOptions<T> {
  role: LlmRole;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

@Injectable()
export class LlmService {
  private mode = process.env.LLM_MODE ?? 'mock';
  private callCount = new Map<string, number>(); // mock 轮次记忆（key=shotSeq:role）

  async complete<T>(opts: LlmCompleteOptions<T>): Promise<{ data: T; usage: LlmUsage }> {
    const data =
      this.mode === 'real' ? await this.callReal<T>(opts) : this.mockComplete<T>(opts);
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `[llm:${opts.role}] 输出不符合 schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    return {
      data: parsed.data,
      usage: { promptTokens: 512, completionTokens: 256 }, // mock 估算值；real 模式取 API usage
    };
  }

  // ===== mock 实现：按 role 返回可塑性假数据 =====
  private mockComplete<T>(opts: LlmCompleteOptions<T>): T {
    const key = `${opts.userPrompt.match(/seq=(\d+)/)?.[1] ?? 'x'}:${opts.role}`;
    const round = (this.callCount.get(key) ?? 0) + 1;
    this.callCount.set(key, round);

    switch (opts.role) {
      case 'director':
        return {
          shotSize: '中景',
          cameraMove: '缓推',
          composition: '人物三分线右侧，背景虚化',
          lighting: '午后侧逆光，暖色调',
          emotion: '克制的心动',
          prompt:
            '咖啡馆内，午后侧逆光。25岁短发女性（灰色风衣）与27岁高个男性（黑色高领）隔桌对坐。镜头从中景缓慢推近，女性低头搅拌咖啡，抬眼与男性目光相接又移开。画面暖色调，浅景深。',
          rationale: '首次正面试探的对白，中景保留双方肢体语言，缓推暗示情绪升温。',
        } as T;
      case 'reviewer':
        // mock 剧本：第 1 轮 fail（制造迭代），第 2 轮起 pass —— 让 loop 走起来
        return {
          passed: round >= 2,
          confidence: round >= 2 ? 0.9 : 0.5,
          findings:
            round >= 2
              ? []
              : [
                  {
                    rule: 'character-consistency',
                    severity: 'medium',
                    issue: '角色外观描述与角色卡不完全一致（缺风衣颜色锚定）',
                    suggestion: '在提示词中固定「灰色风衣」完整描述串',
                  } satisfies Finding,
                ],
        } as T;
      case 'refiner':
        return {
          draft: {
            shotSize: '中景',
            cameraMove: '缓推',
            composition: '人物三分线右侧，背景虚化',
            lighting: '午后侧逆光，暖色调',
            emotion: '克制的心动',
            prompt:
              '咖啡馆内，午后侧逆光。25岁短发女性（灰色风衣，角色锚定串#F1）与27岁高个男性（黑色高领，角色锚定串#M1）隔桌对坐。镜头从中景缓慢推近至近景。女性低头搅拌咖啡，抬眼与男性目光相接又移开。暖色调，浅景深，35mm 质感。',
          },
          changes: '按 findings#1 补齐角色卡锚定描述；推镜终点明确到近景。',
        } as T;
    }
  }

  // ===== real 实现：OpenAI 兼容（周一端点到手填 env 即生效）=====
  private async callReal<T>(opts: LlmCompleteOptions<T>): Promise<T> {
    const base = process.env.LLM_BASE_URL;
    const key = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL;
    if (!base || !key || !model) throw new Error('[llm] real 模式缺 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL');

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`[llm] ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return JSON.parse(json.choices[0].message.content) as T;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { LlmModule } from '../llm/llm.module';
import { loadSystemPrompt } from './core.module';
import {
  ShotDraftSchema,
  ReviewReportSchema,
  RefineResultSchema,
  type ShotDraft,
  type LoopConfig,
} from './types';
import { Module } from '@nestjs/common';

export interface ShotContext {
  seq: number;
  sceneNo: number;
  scriptExcerpt: string;
  durationSec: number;
  legacyPrompt: string;
  characters: { name: string; canonical: string }[];
  prevSummary?: string;
  nextSummary?: string;
}

export interface ShotLoopResult {
  seq: number;
  status: 'done' | 'needs_review' | 'failed';
  draft: ShotDraft | null;
  rationale: string | null;
  finalPrompt: string | null;
  iterations: number;
  tokensUsed: number;
  reviewLogs: { round: number; passed: boolean; findings: unknown; changes: string | null }[];
}

// ===== Shot Loop：每镜独立的 generator-critic（architecture.md §6）=====
// 通过即停 / ≤maxRounds 熔断 / 单镜失败不拖累全集（外层并发处理）
@Injectable()
export class ShotLoopService {
  private readonly logger = new Logger(ShotLoopService.name);

  constructor(private readonly llm: LlmService) {}

  buildUserPrompt(ctx: ShotContext): string {
    const chars = ctx.characters.map((c) => `- ${c.name}: ${c.canonical}`).join('\n');
    return [
      `seq=${ctx.seq} 场号=${ctx.sceneNo} 时长=${ctx.durationSec}s`,
      `【剧本内容】${ctx.scriptExcerpt}`,
      `【旧系统提示词（优化起点）】${ctx.legacyPrompt}`,
      `【角色卡】\n${chars || '（无）'}`,
      ctx.prevSummary ? `【前一镜】${ctx.prevSummary}` : '',
      ctx.nextSummary ? `【后一镜】${ctx.nextSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  async run(ctx: ShotContext, config: LoopConfig): Promise<ShotLoopResult> {
    const userPrompt = this.buildUserPrompt(ctx);
    let draft: ShotDraft | null = null;
    let rationale: string | null = null;
    let tokensUsed = 0;
    const reviewLogs: ShotLoopResult['reviewLogs'] = [];
    let review = { passed: false, findings: [] as unknown };

    try {
      // ① Director 初版
      const d = await this.llm.complete({
        role: 'director',
        systemPrompt: loadSystemPrompt('director'),
        userPrompt,
        schema: ShotDraftSchema,
      });
      draft = d.data as ShotDraft & { rationale?: string };
      rationale = (d.data as { rationale?: string }).rationale ?? null;
      tokensUsed += d.usage.promptTokens + d.usage.completionTokens;

      // ② 生成时自查（rationale 由 director 输出携带）
      // ③ 审查-改写循环
      for (let round = 1; round <= config.maxRounds; round++) {
        const r = await this.llm.complete({
          role: 'reviewer',
          systemPrompt: loadSystemPrompt('reviewer'),
          userPrompt: `${userPrompt}\n\n【待审查提示词】${JSON.stringify(draft)}`,
          schema: ReviewReportSchema,
        });
        tokensUsed += r.usage.promptTokens + r.usage.completionTokens;
        review = r.data;
        if (r.data.passed) {
          reviewLogs.push({ round, passed: true, findings: r.data.findings, changes: null });
          break;
        }
        // 未过 → Refiner 改写（除非已是最后一轮，保留最后版标记 needs_review）
        if (round === config.maxRounds) {
          reviewLogs.push({ round, passed: false, findings: r.data.findings, changes: null });
          break;
        }
        const f: { data: import('./types').RefineResult; usage: { promptTokens: number; completionTokens: number } } = await this.llm.complete({
          role: 'refiner',
          systemPrompt: loadSystemPrompt('refiner'),
          userPrompt: `${userPrompt}\n\n【当前版本】${JSON.stringify(draft)}\n\n【审查发现】${JSON.stringify(r.data.findings)}`,
          schema: RefineResultSchema,
        });
        tokensUsed += f.usage.promptTokens + f.usage.completionTokens;
        draft = f.data.draft;
        reviewLogs.push({ round, passed: false, findings: r.data.findings, changes: f.data.changes });
      }
      const passed = reviewLogs.some((l) => l.passed);
      return {
        seq: ctx.seq,
        status: passed ? 'done' : 'needs_review',
        draft,
        rationale,
        finalPrompt: draft?.prompt ?? null,
        iterations: reviewLogs.length,
        tokensUsed,
        reviewLogs,
      };
    } catch (e) {
      // 单镜失败：保留已完成部分，标 failed，不抛出（不拖累全集）
      this.logger.warn(`shot seq=${ctx.seq} 失败: ${(e as Error).message.slice(0, 120)}`);
      return {
        seq: ctx.seq,
        status: 'failed',
        draft,
        rationale,
        finalPrompt: draft?.prompt ?? null,
        iterations: reviewLogs.length,
        tokensUsed,
        reviewLogs,
      };
    }
  }
}

@Module({
  imports: [LlmModule],
  providers: [ShotLoopService],
  exports: [ShotLoopService],
})
export class ShotLoopModule {}

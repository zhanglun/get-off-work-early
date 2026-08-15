import { z } from 'zod';

// ===== 分镜领域 zod 契约（DTO 即文档）=====

export const ShotDraftSchema = z.object({
  shotSize: z.string().describe('景别：远/全/中/近/特写'),
  cameraMove: z.string().describe('运镜：固定/推/拉/摇/移/跟'),
  composition: z.string().describe('构图描述'),
  lighting: z.string().describe('光线/色调'),
  emotion: z.string().describe('情绪基调'),
  prompt: z.string().describe('本镜提示词（优化后）'),
  rationale: z.string().optional().describe('推理（为什么这样设计）'),
});
export type ShotDraft = z.infer<typeof ShotDraftSchema>;

export const FindingSchema = z.object({
  rule: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  issue: z.string(),
  suggestion: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewReportSchema = z.object({
  passed: z.boolean(),
  findings: z.array(FindingSchema),
  confidence: z.number().min(0).max(1).describe('审查置信度（demo后用于动态轮数）'),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export const RefineResultSchema = z.object({
  draft: ShotDraftSchema,
  changes: z.string().describe('本次修改说明'),
});
export type RefineResult = z.infer<typeof RefineResultSchema>;

export const CharacterCardSchema = z.object({
  name: z.string(),
  canonical: z.string().describe('固定描述串（全剧一致性锚点）'),
});
export type CharacterCardT = z.infer<typeof CharacterCardSchema>;

export const LegacyShotsSchema = z.object({
  shots: z.array(
    z.object({
      seq: z.number().int(),
      sceneNo: z.number().int(),
      scriptExcerpt: z.string(),
      durationSec: z.number().int(),
      legacyPrompt: z.string(),
    }),
  ),
});
export type LegacyShots = z.infer<typeof LegacyShotsSchema>;

// ===== loop 配置 =====
export interface LoopConfig {
  maxRounds: number; // 默认 3
  concurrency: number; // 镜级并发，默认 4
}
export const DefaultLoopConfig: LoopConfig = { maxRounds: 3, concurrency: 4 };

// ===== 提交打分 =====
export const ScoreSubmitSchema = z.object({
  shotId: z.string(),
  rater: z.string().min(1),
  winner: z.enum(['A', 'B']),
  scoreA: z.number().int().min(1).max(5),
  scoreB: z.number().int().min(1).max(5),
  sideOrder: z.enum(['left:new', 'left:old']),
});
export type ScoreSubmit = z.infer<typeof ScoreSubmitSchema>;

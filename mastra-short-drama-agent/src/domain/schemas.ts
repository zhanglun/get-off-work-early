import { z } from 'zod';

export const configSchema = z.object({
  maxRounds: z.number().int().min(1).max(5).default(3),
  concurrency: z.number().int().min(1).max(8).default(3),
});

export const taskInputSchema = z.object({
  taskId: z.string().min(1),
  scriptText: z.string().min(10),
  episodeNo: z.number().int().positive().optional(),
  config: configSchema.optional(),
});

export const legacyShotSchema = z.object({
  seq: z.number().int().positive(),
  sceneNo: z.number().int().nonnegative(),
  scriptExcerpt: z.string(),
  durationSec: z.number().int().min(1).max(15),
  legacyPrompt: z.string(),
});

export const legacyImportSchema = z.object({
  shots: z.array(legacyShotSchema).min(1),
});

export const characterCardSchema = z.object({
  name: z.string(),
  canonical: z.string(),
});

export const shotDraftSchema = z.object({
  shotSize: z.string(),
  cameraMove: z.string(),
  composition: z.string(),
  lighting: z.string(),
  emotion: z.string(),
  prompt: z.string(),
  rationale: z.string(),
});

export const findingSchema = z.object({
  rule: z.enum([
    'character-consistency',
    'scene-continuity',
    'physical-logic',
    'shot-language',
    'prompt-specificity',
  ]),
  severity: z.enum(['high', 'medium', 'low']),
  issue: z.string(),
  suggestion: z.string(),
});

export const reviewReportSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  findings: z.array(findingSchema),
});

export const refineResultSchema = z.object({
  draft: shotDraftSchema,
  changes: z.string(),
});

export const shotResultSchema = z.object({
  seq: z.number().int(),
  status: z.enum(['done', 'needs_review', 'failed']),
  draft: shotDraftSchema.nullable(),
  finalPrompt: z.string().nullable(),
  rationale: z.string().nullable(),
  iterations: z.number().int(),
  tokensUsed: z.number().int(),
  reviews: z.array(
    z.object({
      round: z.number().int(),
      passed: z.boolean(),
      confidence: z.number(),
      findings: z.array(findingSchema),
      changes: z.string().nullable(),
    }),
  ),
});

export const businessResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(['done', 'needs_review', 'failed']),
  shots: z.array(shotResultSchema),
  summary: z.object({
    total: z.number().int(),
    done: z.number().int(),
    needsReview: z.number().int(),
    failed: z.number().int(),
    tokensUsed: z.number().int(),
  }),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
export type LegacyShot = z.infer<typeof legacyShotSchema>;
export type CharacterCard = z.infer<typeof characterCardSchema>;
export type ShotDraft = z.infer<typeof shotDraftSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type RefineResult = z.infer<typeof refineResultSchema>;
export type ShotResult = z.infer<typeof shotResultSchema>;
export type BusinessResult = z.infer<typeof businessResultSchema>;

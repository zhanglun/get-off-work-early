import { z } from 'zod';
import { findingSchema } from './schemas.ts';
import { sourceRefSchema } from './story-schemas.ts';

export const shotDraftV1Schema = z.object({
  shotSize: z.string(),
  cameraMove: z.string(),
  composition: z.string(),
  lighting: z.string(),
  emotion: z.string(),
  imagePrompt: z.string(),
  videoPrompt: z.string(),
  rationale: z.string(),
  sourceRefs: z.array(sourceRefSchema),
  confidence: z.number().min(0).max(1),
});

export const continuityReviewSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  findings: z.array(findingSchema),
});

export const refinedShotSchema = z.object({
  draft: shotDraftV1Schema,
  changes: z.string(),
});

export const productionReviewLogSchema = z.object({
  round: z.number().int().positive(),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  findings: z.array(findingSchema),
  changes: z.string().nullable(),
});

export const shotProductionResultSchema = z.object({
  sceneNo: z.number().int().positive(),
  sequence: z.number().int().positive(),
  status: z.enum(['done', 'needs_review', 'failed']),
  draft: shotDraftV1Schema.nullable(),
  promptVersions: z.array(z.object({
    kind: z.enum(['image', 'video']),
    version: z.number().int().positive(),
    content: z.string(),
    rationale: z.string(),
  })),
  reviews: z.array(productionReviewLogSchema),
  iterations: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});

export const storyboardProductionInputSchema = z.object({
  episodeId: z.string().min(1),
  maxRounds: z.number().int().min(1).max(5).default(3),
  concurrency: z.number().int().min(1).max(8).default(3),
  sceneNos: z.array(z.number().int().positive()).optional(),
  shotSequences: z.array(z.object({ sceneNo: z.number().int().positive(), sequence: z.number().int().positive() })).optional(),
});

export const storyboardProductionResultSchema = z.object({
  episodeId: z.string(),
  status: z.enum(['awaiting_confirmation', 'done', 'needs_review', 'failed']),
  shots: z.array(shotProductionResultSchema),
  summary: z.object({
    total: z.number().int(),
    done: z.number().int(),
    needsReview: z.number().int(),
    failed: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
  }),
});

export const changeProposalSchema = z.object({
  id: z.string(),
  targetType: z.enum(['story-bible', 'character', 'location', 'prop', 'scene', 'shot', 'prompt']),
  targetId: z.string(),
  changeType: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string(),
  impactScope: z.array(z.string()),
  status: z.enum(['pending', 'approved', 'rejected']),
});

export type ShotDraftV1 = z.infer<typeof shotDraftV1Schema>;
export type ContinuityReview = z.infer<typeof continuityReviewSchema>;
export type RefinedShot = z.infer<typeof refinedShotSchema>;
export type ShotProductionResult = z.infer<typeof shotProductionResultSchema>;
export type StoryboardProductionInput = z.infer<typeof storyboardProductionInputSchema>;
export type StoryboardProductionResult = z.infer<typeof storyboardProductionResultSchema>;
export type ChangeProposal = z.infer<typeof changeProposalSchema>;

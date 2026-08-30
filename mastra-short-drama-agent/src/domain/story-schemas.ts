import { z } from 'zod';

export const scriptFormatSchema = z.enum(['basic-markdown', 'industry-markdown', 'unknown']);

export const parsedSceneSchema = z.object({
  sceneNo: z.number().int().positive(),
  heading: z.string(),
  timeLabel: z.string().nullable(),
  locationLabel: z.string().nullable(),
  characters: z.array(z.string()),
  actions: z.array(z.string()),
  dialogues: z.array(z.string()),
  notes: z.array(z.string()),
  rawText: z.string(),
});

export const parsedScriptSchema = z.object({
  format: scriptFormatSchema,
  title: z.string().nullable(),
  scenes: z.array(parsedSceneSchema),
  warnings: z.array(z.string()),
});

export const sourceRefSchema = z.object({
  type: z.enum(['script', 'user', 'agent', 'derived', 'imported-legacy']),
  ref: z.string(),
});

export const storyCharacterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  age: z.string().nullable(),
  appearance: z.string(),
  clothing: z.string(),
  personality: z.string(),
  speakingStyle: z.string(),
  canonicalDescription: z.string(),
  sourceRefs: z.array(sourceRefSchema),
  confidence: z.number().min(0).max(1),
});

export const storyLocationSchema = z.object({
  name: z.string(),
  layout: z.string(),
  lighting: z.string(),
  colorStyle: z.string(),
  fixedProps: z.array(z.string()),
  spatialConstraints: z.array(z.string()),
  sourceRefs: z.array(sourceRefSchema),
  confidence: z.number().min(0).max(1),
});

export const storyPropSchema = z.object({
  name: z.string(),
  appearance: z.string(),
  owner: z.string().nullable(),
  continuityRules: z.array(z.string()),
  sourceRefs: z.array(sourceRefSchema),
  confidence: z.number().min(0).max(1),
});

export const relationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string(),
  description: z.string(),
  sourceRefs: z.array(sourceRefSchema),
});

export const timelineEventSchema = z.object({
  sceneNo: z.number().int().positive(),
  sequence: z.number().int().positive(),
  timeLabel: z.string(),
  participants: z.array(z.string()),
  action: z.string(),
  emotionalChange: z.string(),
  dramaticPurpose: z.string(),
  sourceRefs: z.array(sourceRefSchema),
});

export const storyBibleDraftSchema = z.object({
  summary: z.string(),
  logline: z.string(),
  characters: z.array(storyCharacterSchema),
  locations: z.array(storyLocationSchema),
  props: z.array(storyPropSchema),
  relationships: z.array(relationshipSchema),
  timeline: z.array(timelineEventSchema),
  ambiguities: z.array(z.string()),
  conflicts: z.array(z.string()),
});

export const storyUnderstandingInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  episodeId: z.string().min(1).optional(),
  projectName: z.string().min(1).default('未命名短剧'),
  episodeNo: z.number().int().positive().default(1),
  episodeTitle: z.string().min(1).optional(),
  scriptText: z.string().min(20),
  format: scriptFormatSchema.optional(),
});

export const storyUnderstandingResultSchema = z.object({
  projectId: z.string(),
  episodeId: z.string(),
  scriptVersionId: z.string(),
  storyBibleId: z.string(),
  status: z.enum(['awaiting_confirmation', 'confirmed']),
  parsedScript: parsedScriptSchema,
  storyBible: storyBibleDraftSchema,
});

export type ParsedScene = z.infer<typeof parsedSceneSchema>;
export type ParsedScript = z.infer<typeof parsedScriptSchema>;
export type StoryCharacter = z.infer<typeof storyCharacterSchema>;
export type StoryLocation = z.infer<typeof storyLocationSchema>;
export type StoryProp = z.infer<typeof storyPropSchema>;
export type StoryBibleDraft = z.infer<typeof storyBibleDraftSchema>;
export type StoryUnderstandingInput = z.infer<typeof storyUnderstandingInputSchema>;
export type StoryUnderstandingResult = z.infer<typeof storyUnderstandingResultSchema>;

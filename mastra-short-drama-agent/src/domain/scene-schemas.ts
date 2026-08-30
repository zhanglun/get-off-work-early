import { z } from 'zod';
import { sourceRefSchema } from './story-schemas.ts';

export const scenePlanSchema = z.object({
  sceneNo: z.number().int().positive(),
  heading: z.string(),
  timeLabel: z.string().nullable(),
  locationLabel: z.string().nullable(),
  characters: z.array(z.string()),
  objective: z.string(),
  conflict: z.string(),
  beats: z.array(z.string()),
  emotionalArc: z.string(),
  continuityNotes: z.array(z.string()),
  sourceRefs: z.array(sourceRefSchema),
  confidence: z.number().min(0).max(1),
});

export const scenePlanningInputSchema = z.object({
  episodeId: z.string().min(1),
});

export const scenePlanningResultSchema = z.object({
  episodeId: z.string(),
  storyBibleId: z.string(),
  status: z.literal('awaiting_confirmation'),
  scenes: z.array(scenePlanSchema),
});

export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type ScenePlanningInput = z.infer<typeof scenePlanningInputSchema>;
export type ScenePlanningResult = z.infer<typeof scenePlanningResultSchema>;

import { z } from 'zod';

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
});

export const scenePlanListSchema = z.object({
  scenes: z.array(scenePlanSchema).min(1),
});

export type ScenePlan = z.infer<typeof scenePlanSchema>;

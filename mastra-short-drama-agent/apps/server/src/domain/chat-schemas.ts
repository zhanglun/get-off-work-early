import { z } from 'zod';

export const chatInputSchema = z.object({
  message: z.string().min(1),
  episodeId: z.string().optional(),
  scriptText: z.string().optional(),
  resourceId: z.string().default('default-user'),
  threadId: z.string().default('short-drama-default-thread'),
});

export const chatResultSchema = z.object({
  kind: z.enum(['command', 'answer', 'clarification', 'error']),
  intent: z.string(),
  text: z.string(),
  data: z.unknown().optional(),
});

export type ChatInput = z.infer<typeof chatInputSchema>;
export type ChatResult = z.infer<typeof chatResultSchema>;

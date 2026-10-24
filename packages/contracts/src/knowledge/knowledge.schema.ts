import { z } from 'zod';

export const FaqDto = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  question: z.string(),
  answer: z.string(),
  source: z.enum(['seed', 'manual', 'import']),
  /** Placeholders in the answer that the bot settings do not provide yet. */
  missingPlaceholders: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export type FaqDto = z.infer<typeof FaqDto>;

export const CreateFaqRequest = z.object({
  question: z.string().trim().min(3).max(500),
  answer: z.string().trim().min(1).max(4000),
});
export type CreateFaqRequest = z.infer<typeof CreateFaqRequest>;

export const UpdateFaqRequest = CreateFaqRequest.partial();
export type UpdateFaqRequest = z.infer<typeof UpdateFaqRequest>;

export const FaqListResponse = z.object({ data: z.array(FaqDto) });
export type FaqListResponse = z.infer<typeof FaqListResponse>;

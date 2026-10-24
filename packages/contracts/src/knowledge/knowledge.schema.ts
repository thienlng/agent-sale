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

/** Instruction scenarios, reusable replies and media references; no binary uploads. */
export const TrainingKind = z.enum(['scenario', 'quick_reply', 'media']);
export type TrainingKind = z.infer<typeof TrainingKind>;
export const CreateTrainingItemRequest = z.object({
  kind: TrainingKind,
  title: z.string().trim().min(1).max(2000),
  content: z.string().trim().min(1).max(8000),
  trigger: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(2000).optional(),
  mediaUrl: z
    .url()
    .max(2000)
    .refine((url) => url.startsWith('https://'), 'HTTPS is required')
    .nullable()
    .default(null),
});
export type CreateTrainingItemRequest = z.infer<typeof CreateTrainingItemRequest>;
export const UpdateTrainingItemRequest = z
  .object({
    title: z.string().trim().min(1).max(2000).optional(),
    content: z.string().trim().min(1).max(8000).optional(),
    trigger: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    mediaUrl: z
      .url()
      .max(2000)
      .refine((url) => url.startsWith('https://'), 'HTTPS is required')
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required');
export type UpdateTrainingItemRequest = z.infer<typeof UpdateTrainingItemRequest>;
export const TrainingItemDto = CreateTrainingItemRequest.extend({
  id: z.uuid(),
  botId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TrainingItemDto = z.infer<typeof TrainingItemDto>;
export const TrainingItemList = z.object({ data: z.array(TrainingItemDto) });
export const TrainingHistoryDto = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  itemId: z.uuid(),
  title: z.string(),
  kind: z.enum(['scenario', 'quick_reply', 'media', 'faq', 'settings']),
  action: z.enum(['created', 'updated', 'deleted']),
  createdAt: z.iso.datetime(),
});
export type TrainingHistoryDto = z.infer<typeof TrainingHistoryDto>;
export const TrainingHistoryList = z.object({ data: z.array(TrainingHistoryDto) });

export const ImportFaqsRequest = z.object({ items: z.array(CreateFaqRequest).min(1).max(100) });
export type ImportFaqsRequest = z.infer<typeof ImportFaqsRequest>;

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

/** Instruction scenarios, reusable replies, media references and the folders that group media. */
export const TrainingKind = z.enum(['scenario', 'quick_reply', 'media', 'media_folder']);
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
  /** Media only: the `media_folder` item that holds it. */
  folderId: z.uuid().nullable().default(null),
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
    folderId: z.uuid().nullable().optional(),
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
/** One changed field of a history entry; values are the JSON stored before and after. */
export const TrainingChange = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type TrainingChange = z.infer<typeof TrainingChange>;
export const TrainingHistoryDto = z.object({
  id: z.uuid(),
  botId: z.uuid(),
  itemId: z.uuid(),
  title: z.string(),
  kind: z.enum(['scenario', 'quick_reply', 'media', 'media_folder', 'faq', 'settings']),
  action: z.enum(['created', 'updated', 'deleted']),
  /** Display name of the member who made the change, snapshotted at the time ('' = system). */
  actor: z.string().default(''),
  changes: z.array(TrainingChange).default([]),
  /** True when POST …/restore can put back the state before this change. */
  restorable: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type TrainingHistoryDto = z.infer<typeof TrainingHistoryDto>;
export const TrainingHistoryList = z.object({ data: z.array(TrainingHistoryDto) });

export const ImportFaqsRequest = z.object({ items: z.array(CreateFaqRequest).min(1).max(100) });
export type ImportFaqsRequest = z.infer<typeof ImportFaqsRequest>;

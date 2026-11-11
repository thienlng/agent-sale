import { z } from 'zod';

import { AutonomyLevel } from '../brain/brain.schema.js';

// ─── Care agent (spec 2026-11-11 care-agent-autonomy, ADR-031) ──────────────────────────────────

/**
 * The follow-up templates: `silent` ("Khách im lặng"), `ready` ("Sắp chốt"), `after_sale` ("Sau
 * mua": no message, a check-in on Today after N days).
 */
export const CareTemplateKey = z.enum(['silent', 'ready', 'after_sale']);
export type CareTemplateKey = z.infer<typeof CareTemplateKey>;

export const CareMessageStatus = z.enum([
  'draft',
  'sending',
  'sent',
  'failed',
  'expired',
  'rejected',
  'skipped',
]);
export type CareMessageStatus = z.infer<typeof CareMessageStatus>;

/** Days after a completed order/booking before the after-sales check-in shows on Today. */
export const CARE_AFTER_SALE_DAYS = { min: 1, max: 30, default: 3 } as const;
/** Entitlement key of the daily care message cap (per business); default 100. */
export const CARE_MESSAGES_DAILY = 'care.messages.daily';

export const CareTemplateDto = z.object({
  key: CareTemplateKey,
  enabled: z.boolean(),
  /** The owner's short instruction to the writer (tone, an offer to mention). */
  instruction: z.string().max(500),
  /** `after_sale` only: days after the order/booking is completed. */
  afterSaleDays: z.number().int().min(CARE_AFTER_SALE_DAYS.min).max(CARE_AFTER_SALE_DAYS.max),
});
export type CareTemplateDto = z.infer<typeof CareTemplateDto>;

export const UpdateCareTemplateRequest = z
  .object({
    enabled: z.boolean(),
    instruction: z.string().trim().max(500),
    afterSaleDays: z
      .number()
      .int()
      .min(CARE_AFTER_SALE_DAYS.min)
      .max(CARE_AFTER_SALE_DAYS.max)
      .optional(),
  })
  .strict();
export type UpdateCareTemplateRequest = z.infer<typeof UpdateCareTemplateRequest>;

export const CareSettingsResponse = z.object({
  templates: z.array(CareTemplateDto),
  /** No agent message between these local hours (fixed: 21:00–08:00 Asia/Ho_Chi_Minh). */
  quietHours: z.object({ from: z.number().int(), to: z.number().int(), timeZone: z.string() }),
  /** Agent messages per conversation in any 24 hours, at most. */
  maxPerConversationPerDay: z.number().int(),
  /** Messages written today and the daily limit (`null` = unlimited). */
  usage: z.object({
    day: z.iso.date(),
    used: z.number().int().min(0),
    limit: z.number().int().min(0).nullable(),
  }),
});
export type CareSettingsResponse = z.infer<typeof CareSettingsResponse>;

/** One message of the care agent. */
export const CareMessageDto = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  template: CareTemplateKey,
  step: z.number().int().min(0),
  level: AutonomyLevel,
  text: z.string().max(2000),
  status: CareMessageStatus,
  skipReason: z.string().max(200).nullable(),
  windowClosesAt: z.iso.datetime().nullable(),
  /** The conversation message that was sent (`sent` and `failed`). */
  sentMessageId: z.uuid().nullable(),
  sentAt: z.iso.datetime().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type CareMessageDto = z.infer<typeof CareMessageDto>;

/** "Gửi" / "Sửa rồi gửi": `text` replaces the draft when given. */
export const ApproveCareMessageRequest = z
  .object({ text: z.string().trim().min(1).max(2000).optional() })
  .strict();
export type ApproveCareMessageRequest = z.infer<typeof ApproveCareMessageRequest>;

/** "Gửi tất cả": the given drafts, or every draft the caller sees (at most 50). */
export const BulkApproveCareMessagesRequest = z
  .object({ ids: z.array(z.uuid()).min(1).max(50).optional() })
  .strict();
export type BulkApproveCareMessagesRequest = z.infer<typeof BulkApproveCareMessagesRequest>;

export const BulkApproveCareMessagesResponse = z.object({
  sent: z.number().int().min(0),
  /** Not sent: the window closed, the conversation changed, or the channel failed. */
  notSent: z.number().int().min(0),
  results: z.array(z.object({ id: z.uuid(), status: CareMessageStatus })),
});
export type BulkApproveCareMessagesResponse = z.infer<typeof BulkApproveCareMessagesResponse>;

/** One message the AI sent at level `act_and_report` ("AI đã làm") and the customer's reaction. */
export const AiDoneItem = z.object({
  careMessageId: z.uuid(),
  conversationId: z.uuid(),
  customerName: z.string(),
  avatarUrl: z.string().nullable(),
  channel: z.string(),
  template: CareTemplateKey,
  text: z.string(),
  sentAt: z.iso.datetime(),
  /** The customer wrote after it (the time of their last message). */
  repliedAt: z.iso.datetime().nullable(),
});
export type AiDoneItem = z.infer<typeof AiDoneItem>;

/** `GET /today/ai-done`: today's (local day) reported sends, newest first, at most 50. */
export const AiDoneResponse = z.object({
  count: z.number().int().min(0),
  items: z.array(AiDoneItem).max(50),
});
export type AiDoneResponse = z.infer<typeof AiDoneResponse>;

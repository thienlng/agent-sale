import { z } from 'zod';

export const ModelTier = z.enum(['basic', 'smart', 'pro', 'neo']);
export type ModelTier = z.infer<typeof ModelTier>;

/** Industries with a seed pack (docs/17 §3). `other` gets a generic pack. */
export const Industry = z.enum([
  'retail',
  'fashion',
  'cosmetics',
  'spa',
  'dental',
  'education',
  'hotel',
  'solar',
  'other',
]);
export type Industry = z.infer<typeof Industry>;

/** Bot behaviour settings (docs/06 §6). Every field has a default so partial updates are safe. */
export const BotSettings = z.object({
  mission: z.string().trim().max(4000),
  greeting: z.string().trim().max(1000),
  selfPronoun: z.string().trim().min(1).max(20),
  customerPronoun: z.string().trim().min(1).max(20),
  useCustomerName: z.boolean(),
  autoResumeAfterManual: z.boolean().default(true),
  humanTakeoverMinutes: z.number().int().min(1).max(1440).default(5),
  silenceOnExternalReply: z.boolean().default(true),
  fallbackMessage: z.string().trim().max(1000),
  handoffMessage: z.string().trim().max(1000),
  creativity: z.enum(['strict', 'balanced', 'creative']),
  modelTier: ModelTier,
  language: z.enum(['vi', 'en']),
  /** Values for `{{placeholders}}` used by seeded knowledge, e.g. { "store.address": "12 Lê Lợi" }. */
  placeholders: z.record(z.string().regex(/^[a-z][a-z0-9_.]*$/), z.string().trim().max(500)),
});
export type BotSettings = z.infer<typeof BotSettings>;

export const BotDto = z.object({
  id: z.uuid(),
  name: z.string(),
  industry: Industry,
  isActive: z.boolean(),
  settings: BotSettings,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type BotDto = z.infer<typeof BotDto>;

export const CreateBotRequest = z.object({
  name: z.string().trim().min(1).max(80),
  industry: Industry,
});
export type CreateBotRequest = z.infer<typeof CreateBotRequest>;

export const UpdateBotRequest = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
  settings: BotSettings.omit({
    autoResumeAfterManual: true,
    humanTakeoverMinutes: true,
    silenceOnExternalReply: true,
  })
    .partial()
    .extend({
      autoResumeAfterManual: z.boolean().optional(),
      humanTakeoverMinutes: z.number().int().min(1).max(1440).optional(),
      silenceOnExternalReply: z.boolean().optional(),
    })
    .optional(),
});
export type UpdateBotRequest = z.infer<typeof UpdateBotRequest>;

/** Onboarding checklist (docs/02 BOT-04): what is still missing before the bot can go live. */
export const BotReadiness = z.object({
  ready: z.boolean(),
  checks: z.array(
    z.object({
      key: z.enum(['mission', 'faq', 'placeholders', 'channel']),
      done: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  missingPlaceholders: z.array(z.string()),
});
export type BotReadiness = z.infer<typeof BotReadiness>;

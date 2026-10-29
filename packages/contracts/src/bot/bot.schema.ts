import { z } from 'zod';

import { Industry } from './industry.js';
import { BotProfile } from './profile.js';

export const ModelTier = z.enum(['basic', 'smart', 'pro', 'neo']);
export type ModelTier = z.infer<typeof ModelTier>;

export { Industry } from './industry.js';

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Daily reply window in Vietnam time (Asia/Ho_Chi_Minh); `end` before `start` spans midnight. */
export const ReplySchedule = z
  .object({ mode: z.enum(['always', 'custom']), start: ClockTime, end: ClockTime })
  .refine((v) => v.mode === 'always' || v.start !== v.end, 'start and end must differ');
export type ReplySchedule = z.infer<typeof ReplySchedule>;

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
  /** Brand colour of the bot avatar and the future website widget. */
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#FF6600'),
  /** When the bot answers channel messages; outside the window conversations wait for staff. */
  replySchedule: ReplySchedule.default({ mode: 'always', start: '08:00', end: '22:00' }),
  /** Structured business facts of this bot (address, hours, policies) plus free notes. */
  profile: BotProfile.default({ fields: {}, notes: '' }),
  replyLength: z.enum(['veryShort', 'short', 'detailed']).default('short'),
  tone: z.enum(['friendly', 'formal']).default('friendly'),
  allowEmoji: z.boolean().default(false),
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
    themeColor: true,
    replySchedule: true,
    profile: true,
    replyLength: true,
    tone: true,
    allowEmoji: true,
  })
    .partial()
    // Defaulted fields are re-added without defaults, or a partial update would reset them.
    .extend({
      themeColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      replySchedule: ReplySchedule.optional(),
      // Profile updates merge: `fields` key by key (an empty string removes a key), `notes` only when sent.
      profile: z
        .object({
          fields: BotProfile.shape.fields.optional(),
          notes: BotProfile.shape.notes.optional(),
        })
        .optional(),
      replyLength: z.enum(['veryShort', 'short', 'detailed']).optional(),
      tone: z.enum(['friendly', 'formal']).optional(),
      allowEmoji: z.boolean().optional(),
      autoResumeAfterManual: z.boolean().optional(),
      humanTakeoverMinutes: z.number().int().min(1).max(1440).optional(),
      silenceOnExternalReply: z.boolean().optional(),
    })
    .optional(),
});
export type UpdateBotRequest = z.infer<typeof UpdateBotRequest>;

/**
 * Onboarding checklist (docs/02 BOT-04): what is still missing before the bot can go live.
 * The `profile` check is done when the basic business fields are filled; its `detail` is the
 * number of the industry's profile fields still empty. `missingPlaceholders` is read-only and
 * deprecated: it only reports old placeholders for one release.
 */
export const BotReadiness = z.object({
  ready: z.boolean(),
  checks: z.array(
    z.object({
      key: z.enum(['mission', 'faq', 'profile', 'channel']),
      done: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  missingPlaceholders: z.array(z.string()),
});
export type BotReadiness = z.infer<typeof BotReadiness>;

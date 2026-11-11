import { z } from 'zod';

// ─── Business Brain v1: conversation signals (spec 2026-11-11 §3, ADR-030) ──────────────────────

export const SIGNAL_STAGES = [
  'new',
  'exploring',
  'price_asked',
  'ready',
  'won',
  'after_sale',
  'lost',
  'spam',
] as const;
export const SignalStage = z.enum(SIGNAL_STAGES);
export type SignalStage = z.infer<typeof SignalStage>;

export const SIGNAL_MOODS = ['positive', 'neutral', 'negative', 'complaint'] as const;
export const SignalMood = z.enum(SIGNAL_MOODS);
export type SignalMood = z.infer<typeof SignalMood>;

/** What started an evaluation: the conversation went idle, a member asked, or Today's refresh. */
export const SignalTrigger = z.enum(['idle', 'manual', 'refresh']);
export type SignalTrigger = z.infer<typeof SignalTrigger>;

/** The AI's current judgement of one conversation. */
export const ConversationSignalDto = z.object({
  conversationId: z.uuid(),
  contactId: z.uuid().nullable(),
  stage: SignalStage,
  /** What the customer wants, one short line. */
  intent: z.string().max(160).nullable(),
  mood: SignalMood,
  needsHuman: z.boolean(),
  needsHumanReason: z.string().max(200).nullable(),
  followUpAt: z.iso.datetime().nullable(),
  followUpReason: z.string().max(200).nullable(),
  /** Rolling memory note of the conversation (Vietnamese). */
  note: z.string().max(1500).nullable(),
  /** Time of the last message the evaluation covered. */
  evaluatedUntil: z.iso.datetime().nullable(),
  evaluatedAt: z.iso.datetime().nullable(),
  /** A member set the stage by hand: the AI no longer changes it. */
  stageLocked: z.boolean(),
  /** Hidden from Today until a customer message newer than this arrives. */
  dismissedUntilMessageAfter: z.iso.datetime().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type ConversationSignalDto = z.infer<typeof ConversationSignalDto>;

export const ConversationSignalResponse = z.object({
  signal: ConversationSignalDto.nullable(),
});
export type ConversationSignalResponse = z.infer<typeof ConversationSignalResponse>;

/**
 * Outcome of an evaluation request: `ok` (signals written), `capped` (the daily evaluations are
 * used up), `nothing_new` (no customer message since the last evaluation), `disabled` (AI not
 * available, or a conversation that is never evaluated, such as spam).
 */
export const EvaluateSignalsStatus = z.enum(['ok', 'capped', 'nothing_new', 'disabled']);
export type EvaluateSignalsStatus = z.infer<typeof EvaluateSignalsStatus>;

export const EvaluateSignalsResponse = z.object({
  status: EvaluateSignalsStatus,
  signal: ConversationSignalDto.nullable(),
});
export type EvaluateSignalsResponse = z.infer<typeof EvaluateSignalsResponse>;

/** A member sets the stage by hand (locks it), or unlocks it so the AI may change it again. */
export const UpdateConversationSignalRequest = z
  .object({
    stage: SignalStage.optional(),
    stageLocked: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.stage !== undefined || b.stageLocked !== undefined, {
    message: 'Give a stage or stageLocked',
  });
export type UpdateConversationSignalRequest = z.infer<typeof UpdateConversationSignalRequest>;

export const BRAIN_IDLE_MINUTES = { min: 30, max: 120, default: 45 } as const;

export const BrainSettingsDto = z.object({
  /** `auto`: evaluate when a conversation goes idle; `manual`: only when a member asks. */
  mode: z.enum(['auto', 'manual']),
  idleMinutes: z.number().int().min(BRAIN_IDLE_MINUTES.min).max(BRAIN_IDLE_MINUTES.max),
  /** Morning briefing (owner and admins), at `briefingHour` local time. */
  briefingEnabled: z.boolean(),
  briefingHour: z.number().int().min(0).max(23),
});
export type BrainSettingsDto = z.infer<typeof BrainSettingsDto>;

export const UpdateBrainSettingsRequest = BrainSettingsDto.strict();
export type UpdateBrainSettingsRequest = z.infer<typeof UpdateBrainSettingsRequest>;

/** Evaluations used today (Asia/Ho_Chi_Minh) and the daily limit; `limit: null` = unlimited. */
export const BrainUsageDto = z.object({
  day: z.iso.date(),
  used: z.number().int().min(0),
  limit: z.number().int().min(0).nullable(),
});
export type BrainUsageDto = z.infer<typeof BrainUsageDto>;

/** Entitlement key of the daily evaluation cap (per business). */
export const BRAIN_EVALUATIONS_DAILY = 'brain.evaluations.daily';

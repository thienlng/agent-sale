import { z } from 'zod';

// ─── Plans and entitlements (docs/08 §3, T-053) ───────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'canceled',
] as const;

/**
 * What a workspace may use right now: its plan's entitlements with any
 * unexpired overrides applied. `null` in `limits` means unlimited; a key the
 * plan does not define is treated as 0 / off (deny by default).
 */
export const EntitlementsDto = z.object({
  plan: z.object({ code: z.string(), name: z.string(), version: z.number().int() }),
  status: z.enum(SUBSCRIPTION_STATUSES),
  periodEnd: z.iso.datetime().nullable(),
  /** `members.max`, `channels.max`, `contacts.max`, `storage.bytes`, `media.max`, … */
  limits: z.record(z.string(), z.number().int().nullable()),
  /** `feature.website_widget`, … */
  features: z.record(z.string(), z.boolean()),
  aiModels: z.array(z.string()),
  aiIncludedMessages: z
    .object({ amount: z.number().int(), periodDays: z.number().int() })
    .nullable(),
});
export type EntitlementsDto = z.infer<typeof EntitlementsDto>;

/** `limits` key of the member seat count. */
export const MEMBERS_LIMIT = 'members.max';

// ─── Message allowance (ADR-012 §5, T-091) ────────────────────────────────────

/**
 * The account's AI reply allowance for the current cycle, shared by every business of the
 * account. `used` counts delivered AI replies (once per reply, retries included) plus replies
 * being generated right now. `metered: false` = the business has no account yet (not counted).
 */
export const MessageUsageDto = z.object({
  metered: z.boolean(),
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  cycleStart: z.iso.datetime(),
  cycleEnd: z.iso.datetime(),
  /** The bot hands new conversations to staff until `cycleEnd`. */
  exhausted: z.boolean(),
});
export type MessageUsageDto = z.infer<typeof MessageUsageDto>;

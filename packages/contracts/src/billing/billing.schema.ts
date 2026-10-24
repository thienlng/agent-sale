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

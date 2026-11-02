import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const Amount = z.number().int().min(0).max(1_000_000_000_000);
/** Local calendar date (YYYY-MM-DD), never an instant. */
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'must be a real calendar date');

const Email = z.string().trim().toLowerCase().max(200).pipe(z.email());

// ─── Demo / trial / consultation requests taken by the bot (ADR-020) ──────────

export const SaasRequestKind = z.enum(['demo', 'trial', 'consultation']);
export type SaasRequestKind = z.infer<typeof SaasRequestKind>;

/**
 * What a lead told the bot. The phone identifies the customer (one phone = one customer); the
 * rest goes to a note on the customer. Free text on purpose: "10-20 người", "chiều thứ 5".
 */
export const SaasLeadDetails = z.object({
  name: text(120).min(1),
  phone: text(40).min(1),
  email: Email.nullable().default(null),
  company: text(200).default(''),
  teamSize: text(60).default(''),
  need: text(2000).default(''),
  preferredTime: text(200).default(''),
  planInterest: text(200).default(''),
});
export type SaasLeadDetails = z.infer<typeof SaasLeadDetails>;

// ─── Customer subscriptions ───────────────────────────────────────────────────

/** `free`: on a free plan (signed up, not paying; not churned either). */
export const SaasStage = z.enum(['trial', 'free', 'active', 'past_due', 'canceled']);
export type SaasStage = z.infer<typeof SaasStage>;
export const SaasBillingPeriod = z.enum(['monthly', 'quarterly', 'semiannual', 'yearly']);
export type SaasBillingPeriod = z.infer<typeof SaasBillingPeriod>;
/** Months in each billing period: MRR = period price / months. */
export const SAAS_PERIOD_MONTHS: Record<SaasBillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

/** Why a customer canceled (spec §6.3). */
export const SaasChurnReason = z.enum([
  'price',
  'missing_feature',
  'competitor',
  'no_longer_needed',
  'poor_support',
  'business_closed',
  'other',
]);
export type SaasChurnReason = z.infer<typeof SaasChurnReason>;

/**
 * Fields a sync owns on a linked subscription (Rapiz HQ, ADR-021 §3): read-only for staff. Note,
 * seats and churn reason stay editable.
 */
export const SAAS_LINKED_FIELDS = [
  'planId',
  'planName',
  'stage',
  'billingPeriod',
  'mrr',
  'trialEndsOn',
  'startedOn',
  'renewsOn',
  'canceledOn',
  'externalRef',
] as const;

// ─── Plan catalog per business (spec §6.1) ────────────────────────────────────

/** Price of a whole period in VND, by billing period; at least one. */
export const SaasPlanPrices = z
  .strictObject({
    monthly: Amount.optional(),
    quarterly: Amount.optional(),
    semiannual: Amount.optional(),
    yearly: Amount.optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'at least one price');
export type SaasPlanPrices = z.infer<typeof SaasPlanPrices>;

export const SaasPlanDto = z.object({
  id: z.uuid(),
  name: z.string(),
  prices: z.record(z.string(), z.number().int()),
  position: z.number().int(),
  archived: z.boolean(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SaasPlanDto = z.infer<typeof SaasPlanDto>;
export const SaasPlanList = z.object({ data: z.array(SaasPlanDto) });
export type SaasPlanList = z.infer<typeof SaasPlanList>;

export const CreateSaasPlan = z.object({
  name: text(120).min(1),
  prices: SaasPlanPrices,
  position: z.number().int().min(0).max(10_000).default(0),
});
export type CreateSaasPlan = z.input<typeof CreateSaasPlan>;

/** Only the fields sent change. Archived plans stay on current subscriptions. */
export const UpdateSaasPlan = z.object({
  name: text(120).min(1).optional(),
  prices: SaasPlanPrices.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  archived: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});
export type UpdateSaasPlan = z.input<typeof UpdateSaasPlan>;

const SubscriptionFields = z.object({
  planName: text(120).min(1),
  stage: SaasStage,
  billingPeriod: SaasBillingPeriod,
  /**
   * Monthly recurring revenue in VND (a yearly plan counts its price / 12). With `planId` the
   * server computes it from the plan's price for `billingPeriod` (and takes the plan's name).
   */
  mrr: Amount.default(0),
  planId: z.uuid().nullable().default(null),
  seats: z.number().int().min(1).max(1_000_000).nullable().default(null),
  trialEndsOn: CalendarDate.nullable().default(null),
  startedOn: CalendarDate.nullable().default(null),
  renewsOn: CalendarDate.nullable().default(null),
  canceledOn: CalendarDate.nullable().default(null),
  externalRef: text(200).nullable().default(null),
  note: text(2000).default(''),
  churnReason: SaasChurnReason.nullable().default(null),
  churnNote: text(1000).default(''),
});

/** `version` null creates the customer's subscription; otherwise it must match. */
export const PutSaasSubscription = SubscriptionFields.extend({
  version: z.number().int().min(1).nullable(),
})
  .refine((v) => v.stage !== 'trial' || v.trialEndsOn !== null, 'a trial needs its end date')
  .refine((v) => v.stage !== 'canceled' || v.canceledOn !== null, 'a cancellation needs its date');
export type PutSaasSubscription = z.infer<typeof PutSaasSubscription>;

export const SaasSubscriptionDto = SubscriptionFields.extend({
  id: z.uuid(),
  /** Set by a sync: the synced fields (`SAAS_LINKED_FIELDS`) are read-only (ADR-021 §3). */
  linked: z.object({ source: z.literal('rapiz') }).nullable(),
  /** Latest AI-reply usage from the platform (Rapiz HQ only). */
  usage: z
    .object({ used: z.number().int(), limit: z.number().int(), at: z.iso.datetime() })
    .nullable(),
  /** Usage at 80% of the allowance or more: a candidate for an upgrade. */
  upsell: z.boolean(),
  contactId: z.uuid(),
  /** Display name of the customer; null when unnamed. */
  contactName: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SaasSubscriptionDto = z.infer<typeof SaasSubscriptionDto>;

export const ContactSaasSubscription = z.object({ subscription: SaasSubscriptionDto.nullable() });
export type ContactSaasSubscription = z.infer<typeof ContactSaasSubscription>;

export const SaasSubscriptionList = z.object({
  data: z.array(SaasSubscriptionDto),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type SaasSubscriptionList = z.infer<typeof SaasSubscriptionList>;

export const SaasSubscriptionListQuery = z.object({
  stage: SaasStage.optional(),
  /** Comma-separated customer ids (at most 100): the rows of a customer list page. */
  contactIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(100).optional()),
  /** Only trials ending in the next 7 days (business-local date), soonest first. */
  endingSoon: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type SaasSubscriptionListQuery = z.infer<typeof SaasSubscriptionListQuery>;

export const SaasSummary = z.object({
  /** MRR of active and past-due subscriptions (trials and cancellations pay nothing yet). */
  mrr: Amount,
  stages: z.object({
    trial: z.number().int(),
    free: z.number().int(),
    active: z.number().int(),
    past_due: z.number().int(),
    canceled: z.number().int(),
  }),
  /** Trials ending in the next 7 days, today included (business-local date). */
  trialsEndingSoon: z.number().int(),
});
export type SaasSummary = z.infer<typeof SaasSummary>;

// ─── Subscription history (spec §6.2) ─────────────────────────────────────────

export const SaasHistorySource = z.enum(['staff', 'sync', 'system']);
export const SaasSubscriptionHistoryEntry = z.object({
  id: z.uuid(),
  fromStage: SaasStage.nullable(),
  toStage: SaasStage,
  fromPlan: z.string().nullable(),
  toPlan: z.string(),
  fromMrr: z.number().int().nullable(),
  toMrr: z.number().int(),
  churnReason: SaasChurnReason.nullable(),
  source: SaasHistorySource,
  changedAt: z.iso.datetime(),
});
export type SaasSubscriptionHistoryEntry = z.infer<typeof SaasSubscriptionHistoryEntry>;
export const SaasSubscriptionHistory = z.object({ data: z.array(SaasSubscriptionHistoryEntry) });
export type SaasSubscriptionHistory = z.infer<typeof SaasSubscriptionHistory>;

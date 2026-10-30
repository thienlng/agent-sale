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

// ─── Demo / trial / consultation requests taken by the bot (ADR-014) ──────────

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

export const SaasStage = z.enum(['trial', 'active', 'past_due', 'canceled']);
export type SaasStage = z.infer<typeof SaasStage>;
export const SaasBillingPeriod = z.enum(['monthly', 'quarterly', 'yearly']);
export type SaasBillingPeriod = z.infer<typeof SaasBillingPeriod>;

const SubscriptionFields = z.object({
  planName: text(120).min(1),
  stage: SaasStage,
  billingPeriod: SaasBillingPeriod,
  /** Monthly recurring revenue in VND (a yearly plan counts its price / 12). */
  mrr: Amount,
  seats: z.number().int().min(1).max(1_000_000).nullable().default(null),
  trialEndsOn: CalendarDate.nullable().default(null),
  startedOn: CalendarDate.nullable().default(null),
  renewsOn: CalendarDate.nullable().default(null),
  canceledOn: CalendarDate.nullable().default(null),
  externalRef: text(200).nullable().default(null),
  note: text(2000).default(''),
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
    active: z.number().int(),
    past_due: z.number().int(),
    canceled: z.number().int(),
  }),
  /** Trials ending in the next 7 days, today included (business-local date). */
  trialsEndingSoon: z.number().int(),
});
export type SaasSummary = z.infer<typeof SaasSummary>;

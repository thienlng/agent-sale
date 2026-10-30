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

// ─── Demo / trial / consultation requests (ADR-014) ───────────────────────────

export const SaasRequestKind = z.enum(['demo', 'trial', 'consultation']);
export type SaasRequestKind = z.infer<typeof SaasRequestKind>;
export const SaasRequestStatus = z.enum(['new', 'contacted', 'scheduled', 'converted', 'closed']);
export type SaasRequestStatus = z.infer<typeof SaasRequestStatus>;
export const SaasRequestSource = z.enum(['bot', 'staff']);
export type SaasRequestSource = z.infer<typeof SaasRequestSource>;

/** What the lead told us. Free text on purpose: "10-20 người", "chiều thứ 5". */
export const SaasLeadDetails = z.object({
  name: text(120).min(1),
  phone: text(40).nullable().default(null),
  email: Email.nullable().default(null),
  company: text(200).default(''),
  teamSize: text(60).default(''),
  need: text(2000).default(''),
  preferredTime: text(200).default(''),
  planInterest: text(200).default(''),
});
export type SaasLeadDetails = z.infer<typeof SaasLeadDetails>;

const reachable = (v: { phone: string | null; email: string | null }) =>
  Boolean(v.phone?.trim() || v.email);
const REACHABLE = 'give a phone number or an email';

export const CreateSaasRequest = SaasLeadDetails.extend({
  clientRequestId: z.uuid(),
  kind: SaasRequestKind,
  contactId: z.uuid().nullable().default(null),
  note: text(2000).default(''),
}).refine(reachable, REACHABLE);
export type CreateSaasRequest = z.infer<typeof CreateSaasRequest>;

export const SaasRequestDto = z.object({
  id: z.uuid(),
  kind: SaasRequestKind,
  status: SaasRequestStatus,
  source: SaasRequestSource,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  company: z.string(),
  teamSize: z.string(),
  need: z.string(),
  preferredTime: z.string(),
  planInterest: z.string(),
  contactId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  note: z.string(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SaasRequestDto = z.infer<typeof SaasRequestDto>;

export const SaasRequestList = z.object({
  data: z.array(SaasRequestDto),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type SaasRequestList = z.infer<typeof SaasRequestList>;

export const SaasRequestListQuery = z.object({
  status: SaasRequestStatus.optional(),
  kind: SaasRequestKind.optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type SaasRequestListQuery = z.infer<typeof SaasRequestListQuery>;

/** Staff follow-up: move the status, correct details, link the customer. */
export const UpdateSaasRequest = z
  .object({
    version: z.number().int().min(1),
    name: text(120).min(1).optional(),
    phone: text(40).nullable().optional(),
    email: Email.nullable().optional(),
    company: text(200).optional(),
    teamSize: text(60).optional(),
    need: text(2000).optional(),
    preferredTime: text(200).optional(),
    planInterest: text(200).optional(),
    status: SaasRequestStatus.exclude(['new']).optional(),
    contactId: z.uuid().nullable().optional(),
    note: text(2000).optional(),
  })
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'version' && v[k as keyof typeof v] !== undefined),
    'nothing to change',
  );
export type UpdateSaasRequest = z.infer<typeof UpdateSaasRequest>;

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
  /** Trials ending within the next 7 days (business-local date). */
  trialsEndingSoon: z.number().int(),
  /** Requests still waiting for a first contact. */
  newRequests: z.number().int(),
});
export type SaasSummary = z.infer<typeof SaasSummary>;

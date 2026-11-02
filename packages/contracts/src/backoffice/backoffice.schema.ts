import { z } from 'zod';

import { ACCOUNT_STATUSES } from '../account/account.events.js';
import { SUBSCRIPTION_STATUSES } from '../billing/billing.schema.js';
import { AI_MODEL_TIERS, BILLING_PERIODS, ENTITLEMENT_KEYS } from '../billing/entitlement-keys.js';

// Platform admin (ADR-021 §6). Every write carries a `reason`; replaced rows carry `expectedVersion`.

export const AdminReason = z.string().trim().min(3).max(500);

const PeriodMonths = z.union(
  BILLING_PERIODS.map((p) => z.literal(p)) as [
    z.ZodLiteral<1>,
    z.ZodLiteral<3>,
    z.ZodLiteral<6>,
    z.ZodLiteral<12>,
  ],
);

// ─── Plan catalog ─────────────────────────────────────────────────────────────

const PlanCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lowercase letters, digits and _');

const entitlementValueByKind = {
  limit: z.number().int().min(0).nullable(),
  flag: z.boolean(),
  models: z.array(z.enum(AI_MODEL_TIERS)).min(1),
  allowance: z.object({
    amount: z.number().int().min(0),
    periodDays: z.number().int().min(1).max(366),
  }),
} as const;

/** A complete entitlement set: every key of `ENTITLEMENT_KEYS`, no other key. */
export const PlanEntitlements = z.strictObject(
  Object.fromEntries(
    Object.entries(ENTITLEMENT_KEYS).map(([k, kind]) => [k, entitlementValueByKind[kind]]),
  ) as {
    [
      K in keyof typeof ENTITLEMENT_KEYS
    ]: (typeof entitlementValueByKind)[(typeof ENTITLEMENT_KEYS)[K]];
  },
);
export type PlanEntitlements = z.infer<typeof PlanEntitlements>;

/** Price per billing period in VND, keyed by months as a string (`"1"`, `"3"`, `"6"`, `"12"`). */
export const PlanPrices = z.strictObject({
  '1': z.number().int().positive().optional(),
  '3': z.number().int().positive().optional(),
  '6': z.number().int().positive().optional(),
  '12': z.number().int().positive().optional(),
});
export type PlanPrices = z.infer<typeof PlanPrices>;

export const AdminPlanDto = z.object({
  code: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  archived: z.boolean(),
  sortOrder: z.number().int(),
  priceByPeriod: z.record(z.string(), z.number().int()),
  entitlements: z.record(z.string(), z.unknown()),
  /** Accounts whose subscription is on this exact (code, version). */
  subscriberCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type AdminPlanDto = z.infer<typeof AdminPlanDto>;

/** Latest version of every plan code (with older versions that still have subscribers). */
export const AdminPlanList = z.object({ data: z.array(AdminPlanDto) });
export type AdminPlanList = z.infer<typeof AdminPlanList>;

const PlanBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  priceByPeriod: PlanPrices,
  entitlements: PlanEntitlements,
  reason: AdminReason,
});

export const CreatePlanRequest = PlanBody.extend({ code: PlanCode });
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

/** Publishes version N+1 of a plan code; current subscribers stay on their version. */
export const PublishPlanVersionRequest = PlanBody.extend({
  /** The latest version the operator edited (409 when someone published in between). */
  expectedVersion: z.number().int().min(1),
});
export type PublishPlanVersionRequest = z.infer<typeof PublishPlanVersionRequest>;

export const ArchivePlanRequest = z.object({ archived: z.boolean(), reason: AdminReason });
export type ArchivePlanRequest = z.infer<typeof ArchivePlanRequest>;

// ─── Billing settings (trial, lifecycle, bank account, HQ scope) ─────────────

export const HQ_CONTACT_SCOPES = ['owner', 'owner_and_billing'] as const;

export const BillingSettingsDto = z.object({
  trialEnabled: z.boolean(),
  trialPlanCode: z.string().nullable(),
  trialDays: z.number().int().nullable(),
  afterTrialPlanCode: z.string(),
  hqContactScope: z.enum(HQ_CONTACT_SCOPES),
  graceDays: z.number().int(),
  suspendDays: z.number().int(),
  bankBin: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  bankAccountName: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type BillingSettingsDto = z.infer<typeof BillingSettingsDto>;

export const PutBillingSettingsRequest = z
  .object({
    trialEnabled: z.boolean(),
    trialPlanCode: z.string().nullable(),
    trialDays: z.number().int().min(1).max(90).nullable(),
    afterTrialPlanCode: z.string().min(1),
    hqContactScope: z.literal('owner'),
    graceDays: z.number().int().min(0).max(60),
    suspendDays: z.number().int().min(0).max(365),
    bankBin: z
      .string()
      .regex(/^\d{6}$/)
      .nullable(),
    bankAccountNo: z
      .string()
      .regex(/^[0-9A-Za-z]{4,30}$/)
      .nullable(),
    bankAccountName: z.string().trim().max(100).nullable(),
    expectedVersion: z.number().int().min(1),
    reason: AdminReason,
  })
  .refine((v) => !v.trialEnabled || (v.trialPlanCode !== null && v.trialDays !== null), {
    message: 'trial plan and days are required when the trial is on',
    path: ['trialPlanCode'],
  });
export type PutBillingSettingsRequest = z.infer<typeof PutBillingSettingsRequest>;

// ─── Accounts ────────────────────────────────────────────────────────────────

export const AdminAccountListQuery = z.object({
  /** Account name, or owner email / phone / name. */
  q: z.string().trim().max(100).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planCode: z.string().optional(),
  /** Trials or paid periods ending within this many days. */
  endingWithinDays: z.coerce.number().int().min(1).max(90).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminAccountListQuery = z.infer<typeof AdminAccountListQuery>;

export const AdminPlanRef = z.object({
  code: z.string(),
  version: z.number().int(),
  name: z.string(),
});

export const AdminSubscriptionDto = z.object({
  plan: AdminPlanRef,
  status: z.enum(SUBSCRIPTION_STATUSES),
  /** Lazy trial expiry: what the account gets right now (after-trial plan once the trial ended). */
  effectivePlan: AdminPlanRef,
  periodMonths: z.number().int().nullable(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type AdminSubscriptionDto = z.infer<typeof AdminSubscriptionDto>;

export const AdminUserRef = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
});

export const AdminAccountRow = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(ACCOUNT_STATUSES),
  owner: AdminUserRef.nullable(),
  /** `null` = no subscription row: the account is on the free plan. */
  subscription: AdminSubscriptionDto.nullable(),
  businessCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type AdminAccountRow = z.infer<typeof AdminAccountRow>;

export const AdminAccountList = z.object({
  data: z.array(AdminAccountRow),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export type AdminAccountList = z.infer<typeof AdminAccountList>;

export const AdminOverrideDto = z.object({
  key: z.string(),
  value: z.unknown(),
  reason: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminOverrideDto = z.infer<typeof AdminOverrideDto>;

export const AdminAuditEntry = z.object({
  id: z.uuid(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  reason: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export const PAYMENT_STATUSES = ['pending', 'confirmed', 'canceled'] as const;

export const AdminPaymentDto = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  /** Transfer content (unique). */
  code: z.string(),
  plan: AdminPlanRef,
  periodMonths: z.number().int(),
  amountVnd: z.number().int(),
  status: z.enum(PAYMENT_STATUSES),
  /** VietQR image URL for the transfer (img.vietqr.io), `null` when no bank account is set. */
  qrUrl: z.string().nullable(),
  bankReference: z.string().nullable(),
  note: z.string(),
  confirmedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminPaymentDto = z.infer<typeof AdminPaymentDto>;

export const AdminAccountDetail = AdminAccountRow.extend({
  statusReason: z.string(),
  businesses: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      industry: z.string(),
      memberCount: z.number().int().min(0),
      createdAt: z.iso.datetime(),
    }),
  ),
  accountMembers: z.array(AdminUserRef.extend({ role: z.string() })),
  overrides: z.array(AdminOverrideDto),
  usage: z
    .object({
      used: z.number().int(),
      limit: z.number().int(),
      cycleStart: z.iso.datetime(),
      cycleEnd: z.iso.datetime(),
    })
    .nullable(),
  payments: z.array(AdminPaymentDto),
  audit: z.array(AdminAuditEntry),
});
export type AdminAccountDetail = z.infer<typeof AdminAccountDetail>;

export const SetAccountPlanRequest = z.object({
  planCode: z.string().min(1),
  /** `null` for free; required for priced plans. */
  periodMonths: PeriodMonths.nullable(),
  /** Defaults to now. */
  startsAt: z.iso.datetime().optional(),
  status: z.enum(['active', 'trialing']).default('active'),
  /** `null` = no subscription yet. */
  expectedVersion: z.number().int().min(1).nullable(),
  reason: AdminReason,
});
export type SetAccountPlanRequest = z.infer<typeof SetAccountPlanRequest>;

export const ExtendTrialRequest = z.object({
  until: z.iso.datetime(),
  expectedVersion: z.number().int().min(1),
  reason: AdminReason,
});
export type ExtendTrialRequest = z.infer<typeof ExtendTrialRequest>;

export const PutOverrideRequest = z.object({
  value: z.unknown(),
  expiresAt: z.iso.datetime().nullable(),
  reason: AdminReason,
});
export type PutOverrideRequest = z.infer<typeof PutOverrideRequest>;

export const AdminReasonRequest = z.object({ reason: AdminReason });
export type AdminReasonRequest = z.infer<typeof AdminReasonRequest>;

export const SetAccountStatusRequest = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  reason: AdminReason,
});
export type SetAccountStatusRequest = z.infer<typeof SetAccountStatusRequest>;

// ─── Payments (VietQR, manual confirm) ───────────────────────────────────────

export const CreatePaymentRequest = z.object({
  planCode: z.string().min(1),
  periodMonths: PeriodMonths,
  /** Defaults to the plan's price for the period. */
  amountVnd: z.number().int().positive().optional(),
  note: z.string().trim().max(500).default(''),
  reason: AdminReason,
});
export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequest>;

/** Confirming applies the plan: a new period starts now, or at the current period end if later. */
export const ConfirmPaymentRequest = z.object({
  bankReference: z.string().trim().max(100).nullable(),
  reason: AdminReason,
});
export type ConfirmPaymentRequest = z.infer<typeof ConfirmPaymentRequest>;

export const AdminPaymentListQuery = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminPaymentListQuery = z.infer<typeof AdminPaymentListQuery>;

export const AdminPaymentList = z.object({
  data: z.array(AdminPaymentDto),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export type AdminPaymentList = z.infer<typeof AdminPaymentList>;

export const AdminAuditQuery = z.object({
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminAuditList = z.object({
  data: z.array(AdminAuditEntry),
  page: z.object({ nextCursor: z.string().nullable() }),
});
export type AdminAuditList = z.infer<typeof AdminAuditList>;

import type {
  SaasBillingPeriod,
  SaasStage,
  SubscriptionChangedV1,
  SubscriptionReminderV1,
} from '@agent-sales/contracts';

/**
 * Rapiz HQ (ADR-021, spec R6): how a platform subscription reads as an HQ subscription row. Pure;
 * dates are calendar dates of the HQ business, computed by the caller's `toDate`.
 */
export function hqStage(
  e: Pick<SubscriptionChangedV1, 'status' | 'planCode' | 'mrrVnd'>,
): SaasStage {
  switch (e.status) {
    case 'trialing':
      return 'trial';
    case 'active':
      // The free plan is "active" for billing but pays nothing: not a paying customer.
      return e.planCode === 'free' || e.mrrVnd === 0 ? 'free' : 'active';
    case 'past_due':
      return 'past_due';
    default:
      // `suspended` and `canceled`: the customer no longer pays (R6).
      return 'canceled';
  }
}

export function hqPeriod(months: number | null): SaasBillingPeriod {
  if (months === 3) return 'quarterly';
  if (months === 6) return 'semiannual';
  if (months === 12) return 'yearly';
  return 'monthly';
}

export interface HqSubscriptionFacts {
  planName: string;
  stage: SaasStage;
  billingPeriod: SaasBillingPeriod;
  mrr: number;
  trialEndsOn: string | null;
  startedOn: string | null;
  renewsOn: string | null;
  canceledOn: string | null;
}

export type HqSubscriptionInput = Pick<
  SubscriptionChangedV1,
  | 'status'
  | 'planCode'
  | 'planName'
  | 'periodMonths'
  | 'periodStart'
  | 'periodEnd'
  | 'mrrVnd'
  | 'occurredAt'
>;

/** The synced fields (`SAAS_LINKED_FIELDS`) of a platform subscription. */
export function hqSubscriptionFacts(
  e: HqSubscriptionInput,
  toDate: (iso: string) => string,
): HqSubscriptionFacts {
  const stage = hqStage(e);
  const end = e.periodEnd ? toDate(e.periodEnd) : null;
  const paying = stage === 'active' || stage === 'past_due';
  return {
    planName: e.planName,
    stage,
    billingPeriod: hqPeriod(e.periodMonths),
    mrr: paying ? e.mrrVnd : 0,
    // A trial always has its end date (the row requires one): the event's own date at worst.
    trialEndsOn: stage === 'trial' ? (end ?? toDate(e.occurredAt)) : null,
    startedOn: e.periodStart ? toDate(e.periodStart) : null,
    renewsOn: paying ? end : null,
    canceledOn: stage === 'canceled' ? toDate(e.occurredAt) : null,
  };
}

/** Same facts? (the reconcile repairs only drift, so a clean run writes nothing). */
export function sameFacts(a: HqSubscriptionFacts, b: HqSubscriptionFacts): boolean {
  return (Object.keys(a) as (keyof HqSubscriptionFacts)[]).every((k) => a[k] === b[k]);
}

export type ReminderKind = SubscriptionReminderV1['kind'];

const REMINDER_LABEL: Record<ReminderKind, string> = {
  trial_ending: 'Dùng thử sắp hết hạn',
  renewal_due: 'Sắp đến hạn gia hạn',
  past_due: 'Quá hạn thanh toán',
};

/**
 * The follow-up staff read on the customer. The CRM has no tasks yet, so a follow-up is a note
 * (spec §6.5); Vietnamese, as business content.
 */
export function reminderNote(kind: ReminderKind, dueOn: string, daysLeft: number): string {
  const when =
    daysLeft > 0 ? `còn ${daysLeft} ngày` : daysLeft === 0 ? 'hôm nay' : `quá ${-daysLeft} ngày`;
  return `Việc cần làm: ${REMINDER_LABEL[kind]} (${dueOn}, ${when}). Liên hệ khách hàng.`;
}

/** Reminders a SaaS business gets for its own customers (spec §6.5): days ahead of the date. */
export const LOCAL_REMINDER_DAYS = { trial_ending: 3, renewal_due: 7 } as const;
export type LocalReminderKind = keyof typeof LOCAL_REMINDER_DAYS;

export const upsellNote = (used: number, limit: number) =>
  `Cơ hội nâng cấp: đã dùng ${used}/${limit} lượt trả lời AI của chu kỳ (từ 80%).`;

export const ACCOUNT_STATUS_NOTE = {
  suspended: 'Tài khoản Rapiz bị tạm khóa.',
  active: 'Tài khoản Rapiz hoạt động trở lại.',
} as const;

/** Author of the notes the sync and the reminder job leave. */
export const SYNC_AUTHOR = 'Rapiz';

/** Integration events published by billing. Payload schemas live in packages/contracts/src/billing/. */
export const BILLING_EVENT_TYPES = [
  'billing.subscription.changed.v1',
  'billing.usage.snapshot.v1',
  'billing.subscription.reminder.v1',
] as const;

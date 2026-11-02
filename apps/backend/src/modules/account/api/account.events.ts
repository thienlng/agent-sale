/** Integration events published by account. Payload schemas live in packages/contracts/src/account/. */
export const ACCOUNT_EVENT_TYPES = [
  'account.account.created.v1',
  'account.account.status_changed.v1',
] as const;

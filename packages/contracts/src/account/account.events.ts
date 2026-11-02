import { z } from 'zod';

/**
 * Integration events published by the account module (ADR-021 §2). Platform-level: written to the
 * outbox with no workspace. Consumed by the Rapiz HQ sync in the `saas` module.
 */
export const AccountCreatedV1 = z.object({
  type: z.literal('account.account.created.v1'),
  accountId: z.uuid(),
  ownerUserId: z.uuid(),
  name: z.string(),
  ownerName: z.string(),
  /** Link keys for HQ adoption (ADR-021 §4). Never logged. */
  ownerEmail: z.string(),
  ownerPhone: z.string().nullable(),
  /** The first business, when the account was created by a signup. */
  workspaceId: z.uuid().nullable(),
  industry: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});
export type AccountCreatedV1 = z.infer<typeof AccountCreatedV1>;

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const AccountStatusChangedV1 = z.object({
  type: z.literal('account.account.status_changed.v1'),
  accountId: z.uuid(),
  status: z.enum(ACCOUNT_STATUSES),
  occurredAt: z.iso.datetime(),
});
export type AccountStatusChangedV1 = z.infer<typeof AccountStatusChangedV1>;

export const AccountEvents = z.discriminatedUnion('type', [
  AccountCreatedV1,
  AccountStatusChangedV1,
]);
export type AccountEvent = z.infer<typeof AccountEvents>;

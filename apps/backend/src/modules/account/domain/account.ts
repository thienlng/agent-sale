import type { UserId } from '@agent-sales/shared';

import {
  AccountChoiceRequiredError,
  AccountNotFoundError,
  AccountStatusUnchangedError,
} from './account.errors.js';

export type AccountRole = 'owner' | 'billing';

/**
 * ADR-012 §3: the account a new business goes under. An explicit account must be owned
 * by the caller; otherwise the caller's only owned account; none → create one (null);
 * several → the caller has to choose.
 */
export function pickAccountForNewBusiness(input: {
  requested: string | undefined;
  owned: readonly string[];
}): string | null {
  if (input.requested !== undefined) {
    if (!input.owned.includes(input.requested)) throw new AccountNotFoundError(input.requested);
    return input.requested;
  }
  if (input.owned.length > 1) throw new AccountChoiceRequiredError();
  return input.owned[0] ?? null;
}

/**
 * A new account is named after its owner (ADR-012, like the backfill), never after the first business: the
 * account holds every business the owner adds later. Without a name the email's local part is
 * used; without any owner contact (system paths) the business name is the last resort.
 */
export function accountNameFor(input: {
  owner?: Pick<AccountOwnerInfo, 'name' | 'email'> | undefined;
  businessName: string;
}): string {
  const name =
    input.owner?.name.trim() ||
    input.owner?.email.split('@')[0]?.trim() ||
    input.businessName.trim();
  return name.slice(0, 120);
}

/** An account the user belongs to, with their account role (never business access). */
export interface AccountMembership {
  accountId: string;
  name: string;
  role: AccountRole;
}

export interface NewAccount {
  id: string;
  name: string;
  ownerUserId: UserId;
  /** Integration event written with the account (`account.account.created.v1`, ADR-021 §2). */
  createdEvent?: Record<string, unknown>;
}

export const ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Who the account belongs to, for the account-created event (HQ adoption keys, ADR-021 §4). */
export interface AccountOwnerInfo {
  name: string;
  email: string;
  phone: string | null;
}

/** An account as the platform admin sees it (no business data). */
export interface AdminAccount {
  id: string;
  name: string;
  status: AccountStatus;
  statusReason: string;
  statusChangedAt: Date | null;
  createdAt: Date;
  /** The oldest active owner; null for a broken account. */
  ownerUserId: string | null;
}

export interface AdminAccountMember {
  userId: string;
  role: AccountRole;
}

export interface AdminAccountQuery {
  /** Case-insensitive substring of the account name… */
  q?: string | undefined;
  /** …or an account owned by one of these users (owner search by email/phone, resolved upstream). */
  ownerUserIds?: readonly string[] | undefined;
  /** Restrict to these accounts (billing filters, resolved upstream). */
  accountIds?: readonly string[] | undefined;
  /** Leave out these accounts (e.g. "on the free plan" = every account without a paid row). */
  excludeAccountIds?: readonly string[] | undefined;
  status?: AccountStatus | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Status change by a platform operator. Suspending twice is a no-op error, not a silent success. */
export function assertStatusChange(from: AccountStatus, to: AccountStatus): void {
  if (from === to) throw new AccountStatusUnchangedError(to);
}

/** Opaque keyset cursor: newest first by creation time, then id. */
export function encodeAccountCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeAccountCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

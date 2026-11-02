import type { UserId } from '@agent-sales/shared';

import {
  type AccountMembership,
  type AccountStatus,
  type AdminAccount,
  type AdminAccountMember,
  type AdminAccountQuery,
  decodeAccountCursor,
  encodeAccountCursor,
  type NewAccount,
} from '../../domain/account.js';
import { AccountNotFoundError } from '../../domain/account.errors.js';
import type { AccountRepository, OperatorAction } from '../../domain/ports/account.repository.js';

interface Row extends NewAccount {
  status: AccountStatus;
  statusReason: string;
  statusChangedAt: Date | null;
  createdAt: Date;
}

/** DB-less runs and tests. */
export class InMemoryAccountRepository implements AccountRepository {
  readonly accounts: Row[] = [];
  /** Events and audit rows "written" with the changes (tests read them). */
  readonly events: Record<string, unknown>[] = [];
  readonly audit: (OperatorAction & { action: string; targetId: string })[] = [];

  async membershipsOf(user: UserId): Promise<AccountMembership[]> {
    return this.accounts
      .filter((a) => a.ownerUserId === user && a.status === 'active')
      .map((a) => ({ accountId: a.id, name: a.name, role: 'owner' as const }));
  }

  async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map(this.accounts.filter((a) => ids.includes(a.id)).map((a) => [a.id, a.name]));
  }

  // No await between the read and the push, so concurrent callers are already serialized.
  async resolveForOwner(
    user: UserId,
    decide: (owned: string[]) => string | NewAccount,
  ): Promise<string> {
    const choice = decide(this.accounts.filter((a) => a.ownerUserId === user).map((a) => a.id));
    if (typeof choice === 'string') return choice;
    this.accounts.push({
      ...choice,
      status: 'active',
      statusReason: '',
      statusChangedAt: null,
      createdAt: new Date(),
    });
    if (choice.createdEvent) this.events.push(choice.createdEvent);
    return choice.id;
  }

  async listForAdmin(
    query: AdminAccountQuery,
  ): Promise<{ data: AdminAccount[]; nextCursor: string | null }> {
    const q = query.q?.toLowerCase();
    const after = query.cursor ? decodeAccountCursor(query.cursor) : null;
    const rows = this.accounts
      .filter((a) => !query.status || a.status === query.status)
      .filter((a) => !query.accountIds || query.accountIds.includes(a.id))
      .filter((a) => !query.excludeAccountIds?.includes(a.id))
      .filter(
        (a) =>
          !q || a.name.toLowerCase().includes(q) || !!query.ownerUserIds?.includes(a.ownerUserId),
      )
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (y.id < x.id ? -1 : 1))
      .filter(
        (a) =>
          !after ||
          a.createdAt.getTime() < after.createdAt.getTime() ||
          (a.createdAt.getTime() === after.createdAt.getTime() && a.id < after.id),
      );
    const page = rows.slice(0, query.limit).map(toAdmin);
    const last = page.at(-1);
    return {
      data: page,
      nextCursor:
        rows.length > query.limit && last ? encodeAccountCursor(last.createdAt, last.id) : null,
    };
  }

  async byIds(ids: readonly string[]): Promise<AdminAccount[]> {
    return this.accounts.filter((a) => ids.includes(a.id)).map(toAdmin);
  }

  async membersOf(accountId: string): Promise<AdminAccountMember[]> {
    const a = this.accounts.find((x) => x.id === accountId);
    return a ? [{ userId: a.ownerUserId, role: 'owner' }] : [];
  }

  async setStatus(
    accountId: string,
    status: AccountStatus,
    action: OperatorAction,
    check: (from: AccountStatus) => void,
    now: Date,
  ): Promise<AccountStatus> {
    const a = this.accounts.find((x) => x.id === accountId);
    if (!a) throw new AccountNotFoundError(accountId);
    const from = a.status;
    check(from);
    Object.assign(a, { status, statusReason: action.reason, statusChangedAt: now });
    this.audit.push({ ...action, action: `account.${status}`, targetId: accountId });
    this.events.push({ type: 'account.account.status_changed.v1', accountId, status });
    return from;
  }
}

function toAdmin(a: Row): AdminAccount {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    statusReason: a.statusReason,
    statusChangedAt: a.statusChangedAt,
    createdAt: a.createdAt,
    ownerUserId: a.ownerUserId,
  };
}

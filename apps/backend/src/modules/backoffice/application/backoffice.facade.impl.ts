import type {
  AdminAccountDetail,
  AdminAccountList,
  AdminAccountListQuery,
  AdminAccountRow,
  AdminAuditEntry,
  AdminAuditList,
  AdminAuditQuery,
} from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ACCOUNT_FACADE, type AccountFacade, type AdminAccount } from '../../account/api/index.js';
import {
  BILLING_ADMIN_FACADE,
  type BillingAccountFilter,
  type BillingAdminFacade,
} from '../../billing/api/index.js';
import {
  IDENTITY_ADMIN_FACADE,
  type IdentityAdminFacade,
  type UserRef,
} from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { BackofficeFacade } from '../api/backoffice.facade.js';
import { AdminAccountNotFoundError, InvalidAdminCursorError } from '../domain/backoffice.errors.js';
import {
  PLATFORM_AUDIT_STORE,
  type PlatformAuditRecord,
  type PlatformAuditStore,
} from './ports/platform-audit-store.js';

/** Owners matched by an account search (email / phone / name), at most. */
const OWNER_MATCHES = 50;
/** Audit entries shown on the account page. */
const AUDIT_IN_DETAIL = 20;

const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  if (!id || Number.isNaN(date.getTime())) throw new InvalidAdminCursorError();
  return { at: date, id };
}

const toAuditEntry = (r: PlatformAuditRecord): AdminAuditEntry => ({
  id: r.id,
  actorName: r.actorName,
  action: r.action,
  targetType: r.targetType,
  targetId: r.targetId,
  reason: r.reason,
  data: r.data,
  createdAt: r.createdAt.toISOString(),
});

const toUserRef = (u: UserRef) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone });

/** Read orchestration only: every query is one batched call per module, never one per row. */
@Injectable()
export class BackofficeFacadeImpl implements BackofficeFacade {
  constructor(
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(IDENTITY_ADMIN_FACADE) private readonly identity: IdentityAdminFacade,
    @Inject(BILLING_ADMIN_FACADE) private readonly billing: BillingAdminFacade,
    @Inject(PLATFORM_AUDIT_STORE) private readonly audit: PlatformAuditStore,
  ) {}

  async listAccounts(query: AdminAccountListQuery): Promise<AdminAccountList> {
    const filter: BillingAccountFilter = {};
    if (query.subscriptionStatus) filter.subscriptionStatus = query.subscriptionStatus;
    if (query.planCode) filter.planCode = query.planCode;
    if (query.endingWithinDays) filter.endingWithinDays = query.endingWithinDays;
    const [match, owners] = await Promise.all([
      this.billing.matchAccounts(filter),
      query.q ? this.identity.searchUsers(query.q, OWNER_MATCHES) : Promise.resolve([]),
    ]);
    const page = await this.accounts.listForAdmin({
      q: query.q,
      ownerUserIds: owners.map((u) => u.id),
      accountIds: match && !match.exclude ? match.ids : undefined,
      excludeAccountIds: match?.exclude ? match.ids : undefined,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    return {
      data: await this.#rows(page.data),
      page: { nextCursor: page.nextCursor },
    };
  }

  async accountDetail(accountId: string): Promise<AdminAccountDetail> {
    const [account] = await this.accounts.getForAdmin([accountId]);
    if (!account) throw new AdminAccountNotFoundError(accountId);
    const [members, businesses, subscriptions, billing, audit] = await Promise.all([
      this.accounts.membersForAdmin(accountId),
      this.workspaces.listByAccounts([accountId]),
      this.billing.subscriptionsOf([accountId]),
      this.billing.accountBilling(accountId),
      this.audit.list({ targetType: 'account', targetId: accountId, limit: AUDIT_IN_DETAIL }),
    ]);
    const userIds = new Set(members.map((m) => m.userId));
    if (account.ownerUserId) userIds.add(account.ownerUserId);
    const users = new Map((await this.identity.usersByIds([...userIds])).map((u) => [u.id, u]));
    const owner = account.ownerUserId ? users.get(account.ownerUserId) : undefined;
    return {
      id: account.id,
      name: account.name,
      status: account.status,
      statusReason: account.statusReason,
      owner: owner ? toUserRef(owner) : null,
      subscription: subscriptions.get(accountId) ?? null,
      businessCount: businesses.length,
      createdAt: account.createdAt.toISOString(),
      businesses: businesses.map((b) => ({
        id: b.workspaceId,
        name: b.name,
        industry: b.industry,
        memberCount: b.memberCount,
        createdAt: b.createdAt.toISOString(),
      })),
      accountMembers: members.flatMap((m) => {
        const u = users.get(m.userId);
        return u ? [{ ...toUserRef(u), role: m.role }] : [];
      }),
      overrides: billing.overrides,
      usage: billing.usage,
      payments: billing.payments,
      audit: audit.map(toAuditEntry),
    };
  }

  async listAudit(query: AdminAuditQuery): Promise<AdminAuditList> {
    const rows = await this.audit.list({
      targetType: query.targetType,
      targetId: query.targetId,
      before: decodeCursor(query.cursor),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(toAuditEntry),
      page: {
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      },
    };
  }

  async #rows(accounts: AdminAccount[]): Promise<AdminAccountRow[]> {
    if (!accounts.length) return [];
    const ids = accounts.map((a) => a.id);
    const ownerIds = [...new Set(accounts.flatMap((a) => (a.ownerUserId ? [a.ownerUserId] : [])))];
    const [subscriptions, users, businesses] = await Promise.all([
      this.billing.subscriptionsOf(ids),
      this.identity.usersByIds(ownerIds),
      this.workspaces.listByAccounts(ids),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const businessCount = new Map<string, number>();
    for (const b of businesses)
      businessCount.set(b.accountId, (businessCount.get(b.accountId) ?? 0) + 1);
    return accounts.map((a) => {
      const owner = a.ownerUserId ? userById.get(a.ownerUserId) : undefined;
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        owner: owner ? toUserRef(owner) : null,
        subscription: subscriptions.get(a.id) ?? null,
        businessCount: businessCount.get(a.id) ?? 0,
        createdAt: a.createdAt.toISOString(),
      };
    });
  }
}

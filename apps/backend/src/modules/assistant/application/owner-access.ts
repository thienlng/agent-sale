import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type { AccountFacade } from '../../account/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { AssistantForbiddenError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';

export type { OwnerScope } from '../domain/owner-scope.js';

/**
 * The owner's memberships in the scope's account, read once while resolving the scope. Keyed by
 * the scope object, which lives for one request, so later steps of the same request (thread
 * prompt, memory labels) reuse the list instead of querying it again.
 */
const membershipsByScope = new WeakMap<OwnerScope, WorkspaceMembership[]>();

/**
 * The account's businesses the owner belongs to, from the request that resolved `scope`; read
 * again only for a scope built elsewhere (tests, jobs).
 */
export async function accountMemberships(
  workspace: Pick<WorkspaceFacade, 'listMemberships'>,
  scope: OwnerScope,
): Promise<WorkspaceMembership[]> {
  const cached = membershipsByScope.get(scope);
  if (cached) return cached;
  const memberships = (await workspace.listMemberships(scope.ownerUserId)).filter(
    (m) => m.accountId === scope.accountId,
  );
  membershipsByScope.set(scope, memberships);
  return memberships;
}

/**
 * The account of the business when the user is its active owner; ForbiddenError otherwise. The
 * scope lists the account's businesses the owner is a member of (always including `businessId`).
 * The three reads run in parallel; the membership list is kept for the rest of the request
 * (`accountMemberships`), so one request reads it once.
 */
export async function resolveOwnerScope(
  deps: { account: AccountFacade; workspace: WorkspaceFacade },
  userId: UserId,
  businessId: WorkspaceId,
): Promise<OwnerScope> {
  const [accountId, accounts, memberships] = await Promise.all([
    deps.workspace.accountOf(businessId),
    deps.account.listForUser(userId),
    deps.workspace.listMemberships(userId),
  ]);
  if (!accountId) throw new AssistantForbiddenError();
  const owns = accounts.some((a) => a.accountId === accountId && a.role === 'owner');
  if (!owns) throw new AssistantForbiddenError();
  const inAccount = memberships.filter((m) => m.accountId === accountId);
  const businessIds = [...new Set([businessId, ...inAccount.map((m) => m.workspaceId)])].sort();
  const scope: OwnerScope = { accountId, ownerUserId: userId, businessId, businessIds };
  membershipsByScope.set(scope, inAccount);
  return scope;
}

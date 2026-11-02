import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type { AccountFacade } from '../../account/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { AssistantForbiddenError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';

export type { OwnerScope } from '../domain/owner-scope.js';

/**
 * The account of the business when the user is its active owner; ForbiddenError otherwise. The
 * scope lists the account's businesses the owner is a member of (always including `businessId`).
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
  const businessIds = [
    ...new Set([
      businessId,
      ...memberships.filter((m) => m.accountId === accountId).map((m) => m.workspaceId),
    ]),
  ].sort();
  return { accountId, ownerUserId: userId, businessId, businessIds };
}

import type { UserId, WorkspaceId } from '@agent-sales/shared';

import type { AccountFacade } from '../../account/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { AssistantForbiddenError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';

export type { OwnerScope } from '../domain/owner-scope.js';

/** The account of the business when the user is its active owner; ForbiddenError otherwise. */
export async function resolveOwnerScope(
  deps: { account: AccountFacade; workspace: WorkspaceFacade },
  userId: UserId,
  businessId: WorkspaceId,
): Promise<OwnerScope> {
  const [accountId, accounts] = await Promise.all([
    deps.workspace.accountOf(businessId),
    deps.account.listForUser(userId),
  ]);
  if (!accountId) throw new AssistantForbiddenError();
  const owns = accounts.some((a) => a.accountId === accountId && a.role === 'owner');
  if (!owns) throw new AssistantForbiddenError();
  return { accountId, ownerUserId: userId, businessId };
}

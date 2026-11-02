import { userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { resolveOwnerScope } from '../application/owner-access.js';
import { AssistantForbiddenError } from '../domain/assistant.errors.js';

const ACCOUNT = '0190a0a0-0000-7000-8000-000000000001';
const OTHER_ACCOUNT = '0190a0a0-0000-7000-8000-000000000002';
const USER = userId('0190a0a0-0000-7000-8000-0000000000a1');
const BUSINESS = workspaceId('0190a0a0-0000-7000-8000-0000000000b1');

function deps(accounts: AccountMembership[], businessAccount: string | null) {
  return {
    account: { listForUser: () => Promise.resolve(accounts) } as unknown as AccountFacade,
    workspace: {
      accountOf: () => Promise.resolve(businessAccount),
    } as unknown as WorkspaceFacade,
  };
}

describe('resolveOwnerScope', () => {
  it('gives the account scope to an owner of the business account', async () => {
    const scope = await resolveOwnerScope(
      deps([{ accountId: ACCOUNT, name: 'A', role: 'owner' }], ACCOUNT),
      USER,
      BUSINESS,
    );
    expect(scope).toEqual({ accountId: ACCOUNT, ownerUserId: USER, businessId: BUSINESS });
  });

  it('refuses a billing member of the account', async () => {
    await expect(
      resolveOwnerScope(
        deps([{ accountId: ACCOUNT, name: 'A', role: 'billing' }], ACCOUNT),
        USER,
        BUSINESS,
      ),
    ).rejects.toBeInstanceOf(AssistantForbiddenError);
  });

  it('refuses the owner of a different account', async () => {
    await expect(
      resolveOwnerScope(
        deps([{ accountId: OTHER_ACCOUNT, name: 'B', role: 'owner' }], ACCOUNT),
        USER,
        BUSINESS,
      ),
    ).rejects.toBeInstanceOf(AssistantForbiddenError);
  });

  it('refuses a business without an account', async () => {
    await expect(
      resolveOwnerScope(
        deps([{ accountId: ACCOUNT, name: 'A', role: 'owner' }], null),
        USER,
        BUSINESS,
      ),
    ).rejects.toBeInstanceOf(AssistantForbiddenError);
  });
});

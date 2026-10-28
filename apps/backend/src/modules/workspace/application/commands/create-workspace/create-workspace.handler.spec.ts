import { WorkspaceCreatedV1 } from '@agent-sales/contracts';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { AccountFacade } from '../../../../account/api/index.js';
import { InMemoryWorkspaceUnitOfWork } from '../../../infrastructure/workspace.unit-of-work.js';
import { CreateWorkspaceHandler } from './create-workspace.handler.js';

/** Stand-in for the account module: records each resolution and returns one account id. */
function fakeAccounts() {
  const calls: Parameters<AccountFacade['resolveForNewBusiness']>[0][] = [];
  const accountId = newId();
  const facade: AccountFacade = {
    resolveForNewBusiness: async (input) => {
      calls.push(input);
      return accountId;
    },
  };
  return { facade, calls, accountId };
}

describe('CreateWorkspaceHandler', () => {
  it('persists the workspace, its owner membership and a versioned event', async () => {
    const uow = new InMemoryWorkspaceUnitOfWork();
    const accounts = fakeAccounts();
    const handler = new CreateWorkspaceHandler(uow, accounts.facade);
    const owner = userId(newId());

    const dto = await handler.execute({ name: 'Shop ABC', industry: 'retail', ownerUserId: owner });

    expect(await uow.workspaces.findById(workspaceId(dto.id))).not.toBeNull();
    expect(await uow.members.find(workspaceId(dto.id), owner)).toMatchObject({ role: 'owner' });
    expect(uow.events.published).toHaveLength(1);
    expect((await uow.workspaces.findById(workspaceId(dto.id)))?.snapshot().accountId).toBe(
      accounts.accountId,
    );
    expect(accounts.calls).toEqual([
      { userId: owner, accountId: undefined, businessName: 'Shop ABC' },
    ]);
    expect(WorkspaceCreatedV1.safeParse(uow.events.published[0]?.event).success).toBe(true);
  });

  it('creates no account when the business is invalid', async () => {
    const accounts = fakeAccounts();
    const handler = new CreateWorkspaceHandler(new InMemoryWorkspaceUnitOfWork(), accounts.facade);
    await expect(
      handler.execute({ name: ' ', industry: 'retail', ownerUserId: userId(newId()) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(accounts.calls).toEqual([]);
  });
});

import { WorkspaceCreatedV1 } from '@agent-sales/contracts';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { InMemoryWorkspaceUnitOfWork } from '../../../infrastructure/workspace.unit-of-work.js';
import { CreateWorkspaceHandler } from './create-workspace.handler.js';

describe('CreateWorkspaceHandler', () => {
  it('persists the workspace, its owner membership and a versioned event', async () => {
    const uow = new InMemoryWorkspaceUnitOfWork();
    const handler = new CreateWorkspaceHandler(uow);
    const owner = userId(newId());

    const dto = await handler.execute({ name: 'Shop ABC', industry: 'retail', ownerUserId: owner });

    expect(await uow.workspaces.findById(workspaceId(dto.id))).not.toBeNull();
    expect(await uow.members.find(workspaceId(dto.id), owner)).toMatchObject({ role: 'owner' });
    expect(uow.events.published).toHaveLength(1);
    expect(WorkspaceCreatedV1.safeParse(uow.events.published[0]?.event).success).toBe(true);
  });
});

import { WorkspaceDto } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { twoTenants } from '@agent-sales/testing';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../api/index.js';
import { WorkspaceNotFoundError } from '../domain/workspace.errors.js';
import { WorkspaceModule } from '../workspace.module.js';
import { createWorkspaceInput } from './factories/workspace.factory.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('WorkspaceFacade (contract)', () => {
  async function facade(): Promise<WorkspaceFacade> {
    const moduleRef = await Test.createTestingModule({ imports: [WorkspaceModule] }).compile();
    return moduleRef.get<WorkspaceFacade>(WORKSPACE_FACADE);
  }

  it('creates and reads back a workspace as a valid DTO', async () => {
    const f = await facade();
    const created = await f.createWorkspace(createWorkspaceInput.build());
    expect(WorkspaceDto.safeParse(created).success).toBe(true);
    const read = await f.getById(workspaceId(created.id));
    expect(read).toEqual(created);
  });

  it('reports NOT_FOUND for another tenant id (never leaks existence)', async () => {
    const f = await facade();
    const { b } = twoTenants();
    await expect(f.getById(b)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});

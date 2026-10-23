import { describe, expect, it } from 'vitest';

import { CreateWorkspaceRequest, WorkspaceCreatedV1 } from '../index.js';

describe('CreateWorkspaceRequest', () => {
  it('trims and accepts a valid payload', () => {
    const parsed = CreateWorkspaceRequest.parse({ name: '  Shop ABC ', industry: 'retail' });
    expect(parsed).toEqual({ name: 'Shop ABC', industry: 'retail' });
  });

  it('rejects an empty name', () => {
    expect(CreateWorkspaceRequest.safeParse({ name: ' ', industry: 'retail' }).success).toBe(false);
  });
});

describe('WorkspaceCreatedV1', () => {
  it('requires the versioned event type', () => {
    const base = {
      workspaceId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
      ownerUserId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d11',
      industry: 'retail',
      occurredAt: '2026-10-23T10:00:00.000Z',
    };
    expect(
      WorkspaceCreatedV1.safeParse({ ...base, type: 'workspace.workspace.created.v1' }).success,
    ).toBe(true);
    expect(WorkspaceCreatedV1.safeParse({ ...base, type: 'workspace.created' }).success).toBe(
      false,
    );
  });
});

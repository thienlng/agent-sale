import { newId, userId } from '@agent-sales/shared';
import { defineFactory } from '@agent-sales/testing';

export const createWorkspaceInput = defineFactory((n) => ({
  name: `Workspace ${n}`,
  industry: 'retail',
  ownerUserId: userId(newId()),
}));

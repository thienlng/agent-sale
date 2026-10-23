import { newId, userId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { Workspace } from './workspace.js';
import { InvalidWorkspaceError } from './workspace.errors.js';

const owner = userId(newId());

describe('Workspace aggregate', () => {
  it('creates a valid workspace and raises a created event', () => {
    const ws = Workspace.create({ name: '  Shop ABC ', industry: 'retail', ownerUserId: owner });
    expect(ws.snapshot().name).toBe('Shop ABC');
    expect(ws.snapshot().timezone).toBe('Asia/Ho_Chi_Minh');
    const events = ws.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('workspace.created');
    expect(ws.pullEvents()).toHaveLength(0);
  });

  it('rejects an empty name or industry', () => {
    expect(() => Workspace.create({ name: ' ', industry: 'retail', ownerUserId: owner })).toThrow(
      InvalidWorkspaceError,
    );
    expect(() => Workspace.create({ name: 'x', industry: ' ', ownerUserId: owner })).toThrow(
      InvalidWorkspaceError,
    );
  });

  it('renames within limits', () => {
    const ws = Workspace.create({ name: 'a', industry: 'retail', ownerUserId: owner });
    ws.rename('New name');
    expect(ws.snapshot().name).toBe('New name');
    expect(() => ws.rename('x'.repeat(121))).toThrow(InvalidWorkspaceError);
  });
});

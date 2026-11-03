import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { OwnershipService } from '../application/ownership.service.js';
import type { CrmStore, CrmTx } from '../application/ports/crm-store.js';

/** `contactsCreated` for owner reports (T-172): totals the per-source counts of the store. */
describe('OwnershipService.contactsCreated', () => {
  it('sums the per-source counts and passes the period through', async () => {
    const createdBySource = vi.fn(async () => [
      { source: 'Facebook', count: 3 },
      { source: null, count: 1 },
    ]);
    const tx = { contacts: { createdBySource } } as unknown as CrmTx;
    const store: CrmStore = { run: async (_ws, fn) => fn(tx) };
    const service = new OwnershipService(store);
    const q = { since: new Date('2026-11-01T17:00:00Z'), until: new Date('2026-11-02T17:00:00Z') };
    expect(await service.contactsCreated(workspaceId(newId()), q)).toEqual({
      count: 4,
      bySource: [
        { source: 'Facebook', count: 3 },
        { source: null, count: 1 },
      ],
    });
    expect(createdBySource).toHaveBeenCalledWith(q);
  });
});

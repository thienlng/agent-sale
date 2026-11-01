import { describe, expect, it } from 'vitest';

import { newId, workspaceId } from '@agent-sales/shared';
import type { IntegrationStore } from '../application/ports/integration-store.js';
import { IntegrationUnavailableError } from '../domain/integration.errors.js';
import { UnavailableIntegrationStore } from '../infrastructure/persistence/unavailable-store.js';

describe('UnavailableIntegrationStore', () => {
  it('answers every call with UNAVAILABLE', async () => {
    const store: IntegrationStore = new UnavailableIntegrationStore();
    await expect(store.claimJobs(1, 1000)).rejects.toBeInstanceOf(IntegrationUnavailableError);
    await expect(store.liveConnection(workspaceId(newId()), 'kiotviet')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});

import type { WorkspaceId } from '@agent-sales/shared';

import type { ContactSyncFacade } from '../../crm/api/index.js';
import { ConnectionVersionConflictError } from '../domain/integration.errors.js';
import { SOURCE } from './catalog-writer.js';
import type { IntegrationStore } from './ports/integration-store.js';

/**
 * KiotViet refused the customer API (403: the API account lacks the customer permission). Customer
 * sync alone stops: `settings.syncCustomers` turns off, claimed customers go back to unclaimed, and
 * `customers_permission_missing` is logged once (only the call that turns the switch off logs). The
 * connection stays as it is, so the catalog and order push go on. The settings write is an owner
 * field and bumps `version` (an owner save racing it answers 409 and reloads); it is made against
 * the version just read, so it never overwrites an owner edit.
 */
export async function disableCustomerSync(
  store: IntegrationStore,
  contacts: ContactSyncFacade,
  ws: WorkspaceId,
  connectionId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await store.connectionForSystem(connectionId);
    if (!latest || latest.status === 'disconnected' || !latest.settings.syncCustomers) return;
    try {
      await store.updateConnection(
        ws,
        connectionId,
        { settings: { ...latest.settings, syncCustomers: false } },
        latest.version,
      );
    } catch (error) {
      if (error instanceof ConnectionVersionConflictError) continue;
      throw error;
    }
    await contacts.releasePendingContactPushes(ws, SOURCE);
    await store.log(ws, connectionId, { level: 'warning', code: 'customers_permission_missing' });
    return;
  }
}

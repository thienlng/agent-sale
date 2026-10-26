import { type Database, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { CrmStore, CrmTx } from '../../application/ports/crm-store.js';
import { contactsTx } from './contacts.drizzle.js';
import { crmSettingsTx } from './crm-settings.drizzle.js';
import { policiesTx } from './policies.drizzle.js';

/** One withTenant transaction per use case; RLS scopes every statement to the workspace. */
export class DrizzleCrmStore implements CrmStore {
  constructor(private readonly db: Database) {}

  run<T>(workspaceId: WorkspaceId, fn: (tx: CrmTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, workspaceId, (tx) =>
      fn({
        ...contactsTx(workspaceId, tx),
        ...crmSettingsTx(workspaceId, tx),
        ...policiesTx(workspaceId, tx),
      } satisfies CrmTx),
    );
  }
}

import { type Database, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { CommerceStore, CommerceTx } from '../../application/ports/commerce-store.js';
import { catalogTx } from './catalog.drizzle.js';
import { ordersTx } from './orders.drizzle.js';

/** One withTenant transaction per use case; RLS scopes every statement to the workspace. */

export class DrizzleCommerceStore implements CommerceStore {
  constructor(private readonly db: Database) {}

  run<T>(workspaceId: WorkspaceId, fn: (tx: CommerceTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, workspaceId, (tx) =>
      fn({ ...catalogTx(workspaceId, tx), ...ordersTx(workspaceId, tx) } satisfies CommerceTx),
    );
  }
}

import { and, eq, inArray, schema, withSystem, type Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';

import type { KiotVietDelivery, KiotVietIngressStore } from '../kiotviet.js';

/** Resolves the connection by its path token and stores the delivery once, as the system DB role. */
export class DrizzleKiotVietIngressStore implements KiotVietIngressStore {
  constructor(private readonly db: Database) {}

  async store(
    token: string,
    delivery: KiotVietDelivery,
  ): Promise<'stored' | 'duplicate' | 'unknown'> {
    return withSystem(this.db, async (tx) => {
      const c = schema.integrationConnections;
      const [connection] = await tx
        .select({ id: c.id, workspaceId: c.workspaceId })
        .from(c)
        // Every live status keeps ingesting; only a disconnected connection is a dead URL.
        .where(
          and(eq(c.webhookToken, token), inArray(c.status, ['connected', 'syncing', 'error'])),
        );
      if (!connection) return 'unknown';
      const rows = await tx
        .insert(schema.integrationWebhookEvents)
        .values({
          id: newId(),
          workspaceId: connection.workspaceId,
          connectionId: connection.id,
          deliveryId: delivery.deliveryId,
          body: delivery.body,
          signature: delivery.signature,
        })
        .onConflictDoNothing()
        .returning({ id: schema.integrationWebhookEvents.id });
      return rows.length > 0 ? 'stored' : 'duplicate';
    });
  }
}

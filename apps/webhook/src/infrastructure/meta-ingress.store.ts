import { newId } from '@agent-sales/shared';
import type { ChannelKind, NormalizedEvent } from '@agent-sales/channels';
import { and, eq, schema, withSystem, type Database } from '@agent-sales/db';
import type { IngressStore } from '../server.js';
/** Verified provider asset identity is resolved using the restricted system DB role. */
export class MetaIngressStore implements IngressStore {
  constructor(private readonly db: Database) {}
  async storeOnce(
    kind: ChannelKind,
    _id: string,
    _raw: unknown,
    event?: NormalizedEvent,
  ): Promise<boolean> {
    if (!event) throw new Error('Normalized event required');
    return withSystem(this.db, async (tx) => {
      const [connection] = await tx
        .select()
        .from(schema.channelConnections)
        .where(
          and(
            eq(schema.channelConnections.provider, kind),
            eq(schema.channelConnections.externalId, event.assetExternalId),
            eq(schema.channelConnections.status, 'connected'),
          ),
        );
      if (!connection) return false;
      const rows = await tx
        .insert(schema.channelWebhookEvents)
        .values({
          id: newId(),
          workspaceId: connection.workspaceId,
          connectionId: connection.id,
          externalId: event.externalEventId,
          payload: { ...event, raw: undefined },
        })
        .onConflictDoNothing()
        .returning({ id: schema.channelWebhookEvents.id });
      return rows.length > 0;
    });
  }
}

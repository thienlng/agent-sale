import { and, eq, schema, sql, withTenant, type Database } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ConnectionRecord, OAuthFlow } from '../../application/ports/channel-store.js';
import { ChannelError } from '../../domain/channel.errors.js';
import { connection, flow } from './record-mappers.js';
import { reviveOwnRemoved } from './revive-removed.js';

const c = schema.channelConnections,
  f = schema.channelOauthFlows;

export function findDiscovery(
  db: Database,
  ws: WorkspaceId,
  userId: string,
  id: string,
): Promise<OAuthFlow | null> {
  return withTenant(db, ws, async (tx) => {
    const [r] = await tx
      .select()
      .from(f)
      .where(
        and(
          eq(f.workspaceId, ws),
          eq(f.id, id),
          eq(f.userId, userId),
          sql`${f.expiresAt}>now()`,
          sql`${f.accountsSealed} is not null`,
          sql`${f.consumedAt} is null`,
        ),
      );
    return r ? flow(r) : null;
  });
}

export function selectDiscoveredAccounts(
  db: Database,
  ws: WorkspaceId,
  userId: string,
  id: string,
  accounts: ConnectionRecord[],
): Promise<ConnectionRecord[]> {
  return withTenant(db, ws, async (tx) => {
    const [d] = await tx
      .update(f)
      // The discovery held tokens for every granted page; drop them once the choice is made
      // so pages the user did not connect leave no credentials behind.
      .set({ consumedAt: new Date(), accountsSealed: null })
      .where(
        and(
          eq(f.workspaceId, ws),
          eq(f.id, id),
          eq(f.userId, userId),
          sql`${f.expiresAt}>now()`,
          sql`${f.consumedAt} is null`,
        ),
      )
      .returning();
    if (!d) throw new ChannelError('NOT_FOUND', 'Discovery expired or already consumed');
    const result: ConnectionRecord[] = [];
    for (const a of accounts) {
      const revived = await reviveOwnRemoved(tx, ws, a);
      if (revived === 'conflict')
        throw new ChannelError('CONFLICT', 'This account is connected to another workspace');
      const row =
        revived ??
        // Only live rows are unique (0034): a removed row of another business does not block.
        (
          await tx
            .insert(c)
            .values({
              ...a,
              expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
              createdAt: new Date(a.createdAt),
            })
            .onConflictDoUpdate({
              target: [c.provider, c.externalId],
              targetWhere: sql`${c.status} <> 'removed'`,
              set: {
                tokenSealed: a.tokenSealed,
                status: 'connected',
                name: a.name,
                expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
              },
              setWhere: eq(c.workspaceId, ws),
            })
            .returning()
        )[0];
      if (!row)
        throw new ChannelError('CONFLICT', 'This account is connected to another workspace');
      result.push(connection(row));
    }
    return result;
  });
}

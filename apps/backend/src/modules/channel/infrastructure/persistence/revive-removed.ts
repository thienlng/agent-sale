import { and, eq, schema, type withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ConnectionRecord } from '../../application/ports/channel-store.js';

const c = schema.channelConnections;
type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];
/**
 * Connecting a page the workspace removed earlier restores that row (same id, so its history stays
 * attached) instead of inserting a second one. Returns null when the workspace has a live row or
 * no removed row (the plain upsert handles it) and 'conflict' when another business holds the page.
 */
export async function reviveOwnRemoved(
  tx: Tx,
  ws: WorkspaceId,
  a: ConnectionRecord,
): Promise<typeof c.$inferSelect | 'conflict' | null> {
  const own = await tx
    .select({ id: c.id, status: c.status })
    .from(c)
    .where(and(eq(c.workspaceId, ws), eq(c.provider, a.provider), eq(c.externalId, a.externalId)));
  if (own.some((r) => r.status !== 'removed')) return null;
  const removed = own[0];
  if (!removed) return null;
  try {
    // A savepoint: the unique index rejects the revival when another business holds the live row.
    return await tx.transaction(async (sp) => {
      const [r] = await sp
        .update(c)
        .set({
          tokenSealed: a.tokenSealed,
          status: 'connected',
          name: a.name,
          expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
        })
        .where(and(eq(c.workspaceId, ws), eq(c.id, removed.id)))
        .returning();
      return r ?? null;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return 'conflict';
    throw err;
  }
}
function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(err) === '23505' || code((err as { cause?: unknown } | null)?.cause) === '23505';
}

import { and, type Database, eq, isNull, schema, sql, withTenant } from '@agent-sales/db';
import { newId, type WorkspaceId } from '@agent-sales/shared';

const j = schema.integrationJobs;

/**
 * Queues a `customer_import` job unless one is open for the connection with the same
 * `payload.contactId` (none: the customer import). No index enforces it (the kind check predates
 * PR 3), so an advisory lock on the pair serializes the check and the insert. False when queued
 * already.
 */
export function enqueueCustomerJob(
  db: Database,
  ws: WorkspaceId,
  job: { connectionId: string; payload?: Record<string, unknown>; runAfter?: Date },
): Promise<boolean> {
  const payload = job.payload ?? {};
  const contactId = typeof payload['contactId'] === 'string' ? payload['contactId'] : '';
  const key = `integration/customer_import/${job.connectionId}/${contactId}`;
  return withTenant(db, ws, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [open] = await tx
      .select({ id: j.id })
      .from(j)
      .where(
        and(
          eq(j.connectionId, job.connectionId),
          eq(j.kind, 'customer_import'),
          isNull(j.doneAt),
          isNull(j.failedAt),
          sql`coalesce(${j.payload} ->> 'contactId', '') = ${contactId}`,
        ),
      )
      .limit(1);
    if (open) return false;
    await tx.insert(j).values({
      id: newId(),
      workspaceId: ws,
      connectionId: job.connectionId,
      kind: 'customer_import',
      payload,
      ...(job.runAfter ? { runAfter: job.runAfter } : {}),
    });
    return true;
  });
}

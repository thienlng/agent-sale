import { and, asc, eq, inArray, isNull, schema, sql, type TenantTx } from '@agent-sales/db';

import { ContactExternalLinkConflictError } from '../../api/contact-sync.facade.js';
import type { CrmTx } from '../../application/ports/crm-store.js';
import { pgCode, toContact } from './contacts.drizzle.js';

const c = schema.contacts;

/** PMS link and push columns of contacts (ADR-017, migration 0051). */
export function contactSyncTx(tx: TenantTx): Pick<CrmTx, 'contactSync'> {
  return {
    contactSync: {
      async findByExternal(source, externalId) {
        const [r] = await tx
          .select()
          .from(c)
          .where(and(eq(c.externalSource, source), eq(c.externalId, externalId)))
          .limit(1)
          .for('update');
        return r ? toContact(r) : null;
      },
      async findUnlinkedByPhone(phoneNormalized) {
        const [r] = await tx
          .select()
          .from(c)
          .where(
            and(eq(c.phoneNormalized, phoneNormalized), isNull(c.externalId), isNull(c.archivedAt)),
          )
          .orderBy(asc(c.createdAt), asc(c.id))
          .limit(1)
          .for('update');
        return r ? toContact(r) : null;
      },
      async setLink(contactId, link) {
        try {
          await tx
            .update(c)
            .set(
              link
                ? {
                    externalSource: link.source,
                    externalId: link.id,
                    externalPushState: null,
                    externalPushAt: null,
                    externalPushError: null,
                  }
                : { externalSource: null, externalId: null },
            )
            .where(eq(c.id, contactId));
        } catch (e) {
          const constraint = (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
          if (pgCode(e) === '23505' && constraint === 'contacts_external')
            throw new ContactExternalLinkConflictError();
          throw e;
        }
      },
      async unlink(source, externalIds, at) {
        if (externalIds && !externalIds.length) return [];
        // The CTE keeps the old external id for the caller's history entries.
        const rows = await tx.execute<{ id: string; external_id: string }>(sql`
          with old as (
            select id, external_id from ${c}
            where external_source = ${source}
              ${
                externalIds
                  ? sql`and external_id in (${sql.join(
                      externalIds.map((x) => sql`${x}`),
                      sql`, `,
                    )})`
                  : sql``
              }
            for update
          )
          update ${c} set external_source = null, external_id = null,
            version = ${c}.version + 1, updated_at = ${at.toISOString()}
          from old where ${c}.id = old.id
          returning ${c}.id as id, old.external_id as external_id`);
        return rows.map((r) => ({ id: r.id, externalId: r.external_id }));
      },
      async claim(since, limit, at) {
        // SKIP LOCKED: two scans at once take disjoint rows, so no customer is claimed twice.
        const ids = await tx.execute<{ id: string }>(sql`
          update ${c} set external_push_state = 'pending', external_push_at = ${at.toISOString()},
            external_push_error = null
          where ${c.id} in (
            select ${c.id} from ${c}
            where ${c.externalId} is null and ${c.externalPushState} is null
              and ${c.archivedAt} is null and ${c.phoneNormalized} is not null
              and ${c.createdAt} >= ${since.toISOString()}
            order by ${c.createdAt}, ${c.id}
            limit ${limit}
            for update skip locked
          )
          returning ${c.id} as id`);
        if (!ids.length) return [];
        const rows = await tx
          .select()
          .from(c)
          .where(
            inArray(
              c.id,
              ids.map((r) => r.id),
            ),
          )
          .orderBy(asc(c.createdAt), asc(c.id));
        return rows.map(toContact);
      },
      async markFailed(contactId, code) {
        const rows = await tx
          .update(c)
          .set({ externalPushState: 'failed', externalPushError: code })
          .where(and(eq(c.id, contactId), eq(c.externalPushState, 'pending')))
          .returning({ id: c.id });
        return rows.length === 1;
      },
      async releasePending(olderThan) {
        const rows = await tx
          .update(c)
          .set({ externalPushState: null, externalPushAt: null, externalPushError: null })
          .where(
            and(
              eq(c.externalPushState, 'pending'),
              olderThan ? sql`${c.externalPushAt} < ${olderThan.toISOString()}` : undefined,
            ),
          )
          .returning({ id: c.id });
        return rows.length;
      },
      async clearPushStates() {
        const rows = await tx
          .update(c)
          .set({ externalPushState: null, externalPushAt: null, externalPushError: null })
          .where(sql`${c.externalPushState} is not null`)
          .returning({ id: c.id });
        return rows.length;
      },
      async releaseFailed() {
        const rows = await tx
          .update(c)
          .set({ externalPushState: null, externalPushAt: null, externalPushError: null })
          .where(eq(c.externalPushState, 'failed'))
          .returning({ id: c.id });
        return rows.length;
      },
      async pendingPush(contactId) {
        const [r] = await tx
          .select()
          .from(c)
          .where(
            and(
              eq(c.id, contactId),
              eq(c.externalPushState, 'pending'),
              isNull(c.externalId),
              isNull(c.archivedAt),
            ),
          )
          .limit(1);
        return r ? toContact(r) : null;
      },
      async stalePending(since, olderThan, limit) {
        const rows = await tx
          .select({ id: c.id })
          .from(c)
          .where(
            and(
              eq(c.externalPushState, 'pending'),
              // An archived or phone-less customer cannot be pushed: never re-queued.
              isNull(c.archivedAt),
              sql`${c.phoneNormalized} is not null`,
              sql`${c.createdAt} >= ${since.toISOString()}`,
              sql`${c.externalPushAt} < ${olderThan.toISOString()}`,
            ),
          )
          .orderBy(asc(c.externalPushAt), asc(c.id))
          .limit(limit);
        return rows.map((r) => r.id);
      },
      async countLinked(source) {
        const [r] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(c)
          .where(eq(c.externalSource, source));
        return Number(r?.n ?? 0);
      },
      async externalIdOf(source, contactId) {
        const [r] = await tx
          .select({ id: c.externalId })
          .from(c)
          .where(and(eq(c.id, contactId), eq(c.externalSource, source)))
          .limit(1);
        return r?.id ?? null;
      },
    },
  };
}

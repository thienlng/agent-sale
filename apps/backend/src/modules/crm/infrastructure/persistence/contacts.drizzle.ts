import { and, asc, desc, eq, inArray, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import { REQUEST_HISTORY_TYPES } from '@agent-sales/contracts';

import type {
  ContactRecord,
  CrmTx,
  HistoryRecord,
  NoteRecord,
  OpenRequestRecord,
} from '../../application/ports/crm-store.js';
import { ContactExternalLinkConflictError } from '../../api/contact-sync.facade.js';
import { DuplicateContactRequestError } from '../../domain/crm.errors.js';
import { compileContactOrder, compileContactWhere } from './contact-filter.sql.js';

const c = schema.contacts;
const notes = schema.contactNotes;
const h = schema.contactHistory;
const st = schema.crmStatuses;
const REQUEST_TYPES = [...REQUEST_HISTORY_TYPES];

type ContactRow = typeof c.$inferSelect;

export const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;

export function toContact(r: ContactRow): ContactRecord {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    phoneNormalized: r.phoneNormalized,
    email: r.email,
    emailNormalized: r.emailNormalized,
    birthday: r.birthday,
    gender: r.gender as ContactRecord['gender'],
    address: r.address,
    province: r.province,
    ward: r.ward,
    phoneProvidedAt: r.phoneProvidedAt,
    addressProvidedAt: r.addressProvidedAt,
    sourceId: r.sourceId,
    firstSourceId: r.firstSourceId,
    statusId: r.statusId,
    salesUserId: r.salesUserId,
    careUserId: r.careUserId,
    adRef: r.adRef,
    profileNote: r.profileNote,
    searchText: r.searchText,
    clientRequestId: r.clientRequestId,
    externalSource: r.externalSource,
    externalId: r.externalId,
    version: r.version,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Contacts, their notes and their history inside one tenant transaction. */
export function contactsTx(
  ws: WorkspaceId,
  tx: TenantTx,
): Pick<CrmTx, 'contacts' | 'notes' | 'history'> {
  return {
    contacts: {
      async insert(rec) {
        try {
          await tx.insert(c).values({ ...rec, workspaceId: ws });
        } catch (e) {
          const constraint = (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
          if (pgCode(e) === '23505' && constraint === 'contacts_external')
            throw new ContactExternalLinkConflictError();
          if (pgCode(e) === '23505' && rec.clientRequestId)
            throw new DuplicateContactRequestError();
          throw e;
        }
      },
      async update(rec, expectedVersion) {
        // The PMS link changes only through `contactSync`, never with a profile edit.
        const {
          id,
          createdAt: _created,
          externalSource: _source,
          externalId: _external,
          ...rest
        } = rec;
        const rows = await tx
          .update(c)
          .set(rest)
          .where(and(eq(c.id, id), eq(c.version, expectedVersion)))
          .returning({ id: c.id });
        return rows.length === 1;
      },
      async find(id, opts) {
        const q = tx.select().from(c).where(eq(c.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toContact(r) : null;
      },
      async findByRequestId(requestId) {
        const [r] = await tx.select().from(c).where(eq(c.clientRequestId, requestId)).limit(1);
        return r ? toContact(r) : null;
      },
      async findByPhone(phoneNormalized) {
        const [r] = await tx
          .select()
          .from(c)
          .where(eq(c.phoneNormalized, phoneNormalized))
          .orderBy(asc(c.createdAt), asc(c.id))
          .limit(1);
        return r ? toContact(r) : null;
      },
      async recordBot(contactId, botId, at) {
        await tx
          .insert(schema.contactBots)
          .values({ workspaceId: ws, contactId, botId, firstSeenAt: at })
          .onConflictDoNothing();
      },
      async countByStatus() {
        const rows = await tx
          .select({ statusId: c.statusId, count: sql<number>`count(*)::int` })
          .from(c)
          .where(and(eq(c.workspaceId, ws), sql`${c.archivedAt} is null`))
          .groupBy(c.statusId);
        return rows.map((r) => ({ statusId: r.statusId, count: Number(r.count) }));
      },
      async createdBySource({ since, until }) {
        const src = schema.crmSources;
        const rows = await tx
          .select({ source: src.name, count: sql<number>`count(*)::int` })
          .from(c)
          .leftJoin(
            src,
            and(
              eq(src.id, sql`coalesce(${c.firstSourceId}, ${c.sourceId})`),
              eq(src.workspaceId, ws),
            ),
          )
          .where(
            and(
              eq(c.workspaceId, ws),
              sql`${c.archivedAt} is null`,
              sql`${c.createdAt} >= ${since.toISOString()}::timestamptz`,
              sql`${c.createdAt} < ${until.toISOString()}::timestamptz`,
            ),
          )
          .groupBy(src.name);
        return rows
          .map((r) => ({ source: r.source ?? null, count: Number(r.count) }))
          .sort((a, b) => b.count - a.count || (a.source ?? '').localeCompare(b.source ?? ''));
      },
      async countOwnedBy(userId) {
        const [r] = await tx
          .select({
            sales: sql<number>`count(*) filter (where ${c.salesUserId} = ${userId})`,
            care: sql<number>`count(*) filter (where ${c.careUserId} = ${userId})`,
          })
          .from(c);
        return { sales: Number(r?.sales ?? 0), care: Number(r?.care ?? 0) };
      },
      async namesOf(ids) {
        if (!ids.length) return new Map();
        const rows = await tx
          .select({ id: c.id, name: c.name })
          .from(c)
          .where(inArray(c.id, [...ids]));
        return new Map(rows.map((r) => [r.id, r.name]));
      },
      async reassignOwner(role, from, to, at) {
        const column = role === 'sales' ? c.salesUserId : c.careUserId;
        const rows = await tx
          .update(c)
          .set({
            ...(role === 'sales' ? { salesUserId: to } : { careUserId: to }),
            version: sql`${c.version} + 1`,
            updatedAt: at,
          })
          .where(eq(column, from))
          .returning({ id: c.id });
        return rows.map((r) => r.id);
      },
      async query(q) {
        const where = compileContactWhere(q);
        const [rows, [count]] = await Promise.all([
          tx
            .select()
            .from(c)
            .where(where)
            .orderBy(compileContactOrder(q.sort))
            .offset(q.offset)
            .limit(q.limit),
          tx
            .select({ n: sql<number>`count(*)` })
            .from(c)
            .where(where),
        ]);
        return { rows: rows.map(toContact), total: Number(count?.n ?? 0) };
      },
    },

    notes: {
      async list(contactId) {
        const rows = await tx
          .select()
          .from(notes)
          .where(eq(notes.contactId, contactId))
          .orderBy(desc(notes.createdAt), desc(notes.id));
        return rows.map((r): NoteRecord => ({ ...r }));
      },
      async find(id, opts) {
        const q = tx.select().from(notes).where(eq(notes.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? { ...r } : null;
      },
      async insert(n) {
        await tx.insert(notes).values({ ...n, workspaceId: ws });
      },
      async update(n) {
        await tx
          .update(notes)
          .set({ body: n.body, version: n.version, editedAt: n.editedAt })
          .where(eq(notes.id, n.id));
      },
    },

    history: {
      async add(entry) {
        await tx.insert(h).values({ ...entry, workspaceId: ws });
      },
      async latestRequestEntry(contactId, kind, since) {
        const [r] = await tx
          .select()
          .from(h)
          .where(
            and(
              eq(h.contactId, contactId),
              inArray(h.type, REQUEST_TYPES),
              sql`${h.data}->>'kind' = ${kind}`,
              sql`${h.createdAt} >= ${since.toISOString()}::timestamptz`,
            ),
          )
          .orderBy(desc(h.createdAt), desc(h.id))
          .limit(1);
        return r ? { ...r } : null;
      },
      async requestEntries(contactId, limit) {
        const rows = await tx
          .select()
          .from(h)
          .where(and(eq(h.contactId, contactId), inArray(h.type, REQUEST_TYPES)))
          .orderBy(desc(h.createdAt), desc(h.id))
          .limit(limit);
        return rows.map((r): HistoryRecord => ({ ...r }));
      },
      async requestCounts(since, until) {
        const kind = sql<string>`${h.data}->>'kind'`;
        const rows = await tx
          .select({
            kind,
            statusKey: st.key,
            statusName: st.name,
            count: sql<number>`count(*)::int`,
          })
          .from(h)
          .innerJoin(c, and(eq(c.id, h.contactId), eq(c.workspaceId, ws)))
          .leftJoin(st, and(eq(st.id, c.statusId), eq(st.workspaceId, ws)))
          .where(
            and(
              eq(h.workspaceId, ws),
              eq(h.type, 'contact.request_recorded'),
              sql`${c.archivedAt} is null`,
              sql`${h.createdAt} >= ${since.toISOString()}::timestamptz`,
              sql`${h.createdAt} < ${until.toISOString()}::timestamptz`,
            ),
          )
          .groupBy(kind, st.key, st.name);
        return rows.map((r) => ({
          kind: r.kind,
          statusKey: r.statusKey ?? null,
          statusName: r.statusName ?? null,
          count: Number(r.count),
        }));
      },
      async openRequests({ since, targets, limit }) {
        if (!targets.length) return [];
        const pairs = sql.join(
          targets.map((t) => sql`(${t.kind}, ${t.statusKey})`),
          sql`, `,
        );
        const rows = await tx.execute<{
          id: string;
          contact_id: string;
          type: string;
          changes: Record<string, { from: unknown; to: unknown }>;
          data: Record<string, unknown>;
          actor_user_id: string | null;
          actor_name: string | null;
          created_at: string | Date;
          contact_name: string | null;
          status_key: string | null;
        }>(sql`
          select latest.*, ct.name as contact_name, s.key as status_key
          from (
            select distinct on (ch.contact_id) ch.id, ch.contact_id, ch.type, ch.changes, ch.data,
              ch.actor_user_id, ch.actor_name, ch.created_at
            from contact_history ch
            where ch.workspace_id = ${ws}
              and ch.type in ('contact.request_recorded', 'contact.request_updated')
              and ch.created_at >= ${since.toISOString()}::timestamptz
            order by ch.contact_id, ch.created_at desc, ch.id desc
          ) latest
          join contacts ct on ct.id = latest.contact_id and ct.workspace_id = ${ws}
            and ct.archived_at is null
          join crm_statuses s on s.id = ct.status_id and s.workspace_id = ${ws}
          where (latest.data->>'kind', s.key) in (${pairs})
          order by latest.created_at desc, latest.id desc
          limit ${limit}`);
        return [...rows].map((r): OpenRequestRecord => ({
          id: r.id,
          contactId: r.contact_id,
          type: r.type,
          changes: r.changes,
          data: r.data,
          actorUserId: r.actor_user_id,
          actorName: r.actor_name,
          createdAt: new Date(r.created_at),
          contactName: r.contact_name,
          statusKey: r.status_key,
        }));
      },
      async addMany(entries) {
        for (let i = 0; i < entries.length; i += 500) {
          await tx
            .insert(h)
            .values(entries.slice(i, i + 500).map((e) => ({ ...e, workspaceId: ws })));
        }
      },
      async list(contactId, f) {
        const rows = await tx
          .select()
          .from(h)
          .where(
            and(
              eq(h.contactId, contactId),
              f.type ? eq(h.type, f.type) : undefined,
              f.from ? sql`${h.createdAt} >= ${f.from.toISOString()}` : undefined,
              f.to ? sql`${h.createdAt} < ${f.to.toISOString()}` : undefined,
            ),
          )
          .orderBy(
            f.order === 'asc' ? asc(h.createdAt) : desc(h.createdAt),
            f.order === 'asc' ? asc(h.id) : desc(h.id),
          )
          .limit(f.limit);
        return rows.map((r): HistoryRecord => ({ ...r }));
      },
    },
  };
}

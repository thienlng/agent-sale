import { and, asc, desc, eq, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  ContactRecord,
  CrmTx,
  HistoryRecord,
  NoteRecord,
} from '../../application/ports/crm-store.js';
import { DuplicateContactRequestError } from '../../domain/crm.errors.js';
import { compileContactOrder, compileContactWhere } from './contact-filter.sql.js';

const c = schema.contacts;
const notes = schema.contactNotes;
const h = schema.contactHistory;

type ContactRow = typeof c.$inferSelect;

const pgCode = (e: unknown): string | undefined =>
  (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code;

function toContact(r: ContactRow): ContactRecord {
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
          if (pgCode(e) === '23505' && rec.clientRequestId)
            throw new DuplicateContactRequestError();
          throw e;
        }
      },
      async update(rec, expectedVersion) {
        const { id, createdAt: _created, ...rest } = rec;
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
      async countOwnedBy(userId) {
        const [r] = await tx
          .select({
            sales: sql<number>`count(*) filter (where ${c.salesUserId} = ${userId})`,
            care: sql<number>`count(*) filter (where ${c.careUserId} = ${userId})`,
          })
          .from(c);
        return { sales: Number(r?.sales ?? 0), care: Number(r?.care ?? 0) };
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

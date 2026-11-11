import { and, asc, desc, eq, isNull, lt, or, schema, sql, type TenantTx } from '@agent-sales/db';

import type { CrmTx, TaskFilter } from '../../application/ports/crm-store.js';
import type { Task } from '../../domain/task.js';

const t = schema.tasks;
const c = schema.contacts;

const toTask = (r: typeof t.$inferSelect): Task => ({
  id: r.id,
  title: r.title,
  note: r.note,
  dueAt: r.dueAt,
  assigneeUserId: r.assigneeUserId,
  status: r.status,
  doneAt: r.doneAt,
  doneBy: r.doneBy,
  contactId: r.contactId,
  conversationId: r.conversationId,
  subjectType: r.subjectType,
  subjectId: r.subjectId,
  source: r.source,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  version: r.version,
});

const writable = (rec: Task) => ({
  title: rec.title,
  note: rec.note,
  dueAt: rec.dueAt,
  assigneeUserId: rec.assigneeUserId,
  status: rec.status,
  doneAt: rec.doneAt,
  doneBy: rec.doneBy,
  updatedAt: rec.updatedAt,
  version: rec.version,
});

/** The customer of the task is one `me` may see: their Sales or CSKH, or nobody's (`canSee`). */
const customerVisible = (me: string) =>
  or(
    isNull(t.contactId),
    sql`exists (select 1 from ${c}
      where ${c.workspaceId} = ${t.workspaceId} and ${c.id} = ${t.contactId}
        and (${c.salesUserId} = ${me} or ${c.careUserId} = ${me}
          or (${c.salesUserId} is null and ${c.careUserId} is null)))`,
  );

const inScope = (f: Pick<TaskFilter, 'assigneeScope' | 'customerScope'>) =>
  f.assigneeScope === null
    ? undefined
    : or(
        eq(t.assigneeUserId, f.assigneeScope),
        and(
          isNull(t.assigneeUserId),
          f.customerScope ? customerVisible(f.customerScope) : undefined,
        ),
      );

function where(f: TaskFilter) {
  return and(
    inScope(f),
    f.status === 'done' ? eq(t.status, 'done') : undefined,
    f.status === 'open' ? eq(t.status, 'open') : undefined,
    f.status === 'overdue' ? and(eq(t.status, 'open'), lt(t.dueAt, f.now)) : undefined,
    f.contactId ? eq(t.contactId, f.contactId) : undefined,
    f.conversationId ? eq(t.conversationId, f.conversationId) : undefined,
  );
}

/** Tasks inside one tenant transaction (RLS scopes every statement to the workspace). */
export function tasksTx(tx: TenantTx): Pick<CrmTx, 'tasks'> {
  return {
    tasks: {
      async insert(ws, rec) {
        await tx.insert(t).values({ ...rec, workspaceId: ws });
      },
      async find(id, opts) {
        const q = tx.select().from(t).where(eq(t.id, id)).limit(1);
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toTask(r) : null;
      },
      async update(rec, expectedVersion) {
        const rows = await tx
          .update(t)
          .set({
            ...writable(rec),
            // A new due time or assignee is reminded again (SET reads the row before the update).
            remindedAt: sql`case
              when ${t.dueAt} is distinct from ${rec.dueAt?.toISOString() ?? null}::timestamptz
                or ${t.assigneeUserId} is distinct from ${rec.assigneeUserId}::uuid
              then null else ${t.remindedAt} end`,
          })
          .where(and(eq(t.id, rec.id), eq(t.version, expectedVersion)))
          .returning({ id: t.id });
        return rows.length > 0;
      },
      async list(f, page) {
        const order =
          f.status === 'done'
            ? [desc(t.doneAt), desc(t.id)]
            : [sql`${t.dueAt} asc nulls last`, asc(t.createdAt), asc(t.id)];
        const rows = await tx
          .select()
          .from(t)
          .where(where(f))
          .orderBy(...order)
          .offset(page.offset)
          .limit(page.limit);
        return rows.map(toTask);
      },
      async countOpenDueBefore(scope, dueBefore) {
        const [r] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(t)
          .where(and(inScope(scope), eq(t.status, 'open'), lt(t.dueAt, dueBefore)));
        return Number(r?.n ?? 0);
      },
    },
  };
}

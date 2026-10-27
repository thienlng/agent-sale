import {
  and,
  desc,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  schema,
  sql,
  withTenant,
  writeOutbox,
  type Database,
  type SQL,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import { ConversationDto, InboxMessageDto, type ConversationView } from '@agent-sales/contracts';
import type {
  ConversationStore,
  ConversationTx,
} from '../../application/ports/conversation-store.js';
import { ConversationError } from '../../domain/conversation.errors.js';
import {
  effectiveSort,
  type ConversationFilter,
  type ConversationPage,
} from '../../domain/conversation-filter.js';
const c = schema.conversations,
  m = schema.conversationMessages;
type Row = typeof c.$inferSelect;
/** `data` is the document; rows written before migration 0024 may lack `createdAt`. */
const toView = (r: Row): ConversationView =>
  ConversationDto.parse({ ...r.data, createdAt: r.data.createdAt ?? r.createdAt.toISOString() });
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
/** Open and waiting; a resolved conversation keeps `awaiting_since` but is not waiting. */
const waitingNow = sql`(${c.awaitingSince} is not null and ${c.status} = 'open')`;
/** One array parameter instead of one per id (Postgres allows 65535 parameters per statement). */
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const date = (iso: string | null): Date | null => (iso ? new Date(iso) : null);
/** Every condition except the tab; counts use exactly these. */
function baseConditions(ws: WorkspaceId, f: ConversationFilter): SQL[] {
  const where: SQL[] = [eq(c.workspaceId, ws)];
  if (f.provider) where.push(sql`${c.data}->>'provider' = ${f.provider}`);
  if (f.status) where.push(eq(c.status, f.status));
  // Document fields without an index column: the other conditions narrow the rows first.
  if (f.starred !== undefined)
    where.push(sql`coalesce((${c.data}->>'starred')::boolean, false) = ${f.starred}`);
  if (f.followUp !== undefined)
    where.push(
      f.followUp
        ? sql`${c.data}->>'followUpAt' is not null`
        : sql`${c.data}->>'followUpAt' is null`,
    );
  if (f.mode) where.push(eq(c.mode, f.mode));
  if (f.channelId) where.push(eq(c.channelId, f.channelId));
  if (f.assignee === 'none') where.push(isNull(c.assigneeId));
  else if (f.assignee) where.push(eq(c.assigneeId, f.assignee));
  if (f.hasPhone !== undefined)
    where.push(f.hasPhone ? isNotNull(c.customerPhone) : isNull(c.customerPhone));
  if (f.waiting) {
    where.push(waitingNow);
    if (f.waiting === 'readNotReplied') where.push(eq(c.unreadCount, 0));
  }
  if (f.idsIn) where.push(sql`${c.id} = any(${uuidArray(f.idsIn)})`);
  if (f.idsNotIn?.length) where.push(sql`${c.id} <> all(${uuidArray(f.idsNotIn)})`);
  if (f.q) {
    const pattern = likePattern(f.q);
    where.push(
      sql`(${c.data}->>'customerName' ilike ${pattern} or ${c.customerId} ilike ${pattern} or ${c.customerPhone} ilike ${pattern} or ${c.data}->>'lastMessage' ilike ${pattern})`,
    );
  }
  return where;
}
/** The index columns follow the document on every write. */
const indexColumns = (d: ConversationView) => ({
  updatedAt: new Date(d.updatedAt),
  unreadCount: d.unreadCount,
  awaitingSince: date(d.awaitingSince),
  lastReadAt: date(d.lastReadAt),
  assigneeId: d.assigneeId,
  mode: d.mode,
  status: d.status,
  customerPhone: d.customerPhone,
});
export class DrizzleConversationStore implements ConversationStore {
  constructor(private readonly db: Database) {}
  run<T>(ws: WorkspaceId, fn: (tx: ConversationTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) =>
      fn({
        async lockPeer(channelId, customerId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${ws}/${channelId}/${customerId}`},0))`,
          );
        },
        async find(id) {
          const [r] = await tx
            .select()
            .from(c)
            .where(and(eq(c.workspaceId, ws), eq(c.id, id)))
            .for('update');
          return r ? toView(r) : null;
        },
        async findPeer(channelId, customerId) {
          const [r] = await tx
            .select()
            .from(c)
            .where(
              and(eq(c.workspaceId, ws), eq(c.channelId, channelId), eq(c.customerId, customerId)),
            )
            .for('update');
          return r ? toView(r) : null;
        },
        async query(f): Promise<ConversationPage> {
          const base = baseConditions(ws, f);
          const tab =
            f.tab === 'unread'
              ? [sql`${c.unreadCount} > 0`]
              : f.tab === 'waiting'
                ? [waitingNow]
                : [];
          const order =
            effectiveSort(f) === 'waitingLongest'
              ? [
                  sql`(case when ${c.status} = 'open' then ${c.awaitingSince} end) asc nulls last`,
                  desc(c.updatedAt),
                  desc(c.id),
                ]
              : [desc(c.updatedAt), desc(c.id)];
          const [rows, [counts]] = await Promise.all([
            tx
              .select()
              .from(c)
              .where(and(...base, ...tab))
              .orderBy(...order)
              .limit(f.limit),
            tx
              .select({
                all: sql<number>`count(*)::int`,
                unread: sql<number>`(count(*) filter (where ${c.unreadCount} > 0))::int`,
                waiting: sql<number>`(count(*) filter (where ${waitingNow}))::int`,
              })
              .from(c)
              .where(and(...base)),
          ]);
          return {
            data: rows.map(toView),
            counts: {
              all: counts?.all ?? 0,
              unread: counts?.unread ?? 0,
              waiting: counts?.waiting ?? 0,
            },
          };
        },
        async save(view) {
          // Tags come from the crm library on every read; never persist a stale copy.
          const data = { ...view, tags: [] };
          const columns = indexColumns(view);
          await tx
            .insert(c)
            .values({
              id: data.id,
              workspaceId: ws,
              channelId: data.channelId,
              customerId: data.customerId,
              data,
              createdAt: new Date(data.createdAt),
              ...columns,
            })
            .onConflictDoUpdate({
              target: c.id,
              set: { data, ...columns },
              setWhere: eq(c.workspaceId, ws),
            });
        },
        async messages(id) {
          return (
            await tx
              .select()
              .from(m)
              .where(and(eq(m.workspaceId, ws), eq(m.conversationId, id)))
              .orderBy(desc(m.createdAt))
              .limit(200)
          )
            .map((r) => InboxMessageDto.parse(r.data))
            .reverse();
        },
        async peerMessagesAfter(channelId, customerId, after, limit) {
          const [conv] = await tx
            .select({ id: c.id })
            .from(c)
            .where(
              and(eq(c.workspaceId, ws), eq(c.channelId, channelId), eq(c.customerId, customerId)),
            );
          if (!conv) return { conversationId: null, messages: [] };
          const rows = await tx
            .select()
            .from(m)
            .where(
              and(
                eq(m.workspaceId, ws),
                eq(m.conversationId, conv.id),
                ...(after ? [gt(m.id, after)] : []),
              ),
            )
            .orderBy(asc(m.id))
            .limit(limit);
          return {
            conversationId: conv.id,
            messages: rows.map((r) => InboxMessageDto.parse(r.data)),
          };
        },
        async findMessage(id, key) {
          const [r] = await tx
            .select()
            .from(m)
            .where(and(eq(m.workspaceId, ws), eq(m.conversationId, id), eq(m.idempotencyKey, key)));
          return r ? InboxMessageDto.parse(r.data) : null;
        },
        async saveMessage(data, key) {
          await tx
            .insert(m)
            .values({
              id: data.id,
              workspaceId: ws,
              conversationId: data.conversationId,
              idempotencyKey: key,
              data,
              createdAt: new Date(data.createdAt),
            })
            .onConflictDoUpdate({ target: m.id, set: { data }, setWhere: eq(m.workspaceId, ws) });
        },
        async updateMessage(data) {
          await tx
            .update(m)
            .set({ data })
            .where(and(eq(m.workspaceId, ws), eq(m.id, data.id)));
        },
        async audit(id, type, payload) {
          await writeOutbox(tx, {
            workspaceId: ws,
            type,
            aggregateType: 'conversation',
            aggregateId: id,
            payload,
          });
        },
      }),
    );
  }
}
export class UnavailableConversationStore implements ConversationStore {
  run<T>(_ws: WorkspaceId, _fn: (tx: ConversationTx) => Promise<T>): Promise<T> {
    throw new ConversationError('UNAVAILABLE', 'Inbox requires a configured database');
  }
}

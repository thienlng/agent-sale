import {
  and,
  desc,
  asc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
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
import { absoluteMediaUrl } from '../../../../common/storage/media-url.js';
import { ConversationError } from '../../domain/conversation.errors.js';
import {
  effectiveSort,
  type ConversationFilter,
  type ConversationPage,
} from '../../domain/conversation-filter.js';
const c = schema.conversations,
  m = schema.conversationMessages;
type Row = typeof c.$inferSelect;
/**
 * `data` is the document; rows written before migration 0024 may lack `createdAt`. The bot comes
 * from the `bot_id` column: the backfill fills it and deleting the bot clears it (`releaseBot`).
 * Likewise the customer from `contact_id`: deleting the customer clears it (0030).
 */
const toView = (r: Row): ConversationView =>
  ConversationDto.parse({
    ...r.data,
    createdAt: r.data.createdAt ?? r.createdAt.toISOString(),
    botId: r.botId,
    contactId: r.contactId,
  });
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
  if (f.contactId) where.push(eq(c.contactId, f.contactId));
  if (f.botId) where.push(f.botId === 'none' ? isNull(c.botId) : eq(c.botId, f.botId));
  if (f.updatedFrom) where.push(gte(c.updatedAt, new Date(f.updatedFrom)));
  if (f.updatedTo) where.push(lt(c.updatedAt, new Date(f.updatedTo)));
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
  botId: d.botId,
  contactId: d.contactId,
});
/** A stored message, with Rapiz attachments on the current public host (see the constructor). */
function readMessage(data: unknown, mediaBase: string | undefined): InboxMessageDto {
  const msg = InboxMessageDto.parse(data);
  if (!mediaBase || msg.attachments.length === 0) return msg;
  return {
    ...msg,
    attachments: msg.attachments.map((a) => ({ ...a, url: absoluteMediaUrl(a.url, mediaBase) })),
  };
}

export class DrizzleConversationStore implements ConversationStore {
  /**
   * `mediaBase` is the current `S3_PUBLIC_URL`: stored attachments of Rapiz objects keep the host
   * they were uploaded on (a dev tunnel that no longer exists, an old domain), so they are served
   * on the current one (docs/lodging.md "Pictures"). External links are left as they are.
   */
  constructor(
    private readonly db: Database,
    private readonly mediaBase?: string,
  ) {}

  run<T>(ws: WorkspaceId, fn: (tx: ConversationTx) => Promise<T>): Promise<T> {
    const mediaBase = this.mediaBase;
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
        async peekControl(id) {
          const [r] = await tx
            .select({ mode: c.mode, status: c.status })
            .from(c)
            .where(and(eq(c.workspaceId, ws), eq(c.id, id)));
          // Index columns derived from the document on every save (see indexColumns).
          return r
            ? {
                mode: r.mode as ConversationView['mode'],
                status: r.status as ConversationView['status'],
              }
            : null;
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
            .map((r) => readMessage(r.data, mediaBase))
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
            messages: rows.map((r) => readMessage(r.data, mediaBase)),
          };
        },
        async findMessage(id, key) {
          const [r] = await tx
            .select()
            .from(m)
            .where(and(eq(m.workspaceId, ws), eq(m.conversationId, id), eq(m.idempotencyKey, key)));
          return r ? readMessage(r.data, mediaBase) : null;
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
        async releaseBot(botId) {
          await tx
            .update(c)
            .set({ botId: null })
            .where(and(eq(c.workspaceId, ws), eq(c.botId, botId)));
        },
        async awaitingReply({ olderThan, limit }) {
          const waiting = and(
            eq(c.workspaceId, ws),
            waitingNow,
            sql`${c.awaitingSince} <= ${olderThan.toISOString()}::timestamptz`,
          );
          const [groups, ids] = await Promise.all([
            tx
              .select({
                channel: sql<string>`coalesce(${c.data}->>'provider', 'unknown')`,
                count: sql<number>`count(*)::int`,
                oldest: sql<string | Date | null>`min(${c.awaitingSince})`,
              })
              .from(c)
              .where(waiting)
              .groupBy(sql`1`),
            tx
              .select({ id: c.id })
              .from(c)
              .where(waiting)
              .orderBy(asc(c.awaitingSince), asc(c.id))
              .limit(Math.max(0, Math.min(limit, 200))),
          ]);
          const oldest = groups
            .map((g) => (g.oldest ? new Date(g.oldest).getTime() : Infinity))
            .reduce((a, b) => Math.min(a, b), Infinity);
          return {
            count: groups.reduce((n, g) => n + Number(g.count), 0),
            oldestSince: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
            byChannel: groups
              .map((g) => ({ channel: g.channel, count: Number(g.count) }))
              .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel)),
            ids: ids.map((r) => r.id),
          };
        },
        async todayCandidates({
          ids,
          awaitingBefore,
          followUpBefore,
          limit,
          visibleTo,
          lastHumanFor,
        }) {
          const wanted: SQL[] = [
            sql`(${waitingNow} and ${c.awaitingSince} <= ${awaitingBefore.toISOString()}::timestamptz)`,
            sql`(${c.status} <> 'spam' and ${c.data}->>'followUpAt' is not null
              and (${c.data}->>'followUpAt')::timestamptz <= ${followUpBefore.toISOString()}::timestamptz)`,
          ];
          if (ids.length) wanted.push(sql`${c.id} = any(${uuidArray(ids)})`);
          const lastHuman = sql`(select max((mm.data->>'createdAt')::timestamptz)
                from ${m} mm
                where mm.workspace_id = ${c.workspaceId} and mm.conversation_id = ${c.id}
                  and mm.data->>'sender' = 'human' and mm.data->>'status' <> 'failed')`;
          const scope = visibleTo
            ? sql` and (${c.assigneeId} is null or ${c.assigneeId} = ${visibleTo}::uuid)`
            : sql``;
          const rows = await tx
            .select({
              row: c,
              // The correlated read runs only for the rows that need it (a CASE evaluates its
              // subplan lazily): attention candidates.
              lastHuman: lastHumanFor
                ? sql<string | Date | null>`case when ${c.id} = any(${uuidArray(lastHumanFor)})
                    then ${lastHuman} end`
                : sql<string | Date | null>`${lastHuman}`,
            })
            .from(c)
            .where(and(eq(c.workspaceId, ws), sql`(${sql.join(wanted, sql` or `)})${scope}`))
            .orderBy(desc(c.updatedAt))
            .limit(Math.max(0, Math.min(limit, 1000)));
          return rows.map((r) => ({
            conversation: toView(r.row),
            lastHumanReplyAt: r.lastHuman ? new Date(r.lastHuman).toISOString() : null,
          }));
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

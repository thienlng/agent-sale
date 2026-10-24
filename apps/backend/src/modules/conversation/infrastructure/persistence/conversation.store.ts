import {
  and,
  desc,
  eq,
  schema,
  sql,
  withTenant,
  writeOutbox,
  type Database,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import { ConversationDto, InboxMessageDto } from '@agent-sales/contracts';
import type {
  ConversationStore,
  ConversationTx,
} from '../../application/ports/conversation-store.js';
import { ConversationError } from '../../domain/conversation.errors.js';
const c = schema.conversations,
  m = schema.conversationMessages;
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
          return r ? ConversationDto.parse(r.data) : null;
        },
        async findPeer(channelId, customerId) {
          const [r] = await tx
            .select()
            .from(c)
            .where(
              and(eq(c.workspaceId, ws), eq(c.channelId, channelId), eq(c.customerId, customerId)),
            )
            .for('update');
          return r ? ConversationDto.parse(r.data) : null;
        },
        async list() {
          return (
            await tx
              .select()
              .from(c)
              .where(eq(c.workspaceId, ws))
              .orderBy(desc(c.updatedAt))
              .limit(500)
          ).map((r) => ConversationDto.parse(r.data));
        },
        async save(data) {
          await tx
            .insert(c)
            .values({
              id: data.id,
              workspaceId: ws,
              channelId: data.channelId,
              customerId: data.customerId,
              data,
              updatedAt: new Date(data.updatedAt),
            })
            .onConflictDoUpdate({
              target: c.id,
              set: { data, updatedAt: new Date(data.updatedAt) },
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

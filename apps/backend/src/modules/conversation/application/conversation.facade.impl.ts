import type { NormalizedEvent } from '@agent-sales/channels';
import {
  SendInboxMessageRequest,
  type ConversationListQuery,
  type ConversationView,
  type InboxMessageDto,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import {
  CHANNEL_FACADE,
  type ChannelFacade,
  type OutboundInboxMessage,
} from '../../channel/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { TEAM_FACADE, type TeamFacade } from '../../team/api/index.js';
import type { ConversationFacade } from '../api/conversation.facade.js';
import { ConversationError } from '../domain/conversation.errors.js';
import type { ConversationFilter } from '../domain/conversation-filter.js';
import { detectVietnamesePhone } from '../domain/phone.js';
import { applyControlUpdate, newConversation } from '../domain/conversation-state.js';
import { refreshCustomerProfile } from './customer-profile.js';
import { addNote, markRead, markUnread } from './inbox-state.js';
import {
  CONVERSATION_STORE,
  type ConversationStore,
  type ConversationTx,
} from './ports/conversation-store.js';
const now = () => new Date().toISOString();
/** List preview: the text, or a neutral marker the UI localizes (e.g. "[image]"). */
function preview(text: string, attachments: readonly { type: string }[]): string {
  return text || (attachments[0] ? `[${attachments[0].type}]` : '');
}
async function requireConversation(tx: ConversationTx, id: string): Promise<ConversationView> {
  const c = await tx.find(id);
  if (!c) throw new ConversationError('NOT_FOUND', 'Conversation not found');
  return c;
}
@Injectable()
export class ConversationFacadeImpl implements ConversationFacade {
  constructor(
    @Inject(CONVERSATION_STORE) private readonly store: ConversationStore,
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(TEAM_FACADE) private readonly team: TeamFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}
  async list(ws: WorkspaceId, q: ConversationListQuery, viewerId?: string) {
    if (q.assignee === 'me' && !viewerId)
      throw new ConversationError('VALIDATION_FAILED', 'assignee=me needs a signed-in user');
    const filter: ConversationFilter = {
      tab: q.tab ?? 'all',
      assignee: q.assignee === 'me' ? viewerId : q.assignee,
      channelId: q.channelId,
      hasPhone: q.hasPhone,
      waiting: q.waiting,
      status: q.status,
      mode: q.mode,
      provider: q.provider,
      q: q.q,
      sort: q.sort ?? 'recent',
      limit: q.limit,
    };
    return this.store.run(ws, (tx) => tx.query(filter));
  }
  get(ws: WorkspaceId, id: string) {
    return this.store.run(ws, async (tx) => ({
      conversation: await requireConversation(tx, id),
      messages: await tx.messages(id),
    }));
  }
  async update(ws: WorkspaceId, id: string, input: UpdateConversationRequest, actorId: string) {
    // Cross-module read first, never inside the write transaction.
    if (input.assigneeId) await this.assertAssignable(ws, input.assigneeId, actorId);
    if (input.mode === 'bot') {
      // Resolve the cross-module read before opening the write transaction (see reserveAndDeliver).
      const channelId = await this.store.run(
        ws,
        async (tx) => (await requireConversation(tx, id)).channelId,
      );
      const bot = await this.channelBot(ws, channelId);
      if (!bot?.isActive)
        throw new ConversationError(
          'CONFLICT',
          'Bind an active bot to this channel before enabling automatic replies',
        );
    }
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      if (input.expectedRevision !== undefined && input.expectedRevision !== c.revision)
        throw new ConversationError('CONFLICT', 'Conversation changed; reload before saving');
      const updated = applyControlUpdate(c, input, actorId, now());
      await tx.save(updated);
      await tx.audit(id, 'conversation.control.updated.v1', {
        actorId,
        mode: updated.mode,
        status: updated.status,
        assigneeId: updated.assigneeId,
        revision: updated.revision,
        followUpAt: updated.followUpAt ?? null,
      });
      return updated;
    });
  }
  markRead(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView> {
    return markRead(this.store, this.identity, ws, id, actorId);
  }
  markUnread(ws: WorkspaceId, id: string): Promise<ConversationView> {
    return markUnread(this.store, ws, id);
  }
  addNote(ws: WorkspaceId, id: string, text: string, actorId: string): Promise<ConversationView> {
    return addNote(this.store, this.identity, ws, id, text, actorId);
  }
  refreshCustomerProfile(ws: WorkspaceId, id: string): Promise<void> {
    return refreshCustomerProfile(this.store, this.channels, ws, id);
  }
  private async assertAssignable(ws: WorkspaceId, memberId: string, actorId: string) {
    const members = await this.team.listMembers(ws, { userId: actorId, role: undefined });
    if (!members.some((m) => m.userId === memberId && m.status === 'active'))
      throw new ConversationError(
        'VALIDATION_FAILED',
        'Assignee must be an active member of this workspace',
      );
  }
  async receive(ws: WorkspaceId, channelId: string, event: NormalizedEvent) {
    const channel = await this.channels.getConnection(ws, channelId);
    // A connection waiting for re-auth still records inbound messages; only sending is blocked.
    if (
      channel.status === 'disconnected' ||
      channel.provider !== event.kind ||
      channel.externalId !== event.assetExternalId
    )
      throw new ConversationError('NOT_FOUND', 'Connection not found');
    const bot = await this.channelBot(ws, channelId);
    return this.store.run(ws, async (tx) => {
      await tx.lockPeer(channelId, event.senderExternalId);
      const existing = await tx.findPeer(channelId, event.senderExternalId);
      let c: ConversationView =
        existing ??
        newConversation({
          id: newId(),
          channelId,
          provider: channel.provider,
          customerId: event.senderExternalId,
          mode: bot?.isActive ? 'bot' : 'human',
          echo: event.type === 'echo',
          occurredAt: event.occurredAt,
          at: now(),
        });
      if (await tx.findMessage(c.id, event.externalEventId)) return c;
      if (event.type === 'echo') {
        // Echoes can be our own sends; only an unmatched external message means an outside staff reply.
        const outbound = (await tx.messages(c.id)).filter((m) => m.direction === 'outbound');
        if (outbound.some((m) => m.externalId === event.externalMessageId)) return c;
        // A send that timed out may still have been delivered: its echo has no known id yet.
        const uncertain = outbound.find(
          (m) =>
            !m.externalId &&
            (m.status === 'unknown' || m.status === 'pending') &&
            m.text === (event.text ?? '').slice(0, 2000) &&
            m.attachments.length === (event.attachments?.length ?? 0),
        );
        if (uncertain) {
          await tx.updateMessage({
            ...uncertain,
            status: 'sent',
            externalId: event.externalMessageId ?? event.externalEventId,
          });
          return c;
        }
        c = {
          ...c,
          ...(bot?.silenceOnExternalReply !== false
            ? { mode: 'human' as const, autoResumeAt: this.resumeAt(bot) }
            : {}),
          // Staff answered from outside the app: nobody is waiting any more.
          awaitingSince: null,
          lastMessageSender: 'human' as const,
          revision: c.revision + 1,
          lastMessage: preview(event.text ?? '', event.attachments ?? []),
          updatedAt: now(),
        };
      } else {
        c = {
          ...c,
          ...(c.mode === 'human' &&
          c.autoResumeAt &&
          Date.parse(c.autoResumeAt) <= Date.now() &&
          bot?.isActive
            ? { mode: 'bot' as const, autoResumeAt: null }
            : {}),
          status: 'open',
          unreadCount: c.unreadCount + 1,
          awaitingSince: c.awaitingSince ?? event.occurredAt.toISOString(),
          lastMessageSender: 'customer' as const,
          customerPhone: detectVietnamesePhone(event.text ?? '') ?? c.customerPhone,
          revision: c.revision + 1,
          lastMessage: preview(event.text ?? '', event.attachments ?? []),
          lastInboundAt: new Date(
            Math.max(Date.parse(c.lastInboundAt), event.occurredAt.getTime()),
          ).toISOString(),
          updatedAt: now(),
        };
      }
      await tx.save(c);
      await tx.saveMessage(
        {
          id: newId(),
          conversationId: c.id,
          direction: event.type === 'echo' ? 'outbound' : 'inbound',
          sender: event.type === 'echo' ? 'human' : 'customer',
          text: (event.text ?? '').slice(0, 2000),
          attachments: event.attachments ?? [],
          status: event.type === 'echo' ? 'sent' : 'received',
          externalId: event.externalMessageId ?? event.externalEventId,
          failureCode: null,
          createdAt: event.occurredAt.toISOString(),
        },
        event.externalEventId,
      );
      await tx.audit(c.id, 'conversation.message.received.v1', {
        messageId: event.externalEventId,
        type: event.type,
        revision: c.revision,
        // Statistics: where and when it happened, and whether it opened the conversation.
        channelId,
        occurredAt: event.occurredAt.toISOString(),
        // The customer's first message opens it, even when staff wrote first (an echo creates the row with no inbound yet).
        firstMessage:
          event.type !== 'echo' && (!existing || Date.parse(existing.lastInboundAt) <= 0),
      });
      return c;
    });
  }
  async getReplyContext(ws: WorkspaceId, id: string) {
    const detail = await this.get(ws, id);
    return { ...detail, revision: detail.conversation.revision };
  }
  send(
    ws: WorkspaceId,
    id: string,
    input: SendInboxMessageRequest,
    actorId: string,
  ): Promise<InboxMessageDto> {
    const body = SendInboxMessageRequest.parse(input);
    return this.reserveAndDeliver(
      ws,
      id,
      { text: body.text, attachment: body.attachment, idempotencyKey: body.idempotencyKey },
      actorId,
      null,
    ).then((m) => {
      if (!m) throw new ConversationError('CONFLICT', 'Conversation control changed');
      return m;
    });
  }
  commitBotReply(
    ws: WorkspaceId,
    id: string,
    input: { revision: number; text: string; idempotencyKey: string },
  ): Promise<InboxMessageDto | null> {
    if (!input.text.trim() || input.text.length > 2000)
      throw new ConversationError(
        'VALIDATION_FAILED',
        'Reply must contain at most 2000 characters',
      );
    return this.reserveAndDeliver(
      ws,
      id,
      { text: input.text, idempotencyKey: input.idempotencyKey },
      null,
      input.revision,
    );
  }
  private async channelBot(ws: WorkspaceId, channelId: string): Promise<BotView | null> {
    const channel = await this.channels.getConnection(ws, channelId);
    if (channel.status !== 'connected' || !channel.botId) return null;
    return this.bots.getBot(ws, channel.botId);
  }
  private resumeAt(bot: BotView | null): string | null {
    return bot && bot.autoResumeAfterManual !== false
      ? new Date(Date.now() + (bot.humanTakeoverMinutes ?? 5) * 60000).toISOString()
      : null;
  }
  private async reserveAndDeliver(
    ws: WorkspaceId,
    id: string,
    input: OutboundInboxMessage & { idempotencyKey: string },
    actorId: string | null,
    expectedRevision: number | null,
  ): Promise<InboxMessageDto | null> {
    // Cross-module reads open their own transactions; resolve them first so we never hold
    // a pooled connection while waiting for another one (pool exhaustion under concurrent sends).
    const channelId = await this.store.run(
      ws,
      async (tx) => (await requireConversation(tx, id)).channelId,
    );
    const bot = await this.channelBot(ws, channelId);
    const reservation = await this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const prior = await tx.findMessage(id, input.idempotencyKey);
      if (prior) {
        if (prior.text !== input.text || prior.attachments[0]?.url !== input.attachment?.url)
          throw new ConversationError(
            'CONFLICT',
            'Idempotency key was already used for another reply',
          );
        return {
          message: prior,
          deliver: false,
          revision: c.revision,
          customerId: c.customerId,
          awaitingBefore: c.awaitingSince,
        };
      }
      if (expectedRevision !== null && !bot?.isActive) return null;
      if (
        expectedRevision !== null &&
        (c.mode !== 'bot' || c.revision !== expectedRevision || c.status !== 'open')
      )
        return null;
      if (
        Date.now() - Date.parse(c.lastInboundAt) >= 86400000 ||
        Date.parse(c.lastInboundAt) > Date.now() + 300000
      )
        throw new ConversationError('CONFLICT', 'The 24-hour messaging window is closed');
      const updated = {
        ...c,
        mode: actorId ? ('human' as const) : c.mode,
        ...(actorId ? { autoResumeAt: this.resumeAt(bot) } : {}),
        revision: c.revision + 1,
        assigneeId: actorId ?? c.assigneeId,
        // Any reply, human or bot, answers the customer.
        awaitingSince: null,
        lastMessageSender: actorId ? ('human' as const) : ('bot' as const),
        updatedAt: now(),
      };
      const message: InboxMessageDto = {
        id: newId(),
        conversationId: id,
        direction: 'outbound',
        sender: actorId ? 'human' : 'bot',
        text: input.text,
        attachments: input.attachment ? [input.attachment] : [],
        status: 'pending',
        externalId: null,
        failureCode: null,
        createdAt: now(),
      };
      await tx.save(updated);
      await tx.saveMessage(message, input.idempotencyKey);
      await tx.audit(id, 'conversation.reply.reserved.v1', {
        messageId: message.id,
        sender: message.sender,
        actorId,
        revision: updated.revision,
      });
      return {
        message,
        deliver: true,
        revision: updated.revision,
        customerId: c.customerId,
        awaitingBefore: c.awaitingSince,
      };
    });
    if (!reservation || !reservation.deliver) return reservation?.message ?? null;
    const m = reservation.message;
    if (expectedRevision !== null) {
      // Last control check before the provider call: a takeover since reservation wins.
      const stale = await this.store.run(ws, async (tx) => {
        const c = await requireConversation(tx, id);
        if (c.mode === 'bot' && c.revision === reservation.revision) return null;
        const failed = { ...m, status: 'failed' as const, failureCode: 'control_changed' };
        await tx.saveMessage(failed, input.idempotencyKey);
        return failed;
      });
      if (stale) return stale;
    }
    // The committed reservation survives a crash. Never retry pending or unknown sends automatically.
    // The provider call runs outside any transaction so a slow Meta response holds no connection or lock.
    const result = await this.channels.deliver(
      ws,
      channelId,
      reservation.customerId,
      { text: input.text, attachment: input.attachment },
      input.idempotencyKey,
    );
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const completed = { ...m, ...result };
      await tx.saveMessage(completed, input.idempotencyKey);
      await tx.save({
        ...c,
        lastMessage: preview(input.text, completed.attachments),
        // A reply that never left means the customer is still waiting (unless they wrote again).
        ...(result.status === 'failed' &&
        c.awaitingSince === null &&
        c.lastMessageSender === m.sender
          ? { awaitingSince: reservation.awaitingBefore }
          : {}),
        updatedAt: now(),
      });
      await tx.audit(id, 'conversation.reply.completed.v1', {
        messageId: m.id,
        status: result.status,
        failureCode: result.failureCode,
        channelId,
        sender: m.sender,
        occurredAt: now(),
      });
      return completed;
    });
  }
}

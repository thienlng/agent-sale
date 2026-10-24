import type { NormalizedEvent } from '@agent-sales/channels';
import {
  SendInboxMessageRequest,
  type ConversationDto,
  type ConversationListQuery,
  type InboxMessageDto,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import { CHANNEL_FACADE, type ChannelFacade } from '../../channel/api/index.js';
import type { ConversationFacade } from '../api/conversation.facade.js';
import { ConversationError } from '../domain/conversation.errors.js';
import {
  CONVERSATION_STORE,
  type ConversationStore,
  type ConversationTx,
} from './ports/conversation-store.js';
const now = () => new Date().toISOString();
async function requireConversation(tx: ConversationTx, id: string): Promise<ConversationDto> {
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
  ) {}
  async list(ws: WorkspaceId, q: ConversationListQuery) {
    return this.store.run(ws, async (tx) => ({
      data: (await tx.list())
        .filter(
          (c) =>
            (!q.provider || c.provider === q.provider) &&
            (!q.status || c.status === q.status) &&
            (!q.mode || c.mode === q.mode) &&
            (!q.q ||
              `${c.customerName} ${c.customerId} ${c.lastMessage}`
                .toLowerCase()
                .includes(q.q.toLowerCase())),
        )
        .slice(0, q.limit),
    }));
  }
  get(ws: WorkspaceId, id: string) {
    return this.store.run(ws, async (tx) => ({
      conversation: await requireConversation(tx, id),
      messages: await tx.messages(id),
    }));
  }
  update(ws: WorkspaceId, id: string, input: UpdateConversationRequest, actorId: string) {
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      if (input.mode === 'bot') {
        const bot = await this.channelBot(ws, c.channelId);
        if (!bot?.isActive)
          throw new ConversationError(
            'CONFLICT',
            'Bind an active bot to this channel before enabling automatic replies',
          );
      }
      const updated = {
        ...c,
        ...(input.mode ? { mode: input.mode, autoResumeAt: null } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.assignToMe !== undefined
          ? { assigneeId: input.assignToMe ? actorId : null }
          : {}),
        revision: c.revision + 1,
        updatedAt: now(),
      };
      await tx.save(updated);
      await tx.audit(id, 'conversation.control.updated.v1', {
        actorId,
        mode: updated.mode,
        status: updated.status,
        assigneeId: updated.assigneeId,
        revision: updated.revision,
      });
      return updated;
    });
  }
  async receive(ws: WorkspaceId, channelId: string, event: NormalizedEvent) {
    const channel = await this.channels.getConnection(ws, channelId);
    if (
      channel.status !== 'connected' ||
      channel.provider !== event.kind ||
      channel.externalId !== event.assetExternalId
    )
      throw new ConversationError('NOT_FOUND', 'Connection not found');
    const bot = await this.channelBot(ws, channelId);
    return this.store.run(ws, async (tx) => {
      await tx.lockPeer(channelId, event.senderExternalId);
      const existing = await tx.findPeer(channelId, event.senderExternalId);
      let c: ConversationDto = existing ?? {
        id: newId(),
        channelId,
        provider: channel.provider,
        customerId: event.senderExternalId,
        customerName: event.senderExternalId,
        mode: bot?.isActive ? 'bot' : 'human',
        autoResumeAt: null,
        status: 'open',
        assigneeId: null,
        note: '',
        revision: 0,
        lastMessage: '',
        lastInboundAt: event.occurredAt.toISOString(),
        updatedAt: now(),
      };
      if (await tx.findMessage(c.id, event.externalEventId)) return c;
      if (event.type === 'echo') {
        // Echoes can be our own sends; only an unmatched external message means an outside staff reply.
        const own = (await tx.messages(c.id)).some(
          (m) => m.direction === 'outbound' && m.externalId === event.externalMessageId,
        );
        if (own) return c;
        c = {
          ...c,
          ...(bot?.silenceOnExternalReply !== false
            ? { mode: 'human' as const, autoResumeAt: this.resumeAt(bot) }
            : {}),
          revision: c.revision + 1,
          lastMessage: event.text ?? '',
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
          revision: c.revision + 1,
          lastMessage: event.text ?? '',
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
    return this.reserveAndDeliver(ws, id, body, actorId, null).then((m) => {
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
    input: { text: string; idempotencyKey: string },
    actorId: string | null,
    expectedRevision: number | null,
  ): Promise<InboxMessageDto | null> {
    const reservation = await this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const prior = await tx.findMessage(id, input.idempotencyKey);
      if (prior) {
        if (prior.text !== input.text)
          throw new ConversationError(
            'CONFLICT',
            'Idempotency key was already used for another reply',
          );
        return { message: prior, deliver: false, revision: c.revision };
      }
      if (expectedRevision !== null && !(await this.channelBot(ws, c.channelId))?.isActive)
        return null;
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
      const bot = actorId ? await this.channelBot(ws, c.channelId) : null;
      const updated = {
        ...c,
        mode: actorId ? ('human' as const) : c.mode,
        ...(actorId ? { autoResumeAt: this.resumeAt(bot) } : {}),
        revision: c.revision + 1,
        assigneeId: actorId ?? c.assigneeId,
        updatedAt: now(),
      };
      const message: InboxMessageDto = {
        id: newId(),
        conversationId: id,
        direction: 'outbound',
        sender: actorId ? 'human' : 'bot',
        text: input.text,
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
      return { message, deliver: true, revision: updated.revision };
    });
    if (!reservation || !reservation.deliver) return reservation?.message ?? null;
    // The committed reservation survives a crash. Never retry pending or unknown sends automatically.
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const m = reservation.message;
      if (
        expectedRevision !== null &&
        (c.mode !== 'bot' ||
          c.revision !== reservation.revision ||
          !(await this.channelBot(ws, c.channelId))?.isActive)
      ) {
        const failed = { ...m, status: 'failed' as const, failureCode: 'control_changed' };
        await tx.saveMessage(failed, input.idempotencyKey);
        return failed;
      }
      const result = await this.channels.deliver(
        ws,
        c.channelId,
        c.customerId,
        input.text,
        input.idempotencyKey,
      );
      const completed = { ...m, ...result };
      await tx.saveMessage(completed, input.idempotencyKey);
      await tx.save({ ...c, lastMessage: input.text, updatedAt: now() });
      await tx.audit(id, 'conversation.reply.completed.v1', {
        messageId: m.id,
        status: result.status,
        failureCode: result.failureCode,
      });
      return completed;
    });
  }
}

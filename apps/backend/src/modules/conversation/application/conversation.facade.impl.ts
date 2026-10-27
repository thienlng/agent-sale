import { type NormalizedEvent, withinReplyWindow } from '@agent-sales/channels';
import {
  SendInboxMessageRequest,
  type BulkConversationRequest,
  type BulkConversationResponse,
  type ConversationListQuery,
  type ConversationView,
  type InboxMessageDto,
  type UpdateConversationRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BOT_FACADE, type BotFacade, type BotView } from '../../bot/api/index.js';
import {
  CHANNEL_FACADE,
  type ChannelFacade,
  type OutboundInboxMessage,
} from '../../channel/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { TEAM_FACADE, type TeamFacade } from '../../team/api/index.js';
import type { ConversationFacade } from '../api/conversation.facade.js';
import { ConversationError } from '../domain/conversation.errors.js';
import { nextMessageId } from '../domain/message-id.js';
import { toListFilter } from '../domain/conversation-filter.js';
import { detectVietnamesePhone, normalizeVietnamesePhone } from '../domain/phone.js';
import { applyControlUpdate, newConversation, preview } from '../domain/conversation-state.js';
import { attachTags, tagConditions } from './conversation-tags.js';
import { refreshCustomerProfile } from './customer-profile.js';
import { addNote, assertAssignable, markRead, markUnread, setStarred } from './inbox-state.js';
import {
  CONVERSATION_STORE,
  type ConversationStore,
  type ConversationTx,
} from './ports/conversation-store.js';
const now = () => new Date().toISOString();
/** A website visitor has no profile to look up: "Khách website" + the last 4 characters of the visitor id. */
function named(provider: string, customerId: string, c: ConversationView): ConversationView {
  return provider === 'website'
    ? { ...c, customerName: `Khách website ${customerId.slice(-4)}` }
    : c;
}
const log = new Logger('ConversationFacade');
/** Unnamed customers looked up per list request (see `backfillProfiles`). */
const PROFILE_BACKFILL_PER_LIST = 10;
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
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}
  async list(ws: WorkspaceId, q: ConversationListQuery, viewerId?: string) {
    const filter = {
      ...toListFilter(q, viewerId),
      ...(await tagConditions(this.crm, ws, q)),
    };
    const page = await this.store.run(ws, (tx) => tx.query(filter));
    this.backfillProfiles(ws, page.data);
    return { data: await attachTags(this.crm, ws, page.data), counts: page.counts };
  }
  /**
   * Conversations that started before profile lookups existed only learn the customer's name on
   * their next message. Looking up the unnamed rows a rep is looking at fixes the visible list
   * without a migration job; `refreshCustomerProfile` throttles per conversation and never throws.
   */
  private backfillProfiles(ws: WorkspaceId, rows: readonly ConversationView[]) {
    const unnamed = rows
      .filter((c) => !c.customerName.trim() || c.customerName === c.customerId)
      .slice(0, PROFILE_BACKFILL_PER_LIST);
    if (!unnamed.length) return;
    void (async () => {
      // One at a time: a list refresh must not burst requests at Meta.
      for (const c of unnamed) await refreshCustomerProfile(this.store, this.channels, ws, c.id);
    })();
  }
  async get(ws: WorkspaceId, id: string) {
    const detail = await this.load(ws, id);
    const [conversation] = await attachTags(this.crm, ws, [detail.conversation]);
    return { ...detail, conversation: conversation ?? detail.conversation };
  }
  private load(ws: WorkspaceId, id: string) {
    return this.store.run(ws, async (tx) => ({
      conversation: await requireConversation(tx, id),
      messages: await tx.messages(id),
    }));
  }
  /**
   * The bot passes the conversation to staff (upset customer, a phone number, unreadable media).
   * Unlike a manual takeover it comes back to the bot by itself after the bot's takeover window
   * (the next customer message after it), unless the bot is set to never resume automatically.
   */
  async handOff(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView> {
    const channelId = await this.store.run(
      ws,
      async (tx) => (await requireConversation(tx, id)).channelId,
    );
    const bot = await this.channelBot(ws, channelId);
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const updated = {
        ...c,
        mode: 'human' as const,
        takeover: 'temporary' as const,
        autoResumeAt: this.resumeAt(bot),
        // A control change: new revision, same place in the list.
        revision: c.revision + 1,
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
  private async tagged(ws: WorkspaceId, c: ConversationView): Promise<ConversationView> {
    return (await attachTags(this.crm, ws, [c]))[0] ?? c;
  }
  async listTags(ws: WorkspaceId, id: string) {
    await this.load(ws, id);
    return this.crm.listConversationTags(ws, id);
  }
  async addTag(ws: WorkspaceId, id: string, input: unknown, actorId: string) {
    await this.load(ws, id);
    return this.crm.assignConversationTag(ws, id, input, actorId);
  }
  async update(ws: WorkspaceId, id: string, input: UpdateConversationRequest, actorId: string) {
    // Cross-module read first, never inside the write transaction.
    if (input.assigneeId) await assertAssignable(this.team, ws, input.assigneeId, actorId);
    // A star alone is not a control change: no revision bump (bot fencing), no reordering.
    const { expectedRevision: _revision, starred, ...rest } = input;
    if (starred !== undefined && Object.values(rest).every((v) => v === undefined))
      return this.tagged(ws, await setStarred(this.store, ws, id, starred));
    return this.tagged(ws, await this.control(ws, id, input, actorId));
  }
  /**
   * One action on several conversations. Each runs in its own transaction with the same checks as
   * the single-conversation endpoints, so one failure (missing, changed) never undoes the others;
   * the caller retries only the failed ids.
   */
  async bulk(
    ws: WorkspaceId,
    input: BulkConversationRequest,
    actorId: string,
  ): Promise<BulkConversationResponse> {
    if (input.assigneeId) await assertAssignable(this.team, ws, input.assigneeId, actorId);
    const patch: Partial<Record<BulkConversationRequest['action'], UpdateConversationRequest>> = {
      resolve: { status: 'resolved' },
      reopen: { status: 'open' },
      spam: { status: 'spam' },
      assign: { assigneeId: input.assigneeId ?? null },
      clearFollowUp: { followUpAt: null },
    };
    const data: BulkConversationResponse['data'] = [];
    for (const id of new Set(input.ids)) {
      try {
        const body = patch[input.action];
        if (body) await this.control(ws, id, body, actorId);
        else if (input.action === 'star' || input.action === 'unstar')
          await setStarred(this.store, ws, id, input.action === 'star');
        else if (input.action === 'read')
          await markRead(this.store, this.identity, ws, id, actorId);
        else await markUnread(this.store, ws, id);
        data.push({ id, ok: true, code: null });
      } catch (error) {
        // Earlier ids are already committed, so even an unexpected failure is reported per id.
        if (!(error instanceof ConversationError))
          log.error(
            `Bulk ${input.action} failed for conversation ${id}`,
            error instanceof Error ? error.stack : String(error),
          );
        data.push({
          id,
          ok: false,
          code: error instanceof ConversationError ? error.code : 'INTERNAL',
        });
      }
    }
    const succeeded = data.filter((r) => r.ok).length;
    return { data, succeeded, failed: data.length - succeeded };
  }
  /** A staff control change; the assignee was validated by the caller. */
  private async control(
    ws: WorkspaceId,
    id: string,
    input: UpdateConversationRequest,
    actorId: string,
  ): Promise<ConversationView> {
    const phone = input.customerPhone ? normalizeVietnamesePhone(input.customerPhone) : null;
    if (input.customerPhone && !phone)
      throw new ConversationError('VALIDATION_FAILED', 'Enter a Vietnamese mobile number');
    const noteText = input.note?.trim() ?? '';
    const author =
      noteText && isUuid(actorId) ? await this.identity.displayName(userId(actorId)) : null;
    let resumeAt: string | null = null;
    if (input.mode === 'bot' || input.takeover === 'temporary') {
      // Resolve the cross-module read before opening the write transaction (see reserveAndDeliver).
      const channelId = await this.store.run(
        ws,
        async (tx) => (await requireConversation(tx, id)).channelId,
      );
      const bot = await this.channelBot(ws, channelId);
      // Auto-resume only makes sense with an active bot that is set to resume.
      if (bot?.isActive) resumeAt = this.resumeAt(bot);
      if (input.mode === 'bot' && !bot?.isActive)
        throw new ConversationError(
          'CONFLICT',
          'Bind an active bot to this channel before enabling automatic replies',
        );
    }
    return this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      if (input.expectedRevision !== undefined && input.expectedRevision !== c.revision)
        throw new ConversationError('CONFLICT', 'Conversation changed; reload before saving');
      // A changed legacy note also lands in the timeline, so the two never drift apart.
      const noteEntry =
        noteText && noteText !== c.note
          ? {
              id: newId(),
              authorId: isUuid(actorId) ? actorId : null,
              authorName: author ?? '',
              text: noteText,
              createdAt: now(),
            }
          : undefined;
      const patch = input.customerPhone === undefined ? input : { ...input, customerPhone: phone };
      const updated = applyControlUpdate(c, patch, actorId, noteEntry, resumeAt);
      await tx.save(updated);
      await tx.audit(id, 'conversation.control.updated.v1', {
        actorId,
        mode: updated.mode,
        status: updated.status,
        assigneeId: updated.assigneeId,
        starred: updated.starred,
        revision: updated.revision,
        followUpAt: updated.followUpAt ?? null,
      });
      return updated;
    });
  }
  async linkLead(
    ws: WorkspaceId,
    id: string,
    lead: { contactId: string; phoneE164: string; capturedAt: string },
  ): Promise<void> {
    await this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      if (c.lead?.contactId === lead.contactId && c.lead.phone === lead.phoneE164) return;
      // A lead is a shop-level annotation like read state: no revision or updatedAt change.
      await tx.save({
        ...c,
        lead: {
          contactId: lead.contactId,
          phone: lead.phoneE164,
          capturedAt: lead.capturedAt,
          seenAt: null,
        },
      });
    });
  }

  async markRead(ws: WorkspaceId, id: string, actorId: string): Promise<ConversationView> {
    return this.tagged(ws, await markRead(this.store, this.identity, ws, id, actorId));
  }
  async markUnread(ws: WorkspaceId, id: string): Promise<ConversationView> {
    return this.tagged(ws, await markUnread(this.store, ws, id));
  }
  async addNote(ws: WorkspaceId, id: string, text: string, actorId: string) {
    return this.tagged(ws, await addNote(this.store, this.identity, ws, id, text, actorId));
  }
  refreshCustomerProfile(ws: WorkspaceId, id: string): Promise<void> {
    return refreshCustomerProfile(this.store, this.channels, ws, id);
  }
  async listForVisitor(
    ws: WorkspaceId,
    channelId: string,
    customerId: string,
    afterMessageId: string | null,
    limit = 50,
  ) {
    const size = Math.min(Math.max(limit, 1), 100);
    const visible = (m: InboxMessageDto) => m.direction === 'inbound' || m.status === 'sent';
    // Hidden rows (failed, unknown) are skipped; keep reading past them so a run of them cannot stall the cursor.
    let cursor = afterMessageId;
    let conversationId: string | null = null;
    let shown: InboxMessageDto[] = [];
    for (let round = 0; round < 5 && !shown.length; round++) {
      const page = await this.store.run(ws, (tx) =>
        tx.peerMessagesAfter(channelId, customerId, cursor, size),
      );
      conversationId = page.conversationId;
      shown = page.messages.filter(visible);
      const last = page.messages.at(-1);
      if (!last || page.messages.length < size) break;
      cursor = last.id;
    }
    const page = { conversationId };
    const messages = shown.map((m) => ({
      id: m.id,
      role: m.direction === 'inbound' ? ('customer' as const) : ('agent' as const),
      text: m.text,
      imageUrl: m.attachments.find((a) => a.type === 'image')?.url ?? null,
      // The widget's own id: stored as the message's external id (the queue event id is namespaced).
      clientMessageId:
        m.direction === 'inbound' && m.externalId && isUuid(m.externalId) ? m.externalId : null,
      at: m.createdAt,
    }));
    return { conversationId: page.conversationId, messages };
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
        named(
          channel.provider,
          event.senderExternalId,
          newConversation({
            id: newId(),
            channelId,
            provider: channel.provider,
            customerId: event.senderExternalId,
            mode: bot?.isActive ? 'bot' : 'human',
            echo: event.type === 'echo',
            occurredAt: event.occurredAt,
            at: now(),
          }),
        );
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
          ...(bot?.silenceOnExternalReply !== false ? this.humanPause(c, bot) : {}),
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
            ? { mode: 'bot' as const, autoResumeAt: null, takeover: null }
            : {}),
          // A customer message reopens Done; Spam keeps it out of the queue until staff restore it.
          status: c.status === 'spam' ? 'spam' : 'open',
          unreadCount: c.unreadCount + 1,
          awaitingSince: c.awaitingSince ?? event.occurredAt.toISOString(),
          lastMessageSender: 'customer' as const,
          // The first number stays; staff correct it with PATCH customerPhone.
          customerPhone: c.customerPhone ?? detectVietnamesePhone(event.text ?? ''),
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
          id: nextMessageId(),
          conversationId: c.id,
          direction: event.type === 'echo' ? 'outbound' : 'inbound',
          sender: event.type === 'echo' ? 'human' : 'customer',
          senderName: null,
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
    const detail = await this.load(ws, id);
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
      {
        text: body.text,
        attachments: body.attachment ? [body.attachment] : [],
        idempotencyKey: body.idempotencyKey,
      },
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
  commitBotFollowUp(
    ws: WorkspaceId,
    id: string,
    input: { text: string; idempotencyKey: string },
  ): Promise<InboxMessageDto | null> {
    if (!input.text.trim() || input.text.length > 2000)
      throw new ConversationError(
        'VALIDATION_FAILED',
        'Reply must contain at most 2000 characters',
      );
    // Later bubbles of the same answer only need the bot to still hold the conversation.
    return this.reserveAndDeliver(
      ws,
      id,
      { text: input.text, idempotencyKey: input.idempotencyKey },
      null,
      'follow-up',
    );
  }
  async commitBotImages(
    ws: WorkspaceId,
    id: string,
    input: { urls: readonly string[]; idempotencyKey: string },
  ): Promise<InboxMessageDto | null> {
    if (
      !input.urls.length ||
      input.urls.length > 10 ||
      input.urls.some((url) => !url.startsWith('https://') || url.length > 2000)
    )
      throw new ConversationError('VALIDATION_FAILED', 'Image URLs must be 1-10 https URLs');
    // The text reply of the same turn already moved the revision on, so a follow-up only requires
    // that the bot still holds the conversation (a takeover in between wins).
    return this.reserveAndDeliver(
      ws,
      id,
      {
        text: '',
        attachments: input.urls.map((url) => ({ type: 'image' as const, url })),
        idempotencyKey: input.idempotencyKey,
      },
      null,
      'follow-up',
    );
  }
  private async channelBot(ws: WorkspaceId, channelId: string): Promise<BotView | null> {
    const channel = await this.channels.getConnection(ws, channelId);
    if (channel.status !== 'connected' || !channel.botId) return null;
    return this.bots.getBot(ws, channel.botId);
  }
  /** A staff reply or Page echo pauses the bot; an explicit permanent takeover stays permanent. */
  private humanPause(c: ConversationView, bot: BotView | null) {
    const permanent = c.mode === 'human' && c.takeover === 'permanent';
    return {
      mode: 'human' as const,
      autoResumeAt: permanent ? null : this.resumeAt(bot),
      takeover: permanent ? ('permanent' as const) : ('temporary' as const),
    };
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
    expectedRevision: number | 'follow-up' | null,
  ): Promise<InboxMessageDto | null> {
    // Cross-module reads open their own transactions; resolve them first so we never hold
    // a pooled connection while waiting for another one (pool exhaustion under concurrent sends).
    const channelId = await this.store.run(
      ws,
      async (tx) => (await requireConversation(tx, id)).channelId,
    );
    const bot = await this.channelBot(ws, channelId);
    const senderName =
      actorId && isUuid(actorId) ? await this.identity.displayName(userId(actorId)) : null;
    const reservation = await this.store.run(ws, async (tx) => {
      const c = await requireConversation(tx, id);
      const prior = await tx.findMessage(id, input.idempotencyKey);
      if (prior) {
        if (
          prior.text !== input.text ||
          prior.attachments.map((a) => a.url).join('\n') !==
            (input.attachments ?? []).map((a) => a.url).join('\n')
        )
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
      // Staff reopen Done or Spam before replying, so nothing is sent from a folder by mistake.
      if (actorId && c.status !== 'open')
        throw new ConversationError('CONFLICT', 'Reopen the conversation before replying');
      if (expectedRevision !== null && !bot?.isActive) return null;
      if (
        expectedRevision !== null &&
        (c.mode !== 'bot' ||
          (expectedRevision !== 'follow-up' && c.revision !== expectedRevision) ||
          c.status !== 'open')
      )
        return null;
      if (
        !withinReplyWindow(c.provider, new Date(c.lastInboundAt)) ||
        Date.parse(c.lastInboundAt) > Date.now() + 300000
      )
        throw new ConversationError('CONFLICT', 'The 24-hour messaging window is closed');
      const updated = {
        ...c,
        mode: actorId ? ('human' as const) : c.mode,
        ...(actorId ? this.humanPause(c, bot) : {}),
        revision: c.revision + 1,
        assigneeId: actorId ?? c.assigneeId,
        // Any reply, human or bot, answers the customer.
        awaitingSince: null,
        lastMessageSender: actorId ? ('human' as const) : ('bot' as const),
        updatedAt: now(),
      };
      const message: InboxMessageDto = {
        id: nextMessageId(),
        conversationId: id,
        direction: 'outbound',
        sender: actorId ? 'human' : 'bot',
        senderName: actorId ? senderName : null,
        text: input.text,
        attachments: [...(input.attachments ?? [])],
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
      { text: input.text, attachments: input.attachments },
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

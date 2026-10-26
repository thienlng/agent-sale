import type { ImageInput } from '@agent-sales/ai-core';
import type { NormalizedEvent } from '@agent-sales/channels';
import { FanpageCommentProcessor } from './fanpage-comment.processor.js';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CHANNEL_FACADE,
  MAX_EVENT_ATTEMPTS,
  type ChannelFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade } from '../../../ai/api/index.js';
import {
  BOT_FACADE,
  type BotFacade,
  type BotView,
  withinReplySchedule,
} from '../../../bot/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../api/conversation.facade.js';
import type { ConversationDto, InboxMessageDto } from '@agent-sales/contracts';
import { BOT_IMAGE_VISION, IMAGE_FETCHER, type ImageFetcher } from '../ports/image-fetcher.js';
import { splitReply } from '../../domain/reply-split.js';
import { toReplyTurns } from './reply-turns.js';

const MAX_VISION_IMAGES = 3;
const MAX_BOT_IMAGES = 3;
/** Meta shows "typing…" for about 20 s; refresh it while the model is still working. */
const TYPING_REFRESH_MS = 10_000;
/** An answer is dropped for newer customer messages at most this often per event (no starvation). */
const MAX_SUPERSEDES = 2;

const isCustomerContent = (e: NormalizedEvent): boolean =>
  e.type === 'message' && Boolean(e.text?.trim() || e.attachments?.length);

function handoffText(bot: BotView): string {
  return (
    bot.handoffMessage.trim() ||
    (bot.language === 'en'
      ? "I've passed your conversation to our staff. They'll reply shortly."
      : `Dạ, ${bot.selfPronoun} đã chuyển cho nhân viên hỗ trợ, ${bot.customerPronoun} đợi một chút ạ.`)
  );
}

const MESSAGING_WINDOW_MS = 24 * 3_600_000;

/** Invoked exclusively by the agent entry; API never starts background inference. */
@Injectable()
export class MetaInboxProcessor {
  private readonly logger = new Logger(MetaInboxProcessor.name);
  private readonly superseded = new Map<string, number>();
  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(CONVERSATION_FACADE) private readonly inbox: ConversationFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(IMAGE_FETCHER) private readonly images: ImageFetcher,
    @Inject(BOT_IMAGE_VISION) private readonly vision: boolean,
    @Inject(FanpageCommentProcessor)
    @Optional()
    private readonly comments?: FanpageCommentProcessor,
  ) {}
  async tick(): Promise<void> {
    const dead = await this.channels.deadLetterExhaustedEvents();
    if (dead.length)
      this.logger.error(
        `Meta inbox dead-lettered ${dead.length} exhausted event(s): ${dead.join(', ')}`,
      );
    const jobs = await this.channels.claimEvents(25);
    const groups = new Map<string, { conversationId: string; jobs: PendingMetaEvent[] }>();
    // Persist every receipt first: a burst produces one coherent context, and external staff echoes pause it.
    for (const job of jobs) {
      if (job.event.type === 'comment') {
        try {
          if (!this.comments) throw new Error('Comment processor unavailable');
          if (!(await this.channels.renewEvent(job.id, job.claimToken))) continue;
          await this.comments.process(job);
          await this.channels.completeEvent(job.id, job.claimToken);
        } catch {
          this.failed(job);
          if (job.attempt >= MAX_EVENT_ATTEMPTS) {
            await this.comments?.failed(job).catch(() => undefined);
            await this.deadLetter(job);
          } else await this.retrySoon(job);
        }
        continue;
      }
      try {
        const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
        // Fire and forget: a slow or failing Meta profile call must not delay a reply.
        if (job.event.type === 'message')
          void this.inbox.refreshCustomerProfile(job.workspaceId, c.id);
        const key = `${job.workspaceId}/${c.id}`;
        const group = groups.get(key) ?? { conversationId: c.id, jobs: [] };
        group.jobs.push(job);
        groups.set(key, group);
      } catch {
        this.failed(job);
        // Not even stored in a conversation, so there is nobody to hand over to: keep it as a
        // dead letter (payload preserved) instead of leaving it unclaimable forever.
        if (job.attempt >= MAX_EVENT_ATTEMPTS) await this.deadLetter(job);
        else await this.retrySoon(job);
      }
    }
    for (const { conversationId, jobs: group } of groups.values()) {
      // `group` is in claim order (= receipt order), which is also the order `receive` stored the
      // messages in. Meta timestamps are never used to pick the newest: they can disagree with arrival.
      // The newest customer message answers for the burst; a trailing echo must not swallow it.
      const latest = group.findLast((j) => isCustomerContent(j.event)) ?? group.at(-1);
      if (!latest) continue;
      for (const job of group)
        if (job !== latest) await this.channels.completeEvent(job.id, job.claimToken);
      if (!(await this.channels.renewEvent(latest.id, latest.claimToken))) continue;
      try {
        if ((await this.process(latest)) === 'requeue')
          await this.channels.requeueEvent(latest.id, latest.claimToken);
        else {
          this.superseded.delete(latest.id);
          await this.channels.completeEvent(latest.id, latest.claimToken);
        }
      } catch {
        this.superseded.delete(latest.id);
        this.failed(latest);
        if (latest.attempt >= MAX_EVENT_ATTEMPTS) await this.handOver(latest, conversationId);
        else await this.retrySoon(latest);
      }
    }
  }
  /** The last retry failed: give the customer a human instead of silently dropping the message. */
  private async handOver(job: PendingMetaEvent, conversationId: string): Promise<void> {
    try {
      await this.inbox.handOff(job.workspaceId, conversationId, 'system');
      await this.channels.completeEvent(job.id, job.claimToken);
    } catch {
      this.logger.error(`Meta inbox handover after final retry failed for event ${job.id}`);
      await this.deadLetter(job);
    }
  }
  private async deadLetter(job: PendingMetaEvent): Promise<void> {
    this.logger.error(`Meta inbox event ${job.id} dead-lettered after ${job.attempt} attempts`);
    await this.channels.deadLetterEvent(job.id, job.claimToken).catch(() => undefined);
  }
  private failed(job: PendingMetaEvent): void {
    this.logger.warn(
      `Meta inbox event ${job.id} failed (attempt ${job.attempt}/${MAX_EVENT_ATTEMPTS})`,
    );
  }
  /** Short backoff (20s, then 60s) so a customer reaches a human within minutes, not lease windows. */
  private async retrySoon(job: PendingMetaEvent): Promise<void> {
    await this.channels
      .releaseEvent(job.id, job.claimToken, job.attempt <= 1 ? 20_000 : 60_000)
      .catch(() => undefined);
  }
  async process(job: PendingMetaEvent): Promise<'requeue' | void> {
    const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
    if (job.event.type !== 'message' || !isCustomerContent(job.event))
      return this.skip(job, 'not a customer message');
    if (c.mode !== 'bot' || c.status !== 'open') return this.skip(job, 'conversation not on bot');
    const channel = await this.channels.getConnection(job.workspaceId, job.connectionId);
    // Re-auth pending: the message is stored for staff, but the bot cannot send.
    if (!channel.botId || channel.status !== 'connected')
      return this.skip(job, 'no bot or connection not connected');
    const bot = await this.bots.getBot(job.workspaceId, channel.botId);
    if (!bot.isActive) return this.skip(job, 'bot inactive');
    // Meta only lets us answer within 24 h of the customer's message; a late event (an outage, a
    // long retry) is left for staff instead of spending an AI call on a reply that cannot be sent.
    if (Date.now() - job.event.occurredAt.getTime() >= MESSAGING_WINDOW_MS)
      return this.skip(job, 'messaging window closed');
    // Outside the bot's reply hours the message stays in the inbox for staff.
    if (bot.replySchedule && !withinReplySchedule(bot.replySchedule, new Date()))
      return this.skip(job, 'outside reply hours');
    const context = await this.inbox.getReplyContext(job.workspaceId, c.id);
    // Ids are monotonic (see nextMessageId), so they order messages by when we stored them rather
    // than by Meta timestamps or the store's createdAt order. This is the single notion of "arrival".
    // Outbound messages of every status stay: a failed, pending or unknown reply is still an
    // attempt to answer, so it bounds the customer turn and stops a retry from answering twice.
    const stored = [...context.messages].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newest = stored.findLast(
      (m) => m.direction === 'inbound' && (m.text.trim() || m.attachments.length),
    );
    if (
      stored.at(-1)?.direction !== 'inbound' ||
      newest?.externalId !== (job.event.externalMessageId ?? job.event.externalEventId)
    )
      return this.skip(job, 'already answered or attempted, or a newer message will answer');
    if (context.conversation.mode !== 'bot' || context.conversation.status !== 'open')
      return this.skip(job, 'conversation control changed');
    const key = `bot:${job.event.externalEventId}`;
    const stopTyping = this.showTyping(job);
    try {
      return await this.answer(job, c, channel.botId, bot, context, stored, key);
    } finally {
      stopTyping();
    }
  }

  /** "Seen", then "typing…" until the answer is out: the customer sees the bot at work at once. */
  private showTyping(job: PendingMetaEvent): () => void {
    const { workspaceId: ws, connectionId } = job;
    const to = job.event.senderExternalId;
    let stopped = false;
    const typing = () =>
      stopped ? Promise.resolve() : this.channels.presence(ws, connectionId, to, 'typing_on');
    void this.channels
      .presence(ws, connectionId, to, 'mark_seen')
      .then(typing)
      .catch(() => undefined);
    const timer = setInterval(() => void typing().catch(() => undefined), TYPING_REFRESH_MS);
    return () => {
      // A slow "seen" must not be followed by a "typing…" after the answer is already out.
      stopped = true;
      clearInterval(timer);
    };
  }

  private async answer(
    job: PendingMetaEvent,
    c: ConversationDto,
    botId: string,
    bot: BotView,
    context: Awaited<ReturnType<ConversationFacade['getReplyContext']>>,
    stored: InboxMessageDto[],
    key: string,
  ): Promise<'requeue' | void> {
    const lastReply = stored.findLastIndex((m) => m.direction === 'outbound');
    const pending = stored.slice(lastReply + 1);
    const hasText = pending.some((m) => m.direction === 'inbound' && m.text.trim());
    const fetched = await this.fetchImages(pending);
    if (!hasText && !fetched.images.length) {
      // Only media the model cannot see (vision off, or nothing could be fetched): staff take over.
      const result = await this.inbox.commitBotReply(job.workspaceId, c.id, {
        revision: context.revision,
        text: handoffText(bot),
        idempotencyKey: key,
      });
      if (result) await this.inbox.handOff(job.workspaceId, c.id, c.assigneeId ?? 'system');
      return;
    }
    // One customer turn per burst: every question after the last reply reaches the model together.
    const provenance = await this.comments?.privateContext(
      job.workspaceId,
      job.connectionId,
      job.event.senderExternalId,
    );
    if (provenance && (provenance.status === 'ambiguous' || provenance.status === 'unavailable')) {
      const result = await this.inbox.commitBotReply(job.workspaceId, c.id, {
        revision: context.revision,
        text: handoffText(bot),
        idempotencyKey: key,
      });
      if (result) await this.inbox.handOff(job.workspaceId, c.id, c.assigneeId ?? 'system');
      return;
    }
    const postContext = provenance?.context;
    const ask = (images: ImageInput[], seen: ReadonlySet<string>) =>
      this.ai.reply(
        job.workspaceId,
        botId,
        {
          messages: toReplyTurns(stored, seen),
          ...(images.length ? { images } : {}),
          ...(postContext ? { postContext } : {}),
        },
        { conversationId: c.id, isTest: false },
      );
    let response;
    try {
      response = await ask(fetched.images, fetched.seen);
    } catch (error) {
      // A provider without vision (or a busy bridge) must not lose the text of the turn.
      if (!fetched.images.length) throw error;
      this.logger.warn(`Meta inbox event ${job.id}: reply with images failed, retrying text-only`);
      if (!hasText) throw error;
      response = await ask([], new Set());
    }
    // The customer wrote again while the model was thinking: this answer is already stale. Hand the
    // event back so the next claim answers the whole burst once, instead of two answers in a row.
    if (await this.hasNewerMessage(job)) {
      const times = this.superseded.get(job.id) ?? 0;
      if (times < MAX_SUPERSEDES) {
        this.superseded.set(job.id, times + 1);
        this.logger.log(
          `Meta inbox event ${job.id}: newer message arrived, answering them together`,
        );
        return 'requeue';
      }
    }
    this.superseded.delete(job.id);
    const bubbles = splitReply(response.reply.slice(0, 2000));
    let result = await this.inbox.commitBotReply(job.workspaceId, c.id, {
      revision: context.revision,
      text: bubbles[0] ?? response.reply,
      idempotencyKey: key,
    });
    // Later bubbles stop at the first one that is not delivered, or when the customer wrote again
    // (the rest of this answer would be out of date), or when a human took over.
    for (const [index, text] of bubbles.slice(1).entries()) {
      if (result?.status !== 'sent' || (await this.hasNewerMessage(job))) break;
      void this.channels
        .presence(job.workspaceId, job.connectionId, job.event.senderExternalId, 'typing_on')
        .catch(() => undefined);
      result = await this.inbox.commitBotFollowUp(job.workspaceId, c.id, {
        text,
        idempotencyKey: `${key}:t${index + 2}`,
      });
    }
    if (result && result.status !== 'sent')
      this.logger.warn(
        `Meta inbox event ${job.id}: a bubble was not delivered (${result.status}), the answer is incomplete`,
      );
    if (result && response.outcome === 'handoff')
      await this.inbox.handOff(job.workspaceId, c.id, c.assigneeId ?? 'system');
    if (result?.status === 'sent' && response.outcome === 'answered')
      await this.sendImages(job, c.id, response.images ?? []);
  }

  private hasNewerMessage(job: PendingMetaEvent): Promise<boolean> {
    return this.channels
      .hasNewerCustomerEvent(job.connectionId, job.event.senderExternalId, job.id)
      .catch(() => false);
  }

  /**
   * The pictures that follow a committed text reply, as ONE album message (a single picture stays
   * a plain image). Best effort: a failure is recorded on the message and never fails the event,
   * hands over or retries, and a closed 24-hour window or a takeover simply leaves the text alone.
   */
  private async sendImages(
    job: PendingMetaEvent,
    conversationId: string,
    images: readonly { url: string }[],
  ): Promise<void> {
    const urls = [...new Set(images.map((i) => i.url))].slice(0, MAX_BOT_IMAGES);
    if (!urls.length || (await this.hasNewerMessage(job))) return;
    try {
      const sent = await this.inbox.commitBotImages(job.workspaceId, conversationId, {
        urls,
        idempotencyKey: `bot:${job.event.externalEventId}:img`,
      });
      // Null: a human took over (or the bot was switched off) since the text went out.
      if (!sent)
        this.logger.log(
          `Meta inbox event ${job.id}: images skipped, the bot no longer holds the conversation`,
        );
    } catch {
      this.logger.warn(`Meta inbox event ${job.id}: images not sent`);
    }
  }

  /**
   * The newest image attachments of the pending customer turn (max 3), downloaded for the model.
   * Never throws: any failure leaves the image out and the turn degrades to the text-only note.
   */
  private async fetchImages(
    pending: readonly {
      direction: string;
      attachments: readonly { type: string; url: string }[];
    }[],
  ): Promise<{ images: ImageInput[]; seen: Set<string> }> {
    const result = { images: [] as ImageInput[], seen: new Set<string>() };
    if (!this.vision) return result;
    const urls = pending
      .filter((m) => m.direction === 'inbound')
      .flatMap((m) => m.attachments.filter((a) => a.type === 'image').map((a) => a.url))
      .reverse()
      .slice(0, MAX_VISION_IMAGES);
    const downloads = await Promise.all(
      urls.map((url) => this.images.fetch(url).catch(() => null)),
    );
    let total = 0;
    downloads.forEach((image, i) => {
      const url = urls[i];
      const size = image ? Math.floor((image.base64.length * 3) / 4) : 0;
      if (!image || !url || total + size > 6_000_000) return;
      total += size;
      result.images.push(image);
      result.seen.add(url);
    });
    return result;
  }

  /** A customer message with nothing to answer is never silent: the reason is logged. */
  private skip(job: PendingMetaEvent, reason: string): void {
    this.logger.log(`Meta inbox event ${job.id} not answered by the bot: ${reason}`);
  }
}

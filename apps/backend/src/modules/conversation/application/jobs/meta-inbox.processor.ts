import type { ImageInput } from '@agent-sales/ai-core';
import { withinReplyWindow } from '@agent-sales/channels';
import { FanpageCommentProcessor } from './fanpage-comment.processor.js';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CHANNEL_FACADE,
  MAX_EVENT_ATTEMPTS,
  type ChannelFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade, type ReplyResult } from '../../../ai/api/index.js';
import { BILLING_FACADE, type BillingFacade } from '../../../billing/api/index.js';
import { BOT_FACADE, type BotFacade, withinReplySchedule } from '../../../bot/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../api/conversation.facade.js';
import type { PlaygroundRequest } from '@agent-sales/contracts';
import { BOT_IMAGE_VISION, IMAGE_FETCHER, type ImageFetcher } from '../ports/image-fetcher.js';
import { toTimedReplyTurns } from './reply-turns.js';
import {
  errorClass,
  fallbackText,
  fetchTurnImages,
  finalMessage,
  handoffText,
  isCustomerContent,
  REPLY_PACING,
  ReplyDelivery,
  type ReplyPacing,
  realPacing,
  showTyping,
} from './reply-delivery.js';
import {
  MAX_INTERRUPT_RERUNS,
  nextResume,
  ResumeStore,
  startTurn,
  turnOwner,
  type Turn,
} from './reply-resume.js';

/** Invoked exclusively by the agent entry; API never starts background inference. */
@Injectable()
export class MetaInboxProcessor {
  private readonly logger = new Logger(MetaInboxProcessor.name);
  private readonly resumes = new ResumeStore();
  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(CONVERSATION_FACADE) private readonly inbox: ConversationFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
    @Inject(IMAGE_FETCHER) private readonly images: ImageFetcher,
    @Inject(BOT_IMAGE_VISION) private readonly vision: boolean,
    @Inject(FanpageCommentProcessor)
    @Optional()
    private readonly comments?: FanpageCommentProcessor,
    @Inject(REPLY_PACING)
    @Optional()
    private readonly pacing: ReplyPacing = realPacing,
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
        else await this.channels.completeEvent(latest.id, latest.claimToken);
      } catch {
        this.resumes.take(latest.workspaceId, conversationId);
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
    // An echo (e.g. of the interrupted run's own send) leaves the pending re-run alone.
    if (job.event.type !== 'message' || !isCustomerContent(job.event))
      return this.skip(job, 'not a customer message');
    // Taken now so every skip below drops it: a later, unrelated turn must not inherit it.
    const taken = this.resumes.take(job.workspaceId, c.id);
    if (c.mode !== 'bot' || c.status !== 'open') return this.skip(job, 'conversation not on bot');
    const channel = await this.channels.getConnection(job.workspaceId, job.connectionId);
    // Re-auth pending: the message is stored for staff, but the bot cannot send.
    if (!channel.botId || channel.status !== 'connected')
      return this.skip(job, 'no bot or connection not connected');
    const bot = await this.bots.getBot(job.workspaceId, channel.botId);
    if (!bot.isActive) return this.skip(job, 'bot inactive');
    // Meta only lets us answer within 24 h of the customer's message; a late event (an outage, a
    // long retry) is left for staff instead of spending an AI call on a reply that cannot be sent.
    if (!withinReplyWindow(job.event.kind, job.event.occurredAt))
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
    const owner = turnOwner(stored, job.event.externalMessageId ?? job.event.externalEventId);
    if (owner !== 'own') {
      if (owner === 'newer' && taken) this.resumes.put(job.workspaceId, c.id, taken); // newer run keeps it
      return this.skip(job, 'already answered or attempted, or a newer message will answer');
    }
    if (context.conversation.mode !== 'bot' || context.conversation.status !== 'open')
      return this.skip(job, 'conversation control changed');
    const key = `bot:${job.event.externalEventId}`;
    const { resume, history } = startTurn(taken, stored);
    const turn: Turn = {
      job,
      c,
      botId: channel.botId,
      bot,
      context,
      stored: history,
      newestId: stored.at(-1)?.id ?? '',
      key,
      resume,
    };
    const stopTyping = showTyping(this.channels, job);
    try {
      return await this.answer(turn);
    } finally {
      stopTyping();
    }
  }

  /** The bot's hand-over message, then staff take over (no AI call). */
  private async handOffWithMessage(turn: Turn): Promise<void> {
    const { job, c, bot, context, key } = turn;
    const result = await this.inbox.commitBotReply(job.workspaceId, c.id, {
      revision: context.revision,
      text: handoffText(bot),
      idempotencyKey: key,
    });
    if (result) await this.inbox.handOff(job.workspaceId, c.id, c.assigneeId ?? 'system');
  }

  private async answer(turn: Turn): Promise<'requeue' | void> {
    const { job, c, botId, stored, key } = turn;
    const lastReply = stored.findLastIndex((m) => m.direction === 'outbound');
    const pending = stored.slice(lastReply + 1);
    const hasText = pending.some((m) => m.direction === 'inbound' && m.text.trim());
    const fetched = await fetchTurnImages(this.vision ? this.images : null, pending);
    // Only media the model cannot see (vision off, or nothing could be fetched): staff take over.
    if (!hasText && !fetched.images.length) return this.handOffWithMessage(turn);
    // One customer turn per burst: every question after the last reply reaches the model together.
    const provenance = await this.comments?.privateContext(
      job.workspaceId,
      job.connectionId,
      job.event.senderExternalId,
    );
    if (provenance && (provenance.status === 'ambiguous' || provenance.status === 'unavailable'))
      return this.handOffWithMessage(turn);
    // ADR-012 §5: the account's allowance is taken before the model runs. Exhausted: the bot
    // stops and staff take over, with the bot's hand-off message for the customer.
    const quota = await this.billing.reserveReply(job.workspaceId, {
      idempotencyKey: key,
      conversationId: c.id,
      botId,
    });
    if (!quota.allowed) {
      this.logger.warn(
        `Meta inbox event ${job.id}: message allowance exhausted until ${quota.cycleEnd.toISOString()}, handing off`,
      );
      return this.handOffWithMessage(turn);
    }
    const delivery = new ReplyDelivery(
      { inbox: this.inbox, channels: this.channels, logger: this.logger, pacing: this.pacing },
      {
        job,
        conversationId: c.id,
        revision: turn.context.revision,
        key,
        watchNewer: turn.resume.reruns < MAX_INTERRUPT_RERUNS,
      },
    );
    try {
      return await this.generate(turn, delivery, {
        hasText,
        fetched,
        postContext: provenance?.context,
      });
    } finally {
      // Billed once per delivered answer, whatever happens after it (see ReplyDelivery.billing).
      const billing = delivery.billing;
      await (
        billing === 'capture'
          ? this.billing.captureReply(job.workspaceId, key)
          : billing === 'release'
            ? this.billing.releaseReply(job.workspaceId, key)
            : Promise.resolve()
      ).catch(() =>
        this.logger.error(`Meta inbox event ${job.id}: the message meter was not updated`),
      );
    }
  }

  /**
   * One agent run: `send_message` output goes out through the turn's sink as it happens, the
   * final answer after the run. A newer customer message interrupts the run (or drops a finished
   * answer that is not out yet, never a hand-off) and hands the event back with the run's tool work,
   * so the next claim re-runs the turn with every customer message; at most MAX_INTERRUPT_RERUNS
   * times per burst. A dropped final also drops the confirmation question it may have asked.
   */
  private async generate(
    turn: Turn,
    delivery: ReplyDelivery,
    input: {
      hasText: boolean;
      fetched: { images: ImageInput[]; seen: Set<string> };
      postContext: PlaygroundRequest['postContext'] | null | undefined;
    },
  ): Promise<'requeue' | void> {
    const { job, c, botId, bot, context, stored, resume } = turn;
    const { hasText, fetched, postContext } = input;
    const finishing = resume.reruns >= MAX_INTERRUPT_RERUNS;
    const ask = (images: ImageInput[], seen: ReadonlySet<string>) => {
      const history = toTimedReplyTurns(stored, seen);
      return this.ai.reply(
        job.workspaceId,
        botId,
        {
          messages: history.turns,
          ...(images.length ? { images } : {}),
          ...(postContext ? { postContext } : {}),
          ...(context.conversation.lead ? { phoneKnown: true } : {}),
        },
        {
          conversationId: c.id,
          isTest: false,
          channel: c.provider,
          sink: delivery.sink(),
          // The last allowed re-run gets no interrupt check: it runs to completion.
          ...(finishing ? {} : { shouldInterrupt: () => this.shouldInterrupt(turn, delivery) }),
          ...(resume.carry ? { carry: resume.carry } : {}),
          turnTimes: history.times,
        },
      );
    };
    let response: ReplyResult;
    try {
      response = await ask(fetched.images, fetched.seen);
    } catch (error) {
      // A provider without vision (or a busy bridge) must not lose the text of the turn.
      if (!fetched.images.length || delivery.attempted) throw error;
      this.logger.warn(`Meta inbox event ${job.id}: reply with images failed, retrying text-only`);
      if (!hasText) throw error;
      response = await ask([], new Set());
    }
    // Nothing went out because the first send failed: retry the event (then staff) as before.
    if (delivery.stop === 'failed' && !delivery.attempted) throw delivery.failure;
    // A created order is never re-run or dropped (it exists now): its final goes out whole.
    if (response.interrupted && !finishing && !response.orderCreated) {
      // A takeover (or bot off) also interrupts, but nobody is waiting for a new turn.
      if (!(await this.inbox.botHolds(job.workspaceId, c.id).catch(() => true)))
        return this.skip(job, 'conversation control changed during the turn');
      return this.rerun(turn, delivery, response.carry, 'interrupted by a newer message');
    }
    const handoff = response.outcome === 'handoff';
    // A hand-off (or a created order) is never dropped: its message goes out whole.
    if (handoff || response.orderCreated) delivery.stopWatchingNewer();
    else if (!finishing && !delivery.takenOver) {
      // The customer wrote again after the run: its final answer is already stale.
      if (await delivery.hasNewerMessage()) {
        await this.discardConfirmation(turn, response);
        return this.rerun(turn, delivery, undefined, 'newer message arrived');
      }
      // The newer message that stopped the sends is gone (or unreadable): finish the answer.
      delivery.clearNewerStop();
    }
    const final = finalMessage(response);
    if (final.text.trim() || final.images.length) {
      if (!(await delivery.sendFinal(final.text, final.images, response.outcome === 'answered')))
        await this.discardConfirmation(turn, response);
    } else if (!delivery.attempted)
      // Nothing sent at all: the customer is never left without an answer.
      await delivery.sendFinal(handoff ? handoffText(bot) : fallbackText(bot), [], false);
    if (delivery.attempted && !delivery.takenOver && handoff)
      await this.inbox.handOff(job.workspaceId, c.id, c.assigneeId ?? 'system');
  }

  /** A final that never went out may hold a confirmation question: it must not stay pending. */
  private async discardConfirmation({ job, c }: Turn, response: ReplyResult): Promise<void> {
    if (response.askedConfirmation)
      await this.ai
        .discardPendingConfirmation(job.workspaceId, c.id)
        .catch(() => this.logger.warn(`Meta inbox event ${job.id}: confirmation not cleared`));
  }

  /** Spec §7: a newer customer message after the turn's event, or the bot lost the conversation. */
  private async shouldInterrupt(turn: Turn, delivery: ReplyDelivery): Promise<boolean> {
    if (await delivery.hasNewerMessage()) return true;
    // Fails open like the post-run check: an unreadable control state never interrupts (the
    // sends themselves still stop on a takeover).
    return !(await this.inbox.botHolds(turn.job.workspaceId, turn.c.id).catch((error: unknown) => {
      this.logger.warn(
        `Meta inbox event ${turn.job.id}: control check failed (${errorClass(error)})`,
      );
      return true;
    }));
  }

  /** Hands the event back; the next claim (with the new messages) re-runs the turn. */
  private rerun(
    turn: Turn,
    delivery: ReplyDelivery,
    freshCarry: ReplyResult['carry'],
    reason: string,
  ): 'requeue' {
    const { job, c } = turn;
    const newest = delivery.lastId ?? turn.newestId;
    this.resumes.put(job.workspaceId, c.id, nextResume(turn.resume, freshCarry, newest));
    this.logger.log(`Meta inbox event ${job.id}: ${reason}, answering them together`);
    return 'requeue';
  }

  /** A customer message with nothing to answer is never silent: the reason is logged. */
  private skip(job: PendingMetaEvent, reason: string): void {
    this.logger.log(`Meta inbox event ${job.id} not answered by the bot: ${reason}`);
  }
}

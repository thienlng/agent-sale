import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHANNEL_FACADE,
  MAX_EVENT_ATTEMPTS,
  type ChannelFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade } from '../../../ai/api/index.js';
import { BOT_FACADE, type BotFacade, withinReplySchedule } from '../../../bot/api/index.js';
import { CONVERSATION_FACADE, type ConversationFacade } from '../../api/conversation.facade.js';
/** Invoked exclusively by the agent entry; API never starts background inference. */
@Injectable()
export class MetaInboxProcessor {
  private readonly logger = new Logger(MetaInboxProcessor.name);
  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(CONVERSATION_FACADE) private readonly inbox: ConversationFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
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
      try {
        const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
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
      group.sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime());
      // Answer the newest customer text: a trailing echo or attachment-only event must not swallow it.
      const latest =
        group.findLast((j) => j.event.type === 'message' && j.event.text?.trim()) ?? group.at(-1);
      if (!latest) continue;
      for (const job of group)
        if (job !== latest) await this.channels.completeEvent(job.id, job.claimToken);
      if (!(await this.channels.renewEvent(latest.id, latest.claimToken))) continue;
      try {
        await this.process(latest);
        await this.channels.completeEvent(latest.id, latest.claimToken);
      } catch {
        this.failed(latest);
        if (latest.attempt >= MAX_EVENT_ATTEMPTS) await this.handOver(latest, conversationId);
        else await this.retrySoon(latest);
      }
    }
  }
  /** The last retry failed: give the customer a human instead of silently dropping the message. */
  private async handOver(job: PendingMetaEvent, conversationId: string): Promise<void> {
    try {
      await this.inbox.update(job.workspaceId, conversationId, { mode: 'human' }, 'system');
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
  async process(job: PendingMetaEvent): Promise<void> {
    const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
    if (job.event.type !== 'message' || !job.event.text || c.mode !== 'bot' || c.status !== 'open')
      return;
    const channel = await this.channels.getConnection(job.workspaceId, job.connectionId);
    // Re-auth pending: the message is stored for staff, but the bot cannot send.
    if (!channel.botId || channel.status !== 'connected') return;
    const bot = await this.bots.getBot(job.workspaceId, channel.botId);
    if (!bot.isActive) return;
    // Outside the bot's reply hours the message stays in the inbox for staff.
    if (bot.replySchedule && !withinReplySchedule(bot.replySchedule, new Date())) return;
    const context = await this.inbox.getReplyContext(job.workspaceId, c.id);
    // Ids are UUIDv7, so they order messages by when we stored them rather than by Meta timestamps.
    // An inbound stored after our last reply is still unanswered, even if the customer sent it earlier.
    const stored = [...context.messages]
      .filter((m) => m.status !== 'failed')
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const latestText = stored.findLast((m) => m.direction === 'inbound' && m.text.trim());
    if (
      stored.at(-1)?.direction !== 'inbound' ||
      latestText?.externalId !== job.event.externalMessageId
    )
      return;
    if (context.conversation.mode !== 'bot' || context.conversation.status !== 'open') return;
    const messages = context.messages
      // Media-only turns stay in context as a marker so the model knows the customer sent something.
      .map((m) =>
        m.text.trim() || !m.attachments[0] ? m : { ...m, text: `[${m.attachments[0].type}]` },
      )
      .filter((m) => m.text.trim() && (m.direction === 'inbound' || m.status === 'sent'))
      .slice(-20)
      .map((m) => ({
        role: m.sender === 'customer' ? ('customer' as const) : ('bot' as const),
        content: m.text.slice(0, 2000),
      }));
    const response = await this.ai.reply(
      job.workspaceId,
      channel.botId,
      { messages },
      { conversationId: c.id, isTest: false },
    );
    const result = await this.inbox.commitBotReply(job.workspaceId, c.id, {
      revision: context.revision,
      text: response.reply.slice(0, 2000),
      idempotencyKey: `bot:${job.event.externalEventId}`,
    });
    if (result && response.outcome === 'handoff')
      await this.inbox.update(job.workspaceId, c.id, { mode: 'human' }, c.assigneeId ?? 'system');
  }
}

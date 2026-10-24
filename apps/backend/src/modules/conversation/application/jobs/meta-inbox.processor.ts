import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CHANNEL_FACADE,
  type ChannelFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade } from '../../../ai/api/index.js';
import { BOT_FACADE, type BotFacade } from '../../../bot/api/index.js';
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
    const jobs = await this.channels.claimEvents(25);
    const groups = new Map<string, PendingMetaEvent[]>();
    // Persist every receipt first: a burst produces one coherent context, and external staff echoes pause it.
    for (const job of jobs) {
      try {
        const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
        const key = `${job.workspaceId}/${c.id}`;
        const group = groups.get(key) ?? [];
        group.push(job);
        groups.set(key, group);
      } catch {
        this.failed(job);
      }
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.event.occurredAt.getTime() - b.event.occurredAt.getTime());
      const latest = group.at(-1);
      if (!latest) continue;
      for (const job of group.slice(0, -1))
        await this.channels.completeEvent(job.id, job.claimToken);
      if (!(await this.channels.renewEvent(latest.id, latest.claimToken))) continue;
      try {
        await this.process(latest);
        await this.channels.completeEvent(latest.id, latest.claimToken);
      } catch {
        this.failed(latest);
      }
    }
  }
  private failed(job: PendingMetaEvent): void {
    this.logger.warn(
      { eventId: job.id },
      'Meta inbox processing failed; lease will expire before bounded retry',
    );
  }
  async process(job: PendingMetaEvent): Promise<void> {
    const c = await this.inbox.receive(job.workspaceId, job.connectionId, job.event);
    if (job.event.type !== 'message' || !job.event.text || c.mode !== 'bot' || c.status !== 'open')
      return;
    const channel = await this.channels.getConnection(job.workspaceId, job.connectionId);
    if (!channel.botId) return;
    const bot = await this.bots.getBot(job.workspaceId, channel.botId);
    if (!bot.isActive) return;
    const context = await this.inbox.getReplyContext(job.workspaceId, c.id);
    // An older event cannot trigger a reply after a newer inbound or an already reserved outbound.
    const latest = context.messages.at(-1);
    if (
      !latest ||
      latest.externalId !== job.event.externalMessageId ||
      latest.direction !== 'inbound'
    )
      return;
    if (context.conversation.mode !== 'bot' || context.conversation.status !== 'open') return;
    const messages = context.messages
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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId, foldVietnamese, exposesContactDetails } from '@agent-sales/shared';
import {
  CHANNEL_FACADE,
  FANPAGE_FACADE,
  type ChannelFacade,
  type FanpageFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade } from '../../../ai/api/index.js';
import { BILLING_FACADE, type BillingFacade } from '../../../billing/api/index.js';
import { BOT_FACADE, type BotFacade, withinReplySchedule } from '../../../bot/api/index.js';
type Comment = Awaited<ReturnType<FanpageFacade['receive']>>;
type CommentContext = NonNullable<Awaited<ReturnType<FanpageFacade['context']>>>;
type CommentSettings = Awaited<ReturnType<FanpageFacade['settings']>>;

/** Comments are independent jobs, never collapsed into a customer's Messenger burst. */
@Injectable()
export class FanpageCommentProcessor {
  private readonly logger = new Logger(FanpageCommentProcessor.name);
  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(FANPAGE_FACADE) private readonly pages: FanpageFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
  ) {}
  async privateContext(
    ws: Parameters<FanpageFacade['privateContext']>[0],
    id: string,
    recipientId: string,
  ) {
    if ((await this.channels.getConnection(ws, id)).provider !== 'facebook')
      return { status: 'none' as const, context: null };
    return this.pages.privateContext(ws, id, recipientId);
  }
  async failed(job: PendingMetaEvent): Promise<void> {
    const page = await this.channels.getConnection(job.workspaceId, job.connectionId);
    if (job.event.senderExternalId === page.externalId) return;
    const comment = await this.pages.receive(job.workspaceId, job.connectionId, job.event);
    await this.pages.review(job.workspaceId, job.connectionId, comment.commentId, comment.version);
  }
  async process(job: PendingMetaEvent): Promise<void> {
    const { workspaceId: ws, connectionId: id, event } = job;
    const page = await this.channels.getConnection(ws, id);
    if (event.senderExternalId === page.externalId) {
      await this.pages.pageReply(ws, id, event);
      return;
    }
    const comment = await this.pages.receive(ws, id, event);
    const operation = event.comment?.operation;
    if (comment.deleted || (operation !== 'add' && operation !== 'edited')) return;
    const connection = await this.channels.getConnection(ws, id);
    if (connection.status !== 'connected') return;
    const settings = await this.pages.settings(ws, id);
    if (settings.excludedPostIds.includes(comment.postId)) return;
    // Hiding by keyword protects the page whether or not a bot is bound or within its schedule.
    const keyword = settings.hideComments
      ? settings.hideKeywords.find((k) => foldVietnamese(comment.text).includes(foldVietnamese(k)))
      : undefined;
    if (keyword) {
      await this.pages.act(ws, id, comment.commentId, {
        kind: 'hide',
        text: '',
        reason: `Configured keyword: ${keyword}`,
        key: newId(),
        version: comment.version,
        automatic: true,
      });
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    // Replies only answer new comments, never edits.
    if (operation !== 'add' || comment.needsReview || !connection.botId) return;
    const bot = await this.bots.getBot(ws, connection.botId);
    if (!bot.isActive || (bot.replySchedule && !withinReplySchedule(bot.replySchedule, new Date())))
      return;
    if (!settings.publicReplies && !settings.privateReplies) return;
    const context = await this.pages.context(ws, id, comment.commentId, comment.version);
    if (
      !context ||
      (!context.text.trim() && !context.media.some((m) => m.title || m.description))
    ) {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    if (!comment.text.trim()) {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    // An automatic comment reply is an AI reply to a customer: metered like inbox replies
    // (ADR-012 §5). Exhausted: the comment waits for staff in the review queue.
    const key = `comment:${comment.commentId}`;
    const quota = await this.billing.reserveReply(ws, {
      idempotencyKey: key,
      conversationId: null,
      botId: connection.botId,
    });
    if (!quota.allowed) {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    // Counted as soon as one reply is posted, even if the second one (private) fails.
    const progress = { posted: false };
    try {
      await this.answer(job, connection.botId, { comment, context, settings }, progress);
    } finally {
      // A meter failure must neither fail a posted reply (it would be retried) nor hide the
      // original error; an unreleased reservation stops holding allowance after its TTL.
      await (
        progress.posted ? this.billing.captureReply(ws, key) : this.billing.releaseReply(ws, key)
      ).catch(() =>
        this.logger.error(
          `Fanpage comment ${comment.commentId}: the message meter was not updated`,
        ),
      );
    }
  }

  /** Generates and posts the reply, or sends the comment to review when it must not go out. */
  private async answer(
    job: PendingMetaEvent,
    botId: string,
    turn: { comment: Comment; context: CommentContext; settings: CommentSettings },
    progress: { posted: boolean },
  ): Promise<void> {
    const { workspaceId: ws, connectionId: id } = job;
    const { comment, context, settings } = turn;
    const response = await this.ai.reply(
      ws,
      botId,
      {
        messages: [{ role: 'customer', content: comment.text.slice(0, 2000) }],
        postContext: context,
      },
      { conversationId: null, isTest: false },
    );
    if (response.outcome !== 'answered') {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    // Fetch again after inference: edits/deletes during generation invalidate this reply.
    const fresh = await this.pages.context(ws, id, comment.commentId, comment.version);
    const fingerprint = (c: typeof context) =>
      JSON.stringify({ id: c.id, text: c.text, media: c.media, parentText: c.parentText });
    if (!fresh || fingerprint(fresh) !== fingerprint(context)) {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    // Public replies cannot repeat a customer's private contact details.
    if (settings.publicReplies && exposesContactDetails(response.reply)) {
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
    for (const kind of ['public_reply', 'private_reply'] as const) {
      if (!(kind === 'public_reply' ? settings.publicReplies : settings.privateReplies)) continue;
      await this.pages.act(ws, id, comment.commentId, {
        kind,
        text: response.reply.slice(0, 2000),
        reason: 'Grounded originating-post reply',
        key: newId(),
        version: comment.version,
        automatic: true,
        expectedBotId: botId,
      });
      progress.posted = true;
    }
  }
}

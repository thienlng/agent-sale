import { Inject, Injectable } from '@nestjs/common';
import { newId, foldVietnamese } from '@agent-sales/shared';
import {
  CHANNEL_FACADE,
  FANPAGE_FACADE,
  type ChannelFacade,
  type FanpageFacade,
  type PendingMetaEvent,
} from '../../../channel/api/index.js';
import { AI_FACADE, type AiFacade } from '../../../ai/api/index.js';
import { BOT_FACADE, type BotFacade, withinReplySchedule } from '../../../bot/api/index.js';
/** Comments are independent jobs, never collapsed into a customer's Messenger burst. */
@Injectable()
export class FanpageCommentProcessor {
  constructor(
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(FANPAGE_FACADE) private readonly pages: FanpageFacade,
    @Inject(AI_FACADE) private readonly ai: AiFacade,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
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
    if (comment.deleted || event.comment?.operation !== 'add' || comment.needsReview) return;
    const connection = await this.channels.getConnection(ws, id);
    if (connection.status !== 'connected' || !connection.botId) return;
    const bot = await this.bots.getBot(ws, connection.botId);
    if (!bot.isActive || (bot.replySchedule && !withinReplySchedule(bot.replySchedule, new Date())))
      return;
    const settings = await this.pages.settings(ws, id);
    if (settings.excludedPostIds.includes(comment.postId)) return;
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
        expectedBotId: connection.botId,
      });
      await this.pages.review(ws, id, comment.commentId, comment.version);
      return;
    }
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
    const response = await this.ai.reply(
      ws,
      connection.botId,
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
    if (
      settings.publicReplies &&
      /(?:\b0[0-9 .-]{8,14}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(response.reply)
    ) {
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
        expectedBotId: connection.botId,
      });
    }
  }
}

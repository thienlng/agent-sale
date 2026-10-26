import { interruptsComment } from '../domain/comment-interruption.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  FacebookPostsAdapter,
  MetaRequestError,
  type NormalizedEvent,
} from '@agent-sales/channels';
import { FanpageSettings, type FanpageComment, type FanpageAction } from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { getEnv } from '../../../common/config.js';
import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import { BOT_FACADE, type BotFacade, withinReplySchedule } from '../../bot/api/index.js';
import type { FanpageFacade } from '../api/fanpage.facade.js';
import { CHANNEL_STORE, type ChannelStore } from './ports/channel-store.js';
import { FANPAGE_STORE, type FanpageStore } from './ports/fanpage-store.js';
import { ChannelError } from '../domain/channel.errors.js';
@Injectable()
export class FanpageFacadeImpl implements FanpageFacade {
  constructor(
    @Inject(CHANNEL_STORE) private readonly channels: ChannelStore,
    @Inject(FANPAGE_STORE) private readonly store: FanpageStore,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(BOT_FACADE) private readonly bots: BotFacade,
  ) {}
  async pageReply(ws: WorkspaceId, id: string, event: NormalizedEvent) {
    const connection = await this.connection(ws, id);
    if (event.senderExternalId !== connection.externalId || !event.comment?.parentId) return;
    await this.store.change(ws, id, event.comment.parentId, (c) => ({
      comment:
        c && interruptsComment(c, event, connection.externalId)
          ? { ...c, needsReview: true }
          : null,
      result: undefined,
    }));
  }
  async privateContext(ws: WorkspaceId, id: string, recipientId: string) {
    await this.connection(ws, id);
    const matching = await this.store.privateComments(ws, id, recipientId);
    if (!matching.length) return { status: 'none' as const, context: null };
    if (matching.length > 100 || new Set(matching.map((c) => c.postId)).size !== 1)
      return { status: 'ambiguous' as const, context: null };
    const comment = matching[0];
    if (!comment || comment.deleted || !comment.context)
      return { status: 'unavailable' as const, context: null };
    try {
      const context = await this.context(ws, id, comment.commentId, comment.version);
      return { status: context ? ('ready' as const) : ('unavailable' as const), context };
    } catch {
      return { status: 'unavailable' as const, context: null };
    }
  }

  private async readGraph<T>(ws: WorkspaceId, id: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof MetaRequestError) {
        if (error.code === 'auth_expired')
          await this.channels.update(ws, id, { status: 'reauth_required' });
        throw new ChannelError(
          'UNAVAILABLE',
          'Unable to read Facebook content; check page access and permissions',
        );
      }
      throw error;
    }
  }
  private adapter() {
    return new FacebookPostsAdapter(getEnv().META_GRAPH_VERSION);
  }
  private async connection(ws: WorkspaceId, id: string) {
    const c = await this.channels.get(ws, id);
    if (!c || c.provider !== 'facebook')
      throw new ChannelError('NOT_FOUND', 'Facebook page not found');
    return c;
  }
  private async asset(ws: WorkspaceId, id: string) {
    const c = await this.connection(ws, id);
    if (c.status !== 'connected' || (c.expiresAt && Date.parse(c.expiresAt) <= Date.now()))
      throw new ChannelError('UNAVAILABLE', 'Reconnect the page');
    return { externalId: c.externalId, token: this.box.open(c.tokenSealed) };
  }
  async settings(ws: WorkspaceId, id: string) {
    await this.connection(ws, id);
    return this.store.settings(ws, id);
  }
  async saveSettings(ws: WorkspaceId, id: string, input: FanpageSettings) {
    const c = await this.connection(ws, id),
      settings = FanpageSettings.parse(input);
    if (settings.excludedPostIds.some((p) => !p.startsWith(`${c.externalId}_`)))
      throw new ChannelError('VALIDATION_FAILED', 'Post does not belong to this page');
    await this.store.saveSettings(ws, id, settings);
    return settings;
  }
  async posts(ws: WorkspaceId, id: string) {
    const asset = await this.asset(ws, id);
    return this.readGraph(ws, id, () => this.adapter().list(asset));
  }
  async comments(ws: WorkspaceId, id: string) {
    await this.connection(ws, id);
    return this.store.list(ws, id);
  }
  async receive(ws: WorkspaceId, id: string, event: NormalizedEvent): Promise<FanpageComment> {
    const c = await this.connection(ws, id),
      detail = event.comment;
    if (
      event.kind !== 'facebook' ||
      event.type !== 'comment' ||
      !detail ||
      event.assetExternalId !== c.externalId ||
      !detail.postId.startsWith(`${c.externalId}_`)
    )
      throw new ChannelError('VALIDATION_FAILED', 'Invalid comment');
    return this.store.change(ws, id, detail.commentId, (current) => {
      const version = `${event.occurredAt.toISOString()}/${detail.operation === 'remove' ? 2 : detail.operation === 'edited' ? 1 : 0}/${event.externalEventId}`;
      if (current && current.version >= version) return { comment: current, result: current };
      const comment: FanpageComment = {
        id: current?.id ?? newId(),
        connectionId: id,
        commentId: detail.commentId,
        postId: detail.postId,
        parentId: detail.parentId,
        authorId: event.senderExternalId || current?.authorId || '',
        text: event.text ?? '',
        occurredAt: current?.occurredAt ?? event.occurredAt.toISOString(),
        version,
        deleted: detail.operation === 'remove',
        needsReview: detail.operation !== 'add' || current?.needsReview === true,
        context: null,
        actions: current?.actions ?? [],
      };
      return { comment, result: comment };
    });
  }
  async context(ws: WorkspaceId, id: string, commentId: string, version: string) {
    const current = await this.store.change(ws, id, commentId, (c) => ({
      comment: null,
      result: c,
    }));
    if (!current || current.deleted || current.version !== version) return null;
    if (await this.store.interrupted(ws, id, current)) {
      await this.review(ws, id, commentId, version);
      return null;
    }
    const asset = await this.asset(ws, id);
    const thread = await this.readGraph(ws, id, () =>
      this.adapter().thread(asset, current.postId, commentId),
    );
    if (
      thread.authorId !== current.authorId ||
      thread.text !== current.text ||
      thread.authorId === asset.externalId
    ) {
      await this.review(ws, id, commentId, version);
      return null;
    }
    const context = {
      ...thread.post,
      pageId: asset.externalId,
      commentId,
      parentText: thread.parentText,
    };
    return this.store.change(ws, id, commentId, (c) => {
      if (!c || c.version !== version || c.deleted) return { comment: null, result: null };
      return {
        comment: { ...c, context, occurredAt: new Date(thread.createdAt).toISOString() },
        result: context,
      };
    });
  }
  async review(ws: WorkspaceId, id: string, commentId: string, version: string) {
    await this.store.change(ws, id, commentId, (c) => ({
      comment: c?.version === version ? { ...c, needsReview: true } : null,
      result: undefined,
    }));
  }
  async act(
    ws: WorkspaceId,
    id: string,
    commentId: string,
    input: Parameters<FanpageFacade['act']>[3],
  ) {
    const connection = await this.connection(ws, id);
    const settings = await this.settings(ws, id);
    let allowed = true;
    if (input.automatic) {
      const bot = connection.botId ? await this.bots.getBot(ws, connection.botId) : null;
      const botReady = Boolean(
        bot?.isActive && (!bot.replySchedule || withinReplySchedule(bot.replySchedule, new Date())),
      );
      allowed =
        input.kind === 'hide'
          ? settings.hideComments && connection.status === 'connected'
          : botReady &&
            (input.kind === 'public_reply' ? settings.publicReplies : settings.privateReplies);
    }
    const current = await this.store.change(ws, id, commentId, (c) => ({
      comment: null,
      result: c,
    }));
    if (!input.automatic && input.kind === 'private_reply' && current && !current.context) {
      if (!(await this.context(ws, id, commentId, current.version)))
        throw new ChannelError('VALIDATION_FAILED', 'Comment could not be verified');
    }
    if (input.automatic && current && (await this.store.interrupted(ws, id, current))) {
      await this.review(ws, id, commentId, current.version);
      return null;
    }
    // Resolve the page token before reserving: a disconnected page must not burn the single send.
    const asset = await this.asset(ws, id);
    const action = await this.store.change(ws, id, commentId, (c) => {
      if (!c) throw new ChannelError('NOT_FOUND', 'Comment not found');
      // One private reply per comment, even when a manual request uses a new idempotency key.
      // A call that was rejected or cancelled before anything was sent may be retried.
      const existing = c.actions.find(
        (a) =>
          a.id === input.key ||
          ((input.automatic || input.kind === 'private_reply') &&
            a.kind === input.kind &&
            a.status !== 'failed' &&
            a.status !== 'cancelled'),
      );
      if (existing) return { comment: null, result: null };
      if (
        !allowed ||
        c.deleted ||
        (input.version && c.version !== input.version) ||
        (input.automatic && (c.needsReview || settings.excludedPostIds.includes(c.postId)))
      )
        return { comment: null, result: null };
      if (
        input.kind === 'private_reply' &&
        (!c.context || Date.now() - Date.parse(c.occurredAt) >= 7 * 86400000)
      )
        throw new ChannelError(
          'VALIDATION_FAILED',
          'Private reply window closed or comment not verified',
        );
      if (c.actions.length >= 200)
        throw new ChannelError('VALIDATION_FAILED', 'Comment action limit reached');
      const action: FanpageAction = {
        id: input.key,
        kind: input.kind,
        status: 'pending',
        text: input.text,
        reason: input.reason,
        externalId: null,
        recipientId: null,
        actorId: input.actorId ?? null,
        failureCode: null,
        createdAt: new Date().toISOString(),
      };
      return {
        comment: {
          ...c,
          needsReview: input.automatic ? c.needsReview : true,
          actions: [...c.actions, action],
        },
        result: action,
      };
    });
    if (!action) return null;
    try {
      if (input.automatic) {
        const latest = await this.connection(ws, id),
          preferences = await this.settings(ws, id);
        const bot = latest.botId ? await this.bots.getBot(ws, latest.botId) : null;
        const c = await this.store.change(ws, id, commentId, (c) => ({ comment: null, result: c }));
        const enabled =
          input.kind === 'public_reply'
            ? preferences.publicReplies
            : input.kind === 'private_reply'
              ? preferences.privateReplies
              : preferences.hideComments;
        if (
          !c ||
          c.deleted ||
          c.needsReview ||
          c.version !== input.version ||
          !enabled ||
          preferences.excludedPostIds.includes(c.postId) ||
          (input.kind !== 'hide' &&
            (!bot?.isActive ||
              (input.expectedBotId !== undefined && latest.botId !== input.expectedBotId) ||
              (bot.replySchedule && !withinReplySchedule(bot.replySchedule, new Date())))) ||
          (await this.store.interrupted(ws, id, c))
        ) {
          action.status = 'cancelled';
          action.failureCode = 'control_changed';
        }
      }
      if (action.status !== 'cancelled') {
        const delivered = await this.adapter().act(asset, commentId, input.kind, input.text);
        action.status = 'sent';
        action.externalId = delivered.externalId;
        action.recipientId = delivered.recipientId;
      }
    } catch (error) {
      action.status = error instanceof MetaRequestError && !error.uncertain ? 'failed' : 'unknown';
      action.failureCode = error instanceof MetaRequestError ? error.code : 'delivery_unknown';
      if (action.failureCode === 'auth_expired')
        await this.channels.update(ws, id, { status: 'reauth_required' });
    }
    await this.store.change(ws, id, commentId, (c) => ({
      comment: c
        ? {
            ...c,
            needsReview: c.needsReview || action.status !== 'sent',
            actions: c.actions.map((a) => (a.id === action.id ? action : a)),
          }
        : null,
      result: undefined,
    }));
    return action;
  }
}

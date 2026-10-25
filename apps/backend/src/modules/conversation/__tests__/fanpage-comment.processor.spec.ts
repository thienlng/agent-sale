import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FanpageSettings, type FanpageComment, type FanpageContext } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import type { ChannelFacade, FanpageFacade, PendingMetaEvent } from '../../channel/api/index.js';
import type { BotFacade } from '../../bot/api/index.js';
import type { AiFacade } from '../../ai/api/index.js';
import { FanpageCommentProcessor } from '../application/jobs/fanpage-comment.processor.js';
const ws = workspaceId(newId()),
  id = newId();
const context: FanpageContext = {
  id: '123_10',
  pageId: '123',
  commentId: '10_20',
  text: 'Blue shirt 250k',
  parentText: '',
  media: [],
  permalink: 'https://www.facebook.com/123_10',
  fetchedAt: '2026-10-25T10:00:00.000Z',
};
function setup() {
  const comment: FanpageComment = {
    id: newId(),
    connectionId: id,
    postId: '123_10',
    commentId: '10_20',
    parentId: null,
    authorId: '999',
    text: 'How much?',
    occurredAt: context.fetchedAt,
    version: 'v1',
    deleted: false,
    needsReview: false,
    context: null,
    actions: [],
  };
  const settings = FanpageSettings.parse({ publicReplies: true, privateReplies: true });
  const pages = {
    receive: vi.fn(async () => comment),
    settings: vi.fn(async () => settings),
    context: vi.fn(async () => context as FanpageContext | null),
    review: vi.fn(),
    act: vi.fn<FanpageFacade['act']>(),
    pageReply: vi.fn(),
  };
  const channels = {
    getConnection: vi.fn(async () => ({
      provider: 'facebook',
      externalId: '123',
      status: 'connected',
      botId: 'bot',
    })),
  };
  const bots = { getBot: vi.fn(async () => ({ isActive: true })) };
  const ai = {
    reply: vi
      .fn<AiFacade['reply']>()
      .mockResolvedValue({ outcome: 'answered', reply: '250k' } as Awaited<
        ReturnType<AiFacade['reply']>
      >),
  };
  const processor = new FanpageCommentProcessor(
    channels as unknown as ChannelFacade,
    pages as unknown as FanpageFacade,
    ai as unknown as AiFacade,
    bots as unknown as BotFacade,
  );
  const job: PendingMetaEvent = {
    id: newId(),
    claimToken: newId(),
    workspaceId: ws,
    connectionId: id,
    attempt: 1,
    event: {
      kind: 'facebook',
      assetExternalId: '123',
      externalEventId: 'e1',
      senderExternalId: '999',
      type: 'comment',
      text: 'How much?',
      occurredAt: new Date(context.fetchedAt),
      comment: { postId: '123_10', commentId: '10_20', parentId: null, operation: 'add' },
      raw: {},
    },
  };
  return { processor, pages, channels, bots, ai, job, settings, comment };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(context.fetchedAt));
});
afterEach(() => vi.useRealTimers());
describe('Post-aware comment processing', () => {
  it('grounds both public and private replies on the exact originating post', async () => {
    const { processor, pages, ai, job } = setup();
    await processor.process(job);
    expect(ai.reply).toHaveBeenCalledWith(
      ws,
      'bot',
      { messages: [{ role: 'customer', content: 'How much?' }], postContext: context },
      { conversationId: null, isTest: false },
    );
    expect(pages.act.mock.calls.map((c) => c[3].kind)).toEqual(['public_reply', 'private_reply']);
    expect(pages.context).toHaveBeenCalledTimes(2);
  });
  it('keeps two interleaved posts from the same author separate', async () => {
    const { processor, pages, ai, job, comment } = setup();
    await processor.process(job);
    comment.commentId = '11_21';
    comment.postId = '123_11';
    pages.context.mockResolvedValue({
      ...context,
      id: '123_11',
      commentId: '11_21',
      text: 'Red shirt 450k',
    });
    await processor.process({ ...job, id: newId() });
    expect(ai.reply.mock.calls[1]?.[2]).toMatchObject({
      postContext: { id: '123_11', text: 'Red shirt 450k' },
    });
  });
  it('does not infer an answer when post context is unavailable or the model hands off', async () => {
    const { processor, pages, ai, job } = setup();
    pages.context.mockResolvedValue(null);
    await processor.process(job);
    expect(ai.reply).not.toHaveBeenCalled();
    expect(pages.act).not.toHaveBeenCalled();
    expect(pages.review).toHaveBeenCalled();
    pages.context.mockResolvedValue(context);
    ai.reply.mockResolvedValue({ outcome: 'handoff', reply: 'Staff' } as Awaited<
      ReturnType<AiFacade['reply']>
    >);
    await processor.process(job);
    expect(pages.act).not.toHaveBeenCalled();
  });
  it('drops a reply if the post/comment changed during generation', async () => {
    const { processor, pages, job } = setup();
    pages.context.mockResolvedValueOnce(context).mockResolvedValueOnce(null);
    await processor.process(job);
    expect(pages.act).not.toHaveBeenCalled();
  });
  it('only hides configured keyword matches and pauses replies for staff review', async () => {
    const { processor, pages, ai, job, settings, comment } = setup();
    settings.hideComments = true;
    settings.hideKeywords = ['spam link'];
    comment.text = 'SPAM LINK here';
    await processor.process(job);
    expect(pages.act).toHaveBeenCalledWith(
      ws,
      id,
      '10_20',
      expect.objectContaining({ kind: 'hide', automatic: true }),
    );
    expect(ai.reply).not.toHaveBeenCalled();
    expect(pages.review).toHaveBeenCalled();
  });
  it('honors excluded posts and never answers edited/deleted comments or staff replies', async () => {
    const { processor, pages, ai, job, settings } = setup();
    settings.excludedPostIds = ['123_10'];
    await processor.process(job);
    expect(ai.reply).not.toHaveBeenCalled();
    settings.excludedPostIds = [];
    job.event.comment!.operation = 'edited';
    await processor.process(job);
    expect(ai.reply).not.toHaveBeenCalled();
    job.event.senderExternalId = '123';
    await processor.process(job);
    expect(pages.pageReply).toHaveBeenCalled();
  });
  it('drops the old answer when a real post edit returns different context after inference', async () => {
    const { processor, pages, job } = setup();
    pages.context
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, text: 'Blue shirt 450k' });
    await processor.process(job);
    expect(pages.act).not.toHaveBeenCalled();
    expect(pages.review).toHaveBeenCalled();
  });
  it('does not publish private contact details produced by the model', async () => {
    const { processor, pages, ai, job } = setup();
    ai.reply.mockResolvedValue({ outcome: 'answered', reply: 'Call 0901234567' } as Awaited<
      ReturnType<AiFacade['reply']>
    >);
    await processor.process(job);
    expect(pages.act).not.toHaveBeenCalled();
    expect(pages.review).toHaveBeenCalled();
  });
});

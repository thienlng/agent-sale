import { describe, it, expect, vi } from 'vitest';
import { MetaAdapter } from './meta.js';
import { FacebookPostsAdapter } from './facebook-posts.js';
const asset = { externalId: '123', token: 'test-only' };
const feed = (value: Record<string, unknown>) => ({
  object: 'page',
  entry: [
    {
      id: '123',
      time: 1800000000,
      changes: [
        {
          field: 'feed',
          value: {
            item: 'comment',
            verb: 'add',
            post_id: '123_10',
            comment_id: '10_20',
            from: { id: '999' },
            message: 'How much?',
            ...value,
          },
        },
      ],
    },
  ],
});
describe('Facebook feed comments', () => {
  const adapter = new MetaAdapter('facebook');
  it('keeps originating post, parent and comment identifiers without treating comments as messages', () => {
    expect(adapter.parseWebhook(feed({ parent_id: '10_19' }))).toEqual([
      expect.objectContaining({
        type: 'comment',
        comment: { postId: '123_10', commentId: '10_20', parentId: '10_19', operation: 'add' },
      }),
    ]);
  });
  it('deduplicates exact receipts and distinguishes edits and deletes', () => {
    const a = adapter.parseWebhook(feed({}))[0];
    expect(adapter.parseWebhook(feed({}))[0]?.externalEventId).toBe(a?.externalEventId);
    expect(adapter.parseWebhook(feed({ verb: 'edited' }))[0]?.externalEventId).not.toBe(
      a?.externalEventId,
    );
    expect(
      adapter.parseWebhook(feed({ verb: 'remove', from: undefined }))[0]?.comment?.operation,
    ).toBe('remove');
  });
  it('ignores other pages, unsupported feed changes and own replies', () => {
    expect(adapter.parseWebhook(feed({ post_id: '456_10' }))).toEqual([]);
    expect(adapter.parseWebhook(feed({ item: 'post' }))).toEqual([]);
    expect(adapter.parseWebhook(feed({ from: { id: '123' } }))).toEqual([]);
  });
});
describe('Facebook post operations', () => {
  it('targets the comment for a private reply, never an author id', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ message_id: 'm', recipient_id: 'psid' })));
    expect(
      await new FacebookPostsAdapter('v24.0', transport).act(
        asset,
        '10_20',
        'private_reply',
        'Hello',
      ),
    ).toEqual({ externalId: 'm', recipientId: 'psid' });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
      recipient: { comment_id: '10_20' },
      message: { text: 'Hello' },
    });
    expect(String(transport.mock.calls[0]?.[0])).toContain('/123/messages');
  });
  it('uses separate public-reply and hide/unhide operations', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (input) =>
          new Response(
            JSON.stringify(
              String(input).endsWith('/comments') ? { id: 'reply' } : { success: true },
            ),
          ),
      );
    const adapter = new FacebookPostsAdapter('v24.0', transport);
    await adapter.act(asset, '10_20', 'public_reply', 'Hello');
    await adapter.act(asset, '10_20', 'hide', '');
    await adapter.act(asset, '10_20', 'unhide', '');
    expect(String(transport.mock.calls[0]?.[0])).toContain('/10_20/comments');
    expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toEqual({ is_hidden: true });
    expect(JSON.parse(String(transport.mock.calls[2]?.[1]?.body))).toEqual({ is_hidden: false });
  });
  it('verifies actual post ownership rather than relying on a supplied id prefix', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: '123_10', from: { id: '456' }, message: 'Other page' })),
      );
    await expect(
      new FacebookPostsAdapter('v24.0', transport).thread(asset, '123_10', '10_20'),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a comment attached to another post', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '123_10', from: { id: '123' } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: '10_20',
            object: { id: '123_11' },
            created_time: '2026-10-25T00:00:00Z',
          }),
        ),
      );
    await expect(
      new FacebookPostsAdapter('v24.0', transport).thread(asset, '123_10', '10_20'),
    ).rejects.toThrow();
  });
  it('marks a transport timeout as uncertain and does not retry', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
    await expect(
      new FacebookPostsAdapter('v24.0', transport).act(asset, '10_20', 'private_reply', 'Hi'),
    ).rejects.toMatchObject({ uncertain: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

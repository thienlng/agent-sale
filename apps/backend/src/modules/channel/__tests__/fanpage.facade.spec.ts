import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { FanpageSettings } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import type { NormalizedEvent } from '@agent-sales/channels';
import { SecretBox } from '../../../common/security/secret-box.js';
import type { BotFacade } from '../../bot/api/index.js';
import { FanpageFacadeImpl } from '../application/fanpage.facade.impl.js';
import { MemoryChannelStore } from './factories/memory-channel-store.js';
import { MemoryFanpageStore } from './factories/memory-fanpage-store.js';
const ws = workspaceId(newId()),
  foreign = workspaceId(newId()),
  id = newId();
const at = '2026-10-25T10:00:00Z';
function setup() {
  const channels = new MemoryChannelStore(),
    store = new MemoryFanpageStore(),
    box = SecretBox.insecureDevelopmentBox();
  channels.records.set(id, {
    id,
    workspaceId: ws,
    provider: 'facebook',
    externalId: '123',
    name: 'Page',
    status: 'connected',
    botId: newId(),
    tokenSealed: box.seal('test-only'),
    expiresAt: null,
    createdAt: at,
  });
  const bot = { isActive: true };
  const svc = new FanpageFacadeImpl(channels, store, box, {
    getBot: async () => bot,
  } as unknown as BotFacade);
  const event: NormalizedEvent = {
    kind: 'facebook',
    type: 'comment',
    assetExternalId: '123',
    senderExternalId: '999',
    externalEventId: 'event1',
    occurredAt: new Date(at),
    text: 'How much?',
    comment: { postId: '123_10', commentId: '10_20', parentId: null, operation: 'add' },
    raw: {},
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (input) => {
    const url = String(input);
    return new Response(
      JSON.stringify(
        url.includes('/123_10?')
          ? {
              id: '123_10',
              from: { id: '123' },
              message: 'Blue shirt 250k',
              permalink_url: 'https://www.facebook.com/123_10',
            }
          : url.includes('/10_20?')
            ? {
                id: '10_20',
                message: 'How much?',
                from: { id: '999' },
                object: { id: '123_10' },
                created_time: at,
              }
            : url.endsWith('/comments')
              ? { id: '20_30' }
              : url.endsWith('/messages')
                ? { message_id: 'm1', recipient_id: 'psid' }
                : { success: true },
      ),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return { svc, store, channels, event, fetch, bot };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Fanpage safety and action lifecycle', () => {
  it('isolates settings, posts, comments and actions across workspaces', async () => {
    const { svc } = setup();
    await expect(svc.settings(foreign, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.posts(foreign, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.comments(foreign, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.saveSettings(foreign, id, FanpageSettings.parse({}))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      svc.act(foreign, id, '10_20', {
        kind: 'hide',
        text: '',
        key: newId(),
        reason: 'test',
        automatic: false,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('does not mix posts for the same commenter or reset a snapshot on replay', async () => {
    const { svc, event } = setup();
    const first = await svc.receive(ws, id, event);
    await svc.receive(ws, id, {
      ...event,
      externalEventId: 'event2',
      comment: { postId: '123_11', commentId: '11_21', parentId: null, operation: 'add' },
    });
    expect((await svc.comments(ws, id)).map((c) => c.postId)).toEqual(['123_10', '123_11']);
    const context = await svc.context(ws, id, '10_20', first.version);
    expect(context?.text).toContain('250k');
    expect((await svc.receive(ws, id, event)).context).toEqual(context);
  });
  it('reserves one private send and preserves its source post for a later Messenger reply', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.context(ws, id, c.commentId, c.version);
    const input = {
      kind: 'private_reply' as const,
      text: '250k',
      key: newId(),
      reason: 'staff',
      automatic: false,
    };
    expect(await svc.act(ws, id, c.commentId, input)).toMatchObject({
      status: 'sent',
      recipientId: 'psid',
    });
    await svc.act(ws, id, c.commentId, { ...input, key: newId() });
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/messages'))).toHaveLength(1);
    expect(await svc.privateContext(ws, id, 'psid')).toMatchObject({
      status: 'ready',
      context: { id: '123_10' },
    });
    expect(await svc.privateContext(ws, id, 'other')).toMatchObject({ status: 'none' });
  });
  it('does not retry uncertain sends, and exposes them for staff review', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    fetch.mockRejectedValue(new Error('timeout'));
    const input = {
      kind: 'public_reply' as const,
      text: 'Hi',
      key: newId(),
      reason: 'staff',
      automatic: false,
    };
    expect(await svc.act(ws, id, c.commentId, input)).toMatchObject({ status: 'unknown' });
    await svc.act(ws, id, c.commentId, input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await svc.comments(ws, id))[0]?.needsReview).toBe(true);
  });
  it('allows retrying a public reply that Meta explicitly rejected', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    const base = fetch.getMockImplementation()!;
    fetch.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { code: 100, message: 'rejected' } }), {
          status: 400,
        }),
    );
    const input = (key: string) => ({
      kind: 'public_reply' as const,
      text: 'Hi',
      key,
      reason: 'staff',
      automatic: false,
    });
    expect(await svc.act(ws, id, c.commentId, input(newId()))).toMatchObject({ status: 'failed' });
    fetch.mockImplementation(base);
    expect(await svc.act(ws, id, c.commentId, input(newId()))).toMatchObject({ status: 'sent' });
  });
  it('honors independent settings, post exclusions, bot deactivation and manual override', async () => {
    const { svc, event, fetch, bot } = setup();
    const c = await svc.receive(ws, id, event);
    const input = {
      kind: 'public_reply' as const,
      text: 'Hi',
      key: newId(),
      reason: 'auto',
      version: c.version,
      automatic: true,
    };
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    await svc.saveSettings(
      ws,
      id,
      FanpageSettings.parse({ publicReplies: true, excludedPostIds: ['123_10'] }),
    );
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    await svc.saveSettings(ws, id, FanpageSettings.parse({ publicReplies: true }));
    bot.isActive = false;
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    bot.isActive = true;
    await svc.act(ws, id, c.commentId, { ...input, kind: 'unhide', automatic: false });
    expect(await svc.act(ws, id, c.commentId, { ...input, key: newId() })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects expired private replies and cancels actions for edited or deleted comments', async () => {
    const { svc, event } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.context(ws, id, c.commentId, c.version);
    vi.setSystemTime(new Date(Date.parse(at) + 7 * 86400000));
    await expect(
      svc.act(ws, id, c.commentId, {
        kind: 'private_reply',
        text: 'Hi',
        key: newId(),
        reason: 'staff',
        automatic: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await svc.receive(ws, id, {
      ...event,
      occurredAt: new Date(Date.parse(at) + 1000),
      externalEventId: 'edit',
      comment: { ...event.comment!, operation: 'edited' },
    });
    expect(
      await svc.act(ws, id, c.commentId, {
        kind: 'hide',
        text: '',
        key: newId(),
        reason: 'stale',
        automatic: true,
        version: c.version,
      }),
    ).toBeNull();
    await svc.receive(ws, id, {
      ...event,
      occurredAt: new Date(Date.parse(at) + 2000),
      externalEventId: 'delete',
      comment: { ...event.comment!, operation: 'remove' },
    });
    expect(
      await svc.act(ws, id, c.commentId, {
        kind: 'hide',
        text: '',
        key: newId(),
        reason: 'staff',
        automatic: false,
      }),
    ).toBeNull();
  });
  it('keeps private provenance independently of the staff listing limit', async () => {
    const { svc, event, store } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.context(ws, id, c.commentId, c.version);
    await svc.act(ws, id, c.commentId, {
      kind: 'private_reply',
      text: 'Hello',
      key: newId(),
      reason: 'staff',
      automatic: false,
    });
    // The UI is paginated; a private-reply lookup must use its own recipient query.
    vi.spyOn(store, 'list').mockResolvedValue([]);
    const lookup = vi
      .spyOn(store, 'privateComments')
      .mockResolvedValue([...store.records.values()]);
    expect(await svc.privateContext(ws, id, 'psid')).toMatchObject({
      status: 'ready',
      context: { id: '123_10' },
    });
    expect(lookup).toHaveBeenCalledWith(ws, id, 'psid');
  });
  it('reports ambiguous private provenance instead of returning ordinary-chat context', async () => {
    const { svc, event, store } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.context(ws, id, c.commentId, c.version);
    await svc.act(ws, id, c.commentId, {
      kind: 'private_reply',
      text: 'Hello',
      key: newId(),
      reason: 'staff',
      automatic: false,
    });
    const first = [...store.records.values()][0];
    if (!first) throw new Error('missing');
    vi.spyOn(store, 'privateComments').mockResolvedValue([
      first,
      { ...first, postId: '123_11', commentId: '11_21' },
    ]);
    expect(await svc.privateContext(ws, id, 'psid')).toEqual({
      status: 'ambiguous',
      context: null,
    });
  });
  it('cancels a reserved send when a staff override arrives before delivery', async () => {
    const { svc, event, store, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.saveSettings(ws, id, FanpageSettings.parse({ publicReplies: true }));
    let checks = 0;
    vi.spyOn(store, 'interrupted').mockImplementation(async () => ++checks > 1);
    expect(
      await svc.act(ws, id, c.commentId, {
        kind: 'public_reply',
        text: 'Hello',
        key: newId(),
        reason: 'auto',
        automatic: true,
        version: c.version,
      }),
    ).toMatchObject({ status: 'cancelled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

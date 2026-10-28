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
    expect((await svc.comments(ws, id)).data.map((c) => c.postId).sort()).toEqual([
      '123_10',
      '123_11',
    ]);
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
    const base = fetch.getMockImplementation()!;
    // Only the send times out; the pre-send source check still reads Facebook.
    fetch.mockImplementation(async (url, init) =>
      String(url).endsWith('/comments') ? Promise.reject(new Error('timeout')) : base(url, init),
    );
    const input = {
      kind: 'public_reply' as const,
      text: 'Hi',
      key: newId(),
      reason: 'staff',
      automatic: false,
    };
    expect(await svc.act(ws, id, c.commentId, input)).toMatchObject({ status: 'unknown' });
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith('/comments'))).toHaveLength(1);
    expect((await svc.comments(ws, id)).data[0]?.needsReview).toBe(true);
  });
  it('allows retrying a public reply that Meta explicitly rejected', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    const base = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) =>
      String(url).endsWith('/comments')
        ? new Response(JSON.stringify({ error: { code: 100, message: 'rejected' } }), {
            status: 400,
          })
        : base(url, init),
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
    // One write (the manual unhide); the other calls are its read-only source check.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
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
    // A manual action on a deleted comment is refused outright, not silently dropped.
    await expect(
      svc.act(ws, id, c.commentId, {
        kind: 'hide',
        text: '',
        key: newId(),
        reason: 'staff',
        automatic: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
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
describe('Fanpage comments in the inbox (T-106)', () => {
  async function seed(
    svc: FanpageFacadeImpl,
    event: NormalizedEvent,
    count: number,
    text = (n: number) => `Comment ${n}`,
  ) {
    for (let n = 0; n < count; n++)
      await svc.receive(ws, id, {
        ...event,
        externalEventId: `e${n}`,
        text: text(n),
        comment: {
          postId: n % 2 ? '123_11' : '123_10',
          commentId: `11_${1000 + n}`,
          parentId: null,
          operation: 'add',
        },
      });
  }
  async function scan(svc: FanpageFacadeImpl, query: { limit: number; q?: string }) {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.comments(ws, id, { ...query, ...(cursor ? { cursor } : {}) });
      expect(page.data.length).toBeLessThanOrEqual(query.limit);
      seen.push(...page.data.map((c) => c.commentId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return seen;
  }
  it('pages every stored comment once even when all share one activity time', async () => {
    const { svc, event } = setup();
    // Fake timers: every record gets the same activity time, so only the id tie-breaker orders them.
    await seed(svc, event, 125);
    const seen = await scan(svc, { limit: 30 });
    expect(seen).toHaveLength(125);
    expect(new Set(seen).size).toBe(125);
    expect(seen).toEqual([...seen].sort().reverse());
    // No query keeps the original newest-100 answer, now with a cursor to the rest.
    const legacy = await svc.comments(ws, id);
    expect(legacy.data).toHaveLength(100);
    expect(legacy.nextCursor).not.toBeNull();
  });
  it('searches and filters the whole stored set, not only the first page', async () => {
    const { svc, event } = setup();
    // Only the oldest records match, so they sit beyond the first page of the unfiltered list.
    await seed(svc, event, 60, (n) => (n < 5 ? `Còn size M không ${n}` : `Other ${n}`));
    const hits = await scan(svc, { limit: 2, q: 'size m' });
    expect(hits.sort()).toEqual(['11_1000', '11_1001', '11_1002', '11_1003', '11_1004']);
    const post = await svc.comments(ws, id, { limit: 50, postId: '123_11' });
    expect(post.data.every((c) => c.postId === '123_11')).toBe(true);
    expect(post.data).toHaveLength(30);
    expect((await svc.comments(ws, id, { q: 'nothing like this' })).data).toEqual([]);
  });
  it('rejects malformed cursors and cursors issued for another list or Page', async () => {
    const { svc, event } = setup();
    await seed(svc, event, 5);
    const { nextCursor } = await svc.comments(ws, id, { limit: 2, postId: '123_10' });
    expect(nextCursor).toBeTruthy();
    for (const query of [
      { limit: 2, cursor: nextCursor! },
      { limit: 2, cursor: nextCursor!, postId: '123_10', q: 'x' },
      { limit: 2, cursor: 'not-a-cursor' },
      {
        limit: 2,
        cursor: Buffer.from(
          JSON.stringify({ v: 1, c: newId(), p: null, q: null, a: at, i: '1' }),
        ).toString('base64url'),
      },
    ])
      await expect(svc.comments(ws, id, query)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    await expect(svc.comments(foreign, id, { limit: 2 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('reads a comment, its parent and a fresh source without changing anything', async () => {
    const { svc, event, store, channels } = setup();
    await svc.receive(ws, id, event);
    const reply = await svc.receive(ws, id, {
      ...event,
      externalEventId: 'reply',
      text: 'Me too',
      comment: { postId: '123_10', commentId: '10_21', parentId: '10_20', operation: 'add' },
    });
    const before = structuredClone([...store.records.entries()]);
    const activity = structuredClone([...store.activity.entries()]);
    vi.setSystemTime(new Date(Date.parse(at) + 60000));
    expect(await svc.comment(ws, id, '10_21')).toMatchObject({
      data: { commentId: '10_21', text: 'Me too' },
      parent: { commentId: '10_20', text: 'How much?', deleted: false },
    });
    expect(await svc.source(ws, id, '10_20')).toMatchObject({
      status: 'fresh',
      post: { id: '123_10', text: 'Blue shirt 250k' },
      matchesStored: true,
    });
    // The stored reply differs from Facebook's text for 10_20: reported, not repaired.
    store.records.set(`${ws}/${id}/10_20`, { ...reply, commentId: '10_20', text: 'Edited' });
    expect(await svc.source(ws, id, '10_20')).toMatchObject({ matchesStored: false });
    store.records.set(`${ws}/${id}/10_20`, before.find(([k]) => k.endsWith('10_20'))![1]);
    expect([...store.records.entries()]).toEqual(before);
    expect([...store.activity.entries()]).toEqual(activity);
    channels.records.set(id, { ...channels.records.get(id)!, status: 'reauth_required' });
    expect(await svc.source(ws, id, '10_20')).toEqual({
      status: 'unavailable',
      reason: 'reconnect',
    });
    await expect(svc.comment(ws, id, '99_99')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.comment(foreign, id, '10_20')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('lists posts known from stored comments, including ones without a snapshot', async () => {
    const { svc, event } = setup();
    const c = await svc.receive(ws, id, event);
    await seed(svc, event, 3);
    await svc.context(ws, id, c.commentId, c.version);
    const { data: posts } = await svc.commentPosts(ws, id);
    expect(posts.map((p) => p.postId).sort()).toEqual(['123_10', '123_11']);
    expect(posts.find((p) => p.postId === '123_10')).toMatchObject({
      comments: 3,
      text: 'Blue shirt 250k',
    });
    expect(posts.find((p) => p.postId === '123_11')).toMatchObject({ comments: 1, text: null });
  });
  it('pages over more than 200 known posts and keeps post and comment cursors apart', async () => {
    const { svc, event } = setup();
    for (let n = 0; n < 205; n++)
      await svc.receive(ws, id, {
        ...event,
        externalEventId: `p${n}`,
        comment: { postId: `123_${n}`, commentId: `12_${n}`, parentId: null, operation: 'add' },
      });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.commentPosts(ws, id, { limit: 50, ...(cursor ? { cursor } : {}) });
      seen.push(...page.data.map((p) => p.postId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(205);
    expect(new Set(seen).size).toBe(205);
    const posts = await svc.commentPosts(ws, id, { limit: 1 });
    const comments = await svc.comments(ws, id, { limit: 1 });
    for (const call of [
      svc.comments(ws, id, { limit: 1, cursor: posts.nextCursor! }),
      svc.commentPosts(ws, id, { cursor: comments.nextCursor! }),
      svc.commentPosts(ws, id, { cursor: 'not-a-cursor' }),
    ])
      await expect(call).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.commentPosts(foreign, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  const manual = (kind: 'public_reply' | 'private_reply' | 'hide', text = 'Hi') => ({
    kind,
    text,
    key: newId(),
    reason: 'staff',
    automatic: false,
  });
  const writes = (fetch: ReturnType<typeof setup>['fetch']) =>
    fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
  it('revalidates the source before every manual action, even with a snapshot', async () => {
    const { svc, event, fetch, store } = setup();
    const c = await svc.receive(ws, id, event);
    await svc.context(ws, id, c.commentId, c.version);
    const base = fetch.getMockImplementation()!;
    // Facebook now shows different text than the stored (and snapshotted) record.
    fetch.mockImplementation(async (url, init) =>
      String(url).includes('/10_20?')
        ? new Response(
            JSON.stringify({
              id: '10_20',
              message: 'Changed',
              from: { id: '999' },
              object: { id: '123_10' },
              created_time: at,
            }),
          )
        : base(url, init),
    );
    for (const kind of ['public_reply', 'private_reply', 'hide'] as const)
      await expect(svc.act(ws, id, c.commentId, manual(kind))).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    expect((await store.get(ws, id, c.commentId))?.needsReview).toBe(true);
    // A deleted post/comment on Facebook is refused the same way.
    fetch.mockImplementation(async (url, init) =>
      String(url).includes('/10_20?')
        ? new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 })
        : base(url, init),
    );
    await expect(svc.act(ws, id, c.commentId, manual('public_reply'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    fetch.mockImplementation(base);
    await expect(
      svc.act(ws, id, c.commentId, { ...manual('public_reply'), version: 'older' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(writes(fetch)).toHaveLength(0);
    expect((await store.get(ws, id, c.commentId))?.actions).toEqual([]);
  });
  it('asks for confirmation before posting contact details publicly', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    const text = 'Gọi 0912 345 678 nhé';
    await expect(svc.act(ws, id, c.commentId, manual('public_reply', text))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(writes(fetch)).toHaveLength(0);
    // Private messages are not public output; a confirmed public reply goes through.
    expect(await svc.act(ws, id, c.commentId, manual('private_reply', text))).toMatchObject({
      status: 'sent',
    });
    expect(
      await svc.act(ws, id, c.commentId, {
        ...manual('public_reply', text),
        confirmPublicContact: true,
      }),
    ).toMatchObject({ status: 'sent' });
  });
  it('keeps the request key idempotent across the added source check', async () => {
    const { svc, event, fetch } = setup();
    const c = await svc.receive(ws, id, event);
    const input = manual('public_reply');
    expect(await svc.act(ws, id, c.commentId, input)).toMatchObject({ status: 'sent' });
    // The comment is then deleted on Facebook: retrying the same request id is still a
    // duplicate (null, reconciled by id), not a refusal that would invite a second send.
    const reads = fetch.mock.calls.length;
    fetch.mockImplementation(
      async () => new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }),
    );
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    expect(fetch.mock.calls.length).toBe(reads);
    expect(writes(fetch)).toHaveLength(1);
  });
  it('answers a lost-response retry from the record after the source was edited', async () => {
    const { svc, event, fetch, store } = setup();
    const c = await svc.receive(ws, id, event);
    const input = manual('public_reply');
    // The first request reaches Facebook, but its answer never reaches the browser.
    expect(await svc.act(ws, id, c.commentId, input)).toMatchObject({ status: 'sent' });
    // The customer then edits the comment on Facebook (the edit webhook has not arrived yet).
    const base = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) =>
      String(url).includes('/10_20?')
        ? new Response(
            JSON.stringify({
              id: '10_20',
              message: 'Edited: how much?',
              from: { id: event.senderExternalId },
              object: { id: '123_10' },
              created_time: at,
            }),
          )
        : base(url, init),
    );
    // The same-id retry is recognised before the source check: no refusal, no second send,
    // and the browser finds the recorded send by its id.
    expect(await svc.act(ws, id, c.commentId, input)).toBeNull();
    expect(writes(fetch)).toHaveLength(1);
    const recordedSend = (await store.get(ws, id, c.commentId))?.actions;
    expect(recordedSend).toEqual([expect.objectContaining({ id: input.key, status: 'sent' })]);
    // The id is only recognised inside its own workspace.
    await expect(svc.act(foreign, id, c.commentId, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

import type { NormalizedEvent } from '@agent-sales/channels';
import { newId, workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { fakeIdentity, fakeTeam } from './fakes.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
const channelId = '018d0000-0000-7000-8000-000000000003',
  otherChannel = '018d0000-0000-7000-8000-000000000009',
  botId = '018d0000-0000-7000-8000-000000000004',
  lan = '018d0000-0000-7000-8000-000000000005',
  minh = '018d0000-0000-7000-8000-000000000006',
  removed = '018d0000-0000-7000-8000-000000000007';

let service: ConversationFacadeImpl;
let channels: ChannelFacade;
let bot: BotView;

function event(
  id: string,
  over: Partial<NormalizedEvent> = {},
  at = '2026-10-24T05:00:00Z',
): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type: 'message',
    occurredAt: new Date(at),
    text: 'Hello',
    raw: {},
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T05:00:00Z'));
  bot = {
    id: botId,
    name: 'Bot',
    industry: 'retail',
    isActive: true,
    mission: '',
    greeting: '',
    selfPronoun: '',
    customerPronoun: '',
    fallbackMessage: '',
    handoffMessage: '',
    creativity: 'strict',
    modelTier: 'basic',
    language: 'en',
    placeholders: {},
    autoResumeAfterManual: true,
    humanTakeoverMinutes: 5,
    silenceOnExternalReply: true,
  };
  channels = {
    getConnection: vi.fn(async (_ws: unknown, id: string) => ({
      id,
      provider: 'facebook' as const,
      externalId: 'page',
      name: 'Page',
      status: 'connected' as const,
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    })),
    deliver: vi.fn(async () => ({
      externalId: 'sent1',
      status: 'sent' as const,
      failureCode: null,
    })),
  } as unknown as ChannelFacade;
  const bots: BotFacade = { getBot: async () => bot };
  service = new ConversationFacadeImpl(
    new MemoryConversationStore(),
    channels,
    bots,
    fakeTeam([
      { userId: lan, status: 'active' },
      { userId: minh, status: 'active' },
      { userId: removed, status: 'removed' },
    ]),
    fakeIdentity({ [lan]: 'Lan', [minh]: 'Minh' }),
  );
});
afterEach(() => vi.useRealTimers());

describe('read state', () => {
  it('counts customer messages, clears for the whole shop and records who read it', async () => {
    await service.receive(ws, channelId, event('m1'));
    const c = await service.receive(ws, channelId, event('m2'));
    expect(c).toMatchObject({ unreadCount: 2, lastReadAt: null, lastReadBy: null });
    vi.setSystemTime(new Date('2026-10-24T05:10:00Z'));
    const read = await service.markRead(ws, c.id, lan);
    expect(read).toMatchObject({
      unreadCount: 0,
      lastReadAt: '2026-10-24T05:10:00.000Z',
      lastReadBy: { userId: lan, name: 'Lan' },
    });
    // Reading is not a control change: the revision (bot fencing) and the sort time stay.
    expect(read.revision).toBe(c.revision);
    expect(read.updatedAt).toBe(c.updatedAt);
  });

  it('marks unread with at least one message and forgets who read it', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.markRead(ws, c.id, lan);
    const unread = await service.markUnread(ws, c.id);
    expect(unread).toMatchObject({ unreadCount: 1, lastReadAt: null, lastReadBy: null });
    const more = await service.receive(ws, channelId, event('m2'));
    expect((await service.markUnread(ws, more.id)).unreadCount).toBe(2);
  });

  it('reports other tenants and unknown ids as not found', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const other = workspaceId('018d0000-0000-7000-8000-000000000002');
    await expect(service.markRead(other, c.id, lan)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.markUnread(ws, newId())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('waiting state', () => {
  it('starts with the first unanswered customer message and keeps the earliest time', async () => {
    await service.receive(ws, channelId, event('m1', {}, '2026-10-24T05:00:00Z'));
    const c = await service.receive(ws, channelId, event('m2', {}, '2026-10-24T05:03:00Z'));
    expect(c).toMatchObject({
      awaitingSince: '2026-10-24T05:00:00.000Z',
      lastMessageSender: 'customer',
    });
  });

  it('is cleared by a human reply', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.send(ws, c.id, { text: 'Hi', idempotencyKey: newId() }, lan);
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      awaitingSince: null,
      lastMessageSender: 'human',
    });
  });

  it('is cleared by a bot reply', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'Bot says hi',
      idempotencyKey: 'bot:m1',
    });
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      awaitingSince: null,
      lastMessageSender: 'bot',
    });
  });

  it('is cleared by a staff reply typed outside the app, and restarts on the next customer message', async () => {
    await service.receive(ws, channelId, event('m1'));
    const echoed = await service.receive(ws, channelId, event('e1', { type: 'echo' }));
    expect(echoed).toMatchObject({ awaitingSince: null, lastMessageSender: 'human' });
    const again = await service.receive(ws, channelId, event('m2', {}, '2026-10-24T06:00:00Z'));
    expect(again.awaitingSince).toBe('2026-10-24T06:00:00.000Z');
  });

  it('is restored when the reply never left, so the customer still shows as waiting', async () => {
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: null,
      status: 'failed',
      failureCode: 'provider_rejected',
    });
    const c = await service.receive(ws, channelId, event('m1'));
    const sent = await service.send(ws, c.id, { text: 'Hi', idempotencyKey: newId() }, lan);
    expect(sent.status).toBe('failed');
    expect((await service.get(ws, c.id)).conversation.awaitingSince).toBe(
      '2026-10-24T05:00:00.000Z',
    );
  });

  it('does not open a waiting state for an echo that starts the conversation', async () => {
    const c = await service.receive(ws, channelId, event('e1', { type: 'echo' }));
    expect(c).toMatchObject({ awaitingSince: null, unreadCount: 0, lastMessageSender: 'human' });
  });
});

describe('customer phone', () => {
  it('captures the latest Vietnamese number from customer text only', async () => {
    const first = await service.receive(ws, channelId, event('m1', { text: 'sdt 0912 345 678' }));
    expect(first.customerPhone).toBe('0912345678');
    const kept = await service.receive(ws, channelId, event('m2', { text: 'cảm ơn shop' }));
    expect(kept.customerPhone).toBe('0912345678');
    const newer = await service.receive(ws, channelId, event('m3', { text: '+84 388 111 222' }));
    expect(newer.customerPhone).toBe('0388111222');
    const echo = await service.receive(
      ws,
      channelId,
      event('e1', { type: 'echo', text: '0977111222' }),
    );
    expect(echo.customerPhone).toBe('0388111222');
  });
});

describe('notes', () => {
  it('appends notes with the author and mirrors the newest into the legacy field', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const noted = await service.addNote(ws, c.id, '  Wants size M  ', lan);
    expect(noted.notes).toEqual([
      expect.objectContaining({ authorId: lan, authorName: 'Lan', text: 'Wants size M' }),
    ]);
    expect(noted.note).toBe('Wants size M');
    expect(noted.revision).toBe(c.revision);
  });

  it('keeps at most 200 notes, dropping the oldest', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    let last = c;
    for (let i = 0; i < 202; i++) last = await service.addNote(ws, c.id, `note ${i}`, lan);
    expect(last.notes).toHaveLength(200);
    expect(last.notes[0]?.text).toBe('note 2');
    expect(last.notes.at(-1)?.text).toBe('note 201');
  });

  it('rejects empty notes', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await expect(service.addNote(ws, c.id, '   ', lan)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('assignee', () => {
  it('assigns any active member and unassigns with null', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    expect((await service.update(ws, c.id, { assigneeId: minh }, lan)).assigneeId).toBe(minh);
    expect((await service.update(ws, c.id, { assigneeId: null }, lan)).assigneeId).toBeNull();
  });

  it('rejects people outside the workspace and removed members', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    for (const id of [newId(), removed])
      await expect(service.update(ws, c.id, { assigneeId: id }, lan)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    expect((await service.get(ws, c.id)).conversation.assigneeId).toBeNull();
  });

  it('keeps assignToMe working and lets assigneeId win when both are sent', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    expect((await service.update(ws, c.id, { assignToMe: true }, lan)).assigneeId).toBe(lan);
    expect(
      (await service.update(ws, c.id, { assignToMe: true, assigneeId: minh }, lan)).assigneeId,
    ).toBe(minh);
  });
});

describe('list filters and counts', () => {
  async function seed() {
    // a: unread + waiting, mine, phone.  b: read but waiting.  c: answered.  d: resolved + other channel.
    const a = await service.receive(
      ws,
      channelId,
      event('a1', { senderExternalId: 'a', text: 'SDT 0912345678' }, '2026-10-24T05:00:00Z'),
    );
    vi.setSystemTime(new Date('2026-10-24T05:01:00Z'));
    const b = await service.receive(
      ws,
      channelId,
      event('b1', { senderExternalId: 'b', text: 'Price?' }, '2026-10-24T04:00:00Z'),
    );
    vi.setSystemTime(new Date('2026-10-24T05:02:00Z'));
    const c = await service.receive(ws, channelId, event('c1', { senderExternalId: 'c' }));
    vi.setSystemTime(new Date('2026-10-24T05:03:00Z'));
    const d = await service.receive(ws, otherChannel, event('d1', { senderExternalId: 'd' }));
    await service.update(ws, a.id, { assigneeId: lan }, lan);
    await service.markRead(ws, b.id, lan);
    await service.send(ws, c.id, { text: 'answered', idempotencyKey: newId() }, lan);
    await service.update(ws, d.id, { status: 'resolved' }, lan);
    return { a, b, c, d };
  }
  const ids = (r: { data: { id: string }[] }) => r.data.map((c) => c.id);

  it('splits the tabs and counts them with every filter except the tab', async () => {
    const { a, b, c, d } = await seed();
    const all = await service.list(ws, { limit: 50 }, lan);
    expect(all.counts).toEqual({ all: 4, unread: 3, waiting: 3 });
    expect(ids(all).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    const unread = await service.list(ws, { limit: 50, tab: 'unread' }, lan);
    expect(ids(unread).sort()).toEqual([a.id, c.id, d.id].sort());
    const waiting = await service.list(ws, { limit: 50, tab: 'waiting' }, lan);
    expect(ids(waiting).sort()).toEqual([a.id, b.id, d.id].sort());
    // Counts ignore the tab but obey the other filters.
    expect(unread.counts).toEqual(all.counts);
    const open = await service.list(ws, { limit: 50, status: 'open', tab: 'waiting' }, lan);
    expect(open.counts).toEqual({ all: 3, unread: 2, waiting: 2 });
  });

  it('filters by assignee, channel, phone, waiting kind, mode and text', async () => {
    const { a, b, c, d } = await seed();
    const q = async (query: object) => ids(await service.list(ws, { limit: 50, ...query }, lan));
    // A reply auto-assigns the sender, so c is Lan's as well.
    expect((await q({ assignee: 'me' })).sort()).toEqual([a.id, c.id].sort());
    expect((await q({ assignee: 'none' })).sort()).toEqual([b.id, d.id].sort());
    expect(await q({ assignee: minh })).toEqual([]);
    expect(await q({ channelId: otherChannel })).toEqual([d.id]);
    expect(await q({ hasPhone: true })).toEqual([a.id]);
    expect((await q({ hasPhone: false })).sort()).toEqual([b.id, c.id, d.id].sort());
    expect(await q({ waiting: 'readNotReplied' })).toEqual([b.id]);
    expect((await q({ waiting: 'any' })).sort()).toEqual([a.id, b.id, d.id].sort());
    expect(await q({ q: '0912' })).toEqual([a.id]);
    expect(await q({ q: 'PRICE' })).toEqual([b.id]);
    expect((await q({ mode: 'bot' })).length).toBeGreaterThan(0);
  });

  it('sorts the longest wait first, for the sort option and for waiting=longest', async () => {
    const { a, b, c, d } = await seed();
    const longest = ids(await service.list(ws, { limit: 50, sort: 'waitingLongest' }, lan));
    // b started waiting at 04:00, a at 05:00, d at 05:00 (later insert), c is not waiting.
    expect(longest.slice(0, 2)).toEqual([b.id, expect.any(String)]);
    expect(longest.at(-1)).toBe(c.id);
    const viaWaiting = ids(await service.list(ws, { limit: 50, waiting: 'longest' }, lan));
    expect(viaWaiting[0]).toBe(b.id);
    expect(viaWaiting).not.toContain(c.id);
    expect([a.id, d.id]).toContain(viaWaiting[1]);
  });

  it('orders by recent activity by default and honours the limit', async () => {
    const { a, b, c, d } = await seed();
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    await service.markUnread(ws, a.id);
    await service.addNote(ws, b.id, 'later', lan);
    // Read state and notes do not reorder; only conversation activity does.
    const recent = await service.list(ws, { limit: 2 }, lan);
    // Ties on the same millisecond fall back to the newer id.
    expect(ids(recent)).toEqual([d.id, c.id]);
    expect(recent.counts.all).toBe(4);
    expect(new Set([a.id, b.id]).size).toBe(2);
  });

  it('refuses assignee=me without a signed-in user', async () => {
    await expect(service.list(ws, { limit: 50, assignee: 'me' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

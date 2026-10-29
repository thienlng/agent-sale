import type { NormalizedEvent } from '@agent-sales/channels';
import { UpdateConversationRequest } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';
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
let crm: ReturnType<typeof fakeCrm>;

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
    profile: { fields: {}, notes: '' },
    replyLength: 'short',
    tone: 'friendly',
    allowEmoji: false,
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
    fetchCustomerProfile: vi.fn(async () => ({
      name: 'Nguyễn Thu Hà',
      avatarUrl: 'https://cdn.example/ha.jpg',
    })),
  } as unknown as ChannelFacade;
  const bots: BotFacade = { getBot: async () => bot };
  crm = fakeCrm();
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
    crm as never,
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

  it('links a lead, keeps it idempotent and stamps seenAt when staff read it', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const lead = {
      contactId: newId(),
      phoneE164: '+84912345679',
      capturedAt: '2026-10-24T05:01:00.000Z',
    };
    await service.linkLead(ws, c.id, lead);
    await service.linkLead(ws, c.id, lead);
    expect((await service.get(ws, c.id)).conversation.lead).toEqual({
      contactId: lead.contactId,
      phone: '+84912345679',
      capturedAt: lead.capturedAt,
      seenAt: null,
    });
    vi.setSystemTime(new Date('2026-10-24T05:10:00Z'));
    const read = await service.markRead(ws, c.id, lan);
    expect(read.lead?.seenAt).toBe('2026-10-24T05:10:00.000Z');
    vi.setSystemTime(new Date('2026-10-24T05:20:00Z'));
    expect((await service.markRead(ws, c.id, lan)).lead?.seenAt).toBe('2026-10-24T05:10:00.000Z');
    await expect(service.linkLead(ws, newId(), lead)).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
  it('captures the first Vietnamese number from customer text only and keeps it', async () => {
    const first = await service.receive(ws, channelId, event('m1', { text: 'sdt 0912 345 678' }));
    expect(first.customerPhone).toBe('0912345678');
    const kept = await service.receive(ws, channelId, event('m2', { text: 'cảm ơn shop' }));
    expect(kept.customerPhone).toBe('0912345678');
    const newer = await service.receive(ws, channelId, event('m3', { text: '+84 388 111 222' }));
    expect(newer.customerPhone).toBe('0912345678');
    const echo = await service.receive(
      ws,
      channelId,
      event('e1', { type: 'echo', text: '0977111222' }),
    );
    expect(echo.customerPhone).toBe('0912345678');
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
    expect(all.counts).toEqual({ all: 4, unread: 3, waiting: 2 });
    expect(ids(all).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    const unread = await service.list(ws, { limit: 50, tab: 'unread' }, lan);
    expect(ids(unread).sort()).toEqual([a.id, c.id, d.id].sort());
    const waiting = await service.list(ws, { limit: 50, tab: 'waiting' }, lan);
    // d is resolved: it keeps awaitingSince but is not waiting.
    expect(ids(waiting).sort()).toEqual([a.id, b.id].sort());
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
    expect((await q({ waiting: 'any' })).sort()).toEqual([a.id, b.id].sort());
    expect(await q({ q: '0912' })).toEqual([a.id]);
    expect(await q({ q: 'PRICE' })).toEqual([b.id]);
    expect((await q({ mode: 'bot' })).length).toBeGreaterThan(0);
  });

  it('sorts the longest wait first, for the sort option and for waiting=longest', async () => {
    const { a, b, c, d } = await seed();
    const longest = ids(await service.list(ws, { limit: 50, sort: 'waitingLongest' }, lan));
    // b started waiting at 04:00, a at 05:00; c is answered and d is resolved.
    expect(longest.slice(0, 2)).toEqual([b.id, a.id]);
    const viaWaiting = ids(await service.list(ws, { limit: 50, waiting: 'longest' }, lan));
    expect(viaWaiting[0]).toBe(b.id);
    expect(viaWaiting).not.toContain(c.id);
    expect(viaWaiting).toEqual([b.id, a.id]);
    expect(d.id).toBeDefined();
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

  it('filters by the bot answering now, and "none" for pages without a bot', async () => {
    const base = await channels.getConnection(ws, channelId);
    vi.mocked(channels.getConnection).mockImplementation(async (_ws, id) => ({
      ...base,
      id,
      botId: id === otherChannel ? null : botId,
    }));
    const { a, b, c, d } = await seed();
    const q = async (query: object) => ids(await service.list(ws, { limit: 50, ...query }, lan));
    expect((await q({ botId })).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await q({ botId: 'none' })).toEqual([d.id]);
    expect(await q({ botId: newId() })).toEqual([]);
    const counted = await service.list(ws, { limit: 50, botId, tab: 'unread' }, lan);
    expect(counted.counts).toEqual({ all: 3, unread: 2, waiting: 2 });
  });

  it('filters by last activity: from inclusive, to exclusive, counts included', async () => {
    await seed();
    const all = (await service.list(ws, { limit: 50 }, lan)).data;
    const times = [...new Set(all.map((c) => c.updatedAt))].sort();
    expect(times.length).toBeGreaterThan(1);
    const [first, second] = times as [string, string];
    const q = async (query: object) =>
      ids(await service.list(ws, { limit: 50, ...query }, lan)).sort();
    const where = (keep: (at: string) => boolean) =>
      all
        .filter((c) => keep(c.updatedAt))
        .map((c) => c.id)
        .sort();
    expect(await q({ updatedFrom: second })).toEqual(where((at) => at >= second));
    expect(await q({ updatedTo: second })).toEqual(where((at) => at < second));
    expect(await q({ updatedFrom: first, updatedTo: second })).toEqual(where((at) => at === first));
    expect(await q({ updatedFrom: '2030-01-01T00:00:00Z' })).toEqual([]);
    const counted = await service.list(ws, { limit: 50, updatedTo: second, tab: 'waiting' }, lan);
    expect(counted.counts.all).toBe(where((at) => at < second).length);
  });

  it('refuses assignee=me without a signed-in user', async () => {
    await expect(service.list(ws, { limit: 50, assignee: 'me' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('customer profile', () => {
  it('stores the name and avatar from Meta without touching revision or order', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    expect(c.customerName).toBe('customer');
    await service.refreshCustomerProfile(ws, c.id);
    const after = (await service.get(ws, c.id)).conversation;
    expect(after).toMatchObject({
      customerName: 'Nguyễn Thu Hà',
      customerAvatarUrl: 'https://cdn.example/ha.jpg',
      profileFetchedAt: '2026-10-24T05:00:00.000Z',
    });
    expect(channels.fetchCustomerProfile).toHaveBeenCalledWith(ws, channelId, 'customer');
    expect(after.revision).toBe(c.revision);
    expect(after.updatedAt).toBe(c.updatedAt);
  });

  it('retries a failed lookup after 15 minutes, not a day', async () => {
    vi.mocked(channels.fetchCustomerProfile).mockResolvedValue(null);
    const c = await service.receive(ws, channelId, event('m1'));
    await service.refreshCustomerProfile(ws, c.id);
    vi.advanceTimersByTime(10 * 60000);
    await service.refreshCustomerProfile(ws, c.id);
    expect(channels.fetchCustomerProfile).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6 * 60000);
    await service.refreshCustomerProfile(ws, c.id);
    expect(channels.fetchCustomerProfile).toHaveBeenCalledTimes(2);
    expect((await service.get(ws, c.id)).conversation.customerName).toBe('customer');
  });

  it('waits a day after a success', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.refreshCustomerProfile(ws, c.id);
    vi.advanceTimersByTime(23 * 3600000);
    await service.refreshCustomerProfile(ws, c.id);
    expect(channels.fetchCustomerProfile).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 3600000);
    await service.refreshCustomerProfile(ws, c.id);
    expect(channels.fetchCustomerProfile).toHaveBeenCalledTimes(2);
  });

  it('looks up unnamed customers shown in the list, and only those', async () => {
    const unnamed = await service.receive(ws, channelId, event('m1'));
    const named = await service.receive(ws, channelId, event('m2', { senderExternalId: 'other' }));
    await service.refreshCustomerProfile(ws, named.id);
    vi.mocked(channels.fetchCustomerProfile).mockClear();
    await service.list(ws, { limit: 50 }, lan);
    await vi.waitFor(() => expect(channels.fetchCustomerProfile).toHaveBeenCalledTimes(1));
    expect(channels.fetchCustomerProfile).toHaveBeenCalledWith(ws, channelId, 'customer');
    await vi.waitFor(async () =>
      expect((await service.get(ws, unnamed.id)).conversation.customerName).toBe('Nguyễn Thu Hà'),
    );
  });

  it('ignores a failing lookup instead of throwing', async () => {
    vi.mocked(channels.fetchCustomerProfile).mockRejectedValue(new Error('boom'));
    const c = await service.receive(ws, channelId, event('m1'));
    await expect(service.refreshCustomerProfile(ws, c.id)).resolves.toBeUndefined();
    expect((await service.get(ws, c.id)).conversation.customerName).toBe('customer');
  });

  it('does not overwrite a name with an empty profile or lose the avatar', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.refreshCustomerProfile(ws, c.id);
    vi.mocked(channels.fetchCustomerProfile).mockResolvedValue({ name: null, avatarUrl: null });
    vi.setSystemTime(new Date('2026-10-26T05:00:00Z'));
    await service.refreshCustomerProfile(ws, c.id);
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      customerName: 'Nguyễn Thu Hà',
      customerAvatarUrl: 'https://cdn.example/ha.jpg',
    });
  });

  it('knows nothing of conversations in another workspace', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const other = workspaceId('018d0000-0000-7000-8000-000000000002');
    await service.refreshCustomerProfile(other, c.id);
    expect(channels.fetchCustomerProfile).not.toHaveBeenCalled();
  });
});

describe('tags', () => {
  const chip = { id: '018d0000-0000-7000-8000-0000000000a1', name: 'Chốt đơn', color: '#ff6a00' };

  it('puts the tag chips of the library on list rows, detail and updates', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const plain = await service.receive(ws, channelId, event('m2', { senderExternalId: 'other' }));
    crm.conversationTags.mockResolvedValue(new Map([[c.id, [chip]]]));
    const rows = (await service.list(ws, { limit: 50 }, lan)).data;
    expect(rows.find((r) => r.id === c.id)?.tags).toEqual([chip]);
    expect(rows.find((r) => r.id === plain.id)?.tags).toEqual([]);
    expect((await service.get(ws, c.id)).conversation.tags).toEqual([chip]);
    expect((await service.markRead(ws, c.id, lan)).tags).toEqual([chip]);
    expect((await service.update(ws, c.id, { note: 'n' }, lan)).tags).toEqual([chip]);
  });

  it('never stores the chips with the conversation', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    crm.conversationTags.mockResolvedValue(new Map([[c.id, [chip]]]));
    await service.markRead(ws, c.id, lan);
    expect((await service.getReplyContext(ws, c.id)).conversation.tags).toEqual([]);
  });

  it('hands the tag conditions to the library and applies the answer to list and counts', async () => {
    const a = await service.receive(ws, channelId, event('m1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('m2', { senderExternalId: 'b' }));
    const c = await service.receive(ws, channelId, event('m3', { senderExternalId: 'c' }));
    const tagA = '018d0000-0000-7000-8000-0000000000a2';
    crm.conversationIdsByTags.mockResolvedValue({ include: [a.id, b.id], exclude: [b.id] });
    const page = await service.list(ws, { limit: 50, tagsAny: [tagA], untagged: false }, lan);
    expect(crm.conversationIdsByTags).toHaveBeenCalledWith(ws, {
      any: [tagA],
      all: undefined,
      exclude: undefined,
      untagged: false,
    });
    expect(page.data.map((r) => r.id)).toEqual([a.id]);
    expect(page.counts.all).toBe(1);
    // An empty answer means nobody matches, not "no filter".
    crm.conversationIdsByTags.mockResolvedValue({ include: [], exclude: [] });
    expect((await service.list(ws, { limit: 50, tagsAll: [tagA] }, lan)).data).toEqual([]);
    expect(c.id).toBeDefined();
  });

  it('does not call the library when the list has no tag condition', async () => {
    await service.receive(ws, channelId, event('m1'));
    await service.list(ws, { limit: 50 }, lan);
    expect(crm.conversationIdsByTags).not.toHaveBeenCalled();
  });

  it('checks the conversation exists in this workspace before reading or assigning tags', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const other = workspaceId('018d0000-0000-7000-8000-000000000002');
    await expect(service.listTags(other, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.addTag(ws, newId(), { tagId: chip.id }, lan)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(crm.assignConversationTag).not.toHaveBeenCalled();
    await service.addTag(ws, c.id, { tagId: chip.id }, lan);
    expect(crm.assignConversationTag).toHaveBeenCalledWith(ws, c.id, { tagId: chip.id }, lan);
    await service.listTags(ws, c.id);
    expect(crm.listConversationTags).toHaveBeenCalledWith(ws, c.id);
  });
});

describe('tag library outage', () => {
  it('still loads conversations without chips, but fails a tag filter instead of guessing', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    crm.conversationTags.mockRejectedValue(new Error('crm down'));
    crm.conversationIdsByTags.mockRejectedValue(new Error('crm down'));
    expect((await service.list(ws, { limit: 50 }, lan)).data.map((r) => r.id)).toEqual([c.id]);
    expect((await service.get(ws, c.id)).conversation.tags).toEqual([]);
    await expect(service.list(ws, { limit: 50, untagged: true }, lan)).rejects.toThrow('crm down');
  });
});

describe('resolved conversations', () => {
  it('leave the waiting tab, counts and filters, and return when reopened', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('b1', { senderExternalId: 'b' }));
    const waiting = async (query: object = {}) => service.list(ws, { limit: 50, ...query }, lan);
    expect((await waiting()).counts.waiting).toBe(2);

    const resolved = await service.update(ws, a.id, { status: 'resolved' }, lan);
    expect(resolved.awaitingSince).not.toBeNull();
    const after = await waiting({ tab: 'waiting' });
    expect(after.data.map((c) => c.id)).toEqual([b.id]);
    expect(after.counts).toEqual({ all: 2, unread: 2, waiting: 1 });
    for (const w of ['any', 'longest', 'readNotReplied'] as const) {
      await service.markRead(ws, b.id, lan);
      expect((await waiting({ waiting: w })).data.map((c) => c.id)).not.toContain(a.id);
    }
    const ordered = await waiting({ sort: 'waitingLongest' });
    expect(ordered.data.map((c) => c.id)).toEqual([b.id, a.id]);

    await service.update(ws, a.id, { status: 'open' }, lan);
    expect((await waiting({ tab: 'waiting' })).data.map((c) => c.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect((await waiting()).counts.waiting).toBe(2);
  });
});

describe('work folders (Done and Spam)', () => {
  const ids = (r: { data: { id: string }[] }) => r.data.map((c) => c.id);
  it('reopens Done on a customer message but keeps Spam out of the queue', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('b1', { senderExternalId: 'b' }));
    await service.update(ws, a.id, { status: 'resolved' }, lan);
    await service.update(ws, b.id, { status: 'spam' }, lan);
    expect(ids(await service.list(ws, { limit: 50, status: 'open' }, lan))).toEqual([]);
    expect(ids(await service.list(ws, { limit: 50, status: 'spam' }, lan))).toEqual([b.id]);

    const reopened = await service.receive(ws, channelId, event('a2', { senderExternalId: 'a' }));
    const stillSpam = await service.receive(ws, channelId, event('b2', { senderExternalId: 'b' }));
    expect(reopened.status).toBe('open');
    expect(stillSpam).toMatchObject({ status: 'spam', unreadCount: 2 });
    const queue = await service.list(ws, { limit: 50, status: 'open' }, lan);
    expect(ids(queue)).toEqual([a.id]);
    // Spam never counts as waiting, even with an unanswered message.
    expect((await service.list(ws, { limit: 50, status: 'spam' }, lan)).counts.waiting).toBe(0);

    const restored = await service.update(ws, b.id, { status: 'open' }, lan);
    expect(restored.status).toBe('open');
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('makes staff reopen Done or Spam before replying, and the bot never answers there', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    for (const status of ['resolved', 'spam'] as const) {
      await service.update(ws, c.id, { status }, lan);
      await expect(
        service.send(ws, c.id, { text: 'Hi', idempotencyKey: newId() }, lan),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const fresh = (await service.get(ws, c.id)).conversation;
      expect(
        await service.commitBotReply(ws, c.id, {
          revision: fresh.revision,
          text: 'Bot',
          idempotencyKey: newId(),
        }),
      ).toBeNull();
    }
    expect(channels.deliver).not.toHaveBeenCalled();
    await service.update(ws, c.id, { status: 'open' }, lan);
    await expect(
      service.send(ws, c.id, { text: 'Hi', idempotencyKey: newId() }, lan),
    ).resolves.toMatchObject({ status: 'sent' });
  });
});

describe('list order', () => {
  it('keeps a row in place when staff assign, file or take over; only messages move it', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    vi.setSystemTime(new Date('2026-10-24T06:00:00Z'));
    await service.update(ws, c.id, { assigneeId: lan }, lan);
    await service.update(ws, c.id, { status: 'resolved' }, lan);
    await service.update(ws, c.id, { status: 'open', mode: 'human' }, lan);
    await service.handOff(ws, c.id, 'bot');
    const after = (await service.get(ws, c.id)).conversation;
    expect(after.updatedAt).toBe(c.updatedAt);
    expect(after.revision).toBeGreaterThan(c.revision);
    const moved = await service.receive(ws, channelId, event('m2', {}, '2026-10-24T06:00:00Z'));
    expect(moved.updatedAt).toBe('2026-10-24T06:00:00.000Z');
  });
});

describe('star and follow-up filters', () => {
  it('stars without touching read state or folder, and filters on both', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('b1', { senderExternalId: 'b' }));
    expect(a.starred).toBe(false);
    const starred = await service.update(ws, a.id, { starred: true }, lan);
    expect(starred).toMatchObject({ starred: true, unreadCount: 1, status: 'open' });
    // An annotation, not a control change: a queued bot reply stays valid and the order stays.
    expect(starred.revision).toBe(a.revision);
    expect(starred.updatedAt).toBe(a.updatedAt);
    await service.update(ws, b.id, { followUpAt: '2026-10-25T02:00:00.000Z' }, lan);
    const list = async (query: object) =>
      (await service.list(ws, { limit: 50, ...query }, lan)).data.map((c) => c.id);
    expect(await list({ starred: true })).toEqual([a.id]);
    expect(await list({ starred: false })).toEqual([b.id]);
    expect(await list({ followUp: true })).toEqual([b.id]);
    expect(await list({ followUp: false })).toEqual([a.id]);
    expect((await service.update(ws, a.id, { starred: false }, lan)).starred).toBe(false);
  });
});

describe('bulk actions', () => {
  it('applies the action to each id and reports failures without undoing the others', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('b1', { senderExternalId: 'b' }));
    const missing = newId();
    const result = await service.bulk(ws, { action: 'resolve', ids: [a.id, missing, b.id] }, lan);
    expect(result).toEqual({
      data: [
        { id: a.id, ok: true, code: null },
        { id: missing, ok: false, code: 'NOT_FOUND' },
        { id: b.id, ok: true, code: null },
      ],
      succeeded: 2,
      failed: 1,
    });
    for (const id of [a.id, b.id])
      expect((await service.get(ws, id)).conversation.status).toBe('resolved');
  });

  it('runs every action through the single-conversation rules', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const run = async (action: string, extra: object = {}) =>
      (await service.bulk(ws, { action, ids: [a.id], ...extra } as never, lan)).succeeded;
    const now = async () => (await service.get(ws, a.id)).conversation;
    expect(await run('star')).toBe(1);
    expect((await now()).starred).toBe(true);
    expect(await run('unstar')).toBe(1);
    expect((await now()).starred).toBe(false);
    expect(await run('read')).toBe(1);
    expect((await now()).unreadCount).toBe(0);
    expect(await run('unread')).toBe(1);
    expect((await now()).unreadCount).toBe(1);
    expect(await run('assign', { assigneeId: minh })).toBe(1);
    expect((await now()).assigneeId).toBe(minh);
    expect(await run('assign', { assigneeId: null })).toBe(1);
    expect((await now()).assigneeId).toBeNull();
    await service.update(ws, a.id, { followUpAt: '2026-10-25T02:00:00.000Z' }, lan);
    expect(await run('clearFollowUp')).toBe(1);
    expect((await now()).followUpAt).toBeNull();
    expect(await run('spam')).toBe(1);
    expect((await now()).status).toBe('spam');
    expect(await run('reopen')).toBe(1);
    expect((await now()).status).toBe('open');
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('keeps a queued bot reply valid when starring in bulk', async () => {
    const a = await service.receive(ws, channelId, event('a1'));
    await service.bulk(ws, { action: 'star', ids: [a.id] }, lan);
    const reply = await service.commitBotReply(ws, a.id, {
      revision: a.revision,
      text: 'Bot',
      idempotencyKey: newId(),
    });
    expect(reply).toMatchObject({ status: 'sent' });
  });

  it('reports an unexpected failure per id instead of failing the whole call', async () => {
    const a = await service.receive(ws, channelId, event('a1', { senderExternalId: 'a' }));
    const b = await service.receive(ws, channelId, event('b1', { senderExternalId: 'b' }));
    const control = vi.spyOn(service as never, 'control') as unknown as {
      mockRejectedValueOnce: (e: unknown) => void;
    };
    control.mockRejectedValueOnce(new Error('database went away'));
    const result = await service.bulk(ws, { action: 'resolve', ids: [a.id, b.id] }, lan);
    expect(result.data).toEqual([
      { id: a.id, ok: false, code: 'INTERNAL' },
      { id: b.id, ok: true, code: null },
    ]);
  });

  it('rejects an assignee outside the workspace before touching anything', async () => {
    const a = await service.receive(ws, channelId, event('a1'));
    await expect(
      service.bulk(ws, { action: 'assign', ids: [a.id], assigneeId: removed }, lan),
    ).rejects.toBeDefined();
    expect((await service.get(ws, a.id)).conversation.assigneeId).toBeNull();
  });

  it('treats conversations of another workspace as not found', async () => {
    const a = await service.receive(ws, channelId, event('a1'));
    const other = workspaceId('018d0000-0000-7000-8000-000000000002');
    const result = await service.bulk(other, { action: 'spam', ids: [a.id] }, lan);
    expect(result.data).toEqual([{ id: a.id, ok: false, code: 'NOT_FOUND' }]);
    expect((await service.get(ws, a.id)).conversation.status).toBe('open');
  });
});

describe('legacy note and timeline', () => {
  it('appends a changed PATCH note to the timeline and keeps both consistent', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const first = await service.update(ws, c.id, { note: ' Gọi lại chiều ' }, lan);
    expect(first.note).toBe('Gọi lại chiều');
    expect(first.notes).toEqual([
      expect.objectContaining({ authorId: lan, authorName: 'Lan', text: 'Gọi lại chiều' }),
    ]);
    // Saving the same text again adds nothing; the timeline entry from the other path stays.
    expect((await service.update(ws, c.id, { note: 'Gọi lại chiều' }, lan)).notes).toHaveLength(1);
    const viaTimeline = await service.addNote(ws, c.id, 'Đã gọi', minh);
    expect(viaTimeline.note).toBe('Đã gọi');
    expect(viaTimeline.notes).toHaveLength(2);
    // Clearing the legacy field never deletes timeline entries.
    const cleared = await service.update(ws, c.id, { note: '' }, lan);
    expect(cleared.note).toBe('');
    expect(cleared.notes).toHaveLength(2);
  });
});

describe('customer phone correction', () => {
  it('lets staff set, normalise and clear the phone, and rejects anything else', async () => {
    const c = await service.receive(ws, channelId, event('m1', { text: 'sdt 0912345678' }));
    const set = await service.update(ws, c.id, { customerPhone: '+84 388 111 222' }, lan);
    expect(set.customerPhone).toBe('0388111222');
    // A later customer message does not overwrite the corrected number.
    const again = await service.receive(ws, channelId, event('m2', { text: '0977 111 222' }));
    expect(again.customerPhone).toBe('0388111222');
    await expect(
      service.update(ws, c.id, { customerPhone: 'not a phone' }, lan),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await service.update(ws, c.id, { customerPhone: null }, lan)).customerPhone).toBeNull();
  });
});

describe('takeover', () => {
  const fiveMinutes = '2026-10-24T05:05:00.000Z';

  it('resumes the bot after the takeover minutes for a temporary takeover', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const u = await service.update(ws, c.id, { mode: 'human', takeover: 'temporary' }, lan);
    expect(u).toMatchObject({ mode: 'human', takeover: 'temporary', autoResumeAt: fiveMinutes });
  });

  it.each([
    ['the bot does not resume after manual replies', () => (bot.autoResumeAfterManual = false)],
    ['the bot is inactive', () => (bot.isActive = false)],
  ])('has no resume time when %s', async (_name, arrange) => {
    const c = await service.receive(ws, channelId, event('m1'));
    arrange();
    const u = await service.update(ws, c.id, { mode: 'human', takeover: 'temporary' }, lan);
    expect(u).toMatchObject({ takeover: 'temporary', autoResumeAt: null });
  });

  it('never resumes after a permanent or unspecified takeover, even when staff reply', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    for (const input of [
      { mode: 'human' as const, takeover: 'permanent' as const },
      { mode: 'human' as const },
    ]) {
      const u = await service.update(ws, c.id, input, lan);
      expect(u).toMatchObject({ takeover: 'permanent', autoResumeAt: null });
      await service.send(ws, c.id, { text: 'hi', idempotencyKey: newId() }, lan);
      expect((await service.get(ws, c.id)).conversation).toMatchObject({
        mode: 'human',
        takeover: 'permanent',
        autoResumeAt: null,
      });
    }
    // An echo from the Page inbox does not start the timer either.
    const echoed = await service.receive(ws, channelId, event('e1', { type: 'echo' }));
    expect(echoed).toMatchObject({ takeover: 'permanent', autoResumeAt: null });
  });

  it('treats an implicit takeover as temporary', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.send(ws, c.id, { text: 'hi', idempotencyKey: newId() }, lan);
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      takeover: 'temporary',
      autoResumeAt: fiveMinutes,
    });
    await service.update(ws, c.id, { mode: 'bot' }, lan);
    const echoed = await service.receive(ws, channelId, event('e1', { type: 'echo' }));
    expect(echoed).toMatchObject({
      mode: 'human',
      takeover: 'temporary',
      autoResumeAt: fiveMinutes,
    });
  });

  it('clears the takeover when switching back to the bot', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    await service.update(ws, c.id, { mode: 'human', takeover: 'permanent' }, lan);
    expect(await service.update(ws, c.id, { mode: 'bot' }, lan)).toMatchObject({
      mode: 'bot',
      takeover: null,
      autoResumeAt: null,
    });
  });

  it('is only valid together with mode human', () => {
    expect(UpdateConversationRequest.safeParse({ takeover: 'temporary' }).success).toBe(false);
    expect(
      UpdateConversationRequest.safeParse({ mode: 'bot', takeover: 'permanent' }).success,
    ).toBe(false);
    expect(
      UpdateConversationRequest.safeParse({ mode: 'human', takeover: 'permanent' }).success,
    ).toBe(true);
  });
});

describe('sender name', () => {
  it('records the staff display name on human messages only', async () => {
    const c = await service.receive(ws, channelId, event('m1'));
    const human = await service.send(ws, c.id, { text: 'Chào chị', idempotencyKey: newId() }, lan);
    expect(human.senderName).toBe('Lan');
    await service.update(ws, c.id, { mode: 'bot' }, lan);
    const bot = await service.commitBotReply(ws, c.id, {
      revision: (await service.getReplyContext(ws, c.id)).revision,
      text: 'Bot',
      idempotencyKey: 'bot:m1',
    });
    expect(bot?.senderName).toBeNull();
    await service.receive(ws, channelId, event('e1', { type: 'echo' }));
    const { messages } = await service.get(ws, c.id);
    expect(messages.map((m) => [m.sender, m.senderName])).toEqual([
      ['customer', null],
      ['human', 'Lan'],
      ['bot', null],
      ['human', null],
    ]);
  });
});

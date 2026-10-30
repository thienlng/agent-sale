import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  activityWindow,
  customRangeValid,
  compactWait,
  customerDisplayName,
  DEFAULT_LIST_STATE,
  filterChips,
  formatDay,
  formatRowTime,
  guardList,
  isFiltered,
  previewText,
  removeChip,
  resumeCountdown,
  tabCounts,
  toListQuery,
  waitMinutes,
  advancedPart,
  type ListState,
} from './inbox-list';
import { InboxConversationDto, InboxListResponse, type InboxConversation } from './inbox-v2-types';

function conv(id: string, patch: Partial<InboxConversation> = {}): InboxConversation {
  const base = InboxConversationDto.parse({
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d00',
    channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
    provider: 'facebook',
    customerName: id,
    customerId: id,
    mode: 'bot',
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: '',
    revision: 1,
    lastMessage: '',
    lastInboundAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
  });
  return { ...base, ...patch };
}
const state = (patch: Partial<ListState> = {}): ListState => ({ ...DEFAULT_LIST_STATE, ...patch });
const guest = (provider: string, last4: string) => `Khach ${provider} ${last4}`;

describe('inbox v2 DTOs', () => {
  it('fills the new fields when the API does not send them yet', () => {
    const c = conv('a');
    expect(c).toMatchObject({
      customerAvatarUrl: null,
      unreadCount: 0,
      lastReadAt: null,
      awaitingSince: null,
      lastMessageSender: 'customer',
      customerPhone: null,
      notes: [],
      tags: [],
    });
    expect(InboxListResponse.parse({ data: [] }).counts).toBeUndefined();
  });
  it('keeps the new fields the API sends', () => {
    const c = conv('a', { unreadCount: 3, tags: [{ id: 't', name: 'VIP', color: '#f26b1d' }] });
    expect(c.unreadCount).toBe(3);
    expect(c.tags[0]?.name).toBe('VIP');
  });
});

describe('filters', () => {
  it('counts changed groups only, not the search text or tab', () => {
    expect(activeFilterCount(state({ q: 'x', tab: 'unread' }))).toBe(0);
    expect(activeFilterCount(state({ tagsAny: ['a'], tagsExclude: ['b'] }))).toBe(1);
    expect(
      activeFilterCount(state({ waiting: 'longest', mode: 'bot', hasPhone: 'yes', status: 'all' })),
    ).toBe(4);
    expect(isFiltered(state({ tab: 'waiting' }))).toBe(true);
    expect(isFiltered(state())).toBe(false);
  });
  it('maps the state to the list query', () => {
    expect(toListQuery(state())).toEqual({ tab: 'all', status: 'open', limit: 100 });
    expect(
      toListQuery(
        state({
          q: ' lan ',
          tab: 'unread',
          assignee: 'me',
          hasPhone: 'no',
          waiting: 'longest',
          tagsAny: ['a', 'b'],
          tagsExclude: ['c'],
          untagged: true,
          provider: 'instagram',
          channelId: 'page',
          status: 'all',
          mode: 'human',
        }),
      ),
    ).toEqual({
      tab: 'unread',
      limit: 100,
      q: 'lan',
      assignee: 'me',
      channelId: 'page',
      provider: 'instagram',
      hasPhone: false,
      waiting: 'longest',
      sort: 'waitingLongest',
      mode: 'human',
      tagsAny: 'a,b',
      tagsExclude: 'c',
      untagged: true,
    });
  });
  it('lists one chip per active value and removes exactly that value', () => {
    const s = state({ tagsAny: ['a', 'b'], mode: 'bot', status: 'resolved' });
    const chips = filterChips(s);
    // The folder is named by its own "viewing" line, not a chip.
    expect(chips.map((c) => c.id)).toEqual(['tagsAny:a', 'tagsAny:b', 'mode']);
    const first = chips[0];
    if (!first) throw new Error('missing chip');
    expect(removeChip(s, first)).toEqual({ tagsAny: ['b'] });
    expect(removeChip(s, { id: 'status', kind: 'status' })).toEqual({ status: 'open' });
  });
  it('re-applies simple filters to stale rows', () => {
    const mine = conv('m', { assigneeId: 'sale-a' });
    const free = conv('f');
    const done = conv('d', { status: 'resolved', provider: 'instagram', mode: 'human' });
    const items = [mine, free, done];
    expect(guardList(items, state(), 'sale-a')).toEqual([mine, free]);
    expect(guardList(items, state({ assignee: 'me' }), 'sale-a')).toEqual([mine]);
    expect(guardList(items, state({ assignee: 'me' }), undefined)).toEqual([]);
    expect(guardList(items, state({ assignee: 'none' }), 'sale-a')).toEqual([free]);
    expect(guardList(items, state({ status: 'all', provider: 'instagram' }), 'x')).toEqual([done]);
    expect(guardList(items, state({ status: 'all', mode: 'human' }), 'x')).toEqual([done]);
    expect(guardList(items, state({ channelId: 'other' }), 'x')).toEqual([]);
  });
  it('uses server counts, or derives them from the page', () => {
    const items = [
      conv('a', { unreadCount: 2 }),
      conv('b', { awaitingSince: '2026-10-22T10:00:00.000Z' }),
    ];
    expect(tabCounts(items, { all: 9, unread: 4, waiting: 3 })).toEqual({
      all: 9,
      unread: 4,
      waiting: 3,
    });
    expect(tabCounts(items, undefined)).toEqual({ all: 2, unread: 1, waiting: 1 });
  });
});

describe('row helpers', () => {
  it('replaces a raw channel id with "Khách <channel> ·last4"', () => {
    expect(customerDisplayName(conv('1234567894821'), guest)).toBe('Khach Facebook 4821');
    expect(
      customerDisplayName(
        conv('x', { customerName: '  ', provider: 'instagram', customerId: 'ig-9876' }),
        guest,
      ),
    ).toBe('Khach Instagram 9876');
    expect(customerDisplayName(conv('x', { customerName: 'Nguyễn Thu Hà' }), guest)).toBe(
      'Nguyễn Thu Hà',
    );
  });
  it('measures and compacts the wait', () => {
    const now = Date.parse('2026-10-25T10:30:00.000Z');
    expect(waitMinutes('2026-10-25T10:18:00.000Z', now)).toBe(12);
    expect(waitMinutes('2026-10-25T11:00:00.000Z', now)).toBe(0);
    expect(waitMinutes(null, now)).toBeNull();
    expect(waitMinutes('bad', now)).toBeNull();
    expect(compactWait(12)).toEqual({ n: 12, unit: 'm' });
    expect(compactWait(125)).toEqual({ n: 2, unit: 'h' });
    expect(compactWait(3000)).toEqual({ n: 2, unit: 'd' });
  });
  it('counts down to the bot resuming', () => {
    const now = Date.parse('2026-10-25T10:00:00.000Z');
    expect(resumeCountdown('2026-10-25T10:04:12.000Z', now)).toBe('4:12');
    expect(resumeCountdown('2026-10-25T10:00:05.000Z', now)).toBe('0:05');
    expect(resumeCountdown('2026-10-25T09:59:00.000Z', now)).toBeNull();
    expect(resumeCountdown(null, now)).toBeNull();
  });
  it('formats times and media previews', () => {
    expect(formatDay(new Date(2026, 9, 22, 9).toISOString())).toBe('22/10/2026');
    const now = new Date(2026, 9, 25, 15).getTime();
    expect(formatRowTime(new Date(2026, 9, 25, 14, 2).toISOString(), now)).toBe('14:02');
    expect(formatRowTime(new Date(2026, 9, 22, 9).toISOString(), now)).toBe('22/10');
    const tr = (key: string) => `t:${key}`;
    expect(previewText('[image]', tr)).toBe('t:attachment.image');
    expect(previewText('[file]', tr)).toBe('t:attachment.file');
    expect(previewText('', tr)).toBe('t:noMessage');
    expect(previewText('hello', tr)).toBe('hello');
  });

  it('sends the quick filters and the Spam folder, and keeps the channel tab out of the filter count', () => {
    const state = { ...DEFAULT_LIST_STATE, starred: true, followUp: true, status: 'spam' as const };
    expect(toListQuery(state)).toMatchObject({ starred: true, followUp: true, status: 'spam' });
    expect(toListQuery(DEFAULT_LIST_STATE)).not.toHaveProperty('starred');
    expect(activeFilterCount({ ...DEFAULT_LIST_STATE, provider: 'facebook', starred: true })).toBe(
      0,
    );
    expect(isFiltered({ ...DEFAULT_LIST_STATE, followUp: true })).toBe(true);
    expect(filterChips({ ...DEFAULT_LIST_STATE, provider: 'instagram' })).toEqual([]);
  });

  it('separates advanced fields from search, tabs and quick filters', () => {
    const part = advancedPart({ ...DEFAULT_LIST_STATE, q: 'x', starred: true, mode: 'bot' });
    expect(part).not.toHaveProperty('q');
    expect(part).not.toHaveProperty('starred');
    expect(part).not.toHaveProperty('provider');
    expect(part).toMatchObject({ mode: 'bot' });
  });

  it('re-applies star, follow-up and folder to stale rows', () => {
    const row = (over: Partial<InboxConversation>) =>
      InboxConversationDto.parse({
        id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d00',
        channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
        provider: 'facebook',
        customerId: 'p',
        customerName: 'A',
        mode: 'bot',
        status: 'open',
        assigneeId: null,
        note: '',
        revision: 1,
        lastMessage: '',
        lastInboundAt: '2026-10-25T10:00:00.000Z',
        updatedAt: '2026-10-25T10:00:00.000Z',
        ...over,
      });
    const rows = [
      row({ starred: true }),
      row({ status: 'spam' }),
      row({ followUpAt: '2026-10-26T00:00:00.000Z' }),
    ];
    expect(guardList(rows, { ...DEFAULT_LIST_STATE, starred: true }, 'me')).toHaveLength(1);
    expect(guardList(rows, { ...DEFAULT_LIST_STATE, followUp: true }, 'me')).toHaveLength(1);
    expect(guardList(rows, { ...DEFAULT_LIST_STATE, status: 'spam' }, 'me')).toHaveLength(1);
  });
});

describe('bot and activity-time filters', () => {
  const bot = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d09';
  // 29 Oct 2026, 15:30 local time; day boundaries are local midnights.
  const now = new Date(2026, 9, 29, 15, 30);
  const day = (d: number) => new Date(2026, 9, d).toISOString();

  it('sends the bot and turns presets into day-aligned windows', () => {
    expect(toListQuery(state({ botId: bot }))).toMatchObject({ botId: bot });
    expect(toListQuery(state({ botId: 'none' }))).toMatchObject({ botId: 'none' });
    expect(toListQuery(state())).not.toHaveProperty('botId');
    expect(toListQuery(state())).not.toHaveProperty('updatedFrom');
    const window = (time: ListState['time']) => activityWindow(state({ time }), now);
    expect(window('today')).toEqual({ from: day(29) });
    expect(window('yesterday')).toEqual({ from: day(28), to: day(29) });
    expect(window('last7')).toEqual({ from: day(23) });
    expect(window('last30')).toEqual({ from: new Date(2026, 8, 30).toISOString() });
    expect(toListQuery(state({ time: 'yesterday' }), 100, now)).toMatchObject({
      updatedFrom: day(28),
      updatedTo: day(29),
    });
  });

  it('keeps the query stable within a day so the list is not refetched every render', () => {
    const later = new Date(2026, 9, 29, 23, 59);
    expect(toListQuery(state({ time: 'last7' }), 100, now)).toEqual(
      toListQuery(state({ time: 'last7' }), 100, later),
    );
  });

  it('includes both ends of a custom range and accepts open-ended ranges', () => {
    const custom = (timeFrom: string, timeTo: string) =>
      activityWindow(state({ time: 'custom', timeFrom, timeTo }), now);
    expect(custom('2026-10-01', '2026-10-03')).toEqual({ from: day(1), to: day(4) });
    expect(custom('2026-10-20', '2026-10-20')).toEqual({ from: day(20), to: day(21) });
    expect(custom('2026-10-20', '')).toEqual({ from: day(20) });
    expect(custom('', '2026-10-20')).toEqual({ to: day(21) });
    expect(custom('2026-10-21', '2026-10-20')).toBeNull();
    expect(custom('', '')).toBeNull();
    expect(customRangeValid('2026-10-21', '2026-10-20')).toBe(false);
    expect(customRangeValid('', '')).toBe(false);
    expect(customRangeValid('2026-10-20', '2026-10-21')).toBe(true);
    expect(customRangeValid('0026-10-20', '')).toBe(false);
    // An invalid custom range never reaches the API.
    const invalid = toListQuery(
      state({ time: 'custom', timeFrom: '2026-10-21', timeTo: '2026-10-20' }),
    );
    expect(invalid).not.toHaveProperty('updatedFrom');
    expect(invalid).not.toHaveProperty('updatedTo');
  });

  it('counts, chips and removes the bot and time filters', () => {
    const s = state({ botId: bot, time: 'custom', timeFrom: '2026-10-01', timeTo: '2026-10-02' });
    expect(activeFilterCount(s)).toBe(2);
    expect(isFiltered(s)).toBe(true);
    const chips = filterChips(s);
    expect(chips).toEqual([
      { id: 'botId', kind: 'botId', value: bot },
      { id: 'time', kind: 'time' },
    ]);
    expect(removeChip(s, chips[0]!)).toEqual({ botId: 'all' });
    expect(removeChip(s, chips[1]!)).toEqual({ time: 'any', timeFrom: '', timeTo: '' });
    expect(advancedPart(s)).toMatchObject({ botId: bot, time: 'custom', timeFrom: '2026-10-01' });
  });

  it('re-applies bot and time to stale or pushed rows', () => {
    const rows = [
      conv('a', { botId: bot, updatedAt: new Date(2026, 9, 29, 9).toISOString() }),
      conv('b', { botId: null, updatedAt: new Date(2026, 9, 28, 9).toISOString() }),
    ];
    const names = (s: ListState) => guardList(rows, s, 'me', now).map((c) => c.customerName);
    expect(names(state({ botId: bot }))).toEqual(['a']);
    expect(names(state({ botId: 'none' }))).toEqual(['b']);
    expect(names(state({ time: 'today' }))).toEqual(['a']);
    expect(names(state({ time: 'yesterday' }))).toEqual(['b']);
    expect(names(state({ time: 'custom', timeFrom: '2026-10-21', timeTo: '2026-10-20' }))).toEqual([
      'a',
      'b',
    ]);
  });
});

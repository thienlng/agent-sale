import type { ConversationDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import {
  filterByProvider,
  filterInbox,
  filterSalesQueue,
  formatDay,
  previewText,
  sortConversations,
} from './inbox-list';

function conv(id: string, updatedAt: string, provider: 'facebook' | 'instagram'): ConversationDto {
  return {
    id,
    channelId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d00',
    provider,
    customerName: id,
    customerId: id,
    mode: 'bot',
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: '',
    revision: 1,
    lastMessage: '',
    lastInboundAt: updatedAt,
    updatedAt,
  };
}
const a = conv('a', '2026-10-20T10:00:00.000Z', 'facebook');
const b = conv('b', '2026-10-22T10:00:00.000Z', 'instagram');
const c = conv('c', '2026-10-21T10:00:00.000Z', 'facebook');

describe('inbox list', () => {
  it('sorts by last activity, newest or oldest first', () => {
    expect(sortConversations([a, b, c], 'newest').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortConversations([a, b, c], 'oldest').map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
  it('does not mutate the input', () => {
    const input = [a, b, c];
    sortConversations(input, 'newest');
    expect(input.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('filters by provider', () => {
    expect(filterByProvider([a, b, c], 'instagram')).toEqual([b]);
    expect(filterByProvider([a, b, c], 'all')).toEqual([a, b, c]);
  });
  it('formats the row date and media previews', () => {
    expect(formatDay(new Date(2026, 9, 22, 9).toISOString())).toBe('22/10/2026');
    const tr = (key: string) => `t:${key}`;
    expect(previewText('[image]', tr)).toBe('t:attachment.image');
    expect(previewText('[file]', tr)).toBe('t:attachment.file');
    expect(previewText('', tr)).toBe('t:noMessage');
    expect(previewText('hello', tr)).toBe('hello');
  });
});

describe('sales queues', () => {
  const human = { ...a, mode: 'human' as const, assigneeId: 'sale-a' };
  const other = { ...b, assigneeId: 'sale-b', status: 'resolved' as const };
  const unassigned = { ...c, channelId: 'page-b' };

  it('separates ownership from AI mode and requires an identity for mine', () => {
    const items = [human, other, unassigned];
    expect(filterSalesQueue(items, 'mine', 'sale-a')).toEqual([human]);
    expect(filterSalesQueue(items, 'mine', undefined)).toEqual([]);
    expect(filterSalesQueue(items, 'unassigned', 'sale-a')).toEqual([unassigned]);
    expect(filterSalesQueue(items, 'human', 'sale-a')).toEqual([human]);
    expect(filterSalesQueue(items, 'bot', 'sale-a')).toEqual([other, unassigned]);
    expect(filterSalesQueue(items, 'all', 'sale-a')).toEqual(items);
  });

  it('applies page, status, mode and provider together before computing queues', () => {
    const items = [human, other, unassigned];
    expect(
      filterInbox(items, { provider: 'all', channelId: 'all', status: 'open', mode: 'all' }),
    ).toEqual([human, unassigned]);
    expect(
      filterInbox(items, { provider: 'facebook', channelId: 'page-b', status: 'all', mode: 'bot' }),
    ).toEqual([unassigned]);
    expect(
      filterInbox(items, {
        provider: 'instagram',
        channelId: 'page-b',
        status: 'all',
        mode: 'all',
      }),
    ).toEqual([]);
    expect(
      filterInbox(items, { provider: 'all', channelId: 'all', status: 'resolved', mode: 'all' }),
    ).toEqual([other]);
  });
});

describe('due follow-ups', () => {
  const now = Date.parse('2026-10-25T10:00:00.000Z');
  it('includes only open conversations at or after their follow-up time', () => {
    const due = { ...a, followUpAt: '2026-10-25T09:59:00.000Z' };
    const exact = { ...b, followUpAt: '2026-10-25T10:00:00.000Z' };
    const future = { ...c, followUpAt: '2026-10-25T10:00:01.000Z' };
    const closed = { ...due, status: 'resolved' as const };
    expect(
      filterSalesQueue(
        [due, exact, future, closed, a, { ...a, followUpAt: 'invalid' }],
        'due',
        undefined,
        now,
      ),
    ).toEqual([due, exact]);
    expect(filterSalesQueue([future], 'due', undefined, now + 1000)).toEqual([future]);
  });
});

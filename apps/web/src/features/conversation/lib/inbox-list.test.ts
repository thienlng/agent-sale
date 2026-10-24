import type { ConversationDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { filterByProvider, formatDay, previewText, sortConversations } from './inbox-list';

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

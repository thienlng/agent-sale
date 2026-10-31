import type { InboxMessageDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import { toReplyTurns, toTimedReplyTurns } from '../application/jobs/reply-turns.js';

let seq = 0;
function msg(sender: InboxMessageDto['sender'], text: string, createdAt: string): InboxMessageDto {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    conversationId: '00000000-0000-4000-8000-000000000000',
    direction: sender === 'customer' ? 'inbound' : 'outbound',
    sender,
    text,
    attachments: [],
    status: sender === 'customer' ? 'received' : 'sent',
    failureCode: null,
    externalId: null,
    createdAt,
  };
}

describe('toTimedReplyTurns', () => {
  it('stamps each turn with its newest message time, aligned with the turns', () => {
    const stored = [
      msg('customer', 'Shop ơi', '2026-10-31T01:00:00.000Z'),
      msg('customer', 'còn hàng không', '2026-10-31T01:00:05.000Z'),
      msg('bot', 'Dạ còn ạ.', '2026-10-31T01:00:10.000Z'),
      msg('bot', 'Bạn cần mẫu nào?', '2026-10-31T01:00:11.000Z'),
      msg('customer', 'Mẫu gỗ', '2026-10-31T01:01:00.000Z'),
    ];

    const { turns, times } = toTimedReplyTurns(stored);

    expect(turns).toEqual(toReplyTurns(stored));
    expect(turns.map((t) => t.role)).toEqual(['customer', 'bot', 'customer']);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-10-31T01:00:05.000Z',
      '2026-10-31T01:00:11.000Z',
      '2026-10-31T01:01:00.000Z',
    ]);
  });

  it('keeps the times aligned when the history is cut to the last 20 turns', () => {
    const stored = Array.from({ length: 25 }, (_, i) =>
      msg(i % 2 ? 'bot' : 'customer', `m${i}`, new Date(Date.UTC(2026, 9, 31, 1, i)).toISOString()),
    );

    const { turns, times } = toTimedReplyTurns(stored);

    expect(turns).toHaveLength(20);
    expect(times).toHaveLength(20);
    expect(turns[0]?.content).toBe('m5');
    expect(times[0]?.toISOString()).toBe('2026-10-31T01:05:00.000Z');
  });
});

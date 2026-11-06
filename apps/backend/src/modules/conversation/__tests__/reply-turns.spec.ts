import type { InboxMessageDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';
import {
  sentBotMediaUrls,
  toReplyTurns,
  toTimedReplyTurns,
} from '../application/jobs/reply-turns.js';

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

  it('keeps the times aligned when the history is cut to the last 100 turns', () => {
    const stored = Array.from({ length: 105 }, (_, i) =>
      msg(i % 2 ? 'bot' : 'customer', `m${i}`, new Date(Date.UTC(2026, 9, 31, 1, i)).toISOString()),
    );

    const { turns, times } = toTimedReplyTurns(stored);

    expect(turns).toHaveLength(100);
    expect(times).toHaveLength(100);
    expect(turns[0]?.content).toBe('m5');
    expect(times[0]?.toISOString()).toBe('2026-10-31T01:05:00.000Z');
  });
});

describe('bot attachments in the history (T-192)', () => {
  it("describes what the bot sent in its own words, never as the customer's", () => {
    const album = {
      ...msg('bot', '', '2026-11-05T01:00:01.000Z'),
      attachments: Array.from({ length: 8 }, (_, i) => ({
        type: 'image' as const,
        url: `https://img.example.com/${i}.jpg`,
      })),
    };
    const video = {
      ...msg('bot', '', '2026-11-05T01:00:02.000Z'),
      attachments: [{ type: 'video' as const, url: 'https://rapiz.test/media/lodging/v.mp4' }],
    };
    const { turns } = toTimedReplyTurns([
      msg('customer', 'cho xem phòng', '2026-11-05T01:00:00.000Z'),
      album,
      video,
      msg('customer', 'xem thêm', '2026-11-05T01:01:00.000Z'),
    ]);
    expect(turns[1]).toEqual({ role: 'bot', content: '[Bot đã gửi 8 ảnh]\n[Bot đã gửi 1 video]' });
    expect(JSON.stringify(turns)).not.toContain('Khách đã gửi kèm');
  });

  it('lists the attachment URLs the bot sent in the last 30 days', () => {
    const at = (iso: string, url: string, sender: 'bot' | 'human' = 'bot') => ({
      ...msg(sender, '', iso),
      attachments: [{ type: 'image' as const, url }],
    });
    const recent = at('2026-11-04T00:00:00.000Z', 'https://img.example.com/new.jpg');
    const stored = [
      at('2026-09-01T00:00:00.000Z', 'https://img.example.com/old.jpg'),
      recent,
      {
        ...at('2026-11-04T00:00:00.000Z', 'https://img.example.com/failed.jpg'),
        status: 'failed' as const,
      },
      at('2026-11-04T00:00:00.000Z', 'https://img.example.com/staff.jpg', 'human'),
      recent,
    ];
    expect(sentBotMediaUrls(stored, new Date('2026-11-05T00:00:00.000Z'))).toEqual([
      'https://img.example.com/new.jpg',
    ]);
  });
});

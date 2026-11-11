import { ConversationDto, type InboxMessageDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { buildSignalContext } from '../application/signal-context.js';

const CONV = '0190f5c2-0000-7000-8000-00000000c001';
const conv = ConversationDto.parse({
  id: CONV,
  channelId: '0190f5c2-0000-7000-8000-00000000c0c1',
  provider: 'facebook',
  customerId: 'psid-1',
  customerName: 'Chị Lan',
  mode: 'bot',
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 3,
  lastMessage: '',
  lastInboundAt: '2026-11-11T02:00:00.000Z',
  updatedAt: '2026-11-11T02:00:00.000Z',
});

let n = 0;
const message = (
  sender: InboxMessageDto['sender'],
  text: string,
  minute: number,
  status: InboxMessageDto['status'] = 'received',
): InboxMessageDto => ({
  id: `0190f5c2-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  conversationId: CONV,
  direction: sender === 'customer' ? 'inbound' : 'outbound',
  sender,
  text,
  attachments: [],
  status,
  failureCode: null,
  externalId: null,
  createdAt: new Date(Date.UTC(2026, 10, 11, 1, minute)).toISOString(),
});

describe('buildSignalContext', () => {
  it('keeps only messages after the cursor, oldest first, without failed sends', () => {
    const msgs = [
      message('customer', 'Chào shop', 0),
      message('bot', 'Dạ em chào chị', 1),
      message('human', 'Gửi lỗi', 2, 'failed'),
      message('customer', 'Giá bao nhiêu?', 3),
    ];
    const ctx = buildSignalContext(conv, msgs, new Date(Date.UTC(2026, 10, 11, 1, 0)));
    expect(ctx.messages.map((m) => m.text)).toEqual(['Dạ em chào chị', 'Giá bao nhiêu?']);
    expect(ctx.facts).toMatchObject({
      status: 'open',
      customerName: 'Chị Lan',
      lastInboundAt: '2026-11-11T02:00:00.000Z',
      isTest: false,
    });
  });

  it('keeps the newest 40 messages and 8 000 characters', () => {
    const many = Array.from({ length: 50 }, (_, i) => message('customer', `m${i}`, i));
    const ctx = buildSignalContext(conv, many, null);
    expect(ctx.messages).toHaveLength(40);
    expect(ctx.messages[0]?.text).toBe('m10');
    expect(ctx.messages[39]?.text).toBe('m49');

    const long = [
      message('customer', 'a'.repeat(5000), 0),
      message('customer', 'b'.repeat(5000), 1),
    ];
    const cut = buildSignalContext(conv, long, null);
    expect(cut.messages.map((m) => m.text.length)).toEqual([3000, 5000]);
  });
});

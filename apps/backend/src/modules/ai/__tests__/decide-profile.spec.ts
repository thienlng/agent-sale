import { describe, expect, it } from 'vitest';

import type { BotView } from '../../bot/api/index.js';
import { decide } from '../application/decide-reply.js';

const bot = {
  mission: '',
  greeting: '',
  fallbackMessage: 'Dạ để em kiểm tra lại ạ.',
  handoffMessage: '',
  language: 'vi',
  placeholders: {},
  profile: {
    fields: {
      hotline: '0901234567',
      openingHours: '08:00 - 21:00',
      referencePrices: 'Áo thun từ 199k',
    },
    notes: 'Đặt cọc 30% khi đặt phòng đoàn',
  },
} as unknown as BotView;

const answer = (reply: string) => ({
  ok: true as const,
  value: { outcome: 'answer' as const, reply, sources: [], imageIds: [] },
});

const run = (reply: string) => decide('end_turn', answer(reply), bot, [], [], '');

describe('decide with the business profile (T-137)', () => {
  it('accepts a reply that quotes the profile hotline, hours and a reference price', () => {
    const res = run('Dạ hotline 0901234567, mở cửa 08:00 - 21:00, áo thun từ 199k ạ');
    expect(res.outcome).toBe('answered');
    expect(res.guardrail).toBeNull();
  });

  it('accepts a figure that only the notes give', () => {
    expect(run('Dạ đặt phòng đoàn cần cọc 30% ạ').outcome).toBe('answered');
  });

  it('still rejects a figure absent from the profile and every other source', () => {
    const res = run('Dạ áo thun giá 99k ạ');
    expect(res.outcome).toBe('fallback');
    expect(res.guardrail).toBe('ungrounded_figure:99k');
  });
});

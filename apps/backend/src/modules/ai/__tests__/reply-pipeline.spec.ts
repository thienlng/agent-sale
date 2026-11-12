import { describe, expect, it } from 'vitest';
import type { AgentLoopResult } from '@agent-sales/ai-core';

import type { BotView } from '../../bot/api/index.js';
import { newOutputState } from '../application/output-tools.js';
import { decideReply, joinedImages } from '../application/reply-pipeline.js';

describe('joinedImages', () => {
  it('keeps each picture once and stays within the 30-picture contract', () => {
    const images = Array.from({ length: 40 }, (_, i) => ({
      url: `https://media.example/products/ws/${i}.jpg`,
      label: `p${i}`,
    }));
    const joined = joinedImages([images[0]!, ...images]);
    expect(joined).toHaveLength(30);
    expect(joined[0]).toEqual({ url: images[0]!.url, label: 'p0' });
    expect(new Set(joined.map((i) => i.url)).size).toBe(30);
  });
});

describe('decideReply', () => {
  const bot = { id: 'b1', name: 'TinyMind', language: 'vi' } as unknown as BotView;
  const loop = (text: string) =>
    ({
      res: { text, toolCalls: [], stopReason: 'end' },
      outcome: 'final',
      steps: [],
    }) as unknown as AgentLoopResult;

  it('drops a final answer that repeats a message sent this turn (EV-5)', () => {
    const output = newOutputState();
    output.sent.push({
      text: 'Dạ bộ thú gỗ phù hợp bé từ 1 tuổi ạ.',
      images: [],
      via: 'send_message',
    });
    const repeat = decideReply({
      loop: loop('Dạ bộ thú gỗ  phù hợp bé từ 1 tuổi ạ.\n'),
      output,
      bot,
      actionFallback: null,
    });
    expect(repeat).toEqual({ outcome: 'answered', guardrail: null, final: null });
    const other = decideReply({
      loop: loop('Bé thích mẫu nào hơn ạ?'),
      output,
      bot,
      actionFallback: null,
    });
    expect(other.final).toBe('Bé thích mẫu nào hơn ạ?');
  });
});

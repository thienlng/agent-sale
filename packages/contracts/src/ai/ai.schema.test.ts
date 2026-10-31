import { describe, expect, it } from 'vitest';

import { PlaygroundResponse } from './ai.schema.js';

const base = {
  runId: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
  reply: 'Hi',
  outcome: 'answered',
  guardrail: null,
  sources: [],
  usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
  provider: 'fake',
  model: 'fake',
  latencyMs: 5,
};

describe('PlaygroundResponse harness v2 fields', () => {
  it('accepts messages, steps and interrupted', () => {
    const parsed = PlaygroundResponse.parse({
      ...base,
      messages: [
        {
          text: 'Hi',
          images: [{ id: 'i1', url: 'https://x.test/a.jpg', label: 'A' }],
          via: 'send_message',
        },
        { text: 'Bye', images: [], via: 'final' },
      ],
      steps: [{ kind: 'tool', name: 'search', ok: true, ms: 12 }, { kind: 'model' }],
      interrupted: true,
    });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.interrupted).toBe(true);
  });

  it('still accepts a response without them', () => {
    const parsed = PlaygroundResponse.parse(base);
    expect(parsed.messages).toBeUndefined();
    expect(parsed.steps).toBeUndefined();
  });
});

describe('PlaygroundResponse quick replies', () => {
  const message = (quickReplies: unknown) => ({
    ...base,
    messages: [{ text: 'Tóm tắt đơn', images: [], via: 'send_message', quickReplies }],
  });

  it('accepts up to three quick replies on a message', () => {
    const replies = [
      { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
      { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
    ];
    expect(PlaygroundResponse.parse(message(replies)).messages?.[0]?.quickReplies).toEqual(replies);
    expect(
      PlaygroundResponse.parse(message(undefined)).messages?.[0]?.quickReplies,
    ).toBeUndefined();
  });

  it('rejects a fourth reply, a title over 20 characters and a payload over 100', () => {
    const r = { title: 'Ok', payload: 'OK' };
    expect(PlaygroundResponse.safeParse(message([r, r, r, r])).success).toBe(false);
    expect(PlaygroundResponse.safeParse(message([{ ...r, title: 'x'.repeat(21) }])).success).toBe(
      false,
    );
    expect(
      PlaygroundResponse.safeParse(message([{ ...r, payload: 'x'.repeat(101) }])).success,
    ).toBe(false);
  });
});

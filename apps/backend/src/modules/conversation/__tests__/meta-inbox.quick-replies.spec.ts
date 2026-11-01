import { describe, expect, it, vi } from 'vitest';
import { answer, job, pics, setup } from './factories/meta-inbox-harness.js';

// Spec §4.4: the order summary's quick replies ride on the LAST text bubble only, with the same
// pacing and idempotency keys as any other send.

const buttons = [
  { title: '✅ Đặt hàng', payload: 'ORDER_CONFIRM' },
  { title: '✏️ Sửa thông tin', payload: 'ORDER_EDIT' },
];

describe('MetaInboxProcessor — quick replies', () => {
  it('attaches quick replies to the last bubble of a two-bubble summary; keys are unchanged', async () => {
    const { ai, channels, keys, texts, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({
        text: 'Dạ em tóm tắt.\n\nTổng: 2.250.000đ',
        images: [],
        quickReplies: buttons,
      });
      return answer('');
    });
    await run(job('q1', 'chốt đơn'));
    expect(keys()).toEqual(['bot:q1:s1', 'bot:q1:s1:t2']);
    expect(texts()).toEqual(['Dạ em tóm tắt.', 'Tổng: 2.250.000đ']);
    const sent = vi.mocked(channels.deliver).mock.calls.map((c) => c[3].quickReplies);
    expect(sent).toEqual([undefined, buttons]);
  });

  it('sends the album first and the text with the buttons last when both are present', async () => {
    const { ai, channels, keys, texts, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({
        text: 'Dạ em tóm tắt.\n\nTổng: 460.000đ',
        images: pics,
        quickReplies: buttons,
      });
      return answer('');
    });
    await run(job('q2', 'chốt'));
    expect(keys()).toEqual(['bot:q2:s1:img', 'bot:q2:s1', 'bot:q2:s1:t2']);
    expect(texts()).toEqual(['', 'Dạ em tóm tắt.', 'Tổng: 460.000đ']);
    const sent = vi.mocked(channels.deliver).mock.calls.map((c) => c[3].quickReplies);
    expect(sent).toEqual([undefined, undefined, buttons]);
  });

  it('keeps text first, then the album, when there are no quick replies', async () => {
    const { ai, keys, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Mẫu này ạ', images: pics });
      return answer('');
    });
    await run(job('q4', 'xem mẫu'));
    expect(keys()).toEqual(['bot:q4:s1', 'bot:q4:s1:img']);
  });

  it('sends no quick replies when the message has none', async () => {
    const { ai, channels, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Một. Hai.', images: [] });
      return answer('Ba');
    });
    await run(job('q3', 'hi'));
    for (const call of vi.mocked(channels.deliver).mock.calls)
      expect(call[3].quickReplies).toBeUndefined();
  });
});

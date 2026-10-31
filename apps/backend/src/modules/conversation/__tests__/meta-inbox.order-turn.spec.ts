import { describe, expect, it, vi } from 'vitest';
import {
  answer,
  channelId,
  job,
  pics,
  setup,
  ws,
  type ReplyResult,
} from './factories/meta-inbox-harness.js';

// Bot orders (spec §4): the sink reports a send that was cut short, a turn that created an order
// never loses its final, and the agent learns the conversation's channel.

describe('MetaInboxProcessor — cut-short sends', () => {
  it('reports complete: true when every bubble and the album went out', async () => {
    const { ai, run } = setup();
    const results: unknown[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'Một. Hai.', images: pics }));
      return answer('');
    });
    await run(job('c1', 'hi'));
    expect(results).toEqual([{ delivered: 3, complete: true }]);
  });

  it('reports complete: false when a newer message stops it between bubbles', async () => {
    const { ai, channels, keys, run } = setup();
    vi.mocked(channels.deliver).mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return { externalId: 'x1', status: 'sent', failureCode: null };
    });
    const results: unknown[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'Một. Hai.', images: [] }));
      return answer('');
    });
    await run(job('c2', 'hi'));
    expect(keys()).toEqual(['bot:c2:s1']);
    expect(results).toEqual([{ delivered: 1, complete: false }]);
  });

  it('reports complete: false after a takeover or a failed bubble', async () => {
    const { ai, channels, takeOver, run } = setup();
    vi.mocked(channels.deliver)
      .mockImplementationOnce(async () => {
        await takeOver();
        return { externalId: 'x1', status: 'sent', failureCode: null };
      })
      .mockResolvedValueOnce({ externalId: null, status: 'failed', failureCode: 'x' });
    const results: unknown[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'Một. Hai.', images: [] }));
      return answer('');
    });
    await run(job('c3', 'hi'));
    expect(results).toEqual([{ delivered: 1, complete: false }]);

    const second = setup();
    vi.mocked(second.channels.deliver).mockResolvedValueOnce({
      externalId: null,
      status: 'failed',
      failureCode: 'provider_rejected',
    });
    const failed: unknown[] = [];
    second.ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      failed.push(await options.sink!.send({ text: 'Một. Hai.', images: [] }));
      return answer('');
    });
    await second.run(job('c4', 'hi'));
    expect(failed).toEqual([{ delivered: 0, complete: false }]);
  });

  it('reports complete: false when no picture of the album went out', async () => {
    const { ai, channels, run } = setup();
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: null,
      status: 'failed',
      failureCode: 'provider_rejected',
    });
    const results: unknown[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ images: pics }));
      return answer('');
    });
    await run(job('c5', 'ảnh'));
    expect(results).toEqual([{ delivered: 0, complete: false }]);
  });
});

describe('MetaInboxProcessor — a turn that created an order', () => {
  const ordered = (extra: Partial<ReplyResult> = {}) =>
    ({ ...answer('Dạ đơn DH123 đã được tạo ạ'), orderCreated: true, ...extra }) as never;

  it('sends the final even when a newer message arrived after the run, and does not re-run', async () => {
    const { ai, channels, texts, run } = setup();
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return ordered();
    });
    await run(job('o1', 'ok'));
    expect(texts()).toEqual(['Dạ đơn DH123 đã được tạo ạ']);
    expect(channels.requeueEvent).not.toHaveBeenCalled();
    expect(channels.completeEvent).toHaveBeenCalled();
  });

  it('does not re-run an interrupted turn that created an order', async () => {
    const { ai, channels, texts, run } = setup();
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return ordered({ interrupted: true, carry: [] });
    });
    await run(job('o2', 'chốt'));
    expect(texts()).toEqual(['Dạ đơn DH123 đã được tạo ạ']);
    expect(channels.requeueEvent).not.toHaveBeenCalled();
  });

  it('still drops a stale final without an order (control)', async () => {
    const { ai, channels, texts, run } = setup();
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return answer('Dạ còn hàng ạ');
    });
    await run(job('o3', 'còn không'));
    expect(texts()).toEqual([]);
    expect(channels.requeueEvent).toHaveBeenCalledTimes(1);
  });
});

describe('MetaInboxProcessor — channel option', () => {
  it.each(['facebook', 'instagram', 'website'] as const)(
    'passes the conversation channel (%s) to the agent',
    async (kind) => {
      const { ai, channels, run } = setup();
      const connection = await channels.getConnection(ws, channelId);
      vi.mocked(channels.getConnection).mockResolvedValue({ ...connection, provider: kind });
      const event = job(`k-${kind}`, 'hi');
      event.event.kind = kind;
      await run(event);
      expect(ai.reply).toHaveBeenCalledTimes(1);
      expect(ai.reply.mock.calls[0]?.[3]).toMatchObject({ channel: kind });
    },
  );
});

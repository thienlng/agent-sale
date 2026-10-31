import { workspaceId } from '@agent-sales/shared';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { LlmCallError, LlmGateway, type GenerateRequest } from './gateway.js';
import { PromptRegistry } from './prompts.js';
import { FakeLlmProvider } from './providers/fake.js';

const ws = workspaceId('0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10');
const req: GenerateRequest = {
  workspaceId: ws,
  tier: 'smart',
  messages: [{ role: 'user', content: 'hi' }],
};

describe('LlmGateway', () => {
  it('routes a tier to its provider/model and records usage', async () => {
    const primary = new FakeLlmProvider('primary', () => ({ text: 'hello' }));
    const recorded: string[] = [];
    const gw = new LlmGateway([primary], tiers('primary'), {
      record: async (_r, res) => {
        recorded.push(`${res.provider}/${res.model}`);
      },
    });
    const res = await gw.generate(req);
    expect(res.text).toBe('hello');
    expect(recorded).toEqual(['primary/model-a']);
  });

  it('falls back to the secondary provider when the primary fails', async () => {
    const primary = new FakeLlmProvider('primary', () =>
      Object.assign(new Error('rate limited'), { status: 429 }),
    );
    const backup = new FakeLlmProvider('backup', () => ({ text: 'from backup' }));
    const gw = new LlmGateway([primary, backup], tiers('primary', 'backup'), {}, instant());
    const res = await gw.generate(req);
    expect(res.provider).toBe('backup');
    expect(primary.calls).toHaveLength(4);
    expect(backup.calls).toHaveLength(1);
  });

  describe('retries', () => {
    it.each(['rate_limit', 'overloaded', 'timeout', 'network'] as const)(
      'retries %s up to 3 times with full-jitter delays',
      async (kind) => {
        vi.useFakeTimers();
        try {
          const primary = new FakeLlmProvider('primary', () => new LlmCallError(kind, 'x'));
          const gw = new LlmGateway([primary], tiers('primary'), {}, { random: () => 0.5 });
          const settled = gw.generate(req).then(
            () => 'ok',
            (e: unknown) => e,
          );
          await vi.advanceTimersByTimeAsync(499);
          expect(primary.calls).toHaveLength(1);
          await vi.advanceTimersByTimeAsync(1); // 0.5 × 1000
          expect(primary.calls).toHaveLength(2);
          await vi.advanceTimersByTimeAsync(1_000); // 0.5 × 2000
          expect(primary.calls).toHaveLength(3);
          await vi.advanceTimersByTimeAsync(2_000); // 0.5 × 4000
          expect(primary.calls).toHaveLength(4);
          expect(await settled).toBeInstanceOf(LlmCallError);
          expect(primary.calls).toHaveLength(4);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it('caps the jitter ceiling at 15 s', async () => {
      const delays: number[] = [];
      const primary = new FakeLlmProvider('primary', () => new LlmCallError('network', 'x'));
      const gw = new LlmGateway(
        [primary],
        tiers('primary'),
        {},
        {
          random: () => 0.999,
          sleep: async (ms) => void delays.push(ms),
        },
      );
      await expect(gw.generate(req)).rejects.toThrow();
      expect(delays).toEqual([999, 1_998, 3_996]);
    });

    it('honours retryAfterMs, capped by the request timeout', async () => {
      const delays: number[] = [];
      const primary = new FakeLlmProvider(
        'primary',
        () => new LlmCallError('rate_limit', 'x', 8_000),
      );
      const gw = new LlmGateway(
        [primary],
        tiers('primary'),
        {},
        {
          sleep: async (ms) => void delays.push(ms),
        },
      );
      await expect(gw.generate(req)).rejects.toThrow();
      expect(delays).toEqual([8_000, 8_000, 8_000]);
      delays.length = 0;
      vi.useFakeTimers(); // freezes Date.now so the remaining deadline is exact
      try {
        await expect(gw.generate({ ...req, timeoutMs: 5_000 })).rejects.toThrow();
      } finally {
        vi.useRealTimers();
      }
      expect(delays).toEqual([5_000, 5_000, 5_000]);
    });

    it.each(['auth', 'invalid_request', 'content_filter', 'context_too_long', 'aborted'] as const)(
      'never retries %s',
      async (kind) => {
        const primary = new FakeLlmProvider('primary', () => new LlmCallError(kind, 'x'));
        const gw = new LlmGateway([primary], tiers('primary'), {}, instant());
        await expect(gw.generate(req)).rejects.toBeInstanceOf(LlmCallError);
        expect(primary.calls).toHaveLength(1);
      },
    );

    it('does not fall back after an abort', async () => {
      const primary = new FakeLlmProvider('primary', () => new LlmCallError('aborted', 'x'));
      const backup = new FakeLlmProvider('backup');
      const gw = new LlmGateway([primary, backup], tiers('primary', 'backup'), {}, instant());
      await expect(gw.generate(req)).rejects.toBeInstanceOf(LlmCallError);
      expect(backup.calls).toHaveLength(0);
    });

    it('stops sleeping when the request is aborted', async () => {
      const controller = new AbortController();
      const primary = new FakeLlmProvider('primary', () => new LlmCallError('network', 'x'));
      const gw = new LlmGateway([primary], tiers('primary'), {}, { random: () => 1 });
      const pending = gw.generate({ ...req, signal: controller.signal });
      await new Promise((r) => setTimeout(r, 10));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(primary.calls).toHaveLength(1);
    });

    it('records once per successful response and succeeds after a transient failure', async () => {
      let n = 0;
      const primary = new FakeLlmProvider('primary', () =>
        ++n < 3 ? new LlmCallError('overloaded', 'x') : { text: 'fine' },
      );
      let records = 0;
      const gw = new LlmGateway(
        [primary],
        tiers('primary'),
        { record: async () => void records++ },
        instant(),
      );
      expect((await gw.generate(req)).text).toBe('fine');
      expect(records).toBe(1);
    });

    it('retries unknown only with a 5xx status', async () => {
      const bare = new FakeLlmProvider('bare', () => new LlmCallError('unknown', 'x'));
      await expect(
        new LlmGateway([bare], tiers('bare'), {}, instant()).generate(req),
      ).rejects.toBeInstanceOf(LlmCallError);
      expect(bare.calls).toHaveLength(1);
      const five = new FakeLlmProvider(
        'five',
        () => new LlmCallError('unknown', 'x', undefined, 502),
      );
      await expect(
        new LlmGateway([five], tiers('five'), {}, instant()).generate(req),
      ).rejects.toBeInstanceOf(LlmCallError);
      expect(five.calls).toHaveLength(4);
      const gone = new FakeLlmProvider('gone', () =>
        Object.assign(new Error('x'), { status: 402 }),
      );
      await expect(
        new LlmGateway([gone], tiers('gone'), {}, instant()).generate(req),
      ).rejects.toThrow();
      expect(gone.calls).toHaveLength(1);
    });

    it('does not retry an SDK user abort and rejects unregistered providers without retrying', async () => {
      const p = new FakeLlmProvider('p', () =>
        Object.assign(new Error('x'), { name: 'APIUserAbortError' }),
      );
      await expect(new LlmGateway([p], tiers('p'), {}, instant()).generate(req)).rejects.toThrow();
      expect(p.calls).toHaveLength(1);
      await expect(
        new LlmGateway([], tiers('missing'), {}, instant()).generate(req),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
    });

    it('does not fall back on auth or invalid_request', async () => {
      for (const kind of ['auth', 'invalid_request'] as const) {
        const primary = new FakeLlmProvider('primary', () => new LlmCallError(kind, 'x'));
        const backup = new FakeLlmProvider('backup');
        const gw = new LlmGateway([primary, backup], tiers('primary', 'backup'), {}, instant());
        await expect(gw.generate(req)).rejects.toBeInstanceOf(LlmCallError);
        expect(backup.calls).toHaveLength(0);
      }
    });

    it('retries an empty answer as one of the 3 retries, then falls back', async () => {
      let n = 0;
      const primary = new FakeLlmProvider('primary', () => ({ text: ++n === 1 ? '' : 'second' }));
      const gw = new LlmGateway([primary], tiers('primary'), {}, instant());
      expect((await gw.generate(req)).text).toBe('second');
      expect(primary.calls).toHaveLength(2);

      const empty = new FakeLlmProvider('empty', () => ({ text: '' }));
      const gw2 = new LlmGateway([empty], tiers('empty'), {}, instant());
      expect((await gw2.generate(req)).text).toBe('');
      expect(empty.calls).toHaveLength(4);

      const backup = new FakeLlmProvider('backup', () => ({ text: 'rescued' }));
      const empty2 = new FakeLlmProvider('empty', () => ({ text: '' }));
      const gw3 = new LlmGateway([empty2, backup], tiers('empty', 'backup'), {}, instant());
      expect((await gw3.generate(req)).text).toBe('rescued');
      expect(empty2.calls).toHaveLength(4);
      expect(backup.calls).toHaveLength(1);
    });

    it('treats timeoutMs as the total deadline across attempts and sleeps', async () => {
      vi.useFakeTimers();
      try {
        const primary = new FakeLlmProvider(
          'primary',
          () => new LlmCallError('rate_limit', 'x', 60_000),
        );
        const gw = new LlmGateway([primary], tiers('primary'), {}, { random: () => 1 });
        const settled = gw.generate({ ...req, timeoutMs: 10_000 }).then(
          () => 'ok',
          (e: unknown) => e,
        );
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await settled).toBeInstanceOf(LlmCallError);
        expect(primary.calls).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives each attempt only the remaining time and caps Retry-After at 15 s without a deadline', async () => {
      vi.useFakeTimers();
      try {
        const seen: Array<number | undefined> = [];
        let n = 0;
        const primary = new FakeLlmProvider('primary', (r) => {
          seen.push(r.timeoutMs);
          return ++n < 3 ? new LlmCallError('network', 'x') : { text: 'ok' };
        });
        const gw = new LlmGateway([primary], tiers('primary'), {}, { random: () => 0.5 });
        const done = gw.generate({ ...req, timeoutMs: 10_000 });
        await vi.advanceTimersByTimeAsync(2_000);
        await done;
        expect(seen).toEqual([10_000, 9_500, 8_500]);

        const delays: number[] = [];
        const slow = new FakeLlmProvider(
          'slow',
          () => new LlmCallError('rate_limit', 'x', 600_000),
        );
        const gw2 = new LlmGateway(
          [slow],
          tiers('slow'),
          {},
          { sleep: async (ms) => void delays.push(ms) },
        );
        await expect(gw2.generate(req)).rejects.toThrow();
        expect(delays).toEqual([15_000, 15_000, 15_000]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('runs the admission hook before calling any provider', async () => {
    const primary = new FakeLlmProvider('primary');
    const gw = new LlmGateway([primary], tiers('primary'), {
      admit: async () => {
        throw new Error('over budget');
      },
    });
    await expect(gw.generate(req)).rejects.toThrow('over budget');
    expect(primary.calls).toHaveLength(0);
  });
});

describe('PromptRegistry', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');

  it('loads a pinned version and renders placeholders', async () => {
    const reg = new PromptRegistry(dir);
    const tpl = await reg.load({ name: 'sales-agent', version: 1 });
    const out = reg.render(tpl, {
      'workspace.name': 'Shop ABC',
      'bot.customerPronoun': 'anh/chị',
      'bot.selfPronoun': 'em',
      'bot.mission': 'Sell shoes',
    });
    expect(out).toContain('Shop ABC');
    expect(out).not.toContain('{{');
  });

  it('refuses to render with a missing placeholder', () => {
    const reg = new PromptRegistry(dir);
    expect(() => reg.render('Hi {{name}}', {})).toThrow('name');
  });
});

function instant() {
  return { random: () => 0, sleep: async () => {} };
}

function tiers(provider: string, fallbackProvider?: string) {
  const p = {
    provider,
    model: 'model-a',
    ...(fallbackProvider ? { fallback: { provider: fallbackProvider, model: 'model-b' } } : {}),
  };
  return { basic: p, smart: p, pro: p, neo: p };
}

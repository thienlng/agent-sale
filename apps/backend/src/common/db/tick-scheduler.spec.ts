import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTickScheduler } from './tick-scheduler.js';

describe('tick scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces notifications arriving during a tick into one extra tick', async () => {
    let release: () => void = () => undefined;
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const s = createTickScheduler({ tick });
    s.setListenerUp(true);
    expect(tick).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) s.wake();
    expect(tick).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('polls every 300 ms while down and every 5 000 ms while up', async () => {
    const tick = vi.fn(async () => undefined);
    const s = createTickScheduler({ tick });
    await vi.advanceTimersByTimeAsync(900);
    expect(tick).toHaveBeenCalledTimes(3);
    tick.mockClear();
    s.setListenerUp(true); // immediate catch-up tick
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(2);
    tick.mockClear();
    s.setListenerUp(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(tick).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('reports tick failures and keeps going', async () => {
    const onError = vi.fn();
    const tick = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const s = createTickScheduler({ tick, onError });
    await vi.advanceTimersByTimeAsync(700);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(tick.mock.calls.length).toBeGreaterThan(1);
    s.stop();
  });

  describe('notify with a trailing tick', () => {
    const make = async (tick = vi.fn(async () => undefined)) => {
      const s = createTickScheduler({ tick, trailingMs: 750, maxTrailingMs: 4_000 });
      s.setListenerUp(true);
      await vi.advanceTimersByTimeAsync(0);
      tick.mockClear();
      return { s, tick };
    };

    it('ticks now and again 750 ms later', async () => {
      const { s, tick } = await make();
      s.notify();
      expect(tick).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(749);
      expect(tick).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(tick).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(tick).toHaveBeenCalledTimes(2);
      s.stop();
    });

    it('pushes the trailing tick back when a newer notify arrives', async () => {
      const { s, tick } = await make();
      s.notify();
      await vi.advanceTimersByTimeAsync(500);
      s.notify();
      expect(tick).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(700);
      expect(tick).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(50);
      expect(tick).toHaveBeenCalledTimes(3);
      s.stop();
    });

    it('fires no later than the cap after the first pending notify', async () => {
      const { s, tick } = await make();
      s.notify();
      for (let i = 0; i < 9; i++) {
        await vi.advanceTimersByTimeAsync(500);
        s.notify();
      }
      // 4 500 ms of steady chatter: 10 immediate ticks plus the capped trailing tick.
      expect(tick.mock.calls.length).toBe(10 + 1);
      await vi.advanceTimersByTimeAsync(750);
      s.stop();
    });

    it('does nothing extra without trailingMs, and stop() clears the trailing timer', async () => {
      const plain = vi.fn(async () => undefined);
      const a = createTickScheduler({ tick: plain });
      a.setListenerUp(true);
      await vi.advanceTimersByTimeAsync(0);
      plain.mockClear();
      a.notify();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(plain).toHaveBeenCalledTimes(1);
      a.stop();

      const { s, tick } = await make();
      s.notify();
      s.stop();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(tick).toHaveBeenCalledTimes(1);
    });
  });
});

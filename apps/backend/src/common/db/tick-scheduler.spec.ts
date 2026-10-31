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
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller, nextDelay } from './poller.js';

describe('nextDelay', () => {
  it('uses 3s awaiting, 4s open, 20s closed', () => {
    expect(nextDelay('awaiting', 0)).toBe(3000);
    expect(nextDelay('open', 0)).toBe(4000);
    expect(nextDelay('closed', 0)).toBe(20000);
  });
  it('doubles on failures up to 60s', () => {
    expect(nextDelay('open', 1)).toBe(8000);
    expect(nextDelay('open', 2)).toBe(16000);
    expect(nextDelay('open', 10)).toBe(60000);
  });
});

describe('poller', () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => vi.useRealTimers());

  it('polls at the cadence of the current mode', async () => {
    let mode: 'awaiting' | 'open' | 'closed' = 'awaiting';
    const run = vi.fn(async () => true);
    const p = createPoller({ run, mode: () => mode });
    p.start();
    await vi.advanceTimersByTimeAsync(2999);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    // the delay is chosen when a poll is scheduled: the next one was set with 'awaiting' (3 s)
    mode = 'open';
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(2);
    mode = 'closed';
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(19999);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(4);
    p.stop();
  });

  it('pauses while the document is hidden and resumes immediately when visible', async () => {
    const run = vi.fn(async () => true);
    const p = createPoller({ run, mode: () => 'open' });
    p.start();
    hidden = true;
    await vi.advanceTimersByTimeAsync(60000);
    expect(run).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it('backs off x2 up to 60s on errors and resets on success', async () => {
    let ok = false;
    const run = vi.fn(async () => ok);
    const p = createPoller({ run, mode: () => 'open' });
    p.start();
    await vi.advanceTimersByTimeAsync(4000); // call 1 fails -> next 8s
    await vi.advanceTimersByTimeAsync(7999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // call 2 -> next 16s
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(16000); // call 3 -> 32s
    await vi.advanceTimersByTimeAsync(32000); // call 4 -> 60s
    await vi.advanceTimersByTimeAsync(60000); // call 5 -> 60s
    expect(run).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(59999);
    expect(run).toHaveBeenCalledTimes(5);
    ok = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(7);
    p.stop();
  });

  it('stop cancels pending polls', async () => {
    const run = vi.fn(async () => true);
    const p = createPoller({ run, mode: () => 'open' });
    p.start();
    p.stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(run).not.toHaveBeenCalled();
  });
});

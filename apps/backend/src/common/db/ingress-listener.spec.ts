import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handles: Array<{
  opts: { onclose?: () => void };
  unsafe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}> = [];
let failListen = false;

vi.mock('postgres', () => ({
  default: (_url: string, opts: { onclose?: () => void }) => {
    const handle = {
      opts,
      unsafe: vi.fn(async () => {
        if (failListen) throw new Error('down');
        return [];
      }),
      end: vi.fn(async () => undefined),
    };
    handles.push(handle);
    return handle;
  },
}));

const { startIngressListener } = await import('./ingress-listener.js');

const start = (states: boolean[] = []) =>
  startIngressListener({
    url: 'postgres://x',
    channel: 'c',
    onNotify: () => undefined,
    onState: (up) => void states.push(up),
    backoff: { minMs: 1_000, maxMs: 30_000 },
  });

describe('ingress listener (mocked connection)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handles.length = 0;
    failListen = false;
  });
  afterEach(() => vi.useRealTimers());

  it('reports up once LISTEN succeeds (the scheduler runs its catch-up tick on this)', async () => {
    const states: boolean[] = [];
    const l = start(states);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([true]);
    await l.stop();
  });

  it('closes the dead handle on close and reconnects with 1 s backoff', async () => {
    const l = start();
    await vi.advanceTimersByTimeAsync(0);
    const dead = handles[0]!;
    dead.opts.onclose?.();
    expect(dead.end).toHaveBeenCalledWith({ timeout: 0 });
    await vi.advanceTimersByTimeAsync(999);
    expect(handles).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(handles).toHaveLength(2);
    await l.stop();
  });

  it('doubles the backoff up to the 30 s cap and resets after a success', async () => {
    failListen = true;
    const l = start();
    await vi.advanceTimersByTimeAsync(0);
    const waits = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const wait of waits) {
      const before = handles.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(handles).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(handles).toHaveLength(before + 1);
    }
    failListen = false;
    await vi.advanceTimersByTimeAsync(30_000);
    const up = handles.at(-1)!;
    up.opts.onclose?.();
    const before = handles.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(handles).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(handles).toHaveLength(before + 1);
    await l.stop();
  });

  it('stop() during the backoff leaves no timer and no reconnect', async () => {
    failListen = true;
    const l = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await l.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handles).toHaveLength(1);
  });

  it('stop() closes the live connection and ignores its close event', async () => {
    const l = start();
    await vi.advanceTimersByTimeAsync(0);
    const live = handles[0]!;
    await l.stop();
    expect(live.end).toHaveBeenCalledTimes(1);
    live.opts.onclose?.();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handles).toHaveLength(1);
  });
});

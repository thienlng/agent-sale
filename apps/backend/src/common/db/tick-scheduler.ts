export const INGRESS_SAFETY_POLL_MS = 5_000;
export const INGRESS_FALLBACK_POLL_MS = 300;

export interface TickScheduler {
  /** Request a tick now: at most one in flight plus one queued. */
  wake(): void;
  /**
   * An ingress notification: tick now, and (when `trailingMs` is set) arm a trailing tick so
   * events held back by the quiet window are claimed without waiting for the safety poll.
   */
  notify(): void;
  /** Switch the safety poll: slow while the listener is up, fast while it is down. */
  setListenerUp(up: boolean): void;
  stop(): void;
}

/** Runs `tick` on wake-ups (coalesced) and on a safety poll whose pace follows the listener state. */
export function createTickScheduler(options: {
  tick: () => Promise<void>;
  /** Delay of the trailing tick after the latest notify (debounced: a newer notify resets it). */
  trailingMs?: number;
  /** The trailing tick fires no later than this after the first pending notify. */
  maxTrailingMs?: number;
  onError?: (error: unknown) => void;
}): TickScheduler {
  let running = false;
  let queued = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt = 0;

  const run = (): void => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void options
      .tick()
      .catch((e: unknown) => options.onError?.(e))
      .finally(() => {
        running = false;
        if (queued) {
          queued = false;
          run();
        }
      });
  };

  const poll = (ms: number): void => {
    if (interval) clearInterval(interval);
    interval = setInterval(() => {
      if (!running) run();
    }, ms);
  };
  poll(INGRESS_FALLBACK_POLL_MS);

  const armTrailing = (): void => {
    const { trailingMs, maxTrailingMs } = options;
    if (trailingMs === undefined) return;
    const now = Date.now();
    if (!trailing) firstPendingAt = now;
    else clearTimeout(trailing);
    const target = Math.min(now + trailingMs, firstPendingAt + (maxTrailingMs ?? trailingMs));
    trailing = setTimeout(
      () => {
        trailing = undefined;
        run();
      },
      Math.max(0, target - now),
    );
  };

  return {
    wake: run,
    notify() {
      if (stopped) return;
      run();
      armTrailing();
    },
    setListenerUp(up) {
      poll(up ? INGRESS_SAFETY_POLL_MS : INGRESS_FALLBACK_POLL_MS);
      if (up) run();
    },
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = undefined;
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
    },
  };
}

export const INGRESS_SAFETY_POLL_MS = 5_000;
export const INGRESS_FALLBACK_POLL_MS = 300;

export interface TickScheduler {
  /** Request a tick now: at most one in flight plus one queued. */
  wake(): void;
  /** Switch the safety poll: slow while the listener is up, fast while it is down. */
  setListenerUp(up: boolean): void;
  stop(): void;
}

/** Runs `tick` on wake-ups (coalesced) and on a safety poll whose pace follows the listener state. */
export function createTickScheduler(options: {
  tick: () => Promise<void>;
  onError?: (error: unknown) => void;
}): TickScheduler {
  let running = false;
  let queued = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;

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

  return {
    wake: run,
    setListenerUp(up) {
      poll(up ? INGRESS_SAFETY_POLL_MS : INGRESS_FALLBACK_POLL_MS);
      if (up) run();
    },
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = undefined;
    },
  };
}

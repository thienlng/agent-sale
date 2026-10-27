export type PollMode = 'awaiting' | 'open' | 'closed';

const BASE: Record<PollMode, number> = { awaiting: 3000, open: 4000, closed: 20000 };
const MAX_DELAY = 60000;

export function nextDelay(mode: PollMode, failures: number): number {
  return Math.min(BASE[mode] * Math.pow(2, failures), MAX_DELAY);
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Poll as soon as possible (e.g. after a send). */
  kick(): void;
  readonly running: boolean;
}

export interface PollerOptions {
  /** Performs one poll; resolves true on success, false on error. */
  run: () => Promise<boolean>;
  mode: () => PollMode;
}

export function createPoller(opts: PollerOptions): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let failures = 0;
  let inFlight = false;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay: number): void => {
    clear();
    if (!running) return;
    timer = setTimeout(() => void tick(), delay);
  };

  const tick = async (): Promise<void> => {
    timer = null;
    if (!running) return;
    if (document.hidden) return; // resumed by visibilitychange
    if (inFlight) return;
    inFlight = true;
    let ok = false;
    try {
      ok = await opts.run();
    } catch {
      ok = false;
    }
    inFlight = false;
    failures = ok ? 0 : failures + 1;
    schedule(nextDelay(opts.mode(), failures));
  };

  const onVisibility = (): void => {
    if (running && !document.hidden && timer === null && !inFlight) void tick();
  };

  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      document.addEventListener('visibilitychange', onVisibility);
      schedule(nextDelay(opts.mode(), 0));
    },
    stop() {
      running = false;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
    kick() {
      if (!running) return;
      failures = 0;
      clear();
      void tick();
    },
    get running() {
      return running;
    },
  };
}

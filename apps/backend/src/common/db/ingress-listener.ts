import postgres from 'postgres';

export interface IngressListenerOptions {
  /** Direct (non-PgBouncer) connection: LISTEN needs a session. */
  url: string;
  channel: string;
  onNotify(): void;
  onState(up: boolean): void;
  backoff: { minMs: number; maxMs: number };
}

/**
 * Holds one dedicated LISTEN connection and reconnects with exponential backoff.
 * postgres.js' own `listen()` reconnects silently, so the down state would be
 * invisible; this owns the loop to report it.
 */
export function startIngressListener(options: IngressListenerOptions): { stop(): Promise<void> } {
  let stopped = false;
  let delay = options.backoff.minMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: postgres.Sql | undefined;
  let up = false;

  const setState = (next: boolean): void => {
    if (up === next) return;
    up = next;
    options.onState(next);
  };

  const scheduleReconnect = (): void => {
    if (stopped || timer) return;
    setState(false);
    const wait = delay;
    delay = Math.min(delay * 2, options.backoff.maxMs);
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, wait);
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    // `onnotify` is a runtime option of postgres.js that its typings omit.
    const sql = postgres(options.url, {
      max: 1,
      prepare: false,
      idle_timeout: undefined,
      max_lifetime: null,
      fetch_types: false,
      connection: { application_name: 'rapiz-ingress-listener' },
      onnotify: (channel: string) => {
        if (channel === options.channel) options.onNotify();
      },
      onclose: () => {
        if (current === sql) {
          current = undefined;
          scheduleReconnect();
        }
      },
    } as postgres.Options<Record<string, never>>);
    current = sql;
    try {
      await sql.unsafe(`listen "${options.channel.replace(/"/g, '""')}"`);
      if (stopped || current !== sql) return;
      delay = options.backoff.minMs;
      setState(true);
    } catch {
      if (current === sql) current = undefined;
      await sql.end({ timeout: 0 }).catch(() => undefined);
      scheduleReconnect();
    }
  };

  void connect();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      const sql = current;
      current = undefined;
      await sql?.end({ timeout: 1 }).catch(() => undefined);
    },
  };
}

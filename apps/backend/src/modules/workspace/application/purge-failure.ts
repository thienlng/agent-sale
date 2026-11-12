/** The deletion hooks of these modules failed during a purge run. */
export class PurgeHooksFailedError extends Error {
  constructor(readonly modules: string[]) {
    super(`deletion hooks failed: ${modules.join(',')}`);
    this.name = 'PurgeHooksFailedError';
  }
}

/**
 * What a failure is, safe to store and log: the error class and, for a database error, its
 * SQLSTATE (also when wrapped as the `cause`), or the failing hook modules. Never the message,
 * which can carry query parameters.
 */
export function purgeErrorCode(e: unknown): string {
  if (e instanceof PurgeHooksFailedError) return `${e.name}:${e.modules.join(',')}`.slice(0, 120);
  const name = e instanceof Error ? e.constructor.name || 'Error' : typeof e;
  const codeOf = (x: unknown): string | null => {
    const code = (x as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : null;
  };
  const code = codeOf(e) ?? codeOf((e as { cause?: unknown } | null)?.cause);
  return (code ? `${name}:${code}` : name).slice(0, 120);
}

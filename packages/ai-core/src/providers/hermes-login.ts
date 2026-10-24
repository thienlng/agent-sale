import { z } from 'zod';

import { parseBridgeBaseUrl } from './bridge-url.js';

const MAX_BODY_BYTES = 16_000;

export const HermesLoginStatus = z.object({
  state: z.enum(['signed_out', 'pending', 'signed_in', 'failed', 'unreachable']),
  verificationUrl: z.string().max(2_000).optional(),
  userCode: z.string().max(100).optional(),
  expiresAt: z.string().max(40).optional(),
  code: z.string().max(100).optional(),
});
export type HermesLoginStatus = z.infer<typeof HermesLoginStatus>;

export type HermesLoginFailure = 'rate_limited' | 'unauthorized' | 'unavailable' | 'invalid';

/** A bridge login call failed in a way the caller should surface (never carries URLs or keys). */
export class HermesLoginError extends Error {
  constructor(readonly reason: HermesLoginFailure) {
    super(`Hermes bridge login ${reason}`);
    this.name = 'HermesLoginError';
  }
}

const UNREACHABLE: HermesLoginStatus = { state: 'unreachable' };

/**
 * Drives the Hermes bridge's ChatGPT device-code sign-in (`/v1/auth/*`).
 * Same URL/timeout/redirect conventions as {@link HermesProvider}; the bridge
 * never returns tokens, only the sign-in state and the code to show the admin.
 */
export class HermesLoginClient {
  readonly #base: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;

  constructor(options: {
    baseURL: string;
    apiKey?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {
    const base = parseBridgeBaseUrl(options.baseURL);
    if (!base) throw new Error('Invalid Hermes bridge URL');
    if (!options.apiKey?.trim()) throw new Error('Hermes bridge key is required');
    this.#base = base;
    this.#key = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#timeout = options.timeoutMs ?? 10_000;
  }

  /** Current sign-in state; `unreachable` when the bridge cannot be contacted. */
  status(): Promise<HermesLoginStatus> {
    return this.#call('GET', 'status');
  }

  /** Begins a device-code login (or returns the pending one). */
  start(): Promise<HermesLoginStatus> {
    return this.#call('POST', 'start');
  }

  logout(): Promise<HermesLoginStatus> {
    return this.#call('POST', 'logout');
  }

  async #call(
    method: 'GET' | 'POST',
    action: 'status' | 'start' | 'logout',
  ): Promise<HermesLoginStatus> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}/v1/auth/${action}`, {
        method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.#key}` },
        signal: AbortSignal.timeout(this.#timeout),
        redirect: 'error',
      });
    } catch {
      // Fetch errors can contain private URLs; report only that the bridge is unreachable.
      return UNREACHABLE;
    }
    if (response.status === 401 || response.status === 403)
      throw new HermesLoginError('unauthorized');
    if (response.status === 429) throw new HermesLoginError('rate_limited');
    if (!response.ok) throw new HermesLoginError('unavailable');
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('response too large');
      const parsed = HermesLoginStatus.parse(JSON.parse(raw));
      // The bridge never reports "unreachable" itself.
      return parsed.state === 'unreachable' ? { state: 'failed', code: 'login_failed' } : parsed;
    } catch {
      throw new HermesLoginError('invalid');
    }
  }
}

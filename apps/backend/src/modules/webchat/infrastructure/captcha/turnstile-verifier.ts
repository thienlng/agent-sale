import { Logger } from '@nestjs/common';

import type { CaptchaVerifier } from '../../application/ports/webchat-options.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile server-side check. The visitor's address is not sent (the token alone is
 * enough); a timeout or an error answers false, so a Turnstile outage blocks only new visitors.
 */
export class TurnstileVerifier implements CaptchaVerifier {
  readonly #log = new Logger(TurnstileVerifier.name);

  constructor(
    readonly siteKey: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string): Promise<boolean> {
    if (!token) return false;
    try {
      const res = await this.fetchImpl(SITEVERIFY, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: this.secret, response: token }).toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { success?: unknown };
      return body.success === true;
    } catch (error) {
      this.#log.warn(`turnstile verification failed: ${(error as Error).message}`);
      return false;
    }
  }
}

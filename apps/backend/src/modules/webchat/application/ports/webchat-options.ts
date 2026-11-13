/** Verifies a bot challenge solved in the visitor's browser (Cloudflare Turnstile). */
export interface CaptchaVerifier {
  /** Public site key the widget renders the challenge with. */
  readonly siteKey: string;
  /** True when the token is valid; never throws (an outage answers false). */
  verify(token: string): Promise<boolean>;
}

/** Abuse limits of the public widget routes (security audit #2, #17); 0 turns a limit off. */
export interface WebchatOptions {
  /** Images one site may receive per day, all visitors together. */
  uploadsPerSiteDay: number;
  /** Challenge for new visitors; null = off (the default). */
  captcha: CaptchaVerifier | null;
}
export const WEBCHAT_OPTIONS = Symbol('WEBCHAT_OPTIONS');

export const DEFAULT_WEBCHAT_OPTIONS: WebchatOptions = { uploadsPerSiteDay: 500, captcha: null };

export interface AuthHttpOptions {
  /** `Secure` cookie flag (true everywhere except plain-http local dev/tests). */
  secureCookies: boolean;
  /** Origins allowed to call the cookie-based refresh endpoint. */
  allowedOrigins: string[];
}

export const AUTH_HTTP_OPTIONS = Symbol('AUTH_HTTP_OPTIONS');

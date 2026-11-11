/** What Rapiz keeps from a verified Google ID token. */
export interface GoogleProfile {
  /** Stable Google account id (`sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** The `nonce` claim; must equal the one sent with the authorization request. */
  nonce: string | null;
}

/** Google's OAuth 2.0 / OpenID Connect web flow (authorization code with PKCE). */
export interface GoogleOAuthClient {
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  /**
   * Exchanges the authorization code and verifies the ID token (signature against Google's keys,
   * issuer, audience, expiry). Throws `GoogleSignInError('failed')` on any failure.
   */
  exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleProfile>;
}

/** Null when Google sign-in is not configured. */
export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

export interface GoogleSignInOptions {
  redirectUri: string;
}
export const GOOGLE_SIGN_IN_OPTIONS = Symbol('GOOGLE_SIGN_IN_OPTIONS');

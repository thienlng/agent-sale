import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

import type { GoogleOAuthClient, GoogleProfile } from '../../application/ports/google-oauth.js';
import { GoogleSignInError } from '../../domain/identity.errors.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TIMEOUT_MS = 10_000;

interface Options {
  clientId: string;
  clientSecret: string;
  /** Tests inject a local key set and fetch; production uses Google's published keys. */
  keys?: JWTVerifyGetKey;
  fetch?: typeof fetch;
}

/** Google's OpenID Connect web flow over HTTPS. Never logs codes or tokens. */
export class HttpGoogleOAuthClient implements GoogleOAuthClient {
  readonly #keys: JWTVerifyGetKey;
  readonly #fetch: typeof fetch;

  constructor(private readonly options: Options) {
    this.#keys = options.keys ?? createRemoteJWKSet(new URL(JWKS_URL));
    this.#fetch = options.fetch ?? fetch;
  }

  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      // Lets someone with several Google accounts pick the right one.
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleProfile> {
    let idToken: unknown;
    try {
      const res = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: input.codeVerifier,
        }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new GoogleSignInError('failed');
      idToken = ((await res.json()) as { id_token?: unknown }).id_token;
    } catch {
      throw new GoogleSignInError('failed');
    }
    if (typeof idToken !== 'string') throw new GoogleSignInError('failed');
    try {
      const { payload } = await jwtVerify(idToken, this.#keys, {
        issuer: ISSUERS,
        audience: this.options.clientId,
        algorithms: ['RS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
        throw new GoogleSignInError('failed');
      }
      return {
        subject: payload.sub,
        email: payload['email'],
        emailVerified: payload['email_verified'] === true || payload['email_verified'] === 'true',
        name: typeof payload['name'] === 'string' ? payload['name'] : null,
        nonce: typeof payload['nonce'] === 'string' ? payload['nonce'] : null,
      };
    } catch {
      throw new GoogleSignInError('failed');
    }
  }
}

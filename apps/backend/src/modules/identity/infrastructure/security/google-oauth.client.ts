import { Logger } from '@nestjs/common';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

import type { GoogleOAuthClient, GoogleProfile } from '../../application/ports/google-oauth.js';
import { GoogleSignInError } from '../../domain/identity.errors.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TIMEOUT_MS = 10_000;
/** Small allowance for clock skew between Google and this server. */
const CLOCK_TOLERANCE_S = 30;
/** Google's token-endpoint `error` values (RFC 6749 §5.2), the only part of an error answer logged. */
const TOKEN_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'redirect_uri_mismatch',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
]);

const log = new Logger('GoogleOAuth');

function tokenErrorWord(error: unknown): string {
  return typeof error === 'string' && TOKEN_ERRORS.has(error) ? error : 'other';
}

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
    let tokenError: string | null = null;
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
      const body = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
      if (!res.ok) {
        tokenError = tokenErrorWord(body.error);
        throw new GoogleSignInError('failed');
      }
      idToken = body.id_token;
    } catch (e) {
      // Only Google's error word (a fixed vocabulary) or the error class: never the code or body.
      log.warn(
        `Google token exchange failed: ${tokenError ?? (e instanceof Error ? e.name : 'unknown')}`,
      );
      throw new GoogleSignInError('failed');
    }
    if (typeof idToken !== 'string') throw new GoogleSignInError('failed');
    try {
      const { payload } = await jwtVerify(idToken, this.#keys, {
        issuer: ISSUERS,
        audience: this.options.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: CLOCK_TOLERANCE_S,
      });
      if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
        throw new GoogleSignInError('failed');
      }
      return {
        subject: payload.sub,
        email: payload['email'],
        emailVerified: payload['email_verified'] === true || payload['email_verified'] === 'true',
        name: typeof payload['name'] === 'string' ? payload['name'] : null,
        hostedDomain: typeof payload['hd'] === 'string' ? payload['hd'] : null,
        nonce: typeof payload['nonce'] === 'string' ? payload['nonce'] : null,
      };
    } catch (e) {
      // jose's fixed error code (e.g. ERR_JWT_EXPIRED), never the token or its claims.
      const code = (e as { code?: unknown }).code;
      log.warn(
        `Google ID token rejected: ${typeof code === 'string' && /^ERR_[A-Z_]{1,60}$/.test(code) ? code : 'invalid_claims'}`,
      );
      throw new GoogleSignInError('failed');
    }
  }
}

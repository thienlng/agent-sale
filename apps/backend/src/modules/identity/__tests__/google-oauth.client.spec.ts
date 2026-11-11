import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { HttpGoogleOAuthClient } from '../infrastructure/security/google-oauth.client.js';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function idToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  audience = CLIENT_ID,
) {
  return new SignJWT({
    email: 'lan@gmail.com',
    email_verified: true,
    name: 'Lan',
    nonce: 'n-1',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(audience)
    .setSubject('google-sub-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** A token endpoint that answers with `token`, recording the form it received. */
function tokenEndpoint(token: string | null, status = 200) {
  const forms: URLSearchParams[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    forms.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify(token ? { id_token: token } : { error: 'invalid_grant' }), {
      status,
    });
  }) as unknown as typeof fetch;
  return { forms, fetchFn };
}

const exchange = {
  code: 'auth-code',
  codeVerifier: 'verifier',
  redirectUri: 'https://rapiz.io/cb',
};

describe('HttpGoogleOAuthClient', () => {
  it('builds the authorization URL with PKCE S256, nonce and the openid scopes', () => {
    const client = new HttpGoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: 'secret-xyz-123',
    });
    const url = new URL(
      client.authorizationUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        redirectUri: 'https://rapiz.io/cb',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: 'https://rapiz.io/cb',
      response_type: 'code',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges the code with the verifier and returns the verified profile', async () => {
    const { privateKey, jwks } = await keys();
    const { forms, fetchFn } = tokenEndpoint(await idToken(privateKey));
    const client = new HttpGoogleOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: 'secret-xyz-123',
      keys: jwks,
      fetch: fetchFn,
    });
    await expect(client.exchange(exchange)).resolves.toEqual({
      subject: 'google-sub-1',
      email: 'lan@gmail.com',
      emailVerified: true,
      name: 'Lan',
      nonce: 'n-1',
    });
    expect(Object.fromEntries(forms[0] ?? [])).toMatchObject({
      grant_type: 'authorization_code',
      code: 'auth-code',
      code_verifier: 'verifier',
      redirect_uri: 'https://rapiz.io/cb',
    });
  });

  it('rejects a token for another client, a token signed by another key, and an error answer', async () => {
    const { privateKey, jwks } = await keys();
    const other = await keys();
    const cases = [
      tokenEndpoint(await idToken(privateKey, {}, 'someone-else')),
      tokenEndpoint(await idToken(other.privateKey)),
      tokenEndpoint(null, 400),
    ];
    for (const { fetchFn } of cases) {
      const client = new HttpGoogleOAuthClient({
        clientId: CLIENT_ID,
        clientSecret: 'secret-xyz-123',
        keys: jwks,
        fetch: fetchFn,
      });
      await expect(client.exchange(exchange)).rejects.toMatchObject({ reason: 'failed' });
    }
  });
});

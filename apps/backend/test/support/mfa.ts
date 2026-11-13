import { MfaSetup } from '@agent-sales/contracts';

import { stepAt, totpAt } from '../../src/modules/identity/domain/totp.js';

/** POSTs a JSON body to an `/api/v1` path (without the prefix) as the signed-in user. */
export type AuthedPost = (
  path: string,
  payload: object,
) => Promise<{ statusCode: number; body: string; json(): unknown }>;

/**
 * Turns two-factor on for the signed-in user (setup with the password, then the current code).
 * Enabling proves the code on the current session, so its access token then passes the platform
 * admin checks and step-up routes. Returns the TOTP secret.
 */
export async function enableTwoFactor(post: AuthedPost, password: string): Promise<string> {
  const setup = await post('/auth/mfa/setup', { password });
  if (setup.statusCode !== 200) throw new Error(`mfa setup failed: ${setup.body}`);
  const { secret } = MfaSetup.parse(setup.json());
  const enabled = await post('/auth/mfa/enable', { code: totpAt(secret, stepAt(Date.now())) });
  if (enabled.statusCode !== 200) throw new Error(`mfa enable failed: ${enabled.body}`);
  return secret;
}

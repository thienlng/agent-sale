import { AuthResponse, SignupBusinessResponse } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { type LocalMailer, MAILER } from '../../src/common/email/mailer.js';

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  /** The first business (signup step 2); without it the user has none. */
  workspaceName?: string;
  industry?: string;
}

/** The latest code emailed to `email` by the test mailer (subject "…: 123456"). */
export function lastEmailedCode(app: NestFastifyApplication, email: string): string {
  const mailer = app.get<LocalMailer>(MAILER, { strict: false });
  const mail = mailer.sent.filter((m) => m.to === email.toLowerCase()).at(-1);
  if (!mail) throw new Error(`No email was sent to ${email}`);
  return mail.subject.split(': ').at(-1) ?? '';
}

/** Asks for a signup code (`POST /auth/signup/code`) and returns the code the test mailer got. */
export async function signupCode(
  app: NestFastifyApplication,
  email: string,
  opts: { remoteAddress?: string } = {},
): Promise<string> {
  const res = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup/code',
      ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}),
      payload: { email },
    });
  if (res.statusCode !== 204) throw new Error(`signup code failed: ${res.body}`);
  return lastEmailedCode(app, email);
}

/**
 * The whole sign-up as a user does it: the emailed code → signup → the first business (when
 * `workspaceName` is given). Answers like `POST /auth/signup`: `json()` is the `AuthResponse`.
 */
export async function signUpVerified(
  app: NestFastifyApplication,
  input: SignupInput,
  opts: { remoteAddress?: string } = {},
): Promise<{ statusCode: number; json(): AuthResponse }> {
  const server = app.getHttpAdapter().getInstance();
  const { workspaceName, industry, ...user } = input;
  const code = await signupCode(app, input.email, opts);
  const signup = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}),
    payload: { ...user, code },
  });
  if (signup.statusCode !== 201) throw new Error(`signup failed: ${signup.body}`);
  const auth = AuthResponse.parse(signup.json());
  if (workspaceName) {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/signup/business',
      headers: { authorization: `Bearer ${auth.accessToken}` },
      payload: { workspaceName, industry: industry ?? 'retail' },
    });
    if (created.statusCode !== 201) throw new Error(`first business failed: ${created.body}`);
    SignupBusinessResponse.parse(created.json());
  }
  return { statusCode: 201, json: () => auth };
}

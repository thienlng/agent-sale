import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type APIRequestContext, type APIResponse, expect } from '@playwright/test';

/**
 * Where the development backend writes every email (`MAIL_OUTBOX_DIR`, set by
 * `playwright.live.config.ts`), so the suite can read signup codes.
 */
export const MAIL_OUTBOX_DIR = join(tmpdir(), 'rapiz-e2e-mail');

/** The code in the latest email to `email` (subject "…: 123456"), waiting up to 5 s for it. */
export async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const files = (await readdir(MAIL_OUTBOX_DIR).catch(() => [] as string[])).sort().reverse();
    for (const file of files) {
      const message = JSON.parse(await readFile(join(MAIL_OUTBOX_DIR, file), 'utf8')) as {
        to: string;
        subject: string;
      };
      if (message.to === email.toLowerCase()) return message.subject.split(': ')[1] ?? '';
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No email to ${email} in ${MAIL_OUTBOX_DIR}`);
}

/**
 * The whole signup of an owner through the API: the emailed code, the account, then the first
 * business. Returns the signup response (access token in its body).
 */
export async function signUpOwner(
  request: APIRequestContext,
  input: { name: string; email: string; password: string; workspaceName: string; industry: string },
  headers: Record<string, string> = {},
): Promise<APIResponse> {
  const sent = await request.post('/api/v1/auth/signup/code', {
    data: { email: input.email, name: input.name },
    headers,
  });
  expect(sent.status(), await sent.text()).toBe(204);
  const signup = await request.post('/api/v1/auth/signup', {
    data: {
      name: input.name,
      email: input.email,
      password: input.password,
      code: await emailedCode(input.email),
    },
    headers,
  });
  if (!signup.ok()) return signup;
  const { accessToken } = (await signup.json()) as { accessToken: string };
  const business = await request.post('/api/v1/auth/signup/business', {
    data: { workspaceName: input.workspaceName, industry: input.industry },
    headers: { ...headers, authorization: `Bearer ${accessToken}` },
  });
  expect(business.status(), await business.text()).toBe(201);
  return signup;
}

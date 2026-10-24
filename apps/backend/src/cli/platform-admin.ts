/* eslint-disable no-console -- CLI entrypoint */
import { createDb } from '@agent-sales/db';

import { DrizzleUserRepository } from '../modules/identity/infrastructure/persistence/identity.drizzle-repositories.js';

/**
 * `pnpm --filter @agent-sales/backend platform-admin grant|revoke <email>` —
 * the only way to make someone a platform admin (never through the API).
 * Uses DATABASE_SYSTEM_URL; the user must have signed up first.
 */
const [action, email] = process.argv.slice(2);
const url = process.env['DATABASE_SYSTEM_URL'];
if ((action !== 'grant' && action !== 'revoke') || !email || !url) {
  console.error('usage: platform-admin grant|revoke <email>   (needs DATABASE_SYSTEM_URL)');
  process.exit(1);
}

const { db, close } = createDb({ url, max: 1 });
try {
  const found = await new DrizzleUserRepository(db).setPlatformAdmin(email, action === 'grant');
  if (!found) {
    console.error(`no user with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${email}: platform admin ${action === 'grant' ? 'granted' : 'revoked'}`);
  }
} finally {
  await close();
}

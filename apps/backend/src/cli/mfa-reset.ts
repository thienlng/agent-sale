/* eslint-disable no-console -- CLI entrypoint */
import { createDb } from '@agent-sales/db';

import {
  DrizzleMfaRepository,
  DrizzleUserRepository,
} from '../modules/identity/infrastructure/persistence/identity.drizzle-repositories.js';

/**
 * `pnpm --filter @agent-sales/backend mfa-reset <email>` — turns two-factor off
 * for someone who lost both their phone and their recovery codes. Operator
 * action after verifying the person out of band. Uses DATABASE_SYSTEM_URL.
 */
const [email] = process.argv.slice(2);
const url = process.env['DATABASE_SYSTEM_URL'];
if (!email || !url) {
  console.error('usage: mfa-reset <email>   (needs DATABASE_SYSTEM_URL)');
  process.exit(1);
}

const { db, close } = createDb({ url, max: 1 });
try {
  const user = await new DrizzleUserRepository(db).findByEmail(email);
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exitCode = 1;
  } else {
    const removed = await new DrizzleMfaRepository(db).remove(user.id);
    console.log(`${email}: two-factor ${removed ? 'turned off' : 'was not on'}`);
  }
} finally {
  await close();
}

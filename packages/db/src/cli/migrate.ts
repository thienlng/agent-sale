/* eslint-disable no-console -- CLI entrypoint */
import { ensureLoginRoles, migrate } from '../migrate.js';

/**
 * `pnpm db:migrate` — applies migrations with DATABASE_OWNER_URL.
 * With `--dev-roles`, also creates the dev login users from DATABASE_URL and
 * DATABASE_SYSTEM_URL (local/test only; production users come from deploy tooling).
 */
const ownerUrl = process.env['DATABASE_OWNER_URL'];
if (!ownerUrl) {
  console.error('DATABASE_OWNER_URL is required');
  process.exit(1);
}

const result = await migrate(ownerUrl);
console.log(
  `migrations applied: ${result.applied.join(', ') || 'none'}; already applied: ${result.skipped.length}`,
);

if (process.argv.includes('--dev-roles')) {
  const tenant = new URL(process.env['DATABASE_URL'] ?? '');
  const system = new URL(process.env['DATABASE_SYSTEM_URL'] ?? '');
  await ensureLoginRoles(ownerUrl, {
    tenant: {
      user: decodeURIComponent(tenant.username),
      password: decodeURIComponent(tenant.password),
    },
    system: {
      user: decodeURIComponent(system.username),
      password: decodeURIComponent(system.password),
    },
  });
  console.log(`dev login roles ensured: ${tenant.username}, ${system.username}`);
}

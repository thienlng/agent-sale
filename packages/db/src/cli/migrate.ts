/* eslint-disable no-console -- CLI entrypoint */
import { ensureLoginRoles, migrate } from '../migrate.js';

/**
 * `pnpm db:migrate` — applies migrations with DATABASE_OWNER_URL.
 * With `--dev-roles` (local) or `--login-roles` (deploy, infra/deploy/compose.yml), also creates
 * or updates the two app logins from the credentials in DATABASE_URL and DATABASE_SYSTEM_URL.
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

if (process.argv.includes('--dev-roles') || process.argv.includes('--login-roles')) {
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
  console.log(`login roles ensured: ${tenant.username}, ${system.username}`);
}

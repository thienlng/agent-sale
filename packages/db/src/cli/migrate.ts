/* eslint-disable no-console -- CLI entrypoint */
import { ensureLoginRoles, migrate } from '../migrate.js';

/**
 * `pnpm db:migrate` — applies migrations with DATABASE_OWNER_URL.
 * With `--dev-roles` (local) or `--login-roles` (deploy, infra/deploy/compose.yml), also creates
 * or updates the two app logins from the credentials in DATABASE_URL and DATABASE_SYSTEM_URL, and
 * the owner assistant's read-only SQL login from DATABASE_ASSISTANT_SQL_URL when it is set.
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
  const credentials = (url: URL) => ({
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  const tenant = new URL(process.env['DATABASE_URL'] ?? '');
  const system = new URL(process.env['DATABASE_SYSTEM_URL'] ?? '');
  // Optional: the owner assistant's read-only SQL login (T-171).
  const assistantSqlUrl = process.env['DATABASE_ASSISTANT_SQL_URL'];
  const assistantSql = assistantSqlUrl ? new URL(assistantSqlUrl) : null;
  await ensureLoginRoles(ownerUrl, {
    tenant: credentials(tenant),
    system: credentials(system),
    ...(assistantSql ? { assistantSql: credentials(assistantSql) } : {}),
  });
  const users = [
    tenant.username,
    system.username,
    ...(assistantSql ? [assistantSql.username] : []),
  ];
  console.log(`login roles ensured: ${users.join(', ')}`);
}

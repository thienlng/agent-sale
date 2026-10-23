export * from './client.js';
export * from './tenant.js';
export * from './outbox.js';
export { ensureLoginRoles, migrate, MIGRATIONS_DIR, withCredentials } from './migrate.js';
export * as schema from './schema/index.js';
// Query operators re-exported so modules depend on @agent-sales/db only, never on drizzle-orm directly.
export { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

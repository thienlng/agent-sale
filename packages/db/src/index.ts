export * from './client.js';
export * from './tenant.js';
export * as schema from './schema/index.js';
// Query operators re-exported so modules depend on @agent-sales/db only, never on drizzle-orm directly.
export { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

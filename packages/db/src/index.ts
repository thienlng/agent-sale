export * from './client.js';
export * from './tenant.js';
export { accountContextSql, withAccount } from './account.js';
export * from './outbox.js';
export * from './audit.js';
export {
  exportTable,
  type ExportColumn,
  type ExportTableSpec,
  type ExportTable as DbExportTable,
} from './export.js';
export * from './platform-audit.js';
export { backfillAccounts, type AccountBackfillReport } from './account-backfill.js';
export {
  backfillAccountSubscriptions,
  type AccountSubscriptionBackfillReport,
} from './account-subscription-backfill.js';
export { backfillBotProfiles, type BotProfileBackfillReport } from './bot-profile-backfill.js';
export {
  ensureLoginRoles,
  migrate,
  MIGRATIONS_DIR,
  withCredentials,
  type LoginCredentials,
} from './migrate.js';
export {
  ASSISTANT_SQL_TIMEZONE,
  AssistantSqlError,
  createAssistantSqlClient,
  runAssistantSql,
  type AssistantSqlClient,
  type AssistantSqlColumn,
  type AssistantSqlResult,
} from './assistant-sql.js';
export * as schema from './schema/index.js';
// Query operators re-exported so modules depend on @agent-sales/db only, never on drizzle-orm directly.
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';

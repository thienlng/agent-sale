import {
  type AssistantSqlClient,
  createAssistantSqlClient,
  createDb,
  type Database,
} from '@agent-sales/db';
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';

import { getEnv } from '../config.js';

/** Tenant-scoped connection (login ∈ app_tenant). `null` when DATABASE_URL is unset. */
export const DB_TENANT = Symbol('DB_TENANT');
/** Cross-tenant connection (login ∈ app_system). `null` when DATABASE_SYSTEM_URL is unset. */
export const DB_SYSTEM = Symbol('DB_SYSTEM');
/**
 * The owner assistant's read-only SQL lane (login ∈ app_assistant_sql, pool of 4; T-171).
 * `null` when DATABASE_ASSISTANT_SQL_URL is unset.
 */
export const DB_ASSISTANT_SQL = Symbol('DB_ASSISTANT_SQL');

const handles: { close: () => Promise<void> }[] = [];

function open(url: string | undefined): Database | null {
  if (!url) return null;
  const h = createDb({ url });
  handles.push(h);
  return h.db;
}

function openAssistantSql(url: string | undefined): AssistantSqlClient | null {
  if (!url) return null;
  const h = createAssistantSqlClient(url);
  handles.push(h);
  return h.sql;
}

/**
 * Provides the DB connections. Modules inject them optionally and fall
 * back to in-memory adapters when absent (unit tests, quick local runs).
 */
@Global()
@Module({
  providers: [
    { provide: DB_TENANT, useFactory: () => open(getEnv().DATABASE_URL) },
    { provide: DB_SYSTEM, useFactory: () => open(getEnv().DATABASE_SYSTEM_URL) },
    {
      provide: DB_ASSISTANT_SQL,
      useFactory: () => openAssistantSql(getEnv().DATABASE_ASSISTANT_SQL_URL),
    },
  ],
  exports: [DB_TENANT, DB_SYSTEM, DB_ASSISTANT_SQL],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(handles.splice(0).map((h) => h.close()));
  }
}

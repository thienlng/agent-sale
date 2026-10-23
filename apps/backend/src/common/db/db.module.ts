import { createDb, type Database } from '@agent-sales/db';
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';

import { loadEnv } from '../config.js';

/** Tenant-scoped connection (login ∈ app_tenant). `null` when DATABASE_URL is unset. */
export const DB_TENANT = Symbol('DB_TENANT');
/** Cross-tenant connection (login ∈ app_system). `null` when DATABASE_SYSTEM_URL is unset. */
export const DB_SYSTEM = Symbol('DB_SYSTEM');

type Handle = { db: Database; close: () => Promise<void> } | null;
const handles: Handle[] = [];

function open(url: string | undefined): Database | null {
  if (!url) return null;
  const h = createDb({ url });
  handles.push(h);
  return h.db;
}

/**
 * Provides the two DB connections. Modules inject them optionally and fall
 * back to in-memory adapters when absent (unit tests, quick local runs).
 */
@Global()
@Module({
  providers: [
    { provide: DB_TENANT, useFactory: () => open(loadEnv().DATABASE_URL) },
    { provide: DB_SYSTEM, useFactory: () => open(loadEnv().DATABASE_SYSTEM_URL) },
  ],
  exports: [DB_TENANT, DB_SYSTEM],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(handles.splice(0).map((h) => h?.close()));
  }
}

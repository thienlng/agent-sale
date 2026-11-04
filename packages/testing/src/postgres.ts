import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Real Postgres (pgvector image, same major as production) for integration
 * tests. Callers run migrations and create login roles with @agent-sales/db so
 * this package stays free of a dependency on it.
 */
export interface TestPostgres {
  ownerUrl: string;
  tenantLogin: { user: string; password: string };
  systemLogin: { user: string; password: string };
  /** The owner assistant's read-only SQL login (`app_assistant_sql`, T-171). */
  assistantSqlLogin: { user: string; password: string };
  stop: () => Promise<void>;
}

export const PG_IMAGE = 'pgvector/pgvector:pg16';

export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(PG_IMAGE)
    .withDatabase('rapiz_test')
    .withUsername('owner')
    .withPassword('owner')
    .start();
  return {
    ownerUrl: container.getConnectionUri(),
    tenantLogin: { user: 'rapiz_tenant', password: 'tenant_test' },
    systemLogin: { user: 'rapiz_system', password: 'system_test' },
    assistantSqlLogin: { user: 'rapiz_assistant', password: 'assistant_test' },
    stop: async () => {
      await container.stop();
    },
  };
}

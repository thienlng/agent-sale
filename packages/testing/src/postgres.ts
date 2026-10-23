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
  stop: () => Promise<void>;
}

export const PG_IMAGE = 'pgvector/pgvector:pg16';

export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(PG_IMAGE)
    .withDatabase('razpi_test')
    .withUsername('owner')
    .withPassword('owner')
    .start();
  return {
    ownerUrl: container.getConnectionUri(),
    tenantLogin: { user: 'razpi_tenant', password: 'tenant_test' },
    systemLogin: { user: 'razpi_system', password: 'system_test' },
    stop: async () => {
      await container.stop();
    },
  };
}

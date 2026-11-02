import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withSystem,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe } from 'vitest';

import {
  importRepositoryCases,
  type ImportRepositoryHarness,
} from '../src/modules/assistant/__tests__/factories/import-repository.cases.js';
import type { OwnerScope } from '../src/modules/assistant/domain/owner-scope.js';
import { DrizzleAssistantRepository } from '../src/modules/assistant/infrastructure/persistence/assistant.drizzle-repository.js';

/**
 * Owner assistant product import storage on Postgres (0061, T-173), through the Drizzle
 * repository under account RLS: the same cases as the in-memory repository. One connection per
 * client (`max: 1`) mimics PgBouncer; `repo2` uses its own connection for concurrent writes.
 */
let pg: TestPostgres;
const handles: { db: Database; close: () => Promise<void> }[] = [];
let h: ImportRepositoryHarness;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  const open = (url: string) => {
    const handle = createDb({ url, max: 1 });
    handles.push(handle);
    return handle.db;
  };
  const system = open(systemUrl);
  h = {
    repo: new DrizzleAssistantRepository(open(tenantUrl)),
    repo2: new DrizzleAssistantRepository(open(tenantUrl)),
    async owner(sameAccountAs?: OwnerScope) {
      const user = userId(newId());
      const account = sameAccountAs?.accountId ?? newId();
      const business = sameAccountAs?.businessId ?? workspaceId(newId());
      const threadId = newId();
      await withSystem(system, async (tx) => {
        await tx
          .insert(schema.users)
          .values({ id: user, email: `${user}@example.test`, name: 'O' });
        if (!sameAccountAs) {
          await tx
            .insert(schema.accounts)
            .values({ id: account, name: 'acc', createdByUserId: user });
          await tx.insert(schema.workspaces).values({
            id: business,
            workspaceId: business,
            name: 'Shop',
            industry: 'fashion',
            ownerUserId: user,
            accountId: account,
          });
        }
        await tx.insert(schema.assistantThreads).values({
          id: threadId,
          accountId: account,
          ownerUserId: user,
          systemPrompt: 'p',
          promptVersion: 'v1',
        });
      });
      return {
        s: { accountId: account, ownerUserId: user, businessId: business, businessIds: [business] },
        threadId,
      };
    },
  };
});

afterAll(async () => {
  await Promise.all(handles.map((x) => x.close()));
  await pg?.stop();
});

describe('DrizzleAssistantRepository: product import (T-173)', () => {
  importRepositoryCases(() => h);
});

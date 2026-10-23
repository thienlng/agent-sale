import { WorkspaceCreatedV1 } from '@agent-sales/contracts';
import {
  createDb,
  type Database,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres, twoTenants } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CreateWorkspaceHandler } from '../src/modules/workspace/application/commands/create-workspace/create-workspace.handler.js';
import { GetWorkspaceHandler } from '../src/modules/workspace/application/queries/get-workspace/get-workspace.handler.js';
import { WorkspaceNotFoundError } from '../src/modules/workspace/domain/workspace.errors.js';
import { Workspace } from '../src/modules/workspace/domain/workspace.js';
import { DrizzleWorkspaceUnitOfWork } from '../src/modules/workspace/infrastructure/workspace.unit-of-work.js';

/** The golden module on a real Postgres: unit of work, RLS, outbox. */
let pg: TestPostgres;
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
  });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
});

afterAll(async () => {
  await Promise.all([tenant?.close(), system?.close()]);
  await pg?.stop();
});

async function newUser() {
  const id = userId(newId());
  await withSystem(system.db, (tx) =>
    tx.insert(schema.users).values({ id, email: `${id}@example.test`, name: 'Owner' }),
  );
  return id;
}

describe('workspace module on Postgres', () => {
  it('creates workspace + owner membership + outbox event in one transaction', async () => {
    const uow = new DrizzleWorkspaceUnitOfWork(tenant.db);
    const owner = await newUser();
    const dto = await new CreateWorkspaceHandler(uow).execute({
      name: 'Shop ABC',
      industry: 'retail',
      ownerUserId: owner,
    });
    const ws = workspaceId(dto.id);

    const read = await new GetWorkspaceHandler(uow).execute(ws);
    expect(read).toEqual(dto);

    const members = await withTenant(tenant.db, ws, (tx) => tx.select().from(schema.members));
    expect(members).toMatchObject([{ userId: owner, role: 'owner' }]);

    const outbox = await withSystem(system.db, (tx) => tx.select().from(schema.outboxEvents));
    const event = outbox.find((e) => e.aggregateId === ws);
    expect(WorkspaceCreatedV1.safeParse(event?.payload).success).toBe(true);
  });

  it('rolls everything back when any step of the unit of work fails', async () => {
    const uow = new DrizzleWorkspaceUnitOfWork(tenant.db);
    const owner = await newUser();
    const ws = Workspace.create({ name: 'Doomed', industry: 'retail', ownerUserId: owner });
    await expect(
      uow.run(ws.id, async ({ workspaces }) => {
        await workspaces.save(ws);
        throw new Error('boom after save');
      }),
    ).rejects.toThrow('boom');
    const rows = await withSystem(system.db, (tx) => tx.select().from(schema.workspaces));
    expect(rows.map((r) => r.id)).not.toContain(ws.id);
  });

  it('reports NOT_FOUND for a workspace the tenant context cannot see', async () => {
    const uow = new DrizzleWorkspaceUnitOfWork(tenant.db);
    const { b } = twoTenants();
    await expect(new GetWorkspaceHandler(uow).execute(b)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });
});

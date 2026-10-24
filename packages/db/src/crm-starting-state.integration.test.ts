import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

/**
 * Upgrading an install with customers into M4b (migration 0023, T-040): the owners and status they
 * started with become outbox events, so statistics attribute and scope old customers correctly.
 */
let pg: TestPostgres;
let db: { db: Database; close: () => Promise<void> };

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

const ws = newId();
const [sales1, sales2, care1] = [newId(), newId(), newId()];
const [statusA, statusB] = [newId(), newId()];
/** Customers as pre-M4b code left them, each with the events that code wrote. */
const manual = newId(); // hand-picked Sales and CSKH, a status: no events at all
const reassigned = newId(); // hand-picked Sales 1, later moved to Sales 2; status changed A → B
const auto = newId(); // auto-assigned Sales (event from null), status given at creation (M4b event)
const bare = newId(); // nobody, no status

const event = (contact: string, type: string, payload: Record<string, unknown>) =>
  db.db
    .execute(sql`insert into outbox_events (workspace_id, type, aggregate_type, aggregate_id, payload)
    values (${ws}, ${type}, 'contact', ${contact}, ${JSON.stringify({
      workspaceId: ws,
      contactId: contact,
      actorUserId: null,
      occurredAt: '2026-01-01T00:00:00.000Z',
      ...payload,
    })}::jsonb)`);

beforeAll(async () => {
  pg = await startTestPostgres();
  db = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0022_analytics_horizon.sql'));
  const owner = newId();
  await db.db.execute(
    sql`insert into users (id, email, name) values (${owner}, ${`${owner}@example.test`}, 'Owner')`,
  );
  await db.db.execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Shop', 'retail', ${owner})`);
  for (const s of [statusA, statusB])
    await db.db.execute(sql`insert into crm_statuses (id, workspace_id, name, color)
      values (${s}, ${ws}, 'S', '#000000')`);
  const contact = (
    id: string,
    salesId: string | null,
    careId: string | null,
    statusId: string | null,
  ) =>
    db.db
      .execute(sql`insert into contacts (id, workspace_id, name, sales_user_id, care_user_id, status_id, created_at)
      values (${id}, ${ws}, 'Khách', ${salesId}, ${careId}, ${statusId}, '2025-12-01T00:00:00Z')`);
  await contact(manual, sales1, care1, statusA);
  await contact(reassigned, sales2, null, statusB);
  await contact(auto, sales1, null, statusA);
  await contact(bare, null, null, null);
  await event(reassigned, 'crm.contact.assigned.v1', {
    role: 'sales',
    fromUserId: sales1,
    toUserId: sales2,
  });
  await event(reassigned, 'crm.contact.status_changed.v1', {
    fromStatusId: statusA,
    toStatusId: statusB,
  });
  await event(auto, 'crm.contact.assigned.v1', {
    role: 'sales',
    fromUserId: null,
    toUserId: sales1,
  });
  await event(auto, 'crm.contact.created.v1', { sourceId: null, statusId: statusA });
  await migrate(pg.ownerUrl);
});

afterAll(async () => {
  await db?.close();
  await pg?.stop();
});

const written = async (contact: string) =>
  (
    await db.db.execute<{ type: string; payload: Record<string, unknown>; published: boolean }>(
      sql`select type, payload, published_at is not null as published from outbox_events
        where aggregate_id = ${contact} and published_at is not null order by id`,
    )
  ).map((r) => ({ type: r.type, payload: r.payload }));

describe('starting owners and status of existing customers (0023)', () => {
  it('records hand-picked owners and the status of a customer that has no events', async () => {
    expect(await written(manual)).toEqual([
      {
        type: 'crm.contact.assigned.v1',
        payload: expect.objectContaining({ role: 'sales', fromUserId: null, toUserId: sales1 }),
      },
      {
        type: 'crm.contact.assigned.v1',
        payload: expect.objectContaining({ role: 'care', fromUserId: null, toUserId: care1 }),
      },
      {
        type: 'crm.contact.initial_status.v1',
        payload: expect.objectContaining({
          statusId: statusA,
          occurredAt: '2025-12-01T00:00:00.000Z',
          actorUserId: null,
        }),
      },
    ]);
  });

  it('takes the starting value from the first change, not the current one', async () => {
    expect(await written(reassigned)).toEqual([
      {
        type: 'crm.contact.assigned.v1',
        payload: expect.objectContaining({ role: 'sales', toUserId: sales1 }),
      },
      {
        type: 'crm.contact.initial_status.v1',
        payload: expect.objectContaining({ statusId: statusA }),
      },
    ]);
  });

  it('writes nothing the events already say, and nothing for a customer with nothing to say', async () => {
    expect(await written(auto)).toEqual([]);
    expect(await written(bare)).toEqual([]);
  });
});

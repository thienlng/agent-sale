import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import {
  brainSettings,
  conversationSignals,
  signalJobs,
  signalRuns,
  signalUsage,
  tasks,
} from './schema/index.js';
import { withTenant } from './tenant.js';

/**
 * Business Brain v1 (0073): workspace RLS on the five brain tables and crm `tasks`, their CHECK
 * constraints and what happens when a conversation or customer is deleted. One connection per
 * client (`max: 1`) mimics PgBouncer.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

type Shop = { ws: string; contact: string; conversation: string };
const user = newId();
const shops: Shop[] = [];
const exec = (q: ReturnType<typeof sql>) => owner.db.execute(q);

async function addConversation(ws: string, contact: string | null): Promise<string> {
  const channel = newId();
  const conv = newId();
  await exec(sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed)
    values (${channel}, ${ws}, 'website', ${channel}, 'Site', 'sealed')`);
  await exec(sql`insert into conversations (id, workspace_id, channel_id, customer_id, contact_id, data)
    values (${conv}, ${ws}, ${channel}, ${conv}, ${contact}, '{}'::jsonb)`);
  return conv;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  await exec(sql`insert into users (id, email, name) values (${user}, 'o@example.test', 'O')`);
  for (let i = 0; i < 2; i++) {
    const ws = newId();
    const contact = newId();
    await exec(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, ${`Shop ${i}`}, 'retail', ${user})`);
    await exec(
      sql`insert into contacts (id, workspace_id, name) values (${contact}, ${ws}, 'Khách')`,
    );
    shops.push({ ws, contact, conversation: await addConversation(ws, contact) });
  }
});

afterAll(async () => {
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

const pair = () => shops as [Shop, Shop];
const asTenant = <T>(s: Shop, fn: Parameters<typeof withTenant<T>>[2]) =>
  withTenant(tenant.db, workspaceId(s.ws), fn);

const taskRow = (s: Shop, over: Partial<typeof tasks.$inferInsert> = {}) => ({
  id: newId(),
  workspaceId: s.ws,
  title: 'Gọi lại cho khách',
  contactId: s.contact,
  conversationId: s.conversation,
  ...over,
});

describe('business brain tables (0073)', () => {
  it('isolates all six tables per workspace and hides them without tenant context', async () => {
    for (const s of pair()) {
      await asTenant(s, async (tx) => {
        await tx.insert(conversationSignals).values({
          workspaceId: s.ws,
          conversationId: s.conversation,
          contactId: s.contact,
          stage: 'price_asked',
          intent: 'Hỏi giá áo khoác',
        });
        await tx.insert(signalJobs).values({
          workspaceId: s.ws,
          conversationId: s.conversation,
          trigger: 'idle',
          runAfter: new Date(),
        });
        await tx.insert(signalRuns).values({
          id: newId(),
          workspaceId: s.ws,
          conversationId: s.conversation,
          trigger: 'idle',
          tier: 'basic',
          outcome: 'ok',
        });
        await tx.insert(signalUsage).values({ workspaceId: s.ws, day: '2026-11-11', count: 1 });
        await tx.insert(brainSettings).values({ workspaceId: s.ws });
        await tx.insert(tasks).values(taskRow(s));
      });
    }
    const tables = [
      conversationSignals,
      signalJobs,
      signalRuns,
      signalUsage,
      brainSettings,
      tasks,
    ] as const;
    for (const s of pair()) {
      for (const table of tables) {
        const rows = await asTenant(s, (tx) =>
          tx.select({ workspaceId: table.workspaceId }).from(table),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.workspaceId === s.ws)).toBe(true);
      }
    }
    for (const table of tables) {
      const rows = await tenant.db.transaction((tx) =>
        tx.select({ workspaceId: table.workspaceId }).from(table),
      );
      expect(rows).toEqual([]);
    }
    const [a, b] = pair();
    await expect(asTenant(a, (tx) => tx.insert(tasks).values(taskRow(b)))).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.insert(signalUsage).values({ workspaceId: b.ws, day: '2026-11-12' })),
    ).rejects.toThrow();
  });

  it('applies the defaults of the spec', async () => {
    const [a] = pair();
    const [settings] = await asTenant(a, (tx) => tx.select().from(brainSettings));
    expect(settings).toMatchObject({
      mode: 'auto',
      idleMinutes: 45,
      briefingEnabled: true,
      briefingHour: 8,
      lastBriefingDay: null,
    });
    const [signal] = await asTenant(a, (tx) => tx.select().from(conversationSignals));
    expect(signal).toMatchObject({
      mood: 'neutral',
      needsHuman: false,
      stageLocked: false,
      version: 1,
    });
    const [task] = await asTenant(a, (tx) => tx.select().from(tasks));
    expect(task).toMatchObject({
      status: 'open',
      assigneeKind: 'member',
      source: 'manual',
      version: 1,
    });
  });

  it('gives every stored plan version the daily evaluation cap (0074)', async () => {
    const rows = (await exec(
      sql`select code, entitlements -> 'brain.evaluations.daily' as cap from plans`,
    )) as unknown as { code: string; cap: unknown }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ cap: 200 });
  });

  it('checks enums and length limits', async () => {
    const [a] = pair();
    const insertTask = (over: Partial<typeof tasks.$inferInsert>) =>
      asTenant(a, (tx) => tx.insert(tasks).values(taskRow(a, over)));
    await expect(insertTask({ title: 'x'.repeat(201) })).rejects.toThrow();
    await expect(insertTask({ title: '   ' })).rejects.toThrow();
    await expect(insertTask({ note: 'x'.repeat(2001) })).rejects.toThrow();
    await expect(insertTask({ status: 'later' as 'open' })).rejects.toThrow();
    await expect(insertTask({ source: 'bot' as 'manual' })).rejects.toThrow();
    await expect(insertTask({ assigneeKind: 'team' as 'member' })).rejects.toThrow();
    await expect(insertTask({ subjectType: 'order' })).rejects.toThrow();
    await expect(
      insertTask({
        title: 'x'.repeat(200),
        note: 'x'.repeat(2000),
        subjectType: 'order',
        subjectId: newId(),
      }),
    ).resolves.toBeDefined();

    const conv = await addConversation(a.ws, null);
    const insertSignal = (over: Partial<typeof conversationSignals.$inferInsert>) =>
      asTenant(a, (tx) =>
        tx.insert(conversationSignals).values({ workspaceId: a.ws, conversationId: conv, ...over }),
      );
    await expect(insertSignal({ stage: 'hot' as 'new' })).rejects.toThrow();
    await expect(insertSignal({ mood: 'angry' as 'neutral' })).rejects.toThrow();
    await expect(insertSignal({ intent: 'x'.repeat(161) })).rejects.toThrow();
    await expect(insertSignal({ note: 'x'.repeat(1501) })).rejects.toThrow();
    await expect(
      insertSignal({ stage: 'after_sale', mood: 'complaint', note: 'x'.repeat(1500) }),
    ).resolves.toBeDefined();

    const job = (over: Partial<typeof signalJobs.$inferInsert>) =>
      asTenant(a, (tx) =>
        tx.insert(signalJobs).values({
          workspaceId: a.ws,
          conversationId: conv,
          trigger: 'manual',
          runAfter: new Date(),
          ...over,
        }),
      );
    await expect(job({ status: 'running' as 'pending' })).rejects.toThrow();
    await expect(job({ trigger: 'cron' as 'idle' })).rejects.toThrow();
    await expect(job({ status: 'capped' })).resolves.toBeDefined();

    await expect(
      asTenant(a, (tx) =>
        tx.insert(signalRuns).values({
          id: newId(),
          workspaceId: a.ws,
          conversationId: conv,
          trigger: 'refresh',
          tier: 'basic',
          outcome: 'crashed' as 'ok',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.update(brainSettings).set({ idleMinutes: 10 })),
    ).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.update(brainSettings).set({ mode: 'off' as 'auto' })),
    ).rejects.toThrow();
    await expect(
      asTenant(a, (tx) => tx.update(brainSettings).set({ briefingHour: 24 })),
    ).rejects.toThrow();
  });

  it('refuses links to another business and cleans up on delete', async () => {
    const [a, b] = pair();
    // Same-workspace keys: a signal or task cannot point at another business's customer.
    const conv = await addConversation(a.ws, null);
    await expect(
      exec(sql`insert into conversation_signals (workspace_id, conversation_id, contact_id)
        values (${a.ws}, ${conv}, ${b.contact})`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'conversation_signals_contact_fk' } });
    await expect(
      exec(sql`insert into conversation_signals (workspace_id, conversation_id)
        values (${a.ws}, ${b.conversation})`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'conversation_signals_conversation_fk' } });
    await expect(
      exec(sql`insert into tasks (id, workspace_id, title, contact_id)
        values (${newId()}, ${a.ws}, 'x', ${b.contact})`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'tasks_contact_fk' } });

    // Deleting a conversation deletes its signals and job, keeps the metering run.
    const contact = newId();
    await exec(
      sql`insert into contacts (id, workspace_id, name) values (${contact}, ${a.ws}, 'K')`,
    );
    const gone = await addConversation(a.ws, contact);
    await exec(sql`insert into conversation_signals (workspace_id, conversation_id, contact_id)
      values (${a.ws}, ${gone}, ${contact})`);
    await exec(sql`insert into signal_jobs (workspace_id, conversation_id, trigger, run_after)
      values (${a.ws}, ${gone}, 'idle', now())`);
    await exec(sql`insert into signal_runs (id, workspace_id, conversation_id, trigger, tier, outcome)
      values (${newId()}, ${a.ws}, ${gone}, 'idle', 'basic', 'ok')`);
    const taskId = newId();
    await exec(sql`insert into tasks (id, workspace_id, title, contact_id, conversation_id)
      values (${taskId}, ${a.ws}, 'Gọi lại', ${contact}, ${gone})`);

    // Deleting the customer clears the signal link and deletes the customer's tasks.
    await exec(sql`delete from contacts where id = ${contact}`);
    const signal = (await exec(
      sql`select contact_id from conversation_signals where conversation_id = ${gone}`,
    )) as unknown as { contact_id: string | null }[];
    expect(signal).toEqual([{ contact_id: null }]);
    const left = (await exec(sql`select id from tasks where id = ${taskId}`)) as unknown as [];
    expect(left).toEqual([]);

    await exec(sql`delete from conversations where id = ${gone}`);
    const count = async (table: string) =>
      (
        (await exec(
          sql`select count(*)::int as n from ${sql.identifier(table)} where conversation_id = ${gone}`,
        )) as unknown as { n: number }[]
      )[0]!.n;
    expect(await count('conversation_signals')).toBe(0);
    expect(await count('signal_jobs')).toBe(0);
    expect(await count('signal_runs')).toBe(1);
  });
});

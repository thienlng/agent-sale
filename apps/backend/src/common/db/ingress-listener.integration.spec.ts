import { createDb, migrate, sql } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startIngressListener } from './ingress-listener.js';

const USER = '00000000-0000-4000-8000-000000000001';
const WS = '00000000-0000-4000-8000-000000000002';
const CONN = '00000000-0000-4000-8000-000000000003';
let pg: TestPostgres;
let owner: ReturnType<typeof createDb>;

const until = async (cond: () => boolean, ms: number): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${USER}, 'o@example.test', 'Owner')`,
  );
  await owner.db.execute(
    sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id) values (${WS}, ${WS}, 'Shop', 'retail', ${USER})`,
  );
  await owner.db.execute(
    sql`insert into channel_connections (id, workspace_id, provider, external_id, name, token_sealed) values (${CONN}, ${WS}, 'facebook', 'p1', 'Page', 'x')`,
  );
});
afterAll(async () => {
  await owner?.close();
  await pg?.stop();
});

describe('ingress listener', () => {
  it('notifies on a stored event with only the row id, and reconnects after a drop', async () => {
    const states: boolean[] = [];
    let notes = 0;
    const l = startIngressListener({
      url: pg.ownerUrl,
      channel: 'rapiz_ingress',
      onNotify: () => void notes++,
      onState: (up) => void states.push(up),
      backoff: { minMs: 100, maxMs: 400 },
    });
    await until(() => states[0] === true, 5_000);

    // The trigger sends the id only. Verify the payload through a raw second listener.
    const payloads: string[] = [];
    const { default: postgres } = await import('postgres');
    const probe = postgres(pg.ownerUrl, { max: 1 });
    await probe.listen('rapiz_ingress', (p) => payloads.push(p));

    const id = await insertEvent();
    const t0 = Date.now();
    await until(() => notes === 1, 500);
    expect(Date.now() - t0).toBeLessThan(500);
    await until(() => payloads.length === 1, 500);
    expect(payloads[0]).toBe(id);

    await owner.db.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'rapiz-ingress-listener'`,
    );
    await until(() => states.includes(false), 5_000);
    await until(() => states.at(-1) === true, 5_000);

    await insertEvent();
    await until(() => notes === 2, 1_000);
    await probe.end({ timeout: 1 });
    await l.stop();
  });

  async function insertEvent(): Promise<string> {
    const rows = await owner.db.execute<{ id: string }>(
      sql`insert into channel_webhook_events (id, workspace_id, connection_id, external_id, payload)
          values (gen_random_uuid(), ${WS}, ${CONN}, gen_random_uuid()::text, '{}'::jsonb)
          returning id::text as id`,
    );
    return rows[0]!.id;
  }
});

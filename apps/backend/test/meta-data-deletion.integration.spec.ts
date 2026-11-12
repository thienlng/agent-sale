import { metaUserHash } from '@agent-sales/channels';
import { MetaDataDeletionStatus } from '@agent-sales/contracts';
import {
  and,
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
} from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SECRET_BOX, type SecretBox } from '../src/common/security/secret-box.js';
import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import {
  CHANNEL_DATA_DELETION_RUNNER,
  type ChannelDataDeletionRunner,
} from '../src/modules/channel/api/index.js';

/** Meta data deletion requests end to end on Postgres (docs/07 "Data deletion callback"). */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await pg?.stop();
});

async function workspace(): Promise<string> {
  const userId = newId();
  const ws = newId();
  await owner.db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@example.test`, name: 'Owner' });
  await owner.db
    .insert(schema.workspaces)
    .values({ id: ws, workspaceId: ws, name: 'Shop', industry: 'retail', ownerUserId: userId });
  return ws;
}

describe('Meta data deletion', () => {
  it('removes the pages the person connected in every business and reports the status', async () => {
    const box = app.get<SecretBox>(SECRET_BOX);
    const lan = metaUserHash('10234567890123456');
    const [a, b] = [await workspace(), await workspace()];
    const page = async (ws: string, hash: string | null) => {
      const id = newId();
      await owner.db.insert(schema.channelConnections).values({
        id,
        workspaceId: ws,
        provider: 'facebook',
        externalId: `page-${id}`,
        name: 'Page',
        // An empty token: the best-effort Graph unsubscribe is skipped (no network in tests).
        tokenSealed: box.seal(''),
        metaUserHash: hash,
      });
      return id;
    };
    const mine = [await page(a, lan), await page(b, lan)];
    const other = await page(a, metaUserHash('42'));
    const code = 'ABCDEF0123456789ABCDEF01';
    await owner.db
      .insert(schema.metaDataDeletionRequests)
      .values({ id: newId(), confirmationCode: code, userHash: lan });

    const status = async (c: string) =>
      app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'GET',
          url: `/api/v1/meta/data-deletion/${c}`,
        });
    expect(MetaDataDeletionStatus.parse((await status(code)).json())).toMatchObject({
      status: 'pending',
      completedAt: null,
    });

    const runner = app.get<ChannelDataDeletionRunner>(CHANNEL_DATA_DELETION_RUNNER);
    expect(await runner.tick()).toBe(1);
    expect(await runner.tick()).toBe(0);

    const rows = await owner.db.select().from(schema.channelConnections);
    for (const id of mine)
      expect(rows.find((r) => r.id === id)).toMatchObject({
        status: 'removed',
        metaUserHash: null,
        botId: null,
      });
    for (const id of mine)
      expect(box.open(rows.find((r) => r.id === id)?.tokenSealed ?? '')).toBe('');
    expect(rows.find((r) => r.id === other)).toMatchObject({ status: 'connected' });

    const [request] = await owner.db
      .select()
      .from(schema.metaDataDeletionRequests)
      .where(eq(schema.metaDataDeletionRequests.confirmationCode, code));
    expect(request).toMatchObject({ status: 'completed', userHash: null, connectionsRemoved: 2 });
    for (const ws of [a, b]) {
      const audits = await owner.db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.workspaceId, ws),
            eq(schema.auditEvents.action, 'channel.removed'),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.data).toMatchObject({ reason: 'meta_data_deletion' });
    }

    const done = await status(code);
    expect(done.statusCode).toBe(200);
    expect(MetaDataDeletionStatus.parse(done.json())).toMatchObject({
      confirmationCode: code,
      status: 'completed',
      connectionsRemoved: 2,
    });
    expect((await status('ABCDEF0123456789ABCDEF99')).statusCode).toBe(404);
    expect((await status('short')).statusCode).toBe(404);
  });
});

import { AuthResponse, BootstrapResponse, BotDto, TrainingItemList } from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { TRAINING_FACADE, type TrainingFacade } from '../src/modules/knowledge/api/index.js';
import { STARTER_RULES } from '../src/modules/knowledge/domain/starter-rules.js';

/** Instruction rules v2 (T-070) on a real Postgres: columns, CHECK constraint, starter pack. */
let pg: TestPostgres;
let app: NestFastifyApplication;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
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
  await pg?.stop();
});

const http = () => app.getHttpAdapter().getInstance();

async function newBot(email: string) {
  const auth = AuthResponse.parse(
    (
      await http().inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          name: 'Rules Owner',
          email,
          password: 'a long enough password',
          workspaceName: 'Rules Shop',
          industry: 'retail',
        },
      })
    ).json(),
  );
  const boot = BootstrapResponse.parse(
    (
      await http().inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { authorization: `Bearer ${auth.accessToken}` },
      })
    ).json(),
  );
  const ws = boot.memberships[0]?.workspaceId ?? '';
  const headers = { authorization: `Bearer ${auth.accessToken}`, 'x-workspace-id': ws };
  const bot = BotDto.parse(
    (
      await http().inject({
        method: 'POST',
        url: '/api/v1/bots',
        headers,
        payload: { name: 'Rules Bot', industry: 'retail' },
      })
    ).json(),
  );
  return { ws: workspaceId(ws), botId: bot.id, headers };
}

describe('instruction rules on Postgres', () => {
  it('starts a new bot with the starter pack and keeps seeding idempotent', async () => {
    const { ws, botId, headers } = await newBot('rules@shop.vn');
    const training = app.get<TrainingFacade>(TRAINING_FACADE);
    const list = await training.list(ws, botId);
    expect(list).toHaveLength(STARTER_RULES.length);
    expect(list.every((i) => i.enabled)).toBe(true);
    expect(list.filter((i) => i.section === 'after_order').map((i) => i.title)).toEqual([
      'Sau khi chốt đơn',
    ]);
    const response = await http().inject({
      method: 'POST',
      url: `/api/v1/bots/${botId}/training-items/starter-rules`,
      headers,
    });
    expect(response.statusCode).toBe(201);
    expect(TrainingItemList.parse(response.json()).data).toEqual([]);
    expect(await training.list(ws, botId)).toHaveLength(STARTER_RULES.length);
    const history = await training.history(ws, botId);
    expect(history.filter((h) => h.kind === 'scenario' && h.action === 'created')).toHaveLength(
      STARTER_RULES.length,
    );
  });

  it('persists enabled and section on update, shows them in history and restores them', async () => {
    const { ws, botId } = await newBot('rules2@shop.vn');
    const training = app.get<TrainingFacade>(TRAINING_FACADE);
    const created = await training.create(ws, botId, {
      kind: 'scenario',
      title: 'Thanks',
      content: 'Thank the customer.',
      trigger: '',
      mediaUrl: null,
      folderId: null,
      enabled: true,
      section: 'after_order',
    });
    const off = await training.update(ws, botId, created.id, { enabled: false });
    expect(off).toMatchObject({ enabled: false, section: 'after_order' });
    expect((await training.list(ws, botId)).find((i) => i.id === created.id)).toMatchObject({
      enabled: false,
      section: 'after_order',
    });
    await training.update(ws, botId, created.id, { section: 'general' });
    const [moved, toggled] = await training.history(ws, botId);
    expect(toggled?.changes).toEqual([{ field: 'enabled', before: true, after: false }]);
    expect(moved?.changes).toEqual([{ field: 'section', before: 'after_order', after: 'general' }]);
    await training.restoreItem(ws, botId, moved?.id ?? '');
    expect((await training.list(ws, botId)).find((i) => i.id === created.id)).toMatchObject({
      enabled: false,
      section: 'after_order',
    });
  });

  it('rejects an unknown section at the database', async () => {
    const { ws, botId } = await newBot('rules3@shop.vn');
    const training = app.get<TrainingFacade>(TRAINING_FACADE);
    const [item] = await training.list(ws, botId);
    const failure = await training
      .update(ws, botId, item?.id ?? '', { section: 'bogus' as 'general' })
      .then(
        () => null,
        (error: unknown) => error as { cause?: { constraint_name?: string } },
      );
    expect(failure?.cause?.constraint_name).toBe('training_items_section_check');
    expect((await training.list(ws, botId)).find((i) => i.id === item?.id)?.section).not.toBe(
      'bogus',
    );
  });
});

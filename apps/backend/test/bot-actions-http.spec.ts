import { ActionDto, AuthResponse, BootstrapResponse, BotDto } from '@agent-sales/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';
import { signUpVerified } from './support/signup.js';

/** Bot API actions are bot configuration with stored secrets: `bots.manage` only. */
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

const action = {
  name: 'Order lookup',
  description: 'Look up an order by code.',
  url: 'https://shop.example.com/api/orders/{code}',
  method: 'GET',
  params: [
    { name: 'code', type: 'string', location: 'path', required: true, description: 'Order code' },
  ],
  responses: [],
  auth: { kind: 'bearer' },
  authSecret: 'shop-api-key',
  requiresConfirm: false,
  enabled: true,
};

async function setup() {
  const booted = await createHttpApp(AppModule, { NODE_ENV: 'test', LOG_LEVEL: 'error' });
  app = booted.app;
  await app.init();
  const http = app.getHttpAdapter().getInstance();
  await http.ready();
  const auth = AuthResponse.parse(
    (
      await signUpVerified(app, {
        name: 'Action Owner',
        email: 'actions@example.test',
        password: 'correct horse battery',
        workspaceName: 'Action shop',
        industry: 'retail',
      })
    ).json(),
  );
  const authorization = `Bearer ${auth.accessToken}`;
  const boot = BootstrapResponse.parse(
    (
      await http.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { authorization } })
    ).json(),
  );
  const headers = { authorization, 'x-workspace-id': boot.memberships[0]?.workspaceId ?? '' };
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    http.inject({ method, url: `/api/v1${url}`, headers, ...(payload ? { payload } : {}) });
  const workspaces = app.get<WorkspaceFacade>(WORKSPACE_FACADE, { strict: false });
  const realMembership = workspaces.findMembership.bind(workspaces);
  /** Every request after this runs as a member with `role` (the guard reads the membership). */
  const actAs = (role: string) => {
    vi.spyOn(workspaces, 'findMembership').mockImplementation(async (...args) => {
      const m = await realMembership(...args);
      return m ? { ...m, role } : null;
    });
  };
  return { call, actAs };
}

describe('HTTP: bot API actions', () => {
  it('are managed by owners and admins, and refused to every other role', async () => {
    const { call, actAs } = await setup();
    const bot = BotDto.parse(
      (await call('POST', '/bots', { name: 'Shop bot', industry: 'retail' })).json(),
    );
    const created = await call('POST', `/bots/${bot.id}/actions`, action);
    expect(created.statusCode, created.body).toBe(201);
    const { id } = ActionDto.parse(created.json());
    const base = `/bots/${bot.id}/actions`;
    const routes: [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: object][] = [
      ['GET', base],
      ['POST', base, action],
      ['POST', `${base}/test`, { action, actionId: id, args: { code: 'A1' } }],
      ['GET', `${base}/${id}`],
      ['PATCH', `${base}/${id}`, { name: 'Renamed' }],
      ['DELETE', `${base}/${id}`],
      ['POST', `${base}/${id}/test`, { args: { code: 'A1' } }],
    ];
    for (const role of ['sales', 'care', 'analyst']) {
      actAs(role);
      for (const [method, url, body] of routes) {
        const res = await call(method, url, body);
        expect(res.statusCode, `${role} ${method} ${url}`).toBe(403);
      }
      vi.restoreAllMocks();
    }
    actAs('admin');
    expect((await call('GET', `${base}/${id}`)).statusCode).toBe(200);
  });
});

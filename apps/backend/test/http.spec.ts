import {
  allRoutes,
  AuthResponse,
  BootstrapResponse,
  HealthResponse,
  ReadinessResponse,
  WorkspaceDto,
  BotDto,
  BotReadiness,
  FaqDto,
  FaqListResponse,
  HermesLoginStatus,
  LlmProviderDto,
  LlmProviderModelList,
  LlmTierRouteList,
  PlaygroundResponse,
  TestLlmProviderResponse,
} from '@agent-sales/contracts';
import { HermesLoginClient } from '@agent-sales/ai-core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import {
  LLM_PROVIDER_FACTORY,
  type LlmProviderFactory,
} from '../src/modules/ai/application/ports/llm-provider-factory.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../src/modules/identity/domain/ports/user.repository.js';

/** HTTP-level tests through Fastify inject; no DB configured → in-memory adapters. */
let current: NestFastifyApplication | undefined;
const registered: Array<{ method: string; url: string }> = [];

async function app(extraEnv: NodeJS.ProcessEnv = {}): Promise<NestFastifyApplication> {
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    ...extraEnv,
  });
  registered.length = 0;
  booted.app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (r) => {
      for (const m of [r.method].flat())
        registered.push({ method: String(m).toLowerCase(), url: r.url });
    });
  await booted.app.init();
  await booted.app.getHttpAdapter().getInstance().ready();
  current = booted.app;
  return booted.app;
}

type InjectOpts = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};
const inject = (a: NestFastifyApplication, opts: InjectOpts) =>
  a.getHttpAdapter().getInstance().inject(opts);

const signupBody = {
  name: 'Lan',
  email: 'lan@shop.vn',
  password: 'correct horse battery',
  workspaceName: 'Shop Lan',
  industry: 'retail',
};

async function signup(a: NestFastifyApplication, email = signupBody.email) {
  const res = await inject(a, {
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { ...signupBody, email },
  });
  expect(res.statusCode).toBe(201);
  const body = AuthResponse.parse(res.json());
  const cookie = res.cookies.find((c) => c.name === 'rapiz_rt');
  return { token: body.accessToken, cookie, body };
}

async function bootstrap(a: NestFastifyApplication, token: string) {
  const res = await inject(a, {
    method: 'GET',
    url: '/api/v1/bootstrap',
    headers: { authorization: `Bearer ${token}` },
  });
  return BootstrapResponse.parse(res.json());
}

afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('HTTP: platform', () => {
  it('GET /api/v1/health is public, matches the contract and echoes a request id', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'req-abc-12345' },
    });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.safeParse(res.json()).success).toBe(true);
    expect(res.headers['x-request-id']).toBe('req-abc-12345');
  });

  it('generates a request id when a malformed one is sent', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'bad id!' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('readiness is ready without a configured database (postgres probe skipped)', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(ReadinessResponse.parse(res.json()).checks).toEqual([
      { name: 'postgres', status: 'skipped' },
    ]);
  });

  it('GET /metrics (outside the prefix) exposes the latency histogram', async () => {
    const a = await app();
    await inject(a, { method: 'GET', url: '/api/v1/health' });
    const res = await inject(a, { method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('route="/api/v1/health"');
  });

  it('every /api/v1 route is declared in packages/contracts and vice versa', async () => {
    await app();
    const toOpenApi = (url: string) => url.replace(/^\/api\/v1/, '').replace(/:(\w+)/g, '{$1}');
    const served = registered
      .filter((r) => r.url.startsWith('/api/v1/') && r.method !== 'head')
      .map((r) => `${r.method} ${toOpenApi(r.url)}`)
      .sort();
    expect(served).toEqual(allRoutes.map((r) => `${r.method} ${r.path}`).sort());
  });
});

describe('HTTP: auth and tenancy', () => {
  it('protected routes answer 401 without a token; error traceId equals x-request-id', async () => {
    const a = await app();
    const res = await inject(a, { method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { traceId: string } };
    expect(body.error.traceId).toBe(res.headers['x-request-id']);
  });

  it('signup → bootstrap → current workspace, refresh cookie HttpOnly and scoped to /api/v1/auth', async () => {
    const a = await app();
    const { token, cookie, body } = await signup(a);
    expect(body.refreshToken).toBeUndefined();
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/v1/auth', sameSite: 'Lax' });

    const boot = await bootstrap(a, token);
    expect(boot.memberships).toEqual([
      expect.objectContaining({ workspaceName: 'Shop Lan', role: 'owner' }),
    ]);

    const cur = await inject(a, {
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
      },
    });
    expect(cur.statusCode).toBe(200);
    expect(WorkspaceDto.parse(cur.json()).name).toBe('Shop Lan');
  });

  it("another user's workspace answers 404, not 403", async () => {
    const a = await app();
    const owner = await signup(a, 'owner@shop.vn');
    const ownerWs = (await bootstrap(a, owner.token)).memberships[0]?.workspaceId ?? '';
    const intruder = await signup(a, 'intruder@shop.vn');
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/workspaces/current',
      headers: { authorization: `Bearer ${intruder.token}`, 'x-workspace-id': ownerWs },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cookie refresh rotates the token and rejects foreign origins', async () => {
    const a = await app();
    const { cookie } = await signup(a);
    const ok = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      headers: { origin: 'http://localhost:5173' },
      cookies: { rapiz_rt: cookie?.value ?? '' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.find((c) => c.name === 'rapiz_rt')?.value).not.toBe(cookie?.value);

    const evil = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      headers: { origin: 'https://evil.example' },
      cookies: { rapiz_rt: cookie?.value ?? '' },
    });
    expect(evil.statusCode).toBe(403);
  });

  it('native clients get and send the refresh token in the body', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { ...signupBody, client: 'native' },
    });
    const { refreshToken } = AuthResponse.parse(res.json());
    expect(refreshToken).toBeTruthy();
    const next = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'native', refreshToken: refreshToken ?? '' },
    });
    expect(next.statusCode).toBe(200);
  });

  it('logout revokes the session so the refresh cookie stops working', async () => {
    const a = await app();
    const { token, cookie } = await signup(a);
    const out = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(out.statusCode).toBe(204);
    const again = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: {},
      cookies: { rapiz_rt: cookie?.value ?? '' },
    });
    expect(again.statusCode).toBe(401);
  });

  it('validation errors use the shared envelope', async () => {
    const a = await app();
    const res = await inject(a, {
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('HTTP: bots and FAQs', () => {
  async function owner(a: NestFastifyApplication) {
    const { token } = await signup(a, `bot-owner-${Math.random()}@shop.vn`);
    const ws = (await bootstrap(a, token)).memberships[0]?.workspaceId ?? '';
    return { authorization: `Bearer ${token}`, 'x-workspace-id': ws };
  }

  it('creates a bot from an industry pack, fills placeholders and becomes FAQ-ready', async () => {
    const a = await app();
    const h = await owner(a);
    const created = await inject(a, {
      method: 'POST',
      url: '/api/v1/bots',
      headers: h,
      payload: { name: 'Rapiz Bot', industry: 'retail' },
    });
    expect(created.statusCode).toBe(201);
    const bot = BotDto.parse(created.json());

    const faqs = FaqListResponse.parse(
      (await inject(a, { method: 'GET', url: `/api/v1/bots/${bot.id}/faqs`, headers: h })).json(),
    );
    expect(faqs.data.length).toBeGreaterThanOrEqual(6);
    expect(faqs.data.some((f) => f.missingPlaceholders.includes('store.address'))).toBe(true);

    const readiness = BotReadiness.parse(
      (
        await inject(a, { method: 'GET', url: `/api/v1/bots/${bot.id}/readiness`, headers: h })
      ).json(),
    );
    const values = Object.fromEntries(
      readiness.missingPlaceholders.map((p) => [p, `giá trị ${p}`]),
    );
    const patched = await inject(a, {
      method: 'PATCH',
      url: `/api/v1/bots/${bot.id}`,
      headers: h,
      payload: { settings: { placeholders: values } },
    });
    expect(patched.statusCode).toBe(200);
    const after = BotReadiness.parse(
      (
        await inject(a, { method: 'GET', url: `/api/v1/bots/${bot.id}/readiness`, headers: h })
      ).json(),
    );
    expect(after.missingPlaceholders).toEqual([]);
    expect(after.checks.find((c) => c.key === 'channel')?.done).toBe(false);
  });

  it('FAQ CRUD; bots of another workspace answer 404', async () => {
    const a = await app();
    const h = await owner(a);
    const bot = BotDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'B', industry: 'other' },
        })
      ).json(),
    );
    const faq = FaqDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: `/api/v1/bots/${bot.id}/faqs`,
          headers: h,
          payload: { question: 'Có freeship không?', answer: 'Freeship đơn từ 500.000đ' },
        })
      ).json(),
    );
    const edited = await inject(a, {
      method: 'PATCH',
      url: `/api/v1/bots/${bot.id}/faqs/${faq.id}`,
      headers: h,
      payload: { answer: 'Freeship đơn từ 300.000đ' },
    });
    expect(FaqDto.parse(edited.json()).answer).toBe('Freeship đơn từ 300.000đ');
    const del = await inject(a, {
      method: 'DELETE',
      url: `/api/v1/bots/${bot.id}/faqs/${faq.id}`,
      headers: h,
    });
    expect(del.statusCode).toBe(204);

    const other = await owner(a);
    const foreign = await inject(a, {
      method: 'GET',
      url: `/api/v1/bots/${bot.id}`,
      headers: other,
    });
    expect(foreign.statusCode).toBe(404);
    const notUuid = await inject(a, { method: 'GET', url: '/api/v1/bots/not-a-uuid', headers: h });
    expect(notUuid.statusCode).toBe(404);
    const foreignFaqs = await inject(a, {
      method: 'GET',
      url: `/api/v1/bots/${bot.id}/faqs`,
      headers: other,
    });
    expect(foreignFaqs.statusCode).toBe(404);
  });

  it('rejects settings that break the contract after merge', async () => {
    const a = await app();
    const h = await owner(a);
    const bot = BotDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'B', industry: 'spa' },
        })
      ).json(),
    );
    const res = await inject(a, {
      method: 'PATCH',
      url: `/api/v1/bots/${bot.id}`,
      headers: h,
      payload: { settings: { creativity: 'wild' } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('HTTP: AI playground', () => {
  async function botWithFaq(a: NestFastifyApplication) {
    const { token } = await signup(a, `ai-owner-${Math.random()}@shop.vn`);
    const ws = (await bootstrap(a, token)).memberships[0]?.workspaceId ?? '';
    const h = { authorization: `Bearer ${token}`, 'x-workspace-id': ws };
    const bot = BotDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/bots',
          headers: h,
          payload: { name: 'Rapiz Bot', industry: 'other' },
        })
      ).json(),
    );
    await inject(a, {
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/faqs`,
      headers: h,
      payload: { question: 'Áo thun giá bao nhiêu?', answer: 'Dạ áo thun giá 350.000đ ạ' },
    });
    return { h, bot, token };
  }

  const ask = (a: NestFastifyApplication, h: Record<string, string>, botId: string, text: string) =>
    inject(a, {
      method: 'POST',
      url: `/api/v1/bots/${botId}/playground`,
      headers: h,
      payload: { messages: [{ role: 'customer', content: text }] },
    });

  it('answers from the FAQ (unaccented question), cites it and meters the run', async () => {
    const a = await app();
    const { h, bot } = await botWithFaq(a);
    const res = await ask(a, h, bot.id, 'ao thun gia bao nhieu vay shop');
    expect(res.statusCode).toBe(200);
    const body = PlaygroundResponse.parse(res.json());
    expect(body.outcome).toBe('answered');
    expect(body.reply).toContain('350.000');
    expect(body.sources.find((s) => s.used)?.question).toBe('Áo thun giá bao nhiêu?');
    expect(body.provider).toBe('dev-fake');
    expect(body.usage.outputTokens).toBeGreaterThan(0);

    const metrics = await inject(a, { method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('ai_runs_total{outcome="answered",test="true"}');
  });

  it("uses the bot's own fallback and handoff messages", async () => {
    const a = await app();
    const { h, bot } = await botWithFaq(a);
    const unknown = PlaygroundResponse.parse(
      (await ask(a, h, bot.id, 'shop có bán xe máy không')).json(),
    );
    expect(unknown.outcome).toBe('fallback');
    expect(unknown.reply).toBe(bot.settings.fallbackMessage);

    const human = PlaygroundResponse.parse(
      (await ask(a, h, bot.id, 'cho mình gặp nhân viên')).json(),
    );
    expect(human.outcome).toBe('handoff');
    expect(human.reply).toBe(bot.settings.handoffMessage);
  });

  it('validates the conversation and hides bots of other workspaces', async () => {
    const a = await app();
    const { h, bot } = await botWithFaq(a);
    const botLast = await inject(a, {
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/playground`,
      headers: h,
      payload: { messages: [{ role: 'bot', content: 'Dạ em chào anh/chị' }] },
    });
    expect(botLast.statusCode).toBe(400);

    const other = await botWithFaq(a);
    const foreign = await ask(a, other.h, bot.id, 'áo thun giá bao nhiêu');
    expect(foreign.statusCode).toBe(404);
  });
});

/** No test talks to a real network: every provider built by the factory is a fake that refuses. */
function stubLlmNetwork(a: NestFastifyApplication): void {
  const factory = a.get<LlmProviderFactory>(LLM_PROVIDER_FACTORY);
  vi.spyOn(factory, 'create').mockImplementation((config) => ({
    name: config.name,
    generate: () => Promise.reject(new Error('connection refused')),
  }));
  vi.spyOn(factory, 'listModels').mockResolvedValue({ models: [], state: 'unavailable' });
  vi.spyOn(factory, 'hermesLogin').mockImplementation(
    (config) =>
      new HermesLoginClient({
        baseURL: config.baseUrl ?? '',
        apiKey: 'b'.repeat(40),
        fetch: () => Promise.reject(new Error('connection refused')),
      }),
  );
}

describe('HTTP: platform admin — LLM configuration', () => {
  async function admin(a: NestFastifyApplication) {
    const email = `admin-${Math.random()}@rapiz.vn`;
    const { token } = await signup(a, email);
    await a.get<UserRepository>(USER_REPOSITORY).setPlatformAdmin(email, true);
    return { authorization: `Bearer ${token}` };
  }

  it('is invisible (404) to users who are not platform admins', async () => {
    const a = await app();
    const { token } = await signup(a, `owner-${Math.random()}@shop.vn`);
    const res = await inject(a, {
      method: 'GET',
      url: '/api/v1/admin/llm/providers',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    const me = await bootstrap(a, token);
    expect(me.user.isPlatformAdmin).toBe(false);
  });

  it('manages providers and tier routes; API keys are write-only', async () => {
    const a = await app();
    const h = await admin(a);
    const created = await inject(a, {
      method: 'POST',
      url: '/api/v1/admin/llm/providers',
      headers: h,
      payload: {
        name: 'selfhost',
        kind: 'openai_compatible',
        baseUrl: 'http://llm.test/v1',
        apiKey: 'sk-local-secret-9876',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('sk-local-secret');
    const provider = LlmProviderDto.parse(created.json());
    expect(provider).toMatchObject({ hasApiKey: true, apiKeyHint: '9876', isEnabled: true });
    expect(provider.options.structuredOutput).toBe('json_schema');

    const dup = await inject(a, {
      method: 'POST',
      url: '/api/v1/admin/llm/providers',
      headers: h,
      payload: { name: 'selfhost', kind: 'anthropic' },
    });
    expect(dup.statusCode).toBe(409);

    const noUrl = await inject(a, {
      method: 'POST',
      url: '/api/v1/admin/llm/providers',
      headers: h,
      payload: { name: 'nourl', kind: 'openai_compatible' },
    });
    expect(noUrl.statusCode).toBe(400);

    const put = await inject(a, {
      method: 'PUT',
      url: '/api/v1/admin/llm/tiers/smart',
      headers: h,
      payload: {
        primary: { providerId: provider.id, model: 'qwen3-32b', effort: 'low' },
        fallback: null,
      },
    });
    expect(put.statusCode).toBe(200);
    const tiers = LlmTierRouteList.parse(
      (await inject(a, { method: 'GET', url: '/api/v1/admin/llm/tiers', headers: h })).json(),
    );
    expect(tiers.data.map((t) => [t.tier, t.primary.model])).toEqual([['smart', 'qwen3-32b']]);

    const inUse = await inject(a, {
      method: 'DELETE',
      url: `/api/v1/admin/llm/providers/${provider.id}`,
      headers: h,
    });
    expect(inUse.statusCode).toBe(409);

    // Changing the URL without a new key drops the stored key (never sent to a new host).
    const moved = LlmProviderDto.parse(
      (
        await inject(a, {
          method: 'PATCH',
          url: `/api/v1/admin/llm/providers/${provider.id}`,
          headers: h,
          payload: { baseUrl: 'http://10.0.0.5:8000/v1' },
        })
      ).json(),
    );
    expect(moved).toMatchObject({ hasApiKey: false, apiKeyHint: null });

    const reserved = await inject(a, {
      method: 'POST',
      url: '/api/v1/admin/llm/providers',
      headers: h,
      payload: { name: 'dev-fake', kind: 'anthropic' },
    });
    expect(reserved.statusCode).toBe(400);

    const badTier = await inject(a, {
      method: 'PUT',
      url: '/api/v1/admin/llm/tiers/ultra',
      headers: h,
      payload: { primary: { providerId: provider.id, model: 'm', effort: null }, fallback: null },
    });
    expect(badTier.statusCode).toBe(400);
  });

  it('Hermes sign-in and model-list routes reject anonymous callers (401) and non-admins (404)', async () => {
    const a = await app();
    const { token } = await signup(a, `owner-${Math.random()}@shop.vn`);
    const base = '/api/v1/admin/llm/providers/00000000-0000-7000-8000-000000000001';
    const routes: Array<[InjectOpts['method'], string]> = [
      ['GET', `${base}/hermes-login`],
      ['POST', `${base}/hermes-login`],
      ['DELETE', `${base}/hermes-login`],
      ['GET', `${base}/models`],
    ];
    for (const [method, url] of routes) {
      expect((await inject(a, { method, url })).statusCode, `${method} ${url} anonymous`).toBe(401);
      const asOwner = await inject(a, {
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(asOwner.statusCode, `${method} ${url} non-admin`).toBe(404);
    }
  });

  it('Hermes sign-in is reported disabled and refused (403) when the gate is off', async () => {
    const a = await app({ HERMES_SUBSCRIPTION_LOGIN: 'false' });
    stubLlmNetwork(a);
    const h = await admin(a);
    const hermes = LlmProviderDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/admin/llm/providers',
          headers: h,
          payload: {
            name: 'hermes',
            kind: 'hermes',
            baseUrl: 'http://bridge.test',
            apiKey: 'b'.repeat(40),
          },
        })
      ).json(),
    );
    const url = `/api/v1/admin/llm/providers/${hermes.id}/hermes-login`;
    const status = await inject(a, { method: 'GET', url, headers: h });
    expect(HermesLoginStatus.parse(status.json()).state).toBe('disabled');
    for (const method of ['POST', 'DELETE'] as const) {
      const res = await inject(a, { method, url, headers: h });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('Hermes sign-in routes are admin-only and only for hermes providers', async () => {
    const a = await app();
    stubLlmNetwork(a);
    const h = await admin(a);
    const { token } = await signup(a, `owner-${Math.random()}@shop.vn`);
    const make = async (payload: Record<string, unknown>) =>
      LlmProviderDto.parse(
        (
          await inject(a, {
            method: 'POST',
            url: '/api/v1/admin/llm/providers',
            headers: h,
            payload,
          })
        ).json(),
      );
    const claude = await make({ name: 'claude', kind: 'anthropic' });
    const hermes = await make({
      name: 'hermes',
      kind: 'hermes',
      baseUrl: 'http://bridge.test',
      apiKey: 'b'.repeat(40),
    });
    const url = (id: string) => `/api/v1/admin/llm/providers/${id}/hermes-login`;

    const forbidden = await inject(a, {
      method: 'GET',
      url: url(hermes.id),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(forbidden.statusCode).toBe(404);

    const wrongKind = await inject(a, { method: 'GET', url: url(claude.id), headers: h });
    expect(wrongKind.statusCode).toBe(400);
    const missing = await inject(a, { method: 'POST', url: url('nope'), headers: h });
    expect(missing.statusCode).toBe(404);

    // The fake transport refuses every connection: the bridge is reported unreachable, not an error.
    const status = HermesLoginStatus.parse(
      (await inject(a, { method: 'GET', url: url(hermes.id), headers: h })).json(),
    );
    expect(status.state).toBe('unreachable');
    const out = await inject(a, { method: 'DELETE', url: url(hermes.id), headers: h });
    expect(out.statusCode).toBe(200);
  });

  it('provider model list is admin-only, 404 for unknown ids and degrades to unavailable', async () => {
    const a = await app();
    stubLlmNetwork(a);
    const h = await admin(a);
    const { token } = await signup(a, `owner-${Math.random()}@shop.vn`);
    const created = LlmProviderDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/admin/llm/providers',
          headers: h,
          payload: { name: 'down', kind: 'openai_compatible', baseUrl: 'http://llm.test/v1' },
        })
      ).json(),
    );
    const url = (id: string) => `/api/v1/admin/llm/providers/${id}/models`;
    const forbidden = await inject(a, {
      method: 'GET',
      url: url(created.id),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(forbidden.statusCode).toBe(404);
    expect((await inject(a, { method: 'GET', url: url('nope'), headers: h })).statusCode).toBe(404);
    const res = await inject(a, { method: 'GET', url: url(created.id), headers: h });
    expect(res.statusCode).toBe(200);
    expect(LlmProviderModelList.parse(res.json())).toEqual({ data: [], state: 'unavailable' });
  });

  it('a tier routed to an unreachable server: test reports it, the playground answers 503', async () => {
    const a = await app();
    stubLlmNetwork(a);
    const h = await admin(a);
    const provider = LlmProviderDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/admin/llm/providers',
          headers: h,
          payload: {
            name: 'down',
            kind: 'openai_compatible',
            baseUrl: 'http://llm.test/v1',
            options: { timeoutMs: 2000 },
          },
        })
      ).json(),
    );
    const test = TestLlmProviderResponse.parse(
      (
        await inject(a, {
          method: 'POST',
          url: `/api/v1/admin/llm/providers/${provider.id}/test`,
          headers: h,
          payload: { model: 'qwen3-32b' },
        })
      ).json(),
    );
    expect(test.ok).toBe(false);
    expect(test.error).toBeTruthy();

    await inject(a, {
      method: 'PUT',
      url: '/api/v1/admin/llm/tiers/smart',
      headers: h,
      payload: {
        primary: { providerId: provider.id, model: 'qwen3-32b', effort: null },
        fallback: null,
      },
    });

    // The admin's own workspace; new bots default to the smart tier.
    const ws = (await bootstrap(a, h.authorization.slice(7))).memberships[0]?.workspaceId ?? '';
    const wh = { ...h, 'x-workspace-id': ws };
    const bot = BotDto.parse(
      (
        await inject(a, {
          method: 'POST',
          url: '/api/v1/bots',
          headers: wh,
          payload: { name: 'Bot', industry: 'other' },
        })
      ).json(),
    );
    const res = await inject(a, {
      method: 'POST',
      url: `/api/v1/bots/${bot.id}/playground`,
      headers: wh,
      payload: { messages: [{ role: 'customer', content: 'xin chào' }] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('AI_UNAVAILABLE');
  }, 20_000);
});

import { Controller, Get, Module, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createHttpApp } from '../src/bootstrap.js';
import { configureEnv } from '../src/common/config.js';

@Controller('whoami')
class WhoAmIController {
  @Get()
  ip(@Req() req: FastifyRequest): { ip: string } {
    return { ip: req.ip };
  }
}

@Module({ controllers: [WhoAmIController] })
class WhoAmIModule {}

const KEY = Buffer.alloc(32, 7).toString('base64');

/** `req.ip` as the API sees it, for a request from `peer` carrying `xff`. */
async function ipSeen(
  env: NodeJS.ProcessEnv,
  peer: string,
  xff?: string,
): Promise<{ ip: string; app: NestFastifyApplication }> {
  const { app } = await createHttpApp(WhoAmIModule, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/whoami',
    remoteAddress: peer,
    ...(xff ? { headers: { 'x-forwarded-for': xff } } : {}),
  });
  return { ip: (res.json() as { ip: string }).ip, app };
}

describe('client address (TRUST_PROXY)', () => {
  const apps: NestFastifyApplication[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
    configureEnv({ NODE_ENV: 'test' });
  });

  const production = { NODE_ENV: 'production', SECRETS_ENCRYPTION_KEY: KEY };

  it('in production takes the peer NPM saw, not what the client wrote', async () => {
    // Client wrote 1.2.3.4; NPM appended its real peer, Caddy appended NPM; the socket is Caddy.
    const r = await ipSeen(production, '172.18.0.4', '1.2.3.4, 203.0.113.7, 172.19.0.2');
    apps.push(r.app);
    expect(r.ip).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    const r = await ipSeen(production, '198.51.100.9', '1.2.3.4');
    apps.push(r.app);
    expect(r.ip).toBe('198.51.100.9');
  });

  it('trusts nothing with TRUST_PROXY=false', async () => {
    const r = await ipSeen({ ...production, TRUST_PROXY: 'false' }, '172.18.0.4', '203.0.113.7');
    apps.push(r.app);
    expect(r.ip).toBe('172.18.0.4');
  });

  it('refuses TRUST_PROXY=true at start-up', async () => {
    await expect(
      createHttpApp(WhoAmIModule, { ...production, TRUST_PROXY: 'true' }),
    ).rejects.toThrow(/TRUST_PROXY/);
  });
});

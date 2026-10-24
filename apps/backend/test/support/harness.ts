import { deflateSync } from 'node:zlib';

import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import { createDb, ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';

import { AppModule } from '../../src/app.module.js';
import { createHttpApp } from '../../src/bootstrap.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Headers = Record<string, string>;

/** A booted API on a real Postgres, with helpers to sign users up and call routes. */
export interface Harness {
  app: NestFastifyApplication;
  owner: ReturnType<typeof createDb>;
  call(h: Headers, method: Method, url: string, payload?: object): Promise<LightMyRequestResponse>;
  raw(
    h: Headers,
    method: Method,
    url: string,
    body: Buffer,
    contentType: string,
  ): Promise<LightMyRequestResponse>;
  user(email: string, name: string, password?: string): Promise<TestUser>;
  stop(): Promise<void>;
}

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  ownWorkspace: string;
  accessToken: string;
  /** Authenticated, workspace-less. */
  auth: Headers;
  /** Authenticated in the user's own workspace. */
  h: Headers;
  in(workspaceId: string): Headers;
}

let signups = 0;

export async function startHarness(): Promise<Harness> {
  const pg: TestPostgres = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const owner = createDb({ url: pg.ownerUrl, max: 2 });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  const app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const server = () => app.getHttpAdapter().getInstance();

  const call: Harness['call'] = (h, method, url, payload) =>
    server().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
  const raw: Harness['raw'] = (h, method, url, body, contentType) =>
    server().inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...h, 'content-type': contentType },
      payload: body,
    });

  return {
    app,
    owner,
    call,
    raw,
    async user(email, name, password = 'a long enough password') {
      const signup = await server().inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        // Signup is rate-limited per address: every test user comes from its own.
        remoteAddress: `10.3.${Math.floor(signups / 250)}.${(signups++ % 250) + 1}`,
        payload: { name, email, password, workspaceName: `Shop ${name}`, industry: 'fashion' },
      });
      const { accessToken } = AuthResponse.parse(signup.json());
      const authorization = `Bearer ${accessToken}`;
      const boot = BootstrapResponse.parse(
        (await call({ authorization }, 'GET', '/bootstrap')).json(),
      );
      const own = boot.memberships[0]?.workspaceId ?? '';
      return {
        userId: boot.user.id,
        email,
        password,
        ownWorkspace: own,
        accessToken,
        auth: { authorization },
        h: { authorization, 'x-workspace-id': own },
        in: (ws: string) => ({ authorization, 'x-workspace-id': ws }),
      };
    },
    async stop() {
      await app.close();
      await owner.close();
      await pg.stop();
    },
  };
}

// ─── real image fixtures ──────────────────────────────────────────────────────

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A real, decodable grayscale PNG of `width × height`; `noise` makes it incompressible (big files). */
export function makePng(width: number, height = width, noise = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const rows = Buffer.alloc((width + 1) * height);
  if (noise) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++)
        rows[y * (width + 1) + 1 + x] = (x * 131 + y * 71 + ((x * y) % 251)) & 0xff;
    }
  } else {
    for (let y = 0; y < height; y++) rows.fill(0x80, y * (width + 1) + 1, (y + 1) * (width + 1));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: noise ? 0 : 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

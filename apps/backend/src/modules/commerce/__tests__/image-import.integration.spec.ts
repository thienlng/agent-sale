import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createDb, ensureLoginRoles, migrate, sql, withCredentials } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { importProductImages } from '../infrastructure/image-import/import-product-images.js';

const MEDIA = 'https://media.rapiz.test';
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16, 7)]);

let pg: TestPostgres;
let owner: ReturnType<typeof createDb>;
let system: ReturnType<typeof createDb>;
let server: Server;
let base = '';
const hits: Record<string, number> = {};
const accept: string[] = [];

const puts: { key: string; mime: string; size: number }[] = [];
const storage: PublicObjectStorage = {
  put: (key, bytes, mime) => {
    puts.push({ key, mime, size: bytes.length });
    return Promise.resolve(`${MEDIA}/${key}`);
  },
  remove: () => Promise.resolve(),
  isPublicUrlUnder: (url, prefix) => url.startsWith(`${MEDIA}/${prefix}`),
};

const user = newId();
const wsA = newId();
const wsB = newId();
const pA1 = newId();
const pA2 = newId();
const pB = newId();

beforeAll(async () => {
  server = createServer((req, res) => {
    hits[req.url ?? ''] = (hits[req.url ?? ''] ?? 0) + 1;
    accept.push(String(req.headers.accept));
    if (req.url === '/ok.png') res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    else if (req.url === '/redirect') res.writeHead(302, { location: '/ok.png' }).end();
    else if (req.url === '/html') res.writeHead(200).end('<html></html>');
    else res.writeHead(404).end('nope');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  const x = (q: ReturnType<typeof sql>) => owner.db.execute(q);
  await x(sql`insert into users (id, email, name) values (${user}, 'o@example.test', 'O')`);
  for (const ws of [wsA, wsB])
    await x(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${ws}, ${ws}, 'Shop', 'retail', ${user})`);
  const product = (id: string, ws: string, code: string, urls: string[], acc: object | null) =>
    x(sql`insert into products (id, workspace_id, code, name, search_text, image_urls, accommodation)
      values (${id}, ${ws}, ${code}, ${code}, ${code}, ${JSON.stringify(urls)}::jsonb, ${acc ? JSON.stringify(acc) : null}::jsonb)`);
  await product(
    pA1,
    wsA,
    'A1',
    [`${base}/ok.png`, `${MEDIA}/products/${wsA}/keep.jpg`, `${base}/404`],
    null,
  );
  await product(pA2, wsA, 'A2', [`${base}/redirect`], {
    rooms: 3,
    gallery: [
      { url: `${base}/ok.png`, caption: 'Pool' },
      { url: `${base}/html`, caption: 'Bad' },
    ],
  });
  await product(pB, wsB, 'B1', [`${base}/ok.png`], null);
});

afterAll(async () => {
  await owner?.close();
  await system?.close();
  await pg?.stop();
  server?.close();
});

const read = async (id: string) =>
  (
    (await owner.db.execute(
      sql`select image_urls, accommodation from products where id = ${id}`,
    )) as unknown as {
      image_urls: string[];
      accommodation: { gallery: { url: string; caption: string }[] } | null;
    }[]
  )[0]!;

describe('importProductImages', () => {
  it('dry run counts and changes nothing', async () => {
    const report = await importProductImages(system.db, storage, {
      dryRun: true,
      allowPrivateHosts: true,
    });
    expect(report[wsA]).toMatchObject({ found: 5, alreadyStored: 1, imported: 0 });
    expect(puts).toHaveLength(0);
    expect(hits).toEqual({});
  });

  it('imports, rewrites in place, reports failures, uploads one copy per source per workspace', async () => {
    const report = await importProductImages(system.db, storage, {
      workspaceId: wsA,
      allowPrivateHosts: true,
    });
    expect(report[wsB]).toBeUndefined();
    expect(report[wsA]).toEqual({
      found: 5,
      alreadyStored: 1,
      imported: 3,
      failed: { count: 2, reasons: { http_404: 1, not_an_image: 1 } },
    });
    expect(hits['/ok.png']).toBe(2); // once direct (shared by A1 and the A2 gallery), once via the redirect
    expect(puts).toHaveLength(2);
    expect(accept[0]).toBe('image/jpeg,image/png;q=0.9,*/*;q=0.1');
    expect(accept[0]).not.toContain('webp');
    const a1 = await read(pA1);
    expect(a1.image_urls[0]).toMatch(new RegExp(`^${MEDIA}/products/${wsA}/[\\w-]+\\.png$`));
    expect(a1.image_urls[1]).toBe(`${MEDIA}/products/${wsA}/keep.jpg`);
    expect(a1.image_urls[2]).toBe(`${base}/404`);
    const a2 = await read(pA2);
    expect(a2.image_urls[0]).toContain(`/products/${wsA}/`);
    expect(a2.accommodation?.gallery[0]?.url).toBe(a1.image_urls[0]);
    expect(a2.accommodation?.gallery.map((g) => g.caption)).toEqual(['Pool', 'Bad']);
    expect(a2.accommodation?.gallery[1]?.url).toBe(`${base}/html`);
    expect((await read(pB)).image_urls).toEqual([`${base}/ok.png`]);
    expect(puts.every((p) => p.mime === 'image/png' && p.size === PNG.length)).toBe(true);
  });

  it('is idempotent: a second run only retries the failures', async () => {
    const before = puts.length;
    const report = await importProductImages(system.db, storage, {
      workspaceId: wsA,
      allowPrivateHosts: true,
    });
    expect(report[wsA]).toMatchObject({ found: 2, imported: 0, alreadyStored: 4 });
    expect(puts.length).toBe(before);
  });

  it('imports other workspaces under their own prefix', async () => {
    await importProductImages(system.db, storage, { allowPrivateHosts: true });
    expect((await read(pB)).image_urls[0]).toContain(`/products/${wsB}/`);
  });

  it('keeps a merchant edit made while images were downloading', async () => {
    const id = newId();
    const call = (q: ReturnType<typeof sql>) => owner.db.execute(q);
    await call(sql`insert into products (id, workspace_id, code, name, search_text, image_urls, accommodation)
      values (${id}, ${wsA}, 'RACE', 'RACE', 'RACE', ${JSON.stringify([`${base}/ok.png`])}::jsonb,
      ${JSON.stringify({ rooms: 1, gallery: [{ url: `${base}/ok.png`, caption: 'Old' }] })}::jsonb)`);
    await importProductImages(system.db, storage, {
      workspaceId: wsA,
      download: async (url) => {
        const img = await (
          await import('../infrastructure/image-import/download-image.js')
        ).downloadImage(url, fetch, { allowPrivateHosts: true });
        // The merchant edits the caption and adds a picture before the import writes.
        await call(sql`update products set accommodation = ${JSON.stringify({
          rooms: 1,
          gallery: [{ url: `${base}/ok.png`, caption: 'Edited' }],
        })}::jsonb, image_urls = ${JSON.stringify([`${base}/ok.png`, `${MEDIA}/products/${wsA}/new.jpg`])}::jsonb
          where id = ${id}`);
        return img;
      },
    });
    const after = await read(id);
    expect(after.image_urls).toHaveLength(2);
    expect(after.image_urls[0]).toContain(`/products/${wsA}/`);
    expect(after.image_urls[0]).not.toContain('127.0.0.1');
    expect(after.image_urls[1]).toBe(`${MEDIA}/products/${wsA}/new.jpg`);
    expect(after.accommodation?.gallery[0]?.caption).toBe('Edited');
    expect(after.accommodation?.gallery[0]?.url).toBe(after.image_urls[0]);
  });
});

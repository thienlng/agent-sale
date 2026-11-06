import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

/** Migration 0066 (T-192): flat lodging galleries become one "Ảnh chung" folder. */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
const user = newId();
const ws = newId();
const flat = newId();
const empty = newId();
const foldered = newId();
const FOLDERS = [
  {
    id: 'bedrooms',
    name: 'Phòng ngủ',
    items: [{ kind: 'image', url: 'https://cdn.example.com/b/1.jpg', caption: '' }],
  },
];
const FLAT = Array.from({ length: 12 }, (_, i) =>
  i % 2 === 0
    ? { url: `https://cdn.example.com/a17/${i}.jpg`, caption: `Ảnh ${i}` }
    : { url: `https://cdn.example.com/a17/${i}.jpg` },
);

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

async function property(id: string, code: string, gallery: unknown): Promise<void> {
  await owner.db.execute(sql`insert into lodging_properties
      (id, workspace_id, code, name, sell_mode, standard_adults, gallery)
    values (${id}, ${ws}, ${code}, ${`Villa ${code}`}, 'whole', 2, ${JSON.stringify(gallery)}::jsonb)`);
}

async function stored(id: string): Promise<{ gallery: unknown; gallery_cover: string }> {
  const rows = await owner.db.execute<{ gallery: unknown; gallery_cover: string }>(
    sql`select gallery, gallery_cover from lodging_properties where id = ${id}`,
  );
  const row = rows[0];
  if (!row) throw new Error(`property ${id} not found`);
  return row;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0065_assistant_step_detail.sql'));
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'folders@example.test', 'Owner')`,
  );
  await owner.db
    .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Villas', 'hotel', ${user})`);
  await property(flat, 'A17', FLAT);
  await property(empty, 'B01', []);
  await property(foldered, 'C01', FOLDERS);
  await migrate(pg.ownerUrl);
});
afterAll(async () => {
  await owner?.close();
  await pg?.stop();
});

describe('migration 0066 lodging media folders', () => {
  it('turns a flat 12-photo gallery into one "Ảnh chung" folder, in order', async () => {
    const row = await stored(flat);
    expect(row.gallery_cover).toBe('');
    const folders = row.gallery as { id: string; name: string; items: unknown[] }[];
    expect(folders).toHaveLength(1);
    expect(folders[0]?.name).toBe('Ảnh chung');
    expect(folders[0]?.id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(folders[0]?.items).toEqual(
      FLAT.map((g) => ({ kind: 'image', url: g.url, caption: g.caption ?? '' })),
    );
  });

  it('keeps an empty gallery and a gallery that already has folders', async () => {
    expect((await stored(empty)).gallery).toEqual([]);
    expect((await stored(foldered)).gallery).toEqual(FOLDERS);
  });

  it('changes nothing when it runs again', async () => {
    const before = await Promise.all([flat, empty, foldered].map(stored));
    await owner.db.execute(
      sql`delete from schema_migrations where name = '0066_lodging_media_folders.sql'`,
    );
    const again = await migrate(pg.ownerUrl);
    expect(again.applied).toEqual(['0066_lodging_media_folders.sql']);
    expect(await Promise.all([flat, empty, foldered].map(stored))).toEqual(before);
  });
});

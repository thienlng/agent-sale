import { copyFile, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

/**
 * The hand-run reverse of migration 0066 (docs/runbooks/deploy-vps.md, "Rolling back T-192"):
 * folder galleries go back to the flat [{url, caption}] list the earlier release reads.
 */
const ROLLBACK_SQL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'sql',
  'rollback-0066-lodging-media-folders.sql',
);

let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
const user = newId();
const ws = newId();
const flat = newId();
const empty = newId();
const edited = newId();
const FLAT = Array.from({ length: 12 }, (_, i) =>
  i % 2 === 0
    ? { url: `https://cdn.example.com/a17/${i}.jpg`, caption: `Ảnh ${i}` }
    : { url: `https://cdn.example.com/a17/${i}.jpg` },
);
/** Folders an owner built after the release: two folders, with a video and a link. */
const FOLDERS = [
  {
    id: 'bedrooms',
    name: 'Phòng ngủ',
    items: [
      { kind: 'image', url: 'https://cdn.example.com/b/1.jpg', caption: 'Giường đôi' },
      { kind: 'video', url: 'https://cdn.example.com/b/tour.mp4', caption: 'Tour' },
      { kind: 'image', url: 'https://cdn.example.com/b/2.jpg', caption: '' },
    ],
  },
  { id: 'empty', name: 'Trống', items: [] },
  {
    id: 'pool',
    name: 'Hồ bơi',
    items: [
      { kind: 'link', url: 'https://drive.example.com/pool', caption: 'Drive' },
      { kind: 'image', url: 'https://cdn.example.com/p/1.jpg', caption: 'Hồ bơi' },
    ],
  },
];

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

async function gallery(id: string): Promise<unknown> {
  const rows = await owner.db.execute<{ gallery: unknown }>(
    sql`select gallery from lodging_properties where id = ${id}`,
  );
  return rows[0]?.gallery;
}

async function rollback(): Promise<void> {
  await owner.db.execute(sql.raw(await readFile(ROLLBACK_SQL, 'utf8')));
}

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0065_assistant_step_detail.sql'));
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'rollback@example.test', 'Owner')`,
  );
  await owner.db
    .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Villas', 'hotel', ${user})`);
  await property(flat, 'A17', FLAT);
  await property(empty, 'B01', []);
  await migrate(pg.ownerUrl);
  await property(edited, 'C01', FOLDERS);
});
afterAll(async () => {
  await owner?.close();
  await pg?.stop();
});

describe('rollback SQL for migration 0066', () => {
  it('gives a migrated flat gallery its original list back, in order', async () => {
    expect(((await gallery(flat)) as unknown[])[0]).toHaveProperty('items');
    await rollback();
    expect(await gallery(flat)).toEqual(
      FLAT.map((g) => ({ url: g.url, caption: g.caption ?? '' })),
    );
    expect(await gallery(empty)).toEqual([]);
  });

  it('keeps only images, in folder order then item order, with their captions', async () => {
    expect(await gallery(edited)).toEqual([
      { url: 'https://cdn.example.com/b/1.jpg', caption: 'Giường đôi' },
      { url: 'https://cdn.example.com/b/2.jpg', caption: '' },
      { url: 'https://cdn.example.com/p/1.jpg', caption: 'Hồ bơi' },
    ]);
  });

  it('changes nothing when it runs again', async () => {
    const before = await Promise.all([flat, empty, edited].map(gallery));
    await rollback();
    expect(await Promise.all([flat, empty, edited].map(gallery))).toEqual(before);
  });
});

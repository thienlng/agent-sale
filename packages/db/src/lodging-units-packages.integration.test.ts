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
 * Migration 0067 (T-193): unit details, `lodging_packages`, `package_id` on rates and booking
 * units; and its hand-run reverse (docs/runbooks/deploy-vps.md, "Rolling back T-193").
 */
const ROLLBACK_SQL = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'sql',
  'rollback-0067-lodging-units-packages.sql',
);

let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
const user = newId();
const ws = newId();
const villa = newId();
const whole = newId();
const bungalow = newId();
const booking = newId();

async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

async function rows<T extends Record<string, unknown>>(query: ReturnType<typeof sql>) {
  return (await owner.db.execute<T>(query)) as unknown as T[];
}

async function addPackage(id: string, unitId: string | null, name: string, bedrooms: number) {
  await owner.db.execute(sql`insert into lodging_packages
      (id, workspace_id, property_id, unit_id, name, bedrooms, standard_adults)
    values (${id}, ${ws}, ${villa}, ${unitId}, ${name}, ${bedrooms}, ${bedrooms * 2})`);
}

async function addRate(packageId: string | null, unitId: string | null = null): Promise<string> {
  const id = newId();
  await owner.db.execute(sql`insert into lodging_rates
      (id, workspace_id, property_id, unit_id, kind, weekdays, sell, cost, package_id)
    values (${id}, ${ws}, ${villa}, ${unitId}, 'weekday', '{1,2,3,4,5,6,7}', 1000, 800,
      ${packageId})`);
  return id;
}

async function columns(table: string): Promise<string[]> {
  const found = await rows<{ column_name: string }>(sql`select column_name
    from information_schema.columns where table_name = ${table} order by column_name`);
  return found.map((r) => r.column_name);
}

/** Postgres error code of a failed statement (unique_violation 23505, check_violation 23514). */
async function failure(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0066_lodging_media_folders.sql'));
  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'packages@example.test', 'Owner')`,
  );
  await owner.db
    .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Villas', 'hotel', ${user})`);
  await owner.db.execute(sql`insert into lodging_properties
      (id, workspace_id, code, name, sell_mode, standard_adults)
    values (${villa}, ${ws}, 'AURA', 'Aura Villa 6PN', 'whole', 12)`);
  await owner.db.execute(sql`insert into lodging_units
      (id, workspace_id, property_id, kind, name, capacity_adults)
    values (${whole}, ${ws}, ${villa}, 'whole', 'Nguyên căn', 12),
      (${bungalow}, ${ws}, ${villa}, 'room', 'Bungalow 1', 2)`);
  await owner.db.execute(sql`insert into lodging_bookings
      (id, workspace_id, property_id, code, kind, whole, status, check_in, check_out,
       client_request_id, fingerprint)
    values (${booking}, ${ws}, ${villa}, 'BK-0001', 'stay', true, 'confirmed', '2026-12-05',
      '2026-12-06', ${newId()}, 'fp')`);
  await owner.db.execute(sql`insert into lodging_booking_units (workspace_id, booking_id, unit_id)
    values (${ws}, ${booking}, ${whole})`);
  await migrate(pg.ownerUrl);
});
afterAll(async () => {
  await owner?.close();
  await pg?.stop();
});

describe('migration 0067 lodging units and packages', () => {
  it('gives existing units the new details with their defaults', async () => {
    const [unit] = await rows<Record<string, unknown>>(sql`select category, view, area_m2,
        description, amenities, max_guests, gallery, gallery_cover
      from lodging_units where id = ${bungalow}`);
    expect(unit).toEqual({
      category: 'room',
      view: '',
      area_m2: null,
      description: '',
      amenities: [],
      max_guests: null,
      gallery: [],
      gallery_cover: '',
    });
  });

  it('stores packages for the whole property and for one unit, with priced rates', async () => {
    const p6 = newId();
    const unitPackage = newId();
    await addPackage(p6, null, '6PN', 6);
    await addPackage(unitPackage, bungalow, '6PN', 1);
    const rate = await addRate(p6);
    await owner.db.execute(sql`update lodging_booking_units set package_id = ${p6}
      where booking_id = ${booking}`);
    const [stored] = await rows<{ package_id: string; standard_children: number }>(sql`
      select r.package_id, p.standard_children from lodging_rates r
      join lodging_packages p on p.id = r.package_id where r.id = ${rate}`);
    expect(stored).toEqual({ package_id: p6, standard_children: 0 });
  });

  it('keeps package names unique per target, case-insensitively', async () => {
    expect(await failure(() => addPackage(newId(), null, '6pn', 5))).toBe('23505');
    expect(await failure(() => addPackage(newId(), bungalow, '6Pn', 2))).toBe('23505');
    await addPackage(newId(), null, '5PN', 5);
  });

  it('checks the package ranges and the unit detail ranges', async () => {
    expect(await failure(() => addPackage(newId(), null, '0PN', 0))).toBe('23514');
    expect(await failure(() => addPackage(newId(), null, 'x'.repeat(51), 3))).toBe('23514');
    expect(
      await failure(() =>
        owner.db.execute(sql`update lodging_units set category = 'tent' where id = ${bungalow}`),
      ),
    ).toBe('23514');
    expect(
      await failure(() =>
        owner.db.execute(sql`update lodging_units set area_m2 = 0 where id = ${bungalow}`),
      ),
    ).toBe('23514');
  });

  it('keeps the booking and clears its package when the package is deleted', async () => {
    const p4 = newId();
    await addPackage(p4, null, '4PN', 4);
    const rate = await addRate(p4);
    await owner.db.execute(sql`update lodging_booking_units set package_id = ${p4}
      where booking_id = ${booking}`);
    await owner.db.execute(sql`delete from lodging_packages where id = ${p4}`);
    expect(await rows(sql`select 1 from lodging_rates where id = ${rate}`)).toHaveLength(0);
    const [unit] = await rows<{ package_id: string | null; workspace_id: string }>(sql`
      select package_id, workspace_id from lodging_booking_units where booking_id = ${booking}`);
    expect(unit).toEqual({ package_id: null, workspace_id: ws });
  });

  it('deletes the packages of a unit, and their rates, with the unit', async () => {
    const unit = newId();
    const pkg = newId();
    await owner.db.execute(sql`insert into lodging_units
        (id, workspace_id, property_id, kind, name, capacity_adults)
      values (${unit}, ${ws}, ${villa}, 'room', 'Bungalow 2', 2)`);
    await addPackage(pkg, unit, '2PN', 2);
    const rate = await addRate(pkg, unit);
    await owner.db.execute(sql`delete from lodging_units where id = ${unit}`);
    expect(await rows(sql`select 1 from lodging_packages where id = ${pkg}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from lodging_rates where id = ${rate}`)).toHaveLength(0);
  });

  it('can run again without changing the stored rows', async () => {
    const before = await rows(sql`select * from lodging_packages order by id`);
    await owner.db.execute(
      sql`delete from schema_migrations where name = '0067_lodging_units_packages.sql'`,
    );
    expect((await migrate(pg.ownerUrl)).applied).toEqual(['0067_lodging_units_packages.sql']);
    expect(await rows(sql`select * from lodging_packages order by id`)).toEqual(before);
  });

  it('gives bot hold drafts an empty package list by default', async () => {
    const [col] = await rows<{ column_default: string; is_nullable: string }>(sql`
      select column_default, is_nullable from information_schema.columns
      where table_name = 'lodging_bot_hold_drafts' and column_name = 'package_ids'`);
    expect(col).toEqual({ column_default: "'{}'::uuid[]", is_nullable: 'NO' });
  });

  it('forces tenant row-level security on lodging_packages', async () => {
    const [table] = await rows<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'lodging_packages'`);
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe('rollback SQL for migration 0067', () => {
  it('drops the package table and the new columns, and can run again', async () => {
    const rollback = async () => owner.db.execute(sql.raw(await readFile(ROLLBACK_SQL, 'utf8')));
    const [p5] = await rows<{ id: string }>(sql`select id from lodging_packages
      where property_id = ${villa} and unit_id is null and name = '5PN'`);
    const fullRates = await rows<{ id: string }>(sql`select r.id from lodging_rates r
      join lodging_packages p on p.id = r.package_id where p.unit_id is null and p.name = '6PN'`);
    const smaller = await addRate(p5?.id ?? null);
    await rollback();
    expect(fullRates.length).toBeGreaterThan(0);
    const kept = await rows<{ id: string }>(sql`select id from lodging_rates`);
    expect(kept.map((r) => r.id).sort()).toEqual(fullRates.map((r) => r.id).sort());
    expect(kept.map((r) => r.id)).not.toContain(smaller);
    expect(await rows(sql`select to_regclass('lodging_packages') as t`)).toEqual([{ t: null }]);
    expect(await columns('lodging_rates')).not.toContain('package_id');
    expect(await columns('lodging_booking_units')).not.toContain('package_id');
    expect(await columns('lodging_bot_hold_drafts')).not.toContain('package_ids');
    const unitColumns = await columns('lodging_units');
    for (const c of [
      'category',
      'view',
      'area_m2',
      'description',
      'amenities',
      'max_guests',
      'gallery',
      'gallery_cover',
    ])
      expect(unitColumns).not.toContain(c);
    expect(
      await rows(sql`select 1 from lodging_booking_units where booking_id = ${booking}`),
    ).toHaveLength(1);
    await rollback();
  });
});

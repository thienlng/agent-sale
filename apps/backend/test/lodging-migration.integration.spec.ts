import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  sql,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * T-160 migration 0041: `lodging_copy_accommodations()` turns every product carrying
 * `accommodation` (T-155) into a lodging property with one whole unit, weekday rates, bot
 * links and its confirmed stay requests as bookings. Runs as the migration owner.
 */
let pg: TestPostgres;
let owner: { db: Database; close: () => Promise<void> };
let tenant: { db: Database; close: () => Promise<void> };

const user = newId();
const ws = newId();
const otherWs = newId();
const a17 = newId();
const plain = newId();
const retail = newId();
const allBot = newId();
const selectedBot = newId();
const unrelatedBot = newId();
const deletedBot = newId();
const confirmedStay = newId();

const rows = async <T>(q: ReturnType<typeof sql>) => (await owner.db.execute(q)) as unknown as T[];
const copy = async () =>
  (await rows<{ n: number }>(sql`select lodging_copy_accommodations() as n`))[0]!.n;

const A17_NAME = 'SKY VILLA A17 – Villa nguyên căn view sân golf Tam Đảo';
const accommodation = {
  rentalType: 'entire_property',
  bedrooms: 8,
  standardAdults: 24,
  standardChildren: 8,
  childAgeBelow: 6,
  maxGuests: null,
  rateBasis: 'unconfirmed',
  rates: [
    { days: [1, 2, 3, 4], amount: 12_000_000 },
    { days: [5, 7], amount: 13_000_000 },
    { days: [6], amount: 14_000_000 },
  ],
  roomLayout: Array.from({ length: 8 }, (_, i) => ({
    name: `Phòng ${i + 1}`,
    beds: i < 4 ? '1 giường đôi' : '2 giường đơn',
  })),
  amenities: [
    'Bể bơi riêng',
    'BBQ',
    'Karaoke',
    'Bida',
    'Wifi',
    'Bếp',
    'Bãi đỗ xe',
    'View sân golf',
    'Điều hoà',
  ],
  checkInOut: '',
  depositPolicy: '',
  cancellationPolicy: '',
  extraGuestPolicy: '',
  holidayPolicy: '',
  notes: 'Villa nguyên căn, phù hợp nhóm lớn.',
  gallery: Array.from({ length: 12 }, (_, i) =>
    i % 2 === 0
      ? { url: `https://media.rapiz.test/a17/${i}.jpg`, caption: `Ảnh ${i}` }
      : { url: `https://media.rapiz.test/a17/${i}.jpg` },
  ),
};

async function product(id: string, workspace: string, name: string, acc: object | null) {
  await owner.db.execute(sql`insert into products
      (id, workspace_id, code, name, description, accommodation, search_text)
    values (${id}, ${workspace}, ${'C-' + id.slice(-6)}, ${name}, 'Mô tả villa',
      ${acc === null ? null : JSON.stringify(acc)}::jsonb, '')`);
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 1 });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });

  await owner.db.execute(
    sql`insert into users (id, email, name) values (${user}, 'villa@example.test', 'Owner')`,
  );
  for (const w of [ws, otherWs])
    await owner.db
      .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
      values (${w}, ${w}, 'Villas', 'hotel', ${user})`);

  await product(a17, ws, A17_NAME, accommodation);
  await product(plain, ws, 'Homestay Rừng Thông', {
    ...accommodation,
    standardAdults: 4,
    standardChildren: 0,
    maxGuests: 6,
    checkInOut: '14:00 / 12:00',
    extraGuestPolicy: 'Phụ thu 300k/người',
    holidayPolicy: 'Lễ +20%',
    rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 2_000_000 }],
  });
  await product(retail, ws, 'Áo thun', null);

  await owner.db
    .execute(sql`insert into bots (id, workspace_id, name, industry, catalog_mode, settings, deleted_at)
    values
      (${allBot}, ${ws}, 'All', 'hotel', 'all', '{}'::jsonb, null),
      (${selectedBot}, ${ws}, 'Selected', 'hotel', 'selected', '{}'::jsonb, null),
      (${unrelatedBot}, ${ws}, 'Unrelated', 'hotel', 'selected', '{}'::jsonb, null),
      (${deletedBot}, ${ws}, 'Deleted', 'hotel', 'all', '{}'::jsonb, now())`);
  await owner.db.execute(sql`insert into bot_products (workspace_id, bot_id, product_id)
    values (${ws}, ${selectedBot}, ${a17})`);

  const party = JSON.stringify({ adults: 20, children: 2, childAges: [4, 9] });
  await owner.db.execute(sql`insert into stay_requests
      (id, workspace_id, property_id, property_name, client_request_id, fingerprint, guest_name,
       guest_phone, check_in, check_out, party, quote, status, agreed_total, note)
    values
      (${confirmedStay}, ${ws}, ${a17}, ${A17_NAME}, ${newId()}, 'fp-1', 'Khách A', '0900000001',
       '2027-01-08', '2027-01-10', ${party}::jsonb, '{}'::jsonb, 'confirmed', 26000000, 'Cọc 50%'),
      (${newId()}, ${ws}, ${a17}, ${A17_NAME}, ${newId()}, 'fp-2', 'Khách B', '0900000002',
       '2027-01-08', '2027-01-09', ${party}::jsonb, '{}'::jsonb, 'requested', null, '')`);
});
afterAll(async () => {
  await tenant?.close();
  await owner?.close();
  await pg?.stop();
});

describe('migration 0041 lodging copy', () => {
  it('copies the A17 villa into a property, a whole unit, weekday rates and bot links', async () => {
    expect(await copy()).toBe(2);

    const [p] = await rows<Record<string, unknown>>(
      sql`select * from lodging_properties where source_product_id = ${a17}`,
    );
    expect(p).toMatchObject({
      workspace_id: ws,
      code: 'A17',
      name: 'SKY VILLA A17',
      area: 'Sân golf Tam Đảo',
      description: 'Mô tả villa',
      sell_mode: 'whole',
      status: 'active',
      standard_adults: 24,
      standard_children: 8,
      max_guests: null,
      child_free_below: 6,
      child_adult_from: 12,
      policies: { checkInTime: '', deposit: '', cancellation: '', other: '' },
    });
    expect(p!.amenities).toHaveLength(9);
    const layout = p!.layout as { name: string; beds: string; note: string }[];
    expect(layout).toHaveLength(8);
    expect(layout[0]).toEqual({ name: 'Phòng 1', beds: '1 giường đôi', note: '' });
    const gallery = p!.gallery as { url: string; caption?: string }[];
    expect(gallery).toHaveLength(12);
    expect(gallery[0]).toEqual({ url: 'https://media.rapiz.test/a17/0.jpg', caption: 'Ảnh 0' });

    const units = await rows<Record<string, unknown>>(
      sql`select * from lodging_units where property_id = ${p!.id as string}`,
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      kind: 'whole',
      name: 'SKY VILLA A17',
      capacity_adults: 24,
      capacity_children: 8,
      active: true,
    });

    const rates = await rows<{
      kind: string;
      weekdays: number[];
      sell: string;
      cost: string;
      unit_id: string | null;
    }>(
      sql`select kind, weekdays, sell::text, cost::text, unit_id from lodging_rates
          where property_id = ${p!.id as string} order by sell`,
    );
    expect(rates.map((r) => [r.kind, r.weekdays, r.sell, r.cost, r.unit_id])).toEqual([
      ['weekday', [1, 2, 3, 4], '12000000', '12000000', null],
      ['weekday', [5, 7], '13000000', '13000000', null],
      ['weekday', [6], '14000000', '14000000', null],
    ]);
    expect(rates.flatMap((r) => r.weekdays).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const bots = await rows<{ bot_id: string }>(
      sql`select bot_id from lodging_bot_properties where property_id = ${p!.id as string}`,
    );
    expect(bots.map((b) => b.bot_id).sort()).toEqual([allBot, selectedBot].sort());
  });

  it('derives a code, policies and the name for products without A17 or a dash', async () => {
    const [p] = await rows<Record<string, unknown>>(
      sql`select * from lodging_properties where source_product_id = ${plain}`,
    );
    expect(p!.code).toBe('P' + plain.replaceAll('-', '').slice(-6).toUpperCase());
    expect(p).toMatchObject({
      name: 'Homestay Rừng Thông',
      area: '',
      max_guests: 6,
      standard_adults: 4,
      policies: {
        checkInTime: '14:00 / 12:00',
        deposit: '',
        cancellation: '',
        other: 'Phụ thu 300k/người Lễ +20%',
      },
    });
    const [none] = await rows<{ n: number }>(
      sql`select count(*)::int as n from lodging_properties where source_product_id = ${retail}`,
    );
    expect(none!.n).toBe(0);
  });

  it('copies confirmed stay requests as confirmed bookings holding their nights', async () => {
    const bookings = await rows<Record<string, unknown>>(
      sql`select b.*, p.code as property_code from lodging_bookings b
          join lodging_properties p on p.id = b.property_id where b.workspace_id = ${ws}`,
    );
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      id: confirmedStay,
      code: 'BK-0001',
      property_code: 'A17',
      kind: 'stay',
      whole: true,
      status: 'confirmed',
      check_in: '2027-01-08',
      check_out: '2027-01-10',
      adults: 20,
      child_ages: [4, 9],
      guest_name: 'Khách A',
      guest_phone: '0900000001',
      note: 'Cọc 50%',
      total_sell: '26000000',
      total_cost: '26000000',
    });
    const nights = await rows<{ night: string }>(
      sql`select night::text from lodging_unit_nights where booking_id = ${confirmedStay} order by night`,
    );
    expect(nights.map((n) => n.night)).toEqual(['2027-01-08', '2027-01-09']);
    const [units] = await rows<{ n: number }>(
      sql`select count(*)::int as n from lodging_booking_units where booking_id = ${confirmedStay}`,
    );
    expect(units!.n).toBe(1);
    const [settings] = await rows<{ booking_seq: number }>(
      sql`select booking_seq from lodging_settings where workspace_id = ${ws}`,
    );
    expect(settings!.booking_seq).toBe(1);
  });

  it('matches the Drizzle schema column for column', async () => {
    const tables = [
      schema.lodgingProperties,
      schema.lodgingUnits,
      schema.lodgingRates,
      schema.lodgingSettings,
      schema.lodgingBookings,
      schema.lodgingBookingUnits,
      schema.lodgingUnitNights,
      schema.lodgingBotProperties,
    ];
    for (const table of tables) await owner.db.select().from(table).limit(1);
    const [booking] = await owner.db
      .select()
      .from(schema.lodgingBookings)
      .where(eq(schema.lodgingBookings.id, confirmedStay));
    expect(booking).toMatchObject({
      checkIn: '2027-01-08',
      childAges: [4, 9],
      totalSell: 26000000,
    });
  });

  it('is idempotent', async () => {
    const count = async () =>
      (
        await rows<{ p: number; r: number; b: number }>(sql`select
          (select count(*)::int from lodging_properties) as p,
          (select count(*)::int from lodging_rates) as r,
          (select count(*)::int from lodging_bookings) as b`)
      )[0];
    const before = await count();
    expect(await copy()).toBe(0);
    expect(await count()).toEqual(before);
  });

  it('isolates the new tables per workspace and keeps the copy function away from app_tenant', async () => {
    const visible = (w: string) =>
      tenant.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.workspace_id', ${w}, true)`);
        return (await tx.execute(
          sql`select (select count(*)::int from lodging_properties) as p,
                     (select count(*)::int from lodging_unit_nights) as n`,
        )) as unknown as { p: number; n: number }[];
      });
    expect((await visible(ws))[0]).toEqual({ p: 2, n: 2 });
    expect((await visible(otherWs))[0]).toEqual({ p: 0, n: 0 });
    await expect(
      tenant.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.workspace_id', ${ws}, true)`);
        await tx.execute(sql`select lodging_copy_accommodations()`);
      }),
    ).rejects.toThrow();
  });

  it('skips a confirmed stay whose nights collide with an already copied one', async () => {
    // Legacy rows are guarded by stay_requests_no_confirmed_overlap; drop it inside a
    // rolled-back transaction to simulate overlapping data reaching the copy.
    const villa = newId();
    const first = newId();
    const second = newId();
    let seen: unknown;
    await owner.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`alter table stay_requests drop constraint stay_requests_no_confirmed_overlap`,
        );
        await tx.execute(sql`insert into products
            (id, workspace_id, code, name, description, accommodation, search_text)
          values (${villa}, ${ws}, 'C-OVL', 'Villa chồng lịch', '',
            ${JSON.stringify(accommodation)}::jsonb, '')`);
        await tx.execute(sql`insert into stay_requests
            (id, workspace_id, property_id, property_name, client_request_id, fingerprint,
             guest_name, guest_phone, check_in, check_out, party, quote, status, agreed_total,
             note, created_at)
          values
            (${first}, ${ws}, ${villa}, 'Villa', ${newId()}, 'fp-a', 'A', '', '2027-03-01',
             '2027-03-03', '{"adults":2}'::jsonb, '{}'::jsonb, 'confirmed', 1, '',
             now() - interval '1 hour'),
            (${second}, ${ws}, ${villa}, 'Villa', ${newId()}, 'fp-b', 'B', '', '2027-03-02',
             '2027-03-04', '{"adults":2}'::jsonb, '{}'::jsonb, 'confirmed', 1, '', now())`);
        const [n] = (await tx.execute(
          sql`select lodging_copy_accommodations() as n`,
        )) as unknown as { n: number }[];
        seen = {
          copied: n!.n,
          bookings: (
            (await tx.execute(
              sql`select id from lodging_bookings where id in (${first}, ${second})`,
            )) as unknown as { id: string }[]
          ).map((r) => r.id),
          nights: (
            (await tx.execute(
              sql`select night::text from lodging_unit_nights where booking_id = ${first}
                  order by night`,
            )) as unknown as { night: string }[]
          ).map((r) => r.night),
          seq: (
            (await tx.execute(
              sql`select booking_seq from lodging_settings where workspace_id = ${ws}`,
            )) as unknown as { booking_seq: number }[]
          )[0]!.booking_seq,
        };
        tx.rollback();
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error && e.message === 'Rollback')) throw e;
      });
    expect(seen).toEqual({
      copied: 1,
      bookings: [first],
      nights: ['2027-03-01', '2027-03-02'],
      seq: 2,
    });
  });
});

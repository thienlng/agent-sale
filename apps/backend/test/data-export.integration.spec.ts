import {
  CreatedInvitation,
  DataExportDto,
  DataExportLink,
  DataExportList,
} from '@agent-sales/contracts';
import { and, eq, schema } from '@agent-sales/db';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATAEXPORT_RUNNER, type DataExportRunner } from '../src/modules/dataexport/api/index.js';
import {
  EXPORT_FILE_STORAGE,
  type ExportFileStorage,
} from '../src/modules/dataexport/application/ports/export-files.js';
import { type Harness, startHarness, type TestUser } from './support/harness.js';

/**
 * Whole-workspace data export over HTTP on Postgres (SET-10): permission, one at a time, worker
 * build with every module's real SQL, tenant isolation of the archive, one-time link, audit,
 * notification, daily limit and expiry. Object storage is an in-memory stand-in.
 */
let h: Harness;
let runner: DataExportRunner;
const objects = new Map<string, Buffer>();

beforeAll(async () => {
  h = await startHarness();
  runner = h.app.get<DataExportRunner>(DATAEXPORT_RUNNER);
  const files = h.app.get<ExportFileStorage>(EXPORT_FILE_STORAGE);
  const { readFile } = await import('node:fs/promises');
  Object.assign(files, {
    available: () => true,
    upload: async (key: string, path: string) => void objects.set(key, await readFile(path)),
    open: async (key: string) => {
      const data = objects.get(key);
      if (!data) throw new Error('missing');
      return {
        sizeBytes: data.length,
        body: (async function* () {
          yield new Uint8Array(data);
        })(),
      };
    },
    remove: async (key: string) => void objects.delete(key),
    readMedia: async () => null,
  } satisfies Partial<ExportFileStorage>);
});

afterAll(async () => {
  await h?.stop();
});

async function contact(u: TestUser, name: string, phone: string) {
  const r = await h.call(u.h, 'POST', '/contacts', { name, phone });
  expect(r.statusCode, r.body).toBe(201);
}

async function invite(o: TestUser, invitee: TestUser, role: string) {
  await h.owner.db
    .insert(schema.workspaceEntitlementOverrides)
    .values({ workspaceId: o.ownWorkspace, key: 'members.max', value: 50, reason: 'test' })
    .onConflictDoNothing();
  const inv = await h.call(o.h, 'POST', '/invitations', { email: invitee.email, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const { token } = CreatedInvitation.parse(inv.json());
  const ok = await h.call(invitee.auth, 'POST', '/invitation-links/accept', { token });
  expect(ok.statusCode, ok.body).toBe(200);
}

async function download(url: string) {
  return h.app.getHttpAdapter().getInstance().inject({ method: 'GET', url });
}

describe('data export', () => {
  it('builds a ZIP of the workspace only, served once through a one-time link', async () => {
    const lan = await h.user('lan@export.vn', 'Lan');
    const other = await h.user('other@export.vn', 'Other');
    await contact(lan, 'Khách Lan, Hà Nội', '0912345678');
    await contact(lan, '=HYPERLINK("x")', '0987654321');
    await contact(other, 'Khách của shop khác', '0900000000');

    const empty = DataExportList.parse((await h.call(lan.h, 'GET', '/data-exports')).json());
    expect(empty).toEqual({ data: [], usedToday: 0, dailyLimit: 3 });

    const created = await h.call(lan.h, 'POST', '/data-exports', { includeMedia: true });
    expect(created.statusCode, created.body).toBe(201);
    const exp = DataExportDto.parse(created.json());
    expect(exp.status).toBe('queued');
    expect((await h.call(lan.h, 'POST', '/data-exports', {})).statusCode).toBe(409);
    expect((await h.call(lan.h, 'POST', `/data-exports/${exp.id}/link`)).statusCode).toBe(409);

    expect(await runner.tick()).toBe(1);
    const ready = DataExportList.parse((await h.call(lan.h, 'GET', '/data-exports')).json());
    expect(ready.data[0]).toMatchObject({ id: exp.id, status: 'ready', errorCode: null });
    expect(ready.data[0]!.sizeBytes).toBeGreaterThan(0);

    // Another business cannot get a link to it.
    expect((await h.call(other.h, 'POST', `/data-exports/${exp.id}/link`)).statusCode).toBe(404);

    const link = DataExportLink.parse(
      (await h.call(lan.h, 'POST', `/data-exports/${exp.id}/link`)).json(),
    );
    const res = await download(link.url);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(String(res.headers['content-disposition'])).toMatch(
      /^attachment; filename="rapiz-shop-lan-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzipSync(new Uint8Array(res.rawPayload));
    const names = Object.keys(files);
    for (const f of [
      'README.txt',
      'business.csv',
      'members.csv',
      'people.csv',
      'customers.csv',
      'customer_notes.csv',
      'customer_history.csv',
      'customer_tags.csv',
      'conversations.csv',
      'messages.csv',
      'products.csv',
      'product_variants.csv',
      'orders.csv',
      'order_items.csv',
      'knowledge_items.csv',
      'training_items.csv',
      'lodging_properties.csv',
      'lodging_units.csv',
      'lodging_bookings.csv',
      'bots.csv',
      'saas_subscriptions.csv',
    ])
      expect(names, f).toContain(f);
    const text = (f: string) => strFromU8(files[f]!).replace(/^\uFEFF/, '');
    const customers = text('customers.csv');
    expect(customers).toContain('"Khách Lan, Hà Nội"');
    expect(customers).toContain(`"'=HYPERLINK(""x"")"`);
    expect(customers).not.toContain('shop khác');
    expect(text('people.csv')).toContain('lan@export.vn');
    expect(text('people.csv')).not.toContain('other@export.vn');
    expect(text('business.csv')).toContain('Shop Lan');
    expect(text('README.txt')).toContain('customers.csv');

    // One use only.
    expect((await download(link.url)).statusCode).toBe(404);
    expect((await download('/api/v1/data-exports/download/not-a-token')).statusCode).toBe(404);

    const audit = await h.owner.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, lan.ownWorkspace));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['workspace.data_exported', 'workspace.data_export_downloaded']),
    );
    const notes = await h.owner.db
      .select({ type: schema.notifications.type })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, lan.userId),
          eq(schema.notifications.type, 'dataexport.ready'),
        ),
      );
    expect(notes).toHaveLength(1);
  });

  it('is for owners and admins only', async () => {
    const boss = await h.user('boss@export.vn', 'Boss');
    const seller = await h.user('seller@export.vn', 'Seller');
    await invite(boss, seller, 'sales');
    const as = seller.in(boss.ownWorkspace);
    expect((await h.call(as, 'GET', '/data-exports')).statusCode).toBe(403);
    expect((await h.call(as, 'POST', '/data-exports', {})).statusCode).toBe(403);
  });

  it('allows 3 exports a day and expires files after their date', async () => {
    const mai = await h.user('mai@export.vn', 'Mai');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await h.call(mai.h, 'POST', '/data-exports', {});
      expect(r.statusCode, r.body).toBe(201);
      ids.push(DataExportDto.parse(r.json()).id);
      expect(await runner.tick()).toBe(1);
    }
    expect((await h.call(mai.h, 'POST', '/data-exports', {})).statusCode).toBe(429);

    const [row] = await h.owner.db
      .select({ key: schema.dataExports.objectKey })
      .from(schema.dataExports)
      .where(eq(schema.dataExports.id, ids[0]!));
    expect(objects.has(row!.key!)).toBe(true);
    await h.owner.db
      .update(schema.dataExports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.dataExports.id, ids[0]!));
    await runner.tick();
    expect(objects.has(row!.key!)).toBe(false);
    const list = DataExportList.parse((await h.call(mai.h, 'GET', '/data-exports')).json());
    expect(list.data.find((x) => x.id === ids[0])?.status).toBe('expired');
    expect((await h.call(mai.h, 'POST', `/data-exports/${ids[0]}/link`)).statusCode).toBe(409);
  });
});

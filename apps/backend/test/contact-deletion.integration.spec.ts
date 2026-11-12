import {
  AuthResponse,
  BootstrapResponse,
  ContactDeletionResult,
  ContactDto,
  ContactNoteDto,
  DELETED_CUSTOMER_NAME,
  OrderDto,
  ProductDto,
  WarehouseDto,
} from '@agent-sales/contracts';
import {
  and,
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
} from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { signUpVerified } from './support/signup.js';

/** Deleting a customer on request (docs/09 §10, CRM-17) across crm, inbox, orders and stays. */
let pg: TestPostgres;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const call = (h: Headers, method: string, url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: h,
      ...(payload ? { payload } : {}),
    });

let signups = 0;
async function shop(email: string) {
  const signup = await signUpVerified(
    app,
    {
      name: 'Chủ shop',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop',
      industry: 'fashion',
    },
    { remoteAddress: `10.7.0.${++signups}` },
  );
  const { accessToken } = AuthResponse.parse(signup.json());
  const authorization = `Bearer ${accessToken}`;
  const boot = BootstrapResponse.parse((await call({ authorization }, 'GET', '/bootstrap')).json());
  const workspaceId = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: boot.user.id,
    workspaceId,
    h: { authorization, 'x-workspace-id': workspaceId } as Headers,
    in: (ws: string): Headers => ({ authorization, 'x-workspace-id': ws }),
  };
}

async function member(workspaceId: string, userId: string, role: string) {
  await owner.db
    .insert(schema.members)
    .values({ id: crypto.randomUUID(), workspaceId, userId, role, status: 'active' });
}

async function createContact(h: Headers, body: object) {
  const r = await call(h, 'POST', '/contacts', body);
  expect(r.statusCode, r.body).toBe(201);
  return ContactDto.parse(r.json());
}

/** A Facebook conversation of the customer with two messages, a Brain signal and a raw event. */
async function conversationOf(ws: string, contactId: string | null, psid: string) {
  const channelId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  await owner.db.insert(schema.channelConnections).values({
    id: channelId,
    workspaceId: ws,
    provider: 'facebook',
    externalId: `page-${channelId}`,
    name: 'Page',
    tokenSealed: 'sealed',
  });
  const now = new Date().toISOString();
  await owner.db.insert(schema.conversations).values({
    id: conversationId,
    workspaceId: ws,
    channelId,
    customerId: psid,
    contactId,
    data: {
      id: conversationId,
      channelId,
      provider: 'facebook',
      customerId: psid,
      customerName: 'Lan',
      mode: 'bot',
      status: 'open',
      assigneeId: null,
      note: '',
      revision: 1,
      lastMessage: 'số em 0912345678',
      lastInboundAt: now,
      updatedAt: now,
    },
  });
  for (const [i, text] of ['chào shop', 'số em 0912345678'].entries())
    await owner.db.insert(schema.conversationMessages).values({
      id: crypto.randomUUID(),
      workspaceId: ws,
      conversationId,
      idempotencyKey: `m${i}`,
      data: { text, attachments: [] },
    });
  await owner.db.insert(schema.conversationSignals).values({
    workspaceId: ws,
    conversationId,
    contactId,
    note: 'Khách hỏi giá',
  });
  await owner.db.insert(schema.channelWebhookEvents).values({
    id: crypto.randomUUID(),
    workspaceId: ws,
    connectionId: channelId,
    externalId: `ev-${conversationId}`,
    payload: { senderExternalId: psid, text: 'số em 0912345678' },
    processedAt: new Date(),
  });
  return { channelId, conversationId };
}

async function orderFor(h: Headers, customerPhone: string, recipient: object) {
  const warehouse = WarehouseDto.parse(
    (await call(h, 'POST', '/warehouses', { name: `Kho ${crypto.randomUUID()}` })).json(),
  );
  const product = ProductDto.parse(
    (
      await call(h, 'POST', '/products', {
        code: `SP${Math.floor(Math.random() * 1e6)}`,
        name: 'Áo thun',
        variants: [{ sku: `SKU${Math.floor(Math.random() * 1e6)}`, name: 'L', price: 150_000 }],
      })
    ).json(),
  );
  const variant = product.variants[0];
  await call(h, 'POST', `/products/${product.id}/stock`, {
    variantId: variant?.id,
    warehouseId: warehouse.id,
    onHand: 10,
  });
  const r = await call(h, 'POST', '/orders', {
    source: 'facebook',
    warehouseId: warehouse.id,
    customer: { name: 'Nguyễn Thị Lan', phone: customerPhone, email: 'lan@example.vn' },
    recipient,
    items: [{ variantId: variant?.id, qty: 1 }],
  });
  expect(r.statusCode, r.body).toBe(201);
  return OrderDto.parse(r.json());
}

describe('DELETE /contacts/{id}', () => {
  it('erases the customer and its conversations, anonymizes orders and stays, audits', async () => {
    const a = await shop('delete-owner@shop.vn');
    const lan = await createContact(a.h, { name: 'Nguyễn Thị Lan', phone: '0912 345 678' });
    const other = await createContact(a.h, { name: 'Trần Văn Bình', phone: '0987654321' });
    const note = ContactNoteDto.parse(
      (await call(a.h, 'POST', `/contacts/${lan.id}/notes`, { body: 'Dị ứng hải sản' })).json(),
    );
    expect(note.authorUserId).toBe(a.userId);
    const mine = await conversationOf(a.workspaceId, lan.id, 'psid-lan');
    const theirs = await conversationOf(a.workspaceId, other.id, 'psid-binh');
    // A customer-less task of her conversation and a task of hers.
    for (const t of [
      { title: 'Gọi lại', contactId: lan.id },
      { title: 'Theo dõi', conversationId: mine.conversationId },
    ])
      expect((await call(a.h, 'POST', '/tasks', t)).statusCode).toBe(201);
    const own = await orderFor(a.h, '+84912345678', {
      name: 'Nguyễn Thị Lan',
      phone: '0912345678',
      address: '1 Lê Lợi',
    });
    const gift = await orderFor(a.h, '0912345678', {
      name: 'Bạn Hoa',
      phone: '0909000111',
      address: '9 Pasteur',
    });
    const unrelated = await orderFor(a.h, '0987654321', {
      name: 'Trần Văn Bình',
      phone: '0987654321',
      address: '2 Hai Bà Trưng',
    });
    // A stay booking linked to her (bookings are lodging's; a hotel is not needed at this level).
    const propertyId = crypto.randomUUID();
    await owner.db.insert(schema.lodgingProperties).values({
      id: propertyId,
      workspaceId: a.workspaceId,
      code: 'V1',
      name: 'Villa',
      sellMode: 'whole',
      standardAdults: 2,
    });
    const bookingId = crypto.randomUUID();
    await owner.db.insert(schema.lodgingBookings).values({
      id: bookingId,
      workspaceId: a.workspaceId,
      propertyId,
      code: 'B1',
      kind: 'stay',
      whole: true,
      status: 'confirmed',
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      guestName: 'Nguyễn Thị Lan',
      guestPhone: '0912 345 678',
      contactId: lan.id,
      clientRequestId: crypto.randomUUID(),
      fingerprint: 'f',
    });

    const r = await call(a.h, 'DELETE', `/contacts/${lan.id}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(ContactDeletionResult.parse(r.json())).toEqual({
      contactId: lan.id,
      conversations: 1,
      messages: 2,
      files: 0,
      orders: 2,
      bookings: 1,
    });

    // Gone: the customer, its notes and history, its conversation and everything hanging off it.
    expect((await call(a.h, 'GET', `/contacts/${lan.id}`)).statusCode).toBe(404);
    const by = <T>(rows: Promise<T[]>) => rows.then((x) => x.length);
    expect(
      await by(
        owner.db
          .select()
          .from(schema.contactNotes)
          .where(eq(schema.contactNotes.contactId, lan.id)),
      ),
    ).toBe(0);
    expect(
      await by(
        owner.db
          .select()
          .from(schema.contactHistory)
          .where(eq(schema.contactHistory.contactId, lan.id)),
      ),
    ).toBe(0);
    for (const t of [schema.conversations]) {
      expect(await by(owner.db.select().from(t).where(eq(t.id, mine.conversationId)))).toBe(0);
      expect(await by(owner.db.select().from(t).where(eq(t.id, theirs.conversationId)))).toBe(1);
    }
    expect(
      await by(
        owner.db
          .select()
          .from(schema.conversationMessages)
          .where(eq(schema.conversationMessages.conversationId, mine.conversationId)),
      ),
    ).toBe(0);
    expect(
      await by(
        owner.db
          .select()
          .from(schema.conversationSignals)
          .where(eq(schema.conversationSignals.conversationId, mine.conversationId)),
      ),
    ).toBe(0);
    expect(
      await by(
        owner.db
          .select()
          .from(schema.channelWebhookEvents)
          .where(eq(schema.channelWebhookEvents.connectionId, mine.channelId)),
      ),
    ).toBe(0);
    expect(
      await by(
        owner.db
          .select()
          .from(schema.channelWebhookEvents)
          .where(eq(schema.channelWebhookEvents.connectionId, theirs.channelId)),
      ),
    ).toBe(1);
    expect(
      await by(
        owner.db.select().from(schema.tasks).where(eq(schema.tasks.workspaceId, a.workspaceId)),
      ),
    ).toBe(0);

    // Kept, anonymized: her order (recipient too), the gift's buyer but not its recipient.
    const read = async (id: string) =>
      OrderDto.parse((await call(a.h, 'GET', `/orders/${id}`)).json());
    expect((await read(own.id)).customer).toEqual({ name: DELETED_CUSTOMER_NAME });
    expect((await read(own.id)).recipient).toEqual({ name: DELETED_CUSTOMER_NAME });
    expect((await read(gift.id)).customer).toEqual({ name: DELETED_CUSTOMER_NAME });
    expect((await read(gift.id)).recipient).toMatchObject({ name: 'Bạn Hoa', phone: '0909000111' });
    expect((await read(unrelated.id)).customer).toMatchObject({ name: 'Nguyễn Thị Lan' });
    // Her phone no longer finds anything in the order search.
    const search = await call(a.h, 'GET', '/orders?q=0912345678');
    expect(search.json()).toMatchObject({ total: 0 });
    const [booking] = await owner.db
      .select()
      .from(schema.lodgingBookings)
      .where(eq(schema.lodgingBookings.id, bookingId));
    expect(booking).toMatchObject({
      guestName: DELETED_CUSTOMER_NAME,
      guestPhone: '',
      contactId: null,
    });

    // The trail: ids and counts, never her name or phone; one event for webhooks and statistics.
    const audits = await owner.db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.workspaceId, a.workspaceId),
          eq(schema.auditEvents.action, 'contact.deleted'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ targetId: lan.id, actorUserId: a.userId });
    expect(JSON.stringify(audits[0])).not.toMatch(/Lan|912345678/);
    const events = await owner.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.type, 'crm.contact.deleted.v1'));
    expect(events.map((e) => e.aggregateId)).toEqual([lan.id]);

    // A second delete finds nothing.
    expect((await call(a.h, 'DELETE', `/contacts/${lan.id}`)).statusCode).toBe(404);
  });

  it('is for owners and admins only; another business gets 404', async () => {
    const a = await shop('delete-perm-a@shop.vn');
    const b = await shop('delete-perm-b@shop.vn');
    const c = await createContact(a.h, { name: 'Khách A' });
    await member(a.workspaceId, b.userId, 'sales');
    expect((await call(b.in(a.workspaceId), 'DELETE', `/contacts/${c.id}`)).statusCode).toBe(403);
    expect((await call(b.h, 'DELETE', `/contacts/${c.id}`)).statusCode).toBe(404);
    expect((await call(a.h, 'DELETE', '/contacts/not-a-uuid')).statusCode).toBe(404);
    expect((await call(a.h, 'GET', `/contacts/${c.id}`)).statusCode).toBe(200);
    const admin = await shop('delete-perm-admin@shop.vn');
    await member(a.workspaceId, admin.userId, 'admin');
    expect((await call(admin.in(a.workspaceId), 'DELETE', `/contacts/${c.id}`)).statusCode).toBe(
      200,
    );
  });
});

describe('DELETE /contacts/{id}/notes/{noteId}', () => {
  it('lets the author or an owner delete a note and scrubs it from the history', async () => {
    const a = await shop('note-delete-a@shop.vn');
    const sales = await shop('note-delete-sales@shop.vn');
    await member(a.workspaceId, sales.userId, 'sales');
    const c = await createContact(a.h, { name: 'Khách ghi chú' });
    const add = async (h: Headers, body: string) =>
      ContactNoteDto.parse((await call(h, 'POST', `/contacts/${c.id}/notes`, { body })).json());
    const ownerNote = await add(a.h, 'Bí mật của chủ');
    const salesNote = await add(sales.in(a.workspaceId), 'Ghi chú của sales');

    // Sales may delete only their own note.
    const path = (id: string) => `/contacts/${c.id}/notes/${id}`;
    expect((await call(sales.in(a.workspaceId), 'DELETE', path(ownerNote.id))).statusCode).toBe(
      403,
    );
    expect((await call(sales.in(a.workspaceId), 'DELETE', path(salesNote.id))).statusCode).toBe(
      204,
    );
    // Owners delete anyone's; another business and a repeat get 404.
    const b = await shop('note-delete-b@shop.vn');
    expect((await call(b.h, 'DELETE', path(ownerNote.id))).statusCode).toBe(404);
    expect((await call(a.h, 'DELETE', path(ownerNote.id))).statusCode).toBe(204);
    expect((await call(a.h, 'DELETE', path(ownerNote.id))).statusCode).toBe(404);

    expect((await call(a.h, 'GET', `/contacts/${c.id}/notes`)).json()).toEqual({ data: [] });
    const history = (await call(a.h, 'GET', `/contacts/${c.id}/history`)).json() as {
      data: Array<{ type: string; data: Record<string, unknown> }>;
    };
    expect(history.data.filter((h) => h.type === 'note.deleted')).toHaveLength(2);
    expect(JSON.stringify(history)).not.toMatch(/Bí mật|Ghi chú của sales/);
  });
});

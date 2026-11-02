import { schema } from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COMMERCE_FACADE, type CommerceFacade } from '../src/modules/commerce/api/index.js';
import {
  CONVERSATION_FACADE,
  type ConversationFacade,
} from '../src/modules/conversation/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../src/modules/crm/api/index.js';
import { type Harness, startHarness } from './support/harness.js';

/**
 * Owner report figures on Postgres (T-172, S3-R1): the new commerce, conversation and crm facade
 * reads, each under its module's `withTenant`. Another business's rows are never counted.
 */
let h: Harness;
let ws: WorkspaceId;
let other: WorkspaceId;
const commerce = () => h.app.get<CommerceFacade>(COMMERCE_FACADE, { strict: false });
const conversations = () => h.app.get<ConversationFacade>(CONVERSATION_FACADE, { strict: false });
const crm = () => h.app.get<CrmFacade>(CRM_FACADE, { strict: false });

beforeAll(async () => {
  h = await startHarness();
  ws = workspaceId((await h.user('lan@report.vn', 'Lan')).ownWorkspace);
  other = workspaceId((await h.user('binh@report.vn', 'Binh')).ownWorkspace);
});

afterAll(async () => {
  await h?.stop();
});

const db = () => h.owner.db;

async function warehouse(w: WorkspaceId): Promise<string> {
  const id = newId();
  await db().insert(schema.warehouses).values({ id, workspaceId: w, name: 'Kho' });
  return id;
}

let codes = 0;
async function order(
  w: WorkspaceId,
  wh: string,
  placedAt: string,
  over: Partial<typeof schema.orders.$inferInsert> = {},
): Promise<string> {
  const id = newId();
  await db()
    .insert(schema.orders)
    .values({
      id,
      workspaceId: w,
      code: `DH${++codes}`,
      status: 'new',
      stockState: 'reserved',
      source: 'facebook',
      warehouseId: wh,
      customer: { name: 'Lan', phone: '0912345678' },
      recipient: {},
      itemQty: 1,
      subtotal: 100_000,
      discountType: 'amount',
      discountValue: 0,
      discountAmount: 0,
      shippingFee: 0,
      shippingFeeCharged: 0,
      surcharge: 0,
      transferAmount: 0,
      total: 100_000,
      paid: 0,
      remaining: 100_000,
      codAmount: 0,
      costTotal: 0,
      placedAt: new Date(placedAt),
      searchText: '',
      ...over,
    });
  return id;
}

async function variant(
  w: WorkspaceId,
  name: string,
  sku: string,
  stock: { warehouseId: string; onHand: number; reserved: number }[],
  over: { status?: string; variantName?: string; archived?: boolean } = {},
): Promise<string> {
  const productId = newId();
  const variantId = newId();
  await db()
    .insert(schema.products)
    .values({
      id: productId,
      workspaceId: w,
      code: sku,
      name,
      status: over.status ?? 'active',
      searchText: '',
    });
  await db()
    .insert(schema.productVariants)
    .values({
      id: variantId,
      workspaceId: w,
      productId,
      sku,
      name: over.variantName ?? '',
      price: 100_000,
      archivedAt: over.archived ? new Date() : null,
    });
  for (const s of stock) {
    await db()
      .insert(schema.inventory)
      .values({ workspaceId: w, variantId, ...s });
  }
  return variantId;
}

describe('commerce report figures', () => {
  it('ordersPlaced: [since, until), no cancelled or deleted orders, total over all', async () => {
    const wh = await warehouse(ws);
    const since = new Date('2026-11-01T17:00:00Z');
    const until = new Date('2026-11-02T17:00:00Z');
    await order(ws, wh, '2026-11-01T17:00:00Z', { total: 50_000, code: 'A-FIRST' });
    await order(ws, wh, '2026-11-02T16:59:59Z', { total: 70_000, code: 'A-LAST' });
    await order(ws, wh, '2026-11-02T05:00:00Z', { total: 30_000, code: 'A-MID' });
    await order(ws, wh, '2026-11-02T17:00:00Z', { code: 'A-UNTIL' });
    await order(ws, wh, '2026-11-02T06:00:00Z', { status: 'cancelled' });
    await order(ws, wh, '2026-11-02T07:00:00Z', { deletedAt: new Date() });
    await order(other, await warehouse(other), '2026-11-02T05:00:00Z', { total: 999_000 });

    const res = await commerce().ordersPlaced(ws, { since, until, limit: 2 });
    expect(res.count).toBe(3);
    expect(res.total).toBe(150_000);
    expect(res.items.map((x) => x.code)).toEqual(['A-LAST', 'A-MID']);
    expect(res.items[0]).toEqual({
      id: expect.any(String),
      code: 'A-LAST',
      total: 70_000,
      status: 'new',
      source: 'facebook',
      placedAt: '2026-11-02T16:59:59.000Z',
    });

    const overview = await commerce().orderOverview(ws, { from: '2026-11-02', to: '2026-11-02' });
    expect(overview.kpis.sales).toBe(150_000);
  });

  it('lowStock: sums warehouses, lowest first, active and live only', async () => {
    const w1 = await warehouse(ws);
    const w2 = await warehouse(ws);
    const multi = await variant(ws, 'Áo thun', 'AT-1', [
      { warehouseId: w1, onHand: 1, reserved: 0 },
      { warehouseId: w2, onHand: 2, reserved: 1 },
    ]);
    const low = await variant(ws, 'Mũ', 'MU-1', [{ warehouseId: w1, onHand: 1, reserved: 1 }], {
      variantName: 'Đen',
    });
    await variant(ws, 'Túi', 'TU-1', [{ warehouseId: w1, onHand: 50, reserved: 0 }]);
    await variant(ws, 'Cũ', 'CU-1', [{ warehouseId: w1, onHand: 0, reserved: 0 }], {
      status: 'archived',
    });
    await variant(ws, 'Bỏ', 'BO-1', [{ warehouseId: w1, onHand: 0, reserved: 0 }], {
      archived: true,
    });
    await variant(ws, 'Dịch vụ', 'DV-1', []);
    await variant(other, 'Khác', 'KH-1', [
      { warehouseId: await warehouse(other), onHand: 0, reserved: 0 },
    ]);

    const res = await commerce().lowStock(ws, { threshold: 2, limit: 20 });
    expect(res.count).toBe(2);
    expect(res.items).toEqual([
      {
        productId: expect.any(String),
        variantId: low,
        name: 'Mũ - Đen',
        sku: 'MU-1',
        available: 0,
      },
      {
        productId: expect.any(String),
        variantId: multi,
        name: 'Áo thun',
        sku: 'AT-1',
        available: 2,
      },
    ]);
  });
});

describe('conversation report figures', () => {
  it('awaitingReply: open conversations waiting at or before the threshold, by channel', async () => {
    const channel = async (w: WorkspaceId) => {
      const id = newId();
      await db().insert(schema.channelConnections).values({
        id,
        workspaceId: w,
        provider: 'facebook',
        externalId: id,
        name: 'Page',
        tokenSealed: 'x',
      });
      return id;
    };
    const channels = new Map([
      [ws, await channel(ws)],
      [other, await channel(other)],
    ]);
    const insert = async (
      w: WorkspaceId,
      provider: string,
      awaitingSince: string | null,
      status = 'open',
    ) => {
      const id = newId();
      await db()
        .insert(schema.conversations)
        .values({
          id,
          workspaceId: w,
          channelId: channels.get(w)!,
          customerId: newId(),
          data: { provider, customerName: 'Lan' },
          awaitingSince: awaitingSince ? new Date(awaitingSince) : null,
          status,
        });
      return id;
    };
    const oldest = await insert(ws, 'facebook', '2026-11-02T00:30:00Z');
    const exact = await insert(ws, 'website', '2026-11-02T02:00:00Z');
    await insert(ws, 'facebook', '2026-11-02T02:00:01Z');
    await insert(ws, 'instagram', '2026-11-02T00:00:00Z', 'resolved');
    await insert(ws, 'facebook', null);
    await insert(other, 'facebook', '2026-11-01T00:00:00Z');

    const res = await conversations().awaitingReply(ws, {
      olderThan: new Date('2026-11-02T02:00:00Z'),
      limit: 200,
    });
    expect(res).toEqual({
      count: 2,
      oldestSince: '2026-11-02T00:30:00.000Z',
      byChannel: [
        { channel: 'facebook', count: 1 },
        { channel: 'website', count: 1 },
      ],
      ids: [oldest, exact],
    });
  });
});

describe('crm report figures', () => {
  it('contactsCreated: [since, until) by first source name, archived left out', async () => {
    const fb = newId();
    await db()
      .insert(schema.crmSources)
      .values({ id: fb, workspaceId: ws, name: 'Facebook', color: '#000' });
    const insert = async (w: WorkspaceId, createdAt: string, over: Record<string, unknown> = {}) =>
      db()
        .insert(schema.contacts)
        .values({
          id: newId(),
          workspaceId: w,
          name: 'Lan',
          createdAt: new Date(createdAt),
          ...over,
        });
    await insert(ws, '2026-11-01T17:00:00Z', { firstSourceId: fb });
    await insert(ws, '2026-11-02T10:00:00Z', { sourceId: fb });
    await insert(ws, '2026-11-02T11:00:00Z');
    await insert(ws, '2026-11-02T17:00:00Z', { firstSourceId: fb });
    await insert(ws, '2026-11-02T12:00:00Z', { archivedAt: new Date() });
    await insert(other, '2026-11-02T10:00:00Z');

    const res = await crm().contactsCreated(ws, {
      since: new Date('2026-11-01T17:00:00Z'),
      until: new Date('2026-11-02T17:00:00Z'),
    });
    expect(res).toEqual({
      count: 3,
      bySource: [
        { source: 'Facebook', count: 2 },
        { source: null, count: 1 },
      ],
    });
  });
});

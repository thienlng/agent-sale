import { newId, workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { CrmFacade } from '../../crm/api/index.js';
import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { BotOrderService } from '../application/bot-order.service.js';
import { CommerceFacadeImpl } from '../application/commerce.facade.impl.js';
import { OrderReviewService } from '../application/order-review.service.js';
import { OrderService } from '../application/order.service.js';
import type { ProductRecord, VariantRecord } from '../application/ports/commerce-store.js';
import { InMemoryCommerce } from './factories/in-memory-commerce.js';

const ws = workspaceId(newId());
const botId = newId();
const conversationId = newId();
const staff = newId();
const otherStaff = newId();

function product(name: string, extra: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: newId(),
    code: name.slice(0, 3).toUpperCase(),
    name,
    description: '',
    category: null,
    status: 'active',
    visibleToBot: true,
    botInstructions: '',
    imageUrls: [],
    accommodation: null,
    searchText: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function variant(p: ProductRecord, sku: string, price: number, extra: Partial<VariantRecord> = {}) {
  return {
    id: newId(),
    productId: p.id,
    sku,
    name: '',
    price,
    cost: Math.round(price / 2),
    weightGram: 0,
    position: 0,
    archived: false,
    ...extra,
  } satisfies VariantRecord;
}

const recipient = { name: 'Lan', phone: '+84 912 345 678', address: '12 Lý Thường Kiệt, Hà Nội' };

function setup(catalogMode: 'all' | 'selected' = 'all') {
  const db = new InMemoryCommerce();
  const warehouseId = newId();
  db.warehouses.push({
    id: warehouseId,
    name: 'Kho chính',
    phone: null,
    province: null,
    ward: null,
    addressDetail: null,
    isDefault: true,
  });
  const animal = product('Thú gỗ xếp thăng bằng');
  const tower = product('Tháp cầu vồng');
  const hidden = product('Bút màu sáp', { visibleToBot: false });
  const archived = product('Bóng gỗ', { status: 'archived' });
  const archivedHidden = product('Bút xoá', { status: 'archived', visibleToBot: false });
  db.products.push(animal, tower, hidden, archived, archivedHidden);
  const a = variant(animal, 'TG-01', 880_000);
  const t = variant(tower, 'TCV-01', 460_000);
  const h = variant(hidden, 'BM-01', 50_000);
  const old = variant(archived, 'BG-01', 90_000);
  const gone = variant(tower, 'TCV-OLD', 400_000, { archived: true });
  db.variants.push(a, t, h, old, gone, variant(archivedHidden, 'BX-01', 20_000));
  for (const v of [a, t, h, old]) {
    db.stock.push({ variantId: v.id, warehouseId, onHand: 5, reserved: 1 });
  }
  db.botSelection.set(botId, [tower.id]);
  const bot = { id: botId, name: 'Bot Lan', catalogMode } as BotView;
  const bots: BotFacade = { getBot: vi.fn(async () => bot) };
  const crm = { upsertLeadByPhone: vi.fn(async () => ({ contactId: newId(), created: true })) };
  const identity: IdentityFacade = {
    displayName: vi.fn(async (id: string) => (id === staff ? 'Chị Mai' : 'Anh Tuấn')),
  } as unknown as IdentityFacade;
  const workspaces = {
    getById: async () => ({ timezone: 'Asia/Ho_Chi_Minh' }),
  } as unknown as WorkspaceFacade;
  const service = new BotOrderService(db, bots, crm as unknown as CrmFacade);
  const reviews = new OrderReviewService(db, identity);
  const orders = new OrderService(db, identity, workspaces);
  const facade = new CommerceFacadeImpl(orders, service);
  return { db, service, reviews, facade, orders, crm, warehouseId, animal, tower, a, t };
}

const prepareInput = (
  items: Array<{ sku: string; qty: number }>,
  extra: Partial<Parameters<BotOrderService['prepareBotOrder']>[1]> = {},
) => ({
  botId,
  conversationId,
  channel: 'facebook',
  items,
  recipient,
  shippingFeeVnd: 30_000,
  ...extra,
});

afterEach(() => vi.useRealTimers());

describe('prepareBotOrder', () => {
  it('stores the draft and returns the summary and the product ids', async () => {
    const { facade, db, animal, tower, a } = setup();
    const result = await facade.prepareBotOrder(
      ws,
      prepareInput([
        { sku: 'tg-01', qty: 1 },
        { sku: 'TCV-01', qty: 1 },
        { sku: 'TG-01 ', qty: 1 },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      summaryText: expect.stringContaining('• Thú gỗ xếp thăng bằng ×2 — 1.760.000đ'),
      productIds: [animal.id, tower.id],
    });
    if (!result.ok) return;
    expect(result.summaryText).toContain('Tổng: 2.250.000đ');
    expect(result.summaryText).toContain('Người nhận: Lan · 0912 345 678');
    const draft = db.drafts.get(conversationId);
    expect(draft?.lines).toEqual([
      { variantId: a.id, sku: 'TG-01', qty: 2 },
      expect.objectContaining({ sku: 'TCV-01', qty: 1 }),
    ]);
    expect(draft?.recipient.phone).toBe('0912345678');
    expect(draft?.channel).toBe('facebook');
    expect(draft!.expiresAt.getTime() - draft!.createdAt.getTime()).toBe(30 * 60 * 1000);
  });

  it.each([
    ['unknown_sku', { sku: 'NOPE', qty: 1 }, { code: 'unknown_sku', sku: 'NOPE' }],
    ['hidden from the bot', { sku: 'BM-01', qty: 1 }, { code: 'unknown_sku', sku: 'BM-01' }],
    ['archived product', { sku: 'BG-01', qty: 1 }, { code: 'inactive', sku: 'BG-01' }],
    ['archived and hidden', { sku: 'BX-01', qty: 1 }, { code: 'unknown_sku', sku: 'BX-01' }],
    ['archived variant', { sku: 'TCV-OLD', qty: 1 }, { code: 'inactive', sku: 'TCV-OLD' }],
    [
      'insufficient_stock',
      { sku: 'TG-01', qty: 5 },
      { code: 'insufficient_stock', sku: 'TG-01', available: 4 },
    ],
  ])('reports %s and stores nothing', async (_label, item, problem) => {
    const { facade, db } = setup();
    const result = await facade.prepareBotOrder(ws, prepareInput([item]));
    expect(result).toEqual({ ok: false, problems: [problem] });
    expect(db.drafts.size).toBe(0);
  });

  it('keeps a selected-mode bot to its selection', async () => {
    const { facade } = setup('selected');
    const result = await facade.prepareBotOrder(
      ws,
      prepareInput([
        { sku: 'TG-01', qty: 1 },
        { sku: 'TCV-01', qty: 1 },
      ]),
    );
    expect(result).toEqual({ ok: false, problems: [{ code: 'unknown_sku', sku: 'TG-01' }] });
  });

  it.each([
    [{ ...recipient, name: ' ' }, 'missing_name'],
    [{ ...recipient, phone: '' }, 'missing_phone'],
    [{ ...recipient, phone: '0212345' }, 'invalid_phone'],
    [{ ...recipient, address: '' }, 'missing_address'],
  ])('reports a recipient problem (%j → %s)', async (who, code) => {
    const { facade, db } = setup();
    const result = await facade.prepareBotOrder(
      ws,
      prepareInput([{ sku: 'TG-01', qty: 1 }], { recipient: who }),
    );
    expect(result).toEqual({ ok: false, problems: [{ code }] });
    expect(db.drafts.size).toBe(0);
  });

  it('replaces the earlier draft of the conversation', async () => {
    const { facade, db } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const first = db.drafts.get(conversationId)!;
    await facade.prepareBotOrder(
      ws,
      prepareInput([{ sku: 'TCV-01', qty: 2 }], { shippingFeeVnd: null, note: 'Gói quà' }),
    );
    expect(db.drafts.size).toBe(1);
    const second = db.drafts.get(conversationId)!;
    expect(second.lines.map((l) => l.sku)).toEqual(['TCV-01']);
    expect(second.shippingVnd).toBeNull();
    expect(second.note).toBe('Gói quà');
    expect(second.amountsHash).not.toBe(first.amountsHash);
  });
});

describe('confirmBotOrder', () => {
  const confirm = (f: CommerceFacadeImpl) =>
    f.confirmBotOrder(ws, { botId, botName: 'Bot Lan', conversationId });

  it('links no conversation for an order taken in the test chat', async () => {
    const { facade, db } = setup();
    await facade.prepareBotOrder(
      ws,
      prepareInput([{ sku: 'TG-01', qty: 1 }], { channel: 'other' }),
    );
    expect(await confirm(facade)).toMatchObject({ ok: true });
    expect(db.orders[0]).toMatchObject({
      source: 'other',
      createdByKind: 'bot',
      conversationId: null,
    });
  });

  it('creates a pending-review bot order, reserves stock and writes history', async () => {
    const { facade, db, crm, a, warehouseId } = setup();
    await facade.prepareBotOrder(
      ws,
      prepareInput([{ sku: 'TG-01', qty: 2 }], { note: 'Giao giờ hành chính' }),
    );
    const result = await confirm(facade);
    expect(result).toEqual({ ok: true, orderId: expect.any(String), orderCode: 'DH000001' });
    const order = db.orders[0]!;
    expect(order).toMatchObject({
      status: 'new',
      stockState: 'reserved',
      source: 'facebook',
      createdByKind: 'bot',
      createdByName: 'Bot Lan',
      createdByUserId: null,
      conversationId,
      reviewState: 'pending',
      clientRequestId: expect.stringMatching(
        new RegExp(`^bot:${conversationId}:[0-9a-f]{32}:\\d+$`),
      ),
      customer: { name: 'Lan', phone: '0912345678' },
      recipient: { name: 'Lan', phone: '0912345678', address: recipient.address },
      subtotal: 1_760_000,
      shippingFeeCharged: 30_000,
      total: 1_790_000,
      noteInternal: 'Giao giờ hành chính',
    });
    expect(db.stock.find((s) => s.variantId === a.id && s.warehouseId === warehouseId)).toEqual(
      expect.objectContaining({ onHand: 5, reserved: 3 }),
    );
    expect(db.history.get(order.id)).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'new',
        note: 'Bot tạo đơn từ hội thoại',
        actorName: 'Bot Lan',
      }),
    ]);
    expect(db.drafts.size).toBe(0);
    expect(crm.upsertLeadByPhone).toHaveBeenCalledWith(ws, {
      phoneE164: '+84912345678',
      sourceKey: 'facebook',
      displayName: 'Lan',
      firstUrl: null,
    });
  });

  it('records shipping 0 when the shop tells the fee later', async () => {
    const { facade, db } = setup();
    await facade.prepareBotOrder(
      ws,
      prepareInput([{ sku: 'TG-01', qty: 1 }], { shippingFeeVnd: null }),
    );
    await confirm(facade);
    expect(db.orders[0]).toMatchObject({ shippingFee: 0, shippingFeeCharged: 0, total: 880_000 });
  });

  it('is idempotent for one draft: a retry of the same draft returns its order', async () => {
    const { facade, db } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const draft = structuredClone(db.drafts.get(conversationId)!);
    const first = await confirm(facade);
    expect(await confirm(facade)).toEqual({ ok: false, code: 'nothing_pending' });
    // The same draft seen again (e.g. a retry racing the commit) never makes a second order.
    db.drafts.set(conversationId, draft);
    expect(await confirm(facade)).toEqual(first);
    expect(db.orders).toHaveLength(1);
    expect(db.drafts.size).toBe(0);
  });

  it('creates a new order when the same basket is prepared and confirmed again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { facade, db } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const first = await confirm(facade);
    vi.setSystemTime(Date.now() + 60_000);
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const second = await confirm(facade);
    expect(second).toMatchObject({ ok: true, orderCode: 'DH000002' });
    expect(second).not.toEqual(first);
    expect(db.orders).toHaveLength(2);
  });

  it('uses no order code when a confirmation fails (rolled back)', async () => {
    const { facade, db, a } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 3 }]));
    const row = db.stock.find((s) => s.variantId === a.id)!;
    row.reserved = 4;
    expect(await confirm(facade)).toEqual({ ok: false, code: 'insufficient_stock' });
    // The failed transaction was rolled back (the fake restores a copy of the rows).
    db.stock.find((s) => s.variantId === a.id)!.reserved = 1;
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 3 }]));
    expect(await confirm(facade)).toMatchObject({ ok: true, orderCode: 'DH000001' });
  });

  it('keeps a newer draft when an older one fails', async () => {
    const { facade, db } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const older = db.drafts.get(conversationId)!.createdAt;
    const deleted = await db.run(ws, (tx) =>
      tx.botOrders.deleteDraft(conversationId, new Date(older.getTime() - 1)),
    );
    expect(deleted).toBe(false);
    expect(db.drafts.size).toBe(1);
  });

  it('answers expired after 30 minutes and drops the draft', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { facade, db } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    expect(await facade.hasBotOrderDraft(ws, conversationId)).toEqual({
      pending: true,
      storedAt: expect.any(Date),
    });
    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1);
    expect(await facade.hasBotOrderDraft(ws, conversationId)).toEqual({
      pending: false,
      storedAt: null,
    });
    expect(await confirm(facade)).toEqual({ ok: false, code: 'expired' });
    expect(db.orders).toHaveLength(0);
    expect(db.drafts.size).toBe(0);
  });

  it('rechecks stock: sold out since the summary means insufficient_stock and no order', async () => {
    const { facade, db, a } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 3 }]));
    db.stock.find((s) => s.variantId === a.id)!.reserved = 4;
    expect(await confirm(facade)).toEqual({ ok: false, code: 'insufficient_stock' });
    expect(db.orders).toHaveLength(0);
    expect(db.movements).toHaveLength(0);
  });

  it('answers expired when a price changed since the summary', async () => {
    const { facade, db, a } = setup();
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    db.variants.find((v) => v.id === a.id)!.price = 990_000;
    expect(await confirm(facade)).toEqual({ ok: false, code: 'expired' });
    expect(db.orders).toHaveLength(0);
  });

  it('answers nothing_pending without a draft, or for a draft of another bot', async () => {
    const { facade } = setup();
    expect(await confirm(facade)).toEqual({ ok: false, code: 'nothing_pending' });
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    expect(
      await facade.confirmBotOrder(ws, { botId: newId(), botName: 'Khác', conversationId }),
    ).toEqual({ ok: false, code: 'nothing_pending' });
  });

  it('cancels the draft', async () => {
    const { facade, db } = setup();
    expect(await facade.cancelBotOrderDraft(ws, conversationId)).toBe(false);
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    expect(await facade.cancelBotOrderDraft(ws, conversationId)).toBe(true);
    expect(db.drafts.size).toBe(0);
  });

  it('still returns the order when the CRM upsert fails', async () => {
    const { facade, crm } = setup();
    crm.upsertLeadByPhone.mockRejectedValueOnce(new Error('down'));
    await facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    expect(await confirm(facade)).toMatchObject({ ok: true });
  });
});

describe('approve', () => {
  let ctx: ReturnType<typeof setup>;
  let orderId: string;

  beforeEach(async () => {
    ctx = setup();
    await ctx.facade.prepareBotOrder(ws, prepareInput([{ sku: 'TG-01', qty: 1 }]));
    const r = await ctx.facade.confirmBotOrder(ws, { botId, botName: 'Bot Lan', conversationId });
    orderId = r.ok ? r.orderId : '';
  });

  it('approves once, records the reviewer and history, and stays idempotent', async () => {
    const dto = await ctx.reviews.approve(ws, orderId, true, staff);
    expect(dto).toMatchObject({
      reviewState: 'approved',
      reviewedByName: 'Chị Mai',
      reviewedAt: expect.any(String),
      createdByKind: 'bot',
      conversationId,
      itemCount: 1,
    });
    await ctx.reviews.approve(ws, orderId, true, staff);
    const notes = ctx.db.history.get(orderId)!.map((h) => h.note);
    expect(notes).toEqual(['Bot tạo đơn từ hội thoại', 'Đã duyệt đơn do bot tạo']);
  });

  it('lets the same user undo within 5 seconds only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await ctx.reviews.approve(ws, orderId, true, staff);
    await expect(ctx.reviews.approve(ws, orderId, false, otherStaff)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    vi.setSystemTime(Date.now() + 4_000);
    const undone = await ctx.reviews.approve(ws, orderId, false, staff);
    expect(undone).toMatchObject({
      reviewState: 'pending',
      reviewedByName: null,
      reviewedAt: null,
    });
    await ctx.reviews.approve(ws, orderId, true, staff);
    vi.setSystemTime(Date.now() + 5_001);
    await expect(ctx.reviews.approve(ws, orderId, false, staff)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('refuses orders staff created', async () => {
    const order = ctx.db.orders[0]!;
    ctx.db.orders.push({
      ...order,
      id: newId(),
      clientRequestId: null,
      createdByKind: 'agent',
      reviewState: null,
      conversationId: null,
    });
    await expect(ctx.reviews.approve(ws, ctx.db.orders[1]!.id, true, staff)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'NOT_BOT_ORDER' },
    });
  });

  it('answers NOT_FOUND for an unknown order', async () => {
    await expect(ctx.reviews.approve(ws, newId(), true, staff)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('counts and lists pending bot orders, leaving out approved and cancelled ones', async () => {
    expect(await ctx.reviews.reviewCount(ws)).toEqual({ pending: 1 });
    const page = { page: 1, pageSize: 20, statusMode: 'include', sort: 'placed_desc' } as const;
    const pending = await ctx.orders.list(ws, { ...page, review: 'pending' });
    expect(ctx.db.lastListFilter?.review).toBe('pending');
    expect(pending.data.map((o) => o.id)).toEqual([orderId]);
    await ctx.reviews.approve(ws, orderId, true, staff);
    expect(await ctx.reviews.reviewCount(ws)).toEqual({ pending: 0 });
    expect((await ctx.orders.list(ws, { ...page, review: 'pending' })).data).toEqual([]);
  });
});

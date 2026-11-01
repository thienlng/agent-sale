import { describe, expect, it } from 'vitest';

import {
  isPushEligible,
  PUSH_NOTE_MAX,
  PUSH_SETTLE_MS,
  pushedHistoryNote,
  pushNote,
  pushPayload,
  type PushLine,
} from './order-push.js';

const since = new Date('2026-11-01T00:00:00Z');
const now = new Date('2026-11-01T10:00:00Z');
const staff = {
  externalState: null,
  deleted: false,
  status: 'new' as const,
  createdAt: new Date('2026-11-01T09:00:00Z'),
  createdByKind: 'agent' as const,
  reviewState: null,
  reviewedAt: null,
};

describe('isPushEligible', () => {
  it('takes staff orders created since the connection', () => {
    expect(isPushEligible(staff, since, now)).toBe(true);
    expect(
      isPushEligible({ ...staff, createdAt: new Date('2026-10-31T23:59:59Z') }, since, now),
    ).toBe(false);
  });

  it('skips orders already claimed, deleted or cancelled', () => {
    expect(isPushEligible({ ...staff, externalState: 'failed' }, since, now)).toBe(false);
    expect(isPushEligible({ ...staff, deleted: true }, since, now)).toBe(false);
    expect(isPushEligible({ ...staff, status: 'cancelled' }, since, now)).toBe(false);
  });

  it('takes bot orders only once approved and past the undo window', () => {
    const bot = { ...staff, createdByKind: 'bot' as const, reviewState: 'pending' as const };
    expect(isPushEligible(bot, since, now)).toBe(false);
    const approvedAt = (ms: number) => new Date(now.getTime() - ms);
    const approved = { ...bot, reviewState: 'approved' as const };
    expect(
      isPushEligible({ ...approved, reviewedAt: approvedAt(PUSH_SETTLE_MS - 1) }, since, now),
    ).toBe(false);
    expect(
      isPushEligible({ ...approved, reviewedAt: approvedAt(PUSH_SETTLE_MS) }, since, now),
    ).toBe(true);
    expect(isPushEligible({ ...staff, createdByKind: 'import' }, since, now)).toBe(false);
  });
});

describe('pushNote', () => {
  it('joins the internal and printed notes and cuts at 500 characters', () => {
    expect(pushNote(' Gói kỹ ', '')).toBe('Gói kỹ');
    expect(pushNote('A', 'B')).toBe('A\nB');
    expect(pushNote('x'.repeat(400), 'y'.repeat(400))).toHaveLength(PUSH_NOTE_MAX);
  });
});

describe('pushPayload', () => {
  const order = {
    id: 'o1',
    code: 'DH000001',
    placedAt: now,
    noteInternal: 'Giao giờ hành chính',
    notePrint: '',
    discountAmount: 20_000,
    shippingFeeCharged: 30_000,
    total: 310_000,
    customer: { name: 'Lan', phone: '0912345678' },
    recipient: {
      name: 'Hoa',
      phone: '0987654321',
      address: '12 Lý Thường Kiệt',
      ward: 'Phường Hàng Bài',
      province: 'Hà Nội',
    },
  };
  const line = (patch: Partial<PushLine> = {}): PushLine => ({
    externalVariantId: '2001',
    sku: 'AT-S',
    productName: 'Áo thun',
    variantName: 'S',
    qty: 2,
    unitPrice: 150_000,
    ...patch,
  });

  it('builds a PMS-neutral payload from a linked order', () => {
    expect(pushPayload(order, [line()])).toEqual({
      order: {
        id: 'o1',
        code: 'DH000001',
        placedAt: now,
        note: 'Giao giờ hành chính',
        lines: [
          {
            externalVariantId: '2001',
            sku: 'AT-S',
            name: 'Áo thun – S',
            qty: 2,
            unitPrice: 150_000,
            lineDiscount: 0,
          },
        ],
        discount: 20_000,
        shippingFee: 30_000,
        total: 310_000,
        customer: { name: 'Lan', phone: '0912345678' },
        recipient: {
          name: 'Hoa',
          phone: '0987654321',
          address: '12 Lý Thường Kiệt, Phường Hàng Bài, Hà Nội',
        },
      },
    });
  });

  it('names the first product not linked to the PMS', () => {
    expect(
      pushPayload(order, [
        line(),
        line({ externalVariantId: null, productName: 'Quần jean' }),
        line({ externalVariantId: null, productName: 'Mũ' }),
      ]),
    ).toEqual({ problem: { reason: 'unlinked_product', name: 'Quần jean' } });
  });

  it('refuses an order without lines and tolerates missing people fields', () => {
    expect(pushPayload(order, [])).toEqual({ problem: { reason: 'empty' } });
    const bare = pushPayload({ ...order, customer: {}, recipient: {} }, [line()]);
    expect(bare).toMatchObject({
      order: {
        customer: { name: '', phone: null },
        recipient: { name: '', phone: null, address: '' },
      },
    });
  });

  it('writes the history note with the PMS order code', () => {
    expect(pushedHistoryNote('DHKV0001')).toBe('Đã đẩy sang KiotViet (DHKV0001)');
  });
});

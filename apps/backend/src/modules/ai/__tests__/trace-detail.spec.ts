import { describe, expect, it } from 'vitest';

import { capDetail, missingFields, toolDetail } from '../application/trace-detail.js';

const j = (v: unknown) => JSON.stringify(v);

describe('toolDetail', () => {
  it('search_products: redacted query, result count and up to 10 product ids', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
    const out = toolDetail(
      'search_products',
      { query: 'áo cho 0912345678' },
      j({ rows, details: [] }),
    );
    expect(out).toEqual({
      detail: {
        query: 'áo cho [phone]',
        resultCount: 12,
        productIds: rows.slice(0, 10).map((r) => r.id),
      },
      errorCode: null,
    });
    expect(
      toolDetail('search_products', { query: 'x' }, j({ rows: [], details: [] })).detail,
    ).toMatchObject({ resultCount: 0, productIds: [] });
    expect(toolDetail('search_products', {}, j({ index: [{ id: 'a' }] })).detail).toEqual({
      resultCount: 1,
      productIds: ['a'],
    });
  });

  it('product_details: the missing fields per product', () => {
    const products = [
      {
        id: 'a',
        fromVnd: 0,
        inStock: true,
        description: '',
        images: [],
        variants: [{ sku: 's', name: 'M', priceVnd: 0, available: 0 }],
      },
      {
        id: 'b',
        fromVnd: 100,
        inStock: true,
        description: 'ok',
        images: [{ id: 'i', label: 'l' }],
        variants: [{ sku: 's', name: 'M', priceVnd: 100, available: 2 }],
      },
      { id: 'c', catalogKind: 'accommodation', description: 'Villa', images: [{ id: 'i' }] },
      {
        id: 'd',
        fromVnd: 10,
        inStock: false,
        description: 'x',
        images: [{ id: 'i' }],
        variants: [],
      },
    ];
    const out = toolDetail(
      'product_details',
      { ids: ['a', 'b', 'c', 'd'] },
      j({ products, notFound: [] }),
    );
    expect(out.detail).toEqual({
      productIds: ['a', 'b', 'c', 'd'],
      missing: [
        { productId: 'a', fields: ['price', 'stock', 'description', 'images'] },
        { productId: 'd', fields: ['stock', 'variants'] },
      ],
    });
    expect(
      missingFields({ id: 'z', catalogKind: 'accommodation', description: '', images: [] }),
    ).toEqual(['description', 'images']);
  });

  it('calculate: ok or its error code', () => {
    expect(
      toolDetail('calculate', { expression: '1+1' }, j({ value: '2', formatted: '2' })),
    ).toEqual({ detail: { ok: true }, errorCode: null });
    expect(
      toolDetail('calculate', { expression: '1+' }, j({ error: 'invalid_expression' })),
    ).toEqual({
      detail: { ok: false, errorCode: 'invalid_expression' },
      errorCode: 'invalid_expression',
    });
  });

  it('send_message: sizes and delivery only, never the text', () => {
    const out = toolDetail(
      'send_message',
      { text: 'Dạ shop gọi 0912345678 ạ', imageIds: ['p:a:0', 'x'] },
      j({ status: 'sent', delivered: 1, droppedImageIds: ['x'] }),
    );
    expect(out.detail).toEqual({ chars: 24, imageCount: 2, droppedImages: 1, delivered: true });
    expect(j(out)).not.toContain('0912345678');
    const failed = toolDetail('send_message', { text: 'a' }, j({ error: 'not_delivered' }));
    expect(failed).toEqual({
      detail: { chars: 1, imageCount: 0, droppedImages: 0, delivered: false },
      errorCode: 'not_delivered',
    });
  });

  it('send_message: album page and video flags, never ids or URLs', () => {
    const out = toolDetail(
      'send_message',
      { albumId: 'a:p:0', videoId: 'v:p:1:0' },
      j({
        status: 'sent',
        delivered: 2,
        album: { sent: 8, remaining: 4 },
        video: 'video',
        incomplete: true,
      }),
    );
    expect(out.detail).toEqual({
      chars: 0,
      imageCount: 0,
      droppedImages: 0,
      delivered: true,
      album: true,
      albumSent: 8,
      albumRemaining: 4,
      video: true,
      incomplete: true,
    });
  });

  it('handoff: the redacted reason', () => {
    expect(
      toolDetail('handoff', { reason: 'khách xin số 0912345678' }, j({ status: 'handed_over' })),
    ).toEqual({ detail: { reason: 'khách xin số [phone]' }, errorCode: null });
  });

  it('order tools: item count and error code, never the recipient', () => {
    const input = {
      items: [
        { sku: 'A', qty: 1 },
        { sku: 'B', qty: 2 },
      ],
      recipient: {
        name: 'Nguyễn Văn An',
        phone: '0912345678',
        address: '12 Lý Thường Kiệt, Hà Nội',
      },
      note: 'giao giờ hành chính',
    };
    const ok = toolDetail('prepare_order', input, j({ ok: true, status: 'summary_sent' }));
    expect(ok).toEqual({ detail: { itemCount: 2 }, errorCode: null });
    const bad = toolDetail(
      'prepare_order',
      input,
      j({ ok: false, problems: [{ field: 'phone' }] }),
    );
    expect(bad).toEqual({
      detail: { itemCount: 2, errorCode: 'invalid_request' },
      errorCode: 'invalid_request',
    });
    for (const out of [ok, bad]) {
      const text = j(out);
      for (const secret of ['Nguyễn', '0912345678', 'Lý Thường', 'hành chính']) {
        expect(text).not.toContain(secret);
      }
    }
    expect(toolDetail('confirm_order', {}, j({ ok: false, code: 'not_confirmable' }))).toEqual({
      detail: { errorCode: 'not_confirmable' },
      errorCode: 'not_confirmable',
    });
    expect(
      toolDetail('cancel_order_draft', {}, j({ ok: true, status: 'cancelled' })).detail,
    ).toEqual({});
  });

  it('hold tools: nights, adults and result count, never the guest', () => {
    const stay = { checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2 };
    expect(
      toolDetail('check_availability', stay, j({ ok: true, options: [{}, {}], problems: [] })),
    ).toEqual({ detail: { nights: 2, adults: 2, resultCount: 2 }, errorCode: null });
    const hold = toolDetail(
      'prepare_hold',
      { ...stay, propertyCode: 'V1', guestName: 'Trần Thị Bình', guestPhone: '0987654321' },
      j({ ok: false, error: 'unknown_property_code' }),
    );
    expect(hold.detail).toEqual({ nights: 2, adults: 2, errorCode: 'unknown_property_code' });
    expect(j(hold)).not.toContain('Trần');
    expect(j(hold)).not.toContain('0987654321');
    expect(
      toolDetail('confirm_hold', {}, j({ ok: false, code: 'not_confirmable' })).errorCode,
    ).toBe('not_confirmable');
    expect(toolDetail('cancel_hold_draft', {}, j({ ok: true })).detail).toEqual({});
  });

  it('action tools: action id, status and error code only', () => {
    const idOf = (name: string) =>
      name === 'action_1' || name === 'confirm_pending_action' ? 'act-1' : null;
    const failed = toolDetail(
      'action_1',
      { code: 'DH-1', phone: '0912345678' },
      j({ ok: false, errorCode: 'http_401' }),
      idOf,
    );
    expect(failed).toEqual({
      detail: { actionId: 'act-1', statusCode: null, errorCode: 'http_401' },
      errorCode: 'http_401',
    });
    const done = toolDetail(
      'confirm_pending_action',
      {},
      j({ ok: true, statusCode: 200, data: { secret: 'customer data' } }),
      idOf,
    );
    expect(done.detail).toEqual({ actionId: 'act-1', statusCode: 200 });
    expect(j(done)).not.toContain('customer data');
    expect(
      toolDetail(
        'action_1',
        { code: 'x' },
        j({ status: 'awaiting_customer_confirmation', readBack: { code: 'x' } }),
        idOf,
      ).detail,
    ).toEqual({ actionId: 'act-1', statusCode: null, confirmRequired: true });
    expect(toolDetail('cancel_pending_action', {}, j({ error: 'nothing_pending' })).errorCode).toBe(
      'nothing_pending',
    );
  });

  it('record_request: kind, updated and the error code, never the details', () => {
    expect(
      toolDetail(
        'record_request',
        { kind: 'appointment', name: 'Hoa', phone: '0983456721' },
        j({ ok: true, recorded: true, updated: true, kind: 'appointment', missing: [] }),
      ),
    ).toEqual({ detail: { kind: 'appointment', updated: true }, errorCode: null });
    const refused = toolDetail(
      'record_request',
      { kind: 'placement_test', phone: '0911222333' },
      j({ ok: false, error: 'contact_not_from_customer' }),
    );
    expect(refused).toEqual({
      detail: { kind: 'placement_test', errorCode: 'contact_not_from_customer' },
      errorCode: 'contact_not_from_customer',
    });
    expect(JSON.stringify(refused)).not.toContain('0911');
  });

  it('a course or service with a price note and no stock is not missing price or stock', () => {
    expect(
      missingFields({
        catalogKind: 'service',
        priceNote: 'liên hệ',
        description: 'Gội đầu',
        images: [{ id: 'p:1:0', label: 'x' }],
        variants: [{ sku: 'S1', name: 'Mặc định', priceVnd: 0 }],
      }),
    ).toEqual([]);
    expect(
      missingFields({ catalogKind: 'course', description: 'x', images: [], variants: [] }),
    ).toEqual(['price', 'images', 'variants']);
  });

  it('the legacy SaaS request tool name stays readable: error code only', () => {
    expect(toolDetail('record_saas_request', { kind: 'demo' }, j({ ok: true }))).toEqual({
      detail: {},
      errorCode: null,
    });
    expect(
      toolDetail('record_saas_request', {}, j({ ok: false, error: 'invalid_request' })).errorCode,
    ).toBe('invalid_request');
  });

  it('unknown tools and invalid JSON get no detail; free-text errors become `error`', () => {
    expect(toolDetail('mystery', {}, j({ ok: true }))).toEqual({ detail: null, errorCode: null });
    expect(toolDetail('search_products', {}, 'not json')).toEqual({
      detail: null,
      errorCode: null,
    });
    expect(
      toolDetail('confirm_order', {}, j({ ok: false, error: 'khách nói sai địa chỉ' })).errorCode,
    ).toBe('error');
  });

  it('caps a detail at 2 000 chars by dropping list tails', () => {
    const big = {
      productIds: Array.from({ length: 200 }, (_, i) => `product-${i}-xxxxxxxxxx`),
      resultCount: 200,
    };
    const capped = capDetail(big);
    expect(j(capped).length).toBeLessThanOrEqual(2_000);
    expect(capped).toMatchObject({ resultCount: 200, truncated: true });
    expect(() => JSON.parse(j(capped))).not.toThrow();
  });
});

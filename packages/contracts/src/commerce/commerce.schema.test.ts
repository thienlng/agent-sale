import { describe, expect, it } from 'vitest';

import {
  OfferingDetails,
  OrderListQuery,
  OrderSummaryDto,
  ProductDto,
  UpdateProductBotSettingsRequest,
  UpsertProductRequest,
} from './commerce.schema.js';
import {
  ApproveOrderRequest,
  OrderCreatedByKind,
  OrderReviewCountResponse,
  OrderReviewState,
} from './order-review.schema.js';

const base = { code: 'OX-1', name: 'Oxford', variants: [{ sku: 'OX-1-42', price: 100000 }] };

describe('product images', () => {
  it('defaults to no images and keeps up to five https URLs', () => {
    expect(UpsertProductRequest.parse(base)).toMatchObject({ imageUrls: [] });
    const urls = Array.from({ length: 5 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    expect(UpsertProductRequest.parse({ ...base, imageUrls: urls }).imageUrls).toEqual(urls);
  });

  it('rejects a sixth image, a non-https URL and an overlong URL', () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    expect(UpsertProductRequest.safeParse({ ...base, imageUrls: six }).success).toBe(false);
    for (const bad of ['http://cdn.example.com/a.jpg', 'javascript:alert(1)', 'not a url'])
      expect(UpsertProductRequest.safeParse({ ...base, imageUrls: [bad] }).success).toBe(false);
    const long = `https://cdn.example.com/${'a'.repeat(2000)}.jpg`;
    expect(UpsertProductRequest.safeParse({ ...base, imageUrls: [long] }).success).toBe(false);
  });

  it('reads a product row written before the column existed as having no images', () => {
    const dto = ProductDto.shape.imageUrls.parse(undefined);
    expect(dto).toEqual([]);
  });
});

describe('bot orders and review', () => {
  const amounts = {
    itemQty: 1,
    subtotal: 100000,
    discountType: 'amount',
    discountValue: 0,
    discountAmount: 0,
    afterDiscount: 100000,
    shippingFee: 0,
    shippingFeeCharged: 0,
    freeShipping: false,
    surcharge: 0,
    gross: 100000,
    total: 100000,
    transferAmount: 0,
    paid: 0,
    remaining: 100000,
    cod: 100000,
  };
  const summary = {
    id: '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
    code: 'DH0001',
    status: 'new',
    source: 'facebook',
    customer: { name: 'Lan', phone: '0912345678' },
    recipient: { name: 'Lan', phone: '0912345678', address: '12 Lý Thường Kiệt' },
    carrier: null,
    trackingCode: null,
    noteInternal: '',
    amounts,
    itemsPreview: [
      { name: 'Tháp cầu vồng', qty: 1, variantName: null, unitPrice: 100000, imageUrl: null },
    ],
    itemCount: 1,
    createdByName: 'Bot Lan',
    createdByKind: 'bot',
    reviewState: 'pending',
    reviewedByName: null,
    reviewedAt: null,
    conversationId: '4f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f',
    placedAt: '2026-10-31T08:00:00.000Z',
  };

  it('parses a bot order summary with its review and conversation fields', () => {
    const parsed = OrderSummaryDto.parse(summary);
    expect(parsed.createdByKind).toBe('bot');
    expect(parsed.reviewState).toBe('pending');
    expect(parsed.itemsPreview[0]).toEqual(summary.itemsPreview[0]);
  });

  it('accepts a staff order with no review and requires the new preview fields', () => {
    const staff = { ...summary, createdByKind: 'agent', reviewState: null, conversationId: null };
    expect(OrderSummaryDto.safeParse(staff).success).toBe(true);
    const oldPreview = { ...summary, itemsPreview: [{ name: 'A', qty: 1 }] };
    expect(OrderSummaryDto.safeParse(oldPreview).success).toBe(false);
    expect(OrderSummaryDto.safeParse({ ...summary, reviewState: 'rejected' }).success).toBe(false);
    const { itemCount: _count, ...noCount } = summary;
    expect(OrderSummaryDto.safeParse(noCount).success).toBe(false);
    const eleven = Array.from({ length: 11 }, () => summary.itemsPreview[0]);
    expect(OrderSummaryDto.safeParse({ ...summary, itemsPreview: eleven }).success).toBe(false);
    expect(OrderSummaryDto.safeParse({ ...summary, createdByKind: 'robot' }).success).toBe(false);
  });

  it('carries the PMS push state, null when absent (an older API)', () => {
    expect(OrderSummaryDto.parse(summary).external).toBeNull();
    const pushed = {
      ...summary,
      external: { state: 'pushed', code: 'DHKV0001', status: 'confirmed', error: null },
    };
    expect(OrderSummaryDto.parse(pushed).external).toEqual(pushed.external);
    const failed = {
      ...summary,
      external: {
        state: 'failed',
        code: null,
        status: null,
        error: { code: 'unlinked_product', params: { name: 'Áo', count: 1 } },
      },
    };
    expect(OrderSummaryDto.parse(failed).external?.error?.params).toEqual({ name: 'Áo', count: 1 });
    const unknown = { ...summary, external: { ...pushed.external, state: 'sent' } };
    expect(OrderSummaryDto.safeParse(unknown).success).toBe(false);
  });

  it('filters the list by pending review only', () => {
    expect(OrderListQuery.parse({ review: 'pending' }).review).toBe('pending');
    expect(OrderListQuery.parse({}).review).toBeUndefined();
    expect(OrderListQuery.safeParse({ review: 'approved' }).success).toBe(false);
  });

  it('approves or reverts an approval', () => {
    expect(ApproveOrderRequest.parse({ approve: false })).toEqual({ approve: false });
    expect(ApproveOrderRequest.safeParse({}).success).toBe(false);
    expect(OrderReviewCountResponse.parse({ pending: 3 })).toEqual({ pending: 3 });
    expect(OrderReviewState.options).toEqual(['pending', 'approved']);
    expect(OrderCreatedByKind.options).toEqual(['agent', 'bot', 'import', 'api']);
  });
});

describe('product bot settings', () => {
  it('takes either bot field and trims the instructions', () => {
    expect(UpdateProductBotSettingsRequest.parse({ visibleToBot: false })).toEqual({
      visibleToBot: false,
    });
    expect(UpdateProductBotSettingsRequest.parse({ botInstructions: ' Hỏi size ' })).toEqual({
      botInstructions: 'Hỏi size',
    });
  });

  it('needs at least one field and caps the instructions at 4000 characters', () => {
    expect(UpdateProductBotSettingsRequest.safeParse({}).success).toBe(false);
    expect(
      UpdateProductBotSettingsRequest.safeParse({ botInstructions: 'a'.repeat(4001) }).success,
    ).toBe(false);
  });
});

describe('product offerings', () => {
  const accommodation = {
    rentalType: 'entire_property',
    bedrooms: 1,
    standardAdults: 2,
    standardChildren: 0,
    childAgeBelow: 6,
    maxGuests: null,
    roomLayout: [{ name: 'Phòng 1', beds: '1 giường đôi' }],
    amenities: [],
    rateBasis: 'night',
    rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 1_000_000 }],
    gallery: [],
  };

  it('fills the defaults of a bare course', () => {
    expect(OfferingDetails.parse({ kind: 'course' })).toEqual({
      kind: 'course',
      durationMinutes: null,
      sessions: null,
      period: '',
      format: null,
      level: '',
      schedule: '',
      audience: '',
      outcomes: [],
      priceNote: '',
    });
  });

  it('bounds the numbers and the outcomes', () => {
    const ok = (v: object) => OfferingDetails.safeParse({ kind: 'service', ...v }).success;
    expect(ok({ durationMinutes: 90, sessions: 10, format: 'hybrid' })).toBe(true);
    expect(ok({ durationMinutes: 4 })).toBe(false);
    expect(ok({ durationMinutes: 1441 })).toBe(false);
    expect(ok({ sessions: 0 })).toBe(false);
    expect(ok({ outcomes: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
    expect(ok({ outcomes: [' '] })).toBe(false);
    expect(OfferingDetails.safeParse({ kind: 'package' }).success).toBe(false);
  });

  it('reads a product row without the field as no offering', () => {
    expect(ProductDto.shape.offering.parse(undefined)).toBeNull();
  });

  it('takes an offering or an accommodation, never both', () => {
    expect(UpsertProductRequest.parse(base).offering).toBeUndefined();
    expect(UpsertProductRequest.parse({ ...base, offering: null }).offering).toBeNull();
    expect(
      UpsertProductRequest.parse({ ...base, offering: { kind: 'course' } }).offering?.kind,
    ).toBe('course');
    expect(UpsertProductRequest.safeParse({ ...base, accommodation }).success).toBe(true);
    const both = UpsertProductRequest.safeParse({
      ...base,
      accommodation,
      offering: { kind: 'service' },
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(['offering']);
  });
});

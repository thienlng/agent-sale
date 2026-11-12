import { describe, expect, it } from 'vitest';
import { AccommodationDetails, OfferingDetails, type ProductDto } from '@agent-sales/contracts';
import {
  cleanDescription,
  compactProduct,
  productDetails,
  withDefaultOffering,
} from '../domain/product-view.js';

const TINYMIND =
  'Tên gốc: Wooden Balance Stacker\nNguồn: https://example.com/p/123\nTuổi khuyến nghị: 18 tháng trở lên\n\nBộ  thú gỗ   xếp thăng bằng giúp bé luyện tay.';

const base: ProductDto = {
  id: '01900000-0000-7000-8000-000000000001',
  code: 'TM1',
  name: 'Thú gỗ xếp thăng bằng',
  description: TINYMIND,
  category: 'Đồ chơi gỗ',
  status: 'active',
  visibleToBot: true,
  botInstructions: 'Gợi ý cho bé từ 18 tháng',
  imageUrls: Array.from({ length: 6 }, (_, i) => `https://cdn.example.com/${i}.jpg`),
  offering: null,
  variants: [
    {
      id: '01900000-0000-7000-8000-0000000000a1',
      sku: 'TM1-A',
      name: 'Mặc định',
      price: 250000,
      cost: 1,
      weightGram: 1,
      stock: [
        {
          warehouseId: '01900000-0000-7000-8000-0000000000b1',
          onHand: 5,
          reserved: 1,
          available: 4,
        },
      ],
    },
  ],
  priceMin: 250000,
  priceMax: 300000,
  available: 4,
  external: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

describe('cleanDescription', () => {
  it('keeps the useful lines and drops source and URL lines', () => {
    const out = cleanDescription(TINYMIND, 1500);
    expect(out).toContain('Tuổi khuyến nghị: 18 tháng trở lên');
    expect(out).not.toContain('http');
    expect(out).not.toContain('Nguồn');
    expect(out).not.toMatch(/\s{2,}/);
  });
  it('cuts at a word boundary', () => {
    const out = cleanDescription('alpha beta gamma delta', 12);
    expect(out).toBe('alpha beta');
  });
  it('handles null', () => {
    expect(cleanDescription(null, 10)).toBe('');
  });
});

describe('compactProduct', () => {
  it('has the compact shape', () => {
    const c = compactProduct(base);
    expect(c).toEqual({
      id: base.id,
      name: base.name,
      category: 'Đồ chơi gỗ',
      fromVnd: 250000,
      toVnd: 300000,
      inStock: true,
      summary: expect.any(String),
      imageCount: 5,
    });
    expect(c.summary.length).toBeLessThanOrEqual(200);
    expect(c.summary).not.toContain('http');
  });
  it('reports out of stock', () => {
    expect(
      compactProduct({ ...base, variants: [{ ...base.variants[0]!, stock: [] }] }).inStock,
    ).toBe(false);
  });
});

describe('productDetails', () => {
  it('adds description, instructions, variants and image ids without URLs', () => {
    const d = productDetails(base);
    expect(d.instructions).toBe('Gợi ý cho bé từ 18 tháng');
    expect(d.variants).toEqual([
      { sku: 'TM1-A', name: 'Mặc định', priceVnd: 250000, available: 4 },
    ]);
    expect(d.images).toHaveLength(5);
    expect(d.images[0]).toEqual({ id: `p:${base.id}:0`, label: 'Thú gỗ xếp thăng bằng (1/5)' });
    expect(d.description).toContain('Tuổi khuyến nghị');
    expect(JSON.stringify(d)).not.toContain('http');
  });
  it('keeps the lodging shape for accommodations', () => {
    const d = productDetails({
      ...base,
      imageUrls: [],
      accommodation: AccommodationDetails.parse({
        rentalType: 'entire_property',
        bedrooms: 1,
        standardAdults: 2,
        standardChildren: 1,
        childAgeBelow: 6,
        maxGuests: null,
        roomLayout: [{ name: 'Room', beds: 'One bed' }],
        amenities: [],
        rateBasis: 'unconfirmed',
        rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 100000 }],
        gallery: [{ url: 'https://img.example.test/a.jpg', caption: 'Phòng khách' }],
      }),
    });
    expect(d).toMatchObject({ catalogKind: 'accommodation', availability: 'unverified' });
    expect(d).not.toHaveProperty('inStock');
    expect(d).not.toHaveProperty('variants');
    expect(d.images).toEqual([
      { id: `p:${base.id}:0`, label: 'Thú gỗ xếp thăng bằng – Phòng khách' },
    ]);
    expect(JSON.stringify(d)).not.toContain('https://');
  });
  it('strips URL and source lines from the owner instructions', () => {
    const d = productDetails({
      ...base,
      botInstructions: 'Gợi ý theo tuổi\nNguồn: https://x.test/a\nXem https://x.test/b',
    });
    expect(d.instructions).toBe('Gợi ý theo tuổi');
  });
  it('lists a whole lodging gallery (12 -> 12, 20 -> 15) while retail stays at 5', () => {
    const lodging = (n: number) =>
      productDetails({
        ...base,
        imageUrls: [],
        accommodation: AccommodationDetails.parse({
          rentalType: 'entire_property',
          bedrooms: 1,
          standardAdults: 2,
          standardChildren: 1,
          childAgeBelow: 6,
          maxGuests: null,
          roomLayout: [{ name: 'Room', beds: 'One bed' }],
          amenities: [],
          rateBasis: 'unconfirmed',
          rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 100000 }],
          gallery: Array.from({ length: n }, (_, i) => ({
            url: `https://img.example.test/${i}.jpg`,
            caption: `Ảnh ${i}`,
          })),
        }),
      });
    expect(lodging(12).images).toHaveLength(12);
    expect(lodging(12).images[11]?.label).toContain('Ảnh 11');
    expect(lodging(20).images).toHaveLength(15);
    expect(productDetails(base).images).toHaveLength(5);
  });
});

describe('course and service products (offering)', () => {
  const offering = OfferingDetails.parse({
    kind: 'course',
    durationMinutes: 90,
    sessions: 24,
    period: '3 tháng',
    format: 'offline',
    level: 'A2',
    outcomes: ['Giao tiếp cơ bản'],
    priceNote: 'học phí trọn khoá',
  });
  const course: ProductDto = { ...base, offering, priceMin: 4500000, priceMax: 4500000 };
  const pricedVariant = { ...base.variants[0]!, price: 4500000 };

  it('has catalogKind and no stock in the compact row and the details', () => {
    const product = { ...course, variants: [pricedVariant] };
    const c = compactProduct(product);
    expect(c).toMatchObject({
      catalogKind: 'course',
      fromVnd: 4500000,
      toVnd: 4500000,
      priceNote: 'học phí trọn khoá',
    });
    expect(c).not.toHaveProperty('inStock');
    const d = productDetails(product);
    expect(d.catalogKind).toBe('course');
    expect(d).not.toHaveProperty('inStock');
    expect(d).not.toHaveProperty('available');
    expect(d.variants).toEqual([{ sku: 'TM1-A', name: 'Mặc định', priceVnd: 4500000 }]);
    expect(d.offering).toEqual({
      durationMinutes: 90,
      sessions: 24,
      period: '3 tháng',
      format: 'offline',
      level: 'A2',
      outcomes: ['Giao tiếp cơ bản'],
    });
  });

  it('leaves the price range out when every price is 0 and carries the price note', () => {
    const service: ProductDto = {
      ...base,
      offering: OfferingDetails.parse({ kind: 'service', priceNote: 'liên hệ' }),
      variants: [{ ...base.variants[0]!, price: 0 }],
      priceMin: 0,
      priceMax: 0,
    };
    const c = compactProduct(service);
    expect(c).toMatchObject({ catalogKind: 'service', priceNote: 'liên hệ' });
    expect(c).not.toHaveProperty('fromVnd');
    expect(c).not.toHaveProperty('toVnd');
    const d = productDetails(service);
    // EV-6: no priceVnd 0 for the model to read as "no price"; the priceNote stands in.
    expect(d.variants).toEqual([{ sku: 'TM1-A', name: 'Mặc định' }]);
    expect(d.offering).toEqual({});
    expect(d.priceNote).toBe('liên hệ');
  });

  it('a price range covers only the published (non-zero) prices', () => {
    const c = compactProduct({
      ...course,
      variants: [
        { ...pricedVariant, price: 0 },
        { ...pricedVariant, sku: 'TM1-B', price: 3000000 },
      ],
      priceMin: 0,
      priceMax: 3000000,
    });
    expect(c).toMatchObject({ fromVnd: 3000000, toVnd: 3000000 });
  });

  it('a retail product keeps its exact view', () => {
    expect(productDetails(base)).toEqual({
      id: base.id,
      name: 'Thú gỗ xếp thăng bằng',
      category: 'Đồ chơi gỗ',
      fromVnd: 250000,
      toVnd: 300000,
      inStock: true,
      summary: expect.any(String),
      imageCount: 5,
      variants: [{ sku: 'TM1-A', name: 'Mặc định', priceVnd: 250000, available: 4 }],
      description: expect.any(String),
      instructions: 'Gợi ý cho bé từ 18 tháng',
      images: expect.any(Array),
    });
  });
});

describe('withDefaultOffering (request businesses)', () => {
  const untracked: ProductDto = {
    ...base,
    priceMin: 0,
    priceMax: 0,
    available: 0,
    variants: base.variants.map((v) => ({ ...v, price: 0, stock: [] })),
  };

  it('reads an imported course without offering or stock as a course, not out-of-stock retail', () => {
    const row = compactProduct(withDefaultOffering(untracked, 'course'));
    expect(row.catalogKind).toBe('course');
    expect(row).not.toHaveProperty('inStock');
    expect(row).not.toHaveProperty('fromVnd');
    expect(
      productDetails(withDefaultOffering(untracked, 'service')).variants?.[0],
    ).not.toHaveProperty('available');
  });

  it('keeps retail with tracked stock, accommodations, offerings and retail industries as they are', () => {
    expect(withDefaultOffering(base, 'service')).toBe(base);
    expect(withDefaultOffering(untracked, null)).toBe(untracked);
    const offered = { ...untracked, offering: OfferingDetails.parse({ kind: 'service' }) };
    expect(withDefaultOffering(offered, 'course')).toBe(offered);
    expect(compactProduct(withDefaultOffering(untracked, null))).toMatchObject({ inStock: false });
  });
});

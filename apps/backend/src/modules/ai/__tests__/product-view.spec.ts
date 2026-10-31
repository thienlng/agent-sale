import { describe, expect, it } from 'vitest';
import { AccommodationDetails, type ProductDto } from '@agent-sales/contracts';
import { cleanDescription, compactProduct, productDetails } from '../domain/product-view.js';

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

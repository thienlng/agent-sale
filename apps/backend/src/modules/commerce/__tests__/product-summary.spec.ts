import { ProductDto, ProductSummaryRow } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { productSummary } from '../application/catalog.service.js';

const SERVICE = { kind: 'service', durationMinutes: 60, sessions: 6, priceNote: 'liên hệ' };

const product = (description: string, offering: unknown = SERVICE): ProductDto =>
  ProductDto.parse({
    id: newId(),
    code: 'ML-NAM',
    name: 'Điều trị nám',
    description,
    category: 'Da',
    status: 'active',
    visibleToBot: true,
    botInstructions: 'Hỏi tình trạng da trước khi báo giá.',
    imageUrls: ['https://cdn.example.vn/a.jpg'],
    offering,
    variants: [
      {
        id: newId(),
        sku: 'ML-NAM-1',
        name: '1 buổi',
        price: 800_000,
        cost: 0,
        weightGram: 0,
        stock: [{ warehouseId: newId(), onHand: 0, reserved: 0, available: 0 }],
      },
    ],
    priceMin: 800_000,
    priceMax: 800_000,
    available: 0,
    external: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

describe('GET /products?fields=summary (T-187, QA retest N1)', () => {
  it('keeps the name, category, prices, price note and a one-line offering, nothing else', () => {
    const full = product('x'.repeat(400));
    const s = productSummary(full);
    expect(ProductSummaryRow.parse(s)).toEqual({
      id: full.id,
      code: 'ML-NAM',
      name: 'Điều trị nám',
      category: 'Da',
      priceMin: 800_000,
      priceMax: 800_000,
      priceNote: 'liên hệ',
      offering: 'service, 60 min, 6 sessions',
    });
    expect(JSON.stringify(s)).not.toContain('xxx');
    expect(JSON.stringify(s).length).toBeLessThan(250);
  });

  it('caps a long offering line and leaves a retail row without one', () => {
    const long = product('', { kind: 'course', level: 'Mất gốc', schedule: 'T7 sáng '.repeat(40) });
    expect(productSummary(long).offering).toHaveLength(160);
    expect(
      productSummary(long).offering.startsWith('course, level Mất gốc, schedule T7 sáng'),
    ).toBe(true);
    expect(productSummary(product('Áo', null))).toMatchObject({ priceNote: '', offering: '' });
  });
});

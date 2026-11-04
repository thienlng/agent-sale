import { ProductDto } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { productSummary } from '../application/catalog.service.js';

const product = (description: string): ProductDto =>
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
    offering: { kind: 'service', durationMinutes: 60, priceNote: 'liên hệ' },
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

describe('GET /products?fields=summary (T-187)', () => {
  it('keeps the shape, prices and offering, and drops the bulky fields', () => {
    const full = product('x'.repeat(400));
    const s = productSummary(full);
    expect(ProductDto.safeParse(s).success).toBe(true);
    expect(s.description).toHaveLength(161);
    expect(s.description.endsWith('…')).toBe(true);
    expect(s).toMatchObject({ botInstructions: '', imageUrls: [], offering: full.offering });
    expect(s.variants[0]).toMatchObject({ price: 800_000, stock: [] });
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(full).length);
  });

  it('keeps a short description as it is', () => {
    expect(productSummary(product('Ngắn gọn')).description).toBe('Ngắn gọn');
  });
});

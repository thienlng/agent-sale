import { describe, expect, it } from 'vitest';

import { lockedChange, type LockableProduct } from './external-lock.js';

const current: LockableProduct = {
  name: 'Áo thun',
  description: 'Cotton',
  category: 'Áo',
  imageUrls: ['https://media.test/a.jpg', 'https://media.test/b.jpg'],
  status: 'active',
  variants: [
    { id: 'v1', sku: 'AT-S', name: 'S', price: 100_000, cost: 50_000, weightGram: 200 },
    { id: 'v2', sku: 'AT-M', name: 'M', price: 110_000, cost: 50_000, weightGram: 210 },
  ],
};

describe('lockedChange', () => {
  it('is null when only Rapiz-owned fields could have changed', () => {
    expect(lockedChange(current, structuredClone(current))).toBeNull();
  });

  it('ignores the variant order and treats a missing category like null', () => {
    const next = { ...current, category: 'Áo', variants: [...current.variants].reverse() };
    expect(lockedChange(current, next)).toBeNull();
    expect(lockedChange({ ...current, category: null }, { ...current, category: undefined })).toBe(
      null,
    );
  });

  it('reports the first linked field that changes', () => {
    expect(lockedChange(current, { ...current, name: 'Áo phông' })).toBe('name');
    expect(lockedChange(current, { ...current, description: '' })).toBe('description');
    expect(lockedChange(current, { ...current, category: null })).toBe('category');
    expect(lockedChange(current, { ...current, status: 'archived' })).toBe('status');
  });

  it('reports a picture order change as imageUrls', () => {
    expect(lockedChange(current, { ...current, imageUrls: [...current.imageUrls].reverse() })).toBe(
      'imageUrls',
    );
  });

  it('reports variant price, cost, sku, name, weight, added and removed variants', () => {
    const edit = (patch: object) => ({
      ...current,
      variants: [{ ...current.variants[0]!, ...patch }, current.variants[1]!],
    });
    expect(lockedChange(current, edit({ price: 120_000 }))).toBe('variants');
    expect(lockedChange(current, edit({ cost: 1 }))).toBe('variants');
    expect(lockedChange(current, edit({ sku: 'AT-XS' }))).toBe('variants');
    expect(lockedChange(current, edit({ name: 'XS' }))).toBe('variants');
    expect(lockedChange(current, edit({ weightGram: 1 }))).toBe('variants');
    expect(lockedChange(current, edit({ id: undefined }))).toBe('variants');
    expect(lockedChange(current, { ...current, variants: [current.variants[0]!] })).toBe(
      'variants',
    );
  });
});

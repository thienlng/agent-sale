import { describe, expect, it } from 'vitest';

import { defineFactory } from './factory.js';
import { expectCrossTenantNotFound, twoTenants } from './tenant.js';

describe('defineFactory', () => {
  it('builds sequential objects with overrides', () => {
    const f = defineFactory((n) => ({ id: n, name: `item-${n}` }));
    expect(f.build()).toEqual({ id: 1, name: 'item-1' });
    expect(f.build({ name: 'x' })).toEqual({ id: 2, name: 'x' });
    expect(f.buildList(2)).toHaveLength(2);
  });
});

describe('expectCrossTenantNotFound', () => {
  it('passes for NOT_FOUND and fails for anything else', async () => {
    const { a, b } = twoTenants();
    expect(a).not.toBe(b);
    await expectCrossTenantNotFound(async () => {
      throw Object.assign(new Error('nope'), { code: 'NOT_FOUND' });
    });
    await expect(expectCrossTenantNotFound(async () => 'leaked')).rejects.toThrow('NOT_FOUND');
  });
});
